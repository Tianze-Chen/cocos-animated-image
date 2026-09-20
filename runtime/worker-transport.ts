// 主线程侧 worker 传输适配：微信 wx.createWorker（按路径，game.json 需声明 workers）与
// 浏览器（预览经 /engine_external/、web 构建经 cocos-js/，都是 fetch 文本 → Blob URL → Worker）
// 双宿主，同一份 worker bundle、同一个消息协议。
//
// 任何失败都返回确定的 null，由 image-decoder.ts 的分发链降级到主线程解码 —— 注意这与引擎
// pal/wasm 的失败形态相反（那边是 noop 出来的永不 settle 的 Promise），这里绝不能挂起调用方。
// 零 cc 依赖：原生平台（无 Worker 全局、wx 也未注入）isDecoderWorkerSupported() 自然为 false。

import { WORKER_FILE_NAME, WX_WORKER_SCRIPT } from './worker-protocol';

export interface DecoderWorkerHandle {
    /** transfer 列表仅浏览器宿主生效（overlay-canvas 把 OffscreenCanvas 转移过线）；
     *  微信接口只有单参 postMessage（结构化拷贝），包装层忽略第二参。 */
    postMessage (message: unknown, transfer?: unknown[]): void;
    onMessage (handler: (message: unknown) => void): void;
    terminate (): void;
    /** 浏览器经典 worker 支持 transfer 列表；微信接口只有单参 postMessage（结构化拷贝）。 */
    readonly transfers: boolean;
}

interface WxRawWorker {
    onMessage (callback: (message: unknown) => void): void;
    postMessage (message: unknown): void;
    terminate (): void;
}

export function isWechatWorkerAvailable (): boolean {
    const wxApi = (globalThis as { wx?: { createWorker?: unknown } }).wx;
    return !!wxApi && typeof wxApi.createWorker === 'function';
}

export function isBrowserWorkerAvailable (): boolean {
    // 注意 createObjectURL 是 URL 的静态方法,不是全局函数 —— 写成
    // globalThis.createObjectURL 会恒为 undefined,浏览器里整个探测恒 false,
    // worker 档静默回退主线程(2026-09 预览 A/B 全组 worker 段为 null 的根因)。
    const g = globalThis as {
        Worker?: unknown; fetch?: unknown; Blob?: unknown; URL?: { createObjectURL?: unknown };
    };
    return typeof g.Worker === 'function'
        && typeof g.fetch === 'function'
        && typeof g.Blob === 'function'
        && !!g.URL && typeof g.URL.createObjectURL === 'function';
}

export function isDecoderWorkerSupported (): boolean {
    return isWechatWorkerAvailable() || isBrowserWorkerAvailable();
}

// 依次尝试两个候选源：预览服务器（编辑器预览）与 web 构建产物目录。
// 第一个返回 200 且 Worker 建得起来的生效；都不可达 → null → 主线程解码。
const BROWSER_SOURCES = [
    `/engine_external/?url=external:${WORKER_FILE_NAME}`,
    `cocos-js/${WORKER_FILE_NAME}`,
];

function wrapBrowserWorker (worker: Worker): DecoderWorkerHandle {
    return {
        postMessage: (message, transfer) => {
            if (transfer && transfer.length > 0) {
                worker.postMessage(message, transfer as Transferable[]);
            } else {
                worker.postMessage(message);
            }
        },
        onMessage: (handler) => {
            worker.onmessage = (event) => { handler((event as MessageEvent).data); };
        },
        terminate: () => { worker.terminate(); },
        transfers: true,
    };
}

async function createBrowserWorker (): Promise<DecoderWorkerHandle | null> {
    for (const source of BROWSER_SOURCES) {
        let text: string | null = null;
        try {
            const response = await fetch(source);
            if (response.ok) {
                text = await response.text();
            }
        } catch (e) {
            // 该候选源不可达（比如预览环境里没有 cocos-js/），换下一个。
        }
        if (!text) { continue; }
        try {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
            return wrapBrowserWorker(new Worker(url));
        } catch (e) {
            console.warn(`[animated-image] 创建解码 worker 失败（${source}）：${String(e)}`);
        }
    }
    // 到这里说明浏览器能力探测过了、但两处交付源都没取到 worker 脚本 ——
    // 若静默返回 null,调用链会无感回退主线程,A/B 里 worker 组悄悄变基线。
    console.warn(`[animated-image] 解码 worker 脚本不可达（${BROWSER_SOURCES.join(' / ')}），本会话回退主线程解码`);
    return null;
}

function createWechatWorker (): DecoderWorkerHandle | null {
    const wxApi = (globalThis as { wx?: { createWorker?: (path: string) => WxRawWorker } }).wx;
    if (!wxApi || typeof wxApi.createWorker !== 'function') { return null; }
    try {
        const raw = wxApi.createWorker(WX_WORKER_SCRIPT);
        if (!raw) { return null; }
        return {
            postMessage: (message) => { raw.postMessage(message); },
            onMessage: (handler) => { raw.onMessage((msg) => { handler(msg); }); },
            terminate: () => { raw.terminate(); },
            transfers: false,
        };
    } catch (e) {
        // 最常见原因：game.json 没声明 workers 目录（构建钩子负责注入；手改过的 game.json 落到这里）。
        console.warn(`[animated-image] wx.createWorker(${WX_WORKER_SCRIPT}) 失败，回退主线程解码：${String(e)}`);
        return null;
    }
}

export async function acquireDecoderWorker (): Promise<DecoderWorkerHandle | null> {
    if (isWechatWorkerAvailable()) { return createWechatWorker(); }
    if (isBrowserWorkerAvailable()) { return createBrowserWorker(); }
    return null;
}
