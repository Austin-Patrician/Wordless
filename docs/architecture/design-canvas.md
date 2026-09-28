# 设计画布(Design Canvas)架构方案

> 状态:**设计已定,待实施**。本文是 P0 的开工依据。
>
> 相关:能力 `packages/capabilities/design`、画像 `packages/profiles/ui`、workbench `ui-preview`。
> 三者都是已存在的空壳,本方案把它们填实。

---

## 0. 一句话

**在 Wordless 里做一个 Figma 式的设计画布:帧是真实 HTML,画布是 React Flow,活体最多 1 个原生视图,渲染只读静态产物,风格由 `DESIGN.md` 驱动。**

---

## 1. 目标与非目标

### 目标

1. **像 Figma 的画布手感** —— 无限平移缩放、多帧并排、框选多选、吸附参考线、缩放下手柄固定尺寸
2. **比 open-vetta 更高的性能** —— 活体视图数量有架构上限;位图铺满;光栅化走 Electron 内置离屏渲染
3. **比 open-vetta 更稳定的架构** —— 渲染不依赖任何常驻进程;每帧显式状态机;资源预算声明式且有测试
4. **agent 能自己设计** —— 工具面 + 质检闭环(渲染像素复核),与 ppt profile 同一套工作方式
5. **风格库接入** —— 承载 `awesome-design-md` 那批 `DESIGN.md`

### 非目标(明确不做)

| 不做 | 理由 |
|---|---|
| 自由绘图模型(Excalidraw 那条路) | 帧是矩形设计稿,不是手绘;引入第二套几何模型会污染相机 |
| 每份设计一个常驻 dev server | **本方案针对 open-vetta 的核心取舍**。常驻进程 = 白屏来源 |
| 新的画布依赖 | React Flow 12.11.2 已在仓库(媒体画布在用) |
| 画布依赖构建成功 | 构建失败必须降级为可见角标,不是空白 |
| 机械改风格 | 已有帧的重设交给 agent 读 `DESIGN.md` 完成 |
| 与媒体画布共用 React Flow 实例 | 媒体画布有自己的节点语义与手势,共用会把两个状态机耦合 |

---

## 2. 为什么这条路对 Wordless 成立

### 2.1 open-vetta 的根因

他们自己的注释:

> 画布上每个 frame 都是一个活的跨源 iframe,等于 N 套完整渲染树同时参与合成、**还都套在画布的 scale 变换下**。frame 一多,Chromium 的 tile 显存就不够用(`tile memory limits exceeded, some content may not draw`),画不出来的部分被直接丢弃——**这就是那种整窗口的撕裂闪烁**。

**这不是 bug,是"Web 应用里用 iframe 做画布"的结构性后果。** 他们的补丁(位图降级 + 挂载窗口)有效,但他们自己承认这是必须长期背负的约束。

### 2.2 Wordless 的三个结构性优势

| | open-vetta(Web) | Wordless(Electron) |
|---|---|---|
| 帧的载体 | `<iframe>`,在主渲染进程 DOM 树里 | `WebContentsView` = **独立渲染进程** |
| 合成 | 与主页面共享 tile 显存,被 CSS transform 包住 | Chromium 合成器独立合成,**tile 病理不存在** |
| 截图 | 需宿主提供 `ctx.capture.offscreen` | **Electron 内置离屏渲染**(`paint` 事件) |
| 资源获取 | 每份设计一个 Vite dev server + `npm ci` + 端口 | **自定义协议直读静态产物,零进程** |

### 2.3 已完成的、最难的那层

`apps/desktop/src/main/browser/browser-host.ts` + `browser-bounds.ts` 已经解决了原生视图的三个真实缺陷,注释里都有:

- **`attach` / `detach` / `destroy` 三态分离** —— `detach` 把原生视图从窗口摘掉,让上层 DOM 浮层不再被原生面遮挡,而页面保留滚动位置与表单状态
- **`normalizeBounds`** —— ① 小数设备像素**要 round 不能 floor**(否则边缘漏出一条页面)② 挂载/卸载期的 `NaN`(`setBounds` 会抛)③ ResizeObserver 亚像素抖动(每帧调一次会强制合成器重定位原生面)
- **`resolveVisibility` 是纯函数** —— 因为侧栏折叠动画会把占位区宽度穿过 0,naive 的 detach 会让页面**永久变白**;抽出来才可测
- **三信号遮挡系统**(`occlusion.ts`)—— declared / portalled / sampled,注释记录了"五点采样看不到边缘锚定的小浮层"这个实测失败

**设计画布需要的正是这些。** 本方案只在其上加一层"相机"。

---

## 3. 架构总览

```
┌─ 主渲染进程(React + React Flow)────────────────────────────┐
│                                                            │
│  L3 浮层    选中手柄 · 吸附参考线 · 工具条 · 上下文菜单        │  DOM
│             ↑ 复用现有 occlusion.ts 三信号系统               │
│                                                            │
│  L2 画布    React Flow 视口(平移/缩放/选择/框选)            │  DOM
│             每帧一个 <img> 位图贴图(位置纯派生,不测量)      │
│                                                            │
│  L1 活体    最多 1 个原生视图,只覆盖"被聚焦的那一帧"          │  独立渲染进程
│             条件:zoom ≥ liveZoomThreshold 且该帧在视口内      │
└────────────────────────────────────────────────────────────┘
      │ 几何(纯函数派生)    │ 位图(IPC 传 buffer)  │ 活体生命周期
      ▼                     ▼                     ▼
┌─ 主进程 ────────────────────────────────────────────────────┐
│  Camera          单一几何权威:world ↔ screen 纯函数          │
│  DesignStore     清单读写 + 磁盘对账(单向)                  │
│  RasterPool      离屏 webContents 池,复用,有界并发          │
│  design:// 协议   从 dist/ 直读,无服务器                    │
│  DesignHost      原生视图宿主(复用 BrowserHost 形态)        │
│  Builder         (可选)子进程 + 超时 + 原子切换              │
└─────────────────────────────────────────────────────────────┘
```

**四层纪律:**

1. **几何只有一个来源** —— 相机。位图矩形与原生视图矩形走**同一个纯函数**,两者不可能错位
2. **活体数量是架构上限,不是运行期节流** —— `maxLiveViews: 1`
3. **渲染只读 `dist/`** —— 构建是批量操作,不是常驻依赖
4. **每帧显式状态机** —— 非法转移在类型层不可能,每条异步边都有超时

---

## 4. 设计包格式

### 4.1 目录

```
meadow-market.wdesign/
  design.json          ← 清单:帧、几何、视口、风格 id、mode
  DESIGN.md            ← 风格规范(agent 读)
  theme.css            ← 设计令牌(单一真源)
  frames/              ← 源(agent 写这里)
    index.html
    login.html
  assets/              ← 图片、字体
  dist/                ← ★ 画布只读这里
    index.html
    login.html
  .build/              ← 构建日志与缓存(点开头,画布与文件监听都跳过)
```

**为什么是目录而不是单文件**:画布要渲染的是磁盘上的真实文件树,agent 要用普通读写工具改 HTML。open-vetta 踩过"文件 + 旁挂目录两个条目"的坑(移动/复制/删除/git mv 都要成对操作,漏一个就剩半份设计),所以是**一个目录**。

### 4.2 清单 `design.json`

```jsonc
{
  "version": 1,
  "type": "wordless-design",
  // 画布视口:相机状态的持久化
  "canvas": { "x": 0, "y": 0, "zoom": 1 },
  // 渲染模式:static = frames 直接可渲染;built = 需构建到 dist/
  "mode": "static",
  // 当前应用的风格体系 id(同时是"应用了哪套"的状态源)
  "style": "linear",
  // 品类:帧漏声明尺寸时的兜底,创建时声明一次
  "defaultFrameSize": { "width": 390, "height": 844 },
  "frames": [
    {
      "id": "index",
      "file": "frames/index.html",
      "x": 0, "y": 0,
      "width": 390, "height": 844,
      "title": "首页"
    }
  ]
}
```

### 4.3 帧的两种声明方式

**`mode: "static"`** —— 帧就是可渲染的 HTML,尺寸声明写在 HTML 注释里(不污染 DOM):

```html
<!doctype html>
<!-- @frame { width: 390, height: 844, title: "首页" } -->
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="../theme.css" />
    <link rel="stylesheet" href="frame.css" />
  </head>
  <body class="page-home">…</body>
</html>
```

**`mode: "built"`** —— 帧是源码(`.tsx` / Tailwind),构建到 `dist/`。尺寸声明同样是注释形式。

### 4.4 与 open-vetta 的关键差异

| | open-vetta | 本方案 |
|---|---|---|
| 帧的作者格式 | `.tsx`,必须经 Vite | **`.html` 起步**(`static`),要 React 再升 `built` |
| 渲染来源 | 常驻 dev server | **`dist/` 静态产物,经自定义协议** |
| 尺寸声明位置 | `export const frame = {...}` | HTML 注释 `<!-- @frame {...} -->` |
| 页面对应路由 | 真实路由(`/login`) | 帧 id 即文件名,协议路径 `/frame/<id>` |

---

## 5. 纯函数层(P0 的全部内容)

**这一层不 import React,不 import Electron,可在 `node --test` 下直接跑。** 它决定了画布对不对,必须先做完并测透。

### 5.1 `apps/desktop/src/renderer/features/design/camera.ts`

```ts
export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number;

/** world 矩形 → 屏幕矩形。位图贴图与原生视图**共用这一个**。 */
export function worldRectToScreen(camera: Camera, rect: Rect): Rect;

/** 屏幕点 → world 点(点击落点、拖拽新建)。 */
export function screenPointToWorld(camera: Camera, point: Point): Point;

/** 以锚点为中心缩放(滚轮/捏合)。锚点通常是光标位置。 */
export function zoomAround(camera: Camera, nextZoom: number, anchor: Point): Camera;

/**
 * 反向缩放系数:手柄、标题、参考线按它反向缩放,
 * 于是在**任何缩放下都是屏幕上的固定尺寸**。
 * 上限 8:缩到很小时 chrome 不该比内容还大。
 */
export function inverseScale(zoom: number): number;

/** 把内容居中并铺满视口(不全幅放大,避免小帧被拉到巨大)。 */
export function fitCamera(content: Rect, viewport: Size, maxZoom: number): Camera;

/** 视口裁剪:只光栅化视口内 + 余量的帧。余量让快速平移不至于露白。 */
export function visibleFrameIds(camera: Camera, frames: readonly FrameRect[], viewport: Size, marginPx: number): string[];

/** 缩放档位:位图按档缓存,取不超过当前 zoom 的最大档。 */
export function zoomBucket(zoom: number, buckets: readonly number[]): number;

/** 网格吸附(平移与拖拽共用)。 */
export function snapToGrid(value: number, grid: number, enabled: boolean): number;
```

**必须覆盖的测试**(每条都对应一个真实会看到的缺陷):

| 测试 | 缺陷 |
|---|---|
| `worldRectToScreen` 与 `screenPointToWorld` 互为逆 | 点击落点偏移 |
| `zoomAround` 后锚点在屏幕上**不动** | 滚轮缩放时内容乱跑 |
| `inverseScale` 在 zoom 极小时有上限 | chrome 比内容还大 |
| `visibleFrameIds` 的余量在快速平移时不留白 | 拖到新区域一片空白 |
| `zoomBucket` 取"不超过"而非"最接近" | 位图被放大后发虚 |

### 5.2 `apps/desktop/src/renderer/features/design/frame-surface.ts`

与 `browser-bounds.ts` 的 `resolveVisibility` **同一范式**:纯函数,因为"这里错了画布就白"。

```ts
export type FrameSurface =
  | { kind: "placeholder"; reason: "absent" | "queued" | "rasterizing" }
  | { kind: "failed"; reason: FrameFailureReason; detail?: string }
  | { kind: "texture"; textureKey: string }
  | { kind: "live" };

export type FrameFailureReason = "raster-timeout" | "load-failed" | "dist-missing" | "build-failed";

export function resolveFrameSurface(input: {
  /** 相机是否已包含这一帧(视口裁剪结果)。 */
  visible: boolean;
  /** 当前 zoom ≥ liveZoomThreshold。 */
  /** 原始缩放。是否够格给活体由 `allowsLiveSurface` 判定,调用方不预先算 —— 否则这条规则会在每个调用点各写一遍然后漂开。 */
  zoom: number;
  /** 这一帧是否是焦点帧。 */
  focused: boolean;
  /** 位图是否就绪。 */
  textureKey: string | null;
  /** 光栅化是否在排队/进行中。 */
  rasterizing: boolean;
  /** dist 里是否有这一帧的产物。 */
  artifactPresent: boolean;
  failure: { reason: FrameFailureReason; detail?: string } | null;
}): FrameSurface;
```

**规则表**(全部要有测试):

| 条件 | 结果 | 为什么 |
|---|---|---|
| `failure` 非空 | `failed` | **失败必须可见**,不是空白(见 §7 的教训) |
| `!artifactPresent` | `placeholder: "absent"` | 清单有、dist 没有 → 占位卡,不是白 |
| `!visible` | `hidden` | 视口外不占资源。**先于失败**:不渲染的东西没有视觉状态,失败照常从 issues 报出去 |
| `focused && allowsLiveSurface(zoom) && textureKey` | `live` | 有底图才给活体,避免闪白 |
| `rasterizing` | `placeholder: "rasterizing"` | 骨架态 |
| `textureKey` | `texture` | 常态 |

### 5.3 `apps/desktop/src/renderer/features/design/budgets.ts`

```ts
/**
 * 画布的资源预算。声明式、集中、每条有测试 —— 而不是散落在代码里的魔法数。
 */
export const DESIGN_CANVAS_BUDGETS = {
  /** 活体原生视图上限。架构上限,不是节流结果。 */
  maxLiveViews: 1,
  /** 位图缓存条数(LRU)。 */
  maxTextures: 64,
  /** 单张位图最长边(设备像素)。 */
  textureMaxEdge: 2048,
  /** 位图总字节预算。 */
  textureByteBudget: 64 * 1024 * 1024,
  /** 离屏池并发。 */
  rasterConcurrency: 2,
  /** 单帧光栅化超时。 */
  rasterTimeoutMs: 5_000,
  /** 构建超时(仅 mode: "built")。 */
  buildTimeoutMs: 120_000,
  /** 低于此 zoom 不给活体:缩小看全局时位图足够。 */
  liveZoomThreshold: 0.75,
  /** 视口外预光栅余量(屏幕像素)。 */
  rasterMarginPx: 400,
  /** 位图缩放档位。取不超过当前 zoom 的最大档。 */
  zoomBuckets: [0.25, 0.5, 1, 2] as const,
} as const;
```

### 5.4 `apps/desktop/src/renderer/features/design/texture-lru.ts`

位图缓存的淘汰逻辑(不含实际存储)。**放在渲染层而不是主进程** —— 位图(`ImageBitmap`)
住在渲染进程,主进程只负责流字节。

```ts
export interface LruEntry { key: string; bytes: number; lastUsed: number }
export interface LruLimits { budgetBytes: number; maxEntries: number }

/** 返回应当丢弃的 key,最久未用优先。排序确定(lastUsed 升序,同值按 key)。 */
export function lruEvict(entries: readonly LruEntry[], limits: LruLimits): string[];
export function lruTotalBytes(entries: readonly LruEntry[]): number;
```

**单条超过预算时也会被丢弃** —— 宁可不缓存这一张,也不越过预算:越过预算的后果是
内存无上限增长,而单张放不下的后果只是这一帧反复重光栅。

---

## 6. 主进程

### 6.1 `DesignStore` — 清单读写与对账

`apps/desktop/src/main/design/design-store.ts`

**单向对账,不搞"最后写入者胜"。** 这是与 open-vetta 的第二个关键差异:

| 谁拥有什么 | 存在哪 | 理由 |
|---|---|---|
| **哪些帧存在** | 磁盘上的 `frames/*.html` | 文件系统是内容的真相 |
| **帧标题、声明尺寸** | 帧文件内的 `@frame` 注释 | 跟着内容走,文件搬走不会丢 |
| **画布位置、用户拖过的尺寸** | `design.json` 的 `frames[]` | 纯布局,与内容无关 |
| **视口** | `design.json` 的 `canvas` | 纯相机状态 |

对账规则(纯函数 `reconcileFrames`,可单测):

```ts
export function reconcileFrames(input: {
  /** 磁盘上发现的帧(按文件名排序)。 */
  onDisk: readonly { id: string; declared: ParsedFrameMeta }[];
  /** 清单里已有的。 */
  inManifest: readonly FrameEntry[];
  /** 用户刚拖拽新建的落点(优先于自动布局)。 */
  pendingPlacements: ReadonlyMap<string, Point>;
  /** 品类兜底尺寸。 */
  defaultFrameSize: Size | null;
}): { frames: FrameEntry[]; changed: boolean };
```

- **磁盘有、清单没有** → 新帧:用 `pendingPlacements` 的落点,否则自动放到**最右帧的右边**(`FRAME_GAP = 80`)
- **两边都有** → 保留清单的 `x/y`(**用户拖拽不被覆盖**),`title`/`width`/`height` 跟随**帧文件声明**
- **清单有、磁盘没有** → 删掉的帧,丢弃

**尺寸兜底链**(照抄 open-vetta 的优先级,理由相同):

```
帧自己声明的 > 整份设计的多数派 > defaultFrameSize(品类) > 全局兜底
```

`FALLBACK_FRAME_SIZE = { width: 1440, height: 900 }` —— **取桌面而非手机**,因为"猜宽了顶多留白,猜窄了整个布局是塌的"。

**fail-open**:漏声明的帧**照常上画布**(拿多数派尺寸),同时把 `frame-size-missing` 报进 `design_status` 的 issues。open-vetta 的注释记录了为什么:

> 原来漏声明的画框直接不上画布……实测下来那个理由站不住:漏声明的代价不是「尺寸不对」,而是画布上**什么都没有**……用户盯着空白,agent 拿不到任何信号,于是开始盲猜,画布空了两分多钟。
>
> - 尺寸猜错了 —— **看得见**,一眼就发现,改一行就好
> - 画框不存在 —— **看不见**,只能靠 agent 主动查状态才知道

**落盘纪律**:写 `design.json` 用 **write-then-rename**(与仓库现有的 `config-store` 一致),避免半截文件。

### 6.2 `design://` 协议

> **实施时发现的缺口:必须 `registerSchemesAsPrivileged`。**
>
> 仓库里已有 5 个 `wordless-*` 协议,但它们**都没有**登记成标准 scheme —— 它们能用是
> 因为只服务**单个自包含文档**(`<img src>`、单页 HTML)。设计帧不同:它要解析相对 URL
> (`../theme.css`、`../assets/x.png`),而**非标准 scheme 下相对 URL 根本不解析**。
>
> 所以 `wordless-design` 必须登记为 `{ standard: true, secure: true, supportFetchAPI: true }`,
> 且**必须在 `app.whenReady()` 之前**。这一步不是可选的优化,而是整个渲染模型的前提 ——
> "源文件与产物用同一套相对引用"就建立在它上面。
>
> 另外:URL 里**只放不透明 id,不放路径**,由主进程的注册表反查。于是"从 URL 构造一个
> 逃出设计包的路径"在**结构上**不可能 —— 不是校验得更严,而是没有可注入的东西。

`apps/desktop/src/main/protocols/design.ts` —— 照抄 `media.ts` 的形态(严格校验 + 返回 `Response`)。

```ts
export function designFrameUrl(designPath: string, frameId: string): string;
// → wordless-design://frame/<encoded designPath>/<encoded frameId>

export function designAssetUrl(designPath: string, assetPath: string): string;

export function registerDesignProtocol(designRoot: string): void;
```

**安全规则(必须有)**:

1. **路径必须落在设计包内** —— 解析后做 `path.resolve` + 前缀校验,拒绝 `..` 逃逸
2. **只读 `dist/` 与 `assets/`** —— 帧 URL 映射到 `dist/<frameId>.html`,资源映射到 `assets/`
3. **帧 id 白名单字符集** —— `^[a-zA-Z0-9._-]+$`
4. **设计包路径必须在配置的设计根目录下**

**为什么用协议而不是 dev server**:零进程、零端口、零 `npm ci`、启动即用、进程崩溃不可能影响画布。

### 6.3 `RasterPool` — 离屏光栅化

`apps/desktop/src/main/design/raster-pool.ts`

**这是相对 open-vetta 最大的性能杠杆。** 用 Electron 内置离屏渲染(已核实 Electron 43 能力):

```ts
new BrowserWindow({
  show: false,
  webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
})
win.webContents.on("paint", (event, dirty, image) => { /* image: NativeImage */ });
win.webContents.setFrameRate(1..240);
```

三个关键性质(官方文档):

1. **事件驱动,不是轮询** —— 「when there is nothing happening on a webpage, no frames are generated」→ **空闲帧零成本**
2. **只传脏矩形** —— 增量更新
3. **`useSharedTexture: true` 可走 GPU 共享纹理** —— 「very fast because there's no CPU-GPU memory copies overhead」。**需要原生模块,所以默认走 CPU 共享位图,GPU 路径留作后续开关,不在 P3 承诺**

**池化设计**:

- 离屏 `webContents` **复用**,不是每帧一个。一次导航 → 等 `paint` → 取位图 → 下一个
- 有界并发 `rasterConcurrency = 2`
- **串行化"导航 → paint → 取图"**,每一步有超时与取消(避免导航竞态)
- 位图**按缩放档位**光栅,JPEG 编码,`devicePixelRatio` 感知**上限 2**

> **为什么上限是 2**:open-vetta 记了完整决策史 —— 曾经写死 1 倍,理由是"100% 缩放下就是 1:1",**漏了 `devicePixelRatio`**:Retina 上 100% 已是 2 倍,而旁边活体是矢量渲染怎么放大都锐利,**两态一对比非常刺眼**。降 1 倍是为压内存,现在位图改 JPEG(同像素数下字符串小一个量级),2 倍的成本付得起。

**接口**(端口注入,便于测试):

```ts
export interface RasterPort {
  /** 光栅化一帧,返回 JPEG 字节。超时或失败返回错误码,不抛。 */
  capture(request: { url: string; width: number; height: number; pixelRatio: number }): Promise<RasterResult>;
}
export type RasterResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; code: "timeout" | "load-failed" | "capture-failed" };
```

**`ElectronOffscreenRaster`** 是唯一 import Electron 的实现;池与队列只依赖 `RasterPort`。

### 6.4 `DesignHost` — 原生视图宿主

`apps/desktop/src/main/design/design-host.ts`

**形态直接复用 `BrowserHost`**:`attach` / `detach` / `destroy` 三态 + `normalizeBounds` + `resolveVisibility`。

```ts
export interface DesignViewHost {
  ensure(id: string, url: string): Promise<void>;
  attach(id: string): void;
  detach(id: string): void;
  setBounds(id: string, rect: ViewBounds): void;
  destroy(id: string): void;
  destroyAll(): void;
}
```

**直接复用而非复制**:

- `normalizeBounds` / `sameBounds` / `isDegenerateBounds` —— 从 `browser-bounds.ts` **提取到共享模块**,两边都用(几何归一化的三个坑是一样的)。**P4 已完成**:提取到 `main/platform/view-bounds.ts`,函数名不变(把改动压到只有 import 路径),`browser-bounds.ts` 删除,原测试随文件改名 —— 浏览器面板的功能一行未动(12/12 原样通过)。
- `resolveVisibility` 的逻辑**同样适用于活体视图**:`requested && bounds 有效 && 未失败` 才 attach

**活体视图的约束(必须写进注释)**:

- `setBounds` 是**整数屏幕矩形**,原生视图**不能被 CSS 缩放**
- `setZoomFactor` 是**页面缩放**,会**重排布局** —— 设计稿在固定 390×844 下不能重排
- 所以活体只在 **`zoom` 接近 1:1 且 `zoomFactor = 1`** 时出现;其他情况一律位图

**这就是 `liveZoomThreshold` 存在的原因**,不是性能妥协,是正确性要求。

### 6.5 `Builder`(可选,P7)

`apps/desktop/src/main/design/design-builder.ts`

仅 `mode: "built"` 使用。三条纪律:

1. **不是常驻进程** —— 一次构建 = 一个子进程(`capabilities/shell` 已有能力),结束即退出。没有端口,没有 watch 进程
2. **超时 + 原子切换** —— 超时杀掉;成功才 `dist.new/` → 原子 rename 到 `dist/`;**失败保留上一份好的 `dist/`**
3. **画布不等待构建** —— 构建期间画布照常显示旧 `dist/`

**实施记录(P7)**

**① argv 只从第一方表里产生,清单只声明「用哪一套」。** 设计包是 agent 写的。如果清单能
携带命令,点一次「重新构建」就等于在应用进程里执行 agent 写在文本文件里的任意命令 ——
而仓库对命令的约束是在 **shell 工具的边界**上做的(`agent-workspace-policy` 匹配
`resolveCommandSecurityRules` 的规则),那条边界在这里根本走不到。命令与文本文件之间必须
隔着一次代码改动。

**② 超时由 runner 实现,而不是由构建器。** 只有 runner 拿着进程句柄。构建器能做的只是
"等一个 promise",它无法让一个不肯退出的子进程停下 —— 把超时放在构建器里,结果会是
"超时了但子进程还在跑"。所以 runner 的契约是:**到点必须自行结算**。

**③ 切换不是一次原子操作,得说清楚它原子在哪。** POSIX 的 `rename` 只在目标为空或不存在
时才允许覆盖目录,而 `dist/` 是非空的,所以必须先把它挪开(`dist.previous/`)。于是有两次
rename,中间有一个 `dist/` 不存在的窗口。这个窗口是安全的,因为它两侧的状态都能自恢复:
窗口内的读请求拿到 404,渲染层当成「这一帧还没有产物」(`absent`,占位卡),不是错误;
第二次 rename 失败时会把旧的搬回来。

真正必须保证的那条 —— **构建失败不动旧产物** —— 不依赖这里的原子性,靠的是构建器在成功
之前**根本不进这个函数**。不是靠回滚,是靠不写。

**④ 「成功退出但什么都没写」必须当成失败。** 放它过去,就等于用一次成功的空构建把上一份
能看的产物换掉,而原因在退出码里看不出来。

**⑤ `@import "tailwindcss"` 的解析基准不能给设计包目录。** 第一版把 `base` 设成设计包根,
实测报 `Can't resolve 'tailwindcss' in '<设计包路径>'` —— 设计包在工作区里(应用之外),
从那里根本找不到应用的 `node_modules`。入口 CSS 是我们自己拼的字符串(令牌已内联),所以
这个 base **只用来做模块解析**,给构建脚本自己所在的目录才对。

**⑥ 构建必须跑在子进程里,而且跑的是应用自己的二进制。** `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
—— 不假设用户机器上装了 node(它确实没有)。构建脚本单独打成一个 **ESM** 产物
(`dist/electron/design-build.mjs`):`@tailwindcss/node` 是 ESM-only,而 CJS 里的动态
import 会被改写成 require,那条路在 ESM-only 包上不通。

---

## 7. 每帧显式状态机

open-vetta 用 `mounted` / `raster` / `paintTick` / 兜底计时器拼出隐式状态,所以出现"遮罩该让位时松手事件落空,这一次拖拽再也结束不了"这类问题(他们注释里就有)。

本方案:**显式状态 + 合法转移表**。

```
        ┌──────────┐
        │  absent  │  dist 里没有产物 → 占位卡(不是白)
        └────┬─────┘
             │ 发现产物
        ┌────▼─────────┐
        │ registering  │  排队等光栅槽
        └────┬─────────┘
             │ 拿到槽
        ┌────▼─────────┐   超时 / 加载失败
        │  rasterizing │ ────────────────► failed(可重试,带原因)
        └────┬─────────┘
             │ paint 到达
        ┌────▼─────────┐
        │    ready     │  有位图,可贴
        └────┬─────────┘
             │ 被聚焦 ∧ zoom ≥ 阈值 ∧ 在视口内
        ┌────▼─────────┐
        │    live      │  原生视图接管(位图留作底)
        └─────────────┘
```

**纪律**:

1. **每条异步边都有超时** —— 超时进入 `failed` 并带原因,**永不留在中间态**
2. **`failed` 是可见的** —— 带错误摘要的占位卡,不是空白(§6.1 引的教训)
3. **`live` → `ready` 幂等** —— 失焦只是把位图重新露出来,不重新光栅化
4. **状态转移写在 reducer 里**(纯函数),不在 `useEffect` 链里

```ts
// apps/desktop/src/renderer/features/design/frame-machine.ts
export type FrameState =
  | { phase: "absent" }
  | { phase: "registering" }
  | { phase: "rasterizing"; startedAt: number }
  | { phase: "ready"; textureKey: string }
  | { phase: "live"; textureKey: string }
  | { phase: "failed"; reason: FrameFailureReason; detail?: string };

export type FrameEvent =
  | { type: "artifact-found" }
  | { type: "slot-acquired" }
  | { type: "raster-done"; textureKey: string }
  | { type: "raster-failed"; reason: FrameFailureReason; detail?: string }
  | { type: "focus-changed"; focused: boolean; zoom: number }
  | { type: "artifact-lost" };

export function reduceFrame(state: FrameState, event: FrameEvent): FrameState;
```

---

## 8. IPC 与协议

### 8.1 DTO(`packages/protocol`)

全部 `additionalProperties: false`,与仓库现有约定一致。

```ts
export const DesignFrameSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  file: Type.String({ minLength: 1 }),
  x: Type.Number(), y: Type.Number(),
  width: Type.Number({ minimum: 1 }), height: Type.Number({ minimum: 1 }),
  title: Type.String(),
}, { additionalProperties: false });

export const DesignManifestSchema = Type.Object({
  version: Type.Literal(1),
  type: Type.Literal("wordless-design"),
  canvas: Type.Object({ x: Type.Number(), y: Type.Number(), zoom: Type.Number({ minimum: 0.05 }) }, { additionalProperties: false }),
  mode: Type.Union([Type.Literal("static"), Type.Literal("built")]),
  style: Type.Union([Type.String(), Type.Null()]),
  defaultFrameSize: Type.Optional(Type.Object({ width: Type.Number(), height: Type.Number() }, { additionalProperties: false })),
  frames: Type.Array(DesignFrameSchema),
}, { additionalProperties: false });
```

### 8.2 Bridge 方法(bridge 47 → 48)

| 方法 | 作用 |
|---|---|
| `listDesigns()` | 设计包列表 |
| `openDesign(designPath)` | 打开,返回清单 |
| `getDesignManifest(designPath)` | 重读清单 |
| `saveDesignCanvas(designPath, canvas)` | 保存视口(防抖) |
| `updateDesignFrame(designPath, frameId, patch)` | 保存帧几何(用户拖拽/缩放) |
| `createDesignFrame(designPath, input)` | 拖拽新建帧 |
| `deleteDesignFrame(designPath, frameId)` | 删除 |
| `rasterizeDesignFrames(designPath, requests)` | 批量光栅化 → 位图 |
| `setDesignLiveFrame(designPath, frameId \| null, rect)` | 活体视图接管/交还 |

**按仓库既有教训执行**:

- **载荷形状由 DTO 单一来源定义**,preload 用 `satisfies <DTO>` 标注构造出的信封 —— 形状不一致是**编译错误**(这条在消息推送那一轮踩过:`{id, ...patch}` 铺平导致每次 update 必然失败)
- **纯 handler 抽出 Electron**(`apps/desktop/src/main/design/handlers.ts`),IPC 边界单独测
- **桥版本守卫**:`requiredMethods` 必须包含每个新方法(`desktop-bridge-contract.test.ts` 已有此断言)

### 8.3 位图传输

位图走 **`ArrayBuffer` 转移**,不走 base64(避免 33% 膨胀与字符串拷贝):

```ts
// 主 → 渲染
{ frameId: string; bytes: ArrayBuffer; width: number; height: number; bucket: number }
```

渲染侧用 `createImageBitmap(new Blob([bytes]))` 转成 `ImageBitmap`,再 `drawImage` 到画布的位图层。**`ImageBitmap` 比 `<img>` 省一次解码**。

---

## 9. 渲染层

### 9.1 主视图接线

`WorkbenchShell.tsx` 增加 `mainView === "ui-preview"` 分支 → `<DesignWorkspace />`,与 `media` 分支同构。

**workbench entry 的开关**:`packages/runtime/src/index.ts` 里 `ui-design` 的 `availability: "unavailable"` → `"available"`。**这是"发布"这个功能的唯一开关。**

### 9.2 `DesignWorkspace` 结构

```
apps/desktop/src/renderer/features/design/
  DesignWorkspace.tsx       容器:数据获取、相机状态、IPC
  DesignCanvas.tsx          React Flow 视口 + 三层
  DesignFrameNode.tsx      单帧(位图贴图 + 活体占位)
  DesignSelectionLayer.tsx  选中手柄、框选、吸附参考线
  DesignToolbar.tsx         底部 dock(工具/撤销/重做/新建)
  DesignContextMenu.tsx     右键:复制/锁定/删除
  camera.ts                 ← P0 纯函数
  frame-surface.ts          ← P0 纯函数
  frame-machine.ts          ← P0 纯函数
  budgets.ts                ← P0
  texture-cache.ts          LRU + ImageBitmap 生命周期
  use-camera.ts             相机 → DOM 的直接写入(手势途中不进 React state)
  use-live-frame.ts         活体视图的 attach/detach 与几何上报
```

### 9.3 React Flow 的用法(照抄媒体画布已验证的形态)

- 用 `defaultNodes` / `defaultEdges`(**非受控**),不接收受控的 `nodes` —— 拖拽/缩放是 React Flow 的内部瞬时状态
- 只有**清单版本变化**时,通过实例 API(`setNodes`)单向同步一次
- **选区变化不触发整图回写**(避免与内部 store 和 `ResizeObserver` 形成反馈环)
- 节点类型一个:`designFrame`

### 9.4 相机与手势

**手势途中直接写 DOM,落定才进 state** —— 这是 open-vetta 的做法,理由相同:

> 平移途中不进 React state。每个 pointermove / wheel tick 都重渲染的话,画布上……

```ts
// use-camera.ts
// world 层的 transform 与 --design-lscale 由 ref 直接写;
// pointerup / wheel 停稳后才 commit 到 React state 并持久化(防抖 800ms)
worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
worldRef.current.style.setProperty("--design-lscale", String(inverseScale(zoom)));
```

`transformOrigin: "0 0"`,与相机数学一致。

### 9.5 三层渲染

| 层 | 实现 | 坐标系 |
|---|---|---|
| **L2 位图** | `<img>` / `<canvas>`,`worldRectToScreen` 定位 | world(在 transformed 容器内) |
| **L1 活体** | **不在 DOM 里** —— 原生视图,矩形由 `worldRectToScreen` 算出后上报主进程 | screen |
| **L3 浮层** | DOM,`inverseScale` 反向缩放 | screen |

**关键**:L1 的矩形与 L2 的矩形**来自同一个纯函数**,所以永远不可能错位。

### 9.6 吸附参考线

照抄 open-vetta 已验证的做法:

- **rAF 合并**:`onNodeDrag` 每帧可能触发多次,用"帧号为空才排程"合并成每帧一次
- **阈值按缩放换算**:`6 / zoom` —— 6 个**屏幕**像素换算成画布单位,所以放大缩小时手感一致
- **身份保持式更新**:`setGuides(current => sameGuides(current, next) ? current : next)` —— 返回同一引用时 React 跳过重渲染;拖拽时绝大多数帧参考线没变,于是几乎不产生渲染
- **拖拽结束一次性提交**一批 `frame.move` 命令

### 9.7 遮挡

**复用 `occlusion.ts` 的三信号系统**,但设计画布的浮层比浏览器面板多得多(手柄、吸附线、工具条、菜单、风格选择器)。

**P2 就要把 occlusion 纳入回归测试** —— 这是本方案的头号风险。

活体视图的遮挡响应:浮层压上来时 `detach`(页面保留状态),浮层离开时 `attach`。

---

## 10. `capabilities/design`

`packages/capabilities/design/` —— 从空壳变实。**不 import Electron,通过注入端口拿能力。**

### 10.1 端口

```ts
export interface DesignPort {
  listDesigns(root: string): Promise<DesignSummary[]>;
  readManifest(designPath: string): Promise<DesignManifest>;
  writeManifest(designPath: string, manifest: DesignManifest): Promise<void>;
  listFrameSources(designPath: string): Promise<{ id: string; path: string }[]>;
  readFrameSource(path: string): Promise<string>;
  writeFrameSource(path: string, content: string): Promise<void>;
  /** 光栅化:复用主进程的 RasterPool。 */
  rasterize(request: RasterRequest): Promise<RasterResult>;
  /** 布局探针:在离屏视图里跑检查脚本,返回结构化问题。 */
  inspect(request: InspectRequest): Promise<InspectFinding[]>;
  /** 设计根目录。 */
  designRoot(): string;
}
```

### 10.2 工具面

| 工具 | 作用 | 关键设计 |
|---|---|---|
| `design_create` | 建包(名称、品类尺寸、风格 id) | **插件/能力建脚手架,agent 不手搓**(单一写入者) |
| `design_status` | 帧列表 + issues + 构建状态 | **issues 是关键** —— 漏声明尺寸、溢出、未应用风格 |
| `design_frames` | 列出帧(可选重命名/删除) | |
| `design_screenshot` | 光栅化指定帧,**返回图片本身** | 模型必须能**看**到像素 |
| `design_inspect` | 布局探针:溢出、裁剪、省略号截断、flex 错位、对比度 | 确定性检查,不依赖模型判断 |
| `design_style_list` | 风格库列表 | |
| `design_style_apply` | 应用风格(写 `theme.css` + `DESIGN.md`,**应用前整包备份**) | 见 §11 |
| `design_export` | 导出 PNG / 静态站点 | |

### 10.3 布局探针(照抄 open-vetta 的清单)

open-vetta 的 `layout-probe.ts` 检查的是这几类,值得照搬:

- **横向溢出**:`scrollWidth > clientWidth` 且父级不裁剪
- **文本裁剪**:`overflow` 裁剪 + 非 `ellipsis` 的截断
- **换行**:`white-space: nowrap` 导致的内容溢出
- **flex 错位**:`flex-direction: row` 且 `align-items` 非 `stretch`/`flex-start` 的子项溢出
- **背景被裁**:有 `backgroundImage` / `mask` 的元素被裁剪

**为什么必须有确定性检查**:模型的视觉判断不可靠且不稳定;探针是**可复现的**,两者结合才是完整质检。

---

## 11. `profiles/ui`

`packages/profiles/ui/src/index.ts` —— 从空壳变实。

```ts
export const uiProfile: ProfileDefinition = {
  reference: { id: "ui", version: "1" },        // ← entry 里已写 { id: "ui", version: "1" }
  driverId: "generic",
  modelRequirements: { requiresVision: true, requiresToolUse: true },  // 必须能看像素
  activeToolNames: [
    "read", "write", "edit", "grep", "find", "ls",
    "design_create", "design_status", "design_frames",
    "design_screenshot", "design_inspect",
    "design_style_list", "design_style_apply", "design_export",
  ],
  // 与 package.json 已声明的依赖一致:design + browser + filesystem(无 shell)
  capabilityIds: ["filesystem", "design", "browser"],
  artifactKinds: ["design"],
  workbenchId: "ui-preview",
  skills: ["design-system"],
  systemPrompt: /* 见下 */,
  contextCompactionInstructions: /* 保留设计简报、风格 id、帧清单、未决问题、下一步 */,
};
```

### 11.1 `systemPrompt` 要点(照 ppt profile 的写法)

必须包含这几条硬约束:

1. **先读 `DESIGN.md`** —— 风格规范是唯一真源,**只用 `theme.css` 里定义的令牌**,不自己发明颜色
2. **`design_create` 建包**,不手搓目录结构
3. **尺寸声明写在帧文件里**,不许漏 —— 漏了要在 `design_status` 里看到并补
4. **每次改动后跑质检闭环**:
   > After every edit, run `design_inspect` for deterministic checks, then `design_screenshot` every changed frame and **inspect the actual pixels**, record the review, and fix issues for up to **three cycles**. Never claim completion while `design_status` still reports issues.
5. **不要用 `bash`/`write` 绕过 `design_*` 工具改清单** —— 与 ppt profile 里"Never use read/edit/write to bypass presentation approvals"同一条纪律

### 11.2 需要配套改的三处类型

| 位置 | 改动 | 说明 |
|---|---|---|
| `packages/domain/src/index.ts` `ArtifactKind` | 加 `\"design\"` | profile 的 `artifactKinds: [\"design\"]` 需要它是合法值 |
| `packages/runtime/src/index.ts` 的 `ui-design` entry | `availability: \"unavailable\"` → `\"available\"` | **发布这个功能的唯一开关** |
| `renderer/features/workbench/renderer-registry.tsx` | 注册 `ui-preview` × `design` 的 artifact 面板 | 右侧产物面板 |

### 11.3 与 ppt profile 的一致性

ppt 的闭环原话:

> After every edit, run deterministic quality checks, render every slide in batches, **inspect the actual pixels**, record visual review, and fix issues for up to **three cycles**.

**设计 profile 用同一个闭环。** 这是 Wordless 已经验证过的 agent 工作方式,**不新发明**。

---

## 12. 风格库(`DESIGN.md`)

### 12.1 `awesome-design-md` 是什么(已核实)

> `DESIGN.md` 是 Google Stitch 提出的概念:**一个纯 markdown 的设计系统文档,AI agent 读它来生成一致的 UI**。没有 Figma 导出,没有 JSON schema,没有特殊工具。放进项目根目录,任何编码 agent 立刻理解 UI 该长什么样。
>
> 每个站点带三个文件:`DESIGN.md`(设计系统)、`preview.html`(色板/字阶/按钮/卡片的视觉目录)、`preview-dark.html`
>
> 九个章节:视觉主题与氛围 · 色彩角色 · 字体规则 · 组件样式 · 布局原则 · 层次与投影 · 该做与不该做 · 响应式行为 · Agent 提示指南

### 12.2 承载方式:skill,不是远程清单

Wordless 有 `packages/skill-registry`,而 `DESIGN.md` 本质就是 markdown。所以:

```
apps/desktop/resources/skills/design-system/
  SKILL.md                ← 教 agent 怎么用风格库
  catalog.json            ← 索引:id / name / category / vibe / tagline
  styles/
    linear/
      DESIGN.md           ← 规范(agent 读)
      theme.css           ← 令牌(单一真源)
      preview.html        ← 视觉目录(选择器里内嵌预览)
    stripe/
    …
```

### 12.3 三条纪律

1. **内置精选起步,远程目录是可选增量** —— open-vetta 的注册表注释证明了代价:「数据**只**来自远端资源仓库……所以『一套都没有』是一个真实可能的状态」,而且空列表要区分"还在拉"和"拉失败了"。**新建设计不该依赖网络。**
2. **应用前整包备份** —— `theme.css` / `DESIGN.md` / `frames/` / `assets/` → `.build/style-backup/`(点开头,画布与监听跳过)
3. **应用后由 agent 重设** —— 零帧时直写 `theme.css`;已有帧时落 `DESIGN.md`,由 agent 做全量重设(设计无法机械改风格)

### 12.4 预览复用

`DocumentPreview.tsx` 已支持 `HtmlPreview` —— 风格选择器直接内嵌 `preview.html`,不新写预览组件。

---

## 13. 不变量与测试策略

### 13.1 必须成立的不变量

| # | 不变量 | 测法 |
|---|---|---|
| 1 | 位图矩形与活体矩形**同源** | 同一个纯函数,断言两者相等 |
| 2 | 活体视图数 **≤ maxLiveViews** | 计数器 + 断言 |
| 3 | 任何时刻**没有帧停在中间态超过超时** | 状态机测试 + 假时钟 |
| 4 | 位图总字节 **≤ textureByteBudget** | LRU 测试 |
| 5 | `design.json` 写入**永不半截** | write-then-rename + 注入中断 |
| 6 | 协议**永不逃出设计包** | `..` / 绝对路径 / 符号链接的用例 |
| 7 | 构建失败**不清空 `dist/`** | 注入失败构建 |
| 8 | 清单与磁盘对账**幂等** | 跑两次结果相同 |

### 13.2 分层测试

| 层 | 工具 | 内容 |
|---|---|---|
| 纯函数 | `node --test` | `camera` / `frame-surface` / `frame-machine` / `reconcileFrames` / `lru` / 布局探针规则 |
| 主进程服务 | `node --test` + 假端口 | `DesignStore`(注入假 fs)、`RasterPool`(注入假 `RasterPort`)、协议路由(注入假 fs) |
| IPC 边界 | `node --test` | 纯 handler + DTO 形状(**照消息推送那轮的教训:边界要有自己的覆盖**) |
| 渲染层 | vitest browser | 画布交互、三层几何、遮挡响应、状态机在 UI 上的表现 |
| 契约 | `node --test` | bridge `requiredMethods` 覆盖每个新方法 |

### 13.3 每个阶段的验收标准

见 §14。

---

## 14. 分阶段路线

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0** | `camera.ts` / `frame-surface.ts` / `frame-machine.ts` / `budgets.ts` / `texture-lru.ts` + 全套单测。**不 import React、不 import Electron** | ✅ **已完成**:50 条测试全绿,`tsc` 零错误 |
| **P1** | `DesignStore` + `design.json` 读写 + `design://` 协议 + IPC 面(2 个方法,bridge 47→48) | ✅ **已完成**:75 条测试全绿;协议逃逸与符号链接逃逸用例全拒(已基线验证);共享几何模块推迟到 P4 |
| **P2** | `DesignWorkspace` + React Flow 画布 + 帧节点 + 选择/框选 + 网格吸附 + 几何提交 + `profiles/ui` 与入口打通(bridge 48→49) | ✅ **已完成**:画布可平移缩放选择拖拽,拖拽落库;142 条设计测试 + 6 条画布浏览器测试全绿。**帧内容仍是占位卡**——位图来自 P3 的光栅池 |
| **P3** | `RasterPool` + Electron 离屏光栅化 + 缩放档位缓存 + 位置图缓存 + 批量光栅 + IPC(bridge 49→50) | ✅ **已完成**:池的并发/超时/去重/取消全部有测试并基线验证;163 条设计测试 + 6 条画布浏览器测试全绿。**设备像素比仍按 1 倍**(见 §6.3) |
| **P4** | `DesignViewHost` + `liveFrameTarget` 纯判定 + 遮挡复用 + 共享几何提取 + IPC(bridge 50→51) | ✅ **已完成**:至多一个活体是**接口形状**表达的;活体矩形与位图矩形同源(有测试钉住);172 条设计测试全绿 |
| **P5** | `capabilities/design`:4 个工具(`design_create` / `design_status` / `design_inspect` / `design_screenshot`)+ 问题模型 + 布局探针 + 适配层 + 画像工具面 | ✅ **已完成**:23 条能力测试 + 13 条脚手架/状态测试全绿。`design_style_*` 与 `design_export` **刻意不声明**(见 §14.5) |
| **P6** | 侧栏「设计」入口 + 设计画廊(我的设计 + 内置风格墙)+ 令牌驱动的缩略图 + 按风格建包 + IPC(bridge 51→52) | ✅ **已完成**:4 套内置风格的 `theme.css` + `DESIGN.md`;22 条令牌/栅格测试全绿 |
| **P7** | `mode: "built"` 构建器 + Tailwind 配方 + 建包即构建 | ✅ **已完成**:构建器与配方共 36 条测试全绿,四条基线各自精确打掉对应测试;**端到端实测**在真实脚手架产出上跑出 4879 字节真 CSS,两次构建逐字节相同 |

**P0–P2 就能看到"像 Figma 的画布"**;P3/P4 是性能与精度;P5 起才是 agent 能力。**每一步都可验证、可停。**

---

### 14.1 实施中发现的三个坑(P2)

**① `.ts` / `.tsx` 写错扩展名,`tsc` 不报,只有 Vite 报。**

仓库同时开了 `allowImportingTsExtensions` 与 `moduleResolution: Bundler`,于是 TypeScript 会把
`./x.ts` 这样的说明符**重新解析**到实际存在的 `./x.tsx`,**不报错**;而 Vite 按字面解析,直接失败。
P2 里 `DesignFrameNode.tsx` 导入 `design-viewport-context.ts`(实际是 `.tsx`)就是这样:
`tsc` 零错误,浏览器测试才炸。

教训:**改导入时不要只信 `tsc` 的绿灯**。批量核对的办法是对所有**带显式扩展名**的相对导入做一次
存在性检查(无扩展名的由解析器正常处理,不在其列)。

**② React Flow 在浏览器测试里需要进 `optimizeDeps.include`。**

它是唯一带来自身 React 运行时依赖的画布库;不预打包时可能出现重复 React 实例,
表现为 `Cannot read properties of null (reading 'useState')`。已与 `zustand` 一起加入。

**③ 不要为库的动画写时序断言。**

缩放条的重置走 `zoomTo(1, { duration: 180 })`。一开始的测试点完立刻断言百分比,单跑通过
(动画还没开始)、全量跑失败(动画未落定)—— 那是**偶发测试**。加有界轮询也只是把赌注换了个
大小:负载高时照样失败。最终改成只断言这个组件拥有的东西(百分比被渲染出来、按钮有可访问名),
动画时长交给库。

---

### 14.2 实施中修掉的一处接口缺陷(P3)

`RasterResult` 一开始是这么写的:

```ts
| { ok: true; bitmap: { key: string; bytes; width; height } }
| { ok: false; key: string; code }
```

成功变体把 `key` 埋在 `bitmap` 里,失败变体放在顶层。调用方拿到的是一批结果、要按 key 与请求
对上,于是**必须先分支才能分组** —— 而"先分支再分组"正是会漏掉某一类的写法。

测试抓到了它:成功项的 key 不在顶层,`results.find(r => r.key === ...)` 对成功项**永远返回
undefined**。改成两个变体都带顶层 `key`、成功变体扁平化。

教训:一批结果的**每个变体都要能用同一把钥匙打开**。

### 14.3 预算按主人分开(P3)

P0 把 `rasterConcurrency` / `rasterTimeoutMs` / `buildTimeoutMs` 放进了渲染层那份预算,结果
P3 需要它们时,主进程只能反向 import 渲染层的模块 —— 分层是反的。

实测确认渲染层**从不读**这三个数。它们管的是离屏视图与子进程(真实渲染进程与系统资源),
而渲染层那份管的是位图与 LRU(渲染进程内存)—— 主人和失败模式都不同。现在各归各处:
`main/design/raster-budgets.ts` 与 `renderer/features/design/budgets.ts`。

---

### 14.4 活体层的三条不变量(P4)

**① 至多一个是接口形状,不是运行期检查。**

`DesignViewHost` 没有"按 id 管理多个视图"的 API —— 它就是 `focus` / `setBounds` / `blur`。
因为原生视图**不能被 CSS 缩放**(`setZoomFactor` 会重排布局,设计稿在固定尺寸下不能重排),
所以活体只在 1:1 时出现,而 1:1 时用户只能编辑一个帧。"至多一个"于是不需要 assert,也没有
可以写错的计数器。

**② 活体矩形与位图矩形同源。**

两者都从 `worldRectToScreen` 派生,`design-live-frame.test.ts` 里有一条测试专门钉这件事:
它拿与 `designFrameViews` 相同的相机和入参算一遍期望值。若哪天有人给活体单独算一遍几何,
那条测试会失败 —— 而参考实现的错位正是来自"各自 `getBoundingClientRect()`"。

**③ 复用既有的遮挡协调器,而不是新建一个。**

用的是 `browserOcclusion`(名字是浏览器时代的,机制是全应用的)。好处是**设置对话框、菜单
这些已经声明过遮挡的浮层自动对设计画布生效** —— 不用逐个接线。代价是这个单例的名字对设计
画布来说有误导性,值得在后续把 `browserOcclusion` 改名成中性名字。**这个代价是清醒接受的:
新建一个协调器意味着每加一个浮层都要在两处声明,那才是真的会漏。**

另外:边界错的顺序也有讲究。几何随 `focus` **一起**给,而不是"先 `setBounds` 再 `focus`" ——
后者在某一次实现里被 `focus` 对新视图的重置吃掉了,于是第一次 attach 没有几何,**原生视图
挂上去是空白**。这类"顺序对了才对"的地方,靠注释和接口形状一起固定住。

---

### 14.5 声明了却跑不起来的工具,比没有更糟(P5)

`design_style_*`(P6)与 `design_export`(P7)都还没实现,所以**没有写进 `activeToolNames`**。

理由不是"以后再补",而是:模型会去调它声明拥有的工具,然后拿到一个失败 —— 那次尝试、
那次失败、以及"这个功能坏了"的判断,都是净损失。**没有工具时模型会去找别的路;有一个坏
工具时它会以为自己有路。**

### 14.6 标题里的 `-->` 是一处注入(P5)

`frameComment` 一开始直接用 `JSON.stringify` 拼注释。而 **`JSON.stringify` 不转义 `<` 和
`>`**,于是标题里只要有一个 `-->`,注释就会**提前结束**,后面的内容变成真正的标记。

这是注入,不是格式问题。修法是把 JSON 里的 `<`/`>` 换成 `\uXXXX` 转义:读回来完全一样,
而注释里再也凑不出 `-->`。`withFrameTitle` 走同一个转义 —— 改标题同样不能把注释写坏。

测试里有一条专门钉它,已基线验证(摘掉转义即失败)。

**这个缺陷是被"测试写得比实现更严"抓出来的**:我最初的断言是"尖括号在正文里被转义",
写测试时顺手也想断言"整个源码里没有裸的 `<script>`",结果发现注释里那行 JSON 里就是有。

---

### 14.7 呈现方式照 open-vetta 的设计菜单(P6)

侧栏新增「设计」入口,进去是画廊:**我的设计**在上,**内置风格墙**在下。三处照搬了它验证过的取舍:

- **风格墙向下无限延伸,不做横向翻页。** 参考实现那段注释说服了我:选风格是这条路上最容易被
  省略的一步,多数人根本不知道有这一步,于是每份设计都长成模型的默认审美。而下拉框要求用户
  **先知道自己在找什么** —— 铺开才看得见全貌。
- **缩略图用该风格自己的令牌画一张通用产品界面。** 所有颜色/圆角都取自它的 `theme.css`
  (单一真源),解析器不可能与它漂开。画的是**同一张**界面,差异全部来自风格本身。
- **按行窗口化,几何单独抽成纯函数。** 列数、行高、可见窗口全是「差一格就错位」的算术,而在
  浏览器里极难复现 —— 只能靠单测。

**刻意没做的一件**:风格卡不挂真实渲染的 demo。参考实现是"静态只铺色板,悬停到哪张才换真
demo",而这里只做了前半步 —— 一份 demo 是一个 iframe 加一份完整文档,一屏几十张连排光解析
就能把滚动拖住。色板已经足以分辨"哪套更圆、更亮、更密"。

**风格在建包时落盘**,不是事后追加:否则第一帧必然是按默认审美写的,之后要改的是所有帧。

### 14.8 「设计」入口默认落在「更多」里(P6)

我一度把它加进 `DEFAULT_PINNED_SIDEBAR_NAV_IDS`(想让它像 open-vetta 那样一眼可见),但代码里
有一条明确的约定:

> 加一个条目**永远不会**夺走用户自己选过的一行 —— 新条目落在「更多」里。

于是改回不固定。**要真正让它显眼,该改的是默认排列的取舍(把谁挤下去),而不是绕过这条约定** ——
那是产品决定,不该由我在加一个入口时顺手做掉。

### 14.9 目录放在主进程侧,而不是能力包(P6)

风格目录(4 套 `theme.css` + `DESIGN.md`)一开始放在 `capabilities/design` 里,结果主进程的 store
要反向 import 能力实现,而能力包的 `index.ts` 用 NodeNext 的 `.js` 说明符 —— **`node --test`
加载不了它**,表现是 store 的测试整体起不来。

移到 `main/design/style-catalog.ts`。等 P7 的 `design_style_*` 工具也要用它时,它应当上移到一个
**双方都能加载的共享包**,而不是内联到某一侧。

### 14.10 新建设计为什么没有样式,以及最后怎么解决(P7)

这是 P7 期间查出来的、比 P7 本身更重要的事。

**现象:** 脚手架与四套内置风格的 `theme.css` 写的是 Tailwind v4 的 `@theme { … }` 块,帧里用的
是 `bg-surface`、`text-muted` 这类工具类。而:

- `@theme` 是 Tailwind 的 at-rule,**浏览器直接忽略**;
- `bg-surface` 这些类名**没有任何地方定义过**;
- `design://` 协议**只发 `dist/` 里的文件**,不注入任何样式。

**结果是:一段样式都不生效,文字用默认字体贴在白底上。** 风格库的缩略图是好的(它走内联
令牌),所以画廊看起来很正常,点进去是另一回事 —— 这种落差比一直难看更伤人。

#### 参考实现怎么做的

open-vetta 的 `theme.css` 与我们的**逐字相同**(只有 `@theme`),缺的确实是编译这一步。它的
帧的样式表是一个入口(`engine/src/styles.css`):

```css
@import "tailwindcss";
/*__VETD_SOURCE__*/
@plugin "@iconify/tailwind4";
@import "@design/theme.css";   ← 设计的令牌
```

**但它拿到这一步的方式不该照搬。** 它的帧是 JSX 模块、由 Vite 编译,所以必须:

- **每个打开的设计起一个常驻 Vite dev server**(`engine/engine-manager.ts:426`);
- 首次使用时 `npm ci` 整条工具链到 `~/.vetta/design-engine/` —— vite 7 + react 19 + 4 套
  iconify + tailwind + html-to-image,**要联网、要用户机器上有 npm**。

我们的帧是静态 HTML、渲染读 `dist/`。**同样的产物,一次批量编译就能得到** —— 没有常驻进程,
没有端口,没有运行时安装。所以结论是:**学它的目标,不学它的机制。**

#### 最终做法

```
入口 = '@import "tailwindcss";' + theme.css
候选 = 扫 frames/**/*.html
css  = compile(入口, { base: 应用目录 }).build(候选)
→ 覆盖 dist/theme.css,并按原样铺 frames/** 与 assets/**
```

**帧里的 `<link href="../theme.css">` 一个字都不用改**,协议也不用知道构建发生过。新建设计
默认就是 `mode: "built"` + `recipe: "tailwind"`,建包后立刻构建一次(见 §6.5 ⑤⑥)。

#### 三个必须记下来的细节

**① 候选由我们自己扫**(`tailwind-candidates.ts`),不用 `@tailwindcss/oxide` 的 Scanner。
**宁可宽松**:Tailwind 对认不出的候选什么都不生成,所以多给的代价只是扫描时间;而漏给的
代价是**一条本该存在的样式静默消失** —— 那正是这次要修的 bug 的形状。两边的代价不对称。
(实测:扫整篇源码会让 `body`、`class` 这类词也变成候选,无害。)

**② Tailwind 只发出「被用到」的主题变量。** 实测:`@theme` 下声明了 7 个 `--color-*`,帧里
只用上 3 个时,产物里就只有那 3 个 —— 于是**手写 `var(--color-primary)` 会静默取不到值**。
`@theme static` 会全部发出(实测确认):

```
@theme         → 发出的 color 变量: --color-surface
@theme static  → 发出的 color 变量: --color-primary, --color-surface, --color-danger
```

**这是待办**:脚手架与四套风格目前仍是 `@theme`。改它要同时动 `parseThemeTokens` 的块匹配
(P6 的缩略图靠它,`@theme static {` 与 `@theme {` 是两种写法)、4 套风格、脚手架与测试。
按 CSS 工具类写法的设计不受影响(用到的令牌一定会发出);只有手写 `var()` 的设计会踩到。

**③ `built` 模式也必须刷新帧,只是不碰 `dist/theme.css`。**

把新设计改成 `built` 之后有一个**我自己引入的回归**:`syncRenderRoot` 原来对非 `static` 直接
return,而 `openDesign` 会调它 —— 于是 agent 改了帧,画布上还是上一次构建的快照。

产物形状两种模式本来就一致,差别只在 `theme.css` 从哪来(`static` 是源文件拷贝,`built` 是
编译产物)。所以 `built` 下要刷新帧、又必须留住那份编译产物 —— 否则每次打开设计都会把样式
删掉,而那正是这一节要修的 bug 的形状。

残留:**新增的工具类要等下一次构建才会出现在样式表里**。帧的改动立刻可见,新的类名不是。

**④ 打包要 `asarUnpack`。** `lightningcss` 与 `@tailwindcss/oxide` 都是**原生模块**,
按平台各一份二进制(`darwin-arm64` 实测 8.1M + 2.8M)。原生 `.node` 不能从 asar 里加载,
所以 `electron-builder.yml` 需要给它们加 `asarUnpack` —— **这一条还没做**,因为它是打包配置
改动,不是代码改动。在此之前,开发环境能构建、发布版会失败。

### 14.11 「切走再切回来,对话没了」(P6 之后修)

**用户报的现象**:开一个 UI 设计会话、agent 正在输出,切到别的会话再切回来,该会话显示
「这个工作区里还没有设计」,而不是对话流。

#### 根因:我把「打开会话」和「打开画布」压成了一个动作

侧栏点会话时按 `workbenchId` 决定主区域渲染什么,其中 `ui-preview → "ui-preview"`。于是
UI 设计会话一点开就**只有画布**:`ThreadView` 根本不挂载,`showSessionTools` 为假(右侧面板
一起隐藏),**画布上也没有任何回到对话的入口**。

时间线其实是:

| 时刻 | mainView | 看到 |
|---|---|---|
| 刚建会话 | `"thread"`(建会话只设 `selectedSessionId`) | 对话流 |
| 从侧栏点开它 | `"ui-preview"` | 画布,对话没了且回不去 |

也就是**第一次从侧栏点开它就会变**,不是"切回来才变"。我上一轮把画布的唯一入口放在"点会话"
上(画廊只负责浏览+创建),同时没有留回路 —— 这是设计缺陷,不是实现笔误。

#### 改法:并排,而不是取代

会话就是对话;画布是这一轮工作的产物,**不是它的替代品**。取代意味着 agent 干活时你看不见
它在干什么。

- 点会话永远进对话(`resolveSessionOpenTarget`)。
- UI 设计会话额外把画布作为**右侧面板的一个页签**调出来(复用 `browser` 页签那套机制)。
- 依赖只有"选中了哪个会话",所以用户手动关掉面板后它会保持关着 —— 要的是"默认并排",
  不是"永远并排"。

判断抽成了纯函数 `renderer/features/workbench/session-open-target.ts`:它原本是两处一模一样的
三元表达式(侧栏一处、设置对话框一处),改一处漏一处。组件里既看不见也测不到,变成映射表
之后就是可断言的事实 —— 基线验证:改回 `mainView: "ui-preview"`,两条测试立刻失败。

#### 同时修掉的三个真 bug

**① 画布只在打开那一刻找一次设计。** `useEffect` 的依赖是 `[client, openDesign, root]`,
**没有 `sessionId`、也没有任何刷新**。后果:①agent 在画布开着的时候建出设计,它不会出现;
②两个 UI 会话在同一个工作区时 `root` 相同,切换会话不重新加载,画布一直显示上一个会话的设计
(或它那份空态)。

现在:依赖加上 `sessionId`,并在**还没有设计且 agent 正在运行时**轮询(2.5s)。找到就停 ——
已经打开的设计不会被换掉,因为用户可能正在看别的设计或在拖着帧。

**② 换会话时没有清掉 `opened`。** 上一个会话的设计会留在画布上,而画布已经属于另一个会话。

**③ 空态说了假话。** 它说的是「这个工作区里还没有设计」,而那时 agent 正在写 —— 这句话读起
来像故障。更糟的是它与**画廊**空态的中文**一模一样**(两个不同的键、同一句话),连"我在哪个
界面"都分不出来。现在分成「正在生成设计…」与「这次会话还没有产出设计」,画廊那句也改了。

#### 仍然存在的缺口

**会话与设计之间没有关联。** 画布挑的是工作区里的**第一个**设计(`found[0]`),所以同一个
工作区里两个 UI 会话会显示同一份设计。协议里的 `DesignSummary` 没有时间戳,拿不到"最近改的
那份"。正确的做法是给 `design_create` 产出的设计记下所属会话(或在摘要里带上 `updatedAt`,
按最近修改挑),那时这两处一起改。

### 14.12 「画布一直显示正在生成设计…」:根路径被定了两次(P7 之后修)

**用户报的现象**:UI 设计效率很差,agent 跑很久,`frames/` 里已经有 html、`dist/` 也有产物了,
但右侧画布**什么都不显示**,一直停在「正在生成设计…」。

#### 根因

`create-runtime.ts` 用**会话记录的 `runtimeRootPath`** 构造设计工具:

```ts
designToolsFor(context.record.runtimeRootPath)
```

而 `DesignWorkspace` 用的是**另一个来源**:

```ts
const workspace = snapshot?.workspaces.find((c) => c.id === session?.workspaceId);
const root = workspace?.rootPath ?? null;          // ← 猜出来的等价物
```

这两者**通常**指向同一个目录,所以在有工作区的会话上一直没露馅。但 UI 设计会话**不需要**关联
工作区,而 `runtimeRootPath` 在没有工作区时是:

```ts
const runtimeRootPath = workspace?.canonicalRootPath ?? join(paths.sessionWorkspacesRoot, id);
```

也就是 `<userData>/session-workspaces/<sessionId>`。于是:

- 设计工具把包写进**会话私有根** ✓(`frames/` 与 `dist/` 都在那儿)
- 画布拿到 `root === null` → effect 直接返回 → **从不扫描任何目录** → 永远显示「正在生成设计…」

`AppSnapshot.sessions` 本来就是完整的 `SessionRecord[]`,**`runtimeRootPath` 一直在里面** ——
渲染层只是没去读它。

#### 改法与教训

画布改读 `session.runtimeRootPath`,与工具**同一个值**,不再是一个猜出来的等价物。

这与画布几何那条纪律是同一件事:**同一个事实不能在两处各定一次**。上一轮把两个会话的
"打开视图"判断抄成两份三元表达式是同一个错误的另一种形态。判断根路径时我写的注释是"找设计包
的根"—— 但"根"在这里有两个候选(工作区根 / 会话语义根),而它们只在有工作区时才恰好相等。

#### 顺带修掉的两处延迟

**① 轮询 2.5s → 1s。** 设计是 agent 中途建出来的,而用户正盯着这块空面板;一次扫描是列几个
目录、读几个清单,代价很低,而设计一出现轮询立刻停。

**② 评审循环从"每改一次"改成"一批改完之后"。** prompt 原文是
`After every change: call design_status … design_inspect … design_screenshot`,而
`design_screenshot` **一次只抓一帧**。4 帧的设计一轮评审就是 ~8 次调用,×3 轮 —— 这正是
"不断调用工具调试修改"的来源。同时补上了原文**从未提过**的一件事:设计包是
`design_create` 建出来的,不该手搓(手搓出来的包画布认不出来,那会表现为完全相同的症状)。

### 14.13 「画布只有占位卡、agent 跑 62 分钟」:两个根因(实测数据)

从一次真实会话的 journal 里读出来的事实(810 行,8MB):

```
工具调用 270 次 | 61.8 分钟 | 输出 114,894 token | 输入 601,976 token
  edit 123 · read 45 · design_inspect 42 · grep 20 · write 14
  design_screenshot 9 · design_status 7 · design_create 1
design_screenshot 返回:9 次全部 "capture-failed"   ← 一次像素都没看到
design_inspect 返回:尾部连续 17 次同一条 overflow-y          ← 追一个修不掉的
```

`edit` 123 次不是"模型笨":**它的眼睛是瞎的**。9 次截图全失败,于是它只能用 `edit` 盲改、
用 `design_inspect` 拿几何回音 —— 而那条回音还是假的。

#### 根因一:`release()` 停掉出帧,下一次复用就拿到空位图

`ElectronOffscreenRaster.release()` 里有一句 `stopPainting()`,理由是"页面若有动画,继续画
只是白占 CPU"。代价是致命的 —— 实测(同一窗口、同一页面、每次重新 load 之后取一帧):

```
① 首次                  jpegBytes=3610
② 再取(未停)            jpegBytes=3610
③ stopPainting 之后复用  jpegBytes=0      ← 空位图
④ 再复用                jpegBytes=3610
```

空位图在调用方那里只能表示成 `capture-failed`。而 `release()` **每次都会停**,于是**每一次**
复用窗口的截图都失败 —— 画布的纹理走的是同一条路径,所以画布整片占位卡。

**修法**:`release()` 不再停出帧;同时 `waitForPaint` **跳过空图继续等**(空图不算一帧),
由调用方的超时兜底。设计帧是静态文档,离屏渲染又是事件驱动的,那点 CPU 节省本来就是理论上的。
修后实测连续 5 次(含复用、含人为先停一次)全部 3610 字节。

#### 根因二:探针的溢出检查写反了

我加过 `overflow-x` / `overflow-y` 两条检查,**条件是"内容比盒子大、且盒子不裁剪"**。参考
实现的条件正好相反:

```js
const overY = clipsY && el.scrollHeight > el.clientHeight + 1;   // 只在真的裁掉时才报
```

它的注释说得更准:「只认 overflow 明确藏起来的情况 —— **可滚动的区域超出是正常的**」。而
"手机帧的 body 比声明高度多 4px"就是"正常的"那一类,却被我报成了必须修的问题,还带着一句
"Fix these before taking a screenshot" —— agent 于是修不掉、又不能截图,卡死。

**修法**:删掉那两条,只留 `text-clipped`(裁剪了、又没有省略号 = 硬切掉)。
**漏报一条,好过让 agent 追一条修不掉的。**

#### 从这次故障里应当留下的两条纪律

1. **"到位"不等于"有效"。** 位图到达了叫到达,空位图也是到达。凡是"事件交给了我们一个值"
   的接口,都要问一句这个值有没有可能是空壳 —— 而空壳绝不能当成成功。
2. **假阳性比漏报贵得多。** 这条我写在对比度检查那里("false positives are worse than
   misses"),却在溢出检查上违背了。一条修不掉的报告不只是噪音:它会让整个会话卡住。

**仍然存在的缺口**:光栅失败目前仍然表现为**中性的占位卡**(`DesignFrameNode` 里
`failure: null` 是写死的)。这次故障本来可以在几秒内诊断出来 —— 只要画布上写着
`capture-failed`。把每帧的失败原因接到节点上是明确的下一步。

---

## 15. 风险登记

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| 1 | **原生视图遮挡 DOM 浮层** | 浮层点不到 | 复用三信号系统;**P2 就纳入回归测试**(头号风险) |
| 2 | `useSharedTexture` 需原生模块 | GPU 路径不可用 | 默认 CPU 位图;GPU 作为后续开关,**不在 P3 承诺** |
| 3 | 离屏池的导航竞态 | 位图串帧 | 串行化"导航 → paint → 取图",每步超时与取消 |
| 4 | `devicePixelRatio` 处理不当 | 位图与活体清晰度落差刺眼 | 上限 2 且**按设备像素光栅**;测试断言 |
| 5 | 帧数很大(100+) | 首次光栅排队久 | 视口裁剪 + 余量;先低档位再补高档位 |
| 6 | 活体视图与位图切换闪白 | 观感断裂 | 活体出现时**位图留作底**,不撤 |
| 7 | agent 漏声明尺寸 | 帧不上画布 → agent 盲猜 | **fail-open**:照常上画布 + `design_status` 报 issue |

---

## 16. 与 open-vetta 的逐项对照

| 维度 | open-vetta | 本方案 | 收益 |
|---|---|---|---|
| 帧载体 | iframe(主渲染进程 DOM) | `WebContentsView`(独立进程) | tile 显存病理不存在 |
| 活体数量 | N(靠节流压) | **1(架构上限)** | 帧数不影响主渲染进程 |
| 资源获取 | 每份设计一个 Vite dev server | **自定义协议直读 `dist/`** | 零进程、零端口、零 `npm ci` |
| 构建 | 常驻,是渲染前置依赖 | **批量,可失败,不阻塞渲染** | 构建挂了画布照常 |
| 截图 | 宿主提供 `ctx.capture.offscreen` | **Electron 内置离屏渲染** | 少一层插件宿主协议 |
| 状态 | 隐式(`mounted`/`raster`/`paintTick`) | **显式状态机 + 合法转移表** | 中间态不可能 |
| 几何 | `getBoundingClientRect` 分别测 | **单一相机纯函数派生** | 位图与活体不可能错位 |
| 清单对账 | 双向"最后写入者胜" | **单向:内容归文件,布局归清单** | 无对账中间态 |
| 尺寸兜底 | 有(多数派 → 品类 → 全局) | **照抄** | 已验证 |
| 遮挡 | 无(iframe 无此问题) | **三信号系统** | 已有且已测 |
| 风格库 | 远程清单(可能一套都没有) | **skill 内置 + 远程可选** | 新建设计不依赖网络 |
| 质检闭环 | 有 | **照抄 ppt profile 的闭环** | 仓库已验证 |

---

## 17. 实施的第一件事

**P0 只写纯函数,不碰 UI、不碰 Electron。** 具体是五个文件 + 五个测试文件:

```
apps/desktop/src/renderer/features/design/
  camera.ts             + test/design-camera.test.ts
  frame-surface.ts      + test/design-frame-surface.test.ts
  frame-machine.ts      + test/design-frame-machine.test.ts
  budgets.ts            + test/design-budgets.test.ts
apps/desktop/src/main/design/
  texture-lru.ts        + test/design-texture-lru.test.ts
```

这一层做完,**画布对不对就是可证明的**,后面全是接线。
