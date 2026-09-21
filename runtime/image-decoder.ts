import type { IAnimatedImageDecoder } from './types';
import { sniffMime } from './mime-sniff';
import { getDecoder } from './decoder-registry';
import { createStaticDecoder } from './static-decoder';
import { tryCreateNativeDecoder, isNativeAnimatedSupported as isNativeBackendAvailable } from './backends';
import './codecs';

// --- Public API ---

export function isNativeAnimatedSupported (mime: string): boolean {
    // mime 保留在签名里（既有 API）。原生档可用性只取决于宿主上是否注册了任一
    // 解码后端（web-codecs / sud，见 backends.ts）；具体格式支持在
    // createAnimatedDecoder 里逐格式探测，不支持自动落 JS 解码，调用方无需关心。
    void mime;
    return isNativeBackendAvailable();
}

export function shouldForceNative (): boolean {
    return (globalThis as { __forceNativeDecoder?: boolean }).__forceNativeDecoder === true;
}

/**
 * 解码器分发口。两级：平台原生后端（WebCodecs / SUD，装配见 backends.ts）→
 * JS 解码器（decoder-registry + 静图兜底）。原生档内部自带逐后端降级与日志，
 * 两级之间静默回落，最后一级不认识格式才 reject。
 *
 * forceNative 是两级行为的检查阀：开启后原生档必须成功 —— 正常路径的静默
 * 回退会把原生层的失败全部吞掉，测试原生后端时让它响亮报错而不是悄悄落 JS。
 */
export async function createAnimatedDecoder (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const actual = sniffMime(bytes, mime);

    const native = await tryCreateNativeDecoder(bytes, actual);
    if (native) return native;

    if (shouldForceNative()) {
        return Promise.reject(new Error(
            `[animated-image] forceNative 已开启，但 ${actual} 没有可用的原生解码后端`));
    }

    return createJsFallback(bytes, actual);
}

// --- JS fallback (all platforms) ---

function createJsFallback (bytes: Uint8Array, mime: string): Promise<IAnimatedImageDecoder> {
    const factory = getDecoder(mime);
    if (factory) return Promise.resolve(factory(bytes));

    if (mime === 'image/png' || mime === 'image/jpeg') {
        return createStaticDecoder(bytes, mime);
    }
    console.warn(`[animated-image] Unsupported animated image format: ${mime} (${bytes.length} bytes)`);
    return Promise.reject(new Error(`Unsupported animated image format: ${mime} (${bytes.length} bytes)`));
}
