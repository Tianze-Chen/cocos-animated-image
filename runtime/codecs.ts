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
