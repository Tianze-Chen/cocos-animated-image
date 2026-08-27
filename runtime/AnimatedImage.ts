import {
    _decorator,
    Component,
    Sprite,
    BufferAsset,
    ImageAsset,
    SpriteFrame,
    ccenum,
} from 'cc';
import { AnimatedImagePlayer } from './AnimatedImagePlayer';
import { describeResponse, toBytes } from './bytes';
import { sniffMime, UNKNOWN_MIME } from './mime-sniff';

const { ccclass, property, menu, requireComponent, executeInEditMode } = _decorator;

export enum AnimatedImageSourceType {
    LOCAL = 0,
    REMOTE = 1,
    IMAGE = 2,
}
ccenum(AnimatedImageSourceType);

@ccclass('AnimatedImage')
@menu('AnimatedImage')
@requireComponent(Sprite)
@executeInEditMode
export class AnimatedImage extends Component {
    @property({ visible: false })
    protected _sourceType = AnimatedImageSourceType.IMAGE;
    @property({ type: BufferAsset, visible: false })
    protected _clip: BufferAsset | null = null;
    @property({ type: ImageAsset, visible: false })
    protected _image: ImageAsset | null = null;
    @property({ visible: false })
    protected _remoteURL = '';
    @property({ visible: false })
    protected _playOnAwake = true;
    @property({ visible: false })
    protected _loop = true;
    @property({ visible: false })
    protected _playbackRate = 1;

    protected _player: AnimatedImagePlayer | null = null;
    protected _sprite: Sprite | null = null;
    protected _loadToken = 0;

    @property({ type: AnimatedImageSourceType, tooltip: 'Source type: LOCAL (BufferAsset), REMOTE (URL), or IMAGE (ImageAsset).' })
    get sourceType (): AnimatedImageSourceType {
        return this._sourceType;
    }
    set sourceType (val) {
        if (this._sourceType !== val) {
            this._sourceType = val;
            this._reload();
        }
    }

    @property({
        type: BufferAsset,
        tooltip: 'The local buffer asset holding the encoded animated image bytes.',
        visible (this: AnimatedImage) { return this._sourceType === AnimatedImageSourceType.LOCAL; },
    })
    get clip (): BufferAsset | null {
        return this._clip;
    }
    set clip (val) {
        if (this._clip !== val) {
            this._clip = val;
            this._reload();
        }
    }

    @property({
        type: ImageAsset,
        tooltip: 'The image asset to play.',
        visible (this: AnimatedImage) { return this._sourceType === AnimatedImageSourceType.IMAGE; },
    })
    get image (): ImageAsset | null {
        return this._image;
    }
    set image (val) {
        if (this._image !== val) {
            this._image = val;
            this._reload();
        }
    }

    @property({
        tooltip: 'The remote URL of the animated image (used when sourceType is REMOTE).',
        visible (this: AnimatedImage) { return this._sourceType === AnimatedImageSourceType.REMOTE; },
    })
    get remoteURL (): string {
        return this._remoteURL;
    }
    set remoteURL (val: string) {
        if (this._remoteURL !== val) {
            this._remoteURL = val;
            this._reload();
        }
    }

    @property({ tooltip: 'Whether to start playing automatically after the image is loaded.' })
    get playOnAwake (): boolean {
        return this._playOnAwake;
    }
    set playOnAwake (value) {
        this._playOnAwake = value;
    }

    @property({ tooltip: 'Whether the animation loops.' })
    get loop (): boolean {
        return this._loop;
    }
    set loop (value) {
        this._loop = value;
        if (this._player) {
            this._player.loop = value;
        }
    }

    @property({ slide: true, range: [0.0, 10.0, 0.1], tooltip: 'Playback rate. Range: [0.0, 10.0].' })
    get playbackRate (): number {
        return this._playbackRate;
    }
    set playbackRate (value: number) {
        this._playbackRate = value;
    }

    public static SourceType = AnimatedImageSourceType;

    get frameCount (): number {
        return this._player ? this._player.frameCount : 0;
    }

    get currentFrame (): number {
        return this._player ? this._player.currentFrame : 0;
    }

    get duration (): number {
        return this._player ? this._player.duration : 0;
    }

    get isPlaying (): boolean {
        return !!this._player && this._player.state === 1;
    }

    get player (): AnimatedImagePlayer | null {
        return this._player;
    }

    public onLoad (): void {
        this._sprite = this.getComponent(Sprite);
        this._reload();
    }

    public onEnable (): void {
        if (this._player && this._playOnAwake) {
            this._player.play();
        }
    }

    public onDisable (): void {
        if (this._player) {
            this._player.pause();
        }
    }

    public onDestroy (): void {
        this._loadToken++;
        this._destroyPlayer();
        this._sprite = null;
    }

    public update (dt: number): void {
        if (this._player) {
            this._player.tick(dt * this._playbackRate);
        }
    }

    public play (): void {
        this._player?.play();
    }

    public resume (): void {
        this._player?.resume();
    }

    public pause (): void {
        this._player?.pause();
    }

    public stop (): void {
        this._player?.stop();
    }

    public seekToFrame (index: number): void {
        this._player?.seekToFrame(index);
    }

    protected _reload (): void {
        if (!this.node) {
            return;
        }
        const token = ++this._loadToken;
        this._destroyPlayer();

        const onBytes = (bytes: Uint8Array | null): void => {
            if (token !== this._loadToken || !this.node || !bytes) {
                return;
            }
            const mime = sniffMime(bytes);
            this._createPlayerFromBytes(bytes, mime, token);
        };

        if (this._sourceType === AnimatedImageSourceType.REMOTE) {
            if (!this._remoteURL) {
                return;
            }
            this._downloadFromUrl(this._remoteURL, onBytes);
        } else if (this._sourceType === AnimatedImageSourceType.IMAGE) {
            const url = this._image ? this._image.nativeUrl : '';
            if (!url) {
                return;
            }
            this._downloadFromUrl(url, onBytes);
        } else {
            if (!this._clip || !this._clip.validate()) {
                return;
            }
            const buffer = this._clip.buffer();
            if (!buffer) {
                return;
            }
            onBytes(new Uint8Array(buffer));
        }
    }

    protected _downloadFromUrl (url: string, onBytes: (bytes: Uint8Array | null) => void): void {
        // WeChat / Sud shells: wx.downloadFile preserves binary bytes; their XHR may
        // decode binary as UTF-8 text (unrecoverable). Other platforms keep XHR.
        const wxApi = (globalThis as { wx?: any }).wx;
        if (wxApi && typeof wxApi.downloadFile === 'function') {
            this._downloadFromUrlViaWx(url, onBytes, wxApi);
        } else {
            this._downloadFromUrlViaXhr(url, onBytes);
        }
    }

    private _downloadFromUrlViaWx (url: string, onBytes: (bytes: Uint8Array | null) => void, wxApi: any): void {
        wxApi.downloadFile({
            url,
            success: (res: any): void => {
                if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 0) {
                    const fs = typeof wxApi.getFileSystemManager === 'function' ? wxApi.getFileSystemManager() : null;
                    if (fs && typeof fs.readFile === 'function') {
                        fs.readFile({
                            filePath: res.tempFilePath,
                            success: (r: any): void => {
                                this._handleDownloadedBytes(url, toBytes(r && r.data), r && r.data, onBytes);
                            },
                            fail: (): void => {
                                console.warn(`AnimatedImage: wx.readFile failed for ${url}`);
                                onBytes(null);
                            },
                        });
                    } else {
                        console.warn('[AnimatedImage] wx.getFileSystemManager unavailable, falling back to XHR');
                        this._downloadFromUrlViaXhr(url, onBytes);
                    }
                } else {
                    console.warn(`AnimatedImage: wx.downloadFile HTTP ${res.statusCode} for ${url}`);
                    onBytes(null);
                }
            },
            fail: (): void => {
                console.warn(`AnimatedImage: wx.downloadFile failed for ${url}, falling back to XHR`);
                this._downloadFromUrlViaXhr(url, onBytes);
            },
        });
    }

    private _downloadFromUrlViaXhr (url: string, onBytes: (bytes: Uint8Array | null) => void): void {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = (): void => {
            if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
                // Mini-game shells may return binary as a string even with
                // responseType='arraybuffer'; toBytes normalizes every shape.
                this._handleDownloadedBytes(url, toBytes(xhr.response), xhr.response, onBytes);
            } else {
                console.warn(`AnimatedImage: HTTP ${xhr.status} for ${url}`);
            }
        };
        xhr.onerror = (): void => {
            console.warn(`AnimatedImage failed to download ${url}`);
        };
        xhr.send();
    }

    private _handleDownloadedBytes (
        url: string,
        bytes: Uint8Array | null,
        response: unknown,
        onBytes: (bytes: Uint8Array | null) => void,
    ): void {
        if (bytes && sniffMime(bytes) === UNKNOWN_MIME) {
            const hex = (b: number): string => (b < 16 ? '0' : '') + b.toString(16);
            console.warn(
                `[AnimatedImage] Undetectable image bytes for ${url}: `
                + `response=${describeResponse(response)}, first 16B=`
                + `${Array.from(bytes.slice(0, 16)).map(hex).join(' ')}`,
            );
        }
        onBytes(bytes);
    }

    protected _createPlayerFromBytes (bytes: Uint8Array, mime: string, token: number): void {
        AnimatedImagePlayer.create(bytes, mime).then((player) => {
            if (token !== this._loadToken || !this.node) {
                player.destroy();
                return;
            }
            player.loop = this._loop;
            this._player = player;
            if (this._sprite) {
                this._sprite.spriteFrame = player.spriteFrame;
            }
            if (this._playOnAwake && this.enabledInHierarchy) {
                player.play();
            }
        }).catch((e: unknown) => {
            console.warn(`AnimatedImage failed to create player: ${String(e)}`);
            if (e && (e as { stack?: string }).stack) {
                console.warn(`AnimatedImage player creation stack:\n${(e as { stack: string }).stack}`);
            }
        });
    }

    protected _destroyPlayer (): void {
        if (this._player) {
            this._player.destroy();
            this._player = null;
        }
        if (this._sprite) {
            this._sprite.spriteFrame = null;
        }
    }
}
