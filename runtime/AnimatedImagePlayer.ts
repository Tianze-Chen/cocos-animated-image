import { createAnimatedDecoder, isNativeAnimatedSupported } from './image-decoder';
import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import { Texture2D, SpriteFrame } from 'cc';

export enum AnimatedImagePlayerState {
    INIT,
    PLAYING,
    PAUSED,
    STOPPED,
}

// --- SAB 主线程帧缓存（2026-09 真机实证通道满载丢消息后的流量根治） ---
// transientFrames（worker SAB 模式）原本完全不缓存：循环播放第二轮起每帧仍是一次
// 纯往返（worker 把不变的字节重写 SAB → 主线程读视图 upload）——微信通道往返
// 21~50ms 且持续满载会整体楔死（2026-09 真机定案，见反馈文档 P0-1b），这个
// 「只是一次往返」既是每实例播放帧率的瓶颈（满载实测 ~9 帧/s），也是通道持续
// 满载的流量源。改为 decode 返回时把 SAB 视图**复制一份**缓存（必须副本：视图
// 内容会被后续 decode 覆盖），循环命中零往返。缺省**不设上限**——与 copy 档口径
// 一致（copy 的 Player 本就全量缓存，同规模真机通过）；?sabCacheMB=N 可设全局
// 字节预算（多实例分摊，预算满后新帧退回不缓存的老行为），0 关回完全不缓存
//（query 链见 anim-decode-path.ts）。
let sabFrameCacheBytes = 0;

/** 把当前用量写到 globalThis（worker-decoder 的通道诊断打点读它；避免扩展层反向 import cc）。 */
function noteSabCacheBytes (): void {
    (globalThis as { __sabFrameCacheUsed?: number }).__sabFrameCacheUsed = sabFrameCacheBytes;
}

/** 缺省 Infinity（copy 档口径：全量缓存）；number ≥ 0 = 显式预算（0 = 关）。 */
function sabFrameCacheBudget (): number {
    const mb = (globalThis as { __sabFrameCacheMB?: number }).__sabFrameCacheMB;
    return typeof mb === 'number' && mb >= 0 ? mb * 1024 * 1024 : Infinity;
}

export class AnimatedImagePlayer {
    public static create (bytes: Uint8Array, mime = 'image/apng'): Promise<AnimatedImagePlayer> {
        return createAnimatedDecoder(bytes, mime).then((decoder) => new AnimatedImagePlayer(decoder));
    }

    public static isNativeSupported (mime = 'image/apng'): boolean {
        return isNativeAnimatedSupported(mime);
    }

    public static get forceBuiltinDecoder (): boolean {
        return (globalThis as { __forceBuiltinDecoder?: boolean }).__forceBuiltinDecoder === true;
    }
    public static set forceBuiltinDecoder (value: boolean) {
        (globalThis as { __forceBuiltinDecoder?: boolean }).__forceBuiltinDecoder = value;
    }

    /** A/B：true = 跳过 WebCodecs 直接走 worker 解码（浏览器里量 worker 收益）。 */
    public static get forceWorkerDecoder (): boolean {
        return (globalThis as { __forceWorkerDecoder?: boolean }).__forceWorkerDecoder === true;
    }
    public static set forceWorkerDecoder (value: boolean) {
        (globalThis as { __forceWorkerDecoder?: boolean }).__forceWorkerDecoder = value;
    }

    /**
     * A/B：true = worker 帧传输走 SharedArrayBuffer（微信 worker V2 / 桌面 Chrome），
     * 与默认的逐帧 postMessage 拷贝模式对比传输开销（统计见 getWorkerDecodeStats）。
     * 环境不支持时自动降级回 copy 模式，行为不变。
     */
    public static get forceWorkerSharedBuffer (): boolean {
        return (globalThis as { __forceWorkerSharedBuffer?: boolean }).__forceWorkerSharedBuffer === true;
    }
    public static set forceWorkerSharedBuffer (value: boolean) {
        (globalThis as { __forceWorkerSharedBuffer?: boolean }).__forceWorkerSharedBuffer = value;
    }

    /**
     * A/B：copy 模式批量解码的合批帧数 K（>1 启用，0/1 = 逐帧往返）。
     * 动机：微信信道每消息固定开销占大头，K 帧合一批把消息数砍到 1/K。
     * 仅 copy 模式生效；SAB 模式响应本就只有元数据，无需合批。
     */
    public static get forceWorkerBatchSize (): number {
        return (globalThis as { __forceWorkerBatchK?: number }).__forceWorkerBatchK || 0;
    }
    public static set forceWorkerBatchSize (value: number) {
        (globalThis as { __forceWorkerBatchK?: number }).__forceWorkerBatchK
            = value > 0 ? Math.floor(value) : 0;
    }

    /**
     * A/B：true = worker-auto 变体（方案 C）—— 播放时钟搬进 worker：worker 自驱解码、
     * 直接写 SAB 并推进 header 帧序号，主线程 tick 只轮询序号上屏 —— **每帧零消息**
     * （通道只剩 open/attach/probe/start/stop/seek 等 O(1) 控制消息；2026-09 真机定案：
     * 持续满载 ~10k 累计请求后通道整体楔死，per-frame 拉模型是消息量根源，见
     * tools/wx-worker-v2-feedback.md P0-1b）。仅 SAB 真共享环境生效，否则协商自动落回
     * 拉模型 worker（行为同 copy 档）。自驱模式下 duration 恒 0（时钟在 worker）。
     */
    public static get forceWorkerAuto (): boolean {
        return (globalThis as { __forceWorkerAuto?: boolean }).__forceWorkerAuto === true;
    }
    public static set forceWorkerAuto (value: boolean) {
        (globalThis as { __forceWorkerAuto?: boolean }).__forceWorkerAuto = value;
    }

    private _decoder: IAnimatedImageDecoder;
    private _texture: Texture2D;
    private _spriteFrame: SpriteFrame;
    private _state = AnimatedImagePlayerState.STOPPED;
    private _loop = true;
    private _currentFrame = 0;
    private _accumMs = 0;
    private _duration = 0;
    private _frameCache: (IDecodedFrame | undefined)[];
    private _frameDurations: number[];
    private _cachedFrameCount = 0;
    private _frameCacheBytes = 0;
    private _pendingDecode = false;
    private _destroyed = false;
    /** 本实例的帧缓存占用计入了全局 SAB 预算（destroy 时归还；copy 模式实例不计）。 */
    private _sabRetained = false;

    private constructor (decoder: IAnimatedImageDecoder) {
        this._decoder = decoder;
        this._frameCache = new Array<IDecodedFrame | undefined>(decoder.frameCount);
        this._frameDurations = new Array<number>(decoder.frameCount).fill(-1);

        const texture = new Texture2D();
        texture.reset({
            width: decoder.width,
            height: decoder.height,
            format: Texture2D.PixelFormat.RGBA8888,
            mipmapLevel: 1,
        });
        this._texture = texture;

        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texture;
        spriteFrame.packable = false;
        this._spriteFrame = spriteFrame;

        if (this._decoder.autoDriven === true) {
            // 自驱模式：首帧由 worker 写进共享内存（seekAuto 触发解码），tick 轮询上屏 ——
            // 对齐拉模型「构造即请求第 0 帧」的显示语义。
            this._decoder.seekAuto?.(0);
        } else {
            this._requestFrame(0);
        }
    }

    get spriteFrame (): SpriteFrame {
        return this._spriteFrame;
    }

    get texture (): Texture2D {
        return this._texture;
    }

    get frameCount (): number {
        return this._decoder.frameCount;
    }

    get width (): number {
        return this._decoder.width;
    }

    get height (): number {
        return this._decoder.height;
    }

    /** Number of decoded RGBA frames currently retained by this player. */
    get cachedFrameCount (): number {
        return this._cachedFrameCount;
    }

    /** Bytes retained by decoded RGBA frames (excluding decoder and GPU memory). */
    get frameCacheBytes (): number {
        return this._frameCacheBytes;
    }

    get currentFrame (): number {
        return this._currentFrame;
    }

    get state (): AnimatedImagePlayerState {
        return this._state;
    }

    get duration (): number {
        return this._duration;
    }

    get loop (): boolean {
        return this._loop;
    }
    set loop (value: boolean) {
        this._loop = value;
    }

    public play (): void {
        if (this._destroyed) { return; }
        if (this._state === AnimatedImagePlayerState.STOPPED) {
            this._currentFrame = 0;
            this._accumMs = 0;
            if (this._decoder.autoDriven === true) {
                this._decoder.seekAuto?.(0);
            } else {
                this._requestFrame(0);
            }
        }
        this._state = AnimatedImagePlayerState.PLAYING;
        if (this._decoder.autoDriven === true) {
            this._decoder.startAuto?.(this._loop);   // worker 时钟接管帧推进
        }
    }

    public pause (): void {
        if (this._state === AnimatedImagePlayerState.PLAYING) {
            this._state = AnimatedImagePlayerState.PAUSED;
            if (this._decoder.autoDriven === true) {
                this._decoder.stopAuto?.();   // worker 停钟（当前帧留在共享内存继续上屏）
            }
        }
    }

    public resume (): void {
        if (this._state === AnimatedImagePlayerState.PAUSED) {
            this._state = AnimatedImagePlayerState.PLAYING;
            if (this._decoder.autoDriven === true) {
                this._decoder.startAuto?.(this._loop);
            }
        }
    }

    public stop (): void {
        this._state = AnimatedImagePlayerState.STOPPED;
        this._currentFrame = 0;
        this._accumMs = 0;
        if (this._decoder.autoDriven === true) {
            this._decoder.stopAuto?.();
            this._decoder.seekAuto?.(0);   // 停在首帧（对齐拉模型 stop 的显示语义）
            return;
        }
        this._requestFrame(0);
    }

    public seekToFrame (index: number): void {
        if (this._destroyed) { return; }
        const clamped = Math.max(0, Math.min(index, this.frameCount - 1));
        this._currentFrame = clamped;
        this._accumMs = 0;
        if (this._decoder.autoDriven === true) {
            this._decoder.seekAuto?.(clamped);
            return;
        }
        this._requestFrame(clamped);
    }

    public tick (dt: number): void {
        // 自驱模式（worker-auto）：播放时钟在 worker，主线程只轮询 header 帧序号 ——
        // 序号变了才 uploadData，每帧零消息。轮询放在 PLAYING 早退守卫**之前**：暂停/
        // 停止态的 seekAuto 目标帧也要能上屏（worker 停钟不代表共享内存不再更新）。
        if (this._decoder.autoDriven === true) {
            if (this._destroyed) { return; }
            const frame = this._decoder.pollAutoFrame?.();
            if (frame) {
                this._currentFrame = frame.index;
                this._texture.uploadData(frame.data, 0);
            }
            return;
        }
        if (this._destroyed || this._state !== AnimatedImagePlayerState.PLAYING || this.frameCount <= 1) {
            return;
        }
        this._accumMs += dt * 1000;
        let guard = this.frameCount;
        while (guard-- > 0) {
            const frameDur = this._frameDurations[this._currentFrame];
            if (frameDur < 0) {
                this._requestFrame(this._currentFrame);
                break;
            }
            if (this._accumMs < frameDur) {
                break;
            }
            this._accumMs -= frameDur;
            const next = this._currentFrame + 1;
            if (next >= this.frameCount) {
                if (this._loop) {
                    this._currentFrame = 0;
                } else {
                    this._currentFrame = this.frameCount - 1;
                    this._state = AnimatedImagePlayerState.STOPPED;
                    break;
                }
            } else {
                this._currentFrame = next;
            }
            this._requestFrame(this._currentFrame);
        }
    }

    public destroy (): void {
        if (this._destroyed) { return; }
        this._destroyed = true;
        this._state = AnimatedImagePlayerState.STOPPED;
        this._decoder.destroy();
        if (this._sabRetained) {
            sabFrameCacheBytes -= this._frameCacheBytes;
            if (sabFrameCacheBytes < 0) { sabFrameCacheBytes = 0; }   // 防御性钳制
            noteSabCacheBytes();
        }
        this._frameCache.length = 0;
        this._cachedFrameCount = 0;
        this._frameCacheBytes = 0;
        this._spriteFrame.destroy();
        this._texture.destroy();
    }

    private _requestFrame (index: number): void {
        this._presentFrame(index);
    }

    private _presentFrame (index: number): void {
        if (this._destroyed) { return; }
        let frame = this._frameCache[index];
        if (frame) {
            if (index === this._currentFrame) {
                this._texture.uploadData(frame.data, 0);
            }
            return;
        }
        if (this._pendingDecode) { return; }
        this._pendingDecode = true;
        this._decoder.decodeFrame(index).then((decoded) => {
            this._pendingDecode = false;
            if (this._destroyed) { return; }
            if (this._decoder.transientFrames === true) {
                // transient 帧（worker SAB 模式）视图只到下一次 decodeFrame 前。默认改留
                // 主线程**副本**缓存（循环播放第二轮起零往返，见模块头 sabFrameCache 注释）；
                // 预算满 / ?sabCacheMB=0 时退回不缓存的老行为（直接上屏）。
                const size = decoded.data.byteLength;
                const budget = sabFrameCacheBudget();
                if (budget > 0 && sabFrameCacheBytes + size <= budget) {
                    const copy = new Uint8Array(decoded.data);   // 脱离共享内存的独立副本
                    this._frameCache[index] = { data: copy, duration: decoded.duration };
                    this._frameCacheBytes += size;
                    this._cachedFrameCount++;
                    sabFrameCacheBytes += size;
                    noteSabCacheBytes();
                    this._sabRetained = true;
                }
            } else {
                const existing = this._frameCache[index];
                if (existing) {
                    this._frameCacheBytes -= existing.data.byteLength;
                } else {
                    this._cachedFrameCount++;
                }
                this._frameCache[index] = decoded;
                this._frameCacheBytes += decoded.data.byteLength;
            }
            if (this._frameDurations[index] < 0) {
                this._frameDurations[index] = decoded.duration;
                this._duration += decoded.duration;
            }
            if (index === this._currentFrame) {
                this._texture.uploadData(decoded.data, 0);
            }
        }).catch((e) => {
            this._pendingDecode = false;
            console.warn(`AnimatedImagePlayer failed to decode frame ${index}: ${String(e)}`);
        });
    }
}
