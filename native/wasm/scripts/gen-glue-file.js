// Converts the Emscripten ESM glue into the CommonJS copy that ships under
// runtime/webp/.
//
// Why this exists: the build emits an ES module (MODULARIZE + EXPORT_ES6), but a
// .js mounted into a Cocos project is loaded as CommonJS. Two classes of edit
// are needed:
//
//   1. `import.meta` is a syntax error outside a module, so every use has to go
//      — including the `new URL('x.wasm', import.meta.url)` that resolves the
//      binary. We hand a bare filename to cc.wasm instead and let its per-host
//      resolver prefix it, so the URL computation is dead weight anyway.
//   2. Emscripten's environment detection assumes browser / worker / node. The
//      editor's scene worker and the mini-game sandboxes match none of them and
//      would hit `throw new Error('environment detection error')` before our
//      instantiateWasm hook ever runs. The guards get neutralised rather than
//      deleted, so the surrounding structure still reads like upstream glue when
//      you diff against a fresh build.
//
// Usage:
//   node native/wasm/scripts/gen-glue-file.js [input-dir]
//
// input-dir defaults to native/wasm/prebuilt (what build-wasm.ps1 populates);
// pass `build` to convert straight out of the CMake build tree.

const fs = require('fs');
const path = require('path');

const WASM_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.resolve(WASM_ROOT, '..', '..');

const INPUT_DIR = process.argv[2]
    ? path.resolve(PLUGIN_ROOT, process.argv[2])
    : path.join(WASM_ROOT, 'prebuilt');

const GLUE_IN = path.join(INPUT_DIR, 'animated-webp.js');
const GLUE_OUT = path.join(PLUGIN_ROOT, 'runtime', 'webp', 'animated-webp.js');

// `required` edits are load-bearing: if the glue changes shape enough that one
// stops matching, the output would be silently broken, so we fail the build
// instead. The optional ones only appear in some configurations (assertions,
// node support, the pthread paths) and are fine to miss.
//
// Note the whitespace-tolerant patterns: the shipped build is -Oz, so the glue
// arrives minified with no spaces around `=`.
const REPLACEMENTS = [
    {
        what: 'script-name self reference',
        from: /var\s+_scriptName\s*=\s*import\.meta\.url;/g,
        to: 'var _scriptName="";',
        required: true,
    },
    {
        what: 'node createRequire',
        // Only emitted when ENVIRONMENT includes node — the parity harness build.
        from: /createRequire\(import\.meta\.url\)/g,
        to: 'createRequire("")',
        required: false,
    },
    {
        what: 'wasm URL resolution',
        // Emscripten has spelled this several ways across versions; match the
        // shape (a new URL(...) against import.meta.url) rather than one of them.
        from: /new URL\(\s*(['"])animated-webp\.wasm\1\s*,\s*import\.meta\.url\s*\)(\.href)?/g,
        to: '"animated-webp.wasm"',
        required: true,
    },
    {
        what: 'browser/worker environment gate',
        from: /if \(!\(globalThis\.window \|\| globalThis\.WorkerGlobalScope\)\) throw new Error\(/g,
        to: 'if (false && !(globalThis.window || globalThis.WorkerGlobalScope)) throw new Error(',
        required: false,
    },
    {
        what: 'node version gate',
        from: /if \(currentNodeVersion < (TARGET_NOT_SUPPORTED|\d+)\) \{/g,
        to: 'if (false && currentNodeVersion < $1) {',
        required: false,
    },
    {
        what: 'environment detection throw',
        from: /throw new Error\((['"])environment detection error\1\);/g,
        to: '/* environment detection error (neutralised for CJS hosts) */;',
        required: false,
    },
    {
        what: 'environment assertions',
        from: /assert\(!ENVIRONMENT_IS_(WORKER|NODE|SHELL),/g,
        to: 'assert(true,',
        required: false,
    },
];

function main () {
    if (!fs.existsSync(GLUE_IN)) {
        console.error(`[gen-glue-file] missing ${GLUE_IN}`);
        console.error('[gen-glue-file] build it first: native/wasm/scripts/build-wasm.ps1');
        process.exit(1);
    }

    let src = fs.readFileSync(GLUE_IN, 'utf8');
    const applied = [];
    const missed = [];

    for (const rule of REPLACEMENTS) {
        const before = src;
        src = src.replace(rule.from, rule.to);
        if (src === before) {
            missed.push(rule);
        } else {
            applied.push(rule.what);
        }
    }

    // The ESM export is the one edit with no stable single spelling worth
    // guessing at, so handle the variants explicitly.
    const exportPatterns = [
        /export default (\w+);?/g,
        /export \{\s*(\w+) as default\s*\};?/g,
    ];
    let exported = false;
    for (const pattern of exportPatterns) {
        if (pattern.test(src)) {
            pattern.lastIndex = 0;
            src = src.replace(pattern, 'module.exports = $1;');
            exported = true;
        }
    }

    const fatal = missed.filter((rule) => rule.required).map((rule) => rule.what);
    if (!exported) fatal.push('ESM default export -> module.exports');
    // Anything left would be a syntax error the moment the file is require()d,
    // which surfaces as a confusing failure far from here.
    if (/import\.meta/.test(src)) fatal.push('leftover import.meta');
    if (/^\s*export\s/m.test(src)) fatal.push('leftover top-level export');

    if (fatal.length) {
        console.error('[gen-glue-file] cannot convert this glue file:');
        for (const item of fatal) console.error(`  - ${item}`);
        console.error('[gen-glue-file] the Emscripten output shape changed; update REPLACEMENTS');
        process.exit(1);
    }

    const banner = '// GENERATED by native/wasm/scripts/gen-glue-file.js -- do not edit.\n'
        + '// Source: Emscripten glue for native/wasm/CMakeLists.txt.\n'
        + '// Regenerate with native/wasm/scripts/build-wasm.ps1, which also refreshes\n'
        + '// the matching animated-webp.wasm -- the two must come from one build.\n';

    fs.mkdirSync(path.dirname(GLUE_OUT), { recursive: true });
    fs.writeFileSync(GLUE_OUT, banner + src, 'utf8');

    console.log(`[gen-glue-file] ${path.relative(PLUGIN_ROOT, GLUE_OUT)} (${src.length} bytes)`);
    console.log(`[gen-glue-file] applied: ${applied.join(', ')}`);
    const skipped = missed.filter((rule) => !rule.required).map((rule) => rule.what);
    if (skipped.length) console.log(`[gen-glue-file] not present: ${skipped.join(', ')}`);
}

main();
