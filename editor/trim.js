'use strict';

/**
 * Format trimming for the animated-image extension.
 *
 * Why files have to physically move
 * --------------------------------
 * Cocos Creator 3.8 treats every script under a script directory as a bundle
 * entry and does not tree-shake unreferenced ones — scenes and prefabs reference
 * components by UUID, so the builder cannot prove any script is dead. Measured on
 * a real build: 13 source .ts produced exactly 13 `_RF.push` module
 * registrations, including an index.ts nothing imports and a types.ts holding
 * only `interface`s. So commenting out an import saves runtime cost and zero
 * bytes of package. The only lever that removes a codec from the output is for
 * its files to be absent from the mounted directory when the build runs.
 *
 * Hence move semantics: trimming moves a group out of runtime/ into the sibling
 * trimmed/, untrimming moves it back. One copy, no duplication, no drift, and the
 * .meta files travel with their source so UUIDs survive a round trip.
 *
 * Three payloads, three switches — WebP reaches the package by three unrelated
 * routes and each has to be closed separately:
 *
 *   mounted TS/JS  -> the files must not be in runtime/ at build time (above)
 *   animated-webp.wasm (~89KB) -> editor/build/hooks.js reads trim.json and skips
 *   native C++ (~60KB) -> native/cc_plugin.json's `platforms` becomes []
 *
 * trim.json exists because hooks.js runs in the builder's worker process, where
 * Editor.Profile is not available; plain fs against a derived file is the
 * dependable route. Editor.Profile stays the authority, trim.json is its mirror.
 *
 * Everything here is deliberately Editor-free and synchronous so it can run from
 * the main process, from the panel's message handler, and from plain node. The
 * Editor-side follow-up (asset-db refresh, dialog) lives in main.js, driven by
 * the report this returns.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const TRIMMED_DIR = path.join(ROOT, 'trimmed');
const TRIM_JSON = path.join(ROOT, 'editor', 'build', 'trim.json');
const CC_PLUGIN_JSON = path.join(ROOT, 'native', 'cc_plugin.json');

// Only these four are reachable: plugins_parser.js maps just android / ios /
// windows / mac to a search-path suffix, so the others could never find the
// plugin anyway.
const NATIVE_PLATFORMS = ['android', 'ios', 'windows', 'mac'];

/**
 * The trimmable groups. `entries` are names inside runtime/; each moves together
 * with its sibling .meta (`webp` is a directory, its meta is `webp.meta`, and the
 * metas of the files inside it travel with the directory).
 *
 * Everything not listed here is core and never moves: AnimatedImage.ts,
 * AnimatedImagePlayer.ts, image-decoder.ts, static-decoder.ts, decoder-registry.ts,
 * mime-sniff.ts, bytes.ts, types.ts. PNG / JPEG stills and the WebP first-frame
 * fallback all run through static-decoder.ts.
 */
const GROUPS = {
    gif: {
        label: 'GIF',
        note: '纯 JS LZW 解码器，无外部依赖',
        entries: ['gif-decoder.ts'],
    },
    apng: {
        label: 'APNG',
        note: '纯 JS，含 zlib inflate',
        entries: ['apng-decoder.ts', 'zlib.min.ts'],
    },
    webp: {
        label: 'WebP',
        note: '另有 ~89KB .wasm（web / 小游戏）或 ~60KB 原生 C++',
        entries: ['webp-decoder.ts', 'webp'],
    },
    demo: {
        label: 'Demo 组件',
        note: '演示用，场景里挂过 AnimatedImageDemo 的话关掉会让那个组件丢失',
        entries: ['AnimatedImageDemo.ts'],
    },
};

const GROUP_KEYS = Object.keys(GROUPS);

/**
 * The shipped default set, used wherever a stored config has gaps. WebP is off:
 * its off-native backend needs an engine that exports cc.wasm (cocos/cocos4#306)
 * and no stable release has that yet, so defaulting it on would ship ~113KB that
 * nothing can load. The other three are on.
 */
function defaults () {
    return { gif: true, apng: true, webp: false, demo: true };
}

/** Coerce anything (missing keys, stale keys, non-booleans) into a full valid set. */
function normalize (raw) {
    const out = defaults();
    if (raw && typeof raw === 'object') {
        for (const key of GROUP_KEYS) {
            if (key in raw) out[key] = !!raw[key];
        }
    }
    return out;
}

// ---------------------------------------------------------------- file moving

function exists (p) {
    try {
        fs.statSync(p);
        return true;
    } catch (e) {
        return false;
    }
}

/** An entry and its sibling .meta, which must never be separated. */
function withMeta (entry) {
    return [entry, `${entry}.meta`];
}

function move (name, fromDir, toDir) {
    const src = path.join(fromDir, name);
    const dst = path.join(toDir, name);
    if (!exists(src)) return exists(dst) ? 'already' : 'missing';
    if (exists(dst)) return 'conflict';
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
        fs.renameSync(src, dst);
    } catch (e) {
        // Different volumes cannot be renamed across. Both directories are
        // siblings inside the extension so this should not happen, but a copy
        // fallback costs three lines and turns a hard failure into a slow one.
        if (e && e.code !== 'EXDEV') throw e;
        fs.cpSync(src, dst, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
    return 'moved';
}

/** Sum the shippable bytes of a group wherever it currently lives (.meta excluded — metas do not ship). */
function groupBytes (key) {
    let total = 0;
    const walk = (p) => {
        let st;
        try {
            st = fs.statSync(p);
        } catch (e) {
            return;
        }
        if (st.isDirectory()) {
            for (const child of fs.readdirSync(p)) walk(path.join(p, child));
            return;
        }
        if (p.endsWith('.meta')) return;
        total += st.size;
    };
    for (const entry of GROUPS[key].entries) {
        const inRuntime = path.join(RUNTIME_DIR, entry);
        walk(exists(inRuntime) ? inRuntime : path.join(TRIMMED_DIR, entry));
    }
    return total;
}

/**
 * What is actually on disk right now, per group. The panel shows this rather than
 * the stored config so a mismatch (a half-finished apply, someone moving files by
 * hand) is visible instead of silently wrong.
 */
function inspect () {
    const out = {};
    for (const key of GROUP_KEYS) {
        const group = GROUPS[key];
        const inRuntime = group.entries.filter((e) => exists(path.join(RUNTIME_DIR, e)));
        const inTrimmed = group.entries.filter((e) => exists(path.join(TRIMMED_DIR, e)));
        out[key] = {
            label: group.label,
            note: group.note,
            present: inRuntime.length === group.entries.length,
            partial: inRuntime.length > 0 && inRuntime.length < group.entries.length,
            missing: inRuntime.length === 0 && inTrimmed.length === 0,
            bytes: groupBytes(key),
        };
    }
    return out;
}

// ------------------------------------------------------------ generated files

const GENERATED_HEADER = [
    ' * 本文件由「面板 → AnimatedImage 格式」生成，手改会在下一次应用勾选时被覆盖。',
    ' *',
    ' * 增减格式请打开那个面板 —— 它同时把对应源码在 runtime/ 和 trimmed/ 之间移动。只改这里',
    ' * 的 import 是没用的：Cocos 3.8 把脚本目录下的每个脚本都当 bundle 入口，不做未引用脚本的',
    ' * tree-shaking，注释掉一行省的是运行时开销而不是包体。',
];

function renderCodecs (formats, absent) {
    const missing = absent || {};
    const lines = [
        '/**',
        ' * Animated Image — 格式配置（生成文件）',
        ' *',
        ...GENERATED_HEADER,
        ' */',
        "import { registerDecoder } from './decoder-registry';",
        '',
    ];
    const codecs = [
        { key: 'gif', mime: 'image/gif', factory: 'createGifDecoder', module: './gif-decoder' },
        { key: 'apng', mime: 'image/apng', factory: 'createApngDecoder', module: './apng-decoder' },
        { key: 'webp', mime: 'image/webp', factory: 'createWebpDecoder', module: './webp-decoder' },
    ];
    for (const codec of codecs) {
        const group = GROUPS[codec.key];
        if (missing[codec.key]) {
            // Emitting the import anyway would break the project's compile and
            // point the error at a generated file. The panel and the log say what
            // actually happened.
            lines.push(`// ${group.label} —— 已勾选但源码缺失，本次未注册（见扩展日志）`);
        } else if (formats[codec.key]) {
            lines.push(`// ${group.label} —— ${group.note}`);
            lines.push(`import { ${codec.factory} } from '${codec.module}';`);
            lines.push(`registerDecoder('${codec.mime}', ${codec.factory});`);
        } else {
            lines.push(`// ${group.label} —— 已裁剪，源码在 trimmed/，勾回来即恢复`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function renderIndex (formats, absent) {
    const missing = absent || {};
    const lines = [
        '/**',
        ' * Animated Image — 入口（生成文件）',
        ' *',
        ...GENERATED_HEADER,
        ' */',
        "export { AnimatedImagePlayer, AnimatedImagePlayerState } from './AnimatedImagePlayer';",
        "export { AnimatedImage, AnimatedImageSourceType } from './AnimatedImage';",
    ];
    if (formats.demo && !missing.demo) {
        lines.push("export { AnimatedImageDemo } from './AnimatedImageDemo';");
    }
    lines.push("export { registerDecoder } from './decoder-registry';");
    lines.push('');
    return lines.join('\n');
}

/**
 * Write only when the content really differs, so an idempotent reconcile does not
 * churn mtimes (which would make asset-db reimport for nothing).
 *
 * The comparison ignores line endings, and a rewrite keeps whatever the file
 * already used. Without that, a Windows checkout with core.autocrlf on holds these
 * files as CRLF while the generator emits LF, so every single extension load would
 * see a "difference" and rewrite all of them — the exact churn this function is
 * here to prevent.
 */
function writeIfChanged (file, content) {
    let current = null;
    try {
        current = fs.readFileSync(file, 'utf8');
    } catch (e) {
        // absent — fall through and write
    }
    const lf = (s) => s.replace(/\r\n/g, '\n');
    if (current !== null && lf(current) === lf(content)) return false;
    const useCrlf = current !== null && current.includes('\r\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, useCrlf ? content.replace(/\n/g, '\r\n') : content);
    return true;
}

// ------------------------------------------------------------- other switches

function writeTrimJson (formats) {
    // Two spaces and a trailing newline so a user diffing their repo sees a
    // normal-looking JSON file.
    return writeIfChanged(TRIM_JSON, `${JSON.stringify(formats, null, 2)}\n`);
}

/**
 * The native plugin is admitted by cc_plugin.json regardless of what the TS side
 * registered. `platforms` is matched against the CMake platform name by exact
 * string containment (plugins_parser.js: `indexOf(PLATFORM_NAME) < 0` → skip), so
 * an empty array excludes every platform. That is cleaner than deleting the
 * manifest: the parser's own field validation is dead code (plugins_parser.js:141
 * calls Object.hasOwnProperty with the object as the key, always true) and a
 * malformed manifest is swallowed by an outer try/catch, so a missing file would
 * "work" only by accident.
 */
function writeCcPlugin (formats) {
    let raw;
    try {
        raw = fs.readFileSync(CC_PLUGIN_JSON, 'utf8');
    } catch (e) {
        return false;
    }
    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch (e) {
        throw new Error(`native/cc_plugin.json is not valid JSON: ${e.message}`);
    }
    manifest.platforms = formats.webp ? NATIVE_PLATFORMS.slice() : [];
    return writeIfChanged(CC_PLUGIN_JSON, `${JSON.stringify(manifest, null, 4)}\n`);
}

// ------------------------------------------------------------------ reconcile

/**
 * Bring the whole extension in line with `formats`. Idempotent: safe to call on
 * every extension load, which is what makes it self-healing after a machine
 * change, a colleague's committed settings, or an apply that died half way.
 *
 * Returns a report: { formats, moved[], warnings[], rewrote[] }.
 */
function reconcile (rawFormats) {
    const formats = normalize(rawFormats);
    const report = { formats, moved: [], warnings: [], rewrote: [] };

    fs.mkdirSync(TRIMMED_DIR, { recursive: true });

    for (const key of GROUP_KEYS) {
        const keep = formats[key];
        const from = keep ? TRIMMED_DIR : RUNTIME_DIR;
        const to = keep ? RUNTIME_DIR : TRIMMED_DIR;
        for (const entry of GROUPS[key].entries) {
            for (const name of withMeta(entry)) {
                let result;
                try {
                    result = move(name, from, to);
                } catch (e) {
                    report.warnings.push(`${key}: 移动 ${name} 失败：${e && e.message}`);
                    continue;
                }
                if (result === 'moved') {
                    report.moved.push(`${name} -> ${keep ? 'runtime/' : 'trimmed/'}`);
                } else if (result === 'conflict') {
                    report.warnings.push(
                        `${key}: ${name} 在 runtime/ 和 trimmed/ 里都存在，保留了 runtime/ 那份，请手动删掉多余的一份`
                    );
                } else if (result === 'missing' && !name.endsWith('.meta')) {
                    // A missing .meta is survivable (the editor regenerates one,
                    // with a new UUID). A missing source file is not.
                    report.warnings.push(`${key}: 找不到 ${name}，runtime/ 和 trimmed/ 里都没有`);
                }
            }
        }
    }

    // What the generated files and the payload switches may actually rely on: a
    // group that was asked for but whose source is not in runtime/ once the moves
    // are done (someone deleted it, or a move failed above).
    const absent = {};
    const effective = {};
    for (const key of GROUP_KEYS) {
        const here = GROUPS[key].entries.every((e) => exists(path.join(RUNTIME_DIR, e)));
        absent[key] = formats[key] && !here;
        effective[key] = formats[key] && here;
        if (absent[key]) {
            report.warnings.push(`${key}: 已勾选但 runtime/ 里没有对应源码，本次按未启用处理`);
        }
    }

    if (writeIfChanged(path.join(RUNTIME_DIR, 'codecs.ts'), renderCodecs(formats, absent))) {
        report.rewrote.push('runtime/codecs.ts');
    }
    if (writeIfChanged(path.join(RUNTIME_DIR, 'index.ts'), renderIndex(formats, absent))) {
        report.rewrote.push('runtime/index.ts');
    }
    // The payload switches follow what is really available, not what was asked
    // for, so a group whose source vanished does not ship a .wasm nothing loads.
    if (writeTrimJson(effective)) report.rewrote.push('editor/build/trim.json');
    try {
        if (writeCcPlugin(effective)) report.rewrote.push('native/cc_plugin.json');
    } catch (e) {
        report.warnings.push(e.message);
    }

    return report;
}

/** The one-line summary used in logs and in the panel's status row. */
function describe (formats) {
    const on = GROUP_KEYS.filter((k) => formats[k]).map((k) => GROUPS[k].label);
    const off = GROUP_KEYS.filter((k) => !formats[k]).map((k) => GROUPS[k].label);
    return `保留 ${on.length ? on.join(' / ') : '无'}；已裁剪 ${off.length ? off.join(' / ') : '无'}`;
}

module.exports = {
    GROUPS,
    GROUP_KEYS,
    NATIVE_PLATFORMS,
    ROOT,
    RUNTIME_DIR,
    TRIMMED_DIR,
    TRIM_JSON,
    defaults,
    normalize,
    inspect,
    reconcile,
    describe,
    renderCodecs,
    renderIndex,
};
