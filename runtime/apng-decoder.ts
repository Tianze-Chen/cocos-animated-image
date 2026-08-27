import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import zlib from './zlib.min';

const DISPOSE_BACKGROUND = 1;
const DISPOSE_PREVIOUS = 2;

const BLEND_SOURCE = 0;

const COLOR_GRAYSCALE = 0;
const COLOR_RGB = 2;
const COLOR_INDEXED = 3;
const COLOR_GRAYSCALE_ALPHA = 4;
const COLOR_RGBA = 6;

interface IhdrInfo {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
}

interface FrameControl {
    width: number;
    height: number;
    xOffset: number;
    yOffset: number;
    delayNum: number;
    delayDen: number;
    disposeOp: number;
    blendOp: number;
}

interface RawFrame {
    fcTL: FrameControl;
    data: Uint8Array;
}

interface CompositeState {
    canvas: Uint8Array;
    previousCanvas: Uint8Array | null;
}

class ApngDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;

    private _ihdr: IhdrInfo;
    private _rawFrames: RawFrame[];
    private _palette: Uint8Array | null;
    private _transparency: Uint8Array | null;
    private _state: CompositeState;
    private _decodedUpTo = -1;
    private _frames: (IDecodedFrame | undefined)[];

    constructor (
        ihdr: IhdrInfo,
        rawFrames: RawFrame[],
        palette: Uint8Array | null,
        transparency: Uint8Array | null,
        loopCount: number,
    ) {
        this.width = ihdr.width;
        this.height = ihdr.height;
        this.frameCount = rawFrames.length;
        this.loopCount = loopCount;
        this._ihdr = ihdr;
        this._rawFrames = rawFrames;
        this._palette = palette;
        this._transparency = transparency;
        this._frames = new Array<IDecodedFrame | undefined>(rawFrames.length);
        this._state = { canvas: new Uint8Array(ihdr.width * ihdr.height * 4), previousCanvas: null };
    }

    public decodeFrame (index: number): Promise<IDecodedFrame> {
        if (index < 0 || index >= this._frames.length) {
            return Promise.reject(new Error(`frame index ${index} out of range [0, ${this._frames.length})`));
        }
        if (this._frames[index] !== undefined) {
            return Promise.resolve(this._frames[index]!);
        }
        // Composite frames strictly in order; later frames reuse the canvas state.
        for (let f = this._decodedUpTo + 1; f <= index; f++) {
            const raw = this._rawFrames[f];
            this._frames[f] = compositeOneFrame(
                this._state, raw.fcTL, raw.data,
                this.width, this.height, this._ihdr, this._palette, this._transparency,
            );
        }
        this._decodedUpTo = index;
        return Promise.resolve(this._frames[index]!);
    }

    public destroy (): void {
        this._frames = [];
        this._rawFrames = [];
    }
}

export function createApngDecoder (bytes: Uint8Array): IAnimatedImageDecoder {
    const parsed = parsePng(bytes);
    return new ApngDecoder(parsed.ihdr, parsed.rawFrames, parsed.palette, parsed.transparency, parsed.loopCount);
}

interface ParsedPng {
    ihdr: IhdrInfo;
    loopCount: number;
    rawFrames: RawFrame[];
    palette: Uint8Array | null;
    transparency: Uint8Array | null;
}

function parsePng (data: Uint8Array): ParsedPng {
    let pos = 8;
    let ihdr: IhdrInfo | null = null;
    let loopCount = 0;
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;

    const rawFrames: RawFrame[] = [];
    let currentFcTL: FrameControl | null = null;
    let currentDataChunks: Uint8Array[] = [];
    let idatChunks: Uint8Array[] = [];
    let seenFcTLBeforeIDAT = false;

    while (pos + 8 <= data.length) {
        const chunkLen = readU32(data, pos);
        const chunkType = readChunkType(data, pos + 4);
        const chunkDataStart = pos + 8;

        switch (chunkType) {
        case 'IHDR':
            ihdr = {
                width: readU32(data, chunkDataStart),
                height: readU32(data, chunkDataStart + 4),
                bitDepth: data[chunkDataStart + 8],
                colorType: data[chunkDataStart + 9],
            };
            break;

        case 'acTL':
            loopCount = readU32(data, chunkDataStart + 4);
            break;

        case 'fcTL': {
            if (currentFcTL && currentDataChunks.length > 0) {
                rawFrames.push({ fcTL: currentFcTL, data: concatBytes(currentDataChunks) });
                currentDataChunks = [];
            }
            const off = chunkDataStart + 4;
            currentFcTL = {
                width: readU32(data, off),
                height: readU32(data, off + 4),
                xOffset: readU32(data, off + 8),
                yOffset: readU32(data, off + 12),
                delayNum: readU16(data, off + 16),
                delayDen: readU16(data, off + 18),
                disposeOp: data[off + 20],
                blendOp: data[off + 21],
            };
            if (idatChunks.length === 0) {
                seenFcTLBeforeIDAT = true;
            }
            break;
        }

        case 'IDAT':
            idatChunks.push(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
            if (seenFcTLBeforeIDAT) {
                currentDataChunks.push(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
            }
            break;

        case 'fdAT':
            currentDataChunks.push(data.subarray(chunkDataStart + 4, chunkDataStart + chunkLen));
            break;

        case 'PLTE':
            palette = new Uint8Array(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
            break;

        case 'tRNS':
            transparency = new Uint8Array(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
            break;

        case 'IEND':
            if (currentFcTL && currentDataChunks.length > 0) {
                rawFrames.push({ fcTL: currentFcTL, data: concatBytes(currentDataChunks) });
            }
            break;
        }

        pos += 12 + chunkLen;
    }

    if (!ihdr) {
        throw new Error('APNG: missing IHDR chunk');
    }

    return { ihdr, loopCount, rawFrames, palette, transparency };
}

function inflateData (compressed: Uint8Array): Uint8Array {
    const inflate = new zlib.Inflate(compressed, { index: 0, verify: false });
    return inflate.decompress() as Uint8Array;
}

function decodePixels (
    compressed: Uint8Array,
    width: number,
    height: number,
    ihdr: IhdrInfo,
    palette: Uint8Array | null,
    transparency: Uint8Array | null,
): Uint8Array {
    const raw = inflateData(compressed);

    const bpp = bytesPerPixel(ihdr);
    const scanlineBytes = width * bpp;
    const filtered = new Uint8Array(scanlineBytes * height);

    let srcPos = 0;
    let dstPos = 0;
    for (let row = 0; row < height; row++) {
        const filter = raw[srcPos++];
        for (let i = 0; i < scanlineBytes; i++) {
            const curByte = raw[srcPos++];
            const left = i < bpp ? 0 : filtered[dstPos - bpp];
            const up = row === 0 ? 0 : filtered[dstPos - scanlineBytes];
            const upLeft = (row === 0 || i < bpp) ? 0 : filtered[dstPos - scanlineBytes - bpp];

            switch (filter) {
            case 0:
                filtered[dstPos] = curByte;
                break;
            case 1:
                filtered[dstPos] = (curByte + left) & 0xFF;
                break;
            case 2:
                filtered[dstPos] = (curByte + up) & 0xFF;
                break;
            case 3:
                filtered[dstPos] = (curByte + ((left + up) >>> 1)) & 0xFF;
                break;
            case 4:
                filtered[dstPos] = (curByte + paethPredictor(left, up, upLeft)) & 0xFF;
                break;
            }
            dstPos++;
        }
    }

    return toRGBA(filtered, width, height, ihdr, palette, transparency);
}

function bytesPerPixel (ihdr: IhdrInfo): number {
    switch (ihdr.colorType) {
    case COLOR_GRAYSCALE: return Math.max(1, ihdr.bitDepth / 8);
    case COLOR_RGB: return 3 * (ihdr.bitDepth / 8);
    case COLOR_INDEXED: return 1;
    case COLOR_GRAYSCALE_ALPHA: return 2 * (ihdr.bitDepth / 8);
    case COLOR_RGBA: return 4 * (ihdr.bitDepth / 8);
    default: return 4;
    }
}

function paethPredictor (a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function toRGBA (
    pixels: Uint8Array,
    width: number,
    height: number,
    ihdr: IhdrInfo,
    palette: Uint8Array | null,
    transparency: Uint8Array | null,
): Uint8Array {
    const total = width * height;
    const rgba = new Uint8Array(total * 4);

    switch (ihdr.colorType) {
    case COLOR_GRAYSCALE: {
        const transGray = transparency && transparency.length >= 2
            ? ((transparency[0] << 8) | transparency[1]) : -1;
        for (let i = 0; i < total; i++) {
            const v = pixels[i];
            rgba[i * 4] = v;
            rgba[i * 4 + 1] = v;
            rgba[i * 4 + 2] = v;
            rgba[i * 4 + 3] = v === transGray ? 0 : 255;
        }
        break;
    }
    case COLOR_RGB: {
        let transR = -1; let transG = -1; let transB = -1;
        if (transparency && transparency.length >= 6) {
            transR = (transparency[0] << 8) | transparency[1];
            transG = (transparency[2] << 8) | transparency[3];
            transB = (transparency[4] << 8) | transparency[5];
        }
        for (let i = 0; i < total; i++) {
            const r = pixels[i * 3];
            const g = pixels[i * 3 + 1];
            const b = pixels[i * 3 + 2];
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = (r === transR && g === transG && b === transB) ? 0 : 255;
        }
        break;
    }
    case COLOR_INDEXED: {
        if (!palette) {
            throw new Error('APNG: indexed color but no PLTE chunk');
        }
        for (let i = 0; i < total; i++) {
            const idx = pixels[i];
            rgba[i * 4] = palette[idx * 3];
            rgba[i * 4 + 1] = palette[idx * 3 + 1];
            rgba[i * 4 + 2] = palette[idx * 3 + 2];
            rgba[i * 4 + 3] = (transparency && idx < transparency.length) ? transparency[idx] : 255;
        }
        break;
    }
    case COLOR_GRAYSCALE_ALPHA:
        for (let i = 0; i < total; i++) {
            const v = pixels[i * 2];
            rgba[i * 4] = v;
            rgba[i * 4 + 1] = v;
            rgba[i * 4 + 2] = v;
            rgba[i * 4 + 3] = pixels[i * 2 + 1];
        }
        break;
    case COLOR_RGBA:
        rgba.set(pixels);
        break;
    }
    return rgba;
}

function compositeOneFrame (
    state: CompositeState,
    fcTL: FrameControl,
    data: Uint8Array,
    canvasWidth: number,
    canvasHeight: number,
    ihdr: IhdrInfo,
    palette: Uint8Array | null,
    transparency: Uint8Array | null,
): IDecodedFrame {
    const canvas = state.canvas;

    if (fcTL.disposeOp === DISPOSE_PREVIOUS) {
        state.previousCanvas = new Uint8Array(canvas);
    }

    const framePixels = decodePixels(data, fcTL.width, fcTL.height, ihdr, palette, transparency);

    // Per APNG spec, blend_op is honored even for full-canvas frames; forcing
    // SOURCE on full-canvas OVER frames corrupts semi-transparent frames.
    const blendOp = fcTL.blendOp;

    for (let y = 0; y < fcTL.height; y++) {
        for (let x = 0; x < fcTL.width; x++) {
            const cx = fcTL.xOffset + x;
            const cy = fcTL.yOffset + y;
            if (cx >= canvasWidth || cy >= canvasHeight) continue;

            const srcIdx = (y * fcTL.width + x) * 4;
            const dstIdx = (cy * canvasWidth + cx) * 4;

            if (blendOp === BLEND_SOURCE) {
                canvas[dstIdx] = framePixels[srcIdx];
                canvas[dstIdx + 1] = framePixels[srcIdx + 1];
                canvas[dstIdx + 2] = framePixels[srcIdx + 2];
                canvas[dstIdx + 3] = framePixels[srcIdx + 3];
            } else {
                const srcA = framePixels[srcIdx + 3];
                if (srcA === 255) {
                    canvas[dstIdx] = framePixels[srcIdx];
                    canvas[dstIdx + 1] = framePixels[srcIdx + 1];
                    canvas[dstIdx + 2] = framePixels[srcIdx + 2];
                    canvas[dstIdx + 3] = 255;
                } else if (srcA > 0) {
                    const dstA = canvas[dstIdx + 3];
                    const outA = srcA + dstA * (255 - srcA) / 255;
                    if (outA > 0) {
                        canvas[dstIdx] = (framePixels[srcIdx] * srcA + canvas[dstIdx] * dstA * (255 - srcA) / 255) / outA;
                        canvas[dstIdx + 1] = (framePixels[srcIdx + 1] * srcA + canvas[dstIdx + 1] * dstA * (255 - srcA) / 255) / outA;
                        canvas[dstIdx + 2] = (framePixels[srcIdx + 2] * srcA + canvas[dstIdx + 2] * dstA * (255 - srcA) / 255) / outA;
                        canvas[dstIdx + 3] = outA;
                    }
                }
            }
        }
    }

    const delayDen = fcTL.delayDen || 100;
    const duration = (fcTL.delayNum * 1000) / delayDen;

    const frame: IDecodedFrame = {
        data: new Uint8Array(canvas),
        duration: duration || 100,
    };

    switch (fcTL.disposeOp) {
    case DISPOSE_BACKGROUND:
        for (let y = 0; y < fcTL.height; y++) {
            for (let x = 0; x < fcTL.width; x++) {
                const cx = fcTL.xOffset + x;
                const cy = fcTL.yOffset + y;
                if (cx >= canvasWidth || cy >= canvasHeight) continue;
                const dstIdx = (cy * canvasWidth + cx) * 4;
                canvas[dstIdx] = 0;
                canvas[dstIdx + 1] = 0;
                canvas[dstIdx + 2] = 0;
                canvas[dstIdx + 3] = 0;
            }
        }
        break;
    case DISPOSE_PREVIOUS:
        if (state.previousCanvas) {
            canvas.set(state.previousCanvas);
        }
        break;
    }

    return frame;
}

function readU32 (data: Uint8Array, offset: number): number {
    return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU16 (data: Uint8Array, offset: number): number {
    return (data[offset] << 8) | data[offset + 1];
}

function readChunkType (data: Uint8Array, offset: number): string {
    return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
}

function concatBytes (chunks: Uint8Array[]): Uint8Array {
    let totalLen = 0;
    for (let i = 0; i < chunks.length; i++) {
        totalLen += chunks[i].length;
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
        result.set(chunks[i], offset);
        offset += chunks[i].length;
    }
    return result;
}
