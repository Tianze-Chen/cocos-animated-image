import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import type { IWebpBackend, WebpHandle } from './webp';
import { loadWebpBackend } from './webp';
import { createStaticDecoder } from './static-decoder';

// A frame that declares 0ms would spin the player as fast as it can render, so
// treat it as "unspecified" the way gif-decoder and apng-decoder do. The value
// is not from libwebp's side: webpAnimNextFrame reports the container's ANMF
// duration faithfully, and animated WebPs in the wild really do write 0.
const DEFAULT_DURATION = 100;

const INFO_CELLS = 4;

class WebpDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;

    private _backend: IWebpBackend;
    private _handle: WebpHandle;
    private _duration = new Int32Array(1);
    private _results: (IDecodedFrame | undefined)[];
    private _decodedUpTo = -1;
    // Set when a pull fails part-way through, which leaves the decoder's canvas
    // out of step with _decodedUpTo. The next request has to rewind.
    private _desynced = false;

    constructor (
        backend: IWebpBackend,
        handle: WebpHandle,
        width: number,
        height: number,
        frameCount: number,
        loopCount: number,
    ) {
        this._backend = backend;
        this._handle = handle;
        this.width = width;
        this.height = height;
        this.frameCount = frameCount;
        this.loopCount = loopCount;
        this._results = new Array<IDecodedFrame | undefined>(frameCount);
    }

    public decodeFrame (index: number): Promise<IDecodedFrame> {
        if (index < 0 || index >= this.frameCount) {
            return Promise.reject(new Error(`frame index ${index} out of range [0, ${this.frameCount})`));
        }
        if (this._results[index] !== undefined) {
            return Promise.resolve(this._results[index]!);
        }
        if (!this._handle) {
            return Promise.reject(new Error('animated image decoder has been destroyed'));
        }

        // WebP frames blend against and dispose over their predecessor, so they
        // can only be pulled in order. An uncached frame at or below the cursor
        // means the sequence was interrupted — the player's own cache normally
        // keeps that from happening, but rewinding is the only way back.
        if (this._desynced || index <= this._decodedUpTo) {
            if (!this._backend.reset(this._handle)) {
                return Promise.reject(new Error('failed to rewind the WebP decoder'));
            }
            this._decodedUpTo = -1;
            this._desynced = false;
        }

        for (let f = this._decodedUpTo + 1; f <= index; f++) {
            const data = this._backend.nextFrame(this._handle, this._duration);
            if (!data) {
                this._desynced = true;
                return Promise.reject(new Error(`WebP frame ${f} of ${this.frameCount} failed to decode`));
            }
            this._results[f] = { data, duration: this._duration[0] || DEFAULT_DURATION };
            this._decodedUpTo = f;
        }
        return Promise.resolve(this._results[index]!);
    }

    public destroy (): void {
        if (this._handle) {
            this._backend.close(this._handle);
            this._handle = 0;
        }
        this._results = [];
    }
}

export async function createWebpDecoder (bytes: Uint8Array): Promise<IAnimatedImageDecoder> {
    let backend: IWebpBackend;
    try {
        backend = await loadWebpBackend();
    } catch (e) {
        // The backend is missing rather than broken: an engine without cc.wasm,
        // or a host that cannot reach the .wasm file. Show the first frame
        // instead of failing the whole image — every platform can decode a still
        // WebP. On native loadWebpBackend throws for a missing JSB binding and
        // that surfaces here too, but as a build problem it deserves the warning
        // and the still frame is just as good a stopgap.
        console.warn(`[animated-image] WebP animated decoding unavailable, falling back to the first frame: ${String(e)}`);
        return createStaticDecoder(bytes, 'image/webp');
    }

    const handle = backend.open(bytes);
    if (!handle) {
        throw new Error(`Failed to open WebP image (${bytes.length} bytes)`);
    }
    const info = new Uint32Array(INFO_CELLS);
    if (!backend.getInfo(handle, info)) {
        backend.close(handle);
        throw new Error('Failed to read WebP image info');
    }
    return new WebpDecoder(backend, handle, info[0], info[1], info[2], info[3]);
}
