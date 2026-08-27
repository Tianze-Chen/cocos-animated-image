# animated-image（Cocos Creator 扩展插件）

Cocos Creator 3.8.x 动图播放插件，支持 GIF、APNG、PNG、JPEG 格式。纯 TypeScript 实现，运行时代码通过 `asset-db.mount` 只读挂载进工程，支持按需裁剪格式以减小包体。

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

## 支持格式

| 格式 | 动画 | 解码方式 | 包体大小 |
|------|------|----------|----------|
| GIF | 支持 | 内置 JS 解码器 | ~13KB |
| APNG | 支持 | 内置 JS 解码器 | ~35KB（含 zlib） |
| WebP | 不支持 | 检测到即报错 | — |
| PNG | 静态 | WebCodecs / Canvas | — |
| JPEG | 静态 | WebCodecs / Canvas | — |

> **WebP 不支持**：组件检测到 `image/webp` 字节会直接报错，不进行解码。

Web 平台优先使用浏览器 WebCodecs API（如果可用），否则自动回退到内置解码器。

## 格式裁剪

默认启用 GIF / APNG / PNG / JPEG。如果不需要某种格式，可以编辑挂载目录下的 `runtime/codecs.ts` 注释掉对应代码以减小包体（挂载为只读，请直接编辑 `extensions/animated-image/runtime/codecs.ts` 源文件）：

```typescript
// ---- GIF ----
// gif-decoder.ts: ~13KB, 纯 JS LZW 解码器，无外部依赖
import { createGifDecoder } from './gif-decoder';
registerDecoder('image/gif', createGifDecoder);

// ---- APNG ----
// apng-decoder.ts: ~14KB + zlib.min.ts: ~21KB, 合计 ~35KB
// import { createApngDecoder } from './apng-decoder';       // ← 注释掉即可排除
// registerDecoder('image/apng', createApngDecoder);
```

注释掉的格式不会被打包，其依赖的文件（如 `zlib.min.ts`）也不会进入构建产物。

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

| 平台 | GIF / APNG | WebP | 静态图 | WebCodecs |
|------|------------|------|--------|-----------|
| Web (Chrome/Edge) | JS 解码器 | 不支持（报错） | Canvas | 支持 |
| Web (其他浏览器) | JS 解码器 | 不支持（报错） | Canvas | 不支持 |
| 小游戏（微信/抖音/百度等） | JS 解码器 | 不支持（报错） | 临时文件 + Canvas | 不支持 |
| 原生平台 | JS 解码器 | 不支持（报错） | Image + Canvas | 不支持 |
| **Sud 老平台（Sud 沙盒）** | JS 解码器 | 不支持（报错） | Image | 不支持 |

## 插件结构

```
animated-image/
├── package.json             # 扩展清单（asset-db.mount 只读挂载 runtime/）
├── main.js                  # 主进程入口（仅 load/unload 日志）
├── README.md                # 本文档
└── runtime/                 # 挂载进工程只读的运行时代码
    ├── index.ts             # 入口，barrel 导出
    ├── codecs.ts            # 格式配置（编辑此文件裁剪格式）
    ├── decoder-registry.ts  # 解码器注册表
    ├── AnimatedImage.ts     # AnimatedImage 组件
    ├── AnimatedImagePlayer.ts # 底层播放器（含帧缓存内存统计）
    ├── AnimatedImageDemo.ts # 演示组件（可选，不影响核心功能）
    ├── image-decoder.ts     # 解码器工厂（WebCodecs + 内置回退）
    ├── gif-decoder.ts       # GIF 解码器（纯 JS, ~13KB）
    ├── apng-decoder.ts      # APNG 解码器（纯 JS, ~14KB）
    ├── zlib.min.ts          # zlib inflate（APNG 解压用, ~21KB）
    ├── mime-sniff.ts        # MIME 类型嗅探
    ├── bytes.ts             # 网络响应字节归一化（小游戏兼容）
    ├── types.ts             # 接口定义
    └── *.ts.meta            # 资源 meta（全新 UUID，不与原工程冲突）
```

## License

MIT
