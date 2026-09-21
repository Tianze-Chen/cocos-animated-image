/**
 * web 平台后端：W3C WebCodecs ImageDecoder（Chrome/Edge 94+）。
 *
 * 帧对象是 VideoFrame，没有保证可用的 RGBA 拷贝接口（copyTo 的 layout 支持因
 * 格式而异），所以像素提取走 2D canvas：drawImage 把帧完整合成到画布上，再
 * getImageData 拿 RGBA —— 这同时天然处理了帧间合成（APNG/WebP 的增量帧）。
 */

import type {
    NativeBackendDescriptor, NativeDecoderHandle, NativeFrameInfo, NativeTrackInfo,
} from './types';

// --- WebCodecs 最小类型（浏览器侧接口，宿主不存在时下面的 available() 就是 false） ---

interface WebImageDecoderTrack {
    frameCount: number;
    repetitionCount: number;
}
interface WebImageDecoderResult {
    image: {
        displayWidth: number;
        displayHeight: number;
        duration: number | null;
        close (): void;
    };
    complete: boolean;
}
interface WebImageDecoder {
    tracks: { ready: Promise<void>; selectedTrack: WebImageDecoderTrack | null };
    decode (options: { frameIndex: number }): Promise<WebImageDecoderResult>;
    close (): void;
}
interface WebImageDecoderCtor {
    new (init: { data: BufferSource; type: string }): WebImageDecoder;
    isTypeSupported (type: string): Promise<boolean>;
}

function getImageDecoderCtor (): WebImageDecoderCtor | undefined {
    return (globalThis as { ImageDecoder?: WebImageDecoderCtor }).ImageDecoder;
}

// --- canvas 提取（模块级缓存：动图帧尺寸通常不变，画布跨解码器复用，避免逐帧分配） ---

interface CanvasSlot { width: number; height: number; ctx: CanvasRenderingContext2D }
let canvasSlot: CanvasSlot | null = null;

function ensureCtx (width: number, height: number): CanvasRenderingContext2D {
    // 尺寸变了（异常动图）就重建，同尺寸复用。drawImage + getImageData 都是同步
    // 调用，extract 内无 await 点，不存在并发交叠使用这份画布的问题。
    if (!canvasSlot || canvasSlot.width !== width || canvasSlot.height !== height) {
        let canvas: OffscreenCanvas | HTMLCanvasElement;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(width, height);
        } else {
            const dom = document.createElement('canvas');
            dom.width = width;
            dom.height = height;
            canvas = dom;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        canvasSlot = { width, height, ctx };
    }
    return canvasSlot.ctx;
}

function extractViaCanvas (
    frame: WebImageDecoderResult['image'], out: Uint8Array, width: number, height: number,
): void {
    const ctx = ensureCtx(width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    out.set(imageData.data);
}

// --- handle ---

class WebHandle implements NativeDecoderHandle {
    private readonly _decoder: WebImageDecoder;

    constructor (decoder: WebImageDecoder) {
        this._decoder = decoder;
    }

    public async ready (): Promise<NativeTrackInfo | null> {
        await this._decoder.tracks.ready;
        const track = this._decoder.tracks.selectedTrack;
        if (!track || !track.frameCount) { return null; }
        // WebCodecs 的尺寸长在帧上（displayWidth/Height），元数据阶段拿不到，
        // 省略 width/height，adapter 会走首帧探测。
        return { frameCount: track.frameCount, repetitionCount: track.repetitionCount };
    }

    public async decode (frameIndex: number): Promise<NativeFrameInfo> {
        const result = await this._decoder.decode({ frameIndex: frameIndex });
        const frame = result.image;
        return {
            width: frame.displayWidth,
            height: frame.displayHeight,
            durationMs: frame.duration != null ? frame.duration / 1000 : 0,
            extract: (out: Uint8Array, width: number, height: number): Promise<void> => {
                // 用调用方给的解码器固定尺寸建画布（帧尺寸漂移时裁切/留黑），
                // drawImage 到画布本身就把 WebCodecs 的增量帧合成完整了。
                extractViaCanvas(frame, out, width, height);
                return Promise.resolve();
            },
            close: (): void => frame.close(),
        };
    }

    public close (): void {
        this._decoder.close();
    }
}

export const webImageBackend: NativeBackendDescriptor = {
    name: 'web-codecs',
    available (): boolean {
        return typeof getImageDecoderCtor() !== 'undefined';
    },
    isTypeSupported (mime: string): Promise<boolean> | null {
        const Ctor = getImageDecoderCtor();
        return typeof Ctor?.isTypeSupported === 'function' ? Ctor.isTypeSupported(mime) : null;
    },
    create (bytes: Uint8Array, mime: string): NativeDecoderHandle {
        const Ctor = getImageDecoderCtor();
        if (!Ctor) { throw new Error('ImageDecoder is not available'); }
        return new WebHandle(new Ctor({ data: bytes, type: mime }));
    },
};
