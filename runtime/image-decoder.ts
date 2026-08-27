import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import { sniffMime } from './mime-sniff';
import { getDecoder } from './decoder-registry';
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

export async function createAnimatedDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const actual = sniffMime(bytes, mime);

    if (actual === 'image/webp') {
        console.warn('[animated-image] WebP is not supported; the wasm/asm decoders have been removed.');
        throw new Error('WebP is not supported');
    }

    if (!shouldForceBuiltin()) {
        const native = await tryCreateWebCodecs(bytes, actual);
        if (native) return native;
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

// --- Static image decoder (PNG/JPEG → single-frame RGBA) ---

function createStaticDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    // Prefer createImageBitmap (web/modern browsers)
    if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
        return createStaticDecoderViaBitmap(bytes, mime);
    }
    // Fallback: Image element (minigame / native)
    return createStaticDecoderViaImage(bytes, mime);
}

function createStaticDecoderViaBitmap (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const blob = new Blob([bytes], { type: mime });
    return createImageBitmap(blob).then((bitmap) => {
        const w = bitmap.width;
        const h = bitmap.height;
        let canvas: OffscreenCanvas | HTMLCanvasElement;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(w, h);
        } else {
            canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = new Uint8Array(imageData.data.buffer.slice(0));
        const frame: IDecodedFrame = { data, duration: 0 };
        return {
            width: w,
            height: h,
            frameCount: 1,
            loopCount: 0,
            decodeFrame (): Promise<IDecodedFrame> { return Promise.resolve(frame); },
            destroy (): void {},
        } as IAnimatedImageDecoder;
    });
}

function createStaticDecoderViaImage (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    return new Promise<IAnimatedImageDecoder>((resolve, reject) => {
        const img = new (globalThis as any).Image() as HTMLImageElement;
        img.onload = (): void => {
            try {
                const w = img.width;
                const h = img.height;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, w, h);
                const data = new Uint8Array(imageData.data.buffer.slice(0));
                const frame: IDecodedFrame = { data, duration: 0 };
                resolve({
                    width: w,
                    height: h,
                    frameCount: 1,
                    loopCount: 0,
                    decodeFrame (): Promise<IDecodedFrame> { return Promise.resolve(frame); },
                    destroy (): void {},
                } as IAnimatedImageDecoder);
                cleanupImageSrc(img.src);
            } catch (e) {
                cleanupImageSrc(img.src);
                reject(e);
            }
        };
        img.onerror = (): void => {
            cleanupImageSrc(img.src);
            reject(new Error(`Failed to decode static ${mime} image`));
        };

        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            img.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
        } else {
            const tempPath = writeTempFile(bytes, mime);
            if (tempPath) {
                img.src = tempPath;
            } else {
                img.src = `data:${mime};base64,${arrayBufferToBase64(bytes)}`;
            }
        }
    });
}

// --- Minigame temp file helpers ---

const EXT_MAP: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };
let tempSeq = 0;

function writeTempFile (bytes: Uint8Array, mime: string): string | null {
    try {
        const fu = (globalThis as any).fsUtils;
        if (!fu || typeof fu.writeFileSync !== 'function') return null;
        const ext = EXT_MAP[mime] || '.bin';
        const path = `${fu.getUserDataPath()}/_aidec_${tempSeq++}${ext}`;
        fu.writeFileSync(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'binary');
        return path;
    } catch {
        return null;
    }
}

function cleanupImageSrc (src: string): void {
    if (!src) return;
    if (src.startsWith('blob:')) {
        try { URL.revokeObjectURL(src); } catch {}
        return;
    }
    if (src.includes('_aidec_')) {
        try {
            const fu = (globalThis as any).fsUtils;
            if (fu && typeof fu.deleteFile === 'function') {
                fu.deleteFile(src, (): void => {});
            }
        } catch {}
    }
}

function arrayBufferToBase64 (bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
