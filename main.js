'use strict';

// The extension is mount-only as far as game code goes: everything the runtime
// needs lives in ./runtime and reaches the project through
// contributions.asset-db.mount.
//
// The one job this entry has is staging the WebP wasm binary where the editor
// and the browser preview can find it. Both resolve `external:animated-webp.wasm`
// against the engine's own native/external/ directory — the editor reads it with
// node's fs, the preview server serves it from /engine_external/ — and neither
// looks inside an extension. Copying it there on load is what makes the scene
// view work; the preview HTTP endpoint alone would not cover the scene view,
// which does not go through it.
//
// Published builds take a different route: editor/build/hooks.js puts the same
// file into the package's cocos-js/. Native platforms need neither, since they
// use the JSB binding.

const fs = require('fs');
const path = require('path');

const WASM_NAME = 'animated-webp.wasm';
const WASM_SOURCE = path.join(__dirname, 'native', 'wasm', 'prebuilt', WASM_NAME);

async function syncEditorWasm () {
    const info = await Editor.Message.request('engine', 'query-engine-info');
    const nativePath = info && info.native && info.native.path;
    if (!nativePath) {
        throw new Error('engine native path is unavailable');
    }
    if (!fs.existsSync(WASM_SOURCE)) {
        throw new Error(`wasm source is missing: ${WASM_SOURCE}`);
    }
    const destination = path.join(nativePath, 'external', WASM_NAME);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(WASM_SOURCE, destination);
    return destination;
}

exports.load = async function load () {
    console.log('[animated-image] extension loaded');
    try {
        const destination = await syncEditorWasm();
        console.log(`[animated-image] staged ${WASM_NAME} for the editor at ${destination}`);
    } catch (e) {
        // Only WebP needs this, and it degrades to a still first frame, so a
        // failure here must not stop the extension from loading.
        console.warn(`[animated-image] could not stage ${WASM_NAME}; WebP animation will fall back to its first frame in the editor: ${e && e.message}`);
    }
};

exports.unload = function () {
    console.log('[animated-image] extension unloaded');
};
