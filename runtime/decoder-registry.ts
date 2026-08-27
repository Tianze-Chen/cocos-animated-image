import type { IAnimatedImageDecoder } from './types';

export type DecoderFactory = (bytes: Uint8Array) => IAnimatedImageDecoder | Promise<IAnimatedImageDecoder>;

const registry = new Map<string, DecoderFactory>();

export function registerDecoder (mime: string, factory: DecoderFactory): void {
    registry.set(mime, factory);
}

export function getDecoder (mime: string): DecoderFactory | undefined {
    return registry.get(mime);
}

export function hasDecoder (mime: string): boolean {
    return registry.has(mime);
}
