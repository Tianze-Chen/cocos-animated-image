'use strict';

/**
 * Build hooks for the animated-image extension.
 *
 * onAfterBuild stages two payloads:
 *
 * 1. The prebuilt animated-webp.wasm into the build output's cocos-js/
 *    directory, which is where the engine's pal/wasm resolves a bare `.wasm`
 *    name:
 *
 *   - web:       fetched relative to import.meta.url, i.e. from inside cocos-js/;
 *   - mini-game: resolved to `cocos-js/<name>` and handed to
 *                CCWebAssembly.instantiate as a path — WeChat's WXWebAssembly
 *                accepts only a path, never bytes, which is why the file has to
 *                exist separately instead of being embedded;
 *   - native:    skipped, the JSB binding decodes there and no .wasm is loaded.
 *
 *    runtime/webp/index.ts passes the bare name `animated-webp.wasm`, matching
 *    the destination file name below.
 *
 * 2. The decoder-worker bundle (GIF/APNG off the main thread):
 *
 *   - wechatgame: workers/animated-image/decoder.js plus a "workers" entry in
 *                 game.json (wx.createWorker needs the directory declared);
 *   - web:        cocos-js/animated-image-decoder.js, next to the wasm;
 *   - everything else: skipped — other mini-games have different worker APIs
 *                 and the runtime transport never asks for the file there.
 *
 * Whether a format is wanted at all comes from trim.json, which the format
 * panel derives from the project's profile (see editor/trim.js). It is read
 * with plain fs rather than Editor.Profile because this file runs in the
 * builder's worker process, where the Editor API is not available. A missing or
 * unreadable trim.json means "keep everything", matching the committed default.
 */

const fs = require('fs');
const path = require('path');

const WASM_NAME = 'animated-webp.wasm';
const WASM_SOURCE = path.join(__dirname, '..', '..', 'native', 'wasm', 'prebuilt', WASM_NAME);
const TRIM_JSON = path.join(__dirname, 'trim.json');

// 解码 worker bundle（GIF/APNG 离主线程）。微信需要 workers/ 目录 + game.json 声明，
// web 构建与 wasm 同住 cocos-js/。game.json 的 "workers" 值 = 构建产物里的 workers 目录名，
// wx.createWorker 的脚本路径相对该目录（runtime/worker-protocol.ts 里的 WX_* 常量与这里对应）。
const WORKER_BUNDLE_NAME = 'animated-image-decoder.js';
const WORKER_BUNDLE_SOURCE = path.join(__dirname, '..', '..', 'worker', 'dist', WORKER_BUNDLE_NAME);
const WX_WORKERS_ROOT = 'workers';
const WX_WORKER_SCRIPT = 'animated-image/decoder.js';

// worker 只对 web 系和微信交付。其他小游戏平台（字节/支付宝…）的 worker 接口与 wx 不同，
// 运行时 transport 不会去取，拷过去只是死重。
const WEB_PLATFORMS = new Set(['web', 'web-mobile', 'web-desktop']);

// Platforms that use the JSB binding rather than wasm, so they need no .wasm.
// linux / ohos / harmonyos are listed even though the native plugin mechanism
// does not reach them (plugins_parser.js has no search-path suffix for those):
// they still take the NATIVE branch in runtime/webp/index.ts, which demands the
// JSB binding rather than falling back to wasm, so shipping the file would not
// help them.
const NATIVE_PLATFORMS = new Set([
    'android', 'ios', 'mac', 'windows', 'linux',
    'ohos', 'harmonyos-next', 'open-harmony', 'google-play',
]);

function log (msg) {
    console.log(`[animated-image] ${msg}`);
}

function shouldCopy (platform) {
    return !platform || !NATIVE_PLATFORMS.has(platform);
}

// Absent / unparseable / missing key all mean "kept", so a user who never opens
// the panel gets exactly today's behaviour.
function readTrim () {
    try {
        const parsed = JSON.parse(fs.readFileSync(TRIM_JSON, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function describeTrim (trim) {
    const keys = ['gif', 'apng', 'webp', 'demo'];
    return keys.map((k) => `${k}=${trim[k] === false ? 'off' : 'on'}`).join(' ');
}

// The output root has appeared under both names across editor versions.
function findBuildRoot (result) {
    if (result && result.dest) return result.dest;
    if (result && result.paths && result.paths.output) return result.paths.output;
    return null;
}

function findCocosJsDir (result) {
    const root = findBuildRoot(result);
    if (!root) return null;
    const candidate = path.join(root, 'cocos-js');
    try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
    } catch (e) {
        // fall through
    }
    return null;
}

function stageWasm (trim, options, result) {
    if (trim.webp === false) {
        log(`skip ${WASM_NAME} (WebP 已裁剪)`);
        return;
    }
    if (!shouldCopy(options && options.platform)) {
        log(`skip ${WASM_NAME} (native platform: ${options && options.platform})`);
        return;
    }
    if (!fs.existsSync(WASM_SOURCE)) {
        log(`skip ${WASM_NAME} (missing source: ${WASM_SOURCE})`);
        return;
    }
    const cocosJsDir = findCocosJsDir(result);
    if (!cocosJsDir) {
        log(`skip ${WASM_NAME} (could not resolve the cocos-js directory)`);
        return;
    }
    fs.mkdirSync(cocosJsDir, { recursive: true });
    const destination = path.join(cocosJsDir, WASM_NAME);
    fs.copyFileSync(WASM_SOURCE, destination);
    log(`copied ${WASM_NAME} -> ${destination}`);
}

// game.json 里声明 workers 目录（wx.createWorker 的前置条件）。已存在的 workers 配置
// （比如手动改过分包形态 {"workers": {"path": ..., "isSubpackage": true}}）不动 ——
// 只在完全没配置时注入默认的字符串形态。重写文件会归一化缩进，JSON 语义不变。
function injectWechatWorkers (gameJsonPath) {
    if (!fs.existsSync(gameJsonPath)) {
        log('skip game.json workers 注入 (game.json 不存在)');
        return;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
        if (parsed && parsed.workers) {
            log('game.json 已有 workers 配置，保持不变');
            return;
        }
        parsed.workers = WX_WORKERS_ROOT;
        fs.writeFileSync(gameJsonPath, JSON.stringify(parsed, null, 4), 'utf8');
        log(`game.json 注入 "workers": "${WX_WORKERS_ROOT}"`);
    } catch (e) {
        log(`skip game.json workers 注入 (${e && e.message})`);
    }
}

function stageWorkerBundle (trim, options, result) {
    if (trim.gif === false && trim.apng === false) {
        log(`skip ${WORKER_BUNDLE_NAME} (GIF/APNG 已裁剪)`);
        return;
    }
    const platform = options && options.platform;
    if (!fs.existsSync(WORKER_BUNDLE_SOURCE)) {
        log(`skip ${WORKER_BUNDLE_NAME} (missing source: ${WORKER_BUNDLE_SOURCE})`);
        return;
    }
    const root = findBuildRoot(result);
    if (!root) {
        log(`skip ${WORKER_BUNDLE_NAME} (could not resolve the build output root)`);
        return;
    }

    if (platform === 'wechatgame') {
        const workersTarget = path.join(root, WX_WORKERS_ROOT, 'animated-image');
        fs.mkdirSync(workersTarget, { recursive: true });
        const destination = path.join(workersTarget, 'decoder.js');
        fs.copyFileSync(WORKER_BUNDLE_SOURCE, destination);
        log(`copied ${WORKER_BUNDLE_NAME} -> ${destination} (wx 脚本路径: ${WX_WORKER_SCRIPT})`);
        injectWechatWorkers(path.join(root, 'game.json'));
        return;
    }

    if (WEB_PLATFORMS.has(platform)) {
        const cocosJsDir = findCocosJsDir(result) || path.join(root, 'cocos-js');
        fs.mkdirSync(cocosJsDir, { recursive: true });
        const destination = path.join(cocosJsDir, WORKER_BUNDLE_NAME);
        fs.copyFileSync(WORKER_BUNDLE_SOURCE, destination);
        log(`copied ${WORKER_BUNDLE_NAME} -> ${destination}`);
        return;
    }

    log(`skip ${WORKER_BUNDLE_NAME} (platform ${platform} 不走 worker)`);
}

exports.onAfterBuild = async function onAfterBuild (options, result) {
    // A throw here fails the whole build, which would be a wildly
    // disproportionate outcome for one optional codec's payload.
    try {
        // The only signal in the build log that says which formats this package
        // actually contains. Worth one line: everything else about trimming is
        // invisible until you diff the output.
        const trim = readTrim();
        log(`formats: ${describeTrim(trim)}`);

        stageWasm(trim, options, result);
        stageWorkerBundle(trim, options, result);
    } catch (e) {
        log(`onAfterBuild error: ${e && e.message}`);
    }
};
