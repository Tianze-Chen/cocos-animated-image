/**
 * 原生后端共享适配器：把 NativeDecoderHandle 适配成引擎侧的
 * IAnimatedImageDecoder。平台无关的归一化逻辑只允许存在于这里：
 *   - loopCount 约定（0 = 无限循环，N = 播 N 遍）← 各平台 repetitionCount；
 *   - 元数据阶段拿不到尺寸时，解首帧探测 displayWidth/Height；
 *   - 逐后端尝试（available → isTypeSupported → create/ready），任一环节
 *     失败换下一档，全部失败返回 null，由 image-decoder 落 JS 解码。
 */

import type { IAnimatedImageDecoder, IDecodedFrame } from '../types';
import type { NativeDecoderHandle } from './types';
import { getNativeBackends, probeBackendType, isAnyBackendAvailable } from './backend-registry';

function normalizeLoopCount (repetition: number): number {
    return (repetition === Infinity || repetition < 0) ? 0 : repetition;
}

class NativeImageDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;
    /** 胜出后端名（web-codecs / sud），供界面/日志展示实际解码档。 */
    public readonly backendName: string;

    private _handle: NativeDecoderHandle | null;

    constructor (handle: NativeDecoderHandle, backendName: string, width: number, height: number, frameCount: number, loopCount: number) {
        this._handle = handle;
        this.backendName = backendName;
        this.width = width;
        this.height = height;
        this.frameCount = frameCount;
        this.loopCount = loopCount;
    }

    public async decodeFrame (index: number): Promise<IDecodedFrame> {
        const handle = this._handle;
        if (!handle) {
            throw new Error('animated image decoder has been destroyed');
        }
        const frame = await handle.decode(index);
        try {
            // 按解码器固定尺寸分配：播放器纹理以 this.width/height 创建，
            // 逐帧按各自的 displayWidth/Height 分配会在帧尺寸漂移时产出
            // 长度不符的 buffer，让 texSubImage2D 抛错。
            const data = new Uint8Array(this.width * this.height * 4);
            await frame.extract(data, this.width, this.height);
            return { data, duration: frame.durationMs };
        } finally {
            frame.close();
        }
    }

    public destroy (): void {
        if (this._handle) {
            this._handle.close();
            this._handle = null;
        }
    }
}

/**
 * 依次尝试已注册后端，返回第一个能用的。所有失败都只 warn 一次然后降级，
 * 不抛错 —— 是否继续走 JS 解码由 image-decoder 决定。
 */
export async function tryCreateNativeDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder | null> {
    for (const backend of getNativeBackends()) {
        try {
            if (!backend.available()) { continue; }
            if (!(await probeBackendType(backend, mime))) { continue; }

            const handle = await backend.create(bytes, mime);
            try {
                const track = await handle.ready();
                if (!track || !track.frameCount) {
                    handle.close();
                    continue; // 无动画轨道 = 静图，静图不属于原生动图档
                }
                return await openDecoder(handle, track, backend.name);
            } catch (e) {
                handle.close();
                console.warn(`[animated-image] 原生后端 ${backend.name} 打开 ${mime} 失败，回退下一档：${String(e)}`);
            }
        } catch (e) {
            console.warn(`[animated-image] 原生后端 ${backend.name} 尝试 ${mime} 失败，回退下一档：${String(e)}`);
        }
    }
    return null;
}

async function openDecoder (handle: NativeDecoderHandle, track: {
    frameCount: number; repetitionCount: number; width?: number; height?: number;
}, backendName: string): Promise<IAnimatedImageDecoder> {
    const loopCount = normalizeLoopCount(track.repetitionCount);

    // 元数据阶段 SUD 能从解码器属性上拿到尺寸；WebCodecs 的尺寸长在帧上
    // （displayWidth/Height），元数据阶段拿不到 —— 拿不到就解首帧探测，
    // 与老的 WebCodecs 路径行为一致。
    let width = track.width ?? 0;
    let height = track.height ?? 0;
    if (width <= 0 || height <= 0) {
        const first = await handle.decode(0);
        try {
            width = first.width;
            height = first.height;
        } finally {
            first.close();
        }
    }
    return new NativeImageDecoder(handle, backendName, width, height, track.frameCount, loopCount);
}

/** 同步能力查询（组件层 isNativeSupported 用）：任一后端存在即 true。 */
export function isNativeAnimatedSupported (): boolean {
    return isAnyBackendAvailable();
}
