import type { IAnimatedImageDecoder, IDecodedFrame } from './types';

const DISPOSE_NONE = 0;
const DISPOSE_BACKGROUND = 2;
const DISPOSE_PREVIOUS = 3;

interface GifFrameInfo {
    left: number;
    top: number;
    width: number;
    height: number;
    localColorTable: Uint8Array | null;
    interlaced: boolean;
    disposalMethod: number;
    transparentIndex: number;
    delay: number;
    lzwMinCodeSize: number;
    dataBlocks: Uint8Array[];
}

class GifDecoder implements IAnimatedImageDecoder {
    public readonly width: number;
    public readonly height: number;
    public readonly frameCount: number;
    public readonly loopCount: number;

    private _frames: GifFrameInfo[];
    private _globalColorTable: Uint8Array | null;
    private _state: { canvas: Uint8Array; previousCanvas: Uint8Array | null };
    private _decodedUpTo = -1;
    private _results: (IDecodedFrame | undefined)[];

    constructor (
        width: number,
        height: number,
        loopCount: number,
        frames: GifFrameInfo[],
        globalColorTable: Uint8Array | null,
    ) {
        this.width = width;
        this.height = height;
        this.frameCount = frames.length;
        this.loopCount = loopCount;
        this._frames = frames;
        this._globalColorTable = globalColorTable;
        this._results = new Array<IDecodedFrame | undefined>(frames.length);
        this._state = { canvas: new Uint8Array(width * height * 4), previousCanvas: null };
    }

    public decodeFrame (index: number): Promise<IDecodedFrame> {
        if (index < 0 || index >= this._results.length) {
            return Promise.reject(new Error(`frame index ${index} out of range [0, ${this._results.length})`));
        }
        if (this._results[index] !== undefined) {
            return Promise.resolve(this._results[index]!);
        }
        // Composite frames strictly in order; later frames reuse the canvas state.
        for (let f = this._decodedUpTo + 1; f <= index; f++) {
            this._results[f] = compositeOneGifFrame(
                this._state, this._frames[f], this.width, this.height, this._globalColorTable,
            );
        }
        this._decodedUpTo = index;
        return Promise.resolve(this._results[index]!);
    }

    public destroy (): void {
        this._results = [];
        this._frames = [];
    }
}

export function createGifDecoder (bytes: Uint8Array): IAnimatedImageDecoder {
    const parser = new GifParser(bytes);
    parser.parse();
    return new GifDecoder(parser.width, parser.height, parser.loopCount, parser.frames, parser.globalColorTable);
}

class GifParser {
    public width = 0;
    public height = 0;
    public loopCount = 0;
    public globalColorTable: Uint8Array | null = null;
    public bgColorIndex = 0;
    public frames: GifFrameInfo[] = [];

    private _data: Uint8Array;
    private _pos = 0;

    private _gceDisposal = 0;
    private _gceTransparent = -1;
    private _gceDelay = 0;

    constructor (data: Uint8Array) {
        this._data = data;
    }

    public parse (): void {
        this._parseHeader();
        this._parseLogicalScreenDescriptor();
        this._parseBlocks();
    }

    private _parseHeader (): void {
        this._pos = 6;
    }

    private _parseLogicalScreenDescriptor (): void {
        this.width = this._readU16();
        this.height = this._readU16();
        const packed = this._data[this._pos++];
        this.bgColorIndex = this._data[this._pos++];
        this._pos++;

        const hasGCT = (packed & 0x80) !== 0;
        const gctSize = 1 << ((packed & 0x07) + 1);
        if (hasGCT) {
            this.globalColorTable = this._readBytes(gctSize * 3);
        }
    }

    private _parseBlocks (): void {
        const data = this._data;
        while (this._pos < data.length) {
            const introducer = data[this._pos++];
            switch (introducer) {
            case 0x2C:
                this._parseImageDescriptor();
                break;
            case 0x21:
                this._parseExtension();
                break;
            case 0x3B:
                return;
            default:
                return;
            }
        }
    }

    private _parseExtension (): void {
        const label = this._data[this._pos++];
        switch (label) {
        case 0xF9:
            this._parseGCE();
            break;
        case 0xFF:
            this._parseApplicationExtension();
            break;
        default:
            this._skipSubBlocks();
            break;
        }
    }

    private _parseGCE (): void {
        this._pos++;
        const packed = this._data[this._pos++];
        this._gceDisposal = (packed >>> 2) & 0x07;
        const hasTransparency = (packed & 0x01) !== 0;
        this._gceDelay = this._readU16() * 10;
        const transparentIndex = this._data[this._pos++];
        this._gceTransparent = hasTransparency ? transparentIndex : -1;
        this._pos++;
    }

    private _parseApplicationExtension (): void {
        const blockSize = this._data[this._pos++];
        if (blockSize === 11) {
            const id = String.fromCharCode(
                this._data[this._pos], this._data[this._pos + 1], this._data[this._pos + 2],
                this._data[this._pos + 3], this._data[this._pos + 4], this._data[this._pos + 5],
                this._data[this._pos + 6], this._data[this._pos + 7],
                this._data[this._pos + 8], this._data[this._pos + 9], this._data[this._pos + 10],
            );
            this._pos += 11;
            if (id === 'NETSCAPE2.0') {
                const subBlockSize = this._data[this._pos++];
                if (subBlockSize === 3 && this._data[this._pos] === 1) {
                    this._pos++;
                    this.loopCount = this._readU16();
                    this._pos++;
                    return;
                }
                this._pos--;
            }
        } else {
            this._pos += blockSize;
        }
        this._skipSubBlocks();
    }

    private _parseImageDescriptor (): void {
        const left = this._readU16();
        const top = this._readU16();
        const width = this._readU16();
        const height = this._readU16();
        const packed = this._data[this._pos++];
        const hasLocalCT = (packed & 0x80) !== 0;
        const interlaced = (packed & 0x40) !== 0;
        const lctSize = 1 << ((packed & 0x07) + 1);

        let localColorTable: Uint8Array | null = null;
        if (hasLocalCT) {
            localColorTable = this._readBytes(lctSize * 3);
        }

        const lzwMinCodeSize = this._data[this._pos++];
        const dataBlocks = this._collectSubBlocks();

        const frame: GifFrameInfo = {
            left,
            top,
            width,
            height,
            localColorTable,
            interlaced,
            disposalMethod: this._gceDisposal,
            transparentIndex: this._gceTransparent,
            delay: this._gceDelay || 100,
            lzwMinCodeSize,
            dataBlocks,
        };

        this.frames.push(frame);

        this._gceDisposal = 0;
        this._gceTransparent = -1;
        this._gceDelay = 0;
    }

    private _collectSubBlocks (): Uint8Array[] {
        const blocks: Uint8Array[] = [];
        while (true) {
            const size = this._data[this._pos++];
            if (size === 0) break;
            blocks.push(this._data.subarray(this._pos, this._pos + size));
            this._pos += size;
        }
        return blocks;
    }

    private _skipSubBlocks (): void {
        while (true) {
            const size = this._data[this._pos++];
            if (size === 0) break;
            this._pos += size;
        }
    }

    private _readU16 (): number {
        const val = this._data[this._pos] | (this._data[this._pos + 1] << 8);
        this._pos += 2;
        return val;
    }

    private _readBytes (count: number): Uint8Array {
        const result = new Uint8Array(count);
        result.set(this._data.subarray(this._pos, this._pos + count));
        this._pos += count;
        return result;
    }
}

function lzwDecode (minCodeSize: number, blocks: Uint8Array[], pixelCount: number): Uint8Array {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const maxTableSize = 4096;

    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;
    let nextCode = eoiCode + 1;

    // Flatten sub-blocks into a single buffer for faster bit reading.
    let totalLen = 0;
    for (let i = 0; i < blocks.length; i++) {
        totalLen += blocks[i].length;
    }
    const flat = new Uint8Array(totalLen);
    let fo = 0;
    for (let i = 0; i < blocks.length; i++) {
        flat.set(blocks[i], fo);
        fo += blocks[i].length;
    }
    const flatLen = flat.length;

    // Prefix/suffix table: O(1) dictionary insertion (no per-entry array copies).
    const prefix = new Int32Array(maxTableSize);
    const suffix = new Uint8Array(maxTableSize);
    const first = new Uint8Array(maxTableSize);
    for (let i = 0; i < clearCode; i++) {
        prefix[i] = -1;
        suffix[i] = i;
        first[i] = i;
    }

    const output = new Uint8Array(pixelCount);
    const stack = new Uint8Array(maxTableSize);
    let outPos = 0;

    let bytePos = 0;
    let bitBuf = 0;
    let bitsAvail = 0;

    function readCode (): number {
        while (bitsAvail < codeSize) {
            if (bytePos < flatLen) {
                bitBuf |= flat[bytePos++] << bitsAvail;
                bitsAvail += 8;
            } else {
                return eoiCode;
            }
        }
        const code = bitBuf & codeMask;
        bitBuf >>>= codeSize;
        bitsAvail -= codeSize;
        return code;
    }

    function resetTable (): void {
        codeSize = minCodeSize + 1;
        codeMask = (1 << codeSize) - 1;
        nextCode = eoiCode + 1;
    }

    // Reconstruct the string for `code` by walking the prefix chain onto a stack,
    // then popping it in order. `tail` (optional) appends one extra byte at the end
    // and is used for the KwKwK case (code === nextCode).
    function emit (code: number, tail = -1): void {
        let sp = 0;
        if (tail >= 0) {
            stack[sp++] = tail;
        }
        let cur = code;
        while (cur >= 0 && prefix[cur] >= 0) {
            stack[sp++] = suffix[cur];
            cur = prefix[cur];
        }
        if (cur >= 0) {
            stack[sp++] = suffix[cur];
        }
        while (sp > 0 && outPos < pixelCount) {
            output[outPos++] = stack[--sp];
        }
    }

    let code = readCode();
    if (code === clearCode) {
        resetTable();
        code = readCode();
    }
    if (code === eoiCode || code >= nextCode) {
        return output;
    }

    let prev = code;
    emit(code);

    while (outPos < pixelCount) {
        code = readCode();
        if (code === eoiCode) break;
        if (code === clearCode) {
            resetTable();
            code = readCode();
            if (code === eoiCode) break;
            prev = code;
            emit(code);
            continue;
        }

        let entryCode: number;
        let firstChar: number;
        if (code < nextCode) {
            entryCode = code;
            firstChar = first[code];
            emit(code);
        } else if (code === nextCode) {
            entryCode = code;
            firstChar = first[prev];
            emit(prev, first[prev]);
        } else {
            break;
        }

        if (nextCode < maxTableSize) {
            prefix[nextCode] = prev;
            suffix[nextCode] = firstChar;
            first[nextCode] = first[prev];
            nextCode++;

            if (nextCode > codeMask && codeSize < 12) {
                codeSize++;
                codeMask = (1 << codeSize) - 1;
            }
        }

        prev = entryCode;
    }

    return output;
}

function deinterlace (pixels: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(pixels.length);
    const offsets = [0, 4, 2, 1];
    const steps = [8, 8, 4, 2];
    let srcRow = 0;
    for (let pass = 0; pass < 4; pass++) {
        for (let y = offsets[pass]; y < height; y += steps[pass]) {
            const srcOff = srcRow * width;
            const dstOff = y * width;
            result.set(pixels.subarray(srcOff, srcOff + width), dstOff);
            srcRow++;
        }
    }
    return result;
}

function compositeOneGifFrame (
    state: { canvas: Uint8Array; previousCanvas: Uint8Array | null },
    frame: GifFrameInfo,
    canvasWidth: number,
    canvasHeight: number,
    globalColorTable: Uint8Array | null,
): IDecodedFrame {
    const canvas = state.canvas;

    if (frame.disposalMethod === DISPOSE_PREVIOUS) {
        state.previousCanvas = new Uint8Array(canvas);
    }

    const colorTable = frame.localColorTable || globalColorTable;
    if (!colorTable) {
        throw new Error('GIF frame has no color table');
    }

    let indexedPixels = lzwDecode(frame.lzwMinCodeSize, frame.dataBlocks, frame.width * frame.height);
    if (frame.interlaced) {
        indexedPixels = deinterlace(indexedPixels, frame.width, frame.height);
    }

    // 预计算 调色板 → 打包 RGBA（Uint32 小端 0xRRGGBBAA），合成用单次 4 字节写入
    const tableSize = colorTable.length / 3;
    const table32 = new Uint32Array(256);
    for (let i = 0; i < tableSize; i++) {
        const r = colorTable[i * 3];
        const g = colorTable[i * 3 + 1];
        const b = colorTable[i * 3 + 2];
        const a = (i === frame.transparentIndex) ? 0 : 255;
        table32[i] = r | (g << 8) | (b << 16) | (a << 24);
    }
    const canvas32 = new Uint32Array(canvas.buffer, canvas.byteOffset, canvas.byteLength >> 2);
    const trans = frame.transparentIndex;
    const isFullCanvas = frame.left === 0 && frame.top === 0
        && frame.width === canvasWidth && frame.height === canvasHeight;

    if (isFullCanvas) {
        const n = frame.width * frame.height;
        if (trans < 0) {
            for (let p = 0; p < n; p++) {
                canvas32[p] = table32[indexedPixels[p]];
            }
        } else {
            for (let p = 0; p < n; p++) {
                const c = indexedPixels[p];
                if (c !== trans) {
                    canvas32[p] = table32[c];
                }
            }
        }
    } else {
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const c = indexedPixels[y * frame.width + x];
                if (c === trans) continue;
                const cx = frame.left + x;
                const cy = frame.top + y;
                if (cx >= canvasWidth || cy >= canvasHeight) continue;
                canvas32[cy * canvasWidth + cx] = table32[c];
            }
        }
    }

    const frameData: IDecodedFrame = {
        data: new Uint8Array(canvas),
        duration: frame.delay,
    };

    switch (frame.disposalMethod) {
    case DISPOSE_BACKGROUND:
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const cx = frame.left + x;
                const cy = frame.top + y;
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

    return frameData;
}
