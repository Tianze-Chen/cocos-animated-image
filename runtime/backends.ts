/**
 * Animated Image — 原生后端装配（生成文件）
 *
 * 本文件由「面板 → AnimatedImage 格式」生成，手改会在下一次应用勾选时被覆盖。
 *
 * 增减格式请打开那个面板 —— 它同时把对应源码在 runtime/ 和 trimmed/ 之间移动。只改这里
 * 的 import 是没用的：Cocos 3.8 把脚本目录下的每个脚本都当 bundle 入口，不做未引用脚本的
 * tree-shaking，注释掉一行省的是运行时开销而不是包体。
 */
import { registerNativeBackend } from './native-backend/backend-registry';
import { tryCreateNativeDecoder, isNativeAnimatedSupported } from './native-backend/adapter';
import { webImageBackend } from './native-backend/backend-web';
import { sudImageBackend } from './native-backend/backend-sud';

// 注册顺序即分发优先级：web 在前 —— 双后端并存的宿主优先走标准 API，
// Sud 宿主上 web 的 available() 恒 false，自然落到 SUD。
registerNativeBackend(webImageBackend);
registerNativeBackend(sudImageBackend);

export { tryCreateNativeDecoder, isNativeAnimatedSupported };
