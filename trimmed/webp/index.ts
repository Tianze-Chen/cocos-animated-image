/**
 * Animated Image — WebP backend loader
 *
 * One interface, two implementations, chosen by platform:
 *
 *   native -> globalThis.__animatedImageWebP (JSB, native/jsb_animated_webp_manual.cpp)
 *   else   -> animated-webp.wasm through cc.wasm (native/wasm/)
 *
 * Both sit on the same C core (native/webp-core/webp_anim.c), and the interface
 * below is the C ABI verbatim — caller-allocated typed arrays for the out-params
 * rather than returned objects. That is awkward on the native side, where plain
 * objects would be easy, but keeping one call shape means webp-decoder.ts has no
 * platform branches at all, and a divergence between the backends cannot hide in
 * a shape difference.
 */

import * as cc from 'cc';
import { EDITOR, NATIVE, PREVIEW } from 'cc/env';

/**
 * Opaque decoder handle. Never inspect it — the wasm backend hands back a 32-bit
 * heap pointer (a Number) while the JSB backend hands back a 64-bit pointer as a
 * BigInt, so the only portable operations are "pass it back" and "test it for
 * truthiness". Both `0` and `0n` are falsy, so a failed open reads the same way
 * on either backend.
 */
export type WebpHandle = number | bigint;

export interface IWebpBackend {
    /** Returns a falsy handle if the bytes are not a decodable WebP. */
    open (bytes: Uint8Array): WebpHandle;
    /** Writes [width, height, frameCount, loopCount] into `out` (>= 4 cells). */
    getInfo (handle: WebpHandle, out: Uint32Array): boolean;
    /**
     * Pulls the next full-canvas RGBA8888 frame, already composited against its
     * predecessor, and writes its duration in ms into `durationOut[0]`. Returns
     * undefined once the sequence is exhausted.
     *
     * The returned array is a private copy, safe to hold indefinitely.
     */
    nextFrame (handle: WebpHandle, durationOut: Int32Array): Uint8Array | undefined;
    /** Rewinds to frame 0. */
    reset (handle: WebpHandle): boolean;
    close (handle: WebpHandle): void;
}

// --- native (JSB) ---

// Registered by CC_PLUGIN_ENTRY -> addRegisterCallback during engine startup,
// so it is already in place by the time any scene script runs.
function nativeBackend (): IWebpBackend | undefined {
    return (globalThis as { __animatedImageWebP?: IWebpBackend }).__animatedImageWebP;
}

// --- wasm (cc.wasm) ---

// cc.wasm is the engine's packaged wasm loader (pal/wasm), re-exported by
// engines carrying the webassembly export. It has no .d.ts, so it has to be
// reached through a cast or the host project's typecheck fails.
interface IWasmPal {
    instantiateWasm (
        binary: string,
        importObject: WebAssembly.Imports,
    ): Promise<WebAssembly.WebAssemblyInstantiatedSource>;
}

function ccWasm (): IWasmPal | undefined {
    return (cc as unknown as { wasm?: IWasmPal }).wasm;
}

// A bare file name, never a path: each host prefixes its own. Published web and
// mini-game builds get it from `cocos-js/` next to the engine; the editor and
// browser preview resolve `external:` against the engine's native/external/,
// which main.js populates on extension load.
const WASM_BINARY = EDITOR || PREVIEW
    ? 'external:animated-webp.wasm'
    : 'animated-webp.wasm';

// The Emscripten glue exports a factory. gen-glue-file.js converted the ESM
// output to CommonJS because a mounted .js is loaded as CJS.
interface IWasmModule {
    HEAPU8: Uint8Array;
    _malloc (size: number): number;
    _free (ptr: number): void;
    _webpAnimOpen (data: number, size: number): number;
    _webpAnimGetInfo (handle: number, out: number): number;
    _webpAnimNextFrame (handle: number, durationMs: number): number;
    _webpAnimReset (handle: number): number;
    _webpAnimClose (handle: number): void;
}

async function loadWasmFactory (): Promise<(options?: unknown) => Promise<IWasmModule>> {
    // The Cocos build pipeline handles this split point even though its
    // generated tsc config still says `module: ES2015`, where TypeScript would
    // reject import().
    // @ts-ignore dynamic import is supported by the Cocos build pipeline
    const glue = await import('./animated-webp.js');
    return glue.default as (options?: unknown) => Promise<IWasmModule>;
}

async function instantiate (): Promise<IWasmModule> {
    const pal = ccWasm();
    if (!pal) {
        throw new Error('[animated-image] cc.wasm is unavailable; WebP needs an engine that exports the webassembly interface');
    }
    const factory = await loadWasmFactory();
    // The instantiateWasm hook is Emscripten's old single-callback form: it can
    // report success and nothing else. A rejection inside it goes nowhere, so
    // failures have to reject this Promise, which we own.
    return new Promise<IWasmModule>((resolve, reject) => {
        factory({
            instantiateWasm (
                imports: WebAssembly.Imports,
                onSuccess: (instance: WebAssembly.Instance) => void,
            ): Record<string, never> {
                pal.instantiateWasm(WASM_BINARY, imports).then((result) => {
                    onSuccess(result.instance);
                }).catch((e) => {
                    reject(new Error(`[animated-image] instantiateWasm('${WASM_BINARY}') failed: ${String(e)}`));
                });
                return {};
            },
        }).then(resolve).catch(reject);
    });
}

function wrapWasm (module: IWasmModule): IWebpBackend {
    // ALLOW_MEMORY_GROWTH replaces the heap's backing buffer on growth, which
    // detaches every view taken before it. Read module.HEAPU8 on each access
    // rather than capturing it once.
    const scratch = module._malloc(SCRATCH_BYTES);
    if (!scratch) throw new Error('[animated-image] wasm heap allocation failed');

    return {
        open (bytes: Uint8Array): WebpHandle {
            const input = module._malloc(bytes.byteLength);
            if (!input) return 0;
            try {
                module.HEAPU8.set(bytes, input);
                // webpAnimOpen copies the input, so this block can go right back.
                return module._webpAnimOpen(input, bytes.byteLength);
            } finally {
                module._free(input);
            }
        },
        getInfo (handle: WebpHandle, out: Uint32Array): boolean {
            if (!module._webpAnimGetInfo(handle as number, scratch)) return false;
            const cells = new Uint32Array(module.HEAPU8.buffer, scratch, INFO_CELLS);
            out.set(cells.subarray(0, Math.min(INFO_CELLS, out.length)));
            return true;
        },
        nextFrame (handle: WebpHandle, durationOut: Int32Array): Uint8Array | undefined {
            // The C ABI returns a bare pointer, so the canvas size has to come
            // from a separate call. It is a struct read, not a decode.
            if (!module._webpAnimGetInfo(handle as number, scratch)) return undefined;
            const cells = new Uint32Array(module.HEAPU8.buffer, scratch, INFO_CELLS);
            const byteLength = cells[0] * cells[1] * 4;

            const durationPtr = scratch + INFO_CELLS * 4;
            const frame = module._webpAnimNextFrame(handle as number, durationPtr);
            if (!frame) return undefined;
            // Views are taken after the call: the first pull allocates the
            // canvas, which can grow the heap and detach anything older.
            durationOut[0] = new Int32Array(module.HEAPU8.buffer, durationPtr, 1)[0];
            // Copy out — the decoder overwrites this canvas on the next pull.
            return module.HEAPU8.slice(frame, frame + byteLength);
        },
        reset (handle: WebpHandle): boolean {
            return !!module._webpAnimReset(handle as number);
        },
        close (handle: WebpHandle): void {
            module._webpAnimClose(handle as number);
        },
    };
}

const INFO_CELLS = 4;
// The info cells plus one int32 for the duration out-param, allocated once and
// reused: every call writes it before reading it back.
const SCRATCH_BYTES = INFO_CELLS * 4 + 4;

// --- public loader ---

let backend: IWebpBackend | null = null;
let loading: Promise<IWebpBackend> | null = null;

export function loadWebpBackend (): Promise<IWebpBackend> {
    if (backend) return Promise.resolve(backend);
    if (!loading) {
        loading = (async () => {
            try {
                if (NATIVE) {
                    // Deliberately no wasm fallback here. On native the wasm
                    // path may well work, and taking it would turn "the native
                    // plugin did not get compiled in" into a silent slowdown
                    // instead of an error anyone would notice.
                    const jsb = nativeBackend();
                    if (!jsb) {
                        throw new Error('[animated-image] native WebP binding is unavailable; the animated_webp native plugin was not built into this package');
                    }
                    backend = jsb;
                } else {
                    backend = wrapWasm(await instantiate());
                }
                return backend;
            } catch (e) {
                // Let a later attempt retry rather than caching the failure —
                // in the editor the engine's external/ directory may only be
                // populated after the first try.
                loading = null;
                throw e;
            }
        })();
    }
    return loading;
}
