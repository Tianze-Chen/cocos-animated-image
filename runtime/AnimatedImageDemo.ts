/*
 * AnimatedImageDemo - Avatar-style animated image showcase.
 *
 * Displays a fixed-size "avatar" that switches between remote images of different
 * formats (PNG / JPG / GIF / APNG) via on-screen buttons.  All formats go
 * through AnimatedImage in REMOTE mode — static images are supported too.
 *
 * Control buttons: Play/Pause, Restart, Loop, Rate+, Rate-
 */

import {
    _decorator,
    builtinResMgr,
    Button,
    Color,
    Component,
    Label,
    Layers,
    Node,
    Sprite,
    SpriteFrame,
    UITransform,
} from 'cc';
import { AnimatedImage } from './AnimatedImage';
import { AnimatedImagePlayer } from './AnimatedImagePlayer';
import { toBytes } from './bytes';
import { sniffMime } from './mime-sniff';

const { ccclass, property } = _decorator;

const AVATAR_SIZE = 200;
const MEMORY_SAMPLE_INTERVAL = 0.5;
const MEMORY_LOG_PREFIX = '[AnimatedImageMemory]';

interface MemoryInfoLike {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
}

interface MemorySample {
    used: number;
    total: number;
    limit: number;
    source: string;
}

@ccclass('AnimatedImageDemo')
export class AnimatedImageDemo extends Component {
    @property({ tooltip: 'Loop the animation.' })
    public loop = true;

    @property({ tooltip: 'Force the built-in JS decoder instead of the native decoder.' })
    public forceBuiltinDecoder = false;

    @property({ tooltip: 'Write machine-readable memory snapshots to the console.' })
    public enableMemoryLog = true;

    @property({
        slide: true,
        range: [0.5, 60, 0.5],
        tooltip: 'Interval in seconds between periodic memory log records.',
    })
    public memoryLogInterval = 10;

    public pngURL = 'https://ctztest-1306932836.cos.ap-guangzhou.myqcloud.com/PNG_transparency_demonstration_1.png';
    public jpgURL = 'https://ctztest-1306932836.cos.ap-guangzhou.myqcloud.com/Example.jpg';
    public gifURL = 'https://ctztest-1306932836.cos.ap-guangzhou.myqcloud.com/Loading_icon.gif';
    public apngURL = 'https://p6.hellobixin.com/bx-user/495a7aa303a3443c90bfc3ee7549a3d8.png';
    public apng2URL = 'https://ctztest-1306932836.cos.ap-guangzhou.myqcloud.com/Animated_PNG_example_bouncing_beach_ball.png';
    public compareURLs: string[] = [
        'https://p6.hellobixin.com/bx-user/cd372589bb394cd29825232664a9df3b.png',
        'https://p6.hellobixin.com/bx-user/495a7aa303a3443c90bfc3ee7549a3d8.png',
        'https://p6.hellobixin.com/bx-user/50e9578149c64dca88b2cc4ceee828c0.png',
        'https://p6.hellobixin.com/bx-user/b0b6799e368a44c29e128064792b1275.png',
        'https://p6.hellobixin.com/bx-user/bb8ba03a729447f2a107390c01cd9227.png',
        'https://p6.hellobixin.com/bx-user/3daeb5a92e9841a5b1ccdf5751bafc9a.png',
        'https://p6.hellobixin.com/bx-user/23a67d40d3ed48138fae396830e10781.png',
        'https://p6.hellobixin.com/bx-user/b448a3a79db94471822a5e3936a5c78f.png',
        'https://p6.hellobixin.com/bx-user/9e7ee9bc3a6e427988b0ee6e50052b56.png',
        'https://p6.hellobixin.com/bx-user/c2c54061eb9948109d9b795a67adf43a.png',
        'https://p6.hellobixin.com/bx-user/c7acc39d919b45a89b5b2978783b481e.gif',
    ];

    private _animatedImage: AnimatedImage | null = null;
    private _avatarNode: Node | null = null;
    private _avatarBgNode: Node | null = null;
    private _statusNode: Node | null = null;
    private _label: Label | null = null;
    private _builtinBtnNode: Node | null = null;
    private _builtinBtnLabel: Label | null = null;
    private _formatBtnNodes: Node[] = [];
    private _controlBtnNodes: Node[] = [];
    private _loopBtnLabel: Label | null = null;
    private _avatars: { label: string; url: string }[] = [];
    private _activeIndex = 0;
    private _rate = 1;
    private _previousForceBuiltin = false;
    private _compareVisible = false;
    private _compareToken = 0;
    private _compareCells: { node: Node; ai: AnimatedImage; label: Label }[] = [];
    private _totalLabel: Label | null = null;
    private _totalNode: Node | null = null;
    private _memoryNode: Node | null = null;
    private _memoryLabel: Label | null = null;
    private _memoryElapsed = 0;
    private _memoryBaseline = -1;
    private _memoryPeak = 0;
    private _memoryCurrent: MemorySample | null = null;
    private _frameCachePeak = 0;
    private _memoryWarningCount = 0;
    private _memoryWarningLevel = '';
    private _memoryRuntime: any = null;
    private _memoryWarningHandler: ((result?: any) => void) | null = null;
    private _memoryLogElapsed = 0;
    private _memoryLogSequence = 0;
    private _memoryLogStartedAt = 0;
    private _memoryLogSession = '';

    public start (): void {
        if (!AnimatedImage || !AnimatedImagePlayer) {
            console.error(
                '[AnimatedImageDemo] AnimatedImage is missing from cc. Enable animated-image in '
                + 'Project Settings > Feature Cropping, recompile the custom engine, then restart Creator.',
            );
            return;
        }

        this._avatars = [
            { label: 'PNG',  url: this.pngURL },
            { label: 'JPG',  url: this.jpgURL },
            { label: 'GIF',  url: this.gifURL },
            { label: 'APNG',  url: this.apngURL },
            { label: 'APNG2', url: this.apng2URL },
        ].filter(e => !!e.url);

        if (this._avatars.length === 0) {
            console.warn('[AnimatedImageDemo] No URLs configured. Fill in at least one URL in the Inspector.');
            return;
        }

        this._previousForceBuiltin = AnimatedImagePlayer.forceBuiltinDecoder;
        this._ensureUILayer();
        this._buildAvatar();
        this._buildFormatButtons();
        this._buildControlButtons();
        this._buildBuiltinButton();
        this._buildLabel();
        this._buildMemoryMonitor();
        this._startMemoryMonitor();
        this._loadAvatar(0);
    }

    public update (dt: number): void {
        this._refreshLabel();
        this._memoryElapsed += dt;
        this._memoryLogElapsed += dt;
        if (this._memoryElapsed >= MEMORY_SAMPLE_INTERVAL) {
            this._memoryElapsed = 0;
            const logInterval = Math.max(MEMORY_SAMPLE_INTERVAL, this.memoryLogInterval);
            const shouldLog = this._memoryLogElapsed >= logInterval;
            if (shouldLog) {
                this._memoryLogElapsed = 0;
            }
            this._sampleMemory(false, 'periodic', shouldLog);
        }
    }

    public onDestroy (): void {
        AnimatedImagePlayer.forceBuiltinDecoder = this._previousForceBuiltin;
        if (this._memoryLogSession) {
            this._sampleMemory(false, 'destroy', true);
        }
        this._stopMemoryMonitor();

        if (this._avatarBgNode && this._avatarBgNode.isValid) this._avatarBgNode.destroy();
        if (this._avatarNode && this._avatarNode.isValid) this._avatarNode.destroy();
        if (this._statusNode && this._statusNode.isValid) this._statusNode.destroy();
        if (this._memoryNode && this._memoryNode.isValid) this._memoryNode.destroy();
        if (this._builtinBtnNode && this._builtinBtnNode.isValid) this._builtinBtnNode.destroy();
        for (const n of this._formatBtnNodes) {
            if (n && n.isValid) n.destroy();
        }
        for (const n of this._controlBtnNodes) {
            if (n && n.isValid) n.destroy();
        }

        for (const c of this._compareCells) {
            if (c.node && c.node.isValid) c.node.destroy();
        }
        if (this._totalNode && this._totalNode.isValid) this._totalNode.destroy();

        this._avatarNode = null;
        this._avatarBgNode = null;
        this._statusNode = null;
        this._builtinBtnNode = null;
        this._builtinBtnLabel = null;
        this._loopBtnLabel = null;
        this._formatBtnNodes.length = 0;
        this._controlBtnNodes.length = 0;
        this._compareCells.length = 0;
        this._totalLabel = null;
        this._totalNode = null;
        this._memoryLabel = null;
        this._memoryNode = null;
        this._label = null;
        this._animatedImage = null;
    }

    // ---- build UI ----

    /**
     * Every node this demo creates copies this.node.layer, and the UI camera
     * only renders the UI layers — so a host node sitting on e.g. DEFAULT
     * (an empty node created outside the 2D template) makes the whole demo
     * silently invisible: layer filtering is not an error, nothing complains,
     * while the component keeps running. Align the host node's layer with the
     * nearest UITransform-bearing ancestor (the Canvas in a normal scene) and
     * say so, so the misplacement is visible instead of mysterious.
     */
    private _ensureUILayer (): void {
        let anchor: Node | null = this.node;
        while (anchor && !anchor.getComponent(UITransform)) {
            anchor = anchor.parent;
        }
        if (!anchor) {
            console.warn(
                '[AnimatedImageDemo] 场景里找不到带 UITransform 的祖先节点（通常是 Canvas）。'
                + '请把本组件挂在 Canvas 下，否则 UI 可能不被任何相机渲染。',
            );
            if (this.node.layer !== Layers.Enum.UI_2D) {
                console.warn(
                    `[AnimatedImageDemo] 节点 layer（${this.node.layer}）不是 UI_2D，已自动改为 UI_2D。`,
                );
                this.node.layer = Layers.Enum.UI_2D;
            }
            return;
        }
        if (this.node.layer !== anchor.layer) {
            console.warn(
                `[AnimatedImageDemo] 节点 layer（${this.node.layer}）与 UI 父级 ${anchor.name}`
                + `（layer ${anchor.layer}）不一致，已自动对齐——否则整个 demo 不会显示。`,
            );
            this.node.layer = anchor.layer;
        }
    }

    private _buildAvatar (): void {
        // 蓝色背景：放在图片节点后面，透明区域透出蓝色
        const bgNode = new Node('AvatarBG');
        bgNode.parent = this.node;
        bgNode.layer = this.node.layer;
        bgNode.setPosition(0, 80, 0);
        bgNode.setSiblingIndex(0);
        const bgTransform = bgNode.addComponent(UITransform);
        bgTransform.setContentSize(AVATAR_SIZE, AVATAR_SIZE);
        const bgSprite = bgNode.addComponent(Sprite);
        bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        bgSprite.color = new Color(0, 120, 255, 255);
        this._avatarBgNode = bgNode;

        const node = new Node('AvatarSprite');
        node.parent = this.node;
        node.layer = this.node.layer;
        node.setPosition(0, 80, 0);

        const transform = node.addComponent(UITransform);
        transform.setContentSize(AVATAR_SIZE, AVATAR_SIZE);

        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const animatedImage = node.addComponent(AnimatedImage);
        animatedImage.playOnAwake = true;
        animatedImage.loop = this.loop;
        animatedImage.playbackRate = this._rate;
        animatedImage.sourceType = AnimatedImage.SourceType.REMOTE;

        this._avatarNode = node;
        this._animatedImage = animatedImage;
    }

    private _buildFormatButtons (): void {
        const btnWidth = 100;
        const gap = 10;
        const total = this._avatars.length;
        const rowWidth = total * btnWidth + (total - 1) * gap;
        const startX = -rowWidth / 2 + btnWidth / 2;
        const y = -80;

        for (let i = 0; i < total; i++) {
            const entry = this._avatars[i];
            const btnNode = this._createButton(
                `Btn_${entry.label}`,
                startX + i * (btnWidth + gap),
                y,
                btnWidth,
                44,
                entry.label,
            );
            btnNode.on(Button.EventType.CLICK, () => this._loadAvatar(i), this);
            this._formatBtnNodes.push(btnNode);
        }
    }

    private _buildControlButtons (): void {
        const controls = [
            { label: 'Play/Pause', handler: (): void => this._togglePlayPause() },
            { label: 'Restart',    handler: (): void => this._restart() },
            { label: `Loop: ${this.loop ? 'ON' : 'OFF'}`, handler: (): void => this._toggleLoop() },
            { label: 'Rate+',     handler: (): void => this._changeRate(0.25) },
            { label: 'Rate-',     handler: (): void => this._changeRate(-0.25) },
            { label: '四图对比',  handler: (): void => this._toggleCompare() },
        ];

        const btnWidth = 100;
        const gap = 10;
        const total = controls.length;
        const rowWidth = total * btnWidth + (total - 1) * gap;
        const startX = -rowWidth / 2 + btnWidth / 2;
        const y = -130;

        for (let i = 0; i < total; i++) {
            const ctrl = controls[i];
            const btnNode = this._createButton(
                `Ctrl_${ctrl.label}`,
                startX + i * (btnWidth + gap),
                y,
                btnWidth,
                44,
                ctrl.label,
            );
            btnNode.on(Button.EventType.CLICK, ctrl.handler, this);
            this._controlBtnNodes.push(btnNode);

            if (i === 2) {
                const labelNode = btnNode.children[0];
                if (labelNode) {
                    this._loopBtnLabel = labelNode.getComponent(Label);
                }
            }
        }
    }

    private _buildBuiltinButton (): void {
        const btnNode = this._createButton(
            'BuiltinDecoderBtn',
            0,
            -185,
            260,
            44,
            this.forceBuiltinDecoder ? 'BuiltinDecoder: ON' : 'BuiltinDecoder: OFF',
        );
        btnNode.on(Button.EventType.CLICK, this._onBuiltinBtnClick, this);
        this._builtinBtnNode = btnNode;

        const labelNode = btnNode.children[0];
        if (labelNode) {
            this._builtinBtnLabel = labelNode.getComponent(Label);
        }
    }

    private _buildLabel (): void {
        const node = new Node('StatusLabel');
        node.parent = this.node;
        node.layer = this.node.layer;
        node.setPosition(0, -245, 0);

        const transform = node.addComponent(UITransform);
        transform.setContentSize(720, 100);

        const label = node.addComponent(Label);
        label.color = new Color(255, 255, 255, 255);
        label.fontSize = 18;
        label.lineHeight = 24;

        this._statusNode = node;
        this._label = label;
    }

    private _buildMemoryMonitor (): void {
        const node = new Node('MemoryMonitor');
        node.parent = this.node;
        node.layer = this.node.layer;
        node.setPosition(0, 285, 0);

        const transform = node.addComponent(UITransform);
        transform.setContentSize(900, 58);

        const background = node.addComponent(Sprite);
        background.spriteFrame = builtinResMgr.get<SpriteFrame>('default-spriteframe');
        background.color = new Color(0, 0, 0, 180);
        background.sizeMode = Sprite.SizeMode.CUSTOM;

        const labelNode = new Node('MemoryLabel');
        labelNode.parent = node;
        labelNode.layer = this.node.layer;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(880, 54);

        const label = labelNode.addComponent(Label);
        label.color = new Color(120, 255, 160, 255);
        label.fontSize = 16;
        label.lineHeight = 22;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = 'JS Heap: detecting...\nRGBA frame cache: 0 B';

        this._memoryNode = node;
        this._memoryLabel = label;
    }

    private _createButton (name: string, x: number, y: number, w: number, h: number, text: string): Node {
        const btnNode = new Node(name);
        btnNode.parent = this.node;
        btnNode.layer = this.node.layer;
        btnNode.setPosition(x, y, 0);

        const transform = btnNode.addComponent(UITransform);
        transform.setContentSize(w, h);

        const sprite = btnNode.addComponent(Sprite);
        sprite.spriteFrame = builtinResMgr.get<SpriteFrame>('default-spriteframe');
        sprite.color = new Color(80, 80, 80, 200);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const labelNode = new Node('Label');
        labelNode.parent = btnNode;
        labelNode.layer = this.node.layer;
        const lt = labelNode.addComponent(UITransform);
        lt.setContentSize(w, h);
        const lc = labelNode.addComponent(Label);
        lc.color = new Color(255, 255, 255, 255);
        lc.fontSize = 20;
        lc.lineHeight = h;
        lc.horizontalAlign = Label.HorizontalAlign.CENTER;
        lc.verticalAlign = Label.VerticalAlign.CENTER;
        lc.string = text;

        const btn = btnNode.addComponent(Button);
        btn.transition = Button.Transition.COLOR;
        btn.normalColor = new Color(80, 80, 80, 200);
        btn.hoverColor = new Color(120, 120, 120, 220);
        btn.pressedColor = new Color(50, 50, 50, 255);

        return btnNode;
    }

    // ---- logic ----

    private _loadAvatar (index: number): void {
        const ai = this._animatedImage;
        if (!ai) return;

        this._sampleMemory(false, 'avatar-before-switch', true);
        this._activeIndex = index;
        const entry = this._avatars[index];

        AnimatedImagePlayer.forceBuiltinDecoder = this.forceBuiltinDecoder;
        ai.loop = this.loop;
        ai.playbackRate = this._rate;
        ai.remoteURL = '';
        ai.sourceType = AnimatedImage.SourceType.REMOTE;
        ai.remoteURL = entry.url;
        this._sampleMemory(false, 'avatar-after-switch', true);

        this._highlightActiveButton();

        console.log(
            `[AnimatedImageDemo] Loading ${entry.label}: ${entry.url}, `
            + `builtinDecoder=${this.forceBuiltinDecoder}`,
        );
    }

    private _highlightActiveButton (): void {
        for (let i = 0; i < this._formatBtnNodes.length; i++) {
            const btn = this._formatBtnNodes[i].getComponent(Button);
            if (!btn) continue;
            const isActive = i === this._activeIndex;
            const c = isActive ? new Color(40, 120, 200, 255) : new Color(80, 80, 80, 200);
            btn.normalColor = c;
            const sprite = this._formatBtnNodes[i].getComponent(Sprite);
            if (sprite) sprite.color = c;
        }
    }

    private _togglePlayPause (): void {
        const ai = this._animatedImage;
        if (ai) {
            ai.isPlaying ? ai.pause() : ai.play();
        }
    }

    private _restart (): void {
        const ai = this._animatedImage;
        if (ai) {
            ai.stop();
            ai.play();
        }
    }

    private _toggleLoop (): void {
        this.loop = !this.loop;
        const ai = this._animatedImage;
        if (ai) ai.loop = this.loop;
        if (this._loopBtnLabel) {
            this._loopBtnLabel.string = `Loop: ${this.loop ? 'ON' : 'OFF'}`;
        }
    }

    private _changeRate (delta: number): void {
        this._rate = Math.min(10, Math.max(0, this._rate + delta));
        const ai = this._animatedImage;
        if (ai) ai.playbackRate = this._rate;
    }

    private _onBuiltinBtnClick (): void {
        this.forceBuiltinDecoder = !this.forceBuiltinDecoder;
        if (this._builtinBtnLabel) {
            this._builtinBtnLabel.string = this.forceBuiltinDecoder
                ? 'BuiltinDecoder: ON'
                : 'BuiltinDecoder: OFF';
        }
        this._loadAvatar(this._activeIndex);
    }

    private _refreshLabel (): void {
        if (!this._label) return;

        const ai = this._animatedImage;
        const entry = this._avatars[this._activeIndex];
        const decoder = this.forceBuiltinDecoder ? 'builtin (forced)' : 'native if available';
        const frame = ai && ai.frameCount > 0
            ? `${ai.currentFrame + 1}/${ai.frameCount}`
            : '-/-';
        const state = ai
            ? ai.isPlaying ? 'playing' : 'paused/stopped'
            : 'no player';

        this._label.string = `Avatar demo — ${entry.label}\n`
            + `decoder: ${decoder}   frame: ${frame}   state: ${state}\n`
            + `loop: ${this.loop}   rate: ${this._rate.toFixed(2)}`;
    }

    // ---- 四图对比（简化：格子直接挂在 Demo 根节点下，与头像同结构）----

    private _toggleCompare (): void {
        this._compareVisible = !this._compareVisible;
        if (this._compareVisible) {
            this._showCompare();
        } else {
            this._hideCompare();
        }
    }

    private _showCompare (): void {
        if (this._avatarNode) this._avatarNode.active = false;
        if (this._avatarBgNode) this._avatarBgNode.active = false;
        if (this._builtinBtnNode) this._builtinBtnNode.active = false;
        if (this._statusNode) this._statusNode.active = false;
        for (const n of this._formatBtnNodes) n.active = false;
        for (const n of this._controlBtnNodes) n.active = false;

        if (this._compareCells.length === 0) {
            this._buildCompareCells();
        }
        for (const c of this._compareCells) {
            c.node.active = true;
        }
        if (this._totalNode) this._totalNode.active = true;

        this._sampleMemory(false, 'compare-show', true);
        void this._runCompare();
    }

    private _hideCompare (): void {
        this._compareToken++;
        for (const c of this._compareCells) {
            c.node.active = false;
        }
        if (this._totalNode) this._totalNode.active = false;

        if (this._avatarNode) this._avatarNode.active = true;
        if (this._avatarBgNode) this._avatarBgNode.active = true;
        if (this._builtinBtnNode) this._builtinBtnNode.active = true;
        if (this._statusNode) this._statusNode.active = true;
        for (const n of this._formatBtnNodes) n.active = true;
        for (const n of this._controlBtnNodes) n.active = true;
        this._sampleMemory(false, 'compare-hide', true);
    }

    private _buildCompareCells (): void {
        // 动态网格布局：最多 5 列，自动换行，可容纳任意数量图片
        const n = this.compareURLs.length;
        const cellW = 100;
        const cellH = 150; // 图片 88 + 两行标签 + 边距
        const gapX = 12;
        const gapY = 10;
        const cols = Math.min(n, 5);
        const rows = Math.ceil(n / cols);
        const totalW = cols * cellW + (cols - 1) * gapX;
        const totalH = rows * cellH + (rows - 1) * gapY;
        const startX = -totalW / 2 + cellW / 2;
        const startY = totalH / 2 - cellH / 2;

        for (let i = 0; i < n; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = startX + col * (cellW + gapX);
            const y = startY - row * (cellH + gapY);

            const cell = new Node(`CmpCell_${i}`);
            cell.parent = this.node;
            cell.layer = this.node.layer;
            cell.setPosition(x, y, 0);
            cell.active = false;

            const imgNode = new Node('CmpImg');
            imgNode.parent = cell;
            imgNode.layer = this.node.layer;
            const imgTransform = imgNode.addComponent(UITransform);
            imgTransform.setContentSize(88, 88);
            const sprite = imgNode.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            // 与 Avatar 相同的 AnimatedImage 组件，下载 + 显示 + 播放走已验证的路径
            const ai = imgNode.addComponent(AnimatedImage);
            ai.playOnAwake = true;
            ai.loop = true;
            ai.sourceType = AnimatedImage.SourceType.REMOTE;

            // 两行标签：第1行 编号+体积，第2行 解析耗时
            const labelNode = this._createTextNode('CmpLabel', 0, -62, `#${i + 1}\n等待…`, 16, 50);
            labelNode.parent = cell;

            this._compareCells.push({ node: cell, ai, label: labelNode.getComponent(Label)! });
        }

        // 总耗时放在网格下方
        const totalY = -totalH / 2 - 30;
        const total = this._createTextNode('CompareTotal', 0, totalY, '总解析: --\n含下载: --', 18, 52);
        total.parent = this.node;
        total.active = false;
        this._totalLabel = total.getComponent(Label);
        this._totalNode = total;
    }

    private async _runCompare (): Promise<void> {
        const token = ++this._compareToken;
        let totalParse = 0;
        const wall0 = this._now();

        for (let i = 0; i < this.compareURLs.length; i++) {
            if (token !== this._compareToken) return;
            const cell = this._compareCells[i];
            if (!cell) continue;

            const url = this.compareURLs[i];
            cell.label.string = `#${i + 1}\n下载中…`;
            const bytes = await this._downloadBytes(url);
            if (token !== this._compareToken) return;
            if (!bytes) {
                cell.label.string = `#${i + 1}\n下载失败`;
                continue;
            }

            // 计时：解析（解码）耗时
            const mime = sniffMime(bytes);
            const t0 = this._now();
            let player: AnimatedImagePlayer | null = null;
            try {
                player = await AnimatedImagePlayer.create(bytes, mime);
            } catch (e) {
                console.warn(`[AnimatedImageDemo] #${i + 1} 解析失败 mime=${mime} bytes=${bytes.length} err=${String(e)}`);
                cell.label.string = `#${i + 1}\n解析失败`;
                continue;
            }
            if (token !== this._compareToken) {
                if (player) player.destroy();
                return;
            }
            const parseMs = this._now() - t0;
            totalParse += parseMs;

            const w = player.width;
            const h = player.height;
            player.destroy();

            // 按图片宽高比预设显示框（88x88 内适配）
            const transform = cell.ai.node.getComponent(UITransform);
            if (transform && w > 0 && h > 0) {
                const scale = Math.min(88 / w, 88 / h);
                transform.setContentSize(w * scale, h * scale);
            }

            const kb = bytes.length / 1024;
            cell.label.string = `#${i + 1} ${kb.toFixed(1)}KB\n解析 ${parseMs.toFixed(0)}ms`;

            // 展示与播放交给 AnimatedImage（与 Avatar 相同路径）
            cell.ai.sourceType = AnimatedImage.SourceType.REMOTE;
            cell.ai.remoteURL = url;
        }

        if (token !== this._compareToken) return;
        const wall = this._now() - wall0;
        if (this._totalLabel) {
            this._totalLabel.string = `总解析 ${totalParse.toFixed(0)}ms\n含下载 ${wall.toFixed(0)}ms`;
        }
    }

    private _downloadBytes (url: string): Promise<Uint8Array | null> {
        // 与 AnimatedImage 一致：Sud/微信壳优先用 wx.downloadFile 保住二进制，
        // 其 XHR 可能把二进制按 UTF-8 解码（不可恢复），导致字节被破坏。
        const wxApi = (globalThis as { wx?: any }).wx;
        if (wxApi && typeof wxApi.downloadFile === 'function') {
            return this._downloadBytesViaWx(url, wxApi);
        }
        return this._downloadBytesViaXhr(url);
    }

    private _downloadBytesViaWx (url: string, wxApi: any): Promise<Uint8Array | null> {
        return new Promise<Uint8Array | null>((resolve) => {
            wxApi.downloadFile({
                url,
                success: (res: any): void => {
                    if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 0) {
                        const fs = typeof wxApi.getFileSystemManager === 'function' ? wxApi.getFileSystemManager() : null;
                        if (fs && typeof fs.readFile === 'function') {
                            fs.readFile({
                                filePath: res.tempFilePath,
                                success: (r: any): void => resolve(toBytes(r && r.data)),
                                fail: (): void => {
                                    console.warn(`[AnimatedImageDemo] wx.readFile failed for ${url}`);
                                    resolve(null);
                                },
                            });
                        } else {
                            console.warn('[AnimatedImageDemo] wx.getFileSystemManager unavailable, falling back to XHR');
                            this._downloadBytesViaXhr(url).then(resolve);
                        }
                    } else {
                        console.warn(`[AnimatedImageDemo] wx.downloadFile HTTP ${res.statusCode} for ${url}`);
                        resolve(null);
                    }
                },
                fail: (): void => {
                    console.warn(`[AnimatedImageDemo] wx.downloadFile failed for ${url}, falling back to XHR`);
                    this._downloadBytesViaXhr(url).then(resolve);
                },
            });
        });
    }

    private _downloadBytesViaXhr (url: string): Promise<Uint8Array | null> {
        return new Promise<Uint8Array | null>((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = (): void => {
                if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
                    resolve(toBytes(xhr.response));
                } else {
                    console.warn(`[AnimatedImageDemo] HTTP ${xhr.status} for ${url}`);
                    resolve(null);
                }
            };
            xhr.onerror = (): void => {
                console.warn(`[AnimatedImageDemo] failed to download ${url}`);
                resolve(null);
            };
            xhr.send();
        });
    }

    private _startMemoryMonitor (): void {
        const startTimestamp = Date.now();
        this._memoryLogStartedAt = this._now();
        this._memoryLogSession = String(startTimestamp);
        this._memoryLogSequence = 0;
        this._memoryLogElapsed = 0;
        this._memoryRuntime = this._findMemoryRuntime();
        if (this._memoryRuntime && typeof this._memoryRuntime.onMemoryWarning === 'function') {
            this._memoryWarningHandler = (result?: any): void => {
                this._memoryWarningCount++;
                this._memoryWarningLevel = result && result.level != null ? String(result.level) : '';
                console.warn(
                    `[AnimatedImageDemo] memory warning #${this._memoryWarningCount}`
                    + (this._memoryWarningLevel ? `, level=${this._memoryWarningLevel}` : ''),
                );
                this._sampleMemory(false, 'memory-warning', true);
            };
            try {
                this._memoryRuntime.onMemoryWarning(this._memoryWarningHandler);
            } catch (e) {
                console.warn(`[AnimatedImageDemo] failed to register memory warning listener: ${String(e)}`);
                this._memoryWarningHandler = null;
            }
        }
        this._sampleMemory(true, 'start', true);
    }

    private _stopMemoryMonitor (): void {
        if (
            this._memoryRuntime
            && this._memoryWarningHandler
            && typeof this._memoryRuntime.offMemoryWarning === 'function'
        ) {
            try {
                this._memoryRuntime.offMemoryWarning(this._memoryWarningHandler);
            } catch {}
        }
        this._memoryWarningHandler = null;
        this._memoryRuntime = null;
    }

    private _sampleMemory (resetBaseline = false, event = 'sample', writeLog = false): void {
        const sample = this._readMemorySample();
        this._memoryCurrent = sample;
        if (sample) {
            if (resetBaseline || this._memoryBaseline < 0) {
                this._memoryBaseline = sample.used;
                this._memoryPeak = sample.used;
            } else {
                this._memoryPeak = Math.max(this._memoryPeak, sample.used);
            }
        }
        this._refreshMemoryLabel();
        if (writeLog) {
            this._writeMemoryLog(event);
        }
    }

    private _readMemorySample (): MemorySample | null {
        const root = globalThis as any;
        const browserMemory = this._normalizeMemoryInfo(
            root.performance && root.performance.memory,
            'performance.memory',
        );
        if (browserMemory) {
            return browserMemory;
        }

        const runtime = this._memoryRuntime || this._findMemoryRuntime();
        if (runtime && typeof runtime.getPerformance === 'function') {
            try {
                const performanceInfo = runtime.getPerformance();
                const runtimeMemory = this._normalizeMemoryInfo(
                    performanceInfo && performanceInfo.memory,
                    'runtime.performance',
                );
                if (runtimeMemory) {
                    return runtimeMemory;
                }
            } catch {}
        }
        return null;
    }

    private _normalizeMemoryInfo (info: MemoryInfoLike | null | undefined, source: string): MemorySample | null {
        if (!info) return null;
        const used = Number(info.usedJSHeapSize);
        if (!Number.isFinite(used) || used < 0) return null;
        const totalValue = Number(info.totalJSHeapSize);
        const limitValue = Number(info.jsHeapSizeLimit);
        return {
            used,
            total: Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : 0,
            limit: Number.isFinite(limitValue) && limitValue >= 0 ? limitValue : 0,
            source,
        };
    }

    private _findMemoryRuntime (): any {
        const root = globalThis as any;
        const candidates = [root.wx, root.tt, root.qq, root.swan];
        for (const candidate of candidates) {
            if (
                candidate
                && (typeof candidate.getPerformance === 'function'
                    || typeof candidate.onMemoryWarning === 'function')
            ) {
                return candidate;
            }
        }
        return null;
    }

    private _refreshMemoryLabel (): void {
        if (!this._memoryLabel) return;

        const frameStats = this._getFrameCacheStats();
        this._frameCachePeak = Math.max(this._frameCachePeak, frameStats.bytes);

        let heapLine: string;
        if (this._memoryCurrent) {
            const current = this._memoryCurrent;
            const delta = this._memoryBaseline >= 0 ? current.used - this._memoryBaseline : 0;
            const total = current.total > 0 ? ` | total ${this._formatBytes(current.total)}` : '';
            heapLine = `JS heap [${current.source}]: ${this._formatBytes(current.used)}`
                + ` | delta ${this._formatSignedBytes(delta)}`
                + ` | peak ${this._formatBytes(this._memoryPeak)}${total}`;
        } else {
            heapLine = 'JS heap: unavailable on this runtime';
        }

        const warning = this._memoryWarningLevel
            ? `${this._memoryWarningCount} (level ${this._memoryWarningLevel})`
            : String(this._memoryWarningCount);
        const frameLine = `RGBA cache: ${this._formatBytes(frameStats.bytes)}`
            + ` | peak ${this._formatBytes(this._frameCachePeak)}`
            + ` | frames ${frameStats.cachedFrames}/${frameStats.totalFrames}`
            + ` | players ${frameStats.players} | warnings ${warning}`;
        this._memoryLabel.string = `${heapLine}\n${frameLine}`;
    }

    private _writeMemoryLog (event: string): void {
        if (!this.enableMemoryLog || !this._memoryLogSession) return;

        const heap = this._memoryCurrent;
        const frameStats = this._getFrameCacheStats();
        this._frameCachePeak = Math.max(this._frameCachePeak, frameStats.bytes);
        const ai = this._animatedImage;
        const entry = this._avatars[this._activeIndex];
        const heapDelta = heap && this._memoryBaseline >= 0
            ? heap.used - this._memoryBaseline
            : null;
        const record = {
            version: 1,
            session: this._memoryLogSession,
            sequence: ++this._memoryLogSequence,
            timestampMs: Date.now(),
            elapsedMs: Math.max(0, Math.round(this._now() - this._memoryLogStartedAt)),
            event,
            view: this._compareVisible ? 'compare' : 'avatar',
            image: entry ? entry.label : '',
            decoder: this.forceBuiltinDecoder ? 'builtin' : 'native-auto',
            playing: !!ai && ai.isPlaying,
            loop: this.loop,
            playbackRate: this._rate,
            currentFrame: ai && ai.frameCount > 0 ? ai.currentFrame : null,
            heapSource: heap ? heap.source : null,
            heapUsedBytes: heap ? heap.used : null,
            heapTotalBytes: heap ? heap.total : null,
            heapLimitBytes: heap ? heap.limit : null,
            heapDeltaBytes: heapDelta,
            heapPeakBytes: heap ? this._memoryPeak : null,
            rgbaCacheBytes: frameStats.bytes,
            rgbaCachePeakBytes: this._frameCachePeak,
            cachedFrames: frameStats.cachedFrames,
            totalFrames: frameStats.totalFrames,
            players: frameStats.players,
            memoryWarnings: this._memoryWarningCount,
            memoryWarningLevel: this._memoryWarningLevel || null,
        };

        // Log a serialized primitive so DevTools does not retain live object references.
        console.log(`${MEMORY_LOG_PREFIX} ${JSON.stringify(record)}`);
    }

    private _getFrameCacheStats (): {
        bytes: number;
        cachedFrames: number;
        totalFrames: number;
        players: number;
    } {
        let bytes = 0;
        let cachedFrames = 0;
        let totalFrames = 0;
        let players = 0;

        const addPlayer = (player: AnimatedImagePlayer | null): void => {
            if (!player) return;
            players++;
            bytes += player.frameCacheBytes;
            cachedFrames += player.cachedFrameCount;
            totalFrames += player.frameCount;
        };

        addPlayer(this._animatedImage ? this._animatedImage.player : null);
        for (const cell of this._compareCells) {
            addPlayer(cell.ai.player);
        }
        return { bytes, cachedFrames, totalFrames, players };
    }

    private _formatBytes (bytes: number): string {
        if (!Number.isFinite(bytes)) return '--';
        if (Math.abs(bytes) < 1024) return `${Math.round(bytes)} B`;
        const kb = bytes / 1024;
        if (Math.abs(kb) < 1024) return `${kb.toFixed(1)} KiB`;
        return `${(kb / 1024).toFixed(1)} MiB`;
    }

    private _formatSignedBytes (bytes: number): string {
        return `${bytes >= 0 ? '+' : '-'}${this._formatBytes(Math.abs(bytes))}`;
    }

    private _createTextNode (name: string, x: number, y: number, text: string, fontSize: number, height = 40): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        node.setPosition(x, y, 0);

        const transform = node.addComponent(UITransform);
        transform.setContentSize(320, height);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;

        return node;
    }

    private _now (): number {
        const p = (globalThis as { performance?: { now (): number } }).performance;
        return p ? p.now() : Date.now();
    }
}
