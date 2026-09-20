// 把 worker/decoder-worker.ts 连同它引用的 runtime 解码器（apng/gif/zlib.min/mime-sniff）
// 打成一个自包含单文件 JS。产物 worker/dist/animated-image-decoder.js 提交进仓库 —— 与
// native/wasm/prebuilt 同一约定：本脚本只在改动解码器源码后由维护者手动运行，普通使用方
// 不需要任何构建工具。
//
// 工具链：tsc（编 ESM 到临时目录，SAB 类型需要 lib>=ES2017）→ rollup（并成 IIFE 单文件）。
// 两个工具都不随扩展分发，按以下顺序解析（第一个命中生效）：
//   1. 本扩展自己的 node_modules
//   2. 环境变量 ENGINE_DIR 指向的引擎仓
//   3. 本机默认引擎仓 D:\code\cocos-engine
//   4. 全局 npm（npm root -g）
//
// 运行：node extensions/animated-image/scripts/build-worker.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_TS = path.join(EXT_ROOT, 'worker', 'decoder-worker.ts');
const BUILD_DIR = path.join(EXT_ROOT, 'worker', '.build');
const OUT_DIR = path.join(EXT_ROOT, 'worker', 'dist');
const OUT_FILE = path.join(OUT_DIR, 'animated-image-decoder.js');

const require = createRequire(import.meta.url);

function globalNpmRoot () {
    try {
        return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

function candidateRoots () {
    const roots = [path.join(EXT_ROOT, 'node_modules')];
    if (process.env.ENGINE_DIR) roots.push(path.join(process.env.ENGINE_DIR, 'node_modules'));
    roots.push('D:\\code\\cocos-engine\\node_modules');
    const npmRoot = globalNpmRoot();
    if (npmRoot) roots.push(npmRoot);
    return roots;
}

/** 在候选 node_modules 里找某个包内文件，返回绝对路径；找不到返回 null。 */
function resolveTool (packagePath) {
    for (const root of candidateRoots()) {
        try {
            const resolved = require.resolve(packagePath, { paths: [root] });
            return resolved;
        } catch (e) {
            // 该 node_modules 下没有这个包，继续。
        }
    }
    return null;
}

function fail (message) {
    console.error(`[build-worker] ${message}`);
    process.exit(1);
}

async function main () {
    const tscJs = resolveTool('typescript/bin/tsc');
    const rollupJs = resolveTool('rollup/dist/rollup.js');
    if (!tscJs) {
        fail('找不到 typescript（候选：扩展 node_modules、ENGINE_DIR、D:\\code\\cocos-engine、npm -g）。装一份或在环境变量 ENGINE_DIR 里指定引擎仓。');
    }
    if (!rollupJs) {
        fail('找不到 rollup（候选同上；本机引擎仓 D:\\code\\cocos-engine\\node_modules 里有一份）。');
    }
    if (!fs.existsSync(ENTRY_TS)) {
        fail(`入口不存在: ${ENTRY_TS}`);
    }

    // --- 1. tsc：编 ESM。rootDir 必须罩住 worker/ 与 runtime/ 两个目录（扩展根），
    //        输出保持 worker/ + runtime/ 的目录结构，rollup 从入口自然追到全部相对引用。 ---
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    const tsconfig = {
        compilerOptions: {
            target: 'ES2018',
            module: 'ES2020',
            moduleResolution: 'node',
            lib: ['ES2018'],
            types: [],
            strict: false,
            skipLibCheck: true,
            declaration: false,
            sourceMap: false,
            noEmitOnError: true,
            outDir: path.join(BUILD_DIR, 'js'),
            rootDir: EXT_ROOT,
        },
        files: [ENTRY_TS],
    };
    const tsconfigPath = path.join(BUILD_DIR, 'tsconfig.json');
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 4), 'utf8');

    console.log(`[build-worker] tsc: ${tscJs}`);
    execFileSync(process.execPath, [tscJs, '-p', tsconfigPath], { stdio: 'inherit' });

    const entryJs = path.join(BUILD_DIR, 'js', 'worker', 'decoder-worker.js');
    if (!fs.existsSync(entryJs)) {
        fail(`tsc 没有产出入口: ${entryJs}`);
    }

    // --- 2. rollup：并成 IIFE。worker 只吃经典脚本，不能有 import/export 残留。 ---
    console.log(`[build-worker] rollup: ${rollupJs}`);
    const rollupModule = await import(pathToFileURL(rollupJs).href);
    const rollupFn = rollupModule.rollup ?? rollupModule.default?.rollup;
    if (typeof rollupFn !== 'function') {
        fail('rollup 模块形态不符合预期（找不到具名导出 rollup）。');
    }
    const bundle = await rollupFn({ input: entryJs });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await bundle.write({
        file: OUT_FILE,
        format: 'iife',
        banner: [
            '// animated-image 解码 worker —— 生成文件，勿手改。',
            '// 源码: worker/{decoder-worker,overlay-compositor}.ts + runtime/{apng-decoder,gif-decoder,zlib.min,mime-sniff,worker-protocol}.ts',
            '// 重建: node scripts/build-worker.mjs',
        ].join('\n'),
    });
    await bundle.close();

    // --- 3. 自检：语法可解析 + 单文件里不能残留模块语句。 ---
    execFileSync(process.execPath, ['--check', OUT_FILE], { stdio: 'inherit' });
    const text = fs.readFileSync(OUT_FILE, 'utf8');
    if (/^\s*(import|export)\s/m.test(text)) {
        fail('bundle 里检测到残留的 import/export —— IIFE 不是自包含的，检查 rollup 输出。');
    }

    fs.rmSync(BUILD_DIR, { recursive: true, force: true });

    const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
    console.log(`[build-worker] 完成: ${OUT_FILE} (${kb} KB)`);
    console.log('[build-worker] 提醒: 产物已提交进仓库；改了解码器源码后记得重跑本脚本。');
}

main().catch((e) => {
    fail(e && e.stack ? e.stack : String(e));
});
