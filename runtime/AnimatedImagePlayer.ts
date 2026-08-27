import { createAnimatedDecoder, isNativeAnimatedSupported } from './image-decoder';
import type { IAnimatedImageDecoder, IDecodedFrame } from './types';
import { Texture2D, SpriteFrame } from 'cc';

export enum AnimatedImagePlayerState {
    INIT,
    PLAYING,
    PAUSED,
    STOPPED,
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

        this._requestFrame(0);
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
            this._requestFrame(0);
        }
        this._state = AnimatedImagePlayerState.PLAYING;
    }

    public pause (): void {
        if (this._state === AnimatedImagePlayerState.PLAYING) {
            this._state = AnimatedImagePlayerState.PAUSED;
        }
    }

    public resume (): void {
        if (this._state === AnimatedImagePlayerState.PAUSED) {
            this._state = AnimatedImagePlayerState.PLAYING;
        }
    }

    public stop (): void {
        this._state = AnimatedImagePlayerState.STOPPED;
        this._currentFrame = 0;
        this._accumMs = 0;
        this._requestFrame(0);
    }

    public seekToFrame (index: number): void {
        if (this._destroyed) { return; }
        const clamped = Math.max(0, Math.min(index, this.frameCount - 1));
        this._currentFrame = clamped;
        this._accumMs = 0;
        this._requestFrame(clamped);
    }

    public tick (dt: number): void {
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
            const existing = this._frameCache[index];
            if (existing) {
                this._frameCacheBytes -= existing.data.byteLength;
            } else {
                this._cachedFrameCount++;
            }
            this._frameCache[index] = decoded;
            this._frameCacheBytes += decoded.data.byteLength;
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
