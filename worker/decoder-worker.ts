// worker 侧入口 —— 由 scripts/build-worker.mjs 打成单文件 bundle（worker/dist/animated-image-decoder.js）。
// 复用 runtime/ 里的纯 TS 解码器（apng-decoder / gif-decoder / zlib.min），零 cc 依赖。
//
// 宿主适配（进 worker 后没有 DOM 也没有引擎，可用的全局随宿主不同）：
//   微信：全局 worker 对象（worker.onMessage / worker.postMessage，postMessage 无 transfer 列表）。
//   浏览器：self.onmessage / self.postMessage（支持 transfer 列表）。
//
// 协议见 runtime/worker-protocol.ts。帧传输两模式：
//   copy：postMessage 携带像素（浏览器宿主会先 slice 一份再 transfer —— 直接 transfer 解码器
//         内部缓存的帧会把那份缓存 detach 掉，后续 seek 回读该帧就变零长数组）。
//   SAB：open 带 shared 时尝试分配 SharedArrayBuffer（失败/未请求则 sharedBuffer 回 null，
//        主线程自动落回 copy 模式）；每帧写进共享内存像素区，回小消息。
//         帧数据不离开 worker（写的是共享内存的视图），解码器内部缓存原样保留。

import { createApngDecoder } from '../runtime/apng-decoder';
import { createGifDecoder } from '../runtime/gif-decoder';
import type { IAnimatedImageDecoder } from '../runtime/types';
import { createOverlayCompositor } from './overlay-compositor';
import type { OverlayCompositor } from './overlay-compositor';
import { SHARED_HEADER_BYTES, bytesToB64, getAtomics, normalizeBytes } from '../runtime/worker-protocol';
import type { AtomicsLike, WorkerOverlayNote, WorkerOverlayStatsNote, WorkerRequest, WorkerResponse } from '../runtime/worker-protocol';

interface WxWorkerGlobal {
    onMessage (callback: (message: unknown) => void): void;
    postMessage (message: unknown): void;
}

declare const worker: WxWorkerGlobal | undefined;

// worker 上下文没有 DOM lib，self 用环境声明兜住（仅编译期；运行时仍按 typeof 探测）。
declare const self: { postMessage?: unknown; onmessage?: unknown } | undefined;

interface HostContext {
    register (handler: (message: unknown) => void): void;
    /** transfer 仅浏览器宿主生效；微信 postMessage 是单参拷贝。批量响应传数组。
     *  overlay-stats 是无 id 的单向通知，与响应共用这条发送通道。 */
    send (message: WorkerResponse | WorkerOverlayStatsNote, transfer?: ArrayBuffer | ArrayBuffer[]): void;
    transfers: boolean;
}

function resolveHost (): HostContext | null {
    // 微信：worker 文件作用域里的全局 worker 对象。
    try {
        if (typeof worker !== 'undefined' && worker && typeof worker.onMessage === 'function') {
            const wxWorker = worker;
            return {
                register: (handler) => { wxWorker.onMessage(handler); },
                send: (message) => { wxWorker.postMessage(message); },
                transfers: false,
            };
        }
    } catch (e) {
        // typeof 已守卫，这里只防个别宿主对全局访问本身抛错。
    }

    // 浏览器：self.postMessage / self.onmessage。
    const scope = typeof self !== 'undefined' ? self : undefined;
    if (scope && typeof scope.postMessage === 'function') {
        const post = scope.postMessage.bind(scope) as (message: unknown, transfer?: ArrayBuffer[]) => void;
        return {
            register: (handler) => {
                (scope as { onmessage: unknown }).onmessage = (event: { data: unknown }) => { handler(event.data); };
            },
            send: (message, transfer) => {
                if (transfer) {
                    post(message, Array.isArray(transfer) ? transfer : [transfer]);
                } else {
                    post(message);
                }
            },
            transfers: true,
        };
    }
    return null;
}

const host = resolveHost();
if (!host) {
    throw new Error('animated-image worker 无法识别宿主（既没有微信 worker 全局，也没有 self.postMessage）');
}

interface WorkerEntry {
    decoder: IAnimatedImageDecoder;
    sharedBuffer: ArrayBufferLike | null;
    /** 像素区视图（sharedBuffer 存在时非空）。整块形态偏移 SHARED_HEADER_BYTES；
     *  arena 形态是 arena 内本实例 slot 的像素区（entry.sharedOffset + header）。 */
    sharedView: Uint8Array | null;
    /** header 探针区视图（probe 用）。整块形态 = buffer 偏移 0；arena 形态 = slot 头。 */
    sharedHeader: Uint8Array | null;
    /** header 的 Int32 视图（自驱变体用：帧号/发布序号/时长/指纹的原子写）。 */
    sharedHeaderInt32: Int32Array | null;
}

const entries = new Map<number, WorkerEntry>();

// --- arena 形态（2026-09 单变量实验：全进程单块 SAB） ---
// 检验「多块 SAB 是否为通道丢消息触发因子」：主线程只建一块大 SAB 按 slot 分区，
// 首次 attach-shared 带引用（缓存在这里），后续只带 offset —— worker 侧 SAB 对象
// 数从每实例一块降为全进程一块。
let arenaBuffer: ArrayBufferLike | null = null;

// --- 响应缓存（ARQ 可靠性层的 worker 半边，2026-09 真机实证通道丢消息后的根治缓解） ---
// 主线程超时后**同 id 重传**请求：若原请求其实只是迟到（worker 已处理、响应在途中丢了），
// 这里按 id 重发历史响应，不重复执行 —— open 重建解码器（全量 inflate）和 attach-shared
// 的「已绑定」误报都靠这道门挡住。decode / decode-batch **不查不存**：解码天然幂等
//（已合成帧 O(1)），且缓存 decoded 响应会让 SAB 指纹失去时序自洽（重发的是旧 fp，
// 共享内存却可能已被后续帧覆盖）——重执行天然带回当前内存的指纹。error 响应不缓存
//（错误路径重执行便宜，且失败不该被固化）。LRU 上限防长会话增长。
const RESPONSE_CACHE_MAX = 128;
const responseCache = new Map<number, WorkerResponse>();

function rememberResponse (id: number, message: WorkerResponse): void {
    if (responseCache.has(id)) {
        responseCache.delete(id);
        responseCache.set(id, message);
        return;
    }
    if (responseCache.size >= RESPONSE_CACHE_MAX) {
        const oldest = responseCache.keys().next().value;
        if (oldest !== undefined) { responseCache.delete(oldest); }
    }
    responseCache.set(id, message);
}

// --- 源字节去重缓存（2026-09 真机实证大 b64 并发过线丢消息后的规避） ---
// key = FNV-1a hash:字节数（主线程算好随 open 带来）。同源多实例（x38 heavy 同 4 源重复
// 9.5 次）只有第一次全量过线，后续 open 带 key、bytes 为空 —— 大消息从 38 条降到 4 条，
// 并发丢消息窗口随之收缩。FIFO 上限防长会话无限增长（测试池场景 64 源封顶足够）。
const SOURCE_CACHE_MAX = 64;
const sourceCache = new Map<string, Uint8Array>();

function rememberSource (key: string, bytes: Uint8Array): void {
    if (sourceCache.has(key)) {
        sourceCache.delete(key);        // 重插到队尾，维持 FIFO 新鲜度
        sourceCache.set(key, bytes);
        return;
    }
    if (sourceCache.size >= SOURCE_CACHE_MAX) {
        const oldest = sourceCache.keys().next().value;
        if (oldest !== undefined) { sourceCache.delete(oldest); }
    }
    sourceCache.set(key, bytes);
}

// overlay 合成器（worker-offscreen 变体）。惰性：第一条 overlay-canvas 请求到达才创建 ——
// 未启用变体时 overlay-compositor 一行都不执行（「不破坏现有四档」的 worker 侧核心保险）。
let overlay: OverlayCompositor | null = null;

// --- 通道诊断计数（定位丢消息方向：主线程侧同样逐类型计数，两侧对差 = 到达缺口） ---
// 2026-09 真机实证链：ARQ 同 id 重传可恢复（消息真丢而非处理失败）、闸门 8 并发仍丢
//（与瞬时并发弱相关）、arena 单块 SAB 仍丢（多 SAB 假设否定）—— 触发因子是持续吞吐下
// 通道自身劣化。这对计数回答「丢在哪一步」：主→工 gap = 请求方向丢；工→主 gap = 响应
// 方向丢；两侧 gap 都小但超时仍发生 = 消息没丢只是极慢（卡队列，看 lastReceivedMs）。
const channelReceived: { [t: string]: number } = {};
const channelSent: { [t: string]: number } = {};
let channelLastReceivedMs = 0;

function workerNow (): number {
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function createDecoder (bytes: Uint8Array, mime: string): IAnimatedImageDecoder {
    if (mime === 'image/apng') { return createApngDecoder(bytes); }
    if (mime === 'image/gif') { return createGifDecoder(bytes); }
    throw new Error(`worker 不支持的格式: ${mime}`);
}

/** 分配 SAB 帧缓冲；宿主不支持（无构造器 / 构造失败）返回 null。 */
function allocateShared (byteLength: number): ArrayBufferLike | null {
    try {
        const Ctor = (globalThis as { SharedArrayBuffer?: new (length: number) => ArrayBufferLike }).SharedArrayBuffer;
        if (typeof Ctor !== 'function') { return null; }
        return new Ctor(byteLength);
    } catch (e) {
        return null;
    }
}

function errorMessage (e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// --- 自驱播放引擎（worker-auto 变体，方案 C） ---
// 播放时钟搬进 worker：每帧解码后直接写 SAB slot + 推进 header 帧序号（word 2，最后
// 发布），主线程每引擎帧轮询序号、变了才 uploadData —— 每帧零消息，通道只剩
// auto-start / auto-seek 等 O(1) 控制消息（2026-09 真机定案：持续满载 ~10k 累计请求后
// 通道整体楔死、ARQ 重传不可穿越 —— 应用层唯一根治是把稳态消息量压到阈值之下，
// 见 tools/wx-worker-v2-feedback.md P0-1b）。时钟推进数学与 AnimatedImagePlayer.tick
// 同构：dt 钳 250ms、时长未知的帧先解码学习下一拍再推、非循环播完保持末帧。
interface AutoItem {
    handle: number;
    playing: boolean;
    loop: boolean;
    currentFrame: number;
    accumMs: number;
    /** 逐帧时长学习表，-1 = 未知（未知帧先解码学习，与 Player.tick 同款节奏）。 */
    durations: number[];
    /** 单飞守卫：同条目同时最多一个 decode 在途。 */
    pending: boolean;
    /** 已写进 SAB 的帧号（-1 = 未写过；等于目标帧则跳写 —— 拉模型「同帧重发」的零成本等价）。 */
    lastWritten: number;
    /** 连续解码失败计数（≥8 停摆该条目，对齐 overlay compositor 策略）。 */
    errors: number;
}

const autoItems = new Map<number, AutoItem>();
let autoRunning = false;
/** 一拍在途守卫：连续 auto-start / 恢复不得重复排拍（否则每拍翻倍、时钟越跑越快）。 */
let autoPending = false;
let autoLastMs = 0;
// rAF 活性状态机：2026-09 真机实证 wx V2 worker 暴露 requestAnimationFrame 却从不回调
//（无渲染面），盲信它时钟第一拍即死 —— autoPending 永真、动图全静止在首帧（vConsole
// postCount 只有 open+seek 各 20，一帧时钟样本都没有）。首拍 rAF 与 setTimeout 看门狗
// 双排：250ms 内 rAF 没回调 → 会话级判死（rafDead）换 setTimeout 链自愈；回调过一次 →
// 会话级信任（rafProven），此后直排 rAF 零额外开销。沙箱两种宿主（手动泵 rAF / 无 rAF）
// 都复现不了这个第四组合 —— rAF 在但永不调，只能靠看门狗防御。
let autoRafProven = false;
let autoRafDead = false;
/** 当前时钟 ticker（诊断快照用；raf 判死后为 'timeout'）。 */
let autoTickerKind: 'none' | 'raf' | 'timeout' = 'none';
/** 自驱时钟累计拍数（诊断快照用 —— 真机上时钟死没死、死多久，一行日志读出）。 */
let autoTickCount = 0;
const AUTO_RAF_PROBE_MS = 250;

const atomics: AtomicsLike | null = getAtomics();

/** 取/建自驱条目；handle 未 open 或没有 SAB（copy 条目）抛错 —— 自驱的前提是共享内存。 */
function ensureAutoItem (handle: number): AutoItem {
    const entry = entries.get(handle);
    if (!entry) { throw new Error(`unknown handle ${handle}`); }
    if (!entry.sharedView || !entry.sharedHeaderInt32) {
        throw new Error(`handle ${handle} 没有共享内存（自驱模式需 SAB）`);
    }
    let item = autoItems.get(handle);
    if (!item) {
        item = {
            handle,
            playing: false,
            loop: false,
            currentFrame: 0,
            accumMs: 0,
            durations: new Array<number>(Math.max(1, entry.decoder.frameCount)).fill(-1),
            pending: false,
            lastWritten: -1,
            errors: 0,
        };
        autoItems.set(handle, item);
    }
    return item;
}

/** setTimeout 兜底链排一拍；宿主连 setTimeout 都没有返回 false（调用方停钟）。 */
function autoScheduleTimeout (): boolean {
    const g = globalThis as { setTimeout?: (callback: () => void, ms: number) => unknown };
    if (typeof g.setTimeout !== 'function') { return false; }
    autoTickerKind = 'timeout';
    autoPending = true;
    g.setTimeout(() => { autoPending = false; autoTick(); }, Math.max(4, Math.round(1000 / 60)));
    return true;
}

/** 自驱时钟排下一拍：rAF 可用走 rAF（与画面节奏对齐），否则 setTimeout ~60Hz 兜底
 *  （旧版微信 worker 无 rAF —— 与 overlay compositor 同款宿主探测与 running 停钟模式）。
 *  「rAF 函数存在」不等于「会回调」（见 autoRafProven 注释）—— 首拍必须过看门狗验证。 */
function autoScheduleNext (): void {
    if (!autoRunning || autoPending) { return; }
    const g = globalThis as {
        requestAnimationFrame?: (callback: (ts: number) => void) => unknown;
        setTimeout?: (callback: () => void, ms: number) => unknown;
    };
    if (autoRafDead || typeof g.requestAnimationFrame !== 'function') {
        if (!autoScheduleTimeout()) { autoRunning = false; }   // 无任何定时器宿主：停钟
        return;
    }
    if (autoRafProven || typeof g.setTimeout !== 'function') {
        // 已验证过 / 无 setTimeout 可挂看门狗：直排 rAF（浏览器宿主老行为）
        autoTickerKind = 'raf';
        autoPending = true;
        g.requestAnimationFrame(() => { autoPending = false; autoTick(); });
        return;
    }
    // 首拍：rAF + 看门狗双排，谁先到听谁的
    autoTickerKind = 'raf';
    autoPending = true;
    let fired = false;
    g.requestAnimationFrame(() => {
        if (autoRafDead || fired) { return; }   // 判死后的僵尸回调：链已归 setTimeout，忽略
        fired = true;
        autoRafProven = true;
        autoPending = false;
        autoTick();
    });
    g.setTimeout!(() => {
        if (fired || autoRafProven) { return; }   // rAF 活着：看门狗静默退役
        autoRafDead = true;   // rAF 没回调：会话级判死
        if (!autoRunning || !autoPending) { return; }
        autoPending = false;   // 那一拍永不会来：交还 setTimeout 链接管
        autoScheduleTimeout();
    }, AUTO_RAF_PROBE_MS);
}

function autoTick (): void {
    if (!autoRunning) { return; }
    autoTickCount++;
    const now = workerNow();
    const dt = Math.min(250, now - autoLastMs);
    autoLastMs = now;
    let active = false;
    for (const item of autoItems.values()) {
        if (!item.playing) { continue; }
        active = true;
        autoAdvance(item, dt);
    }
    if (!active) { autoRunning = false; return; }   // 全暂停/无条目 → 停钟（auto-start 重启）
    autoScheduleNext();
}

function autoAdvance (item: AutoItem, dtMs: number): void {
    const entry = entries.get(item.handle);
    if (!entry || !entry.sharedView || !entry.sharedHeaderInt32) {
        autoItems.delete(item.handle);   // 条目已死（close 单向通知丢失），别让僵尸项吊着时钟
        return;
    }
    const frameCount = entry.decoder.frameCount;
    if (frameCount <= 1) { return; }
    item.accumMs += dtMs;
    let guard = frameCount;   // 一拍最多跨全部帧（超长 dt 钳 250ms 后的极端连续短帧）
    while (guard-- > 0) {
        const frameDur = item.durations[item.currentFrame];
        if (frameDur < 0) { autoEnsureFrame(item, item.currentFrame); return; }
        if (item.accumMs < frameDur) { break; }
        item.accumMs -= frameDur;
        let next = item.currentFrame + 1;
        if (next >= frameCount) {
            if (item.loop) { next = 0; }
            else {
                item.currentFrame = frameCount - 1;   // 非循环：保持末帧（Player.tick 同构）
                item.accumMs = 0;
                item.playing = false;
                break;
            }
        }
        item.currentFrame = next;
    }
    autoEnsureFrame(item, item.currentFrame);
}

/** 解码目标帧并发布进 SAB：像素 → 元数据（帧号/时长/指纹）→ 序号 +1 的顺序发布，
 *  轮询侧看到序号变化时数据已就位（单写者 seqlock）。单飞 + 同帧去重写。 */
function autoEnsureFrame (item: AutoItem, index: number): void {
    const entry = entries.get(item.handle);
    if (!entry || !entry.sharedView || !entry.sharedHeaderInt32) { return; }
    if (item.lastWritten === index || item.pending) { return; }
    item.pending = true;
    entry.decoder.decodeFrame(index).then((frame) => {
        item.pending = false;
        item.errors = 0;
        if (item.durations[index] < 0) { item.durations[index] = frame.duration; }
        // 时钟已走远（本帧解码期间 currentFrame 又变了）：不写共享内存、不推序号 ——
        // 避免「写旧帧 + 推序号」让轮询侧上屏一帧过时画面；下一拍补当前帧。
        if (item.currentFrame !== index) { return; }
        const view = entry.sharedView!;
        view.set(frame.data);
        // 帧指纹（P0-2 串台探针的自驱等价物）：非零字节数 + 字节和（≤ ~6.5M < 2^31，
        // int32 无损），主线程轮询侧对自家视图同口径比对。
        const m = Math.min(view.length, frame.data.byteLength);
        let nonZero = 0;
        let sum = 0;
        for (let i = 0; i < m; i++) {
            const b = view[i];
            if (b !== 0) { nonZero++; }
            sum += b;
        }
        const hdr = entry.sharedHeaderInt32!;
        if (atomics) {
            atomics.store(hdr, 1, index);
            atomics.store(hdr, 3, frame.duration);
            atomics.store(hdr, 4, nonZero);
            atomics.store(hdr, 5, sum);
        } else {
            hdr[1] = index;
            hdr[3] = frame.duration;
            hdr[4] = nonZero;
            hdr[5] = sum;
        }
        item.lastWritten = index;
        if (atomics) { atomics.add(hdr, 2, 1); } else { hdr[2] = (hdr[2] + 1) | 0; }
    }, () => {
        item.pending = false;
        item.errors++;
        if (item.errors >= 8) { item.playing = false; }
    });
}

// 响应入缓存：包住 host.send，带 id 的成功响应按类型过滤自动入缓存
//（decoded/decoded-batch/error 不存 —— 见上方注释；channel-stats-reply 也不存 ——
// 重传必须拿到新计数，回旧快照会让诊断自欺）。
const wireSend = host.send.bind(host);
(host as { send: HostContext['send'] }).send = (message, transfer) => {
    const msg = message as { id?: unknown; t?: unknown };
    if (typeof msg.t === 'string') {
        channelSent[msg.t] = (channelSent[msg.t] || 0) + 1;
    }
    if (typeof msg.id === 'number' && typeof msg.t === 'string'
        && msg.t !== 'error' && msg.t !== 'decoded' && msg.t !== 'decoded-batch'
        && msg.t !== 'overlay-stats' && msg.t !== 'channel-stats-reply' && msg.t !== 'auto-state') {
        // auto-state 不缓存：重传须重新执行取新状态（seek/start 幂等，重执行无副作用；
        // 回旧快照会让主线程拿到过时的播放态 —— 与 channel-stats-reply 同款理由）。
        // id 为 number 的只可能是带 id 的请求响应（overlay-stats 无 id，上面已排除）。
        rememberResponse(msg.id, message as WorkerResponse);
    }
    wireSend(message, transfer);
};

host.register((raw) => {
    const request = raw as WorkerRequest | WorkerOverlayNote;
    if (!request || typeof request !== 'object' || typeof request.t !== 'string') { return; }

    // 诊断计数在 ARQ 门之前：计「到达 handler 的原始消息」，与主线程发送侧对差。
    channelReceived[request.t] = (channelReceived[request.t] || 0) + 1;
    channelLastReceivedMs = workerNow();

    // ARQ 重传幂等门：非 decode 类请求按 id 查缓存 —— 命中说明是重传（原响应在途中
    // 丢失），直接重发历史响应、不重复执行。decode/decode-batch 天然幂等走重执行。
    const reqId = (request as { id?: unknown }).id;
    if (typeof reqId === 'number' && request.t !== 'decode' && request.t !== 'decode-batch') {
        const cached = responseCache.get(reqId);
        if (cached !== undefined) {
            responseCache.delete(reqId);
            responseCache.set(reqId, cached);   // 重插队尾，维持 LRU 新鲜度
            host.send(cached);
            return;
        }
    }

    switch (request.t) {
        case 'open': {
            try {
                const perf = (globalThis as { performance?: { now?: () => number } }).performance;
                const t0 = typeof perf?.now === 'function' ? perf.now() : Date.now();
                // 旧版微信 worker 的 postMessage 是 JSON 拷贝：typed array 过线会被序列化器
                // 弄坏（实测拿到空壳，报 "APNG: missing IHDR chunk"）。发送侧对 transfers=false
                // 的宿主一律改发 b64 字符串；这里 normalizeBytes 把 Uint8Array / b64 / number[]
                // 三种形态统一还原，认不出则走既有 error 回复。
                const cached = request.sourceKey !== undefined
                    ? sourceCache.get(request.sourceKey) : undefined;
                const bytes = cached || normalizeBytes(request.bytes);
                if (!bytes || bytes.byteLength === 0) {
                    // 引用 open（bytes 空 + sourceKey）未命中 —— 注意 normalizeBytes('')
                    // 是空 Uint8Array（truthy），必须按 byteLength 判。回 sourceMiss，
                    // 主线程 service 层自动全量重发。
                    if (request.sourceKey !== undefined) {
                        host.send({
                            t: 'opened',
                            id: request.id,
                            handle: request.handle,
                            width: 0,
                            height: 0,
                            frameCount: 0,
                            loopCount: 0,
                            sharedBuffer: null,
                            sourceMiss: true,
                            computeMs: 0,
                        });
                        break;
                    }
                    throw new Error('open bytes 过线后无法识别（宿主序列化损坏了载荷）');
                }
                if (request.sourceKey !== undefined) { rememberSource(request.sourceKey, bytes); }
                const decoder = createDecoder(bytes, request.mime);
                let sharedBuffer: ArrayBufferLike | null = null;
                let sharedRequestBytes: number | undefined;
                if (request.shared && decoder.width > 0 && decoder.height > 0) {
                    const wanted = SHARED_HEADER_BYTES + decoder.width * decoder.height * 4;
                    sharedBuffer = allocateShared(wanted);
                    // worker 侧无 SAB 构造器（2026-09 真机实证的微信 V2 灰度形态：通道真共享、
                    // 构造器只在主线程）时不直接放弃 —— 回报建议字节数，主线程分配后经
                    // attach-shared 送回绑定；通道假共享由主线程写-读探针照旧筛出。
                    if (!sharedBuffer) { sharedRequestBytes = wanted; }
                }
                const computeMs = (typeof perf?.now === 'function' ? perf.now() : Date.now()) - t0;
                entries.set(request.handle, {
                    decoder,
                    sharedBuffer,
                    sharedView: sharedBuffer ? new Uint8Array(sharedBuffer, SHARED_HEADER_BYTES) : null,
                    sharedHeader: sharedBuffer ? new Uint8Array(sharedBuffer, 0, SHARED_HEADER_BYTES) : null,
                    sharedHeaderInt32: sharedBuffer ? new Int32Array(sharedBuffer, 0, SHARED_HEADER_BYTES / 4) : null,
                });
                // 注意：SAB 不进 transfer 列表（它「可共享」而非「可转移」，放进去浏览器直接
                // DataCloneError）。它随消息体 structured clone 即可完成共享；克隆型宿主会拿到
                // 一份不共享的副本 —— 主线程的写-读探针负责把这种情况筛出来。
                host.send({
                    t: 'opened',
                    id: request.id,
                    handle: request.handle,
                    width: decoder.width,
                    height: decoder.height,
                    frameCount: decoder.frameCount,
                    loopCount: decoder.loopCount,
                    sharedBuffer,
                    sharedRequestBytes,
                    computeMs,
                });
                // 注：sourceMiss 分支在上面 bytes 判空处提前 break，带字节的 open 走到这里
                // 一定是命中/全量路径。
            } catch (e) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            }
            break;
        }

        case 'probe': {
            const entry = entries.get(request.handle);
            if (!entry || !entry.sharedBuffer) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: `handle ${request.handle} 没有共享内存` });
                break;
            }
            // header 视图用 entry.sharedHeader：整块形态 = buffer 偏移 0，arena 形态 = 本实例
            // slot 头（arena 偏移 0 是别的实例的地盘，现场建视图会探错对象）。
            const header = entry.sharedHeader
                || new Uint8Array(entry.sharedBuffer, 0, SHARED_HEADER_BYTES);
            // 多点探针：像素区逐点回读（单字节 header 探针探不出大面积映射错乱）。
            if (Array.isArray(request.positions) && entry.sharedView) {
                const seenValues: number[] = [];
                for (const p of request.positions) {
                    seenValues.push(typeof p === 'number' && p >= 0 && p < entry.sharedView.length
                        ? entry.sharedView[p] : -1);
                }
                host.send({ t: 'probed', id: request.id, handle: request.handle, seen: header[0], seenValues });
                break;
            }
            host.send({ t: 'probed', id: request.id, handle: request.handle, seen: header[0] });
            break;
        }

        case 'attach-shared': {
            // 主线程分配回退：worker 侧分配不了 SAB 时，主线程 new 完经这条消息送回。
            // 收方形态校验是第一道门 —— JSON 拷贝宿主会把 SAB 序列化成无 byteLength 的
            // 空壳，直接建视图必抛；回 error 让主线程落既有 copy 降级出口（同探针失败）。
            try {
                const entry = entries.get(request.handle);
                if (!entry) { throw new Error(`unknown handle ${request.handle}`); }
                if (entry.sharedBuffer) { throw new Error(`handle ${request.handle} 已绑定共享内存`); }
                const expected = SHARED_HEADER_BYTES + entry.decoder.width * entry.decoder.height * 4;

                if (request.offset !== undefined) {
                    // arena 形态：单块大 SAB 按 slot 分区。首次带 buffer（缓存引用），
                    // 后续只带 offset/length —— SAB 对象过线从 N 次降为 1 次。
                    if (request.buffer) {
                        const alen = (request.buffer as { byteLength?: unknown }).byteLength;
                        if (typeof alen !== 'number' || alen <= 0) {
                            throw new Error('attach-shared 的 arena 引用过线后不可用（宿主序列化损坏了载荷）');
                        }
                        arenaBuffer = request.buffer;
                    }
                    if (!arenaBuffer) {
                        throw new Error('attach-shared arena 引用缺失（首次 attach 必须带 buffer）');
                    }
                    const off = request.offset;
                    const len = request.length;
                    if (typeof len !== 'number' || len !== expected) {
                        throw new Error(`attach-shared slot 长度不符（收到 ${len}，期望 ${expected}）`);
                    }
                    if (off < 0 || off + len > (arenaBuffer as { byteLength: number }).byteLength) {
                        throw new Error(`attach-shared slot 越界（offset=${off} + length=${len} > arena ${(arenaBuffer as { byteLength: number }).byteLength}）`);
                    }
                    entry.sharedBuffer = arenaBuffer;
                    entry.sharedHeader = new Uint8Array(arenaBuffer, off, SHARED_HEADER_BYTES);
                    entry.sharedView = new Uint8Array(arenaBuffer, off + SHARED_HEADER_BYTES, len - SHARED_HEADER_BYTES);
                    entry.sharedHeaderInt32 = new Int32Array(arenaBuffer, off, SHARED_HEADER_BYTES / 4);
                    host.send({ t: 'attached-shared', id: request.id, handle: request.handle });
                    break;
                }

                const len = request.buffer ? (request.buffer as { byteLength?: unknown }).byteLength : undefined;
                if (typeof len !== 'number' || len <= 0) {
                    throw new Error('attach-shared 的 buffer 过线后不可用（宿主序列化损坏了载荷）');
                }
                if (len !== expected) {
                    throw new Error(`attach-shared 字节数不符（收到 ${len}，期望 ${expected}）`);
                }
                entry.sharedBuffer = request.buffer;
                entry.sharedHeader = new Uint8Array(request.buffer, 0, SHARED_HEADER_BYTES);
                entry.sharedView = new Uint8Array(request.buffer, SHARED_HEADER_BYTES);
                entry.sharedHeaderInt32 = new Int32Array(request.buffer, 0, SHARED_HEADER_BYTES / 4);
                host.send({ t: 'attached-shared', id: request.id, handle: request.handle });
            } catch (e) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            }
            break;
        }

        case 'decode': {
            const entry = entries.get(request.handle);
            if (!entry) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: `unknown handle ${request.handle}` });
                break;
            }
            const perf = (globalThis as { performance?: { now?: () => number } }).performance;
            const t0 = typeof perf?.now === 'function' ? perf.now() : Date.now();
            entry.decoder.decodeFrame(request.index).then((frame) => {
                const t1 = typeof perf?.now === 'function' ? perf.now() : Date.now();
                const computeMs = t1 - t0;
                if (entry.sharedView) {
                    // SAB 模式：像素写进共享内存，消息只带元数据 + 帧指纹（首/中/尾采样 +
                    // 非零计数 + 字节和；主线程对自家视图同口径比对 —— 每帧一次数据正确性
                    // 探针，串台发生的第一帧即暴露。一次遍历 ~0.05ms/帧，对比省下的跨线
                    // 序列化成本可忽略）。
                    entry.sharedView.set(frame.data);
                    const view = entry.sharedView;
                    const n = frame.data.byteLength;
                    const m = Math.min(view.length, n);
                    let nonZero = 0;
                    let sum = 0;
                    for (let i = 0; i < m; i++) {
                        const b = view[i];
                        if (b !== 0) { nonZero++; }
                        sum = (sum + b) & 0xFFFF;
                    }
                    const fp = m > 0
                        ? [view[0], view[m >> 1], view[m - 1], n, nonZero, sum]
                        : [0, 0, 0, n, nonZero, sum];
                    host.send({
                        t: 'decoded',
                        id: request.id,
                        handle: request.handle,
                        index: request.index,
                        duration: frame.duration,
                        fp,
                        computeMs,
                    });
                } else if (host.transfers) {
                    // 浏览器 copy 模式：slice 出独立副本再 transfer。直接 transfer frame.data
                    // 会 detach 解码器内部缓存的那份（同一个 buffer），seek 回读会拿到零长数组。
                    const payload = frame.data.slice();
                    host.send({
                        t: 'decoded',
                        id: request.id,
                        handle: request.handle,
                        index: request.index,
                        duration: frame.duration,
                        data: payload,
                        computeMs,
                    }, payload.buffer as ArrayBuffer);
                } else {
                    // 旧版微信 copy 模式：postMessage 是 JSON 拷贝，typed array 过线同样会被
                    // 弄坏 —— 一律 b64 字符串（主线程 decode() 里 normalizeBytes 还原）。
                    host.send({
                        t: 'decoded',
                        id: request.id,
                        handle: request.handle,
                        index: request.index,
                        duration: frame.duration,
                        data: bytesToB64(frame.data),
                        computeMs,
                    });
                }
            }, (e) => {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            });
            break;
        }

        case 'decode-batch': {
            const entry = entries.get(request.handle);
            if (!entry) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: `unknown handle ${request.handle}` });
                break;
            }
            if (entry.sharedView) {
                // SAB 模式主线程不会发批量请求（消息本就只有元数据）；发来也算协议误用。
                host.send({ t: 'error', id: request.id, handle: request.handle, message: 'decode-batch 仅 copy 模式' });
                break;
            }
            // 顺序解码 [from, end)：APNG 顺序合成状态依赖帧序，不得乱序/并发。
            const perf = (globalThis as { performance?: { now?: () => number } }).performance;
            const total = entry.decoder.frameCount;
            const from = Math.max(0, request.from | 0);
            const end = Math.min(total, from + Math.max(1, request.count | 0));
            const frames: Array<{ index: number; duration: number; data?: Uint8Array | string; computeMs: number }> = [];
            const transferBuffers: ArrayBuffer[] = [];
            const step = (index: number): Promise<void> => {
                if (index >= end) { return Promise.resolve(); }
                const t0 = typeof perf?.now === 'function' ? perf.now() : Date.now();
                return entry.decoder.decodeFrame(index).then((frame) => {
                    const computeMs = (typeof perf?.now === 'function' ? perf.now() : Date.now()) - t0;
                    if (host.transfers) {
                        // 浏览器：slice 独立副本再 transfer（同单帧路径，防 detach 解码器内部缓存）。
                        const payload = frame.data.slice();
                        transferBuffers.push(payload.buffer as ArrayBuffer);
                        frames.push({ index, duration: frame.duration, data: payload, computeMs });
                    } else {
                        // 旧版微信 copy：一帧一条 b64，K 条合在同一响应里 = 消息数砍到 1/K。
                        frames.push({ index, duration: frame.duration, data: bytesToB64(frame.data), computeMs });
                    }
                    return step(index + 1);
                });
            };
            step(from).then(() => {
                host.send({ t: 'decoded-batch', id: request.id, handle: request.handle, from, frames },
                    transferBuffers.length ? transferBuffers : undefined);
            }, (e) => {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            });
            break;
        }

        case 'close': {
            const entry = entries.get(request.handle);
            if (entry) {
                entries.delete(request.handle);
                try {
                    entry.decoder.destroy();
                } catch (e) {
                    // destroy 失败无需上报：条目已删除，主线程也不会再用这个 handle。
                }
            }
            // 防御：close 打到已 attach 的 handle 时同步注销合成条目（幂等），避免 worker
            // 侧时钟继续画一个解码器已销毁的条目。自驱条目同理注销。
            if (overlay) { overlay.detach(request.handle); }
            autoItems.delete(request.handle);
            host.send({ t: 'closed', id: request.id, handle: request.handle });
            break;
        }

        // 通道诊断快照（见 channelReceived 注释）：spread 拷贝防后续计数串进已发出的快照。
        case 'channel-stats': {
            let autoPlaying = 0;
            let autoErrors = 0;
            for (const it of autoItems.values()) {
                if (it.playing) { autoPlaying++; }
                autoErrors += it.errors;
            }
            host.send({
                t: 'channel-stats-reply',
                id: request.id,
                receivedByType: { ...channelReceived },
                sentByType: { ...channelSent },
                lastReceivedMs: channelLastReceivedMs,
                nowMs: workerNow(),
                // 自驱引擎健康快照：真机上时钟死没死、死在哪（ticker/拍数/播放条目），
                // 主线程 [channel] 行直接打出 —— 不用再猜（worker console 不透传 vConsole）。
                auto: {
                    ticker: autoTickerKind,
                    rafDead: autoRafDead,
                    rafProven: autoRafProven,
                    running: autoRunning,
                    pending: autoPending,
                    ticks: autoTickCount,
                    items: autoItems.size,
                    playing: autoPlaying,
                    errors: autoErrors,
                },
            });
            break;
        }

        // --- overlay 合成（worker-offscreen 变体）。请求带 id 有回执；通知无 id 单向。 ---

        case 'overlay-canvas': {
            try {
                if (!overlay) { overlay = createOverlayCompositor(); }
                const ticker = overlay.bind(request.canvas, request.width, request.height,
                    (note) => { host.send(note); });
                host.send({ t: 'overlay-canvas-bound', id: request.id, ticker });
            } catch (e) {
                host.send({ t: 'error', id: request.id, message: errorMessage(e) });
            }
            break;
        }

        case 'overlay-attach': {
            try {
                if (!overlay) { throw new Error('overlay 未 bind canvas 就 attach'); }
                const entry = entries.get(request.handle);
                if (!entry) { throw new Error(`unknown handle ${request.handle}`); }
                overlay.attach(request.handle, entry.decoder, request.rect, request.playing, request.loop);
                host.send({ t: 'overlay-attached', id: request.id, handle: request.handle });
            } catch (e) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            }
            break;
        }

        case 'overlay-resize': {
            if (overlay) { overlay.resize(request.width, request.height); }
            break;
        }

        case 'overlay-update': {
            if (overlay) { overlay.update(request.rects); }
            break;
        }

        case 'overlay-set-state': {
            if (overlay) { overlay.setState(request.handle, request.playing, request.loop); }
            break;
        }

        case 'overlay-detach': {
            if (overlay) { overlay.detach(request.handle); }
            const entry = entries.get(request.handle);
            if (entry) {
                entries.delete(request.handle);
                try {
                    entry.decoder.destroy();
                } catch (e) {
                    // 同 close：条目已删，destroy 失败无需上报。
                }
            }
            autoItems.delete(request.handle);
            break;
        }

        // --- 自驱解码（worker-auto 变体）：每帧零消息，只有起停/跳帧控制往返。
        //     响应 auto-state 不入缓存（见 wireSend），重传走重执行 —— start/seek 幂等。 ---

        case 'auto-start': {
            try {
                const item = ensureAutoItem(request.handle);
                item.loop = request.loop;
                item.playing = request.playing;
                if (request.playing) {
                    if (!autoRunning) {
                        autoRunning = true;
                        autoLastMs = workerNow();
                    }
                    autoScheduleNext();
                } else if (item.lastWritten < 0) {
                    autoEnsureFrame(item, item.currentFrame);   // 停止态也要有首帧可看
                }
                host.send({ t: 'auto-state', id: request.id, handle: request.handle,
                    playing: item.playing, index: item.currentFrame });
            } catch (e) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            }
            break;
        }

        case 'auto-seek': {
            try {
                const item = ensureAutoItem(request.handle);
                const total = entries.get(request.handle)!.decoder.frameCount;
                item.currentFrame = Math.max(0, Math.min(request.index | 0, Math.max(0, total - 1)));
                item.accumMs = 0;
                item.errors = 0;
                autoEnsureFrame(item, item.currentFrame);   // 播放/暂停态都要把目标帧写上屏
                host.send({ t: 'auto-state', id: request.id, handle: request.handle,
                    playing: item.playing, index: item.currentFrame });
            } catch (e) {
                host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
            }
            break;
        }
    }
});
