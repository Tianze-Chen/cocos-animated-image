// OverlayManager —— worker-offscreen 变体的主线程侧单例（仅浏览器宿主）。
//
// 职责：建一块 DOM overlay canvas（绝对定位盖在引擎画布上、pointer-events:none），
// transferControlToOffscreen 后把控制权 transfer 给 decoder worker —— 之后「画」这件事
// 整体发生在 worker 里（overlay-compositor 自驱时钟推帧、直接画这块画布），主线程每帧
// 成本归零：没有每帧 postMessage、没有 texture.uploadData、动图不进引擎渲染。
// 本类只做生命周期与几何：attach（投影节点世界矩形到 overlay 坐标）、resize（窗口变化
// 后重投影）、overlay-stats 收包扇出采样、set-state/detach 单向通知。
//
// 会话状态机：idle → init（Promise 去重，transferControlToOffscreen 一次性）→ ready；
// 任一环节失败 → broken（会话级缓存永不重试，transfer 过的 canvas 也无法重bind），
// 已挂实例全部降级 Sprite+AnimatedImage（forceWorkerDecoder=true 保证降级后仍走 worker
// copy，worker 家族口径连续）。
//
// 微信宿主（Worker V2 未灰度：transfer 列表被拒）在能力门就被拦下走降级 —— overlay 是
// 纯增量协议，worker 侧 overlay 分支只在收到 overlay-canvas 请求后才会执行。
//
// 消息通道约束：worker.onMessage 是单槽（已被 WorkerDecodeService 占用），本类绝不碰
// raw handle —— 无 id 的 overlay-* 通知经 service.onNotification 分发泵转发进来。

import { game, screen, Canvas as UICanvas, UITransform, Vec3 } from 'cc';
import type { Node } from 'cc';
import { emitSample, getDecodeService, WorkerDecodeService } from './worker-decoder';
import { isBrowserWorkerAvailable } from './worker-transport';
import { sniffMime } from './mime-sniff';
import { WORKER_SUPPORTED_MIMES } from './worker-protocol';
import type { OverlayPlacement, OverlayRect, WorkerOverlayNote } from './worker-protocol';
import type { OverlayAnimatedImage } from './OverlayAnimatedImage';

type SessionState = 'idle' | 'init' | 'ready' | 'broken';

/** 等一帧（浏览器宿主才有 rAF；attach 投影前等世界矩阵稳定用）。 */
function nextFrame (): Promise<void> {
    return new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
}

class OverlayManager {
    private _state: SessionState = 'idle';
    private _initPromise: Promise<boolean> | null = null;
    private _service: WorkerDecodeService | null = null;
    private _canvas: HTMLCanvasElement | null = null;
    /** overlay backing store 当前尺寸（= 引擎画布物理像素，worker 侧同值权威）。 */
    private _overlayWidth = 1;
    private _overlayHeight = 1;
    /** worker handle → 组件（投影/回写 currentFrame 都按这张表找人）。 */
    private _entries = new Map<number, OverlayAnimatedImage>();
    private _hostGate: boolean | null = null;

    /** 箭头字段保证引用恒定（screen.on/off 同引用配对）。resize 当拍读到的可能还是旧值，延后一帧。 */
    private _onResize = (): void => {
        requestAnimationFrame(() => { this._applyResize(); });
    };

    public get state (): SessionState {
        return this._state;
    }

    /** 宿主能力门：浏览器 worker + DOM + transferControlToOffscreen（微信在此被拦下）。 */
    private _checkHost (): boolean {
        if (this._hostGate !== null) { return this._hostGate; }
        const g = globalThis as {
            document?: unknown;
            HTMLCanvasElement?: { prototype?: { transferControlToOffscreen?: unknown } };
        };
        this._hostGate = isBrowserWorkerAvailable()
            && typeof g.document === 'object' && g.document !== null
            && !!g.HTMLCanvasElement
            && typeof g.HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
        return this._hostGate;
    }

    /** ready=true / 失败 false（含会话级缓存）。并发调用经 _initPromise 去重。 */
    public ensureReady (): Promise<boolean> {
        if (this._state === 'ready') { return Promise.resolve(true); }
        if (this._state === 'broken') { return Promise.resolve(false); }
        if (!this._initPromise) {
            this._state = 'init';
            this._initPromise = this._init().then(() => {
                this._state = 'ready';
                return true;
            }, (e) => {
                this._break(`初始化失败: ${String(e)}`);
                return false;
            });
        }
        return this._initPromise;
    }

    private async _init (): Promise<boolean> {
        if (!this._checkHost()) {
            // 预期能力差异（微信/原生），不算故障 —— 一行说明即可，不刷屏。
            console.log('[animated-image] 当前宿主不支持 overlay 合成（需浏览器 worker + canvas.transferControlToOffscreen），worker-offscreen 实例走 Sprite+AnimatedImage 降级');
            return false;
        }
        const service = await getDecodeService();
        if (!service) { throw new Error('解码 worker 不可用'); }
        const gameCanvas = game.canvas as HTMLCanvasElement | null;
        const parent = gameCanvas && gameCanvas.parentElement;
        if (!gameCanvas || !parent) { throw new Error('找不到引擎画布/容器（game.canvas 未就绪？）'); }

        // DOM overlay：与 GameCanvas 同父、紧随其后的兄弟 —— 两个兄弟共享 offsetParent，
        // left/top 直接用 GameCanvas 的 offset 值即可落在同一位置；宽高用 CSS 盒（显示尺寸），
        // backing store 用物理像素（与引擎画布一致，worldToScreen 的投影单位就是它）。
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.left = `${gameCanvas.offsetLeft}px`;
        canvas.style.top = `${gameCanvas.offsetTop}px`;
        canvas.style.width = `${gameCanvas.clientWidth}px`;
        canvas.style.height = `${gameCanvas.clientHeight}px`;
        canvas.width = gameCanvas.width;
        canvas.height = gameCanvas.height;
        parent.insertBefore(canvas, gameCanvas.nextSibling);
        try {
            // transferControlToOffscreen 一次性（二次必抛）：并发防护靠上面的 Promise 去重。
            const offscreen = canvas.transferControlToOffscreen();
            const ticker = await service.bindOverlayCanvas(offscreen, gameCanvas.width, gameCanvas.height);
            service.onNotification((note) => { this._onNote(note); });
            this._service = service;
            this._canvas = canvas;
            this._overlayWidth = gameCanvas.width;
            this._overlayHeight = gameCanvas.height;
            screen.on('window-resize', this._onResize);
            console.log(`[animated-image] overlay 合成就绪：${gameCanvas.width}x${gameCanvas.height}（物理像素），worker ticker=${ticker}`);
            return true;
        } catch (e) {
            if (canvas.parentElement) { canvas.parentElement.removeChild(canvas); }
            throw e;
        }
    }

    /** 会话级失败：一次性响亮 warn + 全部已挂实例降级 + 清理 DOM/监听。之后永不再试。 */
    private _break (reason: string): void {
        if (this._state === 'broken') { return; }
        this._state = 'broken';
        console.warn(`[animated-image] worker-offscreen overlay 会话失败（${reason}），本会话全部实例降级 Sprite+AnimatedImage`);
        const entries = Array.from(this._entries);
        this._entries.clear();
        for (const [handle, component] of entries) {
            try { this._service?.postOverlayNote({ t: 'overlay-detach', handle }); } catch (e) { /* 已尽力 */ }
            if (component.isValid) { component.fallback(); }
        }
        try { screen.off('window-resize', this._onResize); } catch (e) { /* 监听可能没挂上 */ }
        if (this._canvas && this._canvas.parentElement) {
            this._canvas.parentElement.removeChild(this._canvas);
        }
        this._canvas = null;
    }

    // --- attach / detach / 控制通知 ---

    /** 组件 onLoad/kick 时调用。失败路径全部落在 component.fallback()（原地补挂
     *  Sprite+AnimatedImage 后自毁），宿主不支持时静默降级、会话故障时响亮 warn。 */
    public async attach (component: OverlayAnimatedImage): Promise<void> {
        const ready = await this.ensureReady();
        if (!ready) { component.fallback(); return; }
        const bytes = component.overlayBytes();
        if (!bytes) {
            console.warn('[animated-image] overlay 组件没有可用的 clip 字节，该实例降级');
            component.fallback();
            return;
        }
        const mime = sniffMime(bytes);
        if (WORKER_SUPPORTED_MIMES.indexOf(mime) < 0) {
            // worker 解码器只吃 APNG/GIF；WebP 等留在主线程 wasm —— 该实例降级，不break会话。
            console.warn(`[animated-image] overlay 不支持的格式（${mime}），该实例降级`);
            component.fallback();
            return;
        }
        const token = ++component.attachToken;
        // 组件刚挂上：等一帧让父链 UITransform/世界矩阵就绪再投影（spawn 后节点是静态的）。
        await nextFrame();
        if (token !== component.attachToken || !component.isValid) { return; }
        const rect = this._projectRect(component.node);
        if (!rect) {
            this._break('投影失败：沿父链找不到带 cameraComponent 的 Canvas');
            component.fallback();
            return;
        }
        let handle = -1;
        try {
            // 直接走 service.open（不经 createAnimatedDecoder，绕开 WebCodecs；与 worker copy
            // 档同一份 JS 解码器，A/B 口径连续）。open 样本 bytes=源文件体积，会体现在
            // postBytesTotal 里 —— offscreen 档 postMs 恒 0 与它不矛盾（见 tools/PERF.md）。
            const opened = await this._service!.open(bytes, mime, false);
            handle = opened.handle;
            if (token !== component.attachToken || !component.isValid) {
                this._service!.postOverlayNote({ t: 'overlay-detach', handle });
                return;
            }
            await this._service!.attachOverlay(handle, rect, component.playing, component.loop);
            this._entries.set(handle, component);
            component.onAttached(handle, opened.frameCount);
        } catch (e) {
            if (handle >= 0) {
                try { this._service!.postOverlayNote({ t: 'overlay-detach', handle }); } catch (e2) { /* 已 break */ }
            }
            this._break(`attach 失败: ${String(e)}`);
            component.fallback();
        }
    }

    public detach (handle: number): void {
        if (this._entries.delete(handle) && this._state === 'ready' && this._service) {
            // 单向通知：worker 侧必然清理（注销条目 + 销毁解码器），不等回执。
            this._service.postOverlayNote({ t: 'overlay-detach', handle });
        }
    }

    public setState (handle: number, playing: boolean, loop: boolean): void {
        if (this._state === 'ready' && this._service && this._entries.has(handle)) {
            this._service.postOverlayNote({ t: 'overlay-set-state', handle, playing, loop });
        }
    }

    // --- 几何：投影与 resize ---

    /**
     * 节点世界矩形 → overlay 像素矩形。沿父链找 cc.Canvas 的 cameraComponent（找不到不猜，
     * 返回 null 由调用方降级）；对角两点各自 worldToScreen（非均匀缩放也精确）。
     * worldToScreen 左下原点、单位=渲染窗口物理像素 —— overlay 是左上原点，Y 翻转。
     * 横屏旋转（isFrameRotated）是已知边界，一期桌面预览不触发。
     */
    private _projectRect (node: Node): OverlayRect | null {
        let parent: Node | null = node.parent;
        let uiCanvas: UICanvas | null = null;
        while (parent) {
            const found = parent.getComponent(UICanvas);
            if (found) { uiCanvas = found; break; }
            parent = parent.parent;
        }
        if (!uiCanvas) { return null; }
        const camera = uiCanvas.cameraComponent;
        if (!camera) { return null; }
        const ut = node.getComponent(UITransform);
        if (!ut) { return null; }
        const box = ut.getBoundingBoxToWorld();
        const p0 = new Vec3(box.xMin, box.yMin, 0);
        const p1 = new Vec3(box.xMax, box.yMax, 0);
        const s0 = new Vec3();
        const s1 = new Vec3();
        camera.worldToScreen(p0, s0);
        camera.worldToScreen(p1, s1);
        const x = Math.min(s0.x, s1.x);
        const w = Math.abs(s1.x - s0.x);
        const h = Math.abs(s1.y - s0.y);
        const yTop = this._overlayHeight - Math.max(s0.y, s1.y);   // Y 翻转：世界 yMax → 画布顶边
        return { x, y: yTop, w, h };
    }

    private _applyResize (): void {
        if (this._state !== 'ready' || !this._canvas) { return; }
        const gameCanvas = game.canvas as HTMLCanvasElement | null;
        if (!gameCanvas) { return; }
        const w = gameCanvas.width;
        const h = gameCanvas.height;
        this._canvas.width = w;    // 标准占位 canvas resize：同步 backing store（并清屏）
        this._canvas.height = h;
        this._canvas.style.left = `${gameCanvas.offsetLeft}px`;
        this._canvas.style.top = `${gameCanvas.offsetTop}px`;
        this._canvas.style.width = `${gameCanvas.clientWidth}px`;
        this._canvas.style.height = `${gameCanvas.clientHeight}px`;
        this._overlayWidth = w;
        this._overlayHeight = h;
        this._service!.postOverlayNote({ t: 'overlay-resize', width: w, height: h });
        // 视口变了 → 全部屏幕矩形失效，全量重投影（一条 overlay-update 打包发）。
        this._reprojectAll();
    }

    private _reprojectAll (): void {
        if (this._state !== 'ready' || !this._service) { return; }
        const rects: OverlayPlacement[] = [];
        for (const [handle, component] of this._entries) {
            if (!component.isValid) { continue; }
            const rect = this._projectRect(component.node);
            if (rect) { rects.push({ handle, rect }); }
        }
        if (rects.length > 0) {
            this._service.postOverlayNote({ t: 'overlay-update', rects });
        }
    }

    // --- overlay-stats 收包 ---

    private _onNote (note: WorkerOverlayNote): void {
        if (note.t !== 'overlay-stats') { return; }
        // 采样扇出：每条 decodeMs 是该帧 worker 侧成本（解码+位图化，口径与 copy 档 computeMs
        // 不同，绝对值不可直比），再加 compositeMs/frames 摊销成「每帧总成本」；
        // roundtrip == compute ⇒ postMs 恒 0（设计使然：offscreen 档没有每帧过线）。
        const share = note.frames > 0 ? note.compositeMs / note.frames : 0;
        for (const ms of note.decodeMs) {
            emitSample({ kind: 'decode', roundtripMs: ms + share, computeMs: ms + share, bytes: 0 });
        }
        if (note.framesByHandle) {
            // 过线后数字键是字符串（对象键恒为 string），Number() 归一。
            for (const key of Object.keys(note.framesByHandle)) {
                const handle = Number(key);
                const component = this._entries.get(handle);
                if (component && component.isValid) {
                    component.setCurrentFrame(note.framesByHandle[handle]);
                }
            }
        }
    }
}

/** 会话级单例（同 worker：整个页面一条 overlay）。 */
export const overlayManager = new OverlayManager();
