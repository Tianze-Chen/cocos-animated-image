import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import { sniffMime } from './mime-sniff';
import { getDecoder } from './decoder-registry';
import { createStaticDecoder } from './static-decoder';
import { tryCreateWorkerDecoder } from './worker-decoder';
import './codecs';

// --- WebCodecs types (browser-only) ---

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

// --- WebCodecs decoder (web platform with WebCodecs support) ---

class WebCodecsDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;

    private _decoder: WebImageDecoder | null;
    private _canvas: OffscreenCanvas | HTMLCanvasElement;
    private _ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

    constructor (decoder: WebImageDecoder, width: number, height: number, frameCount: number, loopCount: number) {
        this._decoder = decoder;
        this.width = width;
        this.height = height;
        this.frameCount = frameCount;
        this.loopCount = loopCount;
        if (typeof OffscreenCanvas !== 'undefined') {
            this._canvas = new OffscreenCanvas(width, height);
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            this._canvas = canvas;
        }
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    }

    public async decodeFrame (index: number): Promise<IDecodedFrame> {
        if (!this._decoder) {
            throw new Error('animated image decoder has been destroyed');
        }
        const result = await this._decoder.decode({ frameIndex: index });
        const videoFrame = result.image;
        try {
            this._ctx.clearRect(0, 0, this.width, this.height);
            this._ctx.drawImage(videoFrame as unknown as CanvasImageSource, 0, 0);
            const imageData = this._ctx.getImageData(0, 0, this.width, this.height);
            const data = new Uint8Array(imageData.data.buffer.slice(0));
            const duration = videoFrame.duration != null ? videoFrame.duration / 1000 : 0;
            return { data, duration };
        } finally {
            videoFrame.close();
        }
    }

    public destroy (): void {
        if (this._decoder) {
            this._decoder.close();
            this._decoder = null;
        }
    }
}

// --- Public API ---

export function isNativeAnimatedSupported (mime: string): boolean {
    return typeof getImageDecoderCtor() !== 'undefined';
}

export function shouldForceBuiltin (): boolean {
    return (globalThis as { __forceBuiltinDecoder?: boolean }).__forceBuiltinDecoder === true;
}

/** A/B 开关：跳过 WebCodecs 直接走 worker 路径（浏览器里量 worker 收益用；微信本来就没有 WebCodecs）。 */
export function shouldForceWorkerDecoder (): boolean {
    return (globalThis as { __forceWorkerDecoder?: boolean }).__forceWorkerDecoder === true;
}

export async function createAnimatedDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const actual = sniffMime(bytes, mime);

    // 分发顺序：WebCodecs → worker → 主线程 JS。
    // - __forceWorkerDecoder：跳过 WebCodecs，直接落 worker（浏览器 A/B）。
    // - __forceBuiltinDecoder：跳过前两级，纯主线程基线（A/B 的对照组）。
    // - worker 档自身失败（无 Worker 全局 / 交付文件缺失 / 协议错误）返回 null，继续降级。
    const forceBuiltin = shouldForceBuiltin();
    if (!forceBuiltin && !shouldForceWorkerDecoder()) {
        const native = await tryCreateWebCodecs(bytes, actual);
        if (native) return native;
    }
    if (!forceBuiltin) {
        const workerBacked = await tryCreateWorkerDecoder(bytes, actual);
        if (workerBacked) return workerBacked;
    }

    return createJsFallback(bytes, actual);
}

// --- WebCodecs path (web only) ---

async function tryCreateWebCodecs (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder | null> {
    const Ctor = getImageDecoderCtor();
    if (!Ctor) return null;
    try {
        if (typeof Ctor.isTypeSupported === 'function' && !(await Ctor.isTypeSupported(mime))) {
            return null;
        }
        const decoder = new Ctor({ data: bytes, type: mime });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track || !track.frameCount) {
            decoder.close();
            return null;
        }
        const first = await decoder.decode({ frameIndex: 0 });
        const width = first.image.displayWidth;
        const height = first.image.displayHeight;
        first.image.close();
        const repetition = track.repetitionCount;
        const loopCount = (repetition === Infinity || repetition < 0) ? 0 : repetition;
        return new WebCodecsDecoder(decoder, width, height, track.frameCount, loopCount);
    } catch (e) {
        console.warn(`[animated-image] WebCodecs ImageDecoder failed for ${mime}: ${String(e)}`);
        return null;
    }
}

// --- JS fallback (all platforms) ---

function createJsFallback (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const factory = getDecoder(mime);
    if (factory) return Promise.resolve(factory(bytes));

    if (mime === 'image/png' || mime === 'image/jpeg') {
        return createStaticDecoder(bytes, mime);
    }
    console.warn(`[animated-image] Unsupported animated image format: ${mime} (${bytes.length} bytes)`);
    return Promise.reject(new Error(`Unsupported animated image format: ${mime} (${bytes.length} bytes)`));
}
