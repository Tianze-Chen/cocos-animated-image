'use strict';

/**
 * Build hooks for the animated-image extension.
 *
 * onAfterBuild copies the prebuilt animated-webp.wasm into the build output's
 * cocos-js/ directory, which is where the engine's pal/wasm resolves a bare
 * `.wasm` name:
 *
 *   - web:       fetched relative to import.meta.url, i.e. from inside cocos-js/;
 *   - mini-game: resolved to `cocos-js/<name>` and handed to
 *                CCWebAssembly.instantiate as a path — WeChat's WXWebAssembly
 *                accepts only a path, never bytes, which is why the file has to
 *                exist separately instead of being embedded;
 *   - native:    skipped, the JSB binding decodes there and no .wasm is loaded.
 *
 * runtime/webp/index.ts passes the bare name `animated-webp.wasm`, matching the
 * destination file name below.
 *
 * Whether WebP is wanted at all comes from trim.json, which the format panel
 * derives from the project's profile (see editor/trim.js). It is read with plain
 * fs rather than Editor.Profile because this file runs in the builder's worker
 * process, where the Editor API is not available. A missing or unreadable
 * trim.json means "keep everything", matching the committed default.
 */

const fs = require('fs');
const path = require('path');

const WASM_NAME = 'animated-webp.wasm';
const WASM_SOURCE = path.join(__dirname, '..', '..', 'native', 'wasm', 'prebuilt', WASM_NAME);
const TRIM_JSON = path.join(__dirname, 'trim.json');

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
function findCocosJsDir (result) {
    const bases = [];
    if (result && result.dest) bases.push(result.dest);
    if (result && result.paths && result.paths.output) bases.push(result.paths.output);
    for (const base of bases) {
        const candidate = path.join(base, 'cocos-js');
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (e) {
            // ignore and try the next base
        }
    }
    return null;
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

        if (trim.webp === false) {
            log(`skip ${WASM_NAME} (WebP 已裁剪)`);
            return;
        }
        const platform = options && options.platform;
        if (!shouldCopy(platform)) {
            log(`skip ${WASM_NAME} (native platform: ${platform})`);
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
    } catch (e) {
        log(`onAfterBuild error: ${e && e.message}`);
    }
};
