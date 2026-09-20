// OverlayAnimatedImage —— worker-offscreen 变体的场景组件（「无 Sprite 的动图」）。
//
// 与 AnimatedImage 的区别：本组件不进引擎渲染 —— 没有 Sprite、没有纹理、没有 update()，
// 帧的解码与时钟推进全在 decoder worker 里（见 worker/overlay-compositor.ts），画面直接
// 画在 DOM overlay canvas 上（见 runtime/overlay-manager.ts）。主线程每帧成本归零。
// 本组件只做三件事：①把 clip 字节交给 OverlayManager attach（投影 node 世界矩形到 overlay）；
// ②转译控制语义（pause/resume → overlay-set-state）；③onDestroy → detach。
//
// 对外保持与 AnimatedImage 相同的鸭子接口（pause/resume/currentFrame/frameCount），
// 消费方（AnimatedImageTest 等）联合类型零特判。currentFrame 由 manager 从 overlay-stats
// 的 framesByHandle 回写，-1 起步（attach 完成前）。
//
// 降级自愈：宿主不支持 overlay（微信：Worker V2 未灰度，transfer 列表被拒）或 manager 会话
// broken 时，fallback() 原地补挂 Sprite+AnimatedImage（LOCAL/clip/loop 同参）后自毁 ——
// 场景里看起来就是普通动图，forceWorkerDecoder 仍为 true，降级后走 worker copy 解码。

import { _decorator, BufferAsset, Component, UITransform } from 'cc';
import { AnimatedImage } from './AnimatedImage';
import { overlayManager } from './overlay-manager';

const { ccclass, requireComponent } = _decorator;

@ccclass('OverlayAnimatedImage')
@requireComponent(UITransform)
export class OverlayAnimatedImage extends Component {
    // 运行时专用组件（测试代码 addComponent 后设属性），不做序列化 —— 全部普通存取器。
    private _clip: BufferAsset | null = null;
    private _loop = true;
    private _playOnAwake = true;
    private _playing = true;
    private _handle = -1;
    private _frameCount = 0;
    private _currentFrame = -1;
    private _attachStarted = false;

    /** attach 竞态令牌：onDestroy/fallback 递增，manager 在每个 await 后校验（组件销毁则补发 detach）。 */
    public attachToken = 0;

    get clip (): BufferAsset | null {
        return this._clip;
    }
    set clip (value: BufferAsset | null) {
        this._clip = value;
        this._kickAttach();
    }

    get loop (): boolean {
        return this._loop;
    }
    set loop (value: boolean) {
        this._loop = value;
        if (this._handle >= 0) {
            overlayManager.setState(this._handle, this._playing, this._loop);
        }
    }

    get playOnAwake (): boolean {
        return this._playOnAwake;
    }
    set playOnAwake (value: boolean) {
        this._playOnAwake = value;
    }

    // --- 鸭子接口（与 AnimatedImage 对齐；framesByHandle 回写） ---

    /** 当前帧号，-1 = attach 尚未完成（消费方展示需自行兼容，如 Math.max(0, currentFrame)）。 */
    get currentFrame (): number {
        return this._currentFrame;
    }

    get frameCount (): number {
        return this._frameCount;
    }

    get playing (): boolean {
        return this._playing;
    }

    public pause (): void {
        this._playing = false;
        if (this._handle >= 0) {
            overlayManager.setState(this._handle, false, this._loop);
        }
    }

    public resume (): void {
        this._playing = true;
        if (this._handle >= 0) {
            overlayManager.setState(this._handle, true, this._loop);
        }
    }

    public onLoad (): void {
        this._kickAttach();
    }

    public onDestroy (): void {
        this.attachToken++;   // 作废在途 attach
        if (this._handle >= 0) {
            overlayManager.detach(this._handle);
            this._handle = -1;
        }
    }

    // --- manager 专用回写 ---

    /** clip 字节（与 AnimatedImage LOCAL 路径同一套校验）。null = 无可用载荷，manager 会降级。 */
    public overlayBytes (): Uint8Array | null {
        if (!this._clip || !this._clip.validate()) { return null; }
        const buffer = this._clip.buffer();
        return buffer ? new Uint8Array(buffer) : null;
    }

    /** manager 专用：attach 成功回填 handle 与帧数。 */
    public onAttached (handle: number, frameCount: number): void {
        this._handle = handle;
        this._frameCount = frameCount;
    }

    /** manager 专用：overlay-stats 的 framesByHandle 回写当前帧号。 */
    public setCurrentFrame (frame: number): void {
        this._currentFrame = frame;
    }

    /** 原地降级：同 node 补挂 Sprite+AnimatedImage（requireComponent 自动补 Sprite），同参自毁。
     *  manager 侧保证只在 attach 失败/会话 broken/宿主不支持时调用，不重复（自毁即终态）。 */
    public fallback (): void {
        if (!this.isValid || !this.node) { return; }
        this.attachToken++;   // 作废在途 attach
        if (this._handle >= 0) {
            overlayManager.detach(this._handle);
            this._handle = -1;
        }
        const anim = this.node.addComponent(AnimatedImage);
        anim.sourceType = AnimatedImage.SourceType.LOCAL;
        anim.clip = this._clip;
        anim.loop = this._loop;
        if (!this._playing) {
            // 已暂停的实例降级后也保持暂停（AnimatedImage.onEnable 会按 playOnAwake 起播）。
            anim.playOnAwake = false;
        }
        this.node.removeComponent(this);
    }

    private _kickAttach (): void {
        if (this._attachStarted || !this._clip || !this.node) { return; }
        this._attachStarted = true;
        this._playing = this._playOnAwake;
        overlayManager.attach(this);   // 失败路径全部由 manager 落在本组件 fallback() 上
    }
}
