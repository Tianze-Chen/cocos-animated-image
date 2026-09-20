// worker 解码服务（主线程侧）。
//
// 全局单例：一个共享 worker 承载全部动图（旧版微信同时最多 1 个 worker），按 handle 复用；
// open/decode/close 都是带自增 id 的小消息往返，APNG/GIF 的逐帧顺序合成状态留在 worker 侧
// 的解码器实例里，主线程只保留展示所需的缓存。
//
// 帧传输两种模式（A/B 对比开关见 AnimatedImagePlayer.forceWorkerSharedBuffer）：
//   copy 模式：worker 把整帧像素 postMessage 回来（微信/浏览器各做一次结构化拷贝），
//              帧数据由本线程独占，Player 可长期缓存 —— 行为与主线程解码一致。
//   SAB  模式：worker 接受 open.shared 请求时分配一块 SharedArrayBuffer（微信 worker V2 /
//              桌面 Chrome，头 4 字节保留），每帧把像素写进去、只回一条小消息；主线程拿
//              共享内存的视图直接 uploadData，零跨线程序列化。所有帧复用同一块内存，
//              因此 decoder.transientFrames = true，Player 不做主线程帧缓存。
//              防「假共享」：旧环境可能把 SAB 悄悄 clone 掉（表面成功实际不共享），open 后
//              做一次写-读探针，探针不过立刻降级回 copy 模式。
//
// 零 cc 依赖。

import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import { acquireDecoderWorker, DecoderWorkerHandle, isDecoderWorkerSupported } from './worker-transport';
import {
    SHARED_HEADER_BYTES,
    WORKER_SUPPORTED_MIMES,
    WorkerChannelStatsResponse,
    WorkerDecodedBatchResponse,
    WorkerDecodedResponse,
    WorkerOpenedResponse,
    WorkerOverlayCanvasBoundResponse,
    WorkerRequest,
    WorkerResponse,
    bytesToB64,
    getAtomics,
    normalizeBytes,
} from './worker-protocol';
import type { AtomicsLike, OverlayCanvasLike, OverlayRect, WorkerOverlayNote } from './worker-protocol';

/** main→worker 方向的单向通知（stats 是 worker→main， Exclude 掉防误发）。 */
export type WorkerOverlayCommandNote = Exclude<WorkerOverlayNote, { t: 'overlay-stats' }>;

// --- A/B 度量口径 ---
// roundtripMs 是主线程视角的 decode 往返（排队 + worker 计算 + 传输），computeMsTotal 是
// worker 自己上报的纯解码耗时；两者之差就是跨线程传输的代价 —— SAB 开关的前后对比看这两个数。

export interface WorkerDecodeStats {
    opens: number;
    decodes: number;
    errors: number;
    /** decode-batch 往返次数（batch 未启用时恒 0；decodes 仍按帧计数）。 */
    batches: number;
    /** copy 模式累计收到的像素字节（SAB 模式恒为 0 增量）。 */
    copyBytes: number;
    /** 以 SAB 模式打开的动图数（探针通过后计数）。 */
    sharedHandles: number;
    /** SAB 探针失败、落回 copy 模式的次数（环境不支持 V2 时 > 0）。 */
    sharedProbeFailures: number;
    /** SAB 帧指纹比对不符的次数（真机通道串台实证后加的每帧正确性探针；> 0 = 通道 bug）。 */
    sabCorruptFrames: number;
    roundtripMsTotal: number;
    computeMsTotal: number;
}

const stats: WorkerDecodeStats = {
    opens: 0,
    decodes: 0,
    errors: 0,
    batches: 0,
    copyBytes: 0,
    sharedHandles: 0,
    sharedProbeFailures: 0,
    sabCorruptFrames: 0,
    roundtripMsTotal: 0,
    computeMsTotal: 0,
};

export function getWorkerDecodeStats (): Readonly<WorkerDecodeStats> {
    return stats;
}

export function resetWorkerDecodeStats (): void {
    stats.opens = 0;
    stats.decodes = 0;
    stats.errors = 0;
    stats.batches = 0;
    stats.copyBytes = 0;
    stats.sharedHandles = 0;
    stats.sharedProbeFailures = 0;
    stats.sabCorruptFrames = 0;
    stats.roundtripMsTotal = 0;
    stats.computeMsTotal = 0;
}

function nowMs (): number {
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

// --- 源字节去重（2026-09 真机实证大 b64 并发过线丢消息后的规避） ---
// 主线程对源字节算内容指纹（FNV-1a 32bit + 字节数），同源 open 带 key、不重传字节 ——
// x38 heavy 同 4 源重复 9.5 次，大消息从 38 条降到 4 条。引用/指纹两级缓存：同一
// Uint8Array 引用（同 clip 复用）直接命中，引用不同内容相同走 hash 兜底。

const sourceKeyByRef = new Map<Uint8Array, string>();
/** 已确认 worker 侧持有的源（miss 时移除并全量重发）。 */
const knownSources = new Set<string>();

function computeSourceKey (bytes: Uint8Array): string {
    const cached = sourceKeyByRef.get(bytes);
    if (cached !== undefined) { return cached; }
    // FNV-1a 32bit（Math.imul 保证 32 位乘法语义，普通 * 在 2^53 以上丢精度）；
    // 8MB 一次遍历 ~10-20ms，同引用只算一次（去重场景 open 高频、源低频）。
    let hash = 0x811C9DC5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const key = `${hash.toString(36)}:${bytes.byteLength}`;
    if (sourceKeyByRef.size >= 256) { sourceKeyByRef.clear(); }   // 防御性上限
    sourceKeyByRef.set(bytes, key);
    return key;
}

// --- 跨实例共享帧缓存（copy 模式，2026-09-17 wx 真机楔死定案后的帧级去重） ---
// 三件套把 open 轴压到每源一条后，decode 轴还有最后一层结构性冗余：N 个实例共用同一
// 源时，同源同帧被逐实例重复请求、重复过线（x125 heavy = 125 实例 × 4 源，单轮
// ~2.9k 条 decode / 像素 b64 400MB+ 把 wx 通道打穿，反馈文档 P0-1b）。同源同帧的解码
// 结果是确定的（APNG/GIF 顺序合成是纯函数），主线程按 sourceKey+frameIndex 缓存后
// 每源全帧序列只真实过线一次 —— 单轮 decode 条数/字节降 ~30 倍（x125 ≈ 90 条/~15MB），
// 稳态负载压到楔死触发量级之下。这是 spine worker「源字节只全量过线一次」哲学的
// 帧级推论；3.17.2 无 SAB 会话里 worker-auto 落 copy 的回退形态同受保护。
// ?sharedFrames=0 关回逐实例对照档（anim-decode-path 写入）。仅 copy 模式（帧数据
// 独占、可跨实例共享引用）；SAB 模式每实例一个 slot、帧瞬态，不适用。

interface SharedFrameEntry { data: Uint8Array; duration: number; }

/** 源指纹 → 帧号 → 解码帧（跨实例共享；Uint8Array 只读共享，所有 Player 只 uploadData 不改写）。 */
const sharedFrameStore = new Map<string, Map<number, SharedFrameEntry>>();
/** 同源同帧并发 miss 合并：in-flight 期间后来的实例等同一条请求。不合并的话 ramp
 *  同批次的同源实例几乎同时起播，第一批照样 N 条并发（帧 0 全员同时 miss）。 */
const sharedFrameInFlight = new Map<string, Promise<IDecodedFrame>>();
let sharedFrameBytes = 0;
let sharedFrameCapWarned = false;
/** 缓存字节上限：超出停止插入（已缓存照常服务），不再引入淘汰复杂度 —— 实测场景
 *  全源全帧 ~40MB，上限只是防源数失控的产品化护栏。 */
const SHARED_FRAME_CAP_BYTES = 256 * 1024 * 1024;

function sharedFramesWanted (): boolean {
    return (globalThis as { __sharedFrameCache?: boolean }).__sharedFrameCache !== false;
}

function sharedFrameGet (sourceKey: string, index: number): SharedFrameEntry | undefined {
    const byIndex = sharedFrameStore.get(sourceKey);
    return byIndex ? byIndex.get(index) : undefined;
}

function sharedFramePut (sourceKey: string, index: number, entry: SharedFrameEntry): void {
    if (sharedFrameBytes >= SHARED_FRAME_CAP_BYTES) {
        if (!sharedFrameCapWarned) {
            sharedFrameCapWarned = true;
            console.warn(`[animated-image] 共享帧缓存达上限 ${(SHARED_FRAME_CAP_BYTES / 1048576).toFixed(0)}MB，`
                + '后续帧直接过线不入缓存（可 ?sharedFrames=0 对照排查）');
        }
        return;
    }
    let byIndex = sharedFrameStore.get(sourceKey);
    if (!byIndex) {
        byIndex = new Map<number, SharedFrameEntry>();
        sharedFrameStore.set(sourceKey, byIndex);
    }
    if (!byIndex.has(index)) { sharedFrameBytes += entry.data.byteLength; }
    byIndex.set(index, entry);
}

/** 场景卸载重置时一并清：帧内容虽与 worker 生命周期无关（确定性数据），但留着会让
 *  矩阵第 2+ 轮的 worker 变体几乎零 decode 往返 —— 轮间不再是同分布样本，A/B 失义。 */
function clearSharedFrames (): void {
    sharedFrameStore.clear();
    sharedFrameInFlight.clear();
    sharedFrameBytes = 0;
    sharedFrameCapWarned = false;
}

// --- 采样挂钩（性能采样管线，见 tools/PERF.md） ---
// 工程侧采样器（FrameStats 经 BaseTestScene）把回调挂到 globalThis.__animatedImageWorkerSample，
// 扩展在每次 worker 往返结束时分项上报；没人挂则零开销。与 A/B 开关的 globalThis flag 同一套
// 约定（AnimatedImagePlayer.forceWorkerDecoder），扩展与工程互相不 import。

export interface WorkerDecodeSample {
    kind: 'open' | 'decode';
    /** 主线程视角的往返耗时：排队 + worker 计算 + 跨线程传输。 */
    roundtripMs: number;
    /** worker 上报的纯计算耗时（open = 构建解码器 + 分配 SAB；decode = 逐帧解码）。 */
    computeMs: number;
    /** 本次跨线程搬运的字节：open = 源文件体积；decode = copy 模式整帧像素 / SAB 模式 0。 */
    bytes: number;
}

export function emitSample (sample: WorkerDecodeSample): void {
    const sink = (globalThis as { __animatedImageWorkerSample?: (s: WorkerDecodeSample) => void })
        .__animatedImageWorkerSample;
    if (typeof sink === 'function') { sink(sample); }
}

// --- 消息泵 ---

/** 协商类请求（open/attach-shared/probe）的挂起诊断上限。真机实测 open 往返均值
 *  67ms（含大 b64 过线），10s 无回执 = 通道已丢这条消息 —— `_request` 原本永久等待，
 *  每丢一条消息就有一个实例静默挂死（2026-09 真机冒烟：x38 实例存活率 3/38 且随时间
 *  单调减少）。超时后 reject，调用方既有 catch 链会响亮 warn 并回退主线程解码。 */
const REQUEST_TIMEOUT_MS = 10_000;

// --- decode 消息的全局并发闸门（2026-09 真机实证：持续满载后小消息也丢） ---
// open 串行 + 源去重修完后，上报窗口（前 ~45s）吞吐 443 tasks/s 零丢失；持续运行
// 数分钟后通道劣化，decode 元数据消息也开始丢（vConsole 大量 decode 超时 warn，
// 自愈重发又丢，动图近乎静止）。与 open 丢消息同构 —— 50 实例的 in-flight 守卫允许
// 50 条 decode 并发在途，交织窗口太大。闸门把同时在途的 decode 砍到 LANES 条
//（吞吐 8 × ~21ms 往返 ≈ 380/s，对满载需求仅轻微限流），并顺带消掉「同时超时 →
// 同时重发」的重发风暴。decode 超时独立取 1s：正常往返 ~21ms（超时从请求发出
// 起算，不含闸门排队），1s 仍有 10 倍余量、误杀可忽略，丢一条最短可感地自愈
//（3s 实测「断流」肉眼明显，1s 缩成轻微一顿）；worker 侧对超时消息的迟到处理是
// O(1) 幂等，无需善后。真机实证：闸门 8 并发下丢消息率下降但不归零——通道劣化
// 与并发度关系不大，这是通道自身可靠性缺陷的又一证据（已入反馈文档）。
const DECODE_LANES = 8;
const DECODE_TIMEOUT_MS = 1_000;

interface Pending {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
}

/** ARQ 重传次数：超时先**同 id 重传**（worker 响应缓存保证幂等，decode 重执行 O(1)），
 *  上层完全无感知；RETRIES+1 次全丢才判「通道丢消息」reject 走降级链。 */
const REQUEST_RETRIES = 2;

// --- 通道诊断打点（定位丢消息方向，2026-09） ---
// 实证链：ARQ 重传可恢复 = 消息真丢而非处理失败；闸门 8 并发仍丢 = 与瞬时并发弱相关；
// arena 单块 SAB 仍丢 = 多 SAB 假设否定 —— 剩下的问题是丢在**哪一步**。主线程与 worker
// 各自逐类型计数收发（worker 经 channel-stats 快照回传），每 10s 一行 vConsole：
//   主→工 gap 持续涨 = 请求方向丢；工→主 gap 涨 = 响应方向丢；
//   两侧 gap 都 ≈在途数（≤ 闸门+通知）但超时仍发生 = 消息没丢只是极慢（卡队列）；
//   worker「N s 前有收包」停涨 = worker 收包侧整体断流（不止丢一条）。
// ?channelDiag=0 关闭（anim-decode-path 写入）。
function channelDiagWanted (): boolean {
    return (globalThis as { __channelDiag?: boolean }).__channelDiag !== false;
}

const DIAG_INTERVAL_MS = 10_000;

// --- 通道健康快照环(真机死因落盘,2026-09-16) ---
// 真机 worker 侧日志不透传 vConsole,[channel] 行只在 console —— worker-auto 冻结轮
// (taskCount=44、上屏帧≈0)发生后 run JSON 里零死因信息。诊断定时器已有的数据
// 每 10s 顺手存进环形缓冲(最近 CHANNEL_HEALTH_KEEP 条),工程侧 perf 报告经
// globalThis.__animatedImageChannelHealth 读走整环塞进 run.channel 落盘。
// 与 __animatedImageWorkerSample 同一套「扩展与工程互相不 import」约定。
export interface ChannelHealthSnapshot {
    at: number;
    /** 主线程视角逐类型发送/接收计数(重传也经 _post,计入 sentByType)。 */
    mainSentByType: { [t: string]: number };
    mainReceivedByType: { [t: string]: number };
    /** worker 侧快照(channel-stats-reply 原文;诊断请求超时 = 通道断流,整段缺省)。 */
    workerSentByType?: { [t: string]: number };
    workerReceivedByType?: { [t: string]: number };
    retransmits: number;
    arqExhausted: number;
    /** worker 距上次收包的秒数(停涨 = worker 收包侧断流)。 */
    workerIdleSec?: number;
    sabFrameCacheBytes: number;
    stats: Readonly<WorkerDecodeStats>;
    /** 自驱引擎健康(ticker/拍数/条目/播放/错误);拍数跨快照不涨 = 时钟死。 */
    auto?: WorkerChannelStatsResponse['auto'];
    /** 诊断请求本身超时:双向整体断流级证据(个别丢消息会重传恢复)。 */
    error?: string;
}

const channelHealthRing: ChannelHealthSnapshot[] = [];
const CHANNEL_HEALTH_KEEP = 8;   // 8 × 10s = 80s 窗口,盖住 40s 测量窗足够看趋势

function pushChannelHealth (s: ChannelHealthSnapshot): void {
    channelHealthRing.push(s);
    if (channelHealthRing.length > CHANNEL_HEALTH_KEEP) { channelHealthRing.shift(); }
    (globalThis as { __animatedImageChannelHealth?: ChannelHealthSnapshot[] })
        .__animatedImageChannelHealth = channelHealthRing;
}

export class WorkerDecodeService {
    private _worker: DecoderWorkerHandle;
    private _nextId = 1;
    private _nextHandle = 1;
    private _pending = new Map<number, Pending>();
    /** decode 全局并发闸门（DECODE_LANES）：闲位计数 + FIFO 等待者。 */
    private _lanesFree = DECODE_LANES;
    private _laneWaiters: (() => void)[] = [];
    /** 无 id 单向通知（overlay-stats）的监听者（OverlayManager）。 */
    private _onNotification: ((note: WorkerOverlayNote) => void) | null = null;
    /** 通道诊断：逐类型发送/接收计数（与 worker 侧 channel-stats 对差定位丢消息方向）。 */
    private _sentByType: { [t: string]: number } = {};
    private _receivedByType: { [t: string]: number } = {};
    private _retransmits = 0;
    private _arqExhausted = 0;
    private _diagTimer: ReturnType<typeof setInterval> | null = null;
    /** 已销毁（场景卸载重置）：拒绝新请求，terminate 后 in-flight 全部 reject。 */
    private _disposed = false;

    constructor (worker: DecoderWorkerHandle) {
        this._worker = worker;
        worker.onMessage((message) => { this._onMessage(message); });
        if (channelDiagWanted()) {
            this._diagTimer = setInterval(() => { this._reportChannelDiag(); }, DIAG_INTERVAL_MS);
        }
    }

    /** 所有出站消息的统一出口：计数 + 转发（诊断用；重传也经这里，_retransmits 单独计）。 */
    private _post (message: unknown, transfer?: unknown[]): void {
        if (this._disposed) { return; }
        const t = (message as { t?: unknown }).t;
        if (typeof t === 'string') {
            this._sentByType[t] = (this._sentByType[t] || 0) + 1;
        }
        this._worker.postMessage(message, transfer);
    }

    /** 每 10s 一行 vConsole：双向收发对差 + ARQ 计数 + worker 收包空闲时长 + SAB 缓存用量。 */
    private _reportChannelDiag (): void {
        const sum = (m: { [k: string]: number }): number => {
            let total = 0;
            for (const k in m) { total += m[k]; }
            return total;
        };
        const mainSent = sum(this._sentByType);
        const mainReceived = sum(this._receivedByType);
        this.channelStats().then((w) => {
            if (this._disposed) { return; }   // dispose 竞态:已排队的快照不再入环/打 log
            const workerReceived = sum(w.receivedByType);
            const workerSent = sum(w.sentByType);
            const idleSec = Math.max(0, (w.nowMs - w.lastReceivedMs) / 1000);
            const usedMb = (globalThis as { __sabFrameCacheUsed?: number }).__sabFrameCacheUsed || 0;
            pushChannelHealth({
                at: Date.now(),
                mainSentByType: { ...this._sentByType },
                mainReceivedByType: { ...this._receivedByType },
                workerSentByType: { ...w.sentByType },
                workerReceivedByType: { ...w.receivedByType },
                retransmits: this._retransmits,
                arqExhausted: this._arqExhausted,
                workerIdleSec: idleSec,
                sabFrameCacheBytes: usedMb,
                stats: { ...stats },
                auto: w.auto,
            });
            // 自驱引擎健康段（worker-auto 档；worker bundle 旧版无 auto 字段时缺省）：
            // ticker=timeout 且 rafDead=true = 真机 rAF 永不回调、看门狗已接管（正常自愈形态）；
            // ticks 不涨且 pending=true = 时钟仍挂死；playing=0 = 起播消息没到 worker。
            const a = w.auto;
            const autoText = a
                ? `｜auto ${a.ticker}${a.rafDead ? '(rAF判死已切timeout)' : ''} 拍${a.ticks}`
                    + ` 条目${a.items}/播${a.playing}${a.running ? '' : '/停钟'}`
                    + `${a.pending ? '/拍挂起' : ''}${a.errors > 0 ? `/错${a.errors}` : ''}`
                : '';
            console.log(`[channel] 主→工 发${mainSent}/工收${workerReceived}（差${mainSent - workerReceived}）`
                + `｜工→主 发${workerSent}/主收${mainReceived}（差${workerSent - mainReceived}）`
                + `｜超时重传${this._retransmits} 耗尽${this._arqExhausted}`
                + `｜worker ${idleSec.toFixed(1)}s 前有收包｜SAB帧缓存 ${(usedMb / 1048576).toFixed(0)}MB${autoText}`);
        }).catch((e) => {
            // dispose 竞态:场景已卸载、worker 已 terminate,这条 catch 只是 in-flight
            // 诊断请求被 reject 的余波 —— 不入环不打 warn(下一场景 onLoad 会清环)。
            if (this._disposed) { return; }
            // 诊断请求(带超时重传)都无响应 = 双向整体断流级证据,同样入环落盘 ——
            // 楔死态下 channel-stats 本身查不到 worker 侧,worker* 字段缺省即特征。
            pushChannelHealth({
                at: Date.now(),
                mainSentByType: { ...this._sentByType },
                mainReceivedByType: { ...this._receivedByType },
                retransmits: this._retransmits,
                arqExhausted: this._arqExhausted,
                sabFrameCacheBytes: 0,
                stats: { ...stats },
                error: String(e),
            });
            console.warn(`[channel] 诊断请求本身无响应（主→工或工→主正在丢）：${String(e)}`);
        });
    }

    /** onMessage 是单槽（wrapBrowserWorker 直接赋 worker.onmessage，本类已占用）——
     *  overlay 等无 id 通知必须经这条分发泵转发，OverlayManager 绝不碰 raw handle。 */
    public onNotification (listener: (note: WorkerOverlayNote) => void): void {
        this._onNotification = listener;
    }

    private _onMessage (message: unknown): void {
        const response = message as WorkerResponse | WorkerOverlayNote;
        if (!response || typeof response !== 'object') { return; }
        if (typeof response.t === 'string') {
            this._receivedByType[response.t] = (this._receivedByType[response.t] || 0) + 1;
        }
        // id 探针分流:overlay-* 单向通知(无 id)转发给监听者,带 id 的走响应泵。
        // (联合两侧都有 t,只有 id 是判别字段;notes 无 id,TS 收窄经探针变量完成。)
        const id = (response as { id?: unknown }).id;
        if (typeof id !== 'number') {
            if (typeof response.t === 'string' && response.t.indexOf('overlay-') === 0 && this._onNotification) {
                this._onNotification(response as WorkerOverlayNote);
            }
            return;
        }
        const pending = this._pending.get(id);
        if (!pending) { return; }
        this._pending.delete(id);
        if (pending.timer) { clearTimeout(pending.timer); }
        const typed = response as WorkerResponse;
        if (typed.t === 'error') {
            stats.errors++;
            pending.reject(new Error(typed.message));
        } else {
            pending.resolve(typed);
        }
    }

    private _request (
        build: (id: number) => WorkerRequest,
        transfer?: unknown[],
        timeoutMs?: number,
    ): Promise<WorkerResponse> {
        if (this._disposed) {
            return Promise.reject(new Error('worker 解码服务已重置（场景卸载 terminate），本会话需重建服务'));
        }
        return new Promise<WorkerResponse>((resolve, reject) => {
            const id = this._nextId++;
            const request = build(id);
            const pending: Pending = { resolve, reject };
            let attempts = 0;
            const armTimer = (): void => {
                if (!timeoutMs || timeoutMs <= 0) { return; }
                pending.timer = setTimeout(() => {
                    // ARQ：超时先同 id 重传 —— 请求真丢则 worker 收到的是新消息正常处理；
                    // 只是响应丢了则 worker 按响应缓存重发（decode 重执行，O(1) 幂等）。
                    // 上层无感知；重传额度用尽才判丢消息 reject。
                    if (attempts < REQUEST_RETRIES) {
                        attempts++;
                        this._retransmits++;
                        this._post(request, transfer);
                        armTimer();
                        return;
                    }
                    if (this._pending.delete(id)) {
                        this._arqExhausted++;
                        const handle = (request as { handle?: number }).handle;
                        reject(new Error(`worker 请求 ${request.t}#${id}`
                            + `${handle !== undefined ? `（handle=${handle}）` : ''}`
                            + ` ${timeoutMs}ms 无响应 ×${attempts + 1}（通道丢消息，重传 ${REQUEST_RETRIES} 次未达）`));
                    }
                }, timeoutMs);
            };
            armTimer();
            this._pending.set(id, pending);
            this._post(request, transfer);
        });
    }

    /** 占一条 decode 通道（闲位直接给，满则 FIFO 排队）。 */
    private _acquireLane (): Promise<void> {
        if (this._lanesFree > 0) {
            this._lanesFree--;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => { this._laneWaiters.push(resolve); });
    }

    /** 还一条 decode 通道：有等待者直接移交（计数不过手），否则闲位 +1。 */
    private _releaseLane (): void {
        const next = this._laneWaiters.shift();
        if (next) { next(); return; }
        this._lanesFree++;
    }

    // --- overlay 合成（worker-offscreen 变体）。只在浏览器宿主可用（OverlayManager 能力门）。 ---

    /** 把主线程 DOM overlay canvas 的 OffscreenCanvas 控制权 transfer 给 worker（一次性）。 */
    public async bindOverlayCanvas (
        canvas: OverlayCanvasLike & object, width: number, height: number,
    ): Promise<WorkerOverlayCanvasBoundResponse['ticker']> {
        const response = await this._request(
            (id) => ({ t: 'overlay-canvas', id, canvas, width, height }),
            [canvas as unknown as Transferable]);
        if (response.t !== 'overlay-canvas-bound') {
            throw new Error(`overlay bind 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
        return response.ticker;
    }

    public async attachOverlay (handle: number, rect: OverlayRect, playing: boolean, loop: boolean): Promise<void> {
        const response = await this._request((id) => ({ t: 'overlay-attach', id, handle, rect, playing, loop }));
        if (response.t !== 'overlay-attached') {
            throw new Error(`overlay attach 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
    }

    /** 单向通知（无 id、无回执）：resize / update / set-state / detach。 */
    public postOverlayNote (note: WorkerOverlayCommandNote): void {
        this._post(note);
    }

    /** 通道诊断快照（worker 侧逐类型收/发计数 + 最近收包时刻；ARQ 保护，不入响应缓存）。 */
    public async channelStats (): Promise<WorkerChannelStatsResponse> {
        const response = await this._request(
            (id) => ({ t: 'channel-stats', id }),
            undefined, REQUEST_TIMEOUT_MS);
        if (response.t !== 'channel-stats-reply') {
            throw new Error(`channel-stats 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
        return response;
    }

    // --- 自驱控制（worker-auto 变体）：起停/跳帧的 O(1) 控制往返。
    //     稀有消息（每实例每状态变更一条），走协商级超时 + ARQ；响应 auto-state 不入
    //     worker 响应缓存（wireSend 过滤），重传 = 重执行幂等取新状态。 ---

    public async autoStart (handle: number, playing: boolean, loop: boolean): Promise<void> {
        const response = await this._request(
            (id) => ({ t: 'auto-start', id, handle, playing, loop }),
            undefined, REQUEST_TIMEOUT_MS);
        if (response.t !== 'auto-state') {
            throw new Error(`auto-start 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
    }

    public async autoSeek (handle: number, index: number): Promise<void> {
        const response = await this._request(
            (id) => ({ t: 'auto-seek', id, handle, index }),
            undefined, REQUEST_TIMEOUT_MS);
        if (response.t !== 'auto-state') {
            throw new Error(`auto-seek 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
    }

    public async open (bytes: Uint8Array, mime: string, shared: boolean): Promise<WorkerOpenedResponse> {
        const handle = this._nextHandle++;
        const started = nowMs();
        // transfers=false 宿主（旧版微信 worker，JSON 拷贝）上 typed array 过线会被序列化器
        // 弄坏，跨线字节一律 b64 字符串（emitSample 的 bytes 口径仍是源文件逻辑体积，
        // b64 膨胀反映在 roundtripMs 里）。浏览器宿主直传 + 零编码开销。
        // 源去重：worker 已持有该源（knownSources）时 bytes 发空串 —— 大消息只全量过线一次，
        // 且免掉同源重复 open 的 8MB b64 编码（x38 heavy 场景省 34 次 × 几十 ms）。
        const sourceKey = computeSourceKey(bytes);
        const alreadyKnown = knownSources.has(sourceKey);
        const encodeFull = (): Uint8Array | string => (this._worker.transfers ? bytes : bytesToB64(bytes));
        const payload: Uint8Array | string = alreadyKnown ? '' : encodeFull();
        const send = (p: Uint8Array | string): Promise<WorkerResponse> => this._request(
            (id) => ({ t: 'open', id, handle, bytes: p, mime, shared, sourceKey }),
            undefined, REQUEST_TIMEOUT_MS);
        let response: WorkerResponse;
        try {
            response = await send(payload);
            // 引用未命中（worker 侧缓存被 FIFO 踢掉 / worker 重启）：清记录全量重发一次。
            if (response.t === 'opened' && response.sourceMiss) {
                knownSources.delete(sourceKey);
                response = await send(encodeFull());
            }
        } catch (e) {
            // 超时丢消息后 worker 队列里可能还排着这条 open（FCFS）：补发一条 close 排在
            // 它后面，worker 先建条目再删 —— 不泄漏解码器（close 对不存在条目幂等）。
            this.close(handle);
            throw e;
        }
        if (response.t !== 'opened') {
            throw new Error(`open ${mime} 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
        if (response.sourceMiss) {
            // 理论不可达（重发带全量字节，worker 必建条目）；防御性出口。
            throw new Error(`open ${mime} 失败: 源引用二次未命中`);
        }
        knownSources.add(sourceKey);
        stats.opens++;
        emitSample({
            kind: 'open',
            roundtripMs: nowMs() - started,
            computeMs: response.computeMs || 0,
            // bytes 口径保持源文件逻辑体积：去重省的是线上的字节，A/B 对比看 postBytesTotal
            //（真值在 transport 侧），这里不因去重而缩水。
            bytes: bytes.byteLength,
        });
        return response;
    }

    /** 共享性探针。positions 带上时同时逐点回读像素区（多点探针，筛大面积映射错乱）；
     *  返回 header token 的 seen 与逐点 seenValues（未发 positions 时缺省）。 */
    public async probe (
        handle: number, token: number, positions?: number[],
    ): Promise<{ seen: number; seenValues?: number[] }> {
        const response = await this._request(
            (id) => ({ t: 'probe', id, handle, token, positions }),
            undefined, REQUEST_TIMEOUT_MS);
        if (response.t !== 'probed') {
            throw new Error(`probe 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
        return { seen: response.seen, seenValues: response.seenValues };
    }

    /** 主线程分配的 SAB 送进 worker 绑定（open 回 sharedRequestBytes 的回退路径）。
     *  SAB 可共享不可转移 —— 不进 transfer 列表，随消息体过线；worker 侧形态校验
     *  不过会回 error（这里抛出），调用方落既有 copy 降级出口。
     *  两种形态：整块 = buffer 一块恰好 4+w*h*4（老形态）；arena = 首次带 buffer
     * （arena 引用）+ offset/length，后续仅 offset/length（worker 缓存引用）。 */
    public async attachShared (
        handle: number,
        buffer: ArrayBufferLike | undefined,
        offset?: number,
        length?: number,
    ): Promise<void> {
        const response = await this._request(
            (id) => ({ t: 'attach-shared', id, handle, buffer, offset, length }),
            undefined, REQUEST_TIMEOUT_MS);
        if (response.t !== 'attached-shared') {
            throw new Error(`attach-shared 失败: ${response.t === 'error' ? response.message : response.t}`);
        }
    }

    public async decode (handle: number, index: number): Promise<WorkerDecodedResponse> {
        // 计时从拿到通道开始：闸门排队是自家限流，不混进 roundtripMs（通道真实往返的采样）。
        await this._acquireLane();
        const started = nowMs();
        // 超时同协商类：decode 消息也会丢（2026-09 真机满载实证，持续运行数分钟后大量
        // 超时 warn）。超时 reject 后调用方 catch 复位 _pendingDecode，tick 自动重发同帧
        //（SAB 已合成帧 O(1)），自愈而非回退；迟到响应由 _onMessage 按 id 未命中静默丢弃。
        try {
            const response = await this._request(
                (id) => ({ t: 'decode', id, handle, index }),
                undefined, DECODE_TIMEOUT_MS);
            if (response.t !== 'decoded') {
                throw new Error(`decode ${index} 失败: ${response.t === 'error' ? response.message : response.t}`);
            }
            const roundtripMs = nowMs() - started;
            const computeMs = response.computeMs || 0;
            // 旧版微信 worker 回的是 b64 字符串，这里归一化回 Uint8Array 并写回响应对象，
            // 消费方（WorkerBackedDecoder / Player）零改动。bytes 口径仍是逻辑像素体积。
            const data = normalizeBytes(response.data);
            if (data) { response.data = data; }
            const bytes = data ? data.byteLength : 0;
            stats.decodes++;
            stats.roundtripMsTotal += roundtripMs;
            stats.computeMsTotal += computeMs;
            stats.copyBytes += bytes;
            emitSample({ kind: 'decode', roundtripMs, computeMs, bytes });
            return response;
        } finally {
            this._releaseLane();
        }
    }

    /**
     * 批量解码：一次往返取 [from, from+count) 连续帧（仅 copy 模式）。
     * 统计口径与单帧 decode 对齐——每帧发一条 emitSample，roundtripMs 按帧数摊销、
     * computeMs 用该帧自己的解码耗时：postMsAvg 仍是「每帧传输成本」，与逐帧协议
     * 的 A/B 组直接可比（postCount 数值不变，batches 才是消息条数）。
     */
    public async decodeBatch (handle: number, from: number, count: number): Promise<WorkerDecodedBatchResponse> {
        await this._acquireLane();
        const started = nowMs();
        try {
            const response = await this._request(
                (id) => ({ t: 'decode-batch', id, handle, from, count }),
                undefined, DECODE_TIMEOUT_MS);
            if (response.t !== 'decoded-batch') {
                throw new Error(`decode-batch ${from}+${count} 失败: ${response.t === 'error' ? response.message : response.t}`);
            }
            const roundtripMs = nowMs() - started;
            const frames = response.frames || [];
            const amortized = frames.length > 0 ? roundtripMs / frames.length : roundtripMs;
            let logged = stats.batches === 0;
            stats.batches++;
            for (const frame of frames) {
                const data = normalizeBytes(frame.data);
                if (data) { frame.data = data; }
                const bytes = data ? data.byteLength : 0;
                const computeMs = frame.computeMs || 0;
                stats.decodes++;
                stats.roundtripMsTotal += amortized;
                stats.computeMsTotal += computeMs;
                stats.copyBytes += bytes;
                emitSample({ kind: 'decode', roundtripMs: amortized, computeMs, bytes });
            }
            if (logged) {
                console.log(`[animated-image] decode-batch 生效：${frames.length} 帧/往返，`
                    + `本次往返 ${roundtripMs.toFixed(1)}ms（摊销 ${amortized.toFixed(1)}ms/帧）`);
            }
            return response;
        } finally {
            this._releaseLane();
        }
    }

    /** close 是单向通知：worker 侧必然清理，不必等回执（destroy 路径上等回执只会添乱）。 */
    public close (handle: number): void {
        this._post({ t: 'close', id: this._nextId++, handle });
    }

    /**
     * 场景卸载重置：terminate worker + 停诊断定时器 + in-flight 全部 reject。
     * 真机同冷启动多轮矩阵实证（2026-09-17 anim x125）：单轮 ~2900 decode 的大流量
     * 把 wx 通道打穿后，worker 线程对一切请求永久无响应，而本 service 是模块级单例、
     * 此前没有销毁路径 —— 楔死状态跨场景跨轮继承，后续 worker 轮全是「引擎空转 60fps」
     * 的空场景假数据。每轮场景卸载时 dispose，下一场景重新协商全新通道。
     */
    public dispose (): void {
        if (this._disposed) { return; }
        this._disposed = true;
        if (this._diagTimer) { clearInterval(this._diagTimer); this._diagTimer = null; }
        const err = new Error('worker 解码服务已重置（场景卸载 terminate 共享 worker）');
        for (const pending of this._pending.values()) {
            if (pending.timer) { clearTimeout(pending.timer); }
            pending.reject(err);
        }
        this._pending.clear();
        // 闸门等待者放行：它们的 _request 会被 _disposed 检查立即 reject，不会真发消息。
        for (const wake of this._laneWaiters.splice(0)) { wake(); }
        this._worker.terminate();
    }
}

// --- 单例：失败结果会缓存（整个会话不再重试 worker 路径），重新探测靠刷新页面 / 重启游戏，
//     或调 resetDecodeService()（测试场景卸载走这条：每轮全新通道）---

let servicePromise: Promise<WorkerDecodeService | null> | null = null;

export function getDecodeService (): Promise<WorkerDecodeService | null> {
    if (!servicePromise) {
        servicePromise = (async () => {
            const worker = await acquireDecoderWorker();
            return worker ? new WorkerDecodeService(worker) : null;
        })().catch((e) => {
            console.warn(`[animated-image] worker 服务初始化失败，本会话回退主线程解码：${String(e)}`);
            return null;
        });
    }
    return servicePromise;
}

/**
 * 场景卸载重置：terminate 共享 worker 并清空单例（含初始化失败判死的 null 缓存），
 * 下一次 getDecodeService 重新建 worker、重新协商全新通道。由测试场景 onDestroy 调用
 * （AnimatedImageTest），builtin 轮（service 从未建起）是 no-op。
 * 「已确认 worker 持有的源」指纹与跨实例共享帧缓存一并清 —— 前者是新 worker 侧
 * 什么都不持有，留着只让首轮 open 多走 miss 往返；后者虽是确定性数据、跨 worker
 * 仍有效，但留着会让矩阵第 2+ 轮 worker 变体几乎零 decode 往返，轮间不再是
 * 同分布样本（A/B 失义）。
 */
export function resetDecodeService (): void {
    const pending = servicePromise;
    servicePromise = null;
    knownSources.clear();
    clearSharedFrames();
    // arena 状态一并清：SAB arena 属于**当前这个 worker 实例**（worker 侧缓存着引用），
    // terminate 后新 worker 什么都不持有 —— 标志不重置的话，后续 attach 只带 offset 不带
    // buffer，新 worker 全部回「arena 引用缺失」error，SAB 协商整体落 copy（2026-09-17
    // 第二批矩阵四轮 worker-auto 全回退的根因：16 个早期协商把 sabArenaShared 置真后，
    // 每轮新 worker 的 125 条 attach 全拒）。arena 本体也随 worker 死了，重新分配。
    sabArenaBuffer = null;
    sabArenaCursor = 0;
    sabArenaShared = false;
    sabArenaExhaustedWarned = false;
    if (pending) {
        pending.then((svc) => { if (svc) { svc.dispose(); } }).catch(() => { /* 初始化失败已消化为 null */ });
    }
}

// --- IAnimatedImageDecoder 的 worker 后端 ---

export class WorkerBackedDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;
    public readonly transientFrames: boolean;

    private _service: WorkerDecodeService;
    private _handle: number;
    private _shared: ArrayBufferLike | null;
    /** SAB 模式下本实例像素区在 _shared 里的字节偏移（arena 形态 = slot 起点，整块 = 0）。 */
    private _sharedOffset = 0;
    /** copy 模式合批帧数（0/1 = 逐帧）；SAB 模式恒 0。 */
    private _batchK = 0;
    /** 批量预取的未消费帧（交付即删：copy 模式 Player 自己长期缓存，这里只做前瞻）。 */
    private _batchCache = new Map<number, { data: Uint8Array; duration: number }>();
    /** 按解码器串行化批量请求：防并发窗口重复拉批 / 乱序打乱 worker 侧顺序合成状态。 */
    private _batchChain: Promise<unknown> = Promise.resolve();
    /** 源内容指纹（negotiateWorkerDecoder 传入）：copy 模式跨实例共享帧缓存的键。 */
    private _sourceKey = '';

    constructor (service: WorkerDecodeService, handle: number, opened: WorkerOpenedResponse,
        sharedOffset = 0, sourceKey = '') {
        this._service = service;
        this._handle = handle;
        this._sourceKey = sourceKey;
        this.width = opened.width;
        this.height = opened.height;
        this.frameCount = opened.frameCount;
        this.loopCount = opened.loopCount;
        this._shared = opened.sharedBuffer;
        this._sharedOffset = sharedOffset;
        this.transientFrames = !!opened.sharedBuffer;
        this._batchK = opened.sharedBuffer ? 0 : workerBatchSize();
    }

    public decodeFrame (index: number): Promise<IDecodedFrame> {
        if (this._shared) {
            // SAB 模式：响应不带像素。视图共享自那块共享内存，只在下一次 decodeFrame 前有效
            //（transientFrames 契约），uploadData 同步读取是安全的。合批不适用（消息本就只有元数据）。
            return this._service.decode(this._handle, index).then((response) => {
                // 视图必须带显式长度：arena 形态 _shared 是整块 arena，无长度视图会一路
                // 延伸到 arena 末尾（串进别的实例 slot），指纹比对与 uploadData 全错。
                const view = new Uint8Array(this._shared!, this._sharedOffset + SHARED_HEADER_BYTES,
                    this.width * this.height * 4);
                // 每帧数据正确性探针：worker 写入后的指纹与主线程视图同口径计算比对
                //（2026-09 真机串台实证：串台实例首帧就把 b64 文本字节当像素写上屏）。
                const fp = response.fp;
                if (fp && fp.length >= 6) {
                    const m = Math.min(view.length, fp[3]);
                    let nonZero = 0;
                    let sum = 0;
                    for (let i = 0; i < m; i++) {
                        const b = view[i];
                        if (b !== 0) { nonZero++; }
                        sum = (sum + b) & 0xFFFF;
                    }
                    const head = m > 0 ? view[0] : 0;
                    const mid = m > 0 ? view[m >> 1] : 0;
                    const tail = m > 0 ? view[m - 1] : 0;
                    if (head !== fp[0] || mid !== fp[1] || tail !== fp[2]
                        || nonZero !== fp[4] || sum !== fp[5]) {
                        stats.sabCorruptFrames++;
                        console.error(`[animated-image] SAB 数据串台：帧 ${index} 主线程视图`
                            + `[首=${head} 中=${mid} 尾=${tail} 非零=${nonZero} 和=${sum}]`
                            + ` ≠ worker 写入 [首=${fp[0]} 中=${fp[1]} 尾=${fp[2]} 非零=${fp[4]} 和=${fp[5]}]`
                            + `（帧字节 ${fp[3]}）—— 共享内存映射错乱，通道 bug 证据`);
                    }
                }
                return { data: view, duration: response.duration };
            });
        }
        const hit = this._batchCache.get(index);
        if (hit) {
            this._batchCache.delete(index);
            return Promise.resolve({ data: hit.data, duration: hit.duration });
        }
        // 共享帧缓存：同源同帧已被别的实例拉过 → 零消息命中；正在拉 → 合并等同一条
        // 请求（ramp 同批次的同源实例帧 0 几乎同时 miss，不合并的话第一批照样并发）。
        // 命中路径不经 service.decode —— 零往返零字节，postCount/postBytes 口径自动反映。
        const key = this._sourceKey;
        if (key && sharedFramesWanted()) {
            const cached = sharedFrameGet(key, index);
            if (cached) { return Promise.resolve({ data: cached.data, duration: cached.duration }); }
            const inFlightKey = `${key}:${index}`;
            const inFlight = sharedFrameInFlight.get(inFlightKey);
            if (inFlight) { return inFlight; }
            // 不用 Promise.finally（tsconfig lib 目标早于 es2018）：then 双分支对称清理。
            const settle = (): void => { sharedFrameInFlight.delete(inFlightKey); };
            const run = this._fetchCopyFrame(index).then(
                (frame) => { settle(); return frame; },
                (err) => { settle(); throw err; });
            sharedFrameInFlight.set(inFlightKey, run);
            return run;
        }
        return this._fetchCopyFrame(index);
    }

    /** copy 模式未命中后的真实取帧（合批或单帧），响应帧写回共享缓存（本实例持有 sourceKey）。 */
    private _fetchCopyFrame (index: number): Promise<IDecodedFrame> {
        if (this._batchK > 1) {
            const run = this._batchChain.then(() => this._decodeViaBatch(index));
            this._batchChain = run.then(() => undefined, () => undefined);
            return run;
        }
        return this._service.decode(this._handle, index).then((response) => {
            const data = response.data as Uint8Array;
            if (this._sourceKey) {
                sharedFramePut(this._sourceKey, index, { data, duration: response.duration });
            }
            return { data, duration: response.duration };
        });
    }

    /** 未命中 → 一次往返拉 [index, index+K)，请求帧即返、其余入缓存。 */
    private async _decodeViaBatch (index: number): Promise<IDecodedFrame> {
        // 链上重查：前一批可能已覆盖此帧（seek / 批边界）。
        const cached = this._batchCache.get(index);
        if (cached) {
            this._batchCache.delete(index);
            return { data: cached.data, duration: cached.duration };
        }
        const count = Math.min(this._batchK, this.frameCount - index);
        if (count <= 1) {
            const response = await this._service.decode(this._handle, index);
            const data = response.data as Uint8Array;
            if (this._sourceKey) {
                sharedFramePut(this._sourceKey, index, { data, duration: response.duration });
            }
            return { data, duration: response.duration };
        }
        const response = await this._service.decodeBatch(this._handle, index, count);
        for (const frame of response.frames) {
            if (frame.index === index || !frame.data) { continue; }
            const data = frame.data as Uint8Array;
            this._batchCache.set(frame.index, { data, duration: frame.duration });
            // 预取帧同时入共享缓存：同源的其他实例直接零消息命中。
            if (this._sourceKey) {
                sharedFramePut(this._sourceKey, frame.index, { data, duration: frame.duration });
            }
        }
        const mine = response.frames.length > 0 && response.frames[0].index === index
            ? response.frames[0] : response.frames.find((f) => f.index === index);
        if (!mine || !mine.data) {
            throw new Error(`decode-batch 响应缺请求帧 ${index}`);
        }
        return { data: mine.data as Uint8Array, duration: mine.duration };
    }

    public destroy (): void {
        this._service.close(this._handle);
        this._shared = null;
    }
}

// --- IAnimatedImageDecoder 的 worker 自驱后端（worker-auto 变体，方案 C） ---
// 播放时钟在 worker：worker 每解一帧直接写 SAB + 推进 header 帧序号（Atomics add 发布），
// 本类只做轮询上屏 —— 每帧零消息，通道只剩构造期协商与 start/stop/seek 控制消息
//（2026-09 真机定案：持续满载 ~10k 累计请求后通道整体楔死、ARQ 不可穿越，唯一根治
// 是把稳态消息量压到阈值之下 —— 每帧一条往返的拉模型就是消息量根源）。
export class WorkerAutoDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;
    /** 共享内存视图只在 worker 下一次写入前有效（与拉模型 SAB 同一 transient 契约）。 */
    public readonly transientFrames = true;
    public readonly autoDriven = true;

    private _service: WorkerDecodeService;
    private _handle: number;
    private _shared: ArrayBufferLike | null;
    /** 本实例 slot 在 _shared 里的字节偏移（arena 形态 = slot 起点，整块 = 0）。 */
    private _sharedOffset: number;
    private _hdr: Int32Array;
    private _atomics: AtomicsLike | null;
    /** 上次看到的发布序号（word 2）；轮询 = 比对它，变了才有新帧。 */
    private _lastSeq = 0;
    /** stopAuto 的回执请求需要 loop 字段（worker 停止态忽略它），缓存最近一次 start 值。 */
    private _loopWanted = true;

    constructor (service: WorkerDecodeService, handle: number, opened: WorkerOpenedResponse,
        sharedOffset = 0) {
        this._service = service;
        this._handle = handle;
        this.width = opened.width;
        this.height = opened.height;
        this.frameCount = opened.frameCount;
        this.loopCount = opened.loopCount;
        this._shared = opened.sharedBuffer as ArrayBufferLike;
        this._sharedOffset = sharedOffset;
        this._hdr = new Int32Array(this._shared, sharedOffset, SHARED_HEADER_BYTES / 4);
        this._atomics = getAtomics();
    }

    public startAuto (loop: boolean): void {
        this._loopWanted = loop;
        this._service.autoStart(this._handle, true, loop)
            .catch((e) => { console.warn(`[animated-image] auto-start 失败（帧将不再推进）：${String(e)}`); });
    }

    public stopAuto (): void {
        this._service.autoStart(this._handle, false, this._loopWanted)
            .catch((e) => { console.warn(`[animated-image] auto-stop 失败：${String(e)}`); });
    }

    public seekAuto (index: number): void {
        const clamped = Math.max(0, Math.min(index | 0, Math.max(0, this.frameCount - 1)));
        this._service.autoSeek(this._handle, clamped)
            .catch((e) => { console.warn(`[animated-image] auto-seek 失败：${String(e)}`); });
    }

    public pollAutoFrame (): { data: Uint8Array; index: number } | null {
        if (!this._shared) { return null; }   // 已 destroy
        const a = this._atomics;
        const seq = a ? a.load(this._hdr, 2) : this._hdr[2];
        if (seq === this._lastSeq) { return null; }   // 无新帧：一次对齐 int 读，零成本
        this._lastSeq = seq;
        const index = a ? a.load(this._hdr, 1) : this._hdr[1];
        // 视图必须带显式长度（arena 形态 _shared 是整块 arena，无长度视图会串进别的 slot）。
        const view = new Uint8Array(this._shared, this._sharedOffset + SHARED_HEADER_BYTES,
            this.width * this.height * 4);
        // 帧指纹比对（P0-2 串台探针的自驱等价物）：worker 写入时算好非零字节数/字节和
        //（word 4/5），这里对自家视图同口径算一遍。比对与 worker 的下一次发布并发时
        // 可能读到半新半旧 —— 序号复读已变 = 确实跨越了一次发布，跳过本轮不判罪。
        let nonZero = 0;
        let sum = 0;
        for (let i = 0; i < view.length; i++) {
            const b = view[i];
            if (b !== 0) { nonZero++; }
            sum += b;
        }
        const fpNonZero = a ? a.load(this._hdr, 4) : this._hdr[4];
        const fpSum = a ? a.load(this._hdr, 5) : this._hdr[5];
        if (nonZero !== fpNonZero || sum !== fpSum) {
            const seqNow = a ? a.load(this._hdr, 2) : this._hdr[2];
            if (seqNow === seq) {
                stats.sabCorruptFrames++;
                console.error(`[animated-image] SAB 数据串台（自驱轮询）：帧 ${index} 主线程视图`
                    + ` [非零=${nonZero} 和=${sum}] ≠ worker 写入 [非零=${fpNonZero} 和=${fpSum}]`
                    + ' —— 共享内存映射错乱，通道 bug 证据');
            }
        }
        // 保持上报管线形状（worker 段非空、postCount≈上屏帧数）：postMs 恒 0 属设计 ——
        // 自驱模式没有每帧过线（见 tools/PERF.md 口径）。
        emitSample({ kind: 'decode', roundtripMs: 0, computeMs: 0, bytes: 0 });
        return { data: view, index };
    }

    /** 自驱模式不走拉模型（Player 也不会调；防御性出口）。 */
    public decodeFrame (): Promise<IDecodedFrame> {
        return Promise.reject(new Error('自驱模式不支持 decodeFrame 拉取'));
    }

    public destroy (): void {
        // close 单向通知：worker 侧一并注销自驱条目（decoder-worker.ts close 分支）。
        this._service.close(this._handle);
        this._shared = null;
    }
}

const WORKER_MIME_SET = new Set(WORKER_SUPPORTED_MIMES);

/** 主线程侧具备 SAB 全局才请求 SAB 模式；worker 侧能否真共享由探针裁决。 */
export function shouldUseSharedBuffer (): boolean {
    const flag = (globalThis as { __forceWorkerSharedBuffer?: boolean }).__forceWorkerSharedBuffer === true;
    const hasSab = typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer === 'function';
    return flag && hasSab;
}

/** copy 模式合批帧数 K（globalThis flag 由 AnimatedImagePlayer.forceWorkerBatchSize 维护，
 *  query 链见 assets/scripts/anim-decode-path.ts）。0/1 = 不合批。 */
function workerBatchSize (): number {
    const k = (globalThis as { __forceWorkerBatchK?: number }).__forceWorkerBatchK;
    return typeof k === 'number' && k > 1 ? Math.min(64, Math.floor(k)) : 0;
}

/** 自驱变体开关（AnimatedImagePlayer.forceWorkerAuto 维护，query 链见 anim-decode-path.ts）。
 *  仅 SAB 真共享环境生效 —— 协商/探针失败落回 copy 时自动退回拉模型 WorkerBackedDecoder。 */
function autoDrivenWanted (): boolean {
    return (globalThis as { __forceWorkerAuto?: boolean }).__forceWorkerAuto === true;
}

// --- arena 单块 SAB（2026-09 单变量实验：检验「多块 SAB 是否为丢消息触发因子」） ---
// 假设：微信 V2 通道持续满载丢消息的根源可能是 worker 侧持有的 SAB **对象数**（每实例
// 一块 × 50 实例）而非消息流量 —— 全进程只建**一块**大 SAB 按 slot 分区（每 slot =
// 4B header + w*h*4 像素区），所有实例只往各自 slot 写。首次 attach-shared 带 arena
// 引用 + offset/length，后续只带 offset（worker 缓存引用）—— SAB 对象过线从 N 次降
// 为 1 次。判定：ARQ 版（逐块 + 帧缓存砍流量）若照丢而 arena 版消失 = 多 SAB 支持缺陷
// 实锤；两者都不丢 = 触发面是流量；两者照丢 = 别的因子。
// bump 分配器不回收 slot（实验形态：实例数有界；预算 ?sabArenaMB= 缺省 64MB，耗尽后
// 新实例退回逐块 attach 老形态 + warn 一次）。?sabArena=0 整体关回逐块（对照档）。
let sabArenaBuffer: ArrayBufferLike | null = null;
let sabArenaCursor = 0;
/** worker 已拿到 arena 引用（首次 attach 成功后 true，之后 attach 只带 offset）。 */
let sabArenaShared = false;
let sabArenaExhaustedWarned = false;

function sabArenaWanted (): boolean {
    return (globalThis as { __sabArena?: boolean }).__sabArena !== false;
}

function sabArenaBudgetBytes (): number {
    const mb = (globalThis as { __sabArenaMB?: number }).__sabArenaMB;
    return typeof mb === 'number' && mb > 0 ? mb * 1024 * 1024 : 64 * 1024 * 1024;
}

/** 在 arena 里切一块 8 字节对齐的 slot；未建则建（创建打一条 log 供真机确认档位）。
 *  未启用 / 构造失败 / 耗尽返回 null（调用方退回逐块 attach 老形态）。 */
function allocateArenaSlot (bytes: number): { buffer: ArrayBufferLike; offset: number } | null {
    if (!sabArenaWanted()) { return null; }
    if (!sabArenaBuffer) {
        try {
            const Ctor = (globalThis as { SharedArrayBuffer?: new (length: number) => ArrayBufferLike })
                .SharedArrayBuffer;
            if (typeof Ctor !== 'function') { return null; }
            const budget = sabArenaBudgetBytes();
            sabArenaBuffer = new Ctor(budget);
            sabArenaCursor = 0;
            console.log(`[animated-image] SAB arena 启用：单块 ${(budget / 1024 / 1024).toFixed(0)}MB 按 slot 分区`
                + '（多 SAB 丢消息假设的对照实验，?sabArena=0 关回逐块）');
        } catch (e) {
            return null;
        }
    }
    const aligned = (sabArenaCursor + 7) & ~7;
    if (aligned + bytes > (sabArenaBuffer as { byteLength: number }).byteLength) {
        if (!sabArenaExhaustedWarned) {
            sabArenaExhaustedWarned = true;
            console.warn('[animated-image] SAB arena 耗尽，后续实例退回逐块 SAB attach');
        }
        return null;
    }
    sabArenaCursor = aligned + bytes;
    return { buffer: sabArenaBuffer, offset: aligned };
}

// --- open 协商全局串行（2026-09 真机实证的规避修复，默认开启） ---
// 真机两轮冒烟：多实例并发 open（大 b64 消息）+ 多块 SAB attach 同时在途时，微信 V2
// 通道丢 open 消息（大量 10s 无回执、上轮 35/38 静默挂起）；同规模 copy 档（无 SAB
// 消息）全部通过 —— 通道对「大字符串 × SAB 克隆」并发交织有实现 bug。修复 = 整个
// open→attach→probe 协商块全局串行（一次一条在途），交织窗口构造上消灭；配合源字节
// 去重（service.open），x38 heavy 的串行队列只剩 4 条大消息 + 34 条引用小消息。
// ?sabSerial=0（anim-decode-path 写入，与 forceXXX flag 同一 globalThis 约定）可关回
// 并发档做对照。只串行协商段，decode 照常并发。
let sabSerialChain: Promise<unknown> = Promise.resolve();

function sabSerialWanted (): boolean {
    return (globalThis as { __sabSerialOpen?: boolean }).__sabSerialOpen !== false;
}

/** worker open→attach→probe 协商（SAB 模式时含降级重开；任何失败消化为 null = 回退主线程）。 */
async function negotiateWorkerDecoder (
    service: WorkerDecodeService, bytes: Uint8Array, mime: string,
): Promise<IAnimatedImageDecoder | null> {
    try {
        // 源指纹提前算一份（computeSourceKey 有引用缓存，service.open 内再算零成本）：
        // copy 模式跨实例共享帧缓存以它为键，随 handle 传给 WorkerBackedDecoder。
        const sourceKey = computeSourceKey(bytes);
        let opened = await service.open(bytes, mime, shouldUseSharedBuffer());

        // 主线程分配回退（2026-09 真机实证的微信 V2 灰度形态：worker 侧无 SAB 构造器、
        // 主线程有，通道却真共享）：open 回 sharedRequestBytes 时主线程分配后送回绑定，
        // 绑成后落进下方与 worker 分配完全相同的形态校验 + 写-读探针 —— 通道假共享
        // （空壳/克隆）在这两道门被筛掉，降级出口与探针失败同一条。
        // 分配形态两档：arena 单块优先（多 SAB 丢消息假设的对照实验，见上方 sabArena
        // 注释）；耗尽 / ?sabArena=0 退回逐块（每实例一块独立 SAB，老形态）。
        const sabCtor = (globalThis as { SharedArrayBuffer?: new (length: number) => ArrayBufferLike })
            .SharedArrayBuffer;
        let sharedOffset = 0;
        if (!opened.sharedBuffer && opened.sharedRequestBytes && typeof sabCtor === 'function') {
            try {
                const slot = allocateArenaSlot(opened.sharedRequestBytes);
                if (slot) {
                    // 首次 attach 带 arena 引用（worker 缓存），后续只带 offset ——
                    // 全进程 SAB 对象过线恰 1 次。
                    await service.attachShared(
                        opened.handle,
                        sabArenaShared ? undefined : slot.buffer,
                        slot.offset,
                        opened.sharedRequestBytes);
                    sabArenaShared = true;
                    opened.sharedBuffer = slot.buffer;
                    sharedOffset = slot.offset;
                } else {
                    const sab = new sabCtor(opened.sharedRequestBytes);
                    await service.attachShared(opened.handle, sab);
                    opened.sharedBuffer = sab;
                }
            } catch (e) {
                stats.sharedProbeFailures++;
                console.warn(`[animated-image] 主线程分配 SAB 绑定失败，降级 copy 模式：${String(e)}`);
                service.close(opened.handle);
                opened = await service.open(bytes, mime, false);
            }
        }

        // 形态校验：旧版微信 worker 的 JSON 拷贝会把 SAB 序列化成普通对象（无 byteLength），
        // 直接建 Uint8Array 视图会抛 TypeError、把整条 worker 路径打死 —— 这种情况按
        // 「环境不支持真共享」降级 copy，与探针失败同一出口。
        const looksShared = (b: ArrayBufferLike | null): b is ArrayBufferLike => {
            const len = b ? (b as { byteLength?: unknown }).byteLength : undefined;
            return typeof len === 'number' && len > 0;
        };
        if (opened.sharedBuffer && !looksShared(opened.sharedBuffer)) {
            stats.sharedProbeFailures++;
            console.warn('[animated-image] SharedArrayBuffer 过线后不可用（旧版微信 worker 的 JSON 拷贝会把它序列化成普通对象），降级 copy 模式');
            service.close(opened.handle);
            opened = await service.open(bytes, mime, false);
        } else if (opened.sharedBuffer) {
            // 写-读探针：token 写进 header byte 0，worker 回读它那份内存的同一位置。
            // 看不到 token 说明传输把 SAB clone 了（旧环境典型行为）—— 立刻降级 copy 模式。
            // arena 形态 header/像素区在本实例 slot 内（sharedOffset 起）；整块形态 offset 0。
            const header = new Uint8Array(opened.sharedBuffer, sharedOffset, SHARED_HEADER_BYTES);
            const token = 0xA5 ^ (opened.frameCount & 0xFF) | 0x01;
            header[0] = token;
            // 多点探针（2026-09 真机串台实证：串台实例单字节探针通过、像素区却接错缓冲）：
            // 像素区 5 个采样点写位置相关 pattern，worker 逐点回读比对 —— 任何一点不符
            // 即判映射错乱，降级 copy。首帧 decode 会覆盖像素区，探针痕迹无需清理。
            const pixels = new Uint8Array(opened.sharedBuffer, sharedOffset + SHARED_HEADER_BYTES,
                opened.width * opened.height * 4);
            const positions = [0, pixels.length >> 2, pixels.length >> 1,
                (pixels.length * 3) >> 2, pixels.length - 1];
            const pattern = (p: number): number => (0x5A ^ (p & 0xFF)) & 0xFF;
            for (const p of positions) { pixels[p] = pattern(p); }
            const { seen, seenValues } = await service.probe(opened.handle, token, positions);
            const multiOk = !seenValues
                || seenValues.every((v, i) => v === pattern(positions[i]));
            if (seen !== token || !multiOk) {
                stats.sharedProbeFailures++;
                console.warn(`[animated-image] SharedArrayBuffer 探针失败（seen=${seen}`
                    + `${multiOk ? '' : `，多点采样不符 [${seenValues}]`}`
                    + '），该环境 worker 不支持真共享或映射错乱，降级 copy 模式');
                service.close(opened.handle);
                opened = await service.open(bytes, mime, false);
            } else {
                stats.sharedHandles++;
            }
        }

        if (!opened.frameCount) {
            service.close(opened.handle);
            return null;
        }
        // 自驱变体（方案 C）：SAB 协商 + 探针通过后把后端换成轮询式 —— worker 持播放
        // 时钟自驱解码写 SAB，主线程每引擎帧轮询 header 序号上屏，每帧零消息。
        // 无 SAB 环境（探针失败落 copy）自动退回拉模型 WorkerBackedDecoder，行为同 worker
        //（copy 档），perf-report 的 /auto/ 组 postMsAvg>0.1 回退识别规则覆盖此形态。
        if (autoDrivenWanted() && opened.sharedBuffer) {
            return new WorkerAutoDecoder(service, opened.handle, opened, sharedOffset);
        }
        return new WorkerBackedDecoder(service, opened.handle, opened, sharedOffset, sourceKey);
    } catch (e) {
        console.warn(`[animated-image] worker 解码路径不可用，回退主线程：${String(e)}`);
        return null;
    }
}

export async function tryCreateWorkerDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder | null> {
    if (!WORKER_MIME_SET.has(mime)) { return null; }
    if (!isDecoderWorkerSupported()) { return null; }
    const service = await getDecodeService();
    if (!service) { return null; }
    if (!sabSerialWanted()) {
        return negotiateWorkerDecoder(service, bytes, mime);
    }
    // 串行对照档：协商块排全局链（成败都放行下一条 —— negotiate 内部已把错误消化为 null）。
    const run = sabSerialChain.then(() => negotiateWorkerDecoder(service, bytes, mime));
    sabSerialChain = run.then(() => undefined, () => undefined);
    return run;
}
