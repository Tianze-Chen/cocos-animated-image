export interface IDecodedFrame {
    data: Uint8Array;
    duration: number;
}

export interface IAnimatedImageDecoder {
    readonly width: number;
    readonly height: number;
    readonly frameCount: number;
    readonly loopCount: number;
    /** 原生档胜出后端的自述名（web-codecs / sud）；JS 解码器不带此字段。 */
    readonly backendName?: string;
    decodeFrame (index: number): Promise<IDecodedFrame>;
    destroy (): void;
}
