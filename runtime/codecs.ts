/**
 * Animated Image — Codec Configuration
 *
 * 注释掉不需要的格式。每组包含 import 和 registerDecoder 调用，必须一起注释/取消注释。
 *
 * ⚠️ 注释掉只省运行时开销，不省包体。Cocos 3.8 把脚本目录下的每个脚本都当入口打进
 * bundle，不做未引用脚本的 tree-shaking（场景/prefab 按 UUID 引用组件，构建器无法
 * 证明哪个脚本是死的）—— 实测 13 个源码 .ts 对应 13 个 _RF.push，含没人 import 的
 * index.ts 和纯 interface 的 types.ts。真要减包体必须删文件，见 README「格式裁剪」。
 */
import { registerDecoder } from './decoder-registry';

// ---- GIF ----
// gif-decoder.ts: ~13KB, 纯 JS LZW 解码器，无外部依赖
import { createGifDecoder } from './gif-decoder';
registerDecoder('image/gif', createGifDecoder);

// ---- APNG ----
// apng-decoder.ts: ~14KB + zlib.min.ts: ~21KB, 合计 ~35KB
import { createApngDecoder } from './apng-decoder';
registerDecoder('image/apng', createApngDecoder);

// ---- WebP ----
// webp-decoder.ts + webp/index.ts: ~8KB TS；解码本体是外置的
// animated-webp.wasm ~89KB（web / 小游戏 / 编辑器，落在 cocos-js/），原生走 JSB 不带 wasm
// 需要引擎导出 cc.wasm；缺失时降级为只显示首帧（见 webp-decoder.ts）
// 注意 .wasm 由 editor/build/hooks.js 无条件拷贝、原生 C++ 由 cc_plugin.json 无条件编入，
// 注释掉下面两行都拦不住 —— 要去掉得动 package.json 的 contributions，见 README。
import { createWebpDecoder } from './webp-decoder';
registerDecoder('image/webp', createWebpDecoder);
