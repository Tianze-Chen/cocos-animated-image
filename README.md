# animated-image（Cocos Creator 扩展插件）

Cocos Creator 动图播放插件，支持 GIF、APNG、WebP、PNG、JPEG 格式。**插件本体（GIF / APNG / 静态图、面板、格式裁剪）实测兼容 3.3+；WebP 需要 3.8+**（见 [WebP 支持](#webp-支持)）。GIF / APNG 是纯 TypeScript 实现，WebP 走 wasm（Web / 小游戏 / 编辑器）+ 原生 C++ 插件（原生平台），但**默认关闭** —— 它的非原生后端依赖引擎导出 `cc.wasm`，该能力尚未进入任何正式版引擎（见 [WebP 支持](#webp-支持)）。运行时代码通过 `asset-db.mount` 只读挂载进工程。**不需要的格式可以在面板里勾掉，真正不进构建产物**（TS、`.wasm`、原生 C++ 三份载荷一起消失），见 [格式裁剪](#格式裁剪)。

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

   紧跟着的 `格式配置：保留 GIF / APNG / Demo 组件；已裁剪 WebP` 是当前的格式勾选（见 [格式裁剪](#格式裁剪)）。WebP 默认关闭，所以这里接着是 `skip staging animated-webp.wasm (WebP 已裁剪)`；在面板勾选 WebP 应用后才会出现 `staged animated-webp.wasm for the editor at …`。那时如果看到 `could not stage animated-webp.wasm` 的 warning，扩展仍然正常工作，只是编辑器/预览里的 WebP 会退成首帧静态图。

## 支持格式

| 格式 | 动画 | 解码方式 | 源码体积 | 可裁剪 |
|------|------|----------|----------|--------|
| GIF | 支持 | 内置 JS 解码器 | ~15KB | 是 |
| APNG | 支持 | 内置 JS 解码器 | ~36KB（含 zlib） | 是 |
| WebP | 支持 | wasm（非原生）/ C++ 插件（原生） | ~24KB + ~89KB wasm / ~60KB 原生 | 是 |
| PNG | 静态 | WebCodecs / Canvas | — | 否（核心） |
| JPEG | 静态 | WebCodecs / Canvas | — | 否（核心） |

「可裁剪」的意思是勾掉之后**真的不进构建产物**，见 [格式裁剪](#格式裁剪)。

> **WebP 需要导出 `cc.wasm` 的引擎**（非原生平台），而**目前没有任何正式版引擎满足**（[cocos/cocos4#306](https://github.com/cocos/cocos4/pull/306) 尚未随正式版发布）—— 这就是 WebP 默认关闭的原因。引擎不满足时不会报错，而是降级成只显示首帧静态图并打一条 warning；原生平台走 C++ 插件，不受此影响。详见下面的 [WebP 支持](#webp-支持)。

Web 平台优先使用浏览器 WebCodecs API（如果可用），否则自动回退到内置解码器。

## 格式裁剪

默认启用 GIF / APNG / Demo；**WebP 默认关闭** —— 正式版引擎尚未导出 WebP 非原生后端依赖的 `cc.wasm`（见 [WebP 支持](#webp-支持)），原生平台不受影响。要改选择，打开顶部主菜单栏的 **面板 → AnimatedImage → 格式裁剪**（「面板」下拉里的 AnimatedImage 子菜单，面板标题「AnimatedImage 格式」），勾选/取消勾选后点「应用」：

```
┌────────────────────────────────────────┐
│ 勾选要保留的格式，未勾选的不进构建产物  │
│                                        │
│ ☑ GIF                        15.4 KB   │
│ ☑ APNG（含 zlib）            35.8 KB   │
│ ☐ WebP        23.7 KB + wasm / 原生    │
│ ☑ Demo 组件                  37.2 KB   │
│                                        │
│ 当前磁盘状态：已裁剪 WebP               │
│                          [ 应用 ]      │
└────────────────────────────────────────┘
```

体积是面板实时统计源文件得出的，不是写死的数字。取消 WebP 时三份载荷会一起消失：TS、`.wasm`、原生 C++。

**勾选存在哪：** `<工程>/settings/v2/packages/animated-image.json`，随工程提交 —— 包体决策该团队共享、该可复现。因此**扩展要装在 `<工程>/extensions/` 下**；装在全局目录时同一份 `runtime/` 被所有工程共用，切换工程会来回搬文件，扩展加载时会为此打一条 warning。

**应用之后：** 扩展会尝试刷新 asset-db，但只读挂载能否接受刷新未经实测。若资源管理器或构建结果没跟着更新，**重启一次编辑器**即可 —— 功能正确性不依赖那次刷新。

### 「应用」到底做了什么

| 载荷 | 谁把它放进包 | 取消勾选后 |
|---|---|---|
| 挂载的 TS / JS | `asset-db.mount` → bundle 入口 | 源码（含 `.meta`）**移动**到扩展的 `trimmed/`，勾回来移回原位 |
| `animated-webp.wasm` ~89KB | `editor/build/hooks.js` 的 `onAfterBuild` | 派生的 `editor/build/trim.json` 里 `webp: false`，钩子跳过拷贝 |
| 原生 C++ ~60KB | `native/cc_plugin.json` | `platforms` 改写成 `[]`，引擎的插件扫描对每个平台都跳过 |
| `runtime/codecs.ts`、`runtime/index.ts` | — | 按勾选重新生成（**这两个是生成文件，手改会被覆盖**） |

搬移用的是 move 而不是复制：只有一份拷贝不会漂移，`.meta` 跟着走所以 UUID 不变，勾回来是无损的。`trimmed/` 也进版本控制，裁剪后提交工程，文件仍在你的仓库里。

裁剪掉的格式在运行时也不再被识别（`registerDecoder` 没调用，遇到对应字节走「不支持」路径）。构建日志里每次都会打一行 `[animated-image] formats: gif=on apng=off …`，这是产物里到底含哪些格式的唯一信号。

### ⚠️ 为什么必须移动文件，而不是注释掉 import

Cocos Creator 3.8 **把脚本目录下的每个脚本都当入口打进 bundle，不做未引用脚本的 tree-shaking** —— 场景和 prefab 按 UUID 引用组件，构建器没法证明哪个脚本是死的。实测（微信小游戏产物 `assets/main/index.js`）：13 个源码 `.ts` 对应 13 个 `_RF.push` 模块注册，其中包括没有任何文件 import 的 `index.ts`、场景引用 0 次的 `AnimatedImageDemo.ts`，以及编译后本该什么都不剩的纯 `interface` 文件 `types.ts`。

所以只注释掉 `codecs.ts` 里的 import，省的是**运行时开销**（不解析、不加载 wasm、不占内存），**不是包体**。这也是这个面板存在的原因：它把文件真的搬走。

### 关掉 Demo 的额外注意

`AnimatedImageDemo.ts` 是整个插件里最大的单个文件（~37KB，比 GIF 解码器还大一倍），但**场景里挂过 `AnimatedImageDemo` 组件的话，关掉它会让那个组件丢失**。面板上对这一项单独标了警告。

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

1. 在 **Canvas 下**创建一个空节点（不要直接挂在场景根上）
2. 添加 `AnimatedImageDemo` 组件（代码 `import { AnimatedImageDemo } from 'db://animated-image/AnimatedImageDemo'`）
3. 运行预览

Demo 会自动创建完整的测试 UI（格式切换按钮、解码器切换、状态栏、内存监控面板），无需手动搭建场景。键盘快捷键：`Space` 暂停/播放、`R` 从头播放、`L` 切换循环、`Up`/`Down` 播放速率 ±0.25。

> **挂错位置不会报错，但整个 demo 不显示。** UI 相机只渲染 UI_2D 层的节点；在场景根上建的空节点默认在 DEFAULT 层，demo 创建的所有 UI 会跟着静默不可见（组件本身照常运行、内存日志照常输出）。组件启动时会把节点 layer 自动对齐到 Canvas 并打一条 warning——看到这条 warning 就说明节点挂错位置了。

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

**截至今日的正式版引擎都不满足** —— 该导出（cocos/cocos4#306）尚未随任何正式版发布，非原生平台的 WebP 动图在正式版引擎上只会停在降级路径（首帧静态图 + warning）。这是扩展把 WebP 默认关闭的原因；确认引擎满足或只在原生平台使用时，到 [格式裁剪](#格式裁剪) 面板勾选开启。

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

**WebP 默认关闭，这三行默认都是 0** —— 需要 WebP 时在 [格式裁剪](#格式裁剪) 面板勾选；勾掉后 `.wasm`、glue、原生目标码一起消失。

### 交付路径（无需手工步骤）

`.wasm` 的源文件是 `native/wasm/prebuilt/animated-webp.wasm`，由两条路送到各宿主实际会去找的位置：

- `main.js` 的 `load()` 把它拷进 `<引擎>/native/external/` —— 编辑器场景视图（node `fs` 读）和浏览器预览（`/engine_external/` 端点）都从这里解析 `external:animated-webp.wasm`。
- `editor/build/hooks.js` 的 `onAfterBuild` 把它拷进产物 `cocos-js/` —— web 构建相对 `import.meta.url` 取它，小游戏把 `cocos-js/<name>` 当**路径**交给 `CCWebAssembly.instantiate`（微信的 `WXWebAssembly` 只吃路径不吃字节，所以必须是独立文件，不能内嵌 base64）。

两条路都受格式裁剪控制：勾掉 WebP 后，`load()` 打 `skip staging animated-webp.wasm (WebP 已裁剪)` 而不去拷（**已经拷过的那份不会被删** —— 同一份引擎可能正被别的工程用着），`onAfterBuild` 打 `skip animated-webp.wasm (WebP 已裁剪)`。

原生插件同样是自动的：`package.json` 的 `contributions.native.plugins` 指向 `native/cc_plugin.json`，出普通原生包即自动编译、自动注册。裁剪掉 WebP 时这个清单还在，但 `platforms` 被改写成 `[]`，引擎的平台匹配对每个平台都落空。验证点是构建后的工程 `native/engine/<平台>/Pre-AutoLoadPlugins.cmake` 里有没有 `animated_webp`。

### 已知限制

- **WebP 实际只在 3.8+ 可用，尽管插件本体兼容 3.3+。** GIF / APNG / 静态图、面板和格式裁剪实测可下到 3.3；但 WebP 的非原生后端要 `cc.wasm`（正式版引擎都还没有），原生 C++ 插件机制（`contributions.native.plugins` / cc_plugin.json，`engine-version >=3.8.0`）也只按 3.8 验证过。老编辑器上勾选 WebP 只会得到首帧降级（非原生）或直接报错（原生）—— 反正它默认关闭。
- **Native Simulator 下 WebP 动图不可用。** 官方 Simulator 不扫工程 `extensions/` 里的 `cc_plugin.json`，插件根本没编进去，`globalThis.__animatedImageWebP` 不存在。需要给 Simulator 的 CMake 另加一个 `CMAKE_PROJECT_INCLUDE` 钩子才能接上。用真机 / 桌面原生包测 WebP。
- **原生插件只覆盖 Android / iOS / Windows / macOS。** 引擎的 `plugins_parser.js` 只给这四个平台映射了搜索路径后缀，Linux / OHOS / HarmonyOS 走不到 `find_package`。这些平台上 WebP 动图不可用。
- **wasm 产物需要 emsdk 才能重新生成**，但已经提交进仓库（`native/wasm/prebuilt/`），普通使用不需要装。重新构建见 `native/wasm/CMakeLists.txt` 的头注释。`.js` 和 `.wasm` 必须同一次构建一起换。

## 插件结构

```
animated-image/
├── package.json             # 扩展清单（asset-db.mount + native.plugins + builder + panels）
├── main.js                  # 主进程入口（格式对齐 + 把 WebP wasm 拷进 <引擎>/native/external/）
├── README.md                # 本文档
├── panels/formats.js        # 「格式裁剪」面板
├── editor/
│   ├── trim.js              # 裁剪核心：搬文件 / 生成 codecs.ts、index.ts / 改 trim.json、cc_plugin.json
│   └── build/               # 构建贡献
│       ├── builder.js       # 注册钩子
│       ├── hooks.js         # onAfterBuild：按 trim.json 把 .wasm 拷进产物 cocos-js/（原生跳过）
│       └── trim.json        # 派生的格式开关（构建进程读不到 Editor.Profile，只能读文件）
├── trimmed/                 # 被勾掉的格式源码停放处（默认停放着 WebP，勾选后移回 runtime/）
├── native/                  # WebP 解码器：一份 C 内核，两个后端
│   ├── cc_plugin.json       # 原生插件清单（target: animated_webp；platforms 由裁剪改写）
│   ├── animated_webp.cmake  # 共享 cmake（STATIC lib + CC_PLUGIN_STATIC）
│   ├── {android,ios,windows,mac}/animated_webp-config.cmake
│   ├── animated_webp_plugin.cpp     # CC_PLUGIN_ENTRY + addRegisterCallback
│   ├── jsb_animated_webp_manual.*   # JSB 手写绑定 → globalThis.__animatedImageWebP
│   ├── webp-core/           # 共享 C 内核（5 函数流式 ABI）+ 符号前缀头
│   ├── third_party/libwebp/ # vendored libwebp 1.6.0（decode + demux 子集）
│   └── wasm/                # emcmake 构建脚本 + prebuilt/animated-webp.{js,wasm}
└── runtime/                 # 挂载进工程只读的运行时代码
    ├── index.ts             # 入口，barrel 导出（生成文件）
    ├── codecs.ts            # 格式配置（生成文件，改它无效，用面板）
    ├── decoder-registry.ts  # 解码器注册表
    ├── AnimatedImage.ts     # AnimatedImage 组件
    ├── AnimatedImagePlayer.ts # 底层播放器（含帧缓存内存统计）
    ├── AnimatedImageDemo.ts # 演示组件（可裁剪，~37KB，插件里最大的单个文件）
    ├── image-decoder.ts     # 解码器工厂（WebCodecs + 内置回退）
    ├── static-decoder.ts    # 单帧静态解码（PNG/JPEG/WebP 降级共用）
    ├── gif-decoder.ts       # GIF 解码器（纯 JS, ~15KB）
    ├── apng-decoder.ts      # APNG 解码器（纯 JS, ~15KB）
    ├── zlib.min.ts          # zlib inflate（APNG 解压用, ~21KB）
    ├── webp-decoder.ts      # WebP 解码器（顺序游标 + 降级到首帧；默认在 trimmed/）
    ├── webp/
    │   ├── index.ts         # 后端加载器（NATIVE → JSB；其余 → cc.wasm；默认在 trimmed/）
    │   └── animated-webp.js # 生成的 CJS glue（.wasm 不在这里，见「交付路径」）
    ├── mime-sniff.ts        # MIME 类型嗅探
    ├── bytes.ts             # 网络响应字节归一化（小游戏兼容）
    ├── types.ts             # 接口定义
    └── *.ts.meta            # 资源 meta（全新 UUID，不与原工程冲突）
```

## License

MIT
