/**
 * Animated Image — Codec Configuration
 *
 * 注释掉不需要的格式以减小包体。
 * 每组包含 import 和 registerDecoder 调用，必须一起注释/取消注释。
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
import { createWebpDecoder } from './webp-decoder';
registerDecoder('image/webp', createWebpDecoder);
