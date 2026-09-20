// overlay 合成器（worker 侧）—— worker-offscreen 变体的渲染后端。
//
// 被 decoder-worker.ts 引用（rollup 自动并入 bundle），**零顶层副作用**：模块加载只有
// 函数与类型定义，所有状态都在 createOverlayCompositor() 的闭包里，而工厂本身也要等到
// 主线程第一条 overlay-canvas 请求到达才被调用；宿主能力探测（requestAnimationFrame /
// setTimeout / createImageBitmap / ImageData / OffscreenCanvas / performance.now）全部
// 推迟到 bind/绘制内部 —— 未启用变体时这个文件对既有四档解码路径的行为零影响。
//
// 职责：持有 transfer 过线的 OffscreenCanvas，自驱时钟推进每个动图的帧号（推进语义与
// runtime/AnimatedImagePlayer.tick 同构：时长未知先解码学时长、单飞解码、guard 防零时长
// 死循环、非循环播完停末帧），按需解码 + ImageData → createImageBitmap 位图化（全缓存
// 不淘汰，对齐 copy 档主线程帧缓存口径），脏检测后整帧 clearRect + 全员 drawImage。
// 主线程每帧成本归零：没有每帧 postMessage、没有纹理上传，动图不进引擎渲染。
//
// worker 上下文没有 DOM lib：宿主全局一律 globalThis 探测 + 下列结构化最小类型。

import type { IAnimatedImageDecoder } from '../runtime/types';
import type {
    OverlayCanvasLike,
    OverlayPlacement,
    OverlayRect,
    WorkerOverlayStatsNote,
} from '../runtime/worker-protocol';

// --- 结构化最小宿主类型（协议层只关心尺寸；绘制接口在这里声明） ---

/** putImageData 需要的 ImageData 形状（有 ImageData 构造器走构造器，否则 ctx.createImageData）。 */
interface ImageDataLike {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

interface Overlay2DContext {
    clearRect (x: number, y: number, w: number, h: number): void;
    drawImage (image: unknown, dx: number, dy: number, dw: number, dh: number): void;
    putImageData (data: ImageDataLike, dx: number, dy: number): void;
    createImageData? (w: number, h: number): ImageDataLike;
}

interface OverlaySurface {
    width: number;
    height: number;
    getContext (type: '2d'): Overlay2DContext | null;
}

/** drawImage 可吃的位图源（ImageBitmap 或兜底路径里的临时 OffscreenCanvas）。 */
interface BitmapSource {
    width: number;
    height: number;
}

interface HostGlobals {
    requestAnimationFrame?: (callback: (ts: number) => void) => unknown;
    setTimeout?: (callback: () => void, ms: number) => unknown;
    performance?: { now?: () => number };
    ImageData?: new (data: Uint8ClampedArray, w: number, h: number) => ImageDataLike;
    createImageBitmap?: (source: unknown) => Promise<BitmapSource>;
    OffscreenCanvas?: new (w: number, h: number) => OverlaySurface;
}

interface OverlayItem {
    handle: number;
    decoder: IAnimatedImageDecoder;
    rect: OverlayRect;
    playing: boolean;
    loop: boolean;
    currentFrame: number;
    accumMs: number;
    /** 逐帧时长（ms），解码后学习；-1 = 未知（未知时帧号不推进，等下个 tick）。 */
    durations: number[];
    /** 帧号 → 位图，全缓存不淘汰（对齐 copy 档主线程帧缓存口径）。 */
    bitmaps: Map<number, BitmapSource>;
    /** 单飞：正在解码的帧号；null = 空闲（语义同 Player._pendingDecode）。 */
    pending: number | null;
    /** 上一次真正画上屏的帧号；-1 起。脏检测 = lastDrawn !== currentFrame 且位图就绪。 */
    lastDrawn: number;
    consecutiveErrors: number;
}

export interface OverlayCompositor {
    /** bind 主线程 transfer 过来的 canvas；失败抛错（decoder-worker 转 error 响应）。 */
    bind (canvas: OverlayCanvasLike, width: number, height: number,
        notify: (note: WorkerOverlayStatsNote) => void): 'raf' | 'timeout';
    attach (handle: number, decoder: IAnimatedImageDecoder, rect: OverlayRect, playing: boolean, loop: boolean): void;
    resize (width: number, height: number): void;
    update (placements: OverlayPlacement[]): void;
    setState (handle: number, playing: boolean, loop?: boolean): void;
    /** 只注销合成条目，不动解码器生命周期（归 decoder-worker 的 entries/close 管）；幂等。 */
    detach (handle: number): void;
}

function nowMs (): number {
    const perf = (globalThis as HostGlobals).performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/** 像素 → 位图源。首选 ImageData → createImageBitmap（GPU 位图）；缺任一则临时
 *  OffscreenCanvas putImageData 后持 canvas 当位图源；全缺则拒绝（条目记一次错误）。 */
function bitmapFromPixels (data: Uint8Array, width: number, height: number): Promise<BitmapSource> {
    const g = globalThis as HostGlobals;
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    if (typeof g.ImageData === 'function' && typeof g.createImageBitmap === 'function') {
        return g.createImageBitmap(new g.ImageData(clamped, width, height));
    }
    if (typeof g.OffscreenCanvas === 'function') {
        const tmp = new g.OffscreenCanvas(width, height);
        const ctx = tmp.getContext('2d');
        const make = (): ImageDataLike | null => {
            if (typeof g.ImageData === 'function') { return new g.ImageData(clamped, width, height); }
            if (ctx && typeof ctx.createImageData === 'function') {
                const img = ctx.createImageData(width, height);
                img.data.set(clamped);
                return img;
            }
            return null;
        };
        const img = ctx ? make() : null;
        if (ctx && img) {
            ctx.putImageData(img, 0, 0);
            return Promise.resolve(tmp as BitmapSource);
        }
    }
    return Promise.reject(new Error('worker 里没有 ImageData/createImageBitmap/OffscreenCanvas 任一可用的位图化途径'));
}

export function createOverlayCompositor (): OverlayCompositor {
    // 全部状态闭包持有：模块顶层零副作用，工厂调用前一行合成代码都不执行。
    let bound = false;
    let surface: OverlaySurface | null = null;
    let ctx: Overlay2DContext | null = null;
    let width = 1;
    let height = 1;
    let ticker: 'raf' | 'timeout' = 'raf';
    let notify: ((note: WorkerOverlayStatsNote) => void) | null = null;
    const items = new Map<number, OverlayItem>();
    let running = false;
    let lastTs = -1;
    let forceDirty = false;
    // stats 累积器：每 ~500ms 一条 overlay-stats；零帧窗口（三者全 0）不推。
    let statFrames = 0;
    let statDecodeMs: number[] = [];
    let statCompositeMs = 0;
    let statErrors = 0;
    let lastEmitMs = 0;

    const host = (): HostGlobals => globalThis as HostGlobals;

    function needsClock (): boolean {
        if (forceDirty) { return true; }
        for (const item of items.values()) {
            if (item.playing && item.decoder.frameCount > 1) { return true; }
            if (item.lastDrawn !== item.currentFrame) { return true; }
        }
        return false;
    }

    function scheduleNext (): void {
        const g = host();
        if (ticker === 'raf' && typeof g.requestAnimationFrame === 'function') {
            g.requestAnimationFrame((ts) => { tick(ts); });
        } else if (typeof g.setTimeout === 'function') {
            g.setTimeout(() => { tick(nowMs()); }, Math.max(4, Math.round(1000 / 60)));
        } else {
            running = false;
        }
    }

    function startClock (): void {
        if (!bound || running || !needsClock()) { return; }
        running = true;
        lastTs = -1;   // 重启后首拍 dt=0（上次停钟距今的空窗不计入帧时长）
        scheduleNext();
    }

    function emitStats (): void {
        if (!notify) { return; }
        if (statFrames === 0 && statDecodeMs.length === 0 && statErrors === 0) {
            lastEmitMs = nowMs();
            return;
        }
        const framesByHandle: { [handle: number]: number } = {};
        for (const item of items.values()) { framesByHandle[item.handle] = item.currentFrame; }
        notify({
            t: 'overlay-stats',
            frames: statFrames,
            decodeMs: statDecodeMs,
            compositeMs: statCompositeMs,
            errors: statErrors,
            framesByHandle,
        });
        statFrames = 0;
        statDecodeMs = [];
        statCompositeMs = 0;
        statErrors = 0;
        lastEmitMs = nowMs();
    }

    /** 帧号推进 —— 与 AnimatedImagePlayer.tick(L184-214) 同构。 */
    function advance (item: OverlayItem, dtMs: number): void {
        const frameCount = item.decoder.frameCount;
        if (frameCount <= 1) { return; }
        item.accumMs += dtMs;
        let guard = frameCount;
        while (guard-- > 0) {
            const frameDur = item.durations[item.currentFrame];
            if (frameDur < 0) {
                // 时长未知：先解码学时长，下个 tick 再推。
                ensureFrame(item, item.currentFrame);
                return;
            }
            if (item.accumMs < frameDur) { return; }
            item.accumMs -= frameDur;
            const next = item.currentFrame + 1;
            if (next >= frameCount) {
                if (item.loop) {
                    item.currentFrame = 0;
                } else {
                    item.currentFrame = frameCount - 1;
                    item.playing = false;
                    return;
                }
            } else {
                item.currentFrame = next;
            }
            ensureFrame(item, item.currentFrame);
        }
    }

    /** 全量重画：清屏 + 按各条目当前帧位图上屏（未就绪者跳过）。tick 的脏路径与
     *  解码完成路径共用 —— 后者是关键：Player 语义是「解码完成且仍为当前帧就立刻上屏」，
     *  不能等下一拍（下一拍帧号往往已推进，当前帧位图永远来不及就绪 → 一张都画不上）。 */
    function presentAll (): void {
        const t0 = nowMs();
        ctx!.clearRect(0, 0, width, height);   // 透明清屏（动图可能移动/移除，不能留残影）
        for (const item of items.values()) {
            const bitmap = item.bitmaps.get(item.currentFrame);
            if (!bitmap) { continue; }
            ctx!.drawImage(bitmap, item.rect.x, item.rect.y, item.rect.w, item.rect.h);
            item.lastDrawn = item.currentFrame;
            statFrames++;
        }
        forceDirty = false;
        statCompositeMs += nowMs() - t0;
    }

    function ensureFrame (item: OverlayItem, index: number): void {
        if (item.bitmaps.has(index) || item.pending !== null) { return; }
        if (index < 0 || index >= item.decoder.frameCount) { return; }
        item.pending = index;
        const t0 = nowMs();
        item.decoder.decodeFrame(index).then((frame) =>
            bitmapFromPixels(frame.data, item.decoder.width, item.decoder.height)
                .then((bitmap) => ({ bitmap, duration: frame.duration })),
        ).then(({ bitmap, duration }) => {
            // decodeMs 口径：decodeFrame → ImageData → createImageBitmap 的 worker 侧墙钟
            //（offscreen 档 taskMs = 解码+位图化，见 tools/PERF.md；copy 档的 computeMs
            // 只含解码 —— 两侧绝对值不可直接比，主线程扇出时再加 compositeMs/frames 摊销）。
            statDecodeMs.push(nowMs() - t0);
            item.pending = null;
            if (items.get(item.handle) !== item) { return; }   // 解码期间已 detach
            if (item.durations[index] < 0) { item.durations[index] = duration; }
            item.bitmaps.set(index, bitmap);
            if (index === item.currentFrame) { presentAll(); }   // 同 Player：解码完成即上屏
            startClock();   // 时钟可能需要重启（暂停态首帧解码完成即上屏后自然停钟）
        })
            .catch(() => {
                item.pending = null;
                statErrors++;
                item.consecutiveErrors++;
                if (item.consecutiveErrors >= 8) {
                    // 连续 8 次失败：坏条目，移除后其余照跑（lastDrawn !== currentFrame 的
                    // 重试需求随之消失，避免坏条目把时钟拖成无限重试）。
                    items.delete(item.handle);
                    forceDirty = true;
                }
                startClock();   // 未达移除阈值靠时钟重试（lastDrawn !== currentFrame 保持时钟需求）
            });
    }

    function tick (ts: number): void {
        if (!running) { return; }   // 停钟后残余的回调直接作废
        const dtMs = lastTs < 0 ? 0 : Math.min(250, ts - lastTs);
        lastTs = ts;

        for (const item of items.values()) {
            if (item.playing && item.decoder.frameCount > 1) { advance(item, dtMs); }
            ensureFrame(item, item.currentFrame);
        }

        // 脏检测：任意条目「当前帧 ≠ 已画帧 且位图就绪」，或全局强制（resize/update/detach）。
        let dirty = forceDirty;
        if (!dirty) {
            for (const item of items.values()) {
                if (item.lastDrawn !== item.currentFrame && item.bitmaps.has(item.currentFrame)) {
                    dirty = true;
                    break;
                }
            }
        }
        if (dirty) { presentAll(); }

        if (nowMs() - lastEmitMs >= 500) { emitStats(); }

        if (!needsClock()) {
            // 全暂停/全空：停钟并冲刷最后一条 stats（有内容才发）。
            running = false;
            lastTs = -1;
            emitStats();
            return;
        }
        scheduleNext();
    }

    return {
        bind (canvas, w, h, sink) {
            if (bound) { throw new Error('overlay canvas 已 bind（transferControlToOffscreen 是一次性的）'); }
            const target = canvas as OverlaySurface;
            if (typeof target.getContext !== 'function') {
                throw new Error('overlay canvas 过线后没有 getContext（transfer 未生效？）');
            }
            const context = target.getContext('2d');
            if (!context) { throw new Error('overlay canvas 拿不到 2d 上下文'); }
            const g = host();
            if (typeof g.requestAnimationFrame === 'function') {
                ticker = 'raf';   // Chrome 69+：dedicated worker 顶层 rAF，须 OffscreenCanvas 已 bind
            } else if (typeof g.setTimeout === 'function') {
                ticker = 'timeout';   // Firefox/Safari 兜底：setTimeout 自循环 ~60fps
            } else {
                throw new Error('worker 里既没有 requestAnimationFrame 也没有 setTimeout，无法自驱时钟');
            }
            surface = target;
            ctx = context;
            width = Math.max(1, Math.floor(w));
            height = Math.max(1, Math.floor(h));
            // 权威尺寸：主线程传来的 width/height（物理像素），不用过线时 canvas 身上的旧值。
            target.width = width;
            target.height = height;
            notify = sink;
            bound = true;
            lastEmitMs = nowMs();
            return ticker;
        },

        attach (handle, decoder, rect, playing, loop) {
            if (!bound) { throw new Error('overlay 未 bind canvas 就 attach'); }
            if (items.has(handle)) { throw new Error(`handle ${handle} 已在 overlay 上`); }
            const item: OverlayItem = {
                handle,
                decoder,
                rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
                playing,
                loop,
                currentFrame: 0,
                accumMs: 0,
                durations: new Array<number>(decoder.frameCount).fill(-1),
                bitmaps: new Map<number, BitmapSource>(),
                pending: null,
                lastDrawn: -1,
                consecutiveErrors: 0,
            };
            items.set(handle, item);
            ensureFrame(item, 0);   // 同 Player 构造：进场即解码第 0 帧（暂停态也要显示首帧）
            startClock();
        },

        resize (w, h) {
            if (!bound) { return; }
            const nw = Math.max(1, Math.floor(w));
            const nh = Math.max(1, Math.floor(h));
            if (nw === width && nh === height) { return; }
            width = nw;
            height = nh;
            // 设置 width/height 会清空画布位图（标准 resize 模式）；ImageBitmap 缓存与画布
            // 尺寸无关，保留 —— 只需强制全量重画。
            surface!.width = nw;
            surface!.height = nh;
            forceDirty = true;
            startClock();
        },

        update (placements) {
            if (!bound) { return; }
            for (const placement of placements) {
                const item = items.get(placement.handle);
                if (!item) { continue; }
                item.rect = { x: placement.rect.x, y: placement.rect.y, w: placement.rect.w, h: placement.rect.h };
            }
            forceDirty = true;
            startClock();
        },

        setState (handle, playing, loop) {
            const item = items.get(handle);
            if (!item) { return; }
            item.playing = playing;
            if (loop !== undefined) { item.loop = loop; }
            if (playing) { startClock(); }
        },

        detach (handle) {
            if (!items.delete(handle)) { return; }
            forceDirty = true;   // 擦掉原矩形区域的残影（重画时 clearRect 覆盖全画布）
            startClock();
        },
    };
}
