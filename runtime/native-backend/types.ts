/**
 * 原生动图解码后端 —— 平台差异的最小抽象层。
 *
 * 这一层只回答三个问题：宿主上有这个后端吗（available）、它认这个格式吗
 * （isTypeSupported）、给它字节能不能逐帧解出来（create → handle）。所有后端
 * 共有的逻辑 —— 循环次数归一、缺省尺寸的首帧探测、RGBA 提取的调用形状 ——
 * 全部在 adapter.ts 里，descriptor 之间不允许出现第二份。
 *
 * 可迁移性约定（为将来整体并入 cocos 主仓库 pal 层保留）：
 *   - 零 cc 依赖、零编辑器耦合，只读 globalThis 做能力探测；
 *   - 全部结构类型，不做类继承 —— 消费方按鸭子类型接，接口即契约；
 *   - 后端枚举不写死在层内，注册顺序由调用方（backends.ts）决定。
 */

/** 单帧：平台帧对象的临时包装。extract 之后必须 close，不允许长期持有。 */
export interface NativeFrameInfo {
    readonly width: number;
    readonly height: number;
    /** 本帧时长（ms）；静帧 / 未知为 0。平台侧的 μs → ms 由 descriptor 完成。 */
    readonly durationMs: number;
    /**
     * 把 RGBA8888 像素写入 out。out 由 adapter 按**解码器固定尺寸**分配
     * （byteLength === width * height * 4，与帧自身的 width/height 无关）——
     * 播放器纹理以解码器尺寸创建，逐帧 buffer 尺寸漂移会让
     * texSubImage2D 收到长度不符的数据而抛错。帧尺寸与 out 不符时由
     * descriptor 决定策略：canvas 合成裁切/留黑，或直接抛错。
     */
    extract (out: Uint8Array, width: number, height: number): Promise<void>;
    /** 释放平台侧帧资源。 */
    close (): void;
}

/** 元数据就绪后的轨道信息。 */
export interface NativeTrackInfo {
    readonly frameCount: number;
    /** 循环次数的平台原值（Infinity / 负数 = 无限循环，归一到 loopCount 在 adapter）。 */
    readonly repetitionCount: number;
    /** 输出尺寸；元数据阶段未知时省略（adapter 会解首帧探测）。 */
    readonly width?: number;
    readonly height?: number;
}

/** 一个已打开的动图实例（对应平台解码器对象）。 */
export interface NativeDecoderHandle {
    /** 等元数据就绪。无动画轨道 / 失败返回 null = 该后端放弃，上层试下一档。 */
    ready (): Promise<NativeTrackInfo | null>;
    decode (frameIndex: number): Promise<NativeFrameInfo>;
    close (): void;
}

/** 平台后端描述符 —— web / wx 的差异全部收在这一个形状里。 */
export interface NativeBackendDescriptor {
    /** 诊断与日志用的名字，如 'web-codecs' / 'sud'。 */
    readonly name: string;
    /** 同步能力探测：宿主上有这个后端吗（只看全局对象，不承诺格式支持）。 */
    available (): boolean;
    /** 格式探测；宿主没有该静态方法时返回 null = 视为可尝试（失败发生在 create，那边有降级）。 */
    isTypeSupported (mime: string): Promise<boolean> | null;
    /** 构造句柄；失败抛错，由调用方捕获并降级到下一档。允许 Promise 形态防实现漂移。 */
    create (bytes: Uint8Array, mime: string): NativeDecoderHandle | Promise<NativeDecoderHandle>;
}
