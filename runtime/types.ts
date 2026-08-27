export interface IDecodedFrame {
    data: Uint8Array;
    duration: number;
}

export interface IAnimatedImageDecoder {
    readonly width: number;
    readonly height: number;
    readonly frameCount: number;
    readonly loopCount: number;
    decodeFrame (index: number): Promise<IDecodedFrame>;
    destroy (): void;
}
