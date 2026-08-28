# animated-image（Cocos Creator 扩展插件）

Cocos Creator 3.8.x 动图播放插件，支持 GIF、APNG、WebP、PNG、JPEG 格式。GIF / APNG 是纯 TypeScript 实现，WebP 走 wasm（Web / 小游戏 / 编辑器）+ 原生 C++ 插件（原生平台）。运行时代码通过 `asset-db.mount` 只读挂载进工程，格式可按需裁剪（注意：注释 `codecs.ts` 只省运行时开销，减包体要删文件，见 [格式裁剪](#格式裁剪)）。

提取自 `NewProject_5` 工程（2026-08-07 版本，含内存监控补丁）。

## 安装

1. 把整个 `animated-image` 文件夹（含 `package.json` 的这一层）复制到目标工程的 `extensions/` 目录下：

   ```
   <你的工程>/
   └── extensions/
       └── animated-image/
   ```

2. 重启 Cocos Creator（或在 扩展 → 扩展管理器 中刷新）。

3. 验证：`<你的工程>/temp/logs/project.log` 中出现 `[animated-image] extension loaded` 即加载成功；资源管理器中会出现挂载的 `animated-image` 运行时脚本。

   同一份日志里紧跟着的 `staged animated-webp.wasm for the editor at …` 说明 WebP 的 wasm 已就位；如果看到的是 `could not stage animated-webp.wasm` 的 warning，扩展仍然正常工作，只是编辑器/预览里的 WebP 会退成首帧静态图。

## 支持格式

| 格式 | 动画 | 解码方式 | 包体大小 |
|------|------|----------|----------|
| GIF | 支持 | 内置 JS 解码器 | ~13KB |
| APNG | 支持 | 内置 JS 解码器 | ~35KB（含 zlib） |
| WebP | 支持 | wasm（非原生）/ C++ 插件（原生） | ~89KB wasm，见下 |
| PNG | 静态 | WebCodecs / Canvas | — |
| JPEG | 静态 | WebCodecs / Canvas | — |

> **WebP 需要导出 `cc.wasm` 的引擎**（非原生平台）。引擎不满足时不会报错，而是降级成只显示首帧静态图并打一条 warning。详见下面的 [WebP 支持](#webp-支持)。

Web 平台优先使用浏览器 WebCodecs API（如果可用），否则自动回退到内置解码器。

## 格式裁剪

默认启用 GIF / APNG / WebP / PNG / JPEG。不需要某种格式时，编辑挂载目录下的 `runtime/codecs.ts` 注释掉对应的一组（挂载为只读，请直接编辑 `extensions/animated-image/runtime/codecs.ts` 源文件）：

```typescript
// ---- GIF ----
// gif-decoder.ts: ~13KB, 纯 JS LZW 解码器，无外部依赖
import { createGifDecoder } from './gif-decoder';
registerDecoder('image/gif', createGifDecoder);

// ---- APNG ----
// apng-decoder.ts: ~14KB + zlib.min.ts: ~21KB, 合计 ~35KB
// import { createApngDecoder } from './apng-decoder';       // ← 注释掉即可排除
// registerDecoder('image/apng', createApngDecoder);

// ---- WebP ----
// webp-decoder.ts + webp/index.ts: ~8KB TS；解码本体是外置的
// import { createWebpDecoder } from './webp-decoder';       // ← 注释掉即可排除
// registerDecoder('image/webp', createWebpDecoder);
```

### ⚠️ 注释掉 ≠ 不进包体

注释掉一组之后，那个格式在运行时不再被识别（`registerDecoder` 没调用，遇到对应字节会走「不支持」路径），**但对应的脚本文件仍然在构建产物里**。

原因是 Cocos Creator 3.8 **把脚本目录下的每个脚本都当入口打进 bundle，不做未引用脚本的 tree-shaking** —— 场景和 prefab 按 UUID 引用组件，构建器没法证明哪个脚本是死的。实测（微信小游戏产物 `assets/main/index.js`）：13 个源码 `.ts` 对应 13 个 `_RF.push` 模块注册，其中包括没有任何文件 import 的 `index.ts`、场景引用 0 次的 `AnimatedImageDemo.ts`，以及编译后本该什么都不剩的纯 `interface` 文件 `types.ts`。

所以注释掉 `codecs.ts` 里的一组，省的是**运行时开销**（不解析、不加载 wasm、不占内存），**不是包体**。

**真要从包体里去掉一个格式，得删文件：**

| 要去掉 | 除了注释 `codecs.ts`，还要 |
|---|---|
| GIF | 删 `runtime/gif-decoder.ts` + `.meta` |
| APNG | 删 `runtime/apng-decoder.ts`、`runtime/zlib.min.ts` + `.meta` |
| WebP | 删 `runtime/webp-decoder.ts`、整个 `runtime/webp/` + 各自 `.meta`；再从 `package.json` 删掉 `contributions.builder`（否则构建钩子仍会把 ~89KB 的 `animated-webp.wasm` 拷进 `cocos-js/`）和 `contributions.native.plugins`（否则原生包仍会编进 ~60KB 的 C++ 解码器 —— 它由 `cc_plugin.json` 无条件接入，和 TS 侧注册了什么无关） |
| Demo | 删 `runtime/AnimatedImageDemo.ts` + `.meta`，并从 `runtime/index.ts` 去掉那行 re-export |


## 使用方式

### 方式一：组件（推荐）

`AnimatedImage` 是一个 Cocos Creator 组件，需要挂载在带有 `Sprite` 组件的节点上。

**编辑器中使用：**

1. 选中一个带有 Sprite 的节点
2. 添加 `AnimatedImage` 组件（菜单：AnimatedImage）
3. 在 Inspector 中设置属性

**代码中使用：**

```typescript
import { AnimatedImage } from 'db://animated-image/AnimatedImage';

// 添加组件
const animatedImage = node.addComponent(AnimatedImage);

// 远程 URL 加载
animatedImage.sourceType = AnimatedImage.SourceType.REMOTE;
animatedImage.remoteURL = 'https://example.com/animation.gif';

// 本地 BufferAsset 加载
animatedImage.sourceType = AnimatedImage.SourceType.LOCAL;
animatedImage.clip = myBufferAsset;

// ImageAsset 加载
animatedImage.sourceType = AnimatedImage.SourceType.IMAGE;
animatedImage.image = myImageAsset;
```

**组件属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `sourceType` | `AnimatedImageSourceType` | 数据来源：`LOCAL`（BufferAsset）、`REMOTE`（URL）、`IMAGE`（ImageAsset） |
| `clip` | `BufferAsset` | sourceType 为 LOCAL 时使用 |
| `image` | `ImageAsset` | sourceType 为 IMAGE 时使用 |
| `remoteURL` | `string` | sourceType 为 REMOTE 时使用 |
| `playOnAwake` | `boolean` | 加载完成后自动播放，默认 `true` |
| `loop` | `boolean` | 循环播放，默认 `true` |
| `playbackRate` | `number` | 播放速率，范围 0.0 ~ 10.0，默认 `1` |

**播放控制：**

```typescript
animatedImage.play();
animatedImage.pause();
animatedImage.resume();
animatedImage.stop();
animatedImage.seekToFrame(5);

// 只读属性
animatedImage.frameCount;   // 总帧数
animatedImage.currentFrame; // 当前帧索引
animatedImage.duration;     // 总时长（毫秒）
animatedImage.isPlaying;    // 是否正在播放
```

### 方式二：直接使用 AnimatedImagePlayer

如果不想用组件，可以直接使用底层的 `AnimatedImagePlayer`：

```typescript
import { AnimatedImagePlayer } from 'db://animated-image/AnimatedImagePlayer';

// 从二进制数据创建
const bytes = new Uint8Array(/* ... */);
const player = await AnimatedImagePlayer.create(bytes, 'image/gif');

// 将 spriteFrame 赋给 Sprite
sprite.spriteFrame = player.spriteFrame;

// 播放控制
player.loop = true;
player.play();

// 在 update 中驱动
update(dt: number) {
    player.tick(dt);
}

// 销毁时清理
player.destroy();
```

### 快速体验：Demo

`AnimatedImageDemo` 是演示组件，可快速验证功能是否正常：

1. 在场景中创建一个空节点
2. 添加 `AnimatedImageDemo` 组件（代码 `import { AnimatedImageDemo } from 'db://animated-image/AnimatedImageDemo'`）
3. 运行预览

Demo 会自动创建完整的测试 UI（格式切换按钮、解码器切换、状态栏、内存监控面板），无需手动搭建场景。键盘快捷键：`Space` 暂停/播放、`R` 从头播放、`L` 切换循环、`Up`/`Down` 播放速率 ±0.25。

## 强制使用内置解码器

默认情况下，Web 平台会优先使用浏览器的 WebCodecs API。可以通过以下方式强制使用内置 JS 解码器：

```typescript
import { AnimatedImagePlayer } from 'db://animated-image/AnimatedImagePlayer';

AnimatedImagePlayer.forceBuiltinDecoder = true;
```

## 平台支持

| 平台 | GIF / APNG | WebP 动图 | 静态图 | WebCodecs |
|------|------------|-----------|--------|-----------|
| Web (Chrome/Edge) | JS 解码器 | WebCodecs（优先）/ wasm | Canvas | 支持 |
| Web (其他浏览器) | JS 解码器 | wasm | Canvas | 不支持 |
| 小游戏（微信/抖音/百度等） | JS 解码器 | wasm | 临时文件 + Canvas | 不支持 |
| 编辑器 / 浏览器预览 | JS 解码器 | wasm（`external:` 协议） | Canvas | 视浏览器而定 |
| 原生平台（Android / iOS / Windows / macOS） | JS 解码器 | 原生 C++ 插件（JSB） | Image + Canvas | 不支持 |
| Native Simulator | JS 解码器 | **不支持**（见下） | Image + Canvas | 不支持 |
| **Sud 老平台（Sud 沙盒）** | JS 解码器 | 视是否有 `cc.wasm` | Image | 不支持 |

## WebP 支持

WebP 的解码内核是一份 C 代码（`native/webp-core/webp_anim.c`，基于 vendored libwebp 1.6.0 的 demux/anim 模块），编成两个后端：

- **非原生平台** —— 编成 `animated-webp.wasm`（90,593 字节，~89KB），通过引擎的 `cc.wasm` 加载。
- **原生平台** —— 编成静态库，通过 `CC_PLUGIN_ENTRY` 自动注册成 `globalThis.__animatedImageWebP` 的 JSB 绑定。原生包里**没有** wasm。

两个后端共用同一份 C 内核和同一套调用形状，逐帧输出必须逐字节相同。

### 引擎要求（仅非原生平台）

需要一个把 WebAssembly 接口导出到 `cc.wasm` 命名空间的引擎（对应 [cocos/cocos4#306](https://github.com/cocos/cocos4/pull/306) 这个导出；引擎源码里看 `exports/webassembly.ts` 在不在）。可执行判据：

```typescript
typeof (cc as any).wasm?.instantiateWasm === 'function'   // true 才有 WebP 动图
```

**引擎不满足时不会崩** —— `runtime/webp-decoder.ts` 会捕获后端加载失败，退回到首帧静态图（`createImageBitmap` / `Image` 都原生支持 WebP），并打印一条 warning 说明原因。所以插件在任何 3.8.x 上都能装，只是老引擎下 WebP 只显示第一帧。

原生平台**不做这个降级**：`NATIVE` 下拿不到 `globalThis.__animatedImageWebP` 会直接抛错。原生上退回 wasm 反而会把「原生插件没编进去」掩盖成「能跑但慢」，那样的问题没人会注意到。

### 包体开销

| 平台 | 开销 | 落在哪 |
|---|---|---|
| Web / 小游戏 | ~89KB `.wasm` + ~10KB glue `.js` | `.wasm` 在产物 `cocos-js/`，glue 随脚本打包 |
| 原生 | ~60KB demux 目标码（估算，静态链接） | 可执行文件 / `.so`，无 wasm |
| 编辑器 / 预览 | 0（不进产物） | `main.js` 拷进 `<引擎>/native/external/` |

小游戏有首包体积预算，`.wasm` 落在 `cocos-js/` 而不是主脚本里，按各平台的分包规则处理。

### 交付路径（无需手工步骤）

`.wasm` 的源文件是 `native/wasm/prebuilt/animated-webp.wasm`，由两条路送到各宿主实际会去找的位置：

- `main.js` 的 `load()` 把它拷进 `<引擎>/native/external/` —— 编辑器场景视图（node `fs` 读）和浏览器预览（`/engine_external/` 端点）都从这里解析 `external:animated-webp.wasm`。
- `editor/build/hooks.js` 的 `onAfterBuild` 把它拷进产物 `cocos-js/` —— web 构建相对 `import.meta.url` 取它，小游戏把 `cocos-js/<name>` 当**路径**交给 `CCWebAssembly.instantiate`（微信的 `WXWebAssembly` 只吃路径不吃字节，所以必须是独立文件，不能内嵌 base64）。

原生插件同样是自动的：`package.json` 的 `contributions.native.plugins` 指向 `native/cc_plugin.json`，出普通原生包即自动编译、自动注册。验证点是构建后的工程 `native/engine/<平台>/Pre-AutoLoadPlugins.cmake` 里出现 `animated_webp`。

### 已知限制

- **Native Simulator 下 WebP 动图不可用。** 官方 Simulator 不扫工程 `extensions/` 里的 `cc_plugin.json`，插件根本没编进去，`globalThis.__animatedImageWebP` 不存在。需要给 Simulator 的 CMake 另加一个 `CMAKE_PROJECT_INCLUDE` 钩子才能接上。用真机 / 桌面原生包测 WebP。
- **原生插件只覆盖 Android / iOS / Windows / macOS。** 引擎的 `plugins_parser.js` 只给这四个平台映射了搜索路径后缀，Linux / OHOS / HarmonyOS 走不到 `find_package`。这些平台上 WebP 动图不可用。
- **wasm 产物需要 emsdk 才能重新生成**，但已经提交进仓库（`native/wasm/prebuilt/`），普通使用不需要装。重新构建见 `native/wasm/CMakeLists.txt` 的头注释。`.js` 和 `.wasm` 必须同一次构建一起换。

## 插件结构

```
animated-image/
├── package.json             # 扩展清单（asset-db.mount 只读挂载 + native.plugins + builder）
├── main.js                  # 主进程入口（把 WebP wasm 拷进 <引擎>/native/external/）
├── README.md                # 本文档
├── editor/build/            # 构建贡献
│   ├── builder.js           # 注册钩子
│   └── hooks.js             # onAfterBuild：把 .wasm 拷进产物 cocos-js/（原生跳过）
├── native/                  # WebP 解码器：一份 C 内核，两个后端
│   ├── cc_plugin.json       # 原生插件清单（target: animated_webp）
│   ├── animated_webp.cmake  # 共享 cmake（STATIC lib + CC_PLUGIN_STATIC）
│   ├── {android,ios,windows,mac}/animated_webp-config.cmake
│   ├── animated_webp_plugin.cpp     # CC_PLUGIN_ENTRY + addRegisterCallback
│   ├── jsb_animated_webp_manual.*   # JSB 手写绑定 → globalThis.__animatedImageWebP
│   ├── webp-core/           # 共享 C 内核（5 函数流式 ABI）+ 符号前缀头
│   ├── third_party/libwebp/ # vendored libwebp 1.6.0（decode + demux 子集）
│   └── wasm/                # emcmake 构建脚本 + prebuilt/animated-webp.{js,wasm}
└── runtime/                 # 挂载进工程只读的运行时代码
    ├── index.ts             # 入口，barrel 导出
    ├── codecs.ts            # 格式配置（编辑此文件裁剪格式）
    ├── decoder-registry.ts  # 解码器注册表
    ├── AnimatedImage.ts     # AnimatedImage 组件
    ├── AnimatedImagePlayer.ts # 底层播放器（含帧缓存内存统计）
    ├── AnimatedImageDemo.ts # 演示组件（可选，不影响核心功能）
    ├── image-decoder.ts     # 解码器工厂（WebCodecs + 内置回退）
    ├── static-decoder.ts    # 单帧静态解码（PNG/JPEG/WebP 降级共用）
    ├── gif-decoder.ts       # GIF 解码器（纯 JS, ~13KB）
    ├── apng-decoder.ts      # APNG 解码器（纯 JS, ~14KB）
    ├── zlib.min.ts          # zlib inflate（APNG 解压用, ~21KB）
    ├── webp-decoder.ts      # WebP 解码器（顺序游标 + 降级到首帧）
    ├── webp/
    │   ├── index.ts         # 后端加载器（NATIVE → JSB；其余 → cc.wasm）
    │   └── animated-webp.js # 生成的 CJS glue（.wasm 不在这里，见「交付路径」）
    ├── mime-sniff.ts        # MIME 类型嗅探
    ├── bytes.ts             # 网络响应字节归一化（小游戏兼容）
    ├── types.ts             # 接口定义
    └── *.ts.meta            # 资源 meta（全新 UUID，不与原工程冲突）
```

## License

MIT
