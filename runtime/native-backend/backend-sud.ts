/**
 * Sud 平台后端：SUD ImageDecoder（Sud 沙盒宿主提供的原生动图解码，
 * API 形状对齐 W3C WebCodecs ImageDecoder 提案）。
 *
 * 与 web 后端的三处平台差异都收在本文件：
 *   - Sud 宿主没有 DOM，像素提取不能用 canvas，走 VideoFrame.copyTo
 *     （SUD 的帧是已合成的紧排列 RGBA8，可直拷）；
 *   - 错误经 onerror 回调送达而不是 Promise reject —— 捕获后在每个
 *     await 前后检查，把异步报错转成同步异常抛给 adapter；
 *   - 解码器实例上有 width/height 属性，元数据就绪后尺寸已知，
 *     不必解首帧探测。
 *
 * SUD 尚在逐步开放中，各基础库暴露面可能不一致：全局命名空间、静态
 * isTypeSupported 是否可达都按「可能没有」处理，探测不到就交回
 * create/ready 阶段的异常降级。
 */

import type {
    NativeBackendDescriptor, NativeDecoderHandle, NativeFrameInfo, NativeTrackInfo,
} from './types';

// --- SUD 最小类型（Sud 平台接口，宿主不存在时下面的 available() 就是 false） ---

interface SudVideoFrame {
    readonly displayWidth: number;
    readonly displayHeight: number;
    /** 微秒；静帧为 null。 */
    readonly duration: number | null;
    copyTo (destination: ArrayBufferView | ArrayBuffer, options?: { format?: string }): number;
    allocationSize (options?: { format?: string }): number;
    close (): void;
}
interface SudDecodeResult {
    image: SudVideoFrame;
    complete: boolean;
}
interface SudImageTrack {
    animated: boolean;
    frameCount: number;
    repetitionCount: number;
}
interface SudImageDecoder {
    readonly width: number;
    readonly height: number;
    readonly tracks: { ready: Promise<void>; selectedTrack: SudImageTrack | null };
    decode (options: { frameIndex: number; completeFramesOnly?: boolean }): Promise<SudDecodeResult>;
    onerror?: (err: { errMsg?: string } | string | null) => void;
    close (): void;
}
interface SudImageDecoderCtor {
    isTypeSupported (type: string): Promise<boolean>;
}
interface SudNamespace {
    createImageDecoder (init: {
        type: string;
        data?: BufferSource;
        preferAnimation?: boolean;
    }): SudImageDecoder | Promise<SudImageDecoder>;
    SUDImageDecoder?: SudImageDecoderCtor;
}

function getSudNamespace (): SudNamespace | undefined {
    return (globalThis as { sud?: SudNamespace }).sud;
}

// --- handle ---

class SudHandle implements NativeDecoderHandle {
    private readonly _decoder: SudImageDecoder;
    private _error: string | null = null;

    constructor (decoder: SudImageDecoder) {
        this._decoder = decoder;
        try {
            decoder.onerror = (err) => {
                const msg = typeof err === 'string' ? err : (err?.errMsg ?? 'unknown sud decoder error');
                if (!this._error) { this._error = msg; } // 保留首发错误
            };
        } catch (e) {
            // onerror 不可写（实现差异）就放弃捕获，错误仍会从 Promise 侧冒出来。
        }
    }

    private _checkError (): void {
        if (this._error) { throw new Error(this._error); }
    }

    public async ready (): Promise<NativeTrackInfo | null> {
        this._checkError();
        await this._decoder.tracks.ready;
        this._checkError();
        const track = this._decoder.tracks.selectedTrack;
        if (!track || !track.frameCount) { return null; }
        // 解码器属性上的尺寸（desiredWidth/Height 未指定时为源尺寸）；个别实现
        // 元数据后仍未填，给 0 让 adapter 走首帧探测。
        const width = this._decoder.width;
        const height = this._decoder.height;
        return {
            frameCount: track.frameCount,
            repetitionCount: track.repetitionCount,
            width: width > 0 ? width : undefined,
            height: height > 0 ? height : undefined,
        };
    }

    public async decode (frameIndex: number): Promise<NativeFrameInfo> {
        this._checkError();
        const result = await this._decoder.decode({ frameIndex: frameIndex, completeFramesOnly: true });
        this._checkError();
        const frame = result.image;
        return {
            width: frame.displayWidth,
            height: frame.displayHeight,
            durationMs: frame.duration != null ? frame.duration / 1000 : 0,
            extract: (out: Uint8Array, width: number, height: number): Promise<void> => {
                // 文档承诺紧排列 RGBA8；allocationSize 校验兜底，格式不符或帧尺寸
                // 与解码器固定尺寸（out 的分配依据）不一致时，把静默写坏内存
                // 变成一个可读的错误。
                const expected = frame.allocationSize({ format: 'RGBA' });
                if (expected !== out.byteLength) {
                    throw new Error(
                        `sud frame ${frame.displayWidth}x${frame.displayHeight} expects `
                        + `${expected} bytes, decoder buffer is ${width}x${height} = ${out.byteLength}`);
                }
                frame.copyTo(out, { format: 'RGBA' });
                return Promise.resolve();
            },
            close: (): void => frame.close(),
        };
    }

    public close (): void {
        try {
            this._decoder.onerror = undefined;
        } catch (e) {
            // 忽略：onerror 不可写的实现上面已经放弃捕获了。
        }
        this._decoder.close();
    }
}

export const sudImageBackend: NativeBackendDescriptor = {
    name: 'sud',
    available (): boolean {
        return typeof getSudNamespace()?.createImageDecoder === 'function';
    },
    isTypeSupported (mime: string): Promise<boolean> | null {
        const Ctor = getSudNamespace()?.SUDImageDecoder;
        return typeof Ctor?.isTypeSupported === 'function' ? Ctor.isTypeSupported(mime) : null;
    },
    async create (bytes: Uint8Array, mime: string): Promise<NativeDecoderHandle> {
        const sud = getSudNamespace();
        if (!sud || typeof sud.createImageDecoder !== 'function') {
            throw new Error('sud.createImageDecoder is not available');
        }
        // preferAnimation：同一文件含静图/动图双轨道时选动图轨道 —— 本组件只消费动图。
        // await 防个别实现返回 Promise（文档为同步返回，这里两头都兼容）。
        const decoder = await sud.createImageDecoder({ type: mime, data: bytes, preferAnimation: true });
        return new SudHandle(decoder);
    },
};
