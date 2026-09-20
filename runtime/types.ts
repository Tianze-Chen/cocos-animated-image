export interface IDecodedFrame {
    data: Uint8Array;
    duration: number;
}

export interface IAnimatedImageDecoder {
    readonly width: number;
    readonly height: number;
    readonly frameCount: number;
    readonly loopCount: number;
    /**
     * true = decodeFrame 返回的帧数据只在「下一次 decodeFrame 调用」之前有效
     * （worker SharedArrayBuffer 模式：所有帧复用同一块共享内存）。
     * 调用方用完即弃（uploadData 后不得缓存），缺省 false = 帧数据可以长期持有。
     */
    readonly transientFrames?: boolean;
    /**
     * true = 自驱模式（worker-auto 变体）：播放时钟在 worker 里，worker 每解一帧直接写
     * 共享内存并推进 header 帧序号，主线程每引擎帧轮询 pollAutoFrame 上屏 —— 每帧零消息，
     * 通道只剩 open / start / stop / seek 等 O(1) 控制消息（2026-09 真机定案：通道在
     * ~10k 累计请求 / 持续满载下整体楔死，per-frame 拉模型是消息量根源）。
     * 此模式下 decodeFrame 不再被调用。
     */
    readonly autoDriven?: boolean;
    /** 开始 / 继续自驱播放。幂等；loop 随每次调用可变。 */
    startAuto? (loop: boolean): void;
    /** 暂停自驱（时钟停走，当前帧保留在共享内存继续可读）。 */
    stopAuto? (): void;
    /** 跳到指定帧（未播放时也把该帧写进共享内存，轮询侧照样上屏）。 */
    seekAuto? (index: number): void;
    /**
     * 轮询最新帧：header 帧序号未变返回 null（无需上传）；变了返回共享内存视图
     * （transient：只到 worker 下一次写入前，读用即弃）+ 帧号。
     */
    pollAutoFrame? (): { data: Uint8Array; index: number } | null;
    decodeFrame (index: number): Promise<IDecodedFrame>;
    destroy (): void;
}
