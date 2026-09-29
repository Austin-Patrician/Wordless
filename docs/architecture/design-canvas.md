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
| `design_style_list` | 风格库列表 | 只回 id + 名字 + 一句话,**不回正文**(正文几 KB,进上下文是纯浪费) |
| `design_style_apply` | 应用风格(写 `theme.css` + `DESIGN.md`,**应用前整包备份**) | 见 §11;与画布上那条"应用风格"入口共用同一个实现 |
| `design_export` | 导出 PNG / 静态站点 | |

**状态**:`design_create`(含 `styleId` 参数)/ `design_status` / `design_inspect` / `design_screenshot` /
`design_style_list` / `design_style_apply` 已实现;`design_frames` 与 `design_export` 还没有。
风格那两条的落地记在 §14.22。

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
| **P3** | `RasterPool` + Electron 离屏光栅化 + 缩放档位缓存 + 位置图缓存 + 批量光栅 + IPC(bridge 49→50) | ✅ **已完成**:池的并发/超时/去重/取消全部有测试并基线验证;163 条设计测试 + 6 条画布浏览器测试全绿。~~设备像素比仍按 1 倍~~ → **已由 §14.20 的 CDP `clip.scale` 补齐**(倍率确定、png/jpeg 可选) |
| **P4** | `DesignViewHost` + `liveFrameTarget` 纯判定 + 遮挡复用 + 共享几何提取 + IPC(bridge 50→51) | ✅ **已完成**:至多一个活体是**接口形状**表达的;活体矩形与位图矩形同源(有测试钉住);172 条设计测试全绿 |
| **P5** | `capabilities/design`:4 个工具(`design_create` / `design_status` / `design_inspect` / `design_screenshot`)+ 问题模型 + 布局探针 + 适配层 + 画像工具面 | ✅ **已完成**:23 条能力测试 + 13 条脚手架/状态测试全绿。`design_style_*` 与 `design_export` **刻意不声明**(见 §14.5) |
| **P6** | 侧栏「设计」入口 + 设计画廊(我的设计 + 内置风格墙)+ 令牌驱动的缩略图 + 按风格建包 + IPC(bridge 51→52) | ✅ **已完成**:内置风格的 `theme.css` + `DESIGN.md`(起初 4 套,后扩到 29 套,见 §14.16);22 条令牌/栅格测试全绿 |
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

**当时刻意没做的一件**:风格卡不挂真实渲染的 demo。参考实现是"静态只铺色板,悬停到哪张才换真
demo",而这里只做了前半步 —— 一份 demo 是一个 iframe 加一份完整文档,一屏几十张连排光解析
就能把滚动拖住。色板已经足以分辨"哪套更圆、更亮、更密"。

**这一条后来被推翻了**(§14.18):色板能分辨"更圆更亮更密",却答不了"这套长什么样",而那才是
用户选不选得出来的依据。推翻的前提是窗口化 —— 同一时刻只有可见的那几张卡挂着文档,而参考实现
的墙不窗口化(25 张全在 DOM 里),所以它只能悬停换。

**风格在建包时落盘**,不是事后追加:否则第一帧必然是按默认审美写的,之后要改的是所有帧。

### 14.8 「设计」入口默认落在「更多」里(P6)

我一度把它加进 `DEFAULT_PINNED_SIDEBAR_NAV_IDS`(想让它像 open-vetta 那样一眼可见),但代码里
有一条明确的约定:

> 加一个条目**永远不会**夺走用户自己选过的一行 —— 新条目落在「更多」里。

于是改回不固定。**要真正让它显眼,该改的是默认排列的取舍(把谁挤下去),而不是绕过这条约定** ——
那是产品决定,不该由我在加一个入口时顺手做掉。

### 14.9 目录放在主进程侧,而不是能力包(P6)

风格目录(当时 4 套 `theme.css` + `DESIGN.md`)一开始放在 `capabilities/design` 里,结果主进程的 store
要反向 import 能力实现,而能力包的 `index.ts` 用 NodeNext 的 `.js` 说明符 —— **`node --test`
加载不了它**,表现是 store 的测试整体起不来。

移到 `main/design/style-catalog.ts`。等 P7 的 `design_style_*` 工具也要用它时,它应当上移到一个
**双方都能加载的共享包**,而不是内联到某一侧。

### 14.10 新建设计为什么没有样式,以及最后怎么解决(P7)

这是 P7 期间查出来的、比 P7 本身更重要的事。

**现象:** 脚手架与当时那四套内置风格的 `theme.css` 写的是 Tailwind v4 的 `@theme { … }` 块,帧里用的
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

**已修**(§14.16 那次并入之后一轮)。改动落在四条写 `theme.css` / 读 `theme.css` 的路上,
少一条就会退回症状:

| 位置 | 改法 |
|---|---|
| 脚手架 `DEFAULT_THEME_CSS` | `@theme static {` |
| 本地 4 套内置风格(`style-catalog.ts`) | `@theme static {` |
| 上游 25 套(生成器 `sync-design-styles.mjs`) | 生成时转换 —— **只改生成物会被下次同步冲掉** |
| 缩略图解析器 `parseThemeTokens` | 块匹配 `@theme(?:\s+static)?\s*\{` |

解析器那条最值得写下来:认不出 `@theme static {` 时它会**静默退到"扫全文"**,缩略图照样画
得出来 —— 于是这个 bug 会一直藏着。所以测试断言的不是"解析出了值",而是**块外那句同名声明
不能赢**(`design-style-tokens.test.ts`),再加一条"29 套 + 脚手架都必须是 static"的约定。

按 CSS 工具类写法的设计本来就不受影响(用到的令牌一定会发出),所以这次只会**多**产出样式。
用真编译器量了一遍 29 套:候选只给 `bg-surface` 时,产物里的 color 变量从 **每套 1 个**
变成**每套声明的全部**(295 个,零缺失)。

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

### 14.14 「画布是快照,而 agent 一直在改磁盘」:一条刷新通道修三个症状

这一节是接着 §14.13 往下查的。§14.13 修掉了"agent 看不到像素",之后一次真实会话
(`f6f1471a`,profile `ui`,4 分 51 秒)给出了新的数字:

```
工具调用 22 次 | 硬失败 7 次(32%)
  design_status 6(3 次 path="x.wdesign")· read 6(3 次 ENOENT)
  design_create 4(建出 4 个包,零报错)· design_screenshot 2(两张逐字节相同,3680 B)

写进设计包里的帧:0        ← 两个 write 都落在了会话根,不是包内
dist/theme.css:不存在     ← 所以渲染出来的那一帧,一条样式都不生效
```

三件事同时成立,而它们看起来都像"设计做得不好":

#### 根因一:agent 那条路从来没构建过

`built` 模式下 `syncRenderRoot` **刻意跳过** `theme.css`(`design-store.ts:330`),于是
`dist/theme.css` 只可能由一次真实构建产出。而构建只在两个地方发起,全在画廊那条路上:

| 谁 | 传了 `builds` 吗 |
|---|---|
| 画廊 IPC(`handlers.ts` 的 `createDesign`) | 传了 |
| agent(`design-capability-port.ts` 的 `create`) | **没传** |

于是 `design_create` 建出来的包,`frames/index.html` 里的 `<link href="../theme.css">` 在
`dist/` 下**404**,Tailwind 的 preflight、令牌、工具类全部不存在 —— 一帧样式都不生效。
**同一个事实在两处各定了一次,而两处不一致**(§14.12 记的就是这个错误)。

#### 根因二:画布只认识"打开那一刻"的帧

`openDesign`(唯一会重读清单的调用)只在 `DesignWorkspace` 的两个 effect 里出现,而那个
轮询 effect 的条件是"**还没有**设计才轮询"。一旦有了设计它就永久停下,而 `opened` 之后
只有拖拽的乐观 patch 会更新 `x/y`。所以:

- agent 写出 `frames/detail.html` → **画布上永远不会多出这块画板**
- 一帧的内容改了 → **位图永远是旧的那张**

位图那条更隐蔽:`useDesignTextures` 用 `cache.has(key)` 判断"要不要光栅",而缓存键是
`frameId@bucket`、没有任何失效路径 —— 于是它**总是**"已经有了"。

#### 根因三:没有让画布知道"磁盘变了"的通道

渲染层里没有任何设计相关的推送或监听。工具改了磁盘,画布不知道。

#### 修法:一条通道,一个事实

**源指纹**(`DesignStore.sourceFingerprint`)—— `theme.css` 与 `frames/` 下每个 `.html` 的
内容,加上其余可渲染文件的路径。它同时回答两个问题("位图还要不要"和"样式还要不要重编"),
因为它们本来就是同一个问题。

`refreshDesign({ designPath, builds })` 在指纹变了的时候做三件事:对账(新帧出现)、同步
`dist/`(内容刷新)、必要时重编样式(工具类存在)。指纹没变就走快路径 —— **两次读、不起任何
进程**,因为那是每秒都会走的那条。三道闸各管一件事:

1. **快路径**:指纹与记录一致 → 什么都不做
2. **单飞**:同一份设计同时只允许一次刷新(构建是子进程)
3. **最短间隔 1.2s**:agent 连续写文件时,每一次轮询都会看到新指纹

**指纹无论构建成败都记下来。** 记失败不是为了掩盖它(原因写进 `.build/status.json`,
`design_status` 读得到),是为了不要每秒重试一个坏构建 —— 那会得到一个永远在起子进程、
又永远失败的循环,比一次可见的失败糟得多。

画布侧在**运行中**每秒问一次;`revision` 进 `useDesignTextures` 的判定(每个缓存键记住
自己是从哪一代源光栅出来的),变了就重新光栅。旧位图**不撤** —— 它顶到新位图到货为止。

#### 三处必须记下来的细节

**① 刷新的清单不接管布局。** 内容归帧文件,布局归清单、而用户是在画布上拖的。刷新只做
两件事:新帧按磁盘落点加进来,删掉的帧消失;**已经在画布上的帧保留它当前的 `x`/`y`**。
直接用磁盘值覆盖会在用户正拖着帧的时候把它抢回去 —— 而这不是理论竞态:拖一次要几秒,
心跳是 1 秒。判定抽成了 `mergeRefreshedManifest`(纯函数),因为这里错了**看不出来**。

**② `refreshDesign` 的 `applied: false` 不是失败。** 它有两个来源(源没变 / 被限流),
而画布需要知道"该不该拿这个 `opened` 覆盖自己"。让 `opened` 恒为 null 再让调用方去猜,
是这类接口最容易写错的地方(§14.2 同一个形状)。调用方在拿不到 `opened` 时退回
`openDesign` 直接读。

**③ 打开设计走 `refreshDesign` 而不是 `openDesign`。** 一份从来没构建过的设计(构建失败过、
或这个机制之前建的包),打开时顺手把样式补上,比让用户先看到一版没有样式的画布要好。

#### 顺带修掉的:活体态丢位图

`DesignFrameNode` 把 `surface.kind === "live"` 落进了 `else`,于是**丢弃了 `textureKey`** ——
而 `frame-surface.ts` 的契约白纸黑字写着"原生视图接管,**位图留作底**"。选中一帧(zoom ≥ 0.75)
会让内容变成一句 `390 × 844`,而原生视图在 attach 之前、被遮挡时、加载失败时都不在。
§15 风险 6 说的就是这个,实现和文档不一致。

#### 仍未做

- **每帧的光栅失败原因仍然接到节点上是写死的 `failure: null`**(§14.13 的缺口,同上)。
  现在它被"样式表状态"部分覆盖了:没有样式会**说出来**,而截图不会再无声地给出白页。
- **design_create 的路径语义**(`path` 在 `design_*` 与 `read/write` 上是两个基准、
  返回文案给了绝对路径却让人"Read theme.css"、systemPrompt 里的 `x.wdesign/` 被当成真路径、
  重名静默改后缀建出 4 个包)—— 那是下一批,它与本次的三条根因互相独立。
- **活体上限仍然是 1**,`design-view-host.ts` 的接口形状仍然没有 id。

#### 这一轮立的基线

每条断言都验过"打掉对应实现就失败":

| 打掉什么 | 失败的是 |
|---|---|
| 快路径 | 源没变时刷新走快路径 |
| 刷新时构建 | 4 条(快路径 + 样式表 + 构建失败 + 单飞) |
| 最短间隔 | 5 条 |
| 单飞 | 单飞那一条 |
| 指纹不吃帧内容 | 3 条 |
| 位图只按"缓存里有没有"判 | 源指纹变了就重新光栅 |
| 刷新直接接管布局 | 2 条(布局归属) |
| 心跳不做(只找设计,不同步) | 不重复列举设计 |
| 心跳做但不问当前设计 | refreshDesign 被反复调用 |

---

### 14.15 「画布像草稿」:缺的不是渲染,是**编辑器**

用户的说法是"感觉比较草稿一点"。查了一遍feature 清单,它是准确的:

| | open-vetta | 本方案 |
|---|---|---|
| 画布目录下的文件 | **41** | 20 |
| 其中属于**编辑器**的 | **约 25**(`ControlBar` / `ArrangeToolbar` / `FrameContextMenu` / `FrameTitleInput` / `GapHandles` / `SnapGuides` / `NotesLayer` / `ThemePalette` / `SelectionAskBadge` / `CanvasCornerActions` / `ColumnsPopover` …) | **0** |

我们那 20 个里,17 个是渲染与管线(相机、光栅、位图缓存、状态机、协议、活动态),
另外 3 个是画廊。**能看,但不能改。**

#### 为什么一路走到这里

回头数一下这几轮:光栅池 → 活体宿主 → 样式编译 → 刷新通道 → 工具工效学 → 活动态。
每一轮都在同一个方向上:**让"看得见"这件事成立**。而那些都是前提,不是产品 ——
一份设计能不能**被改**,从来没有人做过。

这不是方向错(§2 的架构论证仍然成立:零进程、零端口、正确性来自单一相机),
是**层次错**:一直在做 substrate,没做 editor。

#### 这一轮补的第一块:声明写回

画布上"能编辑"与"只能看"的分界线,是能不能改**帧的标题与尺寸** —— 而标题是画布上唯一
的标签。这件事的难点不在 UI,在于它落在哪儿:

| 谁拥有什么 | 存在哪 | 走哪条路 |
|---|---|---|
| 画布上的位置 | `design.json` | `moveFrames`(拖拽) |
| **标题、声明尺寸** | **帧文件里的 `@frame` 注释** | **`updateFrameMeta`** |

所以"重命名一帧"和"把它拖大一点"写的是**两个不同的地方**。这不是实现细节,是 §6.1 那条
归属规则的直接后果;写成两条 IPC(`moveDesignFrames` / `updateDesignFrameMeta`)而不是
合并成一次"更新帧",是因为接口分得开,调用方就不可能把两件事当成一件。

`withFrameMeta`(由 `withFrameTitle` 泛化而来)是它唯一的写入者,三条纪律都在:
补丁里没给的字段保持原值、`-->` 仍然转义(§14.6)、**找不到声明时返回 null 而不是塞一行**
(往猜出来的位置插注释会写坏文件,而漏声明的帧本来就会从 issues 报出来)。

画布这一侧落成两个动作:**双击标题就地改名**、**单选时拖四角改尺寸**。
缩放在活体态下不给 —— 原生视图不能被 CSS 缩放,它的矩形由相机派生,拖它的边只会让画面
与手柄错位(与 `live-frame.ts` 同一条理由)。

#### 顺带的一处界面决定:左栏让位

设计会话打开时把左侧栏收起来,由 `resolveSessionOpenTarget` 决定(那一张表本来就是
"进入一个会话时界面该是什么形状")。是**一次性动作**,不是持续约束 —— 用户展开就展开,
不会被抢回去,与 §14.11 同一条纪律。**只有**画布工作台收左栏:对普通会话,那是一种打扰。

#### 还缺的(按对"像不像一个工具"的影响排)

1. **帧动作**:删除 / 复制 / 右键菜单(`FrameContextMenu`)。需要 `deleteFrame` 与
   `createFrame` 两条新 IPC。草稿没法清理,这一条最刺眼。
2. **对齐与分布**(`ArrangeToolbar` / `arrange.ts`):**不需要新 IPC** —— 只写清单里的
   x/y,与拖拽同一条路。性价比最高的一条。
3. **吸附参考线**(`SnapGuides` / `snap.ts`):纯画布侧,rAF 合并 + 身份保持更新(§9.6)。
4. **帧内 bridge**(`engine/src/bridge.ts`,参考实现 643 行):hover 高亮、Figma 式下钻
   选择、源码定位,再接进对话引用 —— 也就是"选中后修改"。**这是它的招牌能力**,
   也是最后一块,值得自己的一轮。

---

### 14.16 内置风格从 4 套扩到 29 套(P7 之后)

4 套自撰风格的直觉是"给一套方向就够了",但**风格墙的作用是让用户看见全貌**:一屏不到
一张卡的时候,它只是装饰。参考实现的答案是把货架铺满(它自己 25 套),于是这里按同一
取舍把上游那批改编并入 —— 4 自撰 + 25 上游。

#### 货从哪来:改编并入,不接远端清单

上游是 open-vetta 的 `vetta-design-templates`(清单 `.vetta/design-templates.json`,
25 套 `kind: "design-system"`,`catalogVersion 2026.08.31-4`),正文改编自
`awesome-design-md`(MIT)。**并入而不是运行时拉取**,是 §12.3 第 1 条的延续:新建设计
不该依赖网络,而"一套都没有"是一个不该存在的状态。

因此它按**受审查的依赖更新**处理,与 OfficeCLI / pi 那两条一样:

```
apps/desktop/scripts/sync-design-styles.mjs   ← 生成器(npm run sync:design-styles)
  → src/main/design/style-catalog-upstream.ts ← 生成的快照(头注释记 catalogVersion 与 sha256)
THIRD_PARTY_NOTICES.md + resources/third-party-notices/  ← 署名
```

#### 只取 spec 与 theme,不取 demo

上游每套带三份:`theme.css`、`DESIGN.md`、`demo.html`(整页成品,20–30KB)。**不取 demo**:
我们的缩略图本来就是用 `theme.css` 的令牌现画的(§14.7 那个取舍),而清单 794KB 里绝大
部分正是这些 demo —— 取了它,货架变长的代价就从"多几 KB 文本"变成"多几百 KB 下载"。

代价是 `DESIGN.md` 里那句"…ships alongside this spec as `demo.html`"会指向一个不存在
的文件,**而 agent 会照着去读**。所以生成器删掉指向 demo 的句子(整段都在讲它时整段删),
H1 也去掉 `— Vetta Edition` 后缀 —— 这份 DESIGN.md 会被拷进用户的设计包,那不是版本名。
`design-style-tokens.test.ts` 里有一条守着"别再溜回来"。

#### 分类与文案:key 归目录,文案归 i18n

29 套之后有两处必须改形状:

- **`category` 从展示串改成 key**(`产品界面` → `product`)。分类是用户扫视的入口,
  而"某个语言下显示成什么"不是目录能决定的事。
- **`name` / `tagline` 降级为兜底值**。展示那份按当前语言从 i18n 取
  (`features/design/style-copy.ts`),查不到才回落到目录里那份 —— 与 `WORKBENCH_LABEL_KEYS`
  同一取舍。**没有做"远端文案兜底"那一套**(humanize、查不到就显示 key):文案是我们自己
  写的,`onboarding-copy.test.ts` 已经在守键集合与空串,足够。

目录(主进程)与文案表(渲染层)刻意不互相 import —— 卡片能不能画不该依赖目录里有什么。
代价是没有编译期把两侧焊在一起,于是焊接点放在测试里:`design-style-copy.test.ts` 断言
**每一套风格、每一个分类都能查到 key,两个 locale 都非空,且没有两套共用同一个 key**。
加一套只写目录、忘了写文案,那一条会红。

#### 同一个坑的两笔账

漏了这一步的代价很容易低估:**目录里加一套是 3KB 文本,漏掉文案是一屏中文**。而这次并入也让
§14.10 ② 那个待办(`@theme` → `@theme static`)从"要动 4 套"变成"要动 29 套" —— 它已经是一个
会在画布上显形的缺陷(帧里手写 `var()` 静默取不到值),所以紧接着就修掉了,见 §14.10 ②。

---

### 14.17 29 套之后:不做分类筛选(试过,退回了)

§14.7 那三条照搬的取舍(铺开、不做下拉框、令牌画缩略图)在 4 套时是对的,29 套之后要重看的是
**墙有多长**:1100px 容器里 3 列 = 10 行 ≈ 2700px,画布里的体系对话框更窄,29 套排得下但很长。

我按"找得到"这件事设计了一版**分类胶囊**(15 个分类 + 计数,筛选后计数变「2 / 29」),实装了、
测试也绿了,然后**退了回来**。理由值得留在文档里,否则三个月后会有人再加一遍:

- **风格墙是视觉选择器,缩略图本身就是索引。** 哪套更圆、更亮、更密,看卡片一眼可辨;分类解决
  的是"Anthropic 属于哪一类"这种用户基本不会问的问题。
- **29 个是"铺开看得完"的数量级。** 三四屏的宫格,一口气扫过去就是全部;胶囊换来的是 16 个按钮
  和一层新状态,却把"扫"变成"先选一个盒子再扫"。
- **参考实现正是这么做的**:它 25 套,**没有分类筛选、没有风格搜索**,靠墙 + 详情页 + 计数。
- 我自己在 §14.7 里就写过"参考实现到这个量级也没有筛选,想要筛选/分组的话是独立一轮",设计时
  却还是加了 —— 这条记下来,是为了下次先问"这个量级需要吗",而不是先问"怎么做得好看"。

**分组也一样不做**,而且它的理由独立于这次撤回:分组要往网格里插节标题,而 `style-grid.ts` 那套
"列数 × 行高 → 可见窗口 → 上下留白"成立的前提正是**每行等宽等高**。插了节标题,窗口算术、留白、
行数全要带节头重算 —— 那一层之所以值钱,恰恰因为它被抽成纯函数、可证明。

#### 留下的三件(都不是筛选)

| 留下 | 为什么 |
|---|---|
| 标题上的计数胶囊(「29 套」) | 先让用户知道货架有多大,否则他以为墙上就这些 —— 这是"看得完"的前提 |
| 体系对话框 560→720px、2 列→auto-fill(200px) | 29 套在 2 列下是 15 行、一屏 4 张;参考实现的模板 Dialog 也是 768px + auto-fill |
| 渲染窗口收进纯函数 `styleGridRenderWindow` | 组件里原来那两行 clamp 不是行对齐的,越界时会切出半行/空的一位。现在它是算术,有测试 |

计数那条与参考实现的「Hero 统计条」是同一件事,只是位置更贴近它管的东西。

#### 顺带记两个坑

**① 断言用真词典,不用 key。** 新加的 `design-library.browser.test.tsx` 走真的 zh-CN 消息表,断的是
用户看到的那句话(「5 套」「用「OpenAI」新建设计」)。目录里的 `name` / `tagline` 只是**兜底值**
—— i18n 有译文时以译文为准,夹具里写什么标语都不影响卡片。另外卡片不该按 `aria-label` 找:它是
模板拼出来的,同一张卡筛选前后一模一样,不具备标识性。

**② 这个视图的 `useRuntimeClient()` 必须是稳定引用。** 它当 `reload` 的依赖,而 `reload` 又是
"进入即扫描"effect 的依赖 —— 每次渲染换一个新对象就是无限重渲染(实测 300ms 内 346 次,`act`
永不收敛)。这条是我写测试 mock 时踩的(真实实现在 context 里是稳的,所以没暴露过),记在这里
免得下一个人以为是组件坏了。

#### 还留着的(没做)

详情对话框(大缩略图 + 色板 + 规范目录 + 出处署名,`DESIGN.md` 要一条按需 IPC)、画布对话框里的
「当前」徽标(`manifest.style` 现成、零协议改动)。**筛选与搜索一起撤回**:真到几十上百套(比如
哪天接了远端清单)再回来谈,那时该先分层还是别的,重新设计。

---

### 14.18 让"这套长什么样"可见:示例页、详情、色彩系统

§14.17 把"找得到"收在"铺开"上,剩下的是另一半 —— **看得懂**。三个诉求(每套要有示例、点开要有
详情、要有色彩系统)都指向同一件事:一张卡答不了"选哪套"。

#### 示例页进了包(推翻 §14.16 那个"不取 demo")

当时不取的理由是"清单 794KB 里绝大部分是 demo,而缩略图用令牌现画"。现在取,是因为**缩略图与
示例回答的不是同一个问题**:缩略图是同一张界面换令牌,能分辨"更圆、更亮、更密";示例才说明这套
长什么样。而取它的代价比想象中小:

- 实测 25 份**自包含**:0 个 `<script>`、0 个外链、0 个字体、0 个 iframe,令牌以 `:root` 内联在
  同一份文件里。**渲染不需要网络**,所以不破"新建设计不依赖网络"那条。
- 单片 19–46KB,合计 **596KB**;主进程包 +665KB(3.998MB → 4.663MB)。它是随包发布的,不是下载。
- 换来的是一件事:**没有上游示例的 4 套自撰风格,示例页由我手写**(`style-catalog-demos.ts`)。

三道检查在 `scripts/sync-design-styles.mjs`(无脚本/无外链/无相对 `url()`,单片的体积上限,以及
**示例的令牌与 `theme.css` 逐值一致**),catalog 侧还有一条 `design-style-demo.test.ts` 守同一组
约定 —— 生成器管"这次同步进来的对不对",测试管"进包的这份对不对",因为手写那 4 套没有生成器兜着。

那条"令牌镜像"的检查最值得留:`demo` 里内联了一份 `:root` 拷贝,而同一套色有两份拷贝就有漂开的
一天 —— 症状是"示例长这样、写进你设计里的却是另一套",正好是这张卡要回答的问题被答错。

#### 卡片默认就显示示例(与参考实现不同)

参考实现是"默认铺色板,悬停到哪张才换真 demo"——**它不窗口化**,25 张全在 DOM 里,所以全挂文档
会把滚动拖住。我们的墙是窗口化的(§14.17),同一时刻只有可见的那几张卡真的挂 iframe,于是可以
默认就显示。

代价与我没能验证的部分:滚动时换一窗 = 换几张文档,解析开销随行数走。这一条**我建议上手看一眼**
——如果没有肉眼可见的掉帧,它就这么定了;若掉帧,回退是一行(把 `demoHtml` 的取值改回悬停时才有),
不必动数据层。

#### 详情页:三块内容,各自不新造真相

| 内容 | 来源 | 为什么 |
|---|---|---|
| 示例 | `demoHtml`,常开自动滚动 | 详情是唯一值得让示例"活着"的地方(卡片上不滚,一屏几张同时动只会眼花) |
| 色板 | 解析这套自己的 `themeCss` | 早就在列表 DTO 里(卡片画缩略图用的就是它),**不另存颜色表** |
| 规范目录 | `DESIGN.md` 的 `## ` 标题 | 只列目录不贴全文:规范是给 agent 读的,用户要知道的是"这套有没有把间距、层级、组件讲清楚" |

色板上的名字用 **token 名**(`primary` / `surface-raised`),不翻译:那是写进 `theme.css` 的标识符,
用户与 agent 都用它对话,译成"主色"反而与文件对不上。

#### 色彩系统面板:挂整份 `theme.css`,不挂单个 token

画布工具栏新增一个面板,列出**当前这份设计**的令牌。两处与参考实现不同,都有理由:

- **读磁盘上的 `theme.css`,不读目录里的模板。** 应用一套风格只是把令牌拷进设计包,之后 agent
  会继续改它 —— "这份设计现在用什么色"的答案只在文件里。走**既有的**
  `readSessionWorkspaceTextFile` 通道,没新开 IPC;重读的时机是"画布每从磁盘重读一次"(计数器),
  而不是某个具体操作。
- **动作挂在面板上(挂整份 `theme.css`),不挂在每个色块上。** 参考实现点色块挂**那个 token**;
  我们的引用类型只有"文件/目录"(`frame-reference.ts` 那条约定),给每个色块挂同一份文件会看起来
  像"挂了那个 token"而其实不是。**这一条后来改了** —— 引用类型扩出令牌这一种,见 §14.19。

#### 传输:摘要里只留一个事实

列表 DTO 加的是 `hasDemo`,不是正文 —— 一份示例 20–30KB、一份规范 2–6KB,而列表每次进页都要拉。
正文由新的 `styleDetail({ id })` 按 id 现取,渲染层按 id 缓存(悬停一次、再点开详情不该拉两次)。
桥版本 52 → 53。不认识的 id 返回 `null` 而不是抛:目录会随版本变化,一条过期的引用不该把详情页
变成一次报错。

---

#### 测试里踩到的一个坑

`design-library.browser.test.tsx` **单跑绿、整文件红**,差别是浏览器窗口的滚动位置跨用例保留:
前面某个用例打开名字对话框(`autoFocus` 输入框)把页面滚了下去,下一个用例一上来墙渲染的就是**末尾
那几张卡**,而断言在找开头那张。修法是每个用例前 `window.scrollTo(0, 0)` —— 窗口化的组件写浏览器
测试时,滚动位置也是状态的一部分。

### 14.19 色彩系统面板:选中之后到底发生什么

§14.18 那个面板当时只能"点一下挂整份 `theme.css`",读完参考实现之后发现那**丢掉了这个面板唯一
能替用户说的事**:用户看到一块颜色,他说不出 `--color-primary` 这个名字;而"指的是哪一个令牌"正是
面板该说的。文件那一半还是重复的 —— 设计画像早就告诉过模型"令牌都在 `theme.css`"。

#### 参考实现怎么做的(事实)

它点一个色块就 `ui.setPromptAttachment(...)` 挂一个附件,附件里带一段 `instructions`:

```
The user selected the design color token --color-primary from the shared theme.
Theme file: <dir>/theme.css (Tailwind v4 @theme block; all frames share it).
If asked to change it, edit the token value there — every frame updates via hot reload.
```

三点值得抄:**挂的是上下文不是标记**(那段话随消息送给模型)、**面板不写文件**(改令牌是 agent
的事)、**`setPromptAttachment` 是复数形式里的单数**(一次一个,发送后清掉)。

#### 我们的做法:多选 + 挂令牌

- **挂的是令牌不是文件**:新增 `theme-token-reference`(`{path, name, value}`,`name` 是完整变量名)。
- **多选**:我们挂附件那条通道本来就是列表、逐个可删,而"`primary` 和 `accent` 都调暗"是真实
  诉求。参考实现受限于单数接口。
- **再点一次取消**:选中态的真源是**输入框里那些 chip**,面板只读它 —— 用户在输入框里删掉一个
  chip,面板上的选中环必须跟着灭。为此给输入框补了一条**摘除**通道(与既有的插入通道对称):
  少了它,面板上的"取消"只能是个空操作。

#### 一种引用类型要落三层(这轮最大的坑)

| 层 | 干什么 | 漏了会怎样 |
|---|---|---|
| 送出去 | `formatPromptWithSkillReferences` 编码成 `<wordless-theme-token-reference>%7B…` | —— |
| **模型读到的** | `formatPromptThemeTokenReferencesForModel` 改写成一段人话 | **`%7B%22…` 原样进模型上下文** |
| 存回来的 | `projectPromptThemeTokenReferences` 投影回消息块 | 会话重开时消息里是那串编码文本 |

第二层是这次差点漏掉的:工作区引用早就有对应的 `…ForModel`,而令牌这种新类型没有 —— 少了它不会
报错、不会崩,只是模型读到一串 URL 编码。**新增引用类型时,先数一数现有类型各有几层。**

顺带一处分层取舍:解释"用户选了这个令牌、改它就能改全部画框"的那句话**没写进序列化器**(那是所有
driver 共用的通用层,把某一种产物的规矩塞进去会让人以为它对谁都成立),而是放在**设计画像**的提示
里 —— 它才是拥有设计词汇的那一层。

#### 新增一种引用类型,一共要过**五**道门(外加三处"手写清单")

这一轮的两次翻车都出在"漏了一处",而且都不报错、不崩,只是静默少东西。记下来当清单用:

1. **送出去**:`formatPromptWithSkillReferences` 里的一个分支 —— 漏了模型收不到这个引用。
2. **模型读到的**:`formatPromptThemeTokenReferencesForModel` —— 漏了模型读到 `%7B%22…`(见上表)。
3. **存回来的**:`projectPromptThemeTokenReferences` —— 漏了重开会话时消息里是那串编码文本。
4. **Lexical 节点注册**:类写好了还必须进 `initialConfig.nodes` —— 漏了是运行时一句
   *"Attempted to create node ThemeTokenNode that was not configured to be used on the editor"*,
   `tsc` 一个字都不说。
5. **输入框里那两个 part → 节点 的开关**:`$nodesFromPromptParts`(插入)与 `$setRootFromParts`
   (整体重设) —— 漏一处就是"某一个入口少一个 chip"(实测:重开会话时令牌 chip 直接不见了)。

**另一类同样的坑:凡是"按类型数一遍"的地方,都要改。** 这一轮实际踩到三处,症状各不相同但根因
一样 —— 手写一份类型清单,新增类型时漏一处:

| 位置 | 症状 |
|---|---|
| `OnChangePlugin` 的 `hasContent`(数 `text` / `skillIds` / `workspaceReferenceCount`) | 只挂一个令牌时输入框仍算"空",占位语**压在 chip 上** |
| `normalizeUserPromptParts` | 令牌 part 没有 `text` 字段,会被当空文本丢掉 |
| `ThreadView` 的用户气泡 block 过滤 | 旧会话里的令牌引用**看不见了**(消息是存下来的) |

三处都改成了结构性写法,不再依赖"记得补一笔":前两处按 **part**(不是类型清单)判断,第三处用
`switch` + `never` 逐个类型表态。后者本来想写成一行 `.filter((b) => b.type !== "attachment")`,
被 `tsc` 拦下了 —— 那样会把**助手独有**的推理/工具块也放进用户气泡。类型系统这次帮了忙。

第 4、5 条现在都有测试兜着(`composer-attachments.browser.test.tsx`,五条用例覆盖插入 / 文件引用 /
摘除 / 草稿重设 / 误摘):**它是先红了才修好的** —— 去掉节点注册,3 条用例会带着上面那句原文失败。
第 5 条顺带做成了结构性的:两个开关改走同一个 `$createAttachmentChipNode`,里面用 `never` 做穷尽
检查,于是再新增 part 类型是**编译错误**,而不是某一个入口悄悄少一个 chip。

#### 边界(没做)

- **不做高亮**:选中后在画布上标出"用到这个令牌的帧"。帧是独立 `WebContentsView`,要高亮得逐帧
  注入 CSS,成本与收益不成比例,参考实现也没有。
- **不做颜色编辑**:面板只读、只交给对话。改令牌永远是 agent 的事(§12.3)。

### 14.20 导出渲染图(P8):把几张帧合成一张图

参考实现是 open-vetta 的 `mockup/ExportMockupDialog`(19 个文件、约 2200 行)。它不是
"把帧存下来" —— 那是我们已有的 `wordless:design:export`(把每帧原尺寸渲染图 + 规范/素材
写到用户选的目录)。它是**合成一张带设备外壳的分享图**:

```
圆角(默认 = 最高帧高 × 0.05)  ·  外壳厚度(默认 12,画在截图外面)
外壳色 / 背景色 / 透明底 / 阴影 / 水印 / 1x|2x / 每页 1..4 帧
→ 一页一行、按最高帧归一化(永不缩小)→ 超 8000px 让步 → 长图 / PDF / 复制
```

**水印文字改成我们自己的**(`Wordless` / `Designed with Wordless`)。照抄会让别人的品牌印在
我们用户的图上。

#### 决定性的实验:2x 到底能不能诚实交付

参考实现里 `scale: 1 | 2` 是有的,而我们的光栅注释写着"设备像素比尚未生效 …… 留一个做不到
的参数,比没有它更糟"。三件事实测下来:

| 路径 | 390×844 的页面得到 | 能否指定倍率 |
|---|---|---|
| 离屏 `paint` 位图 | 390×844 | ❌ 与 DPR 无关,永远 1 倍 |
| `webContents.capturePage()` | 780×1688 | ❌ 跟着**显示器**走(Retina 就是 2 倍) |
| CDP `Page.captureScreenshot` + `clip.scale` | 1→390×844 · 2→780×1688 · 3→1170×2532 | ✅ **确定性** |

`clip.scale` 的字节数随像素数增长(6KB→15KB→28KB)= **真的重新光栅,不是放大**。
另外证实:CDP 的 `Emulation.setDeviceMetricsOverride` **不改布局**(`innerWidth` 始终 390)——
那条"未验证的路径"是成立的,但导出其实不需要它,`clip.scale` 更直接。

**所以 2x 可以诚实交付**,而且现有导出代码里"没有倍率参数"的注释已经过时(那是基于
"离屏 paint 拿不到 DPR"得出的,而导出本来就不该走 paint)。

#### 第 ① 步:纯核心(已完成)

```
mockup-types.ts     选项与几何的形状
mockup-options.ts   默认值 / 逐字段校验 / localStorage(按设计文档为键)
mockup-layout.ts    合成几何(预览与导出共用这一份)
mockup-render.ts    canvas 绘制(预览与导出共用同一个渲染器)
mockup-attach.ts    已加入列表(rail 是它的补集)
mockup-paginate.ts  分页
mockup-view.ts      多页堆叠几何(平移/缩放共用画布相机)
mockup-pdf.ts       手写 PDF(每页一张 JPEG,DCTDecode 原样嵌入)
```

**两条从参考实现学来的、值得单独记下的做法:**

1. **设置存 localStorage、按设计文档为键,不进 `design.json`。** 导出设置是**本机习惯**,
   不是设计内容 —— `design.json` 是画布拥有、agent 读的文件,把"上次圆角调到 24"写进去,
   agent 会把它当设计意图读。
2. **`normalizeOptions` 逐字段回退,不整体校验。** 整体校验(少一个字段就整份丢弃)在**加
   字段**时会静默清空用户的全部偏好 —— `perPage` 就是后来加的那个字段。

#### 发现的一个真缺陷(参考实现里也有)

```js
const size = Math.max(1, Math.floor(perPage));   // perPage = NaN 时 size = NaN
```

`Math.max(1, NaN)` 是 `NaN`,于是分页循环一次就退出、返回**一个空页** —— 所有画框被静默
丢掉,界面上没有任何提示。**夹紧在 NaN 面前一点用都没有**,所以先验有限性再夹紧。

#### 一条测试教训

基线验证时,"按最高帧归一化"那条测试**没有失败**:我把高的那帧放在了第一位,于是
`shots[0].cssHeight` 恰好等于最高值,两种实现都能过。把矮帧挪到前面,它才真的能分辨。
**测试写完之后必须用基线证明它抓得住** —— 否则它只是一段看起来很像测试的注释。

#### 第 ② 步:光栅改走 CDP(已完成)

这一步同时解掉三件事:**导出图能是真 2 倍**、**画布纹理在 2 倍档位下真的贴 2 倍图**(P3 留下的
"设备像素比仍按 1 倍"缺口),以及**取图不再依赖出帧状态机**。

改的是一处:`ElectronOffscreenRaster.capture`。窗口仍然用 `webPreferences.offscreen`,但取图
从 `paint` 事件换成 CDP 的 `Page.captureScreenshot`:

- **倍率走 `clip.scale`**,`RasterRequest.pixelRatio` 因此第一次真的生效 —— 而它就是渲染层
  一直在传的**缩放档位**(`frameId@bucket`,值域 0.25/0.5/1/2)。
- **窗口尺寸仍是帧的声明尺寸,不乘倍率。** 倍数只能来自 `clip.scale`:改窗口尺寸会让页面按
  新视口**重排**(`handlers.ts` 里踩过,注释还在)。
- **编码格式由 CDP 决定**:导出要 PNG(无损)、画布要 JPEG(小)。原来那个
  `encodeRasterImage(NativeImage, …)` 随之删掉 —— 没有 `NativeImage` 之后它就没有意义了,
  判断改由 `rasterCaptureParams` 承载(仍然是纯函数、仍然有测试守着)。
- **位图尺寸读回来**,不靠 `width × scale` 算(`imagePixelSize`):算出来的值一旦与编码器差
  一个像素,画布上就会半像素错位。
- `paint` / `startPainting` / `stopPainting` / `waitForPaint` 全部删除。**停帧那套状态机整个
  不需要了** —— 而它正是 §14.13 那个"空位图 → 画布整片占位卡"的根源。

**实测(真 Electron、真的两个 helper):**

```
jpeg scale=1    6689 字节  → 390x844   ✓
jpeg scale=2   18378 字节  → 780x1688  ✓
png  scale=1    7777 字节  → 390x844   ✓
```

**基线**:把 `pixelRatio` 忽略掉(改之前的行为)→ 参数测试立刻失败;把导出也当 JPEG、
JPEG 段长度语义写反、认不出就猜一个 1×1 → 各自精确打掉对应测试。

**一条测试教训(第二次被基线抓到)**:APPn 段那条测试最初**抓不住**长度语义写反 —— 少跳
2 字节之后,解析器的"逐字节前行"恰好又能走到真的 SOF。改成在载荷里**埋一个假 SOF**,让
"读歪了"表现为一个**错误尺寸**而不是 null,它才真的能分辨。

#### 第 ③ 步:平台胶水(已完成)

合成发生在**渲染层**(canvas 在那儿),所以这一步要解决的是"把一张几 MB 的图交给宿主"——
保存到文件、放进剪贴板。两个能力,两个端口:

- **`DesignExporter.chooseSaveFile`** —— 保存对话框(原来只有选**目录**)。与 `chooseDirectory`
  分成两个方法而不是一个带选项的方法:它们弹的是两种不同的系统对话框、失败语义也不同。
- **`DesignClipboard.writeImage`** —— 单独成端口,因为它**不属于"导出到某处"**:
  `DesignExporter` 的契约明写着"三个方法都是往用户选的目录里写,没有读",把剪贴板塞进去会把
  那句话变成谎话。

**字节的校验放在边界上,而且不逐字节走。** 标量走 schema,**字节作为独立的 IPC 实参**由
`isDesignImageBytes` 以 O(1) 校验(`instanceof` + 64MB 上限)。把它塞进 `Type.Object` 只有两种
结局:要么让 schema 声称校验了一个它不会去 walk 的字段,要么真的逐字节走一遍 —— 后者是白花
成本。这与 `DesignRasterResultDto` 刻意没有 schema 是同一条理由,只是方向相反(那边是
主进程 → 渲染层,这边是渲染层 → 主进程,所以这边必须查)。

**取消不是错误**:`{ ok: false, reason: "cancelled" }`,界面不该为此报红 —— 与既有导出同一条
语义。写盘失败则**带上原因**(`EACCES: permission denied`),而不是一句笼统的 failed。

**基线**:取消也报成功、写盘失败吞掉原因、字节守卫不设上限 → 各自精确打掉对应测试。
`desktop-bridge-contract.test.ts` 自动覆盖了新加的两个方法(它断言桥上的方法 preload 必须都
实现)—— 所以这一步的接线不是"靠 tsc 碰巧通过"。

#### 第 ④ 步:弹窗(已完成)

```
mockup-export-dialog.tsx   状态、抓图、分页、三条动作、闸门
mockup-stage.tsx           预览台:把每页的合成结果画成 canvas
mockup-options-panel.tsx   浮在预览区上的设置卡
mockup-frame-rail.tsx      左栏:还没进渲染区的画框
mockup-color-picker.tsx    色板 / 系统取色器 / hex
```

**预览不是"另一个渲染器",而是导出那一个。** 预览台的每个 `<canvas>` 就是
`renderMockupToCanvas` 的结果画在 1 倍上 —— 所以"预览看起来什么样,导出就是什么样"这条纪律
在代码上**是同一次函数调用**,而不是两处长得像的绘制。几何同样来自同一份 `layoutMockup`
(`fit` 只影响导出的倍率,不影响版面尺寸)。

**抓图倍率与格子像素必须同源。** 抓图用 `bucket = options.scale`:布局把每一帧归一到 CSS
高度,而画进那一页的位图要在 `scale` 倍下逐像素对上 —— 抓 1 倍再放大就糊,抓 2 倍而按 1 倍
画就丢一半细节。这正是第 ② 步换来 2x 的用处所在。

**入口放在设计名那一行**,不是工具栏那组"把结果拿出来"。工具栏那两个(导出渲染图 / 下载
素材)把每帧的**原尺寸渲染图**写进一个文件夹,交付给设计师接着改;这个把选中的几帧**合成
一张带设备外壳的分享图**。是两件事,所以是两个入口。

**实现中抓到的两个真 bug(各有测试守着):**

1. **失败反而解锁导出。** 我把"失败"从 `pending` 里排掉,于是闸门变成 `!pending` ——
   而失败的帧导出的正好是那块灰色占位。闸门改成"**每一帧都有位图**";失败与还在抓都挡住,
   区别只在状态行怎么说。
2. **切倍率不重新抓图。** 抓到的位图一开始只按 `frameId` 存,于是切到 2x 之后合成用的还是
   那张 1x 被放大的图 —— 而这正是这个功能最不该出错的地方。位图改成按倍率分键,并在替换时
   `close()` 掉上一张(一个 `ImageBitmap` 是一块真实的解码内存)。

**与其他实现的一处有意偏差**:参考实现把预览台接进了画布那套平移/缩放手势;这里用
`overflow: auto` + 一个缩放倍数。版面是同一份,少的是手势层 —— 要补上它应当复用画布的相机,
而不是另写一套手势。

**基线**:失败不再挡住导出 · 取消也报成保存失败 → 各自精确打掉对应测试。"切倍率重新抓图"
那一条的基线**只拆一道守卫不会失败**(抓图 effect 与取出时的倍率比对互为兜底),两道一起拆
才失败 —— 如实记下:那条测试锁的是**行为**,不是某一行代码。

#### 后续

~~② 倍率~~ **已完成** · ~~③ 平台胶水~~ **已完成**

**④ modal UI** ✅ **已完成** —— 四步全部落地,见上。

---

### 14.21 新建页「从一套风格开始」:挑风格 → 开工

§14.18 与 §14.19 解决的是"已经有一份设计之后怎么换风格、怎么看色彩";这一节是**开工那一步**:新建页的 Create 里
横着一条风格胶片,挑一套,写需求,开工。

#### 先把 Create 收成"只有 UI 设计"

`image-generation` 那个 entry 从新建页撤下了,但**定义留着**(`WorkbenchEntryDefinition.internal`),
因为媒体工作台是**按 id 取它的 profile** 来建会话的(`createMediaProject`),而存下来的会话也带着
`entryId: "image-generation"`。直接删会同时断掉那条路和那些会话的解析。所以"摆不摆在新建页"与
"这个 entry 存不存在"是两件事 —— 用一个字段说清,而不是在 UI 里按 id 过滤(那样 entry 列表会
骗人:`mode: "create"` 却不在新建页出现)。

**只有一个可选项时,那一行 entry 也不摆。** 一个按钮的"选择器"长得像可以选,其实没得选,而它占掉
的是这一屏最值钱的位置(风格胶片与输入框之间)。判断按**数据**走(`modeEntries.length > 1`)而不是
按模式写死:现在 `code` 与 `create` 各只有一个可选项,所以两处都不摆;哪天某处再添一个,那一行自己
回来。顺带一处:i18n —— 那三个模式标签原本是**硬编码英文**(`"Everyday work"` / `"Code"` /
`"Create"`),而这是中文优先的应用;现在走 `modeEveryday` / `modeCode` / `modeCreate`。这条以前不
显眼,是因为 entry 那一行用 i18n 写着自己的名字(「UI 设计」);把它收掉之后,模式标签就成了那一屏
唯一的名字来源。

#### 为什么横着可以,而风格墙那条不行

§14.7 记过一条相反的纪律:**风格墙竖着无限延伸,不做横向翻页**(横向会让用户不知道右边还有)。
这两处不矛盾,因为**它们的位置不同**:

- 风格墙是**整页**,以浏览为目的 —— 竖着铺开就是全部,横向只是把其余藏起来。
- 这一条是**启动栏**:下面是输入框,竖着铺 29 张会把输入框顶出屏幕。

所以折中是"露半张 + 计数 + 键盘可达":右边始终露出半张卡,标题旁写清「29 套」,一眼看得到还有,
但不占掉输入框的位置。头一张是「**由 agent 自己定**」—— 不指定风格是一个**看得见的选项**,而不是
"什么都没选"这种要靠猜的状态;它也是默认值,所以这是纯加法,不动它就是原来的行为。

卡上仍是**真示例页**(`StyleDemo`),但**进视口才取**:横向胶片里 29 张是同时挂着的,不拦的话就是
29 份 20–30KB 的文档一起建起来(§14.18 那条"窗口化兜住代价"在横排里不成立,得单独拦一道)。

#### 选中的风格怎么生效(**这一版已被 §14.22 取代**)

这一版当初的做法是"资料落盘 + 引用进消息":把该风格的 `theme.css` + `DESIGN.md` 写进工作区的
`design-resources/<id>/`,再把这两份**作为工作区引用**带进第一条消息,由 agent 读进来、拷进设计包。
配套纪律是"落盘失败就不建会话",以及"没有工作区时不给挑"(资料要有地方落)。

**它为什么被换掉**:三个理由里只有一个还站着 ——

| §14.21 当初的理由 | 现在 |
|---|---|
| agent 要能 `Read`、能**拷进**设计包 | **不成立了**:拷贝由 `design_style_apply` / `design_create({styleId})` 做(主进程内、确定性、可备份),agent 连读都不需要 |
| 扛得住上下文压缩(资料在盘上) | **更强**:令牌一开始就在设计包自己的 `theme.css` 里,不依赖对话里那句话 |
| 用户看得见(消息里两个引用块) | 仍然需要,但**不需要用"盘上的文件"来表达**,一个标记块就够 |

而它带来的连锁代价是真的:必须先选工作区(资料要有地方落 → 风格栏在无工作区时禁用),中间那一站
落完还要再让 agent 抄一遍。§14.22 记了替代方案。

#### 还没做的

- **「全部风格」入口**:点它就得离开新建页,而用户可能已经写了一半需求(那些字在会话创建前不落
  盘)。要做的话得先把草稿留住,或者改成弹层。
- **示例页不落盘**:它是给用户看的,agent 不需要(它读的是规范与令牌)。

### 14.22 风格改成「标记 + 工具」:取消工作区前置,也不再让 agent 抄文件

§14.21 那一版落地之后露出两个症状,它们**同一个成因**:

- **不选工作区就不能挑风格。** `DesignStyleLaunchStrip` 有一道 `workspaceReady` 门,无工作区时卡片
  看起来能点、点了什么都不发生。而"挑风格 → 写需求 → 开工"是用户习惯的路径,设计会话不关联工作区
  在文档里也是允许的(§14.12 就是在修这条路上的一个 bug)。
- **"应用一套风格"的实现是让模型把两份文件正确抄一遍。** 画像里那句
  "read that `DESIGN.md` first and copy its `theme.css` into the design's own `theme.css`" 就是它。

成因在**顺序**:`installDesignStyleResources` 必须在**会话存在之前**把资料写到某个根上,而 IPC 里
只有 `create-and-prompt`(调用即发出首条消息),**没有"只建会话"这个动作** —— 于是那个根只能是已选的
工作区。

#### 先把两次写分开

| 写 | 硬性吗 | 为什么 |
|---|---|---|
| 风格令牌最终进**设计包**的 `theme.css` / `DESIGN.md` | **是** | 设计包的 `theme.css` 是单一真源:帧引用 `../theme.css`,构建从它编译。没有它帧一条样式都不生效(§14.12 那次事故的成因) |
| 先落到**工作区**的 `design-resources/<id>/`,再由 agent 抄一遍 | **不是** | 它只是为了让 agent 能 `Read` —— 而"拷贝"这件事本来就不该由模型做 |

所以"落盘"这条设计里唯一不可替代的东西是"**用户的选择要说出来**",而那件事不需要往盘上写文件。

#### 四层

**1) 消息标记:用户的选择进消息**

照 `<wordless-theme-token-reference>` 那条**已有的**管道走一遍,不发明新机制:

| 环节 | 位置(theme-token 的现成先例) |
|---|---|
| part 类型 | `domain` 的 `UserPromptPart` 加 `{ type: "design-style"; styleId }` |
| 编码进提示词 | `agent-driver-sdk` 的 `formatPromptWithSkillReferences` |
| 给模型的人话 | 同包的 `formatPrompt*ForModel` 那一族:`<wordless_design_style>` 展开成一句可执行的说明 |
| 投影回消息 | 同包的投影函数 → `pending-thread-turn` → `ThreadView` 的引用 chip |
| 谁产生它 | 新建页选中风格时(与色板点选用户产生 theme-token 的位置对称) |

**"先有工作区才能落盘"这个问题到这里消失**:标记只是消息的一部分,不需要任何根。

**2) 画像约定:"前缀 → 行为"改成"标记 → 调用"**

`profiles/ui` 里那句 `design-resources/<id>/` 的约定换成:

> 消息里带 `<wordless_design_style>` 时:**先 `design_create` 并带上那个 `styleId`**,不要自己写
> `theme.css`、不要自己建包。除非用户明确要求换风格,否则不要在已经写过帧之后应用风格。

最后半句是纪律,不是客套:见下面风险 1 与 3。

**3) 工具面**

| 工具 | 实现 | 说明 |
|---|---|---|
| `design_create` 加可选 `styleId` | **已存在**:`store.createDesign({ styleId })` 早就解析风格(解析不到退回默认令牌),还能建包后立刻构建一次 | 一步到位,而且第一帧从第一刻起就有样式 |
| `design_style_list` | 读编译进 app 的风格目录 | 只回 id + 名字 + 一句话;**不回正文** |
| `design_style_apply({ styleId })` | **已存在**:`store.applyStyle`(整包备份 → 写两份 → 记 `manifest.style` → 报 `framesNeedRestyle`) | 与画布上"应用风格"那条入口**共用同一个实现**,否则两处会漂 |

三个都走既有那条路:`capabilities/design` 加工具 + `DesignPort` 加方法 + `main` 的适配层转发(端口
里已经有 `store`)。`profiles/ui` 的 `activeToolNames` 要跟着加,并把头部那句"`design_style_*` 刻意
不声明"的注释改掉 —— **声明了却跑不起来的工具比没有更糟**,反过来实现了不声明也一样糟。

**4) 证据链:怎么知道"真的应用了"**

这是这次改动最大的收益。这一版之前,这条路上唯一的证据是提示词里那句话;之后:

- `manifest.style` 记着风格 id(`createDesign` / `applyStyle` 都写);
- 设计包自己的 `theme.css` 就是令牌真源,帧从第一刻起引用它;
- `design_status` 已经在报 issues,其中一类就是"**未应用风格**" → agent 自己就能发现漏了。

#### 数据流

```
§14.21(已废):
  挑风格 → [渲染层] installDesignStyleResources(工作区根)   ← 需要工作区
         → <workspace>/design-resources/<id>/{theme.css,DESIGN.md}
         → 首条消息带两个 workspace-reference
         → [agent] 读 DESIGN.md → 自己把 theme.css 抄进设计包   ← 靠模型抄对
         → 帧才有样式

现在:
  挑风格 → 首条消息带一个 <wordless_design_style> 标记        ← 不需要工作区
         → [agent] design_create({ …, styleId })              ← 一次确定性调用
         → 帧从第一刻起就有样式
```

#### 「由 agent 自己定」是什么意思

**不指定风格 = 什么都不做**(agent 用默认审美)。**不提供"让 agent 自己挑一套"** —— 那是让模型
替用户做审美决定。

但**允许 agent 问**:泛用 driver 无条件给每个支持工具的会话注入 `request_user_input`
(`agent-driver-generic`,与画像无关),配上 `design_style_list` 就能把风格库列成一道选择题交回用户。
画像里加一句授权这件事即可,**不加第三张卡** —— 卡片是"用户主动选",问是"agent 主动问",两者不是
同一个东西。

#### 切干净

删掉:`installDesignStyleResources`(bridge / preload / IPC / handlers / store)、`style-start.ts`、
`DesignStyleLaunchStrip` 的 `workspaceReady`、`WelcomeView` 里落盘那一段。

**不留兼容句子。** 历史消息里的 `design-resources/<id>/` 引用只是一条路径文本,agent 读不到会自己
说出来;为它长期养一句提示词是净负债。

#### 风险

| # | 风险 | 对策 |
|---|---|---|
| 1 | `design_style_apply` 覆盖 `theme.css` / `DESIGN.md` | 整包备份已有(§12.3 第 1 条);画像写死"只在建包后应用一次";工具描述里写明它会覆盖两者 |
| 2 | 忘了调用 → 用户拿到的是模型的默认审美 | `design_create(styleId)` 是**一步**,比"建完再应用"少一个可能漏掉的环节;`design_status` 的"未应用风格"做第二道网 |
| 3 | 帧写完后再应用 → 那些帧停在旧令牌上 | `applyStyle` 已经返回 `framesNeedRestyle`;工具描述必须把这个信号说清楚,画像禁止这个时序 |
| 4 | 标记与设计包表达同一件事,可能不一致 | 单一真源仍是 **`manifest.style`**;标记只是"用户当时选了什么"的记录,不参与判定 |

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
