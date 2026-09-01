'use strict';

// The extension is mount-only as far as game code goes: everything the runtime
// needs lives in ./runtime and reaches the project through
// contributions.asset-db.mount.
//
// This entry has two jobs.
//
// 1. Reconcile the format selection on every load (see editor/trim.js). The
//    selection lives in the project's own profile, so this is what makes a fresh
//    clone, a new machine, or an apply that died half way heal itself without the
//    user having to open the panel again.
//
// 2. Stage the WebP wasm binary where the editor and the browser preview can find
//    it. Both resolve `external:animated-webp.wasm` against the engine's own
//    native/external/ directory — the editor reads it with node's fs, the preview
//    server serves it from /engine_external/ — and neither looks inside an
//    extension. Copying it there on load is what makes the scene view work; the
//    preview HTTP endpoint alone would not cover the scene view, which does not go
//    through it.
//
// Published builds take a different route: editor/build/hooks.js puts the same
// file into the package's cocos-js/. Native platforms need neither, since they use
// the JSB binding.

const fs = require('fs');
const path = require('path');

const trim = require('./editor/trim');

const PACKAGE = 'animated-image';
const PROFILE_KEY = 'formats';
const WASM_NAME = 'animated-webp.wasm';
const WASM_SOURCE = path.join(__dirname, 'native', 'wasm', 'prebuilt', WASM_NAME);

function log (msg) {
    console.log(`[${PACKAGE}] ${msg}`);
}

function warn (msg) {
    console.warn(`[${PACKAGE}] ${msg}`);
}

async function readFormats () {
    // getProject falls back to contributions.profile.project.formats.default, so
    // a project that has never opened the panel reads back the shipped defaults
    // (WebP off — no stable engine exports cc.wasm yet). normalize() covers the
    // rest (an older config missing a key, a hand-edited value).
    let stored = null;
    try {
        stored = await Editor.Profile.getProject(PACKAGE, PROFILE_KEY, 'project');
    } catch (e) {
        warn(`无法读取格式配置，按全部启用处理：${e && e.message}`);
    }
    return trim.normalize(stored);
}

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

/**
 * Trimming moves files inside this extension directory, and the selection is
 * stored per project. Installed globally, one runtime/ is shared by every project
 * and switching projects would shuttle files back and forth — worth a warning
 * rather than a silent surprise.
 */
function warnIfGloballyInstalled () {
    try {
        const projectPath = Editor.Project && Editor.Project.path;
        if (!projectPath) return;
        const rel = path.relative(projectPath, __dirname);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            warn(
                '扩展装在工程之外（全局），但格式裁剪的配置是随工程存的 —— '
                + '同一份 runtime/ 会被所有工程共用，切换工程时文件会来回搬动。'
                + `建议改装到 <工程>/extensions/ 下。当前位置：${__dirname}`
            );
        }
    } catch (e) {
        // Editor.Project is not worth failing a load over.
    }
}

/** Log every report line — this is the trail for "why did my file move". */
function logReport (report) {
    log(`格式配置：${trim.describe(report.formats)}`);
    for (const line of report.moved) log(`移动 ${line}`);
    for (const line of report.rewrote) log(`重写 ${line}`);
    for (const line of report.warnings) warn(line);
}

/**
 * asset-db does not watch the filesystem — 3.8.8 only runs refresh-all-database
 * when the editor window regains focus — so moving files has to be announced
 * explicitly. Whether a readonly mount accepts this is unverified, which is why
 * nothing here depends on it succeeding: the restart hint below is the guaranteed
 * path and this is the fast path.
 */
async function refreshDatabase () {
    try {
        await Editor.Message.request('asset-db', 'refresh-asset', `db://${PACKAGE}`);
        return true;
    } catch (e) {
        warn(`刷新 db://${PACKAGE} 失败，重启编辑器即可生效：${e && e.message}`);
        return false;
    }
}

exports.methods = {
    async openFormats () {
        await Editor.Panel.open(`${PACKAGE}.formats`);
    },

    /** Panel data: the stored selection plus what is actually on disk. */
    async queryFormats () {
        return {
            formats: await readFormats(),
            groups: trim.inspect(),
            order: trim.GROUP_KEYS,
        };
    },

    /** Store the selection, then bring the files in line with it. */
    async applyFormats (formats) {
        const normalized = trim.normalize(formats);
        await Editor.Profile.setProject(PACKAGE, PROFILE_KEY, normalized, 'project');
        const report = trim.reconcile(normalized);
        logReport(report);
        report.refreshed = await refreshDatabase();
        if (report.warnings.length === 0) {
            report.warnings.push(
                `已应用：${trim.describe(report.formats)}。`
                + '若资源管理器或构建结果没有跟着更新，重启一次编辑器即可。'
            );
        }
        return report;
    },
};

exports.load = async function load () {
    log('extension loaded');
    warnIfGloballyInstalled();

    const formats = await readFormats();
    try {
        logReport(trim.reconcile(formats));
    } catch (e) {
        // A broken reconcile must not stop the extension from loading — the
        // runtime as committed is fully functional.
        warn(`格式裁剪对齐失败，运行时按磁盘现状工作：${e && e.message}`);
    }

    if (!formats.webp) {
        // Deliberately not deleting an already-staged copy: the same engine
        // installation may be in use by another project that still wants WebP.
        log(`skip staging ${WASM_NAME} (WebP 已裁剪)`);
        return;
    }
    try {
        const destination = await syncEditorWasm();
        log(`staged ${WASM_NAME} for the editor at ${destination}`);
    } catch (e) {
        // Only WebP needs this, and it degrades to a still first frame, so a
        // failure here must not stop the extension from loading.
        warn(`could not stage ${WASM_NAME}; WebP animation will fall back to its first frame in the editor: ${e && e.message}`);
    }
};

exports.unload = function () {
    log('extension unloaded');
};
