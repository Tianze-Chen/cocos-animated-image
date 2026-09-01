<!-- 内部备忘，不要复制进表单：
商店名（提交后不可改，建议）：AnimatedImage 动图播放器（GIF / APNG / WebP）
扩展包名：animated-image　版本：1.1.1　（必须与 package.json 完全一致）
适配引擎：Cocos Creator 3.3+（WebP 功能 3.8+；表单勾选适配版本时按此范围）
免费商品，无需「购买须知」段落
-->

一句话介绍（微信分享描述）：

一个组件播放 GIF / APNG / WebP 动图；自带格式裁剪面板，用不到的格式真正不进包。

## 功能介绍

**解决的痛点**

- Cocos Creator 原生不能播动图：GIF / APNG / WebP 当资源用只能拿到第一帧，想播就得自己写解码器。本插件把动图的解码和播放做成了一个组件，挂上就能播。
- 接入动图通常要引第三方库甚至 wasm，还要自己抹平平台差异。本插件 GIF / APNG 用内置纯 TypeScript 解码器，零第三方依赖，Web / 小游戏 / 原生行为一致。
- 包体焦虑：Creator 3.x 把脚本目录下每个脚本都打进 bundle，不做未引用脚本的 tree-shaking，带着用不到的解码器就是白涨体积。本插件自带「格式裁剪」面板，勾掉用不到的格式，TS、.wasm、原生 C++ 三份载荷真正从构建产物消失。
- WebP 的引擎依赖（cc.wasm 导出）尚未进入任何正式版引擎，因此 WebP 默认关闭，不白白占用包体；引擎就绪或需要原生平台时一键开启。

**主要功能**

▪ 一个组件覆盖 GIF / APNG / WebP 动图 + PNG / JPEG 静态图
▪ GIF / APNG 纯 TS 实现，无第三方依赖，无需 wasm
▪ WebP 双后端：非原生走 wasm，原生走自动编译的 C++ 插件（JSB），出包即用；因引擎依赖尚未进入正式版，默认关闭（见安装注意事项）
▪ 完整播放控制：play / pause / resume / stop / seekToFrame、播放速率 0~10x、循环开关；frameCount / duration / currentFrame / isPlaying 可读
▪ 三种数据来源：BufferAsset（clip）/ 远程 URL / ImageAsset
▪ Web 平台优先使用浏览器 WebCodecs 硬解，不可用时自动回退内置解码器
▪ 引擎不满足 WebP 要求时（正是目前的正式版），自动降级为显示首帧静态图并提示原因，不会崩溃
▪ 附带 AnimatedImageDemo 演示组件：挂上去就能看到最简单的 demo，自动生成完整测试 UI（格式切换、解码器切换、内存监控、键盘快捷键）
▪ MIT 开源

**安装注意事项**

▪ 插件本体（GIF / APNG / 静态图、面板、裁剪）兼容 Creator 3.3+；WebP 需要 3.8+ 编辑器
▪ 必须安装到 `<你的工程>/extensions/` 目录，**不要装到全局目录**——格式裁剪会移动源码文件，全局安装时多个工程共用同一份 runtime 会互相干扰
▪ 安装后重启编辑器；`temp/logs/project.log` 出现 `[animated-image] extension loaded` 即加载成功
▪ WebP 默认关闭：正式版引擎尚未导出其依赖的 cc.wasm，非原生平台开启后也会降级为首帧静态图（不崩溃）；原生平台走 C++ 插件，仅覆盖 Android / iOS / Windows / macOS，Native Simulator 不支持

## 使用教程

**1. 安装**

扩展管理器 → 项目 → + → 导入插件 zip（或把解压后的 `animated-image` 文件夹放进 `<工程>/extensions/`），重启编辑器。
验证：`temp/logs/project.log` 出现 `[animated-image] extension loaded`，紧跟的 `格式配置：保留 GIF / APNG / Demo 组件；已裁剪 WebP` 是当前格式勾选。
（图：扩展管理器导入　图：验证日志）

**2. 三十秒看效果：Demo 组件**

场景里建一个空节点 → 添加组件 `AnimatedImageDemo` → 运行预览。**挂上这一个组件就能看到最简单的 demo**：自动生成完整测试 UI，可切换 GIF / APNG / WebP、切换解码器、查看内存监控。快捷键：`Space` 暂停/播放、`R` 从头播放、`L` 切换循环、`↑`/`↓` 播放速率 ±0.25。
（图：Demo 运行效果）

**3. 正式使用：AnimatedImage 组件**

① 给节点保证有 `Sprite`；② 添加 `AnimatedImage` 组件；③ Inspector 里三选一设置来源：`clip`（BufferAsset）/ `remoteURL`（远程地址）/ `image`（ImageAsset）；④ `playOnAwake` 默认开启，加载完成即自动播放。
（图：Inspector 属性面板）

代码方式：

    const c = node.addComponent(AnimatedImage);
    c.sourceType = AnimatedImage.SourceType.REMOTE;
    c.remoteURL = 'https://example.com/animation.gif';

播放控制：`play()` / `pause()` / `resume()` / `stop()` / `seekToFrame(n)`；`playbackRate` 0~10、`loop` 开关；`frameCount` / `duration` / `currentFrame` / `isPlaying` 只读可查。

不想用组件，也可以直接用底层 API：

    const player = await AnimatedImagePlayer.create(bytes, 'image/gif');
    sprite.spriteFrame = player.spriteFrame;   // 每帧 update 里调 player.tick(dt)

**4. 格式裁剪**

打开编辑器**顶部主菜单栏**的 面板 → AnimatedImage → 格式裁剪（「面板」下拉里的 **AnimatedImage 子菜单**，面板标题显示为「AnimatedImage 格式」），勾选要保留的格式后点「应用」。若资源管理器没立刻刷新，重启一次编辑器即可。构建日志每次会打一行 `[animated-image] formats: gif=on apng=on webp=off …`，这是产物里到底含哪些格式的最终凭证。
裁剪记录存在工程 settings 里、随工程提交，团队共享、构建可复现，随时勾回、无损恢复。
（图：格式裁剪面板）

**5. 开启 WebP**

在格式裁剪面板勾选 WebP → 应用。注意：非原生平台需要导出 `cc.wasm` 的引擎（正式版尚未包含，否则自动降级为首帧并打 warning）；原生平台需 3.8+ 编辑器出正式原生包，C++ 插件自动编译、无需手工步骤。

## 联系作者

- 邮箱：ctzcry@qq.com
- （建议补充：QQ 群 / 论坛 Store 专区用户反馈集中帖链接——有反馈集中帖可加速审核，拿到链接后补在这里）

## 更新声明

- 1.1.1
    - 插件本体兼容 Creator 3.3+（GIF / APNG / 静态图、格式裁剪面板）
    - WebP 默认关闭，需要 3.8+ 编辑器（正式版引擎尚未导出其依赖的 cc.wasm）
    - Demo 内存日志默认降为 10 秒一条；文档补充裁剪面板入口与 Demo 挂载位置说明
- 1.1.0
    - 新增 WebP 动图支持（wasm + 原生 C++ 双后端；因引擎依赖尚未进入正式版，默认关闭）
    - 新增「格式裁剪」面板：不需要的格式（TS / .wasm / 原生 C++ 三份载荷）真正不进构建产物
    - 插件本体兼容 Creator 3.3+
- 1.0.0
    - GIF / APNG 动图播放（内置纯 TS 解码器，无第三方依赖）
    - 完整播放控制 API 与三种数据来源（BufferAsset / 远程 URL / ImageAsset）
    - AnimatedImageDemo 演示组件

<!-- ============ 以下英文段落可选，表单不需要就不复制 ============ -->

[Overview]

AnimatedImage brings animated-image playback to Cocos Creator 3.3 and above: one component plays GIF, APNG and animated WebP, plus static PNG / JPEG (WebP needs a 3.8+ editor and is off by default — see notes).

GIF and APNG are decoded by built-in pure-TypeScript decoders — no third-party dependency, no wasm, identical behavior on every platform. Animated WebP is off by default: its web / minigame backend needs an engine that exports the cc.wasm loader, which no official stable release includes yet; native platforms use a C++ plugin the extension compiles automatically and are unaffected.

[Key Features]

▪ One component for GIF / APNG / animated WebP + static PNG / JPEG
▪ GIF / APNG in pure TypeScript — no dependencies, no wasm
▪ WebP dual backend: wasm off-native, auto-compiled C++ plugin (JSB) on native — off by default while its engine dependency is absent from stable releases
▪ Full playback control: play / pause / resume / stop / seekToFrame, 0–10x playback rate, loop toggle; readable frameCount / duration / currentFrame / isPlaying
▪ Three data sources: BufferAsset, remote URL, or ImageAsset
▪ Web prefers hardware-accelerated WebCodecs, with automatic fallback to the built-in decoder
▪ Includes a demo component (AnimatedImageDemo) that builds a full test UI — mount it and run to see the simplest demo
▪ MIT open source

[Format Trimming — unused formats really leave the build]

Cocos Creator 3.x bundles every script under a script folder and never tree-shakes unreferenced ones, so removing calls alone saves no size. The Format Trimming panel (labeled in Chinese: 面板 → AnimatedImage → 格式裁剪) removes what you don't use — TS source, .wasm and native C++ payloads all together: GIF off saves ~15KB, APNG ~36KB, WebP (off by default) keeps out ~113KB. The choice is stored in the project's settings, committed with the project, and lossless to re-enable.

[Requirements & Notes]

▪ Cocos Creator ≥ 3.3.0 for GIF / APNG / still images and the panel; WebP requires a 3.8+ editor
▪ Animated WebP off-native needs an engine that exports cc.wasm (engine PR cocos4#306) — no official stable release includes it yet: on stable engines, web / minigame WebP falls back to the first frame with a warning (never crashes), while native platforms go through the C++ plugin and are unaffected
▪ Install per-project under extensions/, not globally: trimming moves source files, and a global install would be shared and fought over by multiple projects
▪ Contact: ctzcry@qq.com

[Changelog]

- 1.1.1　Core compatible with Creator 3.3+; WebP off by default (needs a 3.8+ editor); demo memory log defaults to one record per 10s; docs clarify the trimming-panel entry and demo mount point
- 1.1.0　WebP support (wasm + native C++ backends, off by default — its engine dependency is not in stable releases yet); format-trimming panel; core compatible with Creator 3.3+
- 1.0.0　GIF / APNG playback, full playback API, three data sources, demo component
