// Verification harness for the WebP wasm backend.
//
//   node native/wasm/scripts/verify-wasm.js
//
// Loads the SHIPPED artifacts (runtime/webp/animated-webp.js plus
// native/wasm/prebuilt/animated-webp.wasm) through the same instantiateWasm hook
// the plugin uses at runtime, so a glue-conversion bug fails here rather than in
// a mini-game. Three gates:
//
//   1. upstream md5 -- decode libwebp's own test corpus and compare against the
//      `.pam` md5s libwebp publishes in libwebp_tests.md5. Those are md5s of
//      `dwebp -pam` output, i.e. of a MODE_RGBA buffer behind a fixed ASCII
//      header, which is exactly what our ABI hands back. This is the only gate
//      whose expected values come from outside this machine, so it is the one
//      that can catch a wrong vendored source set or a bad size knob.
//
//   2. prototype parity -- byte-compare against the earlier eager decoder in
//      cocos-engine/build/codex-webp-minimal. Provenance worth knowing: that
//      prototype is NOT independent of libwebp (same 1.6.0 source), and the
//      `prod/webpxmux.*` next to it is the prototype renamed for drop-in use,
//      not the genuine 1.7MB webpxmux -- the real one went away with
//      pal/image-decoder. It was verified byte-for-byte against genuine webpxmux
//      while that still existed, so treat this gate as a regression check on the
//      streaming ABI rewrite (eager whole-file decode -> pull one frame at a
//      time), not as independent proof of decoding.
//
//   3. streaming behaviour -- frame durations, loop count, and that reset()
//      replays a sequence identically. The player seeks backwards through
//      reset(), and WebP frames carry blend/dispose dependencies, so a reset
//      that leaves canvas state behind would show up as corruption only after a
//      loop.
//
// Gates whose reference data is absent are skipped loudly rather than silently.
// Override the reference root with --engine <path> or ANIMATED_IMAGE_ENGINE.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');

function argValue (name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const ENGINE_ROOT = argValue('--engine')
    || process.env.ANIMATED_IMAGE_ENGINE
    || 'D:/code/cocos-engine';

const GLUE = path.join(PLUGIN_ROOT, 'runtime', 'webp', 'animated-webp.js');
const WASM = path.join(PLUGIN_ROOT, 'native', 'wasm', 'prebuilt', 'animated-webp.wasm');

const CORPUS_DIR = path.join(ENGINE_ROOT, 'build', 'codex-libwebp-test-data');
const MD5_LIST = path.join(CORPUS_DIR, 'libwebp_tests.md5');
const PROTOTYPE_DIR = path.join(ENGINE_ROOT, 'build', 'codex-webp-minimal', 'prod');
const ANIM_SAMPLE = path.join(
    ENGINE_ROOT, 'build', 'codex-pillow-full', 'Tests', 'images', 'iss634.webp');

// ---------------------------------------------------------------- our backend

async function loadBackend () {
    const factory = require(GLUE);
    const binary = fs.readFileSync(WASM);
    const module = await factory({
        // The production path never lets Emscripten fetch the binary itself;
        // exercise the same hook here. Note the single-callback signature — this
        // hook cannot report failure, which is why the runtime wrapper keeps its
        // own promise.
        instantiateWasm (imports, onSuccess) {
            WebAssembly.instantiate(binary, imports)
                .then((result) => onSuccess(result.instance));
            return {};
        },
    });

    const open = module.cwrap('webpAnimOpen', 'number', ['number', 'number']);
    const getInfo = module.cwrap('webpAnimGetInfo', 'number', ['number', 'number']);
    const nextFrame = module.cwrap('webpAnimNextFrame', 'number', ['number', 'number']);
    const reset = module.cwrap('webpAnimReset', 'number', ['number']);
    const close = module.cwrap('webpAnimClose', 'number', ['number']);

    // ALLOW_MEMORY_GROWTH detaches the old views, so every read has to go
    // through the live Module fields rather than a captured reference.
    const u8 = () => module.HEAPU8;
    const u32 = () => module.HEAPU32;
    const i32 = () => new Int32Array(module.HEAPU8.buffer);

    function decode (bytes, { frameLimit = Infinity } = {}) {
        const input = module._malloc(bytes.byteLength);
        assert.ok(input > 0, 'malloc for input failed');
        let handle = 0;
        try {
            u8().set(bytes, input);
            handle = open(input, bytes.byteLength);
        } finally {
            // webpAnimOpen copies the input, so the demuxer does not need this
            // block to stay alive.
            module._free(input);
        }
        if (!handle) return null;

        const infoPtr = module._malloc(16);
        const durationPtr = module._malloc(4);
        try {
            assert.ok(getInfo(handle, infoPtr), 'webpAnimGetInfo failed');
            const cells = u32().subarray(infoPtr >>> 2, (infoPtr >>> 2) + 4);
            const [width, height, frameCount, loopCount] = cells;
            const byteLength = width * height * 4;

            const frames = [];
            const wanted = Math.min(frameCount, frameLimit);
            for (let index = 0; index < wanted; ++index) {
                const framePtr = nextFrame(handle, durationPtr);
                assert.ok(framePtr, `webpAnimNextFrame returned null at frame ${index}`);
                frames.push({
                    duration: i32()[durationPtr >>> 2],
                    // The canvas is decoder-owned and the next pull overwrites
                    // it, so copy before continuing.
                    pixels: Buffer.from(u8().subarray(framePtr, framePtr + byteLength)),
                });
            }
            return { width, height, frameCount, loopCount, frames, handle };
        } catch (error) {
            close(handle);
            throw error;
        } finally {
            module._free(infoPtr);
            module._free(durationPtr);
        }
    }

    return { module, decode, reset, close, nextFrame, u8, i32 };
}

// ------------------------------------------------------------------- gate 1

// dwebp writes exactly this header ahead of the RGBA bytes for -pam
// (imageio/image_enc.c), and libwebp_tests.md5 records the md5 of the whole
// file, header included.
function pamDigest (width, height, rgba) {
    const header = Buffer.from(
        `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
        'ascii');
    return crypto.createHash('md5').update(header).update(rgba).digest('hex');
}

function readExpectedPamDigests () {
    const expected = new Map();
    for (const line of fs.readFileSync(MD5_LIST, 'utf8').split(/\r?\n/)) {
        const match = /^([0-9a-f]{32})\s+(\S+)\.pam$/.exec(line.trim());
        if (match) expected.set(match[2], match[1]);
    }
    return expected;
}

function gateUpstreamMd5 (backend) {
    if (!fs.existsSync(MD5_LIST)) {
        return { skipped: `no ${path.relative(PLUGIN_ROOT, MD5_LIST)}` };
    }
    const expected = readExpectedPamDigests();
    let checked = 0;
    let animated = 0;
    let rejected = 0;
    const failures = [];

    for (const [name, digest] of expected) {
        const file = path.join(CORPUS_DIR, name);
        if (!fs.existsSync(file)) continue;

        const result = backend.decode(fs.readFileSync(file), { frameLimit: 1 });
        if (!result) {
            // A corpus entry our decoder refuses. Several are deliberately
            // corrupt files that dwebp also rejects, but a .pam md5 exists only
            // for files it decoded, so refusing one is a real failure.
            rejected += 1;
            failures.push(`${name}: webpAnimOpen refused a file libwebp decodes`);
            continue;
        }
        try {
            if (result.frameCount > 1) {
                // dwebp cannot write a .pam for an animation, so a golden here
                // would not mean what we assume. None are expected.
                animated += 1;
                continue;
            }
            const actual = pamDigest(result.width, result.height, result.frames[0].pixels);
            if (actual !== digest) {
                failures.push(`${name}: expected ${digest}, got ${actual}`);
            }
            checked += 1;
        } finally {
            backend.close(result.handle);
        }
    }

    return { checked, animated, rejected, failures };
}

// ------------------------------------------------------------------- gate 2

// The prototype flattened everything into one uint32 buffer and packed pixels as
// (r<<24)|(g<<16)|(b<<8)|a to mirror webpxmux. Reading it back as bytes would
// give the little-endian byte order A,B,G,R, so unpack per channel instead of
// reinterpreting the buffer.
function unpackPrototypeFrame (cells, offset, pixelCount) {
    const rgba = Buffer.allocUnsafe(pixelCount * 4);
    for (let i = 0; i < pixelCount; ++i) {
        const cell = cells[offset + i];
        rgba[i * 4] = (cell >>> 24) & 0xff;
        rgba[i * 4 + 1] = (cell >>> 16) & 0xff;
        rgba[i * 4 + 2] = (cell >>> 8) & 0xff;
        rgba[i * 4 + 3] = cell & 0xff;
    }
    return rgba;
}

async function decodeWithPrototype (bytes) {
    const factory = require(path.join(PROTOTYPE_DIR, 'webpxmux.js'));
    const module = await factory({
        wasmBinary: fs.readFileSync(path.join(PROTOTYPE_DIR, 'webpxmux.wasm')),
    });
    const decodeFrames = module._decodeFrames
        || module.cwrap('decodeFrames', 'number', ['number', 'number']);

    const input = module._malloc(bytes.byteLength);
    let output = 0;
    try {
        module.HEAPU8.set(bytes, input);
        output = decodeFrames(input, bytes.byteLength);
    } finally {
        module._free(input);
    }
    assert.ok(output > 0, 'prototype decodeFrames failed');

    try {
        const cells = new Uint32Array(module.HEAPU8.buffer);
        const base = output >>> 2;
        const frameCount = cells[base + 1];
        const width = cells[base + 2];
        const height = cells[base + 3];
        const loopCount = cells[base + 4];
        const pixelCount = width * height;
        const stride = 2 + pixelCount;
        const frames = [];
        for (let index = 0; index < frameCount; ++index) {
            const frame = base + 6 + index * stride;
            frames.push({
                duration: cells[frame],
                pixels: unpackPrototypeFrame(cells, frame + 2, pixelCount),
            });
        }
        return { width, height, frameCount, loopCount, frames };
    } finally {
        module._free(output);
    }
}

async function gatePrototypeParity (backend, bytes) {
    if (!fs.existsSync(path.join(PROTOTYPE_DIR, 'webpxmux.js'))) {
        return { skipped: `no prototype at ${PROTOTYPE_DIR}` };
    }
    const legacy = await decodeWithPrototype(bytes);
    const ours = backend.decode(bytes);
    assert.ok(ours, 'our backend refused the animated sample');
    try {
        const failures = [];
        for (const key of ['width', 'height', 'frameCount', 'loopCount']) {
            if (ours[key] !== legacy[key]) {
                failures.push(`${key}: ours ${ours[key]} vs prototype ${legacy[key]}`);
            }
        }
        for (let index = 0; index < Math.min(ours.frames.length, legacy.frames.length); ++index) {
            const a = ours.frames[index];
            const b = legacy.frames[index];
            if (a.duration !== b.duration) {
                failures.push(`frame ${index} duration: ours ${a.duration} vs ${b.duration}`);
            }
            if (!a.pixels.equals(b.pixels)) {
                failures.push(`frame ${index} pixels differ`);
            }
        }
        return { frameCount: ours.frameCount, failures };
    } finally {
        backend.close(ours.handle);
    }
}

// ------------------------------------------------------------------- gate 3

function gateStreaming (backend, bytes) {
    const first = backend.decode(bytes);
    assert.ok(first, 'our backend refused the animated sample');
    const failures = [];
    let info;
    try {
        info = {
            width: first.width,
            height: first.height,
            frameCount: first.frameCount,
            loopCount: first.loopCount,
            durations: first.frames.map((frame) => frame.duration),
        };
        if (first.frameCount < 2) failures.push('sample is not animated; gate is vacuous');
        // A zero duration is faithful, not a bug: anim_decode.c:354 makes the
        // reported timestamp cumulative-inclusive, so our delta is exactly the
        // ANMF duration, and iss634.webp really declares 0ms for frame 0. The
        // 0 -> 100ms substitution is the TS layer's job, matching what
        // gif-decoder.ts:220 and apng-decoder.ts:411 already do. Negative would
        // mean the timestamps went backwards, which is a real defect.
        if (info.durations.some((duration) => duration < 0)) {
            failures.push(`negative frame duration: ${info.durations.join(',')}`);
        }
        if (!info.durations.some((duration) => duration > 0)) {
            failures.push('every frame duration is zero; timestamps are not advancing');
        }

        // Replay after reset must be identical -- this is the seek-backwards path.
        assert.ok(backend.reset(first.handle), 'webpAnimReset failed');
        const durationPtr = backend.module._malloc(4);
        try {
            const byteLength = first.width * first.height * 4;
            for (let index = 0; index < first.frameCount; ++index) {
                const framePtr = backend.nextFrame(first.handle, durationPtr);
                if (!framePtr) {
                    failures.push(`replay ended early at frame ${index}`);
                    break;
                }
                const duration = backend.i32()[durationPtr >>> 2];
                const pixels = backend.u8().subarray(framePtr, framePtr + byteLength);
                if (duration !== first.frames[index].duration) {
                    failures.push(`replay frame ${index} duration drifted`);
                }
                if (!first.frames[index].pixels.equals(Buffer.from(pixels))) {
                    failures.push(`replay frame ${index} pixels differ after reset`);
                }
            }
            // The sequence must be exhausted, not merely long enough.
            if (backend.nextFrame(first.handle, durationPtr)) {
                failures.push('nextFrame kept producing frames past frameCount');
            }
        } finally {
            backend.module._free(durationPtr);
        }
    } finally {
        backend.close(first.handle);
    }
    return { info, failures };
}

// ---------------------------------------------------------------------- main

async function main () {
    for (const file of [GLUE, WASM]) {
        if (!fs.existsSync(file)) {
            console.error(`[verify] missing ${path.relative(PLUGIN_ROOT, file)}`);
            console.error('[verify] build it first: native/wasm/scripts/build-wasm.ps1');
            process.exit(1);
        }
    }

    const backend = await loadBackend();
    console.log(`[verify] loaded ${path.relative(PLUGIN_ROOT, GLUE)}`
        + ` + ${fs.statSync(WASM).size} byte wasm`);

    let failed = false;
    const report = (name, result) => {
        if (result.skipped) {
            console.log(`[verify] SKIP ${name} -- ${result.skipped}`);
            return;
        }
        if (result.failures.length) {
            failed = true;
            console.log(`[verify] FAIL ${name}`);
            for (const failure of result.failures.slice(0, 20)) console.log(`         ${failure}`);
            if (result.failures.length > 20) {
                console.log(`         ... and ${result.failures.length - 20} more`);
            }
        } else {
            console.log(`[verify] PASS ${name}`);
        }
    };

    const md5 = gateUpstreamMd5(backend);
    if (!md5.skipped) {
        console.log(`[verify] upstream corpus: ${md5.checked} files checked`
            + `${md5.animated ? `, ${md5.animated} animated skipped` : ''}`
            + `${md5.rejected ? `, ${md5.rejected} rejected` : ''}`);
        if (md5.checked === 0) md5.failures.push('no corpus file was actually checked');
    }
    report('upstream libwebp .pam md5', md5);

    if (!fs.existsSync(ANIM_SAMPLE)) {
        console.log(`[verify] SKIP animated gates -- no ${ANIM_SAMPLE}`);
    } else {
        const bytes = fs.readFileSync(ANIM_SAMPLE);
        const streaming = gateStreaming(backend, bytes);
        if (streaming.info) console.log(`[verify] ${path.basename(ANIM_SAMPLE)}: `
            + JSON.stringify(streaming.info));
        report('streaming ABI + reset replay', streaming);
        report('prototype parity', await gatePrototypeParity(backend, bytes));
    }

    if (failed) {
        console.error('[verify] FAILED');
        process.exit(1);
    }
    console.log('[verify] all gates passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
