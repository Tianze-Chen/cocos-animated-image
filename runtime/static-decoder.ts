import type { IAnimatedImageDecoder, IDecodedFrame } from './types';

// Single-frame decoder built on whatever image loading the host already has:
// createImageBitmap on the web, an Image element on mini-games and native. Used
// for still PNG/JPEG, and as the degraded path for a format whose animated
// decoder could not be loaded — the first frame beats nothing.
//
// This lives apart from image-decoder.ts so that a codec module can fall back to
// it without importing the module that registers codecs, which would close an
// import cycle.

export function createStaticDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
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

const EXT_MAP: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
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
