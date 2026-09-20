// Worker 消息协议 —— 主线程侧（worker-transport.ts / worker-decoder.ts）与 worker 侧
// （worker/decoder-worker.ts，经 scripts/build-worker.mjs 打成单文件 bundle）共享的唯一事实来源。
// 纯类型与常量、零依赖：这个文件同时进游戏包（runtime 挂载）和 worker bundle，两边都不能 import 'cc'。
//
// 说明：SharedArrayBuffer 的类型声明属于 ES2017 lib，部分编译目标（ES2015）没有它，
// 所以这里一律用结构化的 ArrayBufferLike —— 主线程只建 Uint8Array 视图，够用且处处可编译。

// bundle 文件名。预览：load() 把它拷进引擎 native/external/，从 /engine_external/ 下发
// （与 animated-webp.wasm 同一条链路）；web 构建：hooks 拷进产物 cocos-js/。
export const WORKER_FILE_NAME = 'animated-image-decoder.js';

// 微信小游戏：构建产物 workers/ 目录（game.json 的 "workers" 字段指向它）。
// wx.createWorker 要**相对小游戏根的完整路径**（官方示例 'workers/request/index.js'，
// 即带 workers 前缀）—— 只传目录内相对路径时开发者工具找不到入口，落到兜底引导，
// 收到消息才 require 模块并报 "module 'xxx' is not defined"（2026-09 实证）。
export const WX_WORKERS_ROOT = 'workers';
export const WX_WORKER_SCRIPT = `${WX_WORKERS_ROOT}/animated-image/decoder.js`;

// worker 里能解码的格式。WebP 留在主线程（worker 目录只能放 JS，wasm 进不去；
// 静态 PNG/JPEG 单帧解码不值得跨线程）。
export const WORKER_SUPPORTED_MIMES = ['image/apng', 'image/gif'];

// SharedArrayBuffer 帧缓冲的头部保留区（Int32Array 字 0..5，小端），像素从偏移 24 开始：
//   word 0（byte 0）   共享性探针 token（既有约定：主线程写、probe 回读）
//   word 1             frameIndex —— 当前像素区里是第几帧
//   word 2             frameSeq —— 发布序号：worker 每完成一次「写像素 + 更新元数据」+1，
//                      主线程轮询它，变了才上传（Atomics add/load，官方任务槽范式）
//   word 3             durationMs —— 当前帧时长（worker 时钟学习值，主线程只读展示）
//   word 4/5           帧指纹（非零字节数 / 字节和）—— 每帧一次的串台探针，主线程同口径比对
// 2026-09 拉模型时代是 4 字节；自驱变体（worker-auto）需要跨线程帧信箱才扩到 24。
export const SHARED_HEADER_BYTES = 24;

/** Atomics 的结构化形态（部分编译目标 ES2015 无类型声明；宿主没有时退回普通读写）。 */
export interface AtomicsLike {
    load (view: Int32Array, index: number): number;
    store (view: Int32Array, index: number, value: number): number;
    add (view: Int32Array, index: number, value: number): number;
}

/** 宿主 Atomics（微信 V2 灰度两端都有；没有的宿主普通读写实践上也可用：对齐 u32 无撕裂）。 */
export function getAtomics (): AtomicsLike | null {
    const a = (globalThis as { Atomics?: AtomicsLike }).Atomics;
    return a && typeof a.load === 'function' && typeof a.store === 'function' && typeof a.add === 'function'
        ? a : null;
}

export interface WorkerOpenRequest {
    t: 'open';
    id: number;
    handle: number;
    /** 源字节。浏览器宿主直传 Uint8Array（可 transfer）；JSON 拷贝宿主（旧版微信 worker）
     *  传 b64 字符串 —— typed array 过线会被序列化器弄坏（实测变普通对象，worker 侧报
     *  "APNG: missing IHDR chunk"），字符串任何序列化器都无损。
     *  带 sourceKey 且 worker 侧缓存命中时可为空串（源字节去重：同源多实例只全量过线一次，
     *  引用 open 只发一条小消息 —— 2026-09 真机实证大 b64 并发过线丢消息后的规避）。 */
    bytes: Uint8Array | string;
    mime: string;
    /** 请求 SAB 模式。worker 侧实测不可用则在响应里回 sharedBuffer: null（自动落回 copy 模式）。 */
    shared: boolean;
    /** 源内容指纹（FNV-1a hash:字节数）。带上且 worker 缓存命中 → 免传字节；未命中 worker
     *  回 sourceMiss，主线程全量重发（service 层自动，调用方零感知）。 */
    sourceKey?: string;
}

export interface WorkerDecodeRequest {
    t: 'decode';
    id: number;
    handle: number;
    index: number;
}

/** copy 模式批量解码：一次往返取 [from, from+count) 连续 K 帧。
 *  动机（2026-09 真机实测）：微信 postMessage 的每消息固定开销占传输成本绝对大头
 *  （~37KB 一帧，真机 postMsAvg 71~88ms vs Chrome 4.3ms），按 K 帧合批把消息数砍
 *  到 1/K。SAB 模式不需要（响应本就只有元数据），主线程也不会发。 */
export interface WorkerDecodeBatchRequest {
    t: 'decode-batch';
    id: number;
    handle: number;
    from: number;
    count: number;
}

export interface WorkerCloseRequest {
    t: 'close';
    id: number;
    handle: number;
}

/** 共享性探针：主线程往共享内存 header byte 0 写 token 后发送，worker 回读它看到的值。 */
export interface WorkerProbeRequest {
    t: 'probe';
    id: number;
    handle: number;
    token: number;
    /** 可选：像素区多点探针（相对像素区起点的偏移）。带上时 worker 逐点回读 sharedView[p]，
     *  seenValues 与 positions 一一对应 —— 单字节 header 探针探不出大面积映射错乱
     *  （2026-09 真机串台实证：串台实例探针通过、像素却接错缓冲），多点采样把
     *  「整块接错缓冲」筛出来。 */
    positions?: number[];
}

/** 主线程分配回退（2026-09 真机实证的微信 V2 灰度形态：worker 侧无 SAB 构造器、
 *  主线程有，通道却真共享——主→工方向写读互见）。open(shared) 时 worker 分配不了就
 *  在 opened 里回 sharedRequestBytes，主线程 new SharedArrayBuffer 后经这条请求送回绑定。
 *  buffer 随消息体共享（SAB「可共享」非「可转移」，不进 transfer 列表）；JSON 拷贝宿主
 *  会把它序列化成空壳 —— worker 侧形态校验拒绝回 error，主线程落既有 copy 降级出口。
 *
 *  两种绑定形态：
 *    整块（老形态）：buffer = 恰好 4 + w*h*4 的独立 SAB，每实例一块。
 *    arena（2026-09 实验形态）：全进程单块大 SAB 按 slot 分区（每 slot = 4B header +
 *      像素区）。首次 attach 带 buffer（arena 引用）+ offset/length；后续 attach 只带
 *      offset/length（worker 已缓存 arena 引用，SAB 对象过线从 N 次降为 1 次）——
 *      检验「多块 SAB 是否为通道丢消息的触发因子」的单变量实验。 */
export interface WorkerAttachSharedRequest {
    t: 'attach-shared';
    id: number;
    handle: number;
    /** 整块形态必带；arena 形态仅首次带（后续缺省，worker 用缓存引用）。 */
    buffer?: ArrayBufferLike;
    /** arena 形态：本实例 slot 在 arena 里的字节偏移（含 4B header）。 */
    offset?: number;
    /** arena 形态：slot 总长（= 4 + w*h*4）。 */
    length?: number;
}

// --- overlay 合成协议（worker-offscreen 变体，纯加法） ---
// 变体目标：worker 不只解码，还直接把帧画到一块「就是最终显示面」的 OffscreenCanvas
// （主线程 DOM overlay canvas 经 transferControlToOffscreen 后 transfer 过线），主线程
// 每帧成本归零 —— 没有每帧 postMessage 载荷、没有 texture.uploadData、动图不进引擎渲染。
// 只有浏览器宿主走这条链路（微信 V2 未灰度：transfer 列表被拒，主线程能力门会拦住）；
// worker 侧错误出口即「后端插槽」：未 bind 就 attach / 未知 handle / 无 2d ctx / 无 ticker
// 都回既有 error 响应，主线程收到后会话级 broken 并把全部实例降级 Sprite+AnimatedImage。
//
// 消息分三类：
//   请求（main→worker，带 id 进往返泵）：overlay-canvas（canvas 走 transfer 列表）、
//     overlay-attach（handle 必须已 open —— 复用同一 decoder worker，解码+合成一体）。
//   单向通知（main→worker，无 id 不进泵）：overlay-resize（权威尺寸，worker 以此自设
//     OffscreenCanvas 宽高）/ overlay-update（resize 后全量重投影）/ overlay-set-state /
//     overlay-detach（注销+销毁解码器，不等回执，同 close 的单向语义）。
//   通知（worker→main，无 id）：overlay-stats 每 ~500ms 一条，主线程扇出成 perf 样本。
//
// 协议文件没有 DOM lib（worker tsc lib ES2018）：OffscreenCanvas 用结构化最小接口
// OverlayCanvasLike（先例：SAB 用 ArrayBufferLike）；绘制相关接口在 worker 侧
// overlay-compositor.ts 里自声明。

/** 结构化的 OffscreenCanvas 最小形态（协议层只关心尺寸；绘制接口由 worker 侧自声明）。 */
export interface OverlayCanvasLike {
    width: number;
    height: number;
}

/** overlay 上的动图矩形（px，OffscreenCanvas 坐标系，左上原点）。 */
export interface OverlayRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** overlay-update 的全量重投影条目（resize 后主线程把所有实例矩形一次性重发）。 */
export interface OverlayPlacement {
    handle: number;
    rect: OverlayRect;
}

/** 把主线程 DOM overlay canvas 的控制权 transfer 给 worker（一次性；重复 bind 回 error）。
 *  canvas 走 postMessage transfer 列表过线；width/height 是权威 backing-store 尺寸
 *  （物理像素），worker 以此自设 OffscreenCanvas 宽高。 */
export interface WorkerOverlayCanvasRequest {
    t: 'overlay-canvas';
    id: number;
    canvas: OverlayCanvasLike;
    width: number;
    height: number;
}

/** 把一个已 open 的动图挂上 overlay 合成（帧号由 worker 自驱时钟推进）。 */
export interface WorkerOverlayAttachRequest {
    t: 'overlay-attach';
    id: number;
    handle: number;
    rect: OverlayRect;
    playing: boolean;
    loop: boolean;
}

/** resize 权威尺寸：worker 收到即重设 OffscreenCanvas 宽高（会清空画布）并全量重画。 */
export interface WorkerOverlayResizeNote {
    t: 'overlay-resize';
    width: number;
    height: number;
}

export interface WorkerOverlayUpdateNote {
    t: 'overlay-update';
    rects: OverlayPlacement[];
}

/** 暂停保留当前帧（playing=false 时钟停走，当前帧继续上屏）。 */
export interface WorkerOverlaySetStateNote {
    t: 'overlay-set-state';
    handle: number;
    playing: boolean;
    loop?: boolean;
}

/** 注销 + 销毁解码器（单向通知，不等回执）。 */
export interface WorkerOverlayDetachNote {
    t: 'overlay-detach';
    handle: number;
}

/** overlay 合成心跳（worker→main，每 ~500ms 一条，零帧窗口不推）。
 *  decodeMs 每条 = 该帧「decodeFrame → ImageData → createImageBitmap」的 worker 侧墙钟
 *  （offscreen 档的 taskMs 口径 = 解码+位图化，见 tools/PERF.md；主线程扇出样本时再加
 *  compositeMs/frames 摊销，postMs 恒 0 属设计 —— 没有每帧过线）。framesByHandle 回写
 *  组件 currentFrame（鸭子接口）。 */
export interface WorkerOverlayStatsNote {
    t: 'overlay-stats';
    frames: number;
    decodeMs: number[];
    compositeMs: number;
    errors: number;
    framesByHandle?: { [handle: number]: number };
}

/** 全部单向通知（两个方向的 note；请求/响应走各自的联合类型，均不含 id）。 */
export type WorkerOverlayNote =
    WorkerOverlayResizeNote | WorkerOverlayUpdateNote | WorkerOverlaySetStateNote
    | WorkerOverlayDetachNote | WorkerOverlayStatsNote;

/** 通道诊断快照请求（定位丢消息方向）：worker 回报两侧逐类型计数 + 最近收包时刻。
 *  主线程同样逐类型计数，两侧对差 = 各方向的到达缺口。不入响应缓存（重传须拿到新计数）。 */
export interface WorkerChannelStatsRequest {
    t: 'channel-stats';
    id: number;
}

// --- 自驱解码协议（worker-auto 变体，方案 C） ---
// 播放时钟搬进 worker：worker 自驱解码、直接写 SAB slot 并推进 header 帧序号（word 2，
// Atomics add），主线程每引擎帧轮询序号、变了才 uploadData —— 每帧零消息。通道只剩
// 本组 O(1) 控制消息（2026-09 真机定案：持续满载 ~10k 累计请求后通道整体楔死，
// per-frame 拉模型是消息量根源，见 tools/wx-worker-v2-feedback.md P0-1b）。

/** 起停合一：playing=true 开始/继续自驱（worker 起 ticker），false 暂停（停钟，当前帧
 *  保留在共享内存继续可读）。loop 随每次调用可变。响应 auto-state。 */
export interface WorkerAutoStartRequest {
    t: 'auto-start';
    id: number;
    handle: number;
    playing: boolean;
    loop: boolean;
}

/** 跳帧（播放/暂停态都可）：目标帧解码后写进共享内存并推帧序号 —— 暂停态 seek 也能
 *  上屏（主线程轮询不依赖播放态）。响应 auto-state。 */
export interface WorkerAutoSeekRequest {
    t: 'auto-seek';
    id: number;
    handle: number;
    index: number;
}

/** auto-start / auto-seek 的统一回执（当前播放态 + 帧号）。不入响应缓存 —— 重传须
 *  重新执行取新状态（seek/start 均幂等，重执行无副作用）。 */
export interface WorkerAutoStateResponse {
    t: 'auto-state';
    id: number;
    handle: number;
    playing: boolean;
    index: number;
}

export type WorkerRequest =
    WorkerOpenRequest | WorkerDecodeRequest | WorkerDecodeBatchRequest
    | WorkerCloseRequest | WorkerProbeRequest | WorkerAttachSharedRequest
    | WorkerChannelStatsRequest
    | WorkerOverlayCanvasRequest | WorkerOverlayAttachRequest
    | WorkerAutoStartRequest | WorkerAutoSeekRequest;

export interface WorkerOpenedResponse {
    t: 'opened';
    id: number;
    handle: number;
    width: number;
    height: number;
    frameCount: number;
    loopCount: number;
    /** 非 null = worker 接受 SAB 模式，此后 decoded 响应不带像素数据（帧写进共享内存）。 */
    sharedBuffer: ArrayBufferLike | null;
    /** open 请求了 shared 但 worker 侧分配不了（无 SAB 构造器）时的回退字段：
     *  建议主线程分配并 attach 回来的字节数（SHARED_HEADER_BYTES + w*h*4）。
     *  worker 自己分配成功时缺省；copy 模式恒缺省。 */
    sharedRequestBytes?: number;
    /** true = sourceKey 引用未命中（worker 侧无该源缓存），主线程须全量重发。
     *  此响应不建条目；命中时恒缺省。 */
    sourceMiss?: boolean;
    /** worker 侧构建解码器 + 分配 SAB 的耗时（ms），perf 采样桥接用；缺失按 0 处理。 */
    computeMs: number;
}

export interface WorkerDecodedResponse {
    t: 'decoded';
    id: number;
    handle: number;
    index: number;
    duration: number;
    /** 仅 copy 模式携带像素（浏览器 = Uint8Array 直传，旧版微信 worker = b64 字符串）；
     *  SAB 模式恒为 undefined。收方用 normalizeBytes 归一化。 */
    data?: Uint8Array | string;
    /** SAB 模式帧指纹 [首字节, 中点字节, 尾字节, 帧字节数, 非零字节数, 字节和 mod 65536]：
     *  worker 写入共享内存后在自己那份视图上采样；主线程对自家视图同口径计算比对 ——
     *  每帧都是一次数据正确性探针，串台（共享内存实际接着别的缓冲，如 b64 文本）发生的
     *  第一帧即暴露。透明背景样本首/中/尾常全零，单靠采样点区分力不足 —— 非零密度 +
     *  校验和把「接到别的内容」的漏检压到 ~1/65536。copy 模式恒缺省。 */
    fp?: number[];
    /** worker 侧纯解码耗时（ms）——与主线程往返耗时相减即得传输开销，A/B 对比用。 */
    computeMs: number;
}

/** 批量响应里的单帧条目。data 形态同单帧 copy 模式（浏览器 = Uint8Array 可 transfer；
 *  旧版微信 = b64 字符串）；computeMs 为该帧纯解码耗时，口径与单帧 decode 一致。 */
export interface WorkerDecodedFrame {
    index: number;
    duration: number;
    data?: Uint8Array | string;
    computeMs: number;
}

export interface WorkerDecodedBatchResponse {
    t: 'decoded-batch';
    id: number;
    handle: number;
    from: number;
    frames: WorkerDecodedFrame[];
}

export interface WorkerProbedResponse {
    t: 'probed';
    id: number;
    handle: number;
    /** worker 在自己那份共享内存 header 里读到的字节值；与 token 不符说明传输把它 clone 了。 */
    seen: number;
    /** positions 多点探针的逐点回读值（与请求 positions 一一对应；未发 positions 时缺省）。
     *  非法偏移（越界/非数）回 -1 —— 与合法值 0-255 可区分。 */
    seenValues?: number[];
}

export interface WorkerAttachSharedResponse {
    t: 'attached-shared';
    id: number;
    handle: number;
}

export interface WorkerClosedResponse {
    t: 'closed';
    id: number;
    handle: number;
}

export interface WorkerErrorResponse {
    t: 'error';
    id: number;
    handle?: number;
    message: string;
}

/** bind 成功：ticker 是 worker 侧自驱时钟的选择（rAF 不可用的宿主走 setTimeout 兜底）。 */
export interface WorkerOverlayCanvasBoundResponse {
    t: 'overlay-canvas-bound';
    id: number;
    ticker: 'raf' | 'timeout';
}

export interface WorkerOverlayAttachedResponse {
    t: 'overlay-attached';
    id: number;
    handle: number;
}

export interface WorkerChannelStatsResponse {
    t: 'channel-stats-reply';
    id: number;
    /** worker 收到的逐类型消息数（handler 入口计，含通知）。 */
    receivedByType: { [t: string]: number };
    /** worker 发出的逐类型消息数（send 包裹层计，含 error/通知）。 */
    sentByType: { [t: string]: number };
    /** worker 侧最近一次收到主线程消息的时刻（与 nowMs 同域，ms）。 */
    lastReceivedMs: number;
    /** 快照时刻。nowMs - lastReceivedMs = worker 收包空闲时长（判「整体断流」vs「零星丢」）。 */
    nowMs: number;
    /** 自驱引擎健康快照（worker-auto 变体；worker bundle 旧版/未启用时缺省）。 */
    auto?: {
        /** 当前时钟 ticker（raf 判死后为 'timeout'）。 */
        ticker: 'none' | 'raf' | 'timeout';
        /** rAF 存在但从不回调的宿主（wx V2 真机形态）已判死。 */
        rafDead: boolean;
        /** rAF 回调过至少一次（会话级信任）。 */
        rafProven: boolean;
        running: boolean;
        /** 一拍在途（长时间 true 且 ticks 不涨 = 时钟挂死）。 */
        pending: boolean;
        /** 时钟累计拍数。 */
        ticks: number;
        /** 自驱条目数。 */
        items: number;
        /** 播放中条目数。 */
        playing: number;
        /** 条目累计解码失败数。 */
        errors: number;
    };
}

export type WorkerResponse =
    WorkerOpenedResponse | WorkerDecodedResponse | WorkerDecodedBatchResponse
    | WorkerProbedResponse | WorkerAttachSharedResponse | WorkerClosedResponse
    | WorkerChannelStatsResponse
    | WorkerErrorResponse | WorkerOverlayCanvasBoundResponse | WorkerOverlayAttachedResponse
    | WorkerAutoStateResponse;

// --- JSON-safe 字节编解码（旧版微信 worker 专用） ---
// 旧版（非 V2）worker 的 postMessage 走 JSON 拷贝：Uint8Array/ArrayBuffer 过线后变成普通
// 对象（实测 worker 侧拿到空壳，报 "APNG: missing IHDR chunk"）；SharedArrayBuffer 同样被
// 序列化成 {} —— 真 SAB 只存在于 V2 / structured-clone 宿主。transfers=false 的宿主上跨线
// 字节一律 b64 字符串（字符串对任何序列化器无损），浏览器宿主仍走原生 typed array + transfer，
// 零编码开销。两侧共用 normalizeBytes 自动识别形态，不需要协商开关。

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64 (bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const v = (b0 << 16) | (b1 << 8) | b2;
        out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63]
            + (i + 1 < bytes.length ? B64_ALPHABET[(v >> 6) & 63] : '=')
            + (i + 2 < bytes.length ? B64_ALPHABET[v & 63] : '=');
    }
    return out;
}

export function b64ToBytes (text: string): Uint8Array {
    const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
    // 尾组：剩 2 字符 = 1 字节，剩 3 字符 = 2 字节（'=' 已被过滤；剩 1 字符是非法输入，忽略）。
    const rem = clean.length % 4;
    const full = clean.length - rem;
    const out = new Uint8Array(full / 4 * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0));
    const idx = (i: number): number => B64_ALPHABET.indexOf(clean[i]);
    let p = 0;
    for (let i = 0; i < full; i += 4) {
        const v = (idx(i) << 18) | (idx(i + 1) << 12) | (idx(i + 2) << 6) | idx(i + 3);
        out[p++] = (v >> 16) & 0xff;
        out[p++] = (v >> 8) & 0xff;
        out[p++] = v & 0xff;
    }
    if (rem === 2) {
        const v = (idx(full) << 18) | (idx(full + 1) << 12);
        out[p++] = (v >> 16) & 0xff;
    } else if (rem === 3) {
        const v = (idx(full) << 18) | (idx(full + 1) << 12) | (idx(full + 2) << 6);
        out[p++] = (v >> 16) & 0xff;
        out[p++] = (v >> 8) & 0xff;
    }
    return out.subarray(0, p);
}

/** 收方归一化：Uint8Array（浏览器直传）/ b64 字符串（旧版微信）/ number[]（兜底）→ Uint8Array；不可识别返回 null。 */
export function normalizeBytes (value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) { return value; }
    if (typeof value === 'string') { return b64ToBytes(value); }
    if (Array.isArray(value)) {
        const out = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) { out[i] = value[i] & 0xff; }
        return out;
    }
    return null;
}
