/**
 * Animated Image — 入口（生成文件）
 *
 * 本文件由「面板 → AnimatedImage 格式」生成，手改会在下一次应用勾选时被覆盖。
 *
 * 增减格式请打开那个面板 —— 它同时把对应源码在 runtime/ 和 trimmed/ 之间移动。只改这里
 * 的 import 是没用的：Cocos 3.8 把脚本目录下的每个脚本都当 bundle 入口，不做未引用脚本的
 * tree-shaking，注释掉一行省的是运行时开销而不是包体。
 */
export { AnimatedImagePlayer, AnimatedImagePlayerState } from './AnimatedImagePlayer';
export { AnimatedImage, AnimatedImageSourceType } from './AnimatedImage';
export { AnimatedImageDemo } from './AnimatedImageDemo';
export { registerDecoder } from './decoder-registry';
