import { createHash, randomUUID } from "node:crypto";
import type { DesignFs } from "./design-fs.ts";
import { parseFrameMeta, withFrameMeta, type FrameMetaPatch } from "./frame-meta.ts";
import { isIgnoredDesignPath, isRenderableSource } from "./design-fs.ts";
import { DesignRegistry } from "./design-registry.ts";
import {
  FALLBACK_FRAME_SIZE,
  MANIFEST_FILE,
  designNameOf,
  isDesignDirectoryName,
  manifestPathOf,
  parseManifest,
  serializeManifest,
  type CanvasViewport,
  type DesignManifest,
  type DesignMode,
} from "./manifest.ts";
import { dominantOf } from "./frame-size.ts";
import { reconcileFrames, type DiskFrame } from "./reconcile.ts";
import {
  DESIGN_DIRECTORY_SUFFIX,
  blankFrameSource,
  joinPath,
  nextFrameId,
  sanitizeDesignName,
  scaffoldDesign,
} from "./scaffold.ts";
import { designStyleById } from "./style-catalog.ts";
import type { BuildRecipe } from "./build-recipes.ts";
import { DESIGN_RASTER_BUDGETS } from "./raster-budgets.ts";
import { runDesignBuild, type BuildRunner, type DesignBuildResult } from "./design-builder.ts";

/**
 * 设计包的读写。
 *
 * 两条纪律贯穿全文件:
 *
 * 1. **写清单永远走 write-then-rename** —— 半截的 `design.json` 会让整个设计打不开,
 *    而 rename 在同一目录内是原子的。与仓库里其它 store 一致。
 * 2. **损坏就地修复,不整体失败** —— 一个坏字段不该让设计打不开;修复过就回写。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface DesignSummary {
  id: string;
  path: string;
  name: string;
  mode: DesignMode;
  style: string | null;
  frameCount: number;
}

export interface OpenedDesign {
  summary: DesignSummary;
  manifest: DesignManifest;
  /** 解析或对账时发生过修复,且已回写。 */
  repaired: boolean;
}

/**
 * 建包时因为重名而另选了目录。
 *
 * `requested` 是调用方要的名字,`actual` 是真正建出来的那份。两者不同就是"那个名字已经被
 * 占用了" —— 而这句话必须回到调用方那里:agent 重试一次就多一个包,而它无从分辨。
 */
export interface DesignCreateRename {
  requested: string;
  actual: string;
}

/** `built` 模式下样式表与源是否同步。 */
export type DesignStylesState = "never" | "fresh" | "stale" | "failed";

export interface DesignStylesStatus {
  state: DesignStylesState;
  /** 构建失败的原因。只在 `state === "failed"` 时有值。 */
  detail?: string;
}

/** `describeDesign` 的结果:一份设计的只读事实,不含任何修复。 */
export interface DesignDescription {
  path: string;
  name: string;
  mode: DesignMode;
  style: string | null;
  /** 参考目录里有没有 `DESIGN.md`。 */
  hasDesignDoc: boolean;
  /** 样式表是不是跟得上源。`built` 下这是"看得见设计"的前提。 */
  styles: DesignStylesStatus;
  frames: {
    id: string;
    title: string;
    file: string;
    /** 帧源码里有没有 `@frame` 声明。 */
    declaredSize: boolean;
    /** 帧文件是否真的在磁盘上。 */
    fileExists: boolean;
  }[];
}

/** `refreshDesign` 的结果。`revision` 是画布位图缓存的那把钥匙。 */
export interface DesignRefreshResult {
  revision: string;
  changed: boolean;
  applied: boolean;
  opened: OpenedDesign | null;
  build: DesignBuildResult | null;
}

export interface DesignStoreOptions {
  fs: DesignFs;
  registry?: DesignRegistry;
  /** 时钟。注入是为了让刷新限流能在 `node --test` 里用假时间覆盖。 */
  now?: () => number;
}

/**
 * 构建状态记录的位置。
 *
 * 放在 `.build/` 下是因为 `isIgnoredDesignPath` 会跳过点开头的目录:它既不会被当成设计
 * 内容扫进画布,也不会被算进源指纹 —— 否则一次构建会把自己判成"源变了",然后无限重建。
 */
const BUILD_DIRECTORY = ".build";
/**
 * 风格参考资料在**工作区**里的落点(与 open-vetta 同名,理由也一样)。
 *
 * 放工作区根而不是设计包里:它是资料、不是设计的一部分 —— 而且挑风格的时候设计包还不存在
 * (包由 agent 的 `design_create` 建,见 §14.19 那条"不预先 scaffold")。
 */
const BUILD_STATUS_FILE = "status.json";

/**
 * 两次刷新之间的最短间隔。
 *
 * agent 写一整屏帧的时候,每一次轮询都会看到新指纹。没有这道闸,"每写一点就重建一次"
 * 会变成现实,而每一次构建都是一个子进程。1.2s 比轮询间隔略大:连续写入时画布大约每两秒
 * 跟上一次,停下之后一次就对齐。
 */
export const DESIGN_REFRESH_MIN_INTERVAL_MS = 1_200;

export class DesignStore {
  private readonly fs: DesignFs;
  readonly registry: DesignRegistry;
  private readonly now: () => number;
  /**
   * 正在刷新的设计。**单飞**:构建是一个子进程,而轮询每秒都来 ——
   * 没有它,一次慢构建会被叠成好几个并排的构建。
   */
  private readonly refreshing = new Set<string>();
  /** 上一次真正做了同步/构建的时刻,用于最短间隔限流。 */
  private readonly refreshedAt = new Map<string, number>();

  constructor(options: DesignStoreOptions) {
    this.fs = options.fs;
    this.registry = options.registry ?? new DesignRegistry();
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 扫出 root 下所有设计包。
   *
   * 设计包是**目录**,而递归列举只回文件,所以靠里面的 `design.json` 反推 —— 这也是
   * 为什么 `dist/` 必须在扫描时被跳过:构建产物里若也有一份同名文件,会被误认成设计。
   */
  async listDesigns(root: string): Promise<DesignSummary[]> {
    const files = await this.fs.listFiles(root);
    const summaries: DesignSummary[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const designPath = designPathFromManifestFile(root, file.relPath);
      if (designPath === null || seen.has(designPath)) continue;
      seen.add(designPath);
      const opened = await this.openDesign(designPath);
      if (opened === null) continue;
      summaries.push(opened.summary);
    }
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * 打开一份设计:读清单 → 与磁盘对账 → 必要时回写 → 同步渲染根。
   *
   * 不是设计包时返回 null(而不是抛错),调用方据此把它从列表里排除。
   */
  async openDesign(
    designPath: string,
    /**
     * 用户**刚在画布上画出来**的那一帧的落点。
     *
     * 只在"新建"这一条路上传:`reconcileFrames` 本来就有这一项(自动布局是兜底,画布上的
     * 落点优先),所以这里只是把它接出来,而不是另立一条摆放规则。
     */
    pendingPlacements?: ReadonlyMap<string, { x: number; y: number }>,
  ): Promise<OpenedDesign | null> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return null;

    const onDisk = await this.readFramesFromDisk(designPath);
    const reconciled = reconcileFrames({
      onDisk,
      inManifest: parsed.manifest.frames,
      defaultFrameSize: parsed.manifest.defaultFrameSize ?? null,
      ...(pendingPlacements === undefined ? {} : { pendingPlacements }),
    });

    const manifest: DesignManifest = { ...parsed.manifest, frames: reconciled.frames };
    const repaired = parsed.repaired || reconciled.changed;
    if (repaired) await this.writeManifest(designPath, manifest);

    await this.syncRenderRoot(designPath, manifest);

    return {
      summary: {
        id: this.registry.register(designPath),
        path: designPath,
        name: designNameOf(designPath),
        mode: manifest.mode,
        style: manifest.style,
        frameCount: manifest.frames.length,
      },
      manifest,
      repaired,
    };
  }

  /**
   * 在画布上移动若干帧。
   *
   * **只动清单,绝不写回帧文件** —— 位置是纯布局,与内容无关;而标题/尺寸属于内容,
   * 走的是另一条路(写回帧文件里的 `@frame` 声明)。
   *
   * 批量是因为多选拖拽一次会动好几帧,而它们应当**一次修订**落盘:逐帧写会让中途的
   * 状态被看到,也让"撤销一次拖拽"变成撤销 N 次。
   */
  async moveFrames(designPath: string, moves: readonly { frameId: string; x: number; y: number }[]): Promise<boolean> {
    if (moves.length === 0) return false;
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return false;

    const byId = new Map(moves.map((move) => [move.frameId, move]));
    let changed = false;
    const frames = parsed.manifest.frames.map((frame) => {
      const move = byId.get(frame.id);
      if (move === undefined) return frame;
      // 非有限的坐标会写坏清单,后面每次打开都要修复一遍。
      if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return frame;
      if (frame.x === move.x && frame.y === move.y) return frame;
      changed = true;
      return { ...frame, x: move.x, y: move.y };
    });
    if (!changed) return false;

    await this.writeManifest(designPath, { ...parsed.manifest, frames });
    return true;
  }

  /**
   * 设计包里**除帧以外**的可交付文件:规范与素材。
   *
   * `theme.css` 与 `DESIGN.md` 是这份设计的规范(`DESIGN.md` 可选),`assets/**` 是贴进页面的
   * 外部文件 —— 三者收在一起,是因为"把这份设计交出去"要的是它们一整套。
   *
   * **这里不包含帧**,虽然它们也是文件:帧的交付形式是**渲染图**(`exportDesign`),而不是
   * HTML 源码 —— 源码是过程,图是结果。
   */
  async listDeliverableFiles(designPath: string): Promise<{ path: string; relPath: string }[]> {
    const wanted = (relPath: string): boolean =>
      relPath === "theme.css" || relPath === "DESIGN.md" || relPath.startsWith("assets/");
    return (await this.fs.listFiles(designPath))
      .map((file) => ({ path: file.path, relPath: file.relPath.replaceAll("\\", "/") }))
      .filter((file) => wanted(file.relPath))
      .sort((left, right) => left.relPath.localeCompare(right.relPath));
  }

  /**
   * 把一套内置风格应用到**已有**设计上。
   *
   * 三条纪律(§12.3),每条都有理由:
   *
   * 1. **先整包备份。** 应用风格会覆盖 `theme.css` 与 `DESIGN.md`,而那是整份设计的令牌真源 ——
   *    用户点错一次就再也回不来了。备份落在 `.build/style-backup/`(点开头 → 画布与扫描都
   *    跳过它),**固定路径、覆盖式**:它是一步撤销,不是版本库,攒起来只会越来越没人管。
   * 2. **只落规范,不机械改帧。** 设计不能靠替换令牌机械改风格 —— 一个圆角活泼的排版换成
   *    深色精密,要改的是间距、层次与字号,不是四个十六进制数。所以这里把 `theme.css` 与
   *    `DESIGN.md` 换掉,并**如实告诉调用方已有帧需要 agent 按新令牌重设**。
   * 3. **风格 id 记进清单**:它是"这份设计应用了哪一套"这个状态的真源,而 `design_status` 与
   *    `design_style_*` 都读它。
   *
   * 令牌一换,源指纹就变了 —— 于是下一次刷新会重编样式表(`built` 模式下 `dist/theme.css` 只能
   * 由构建产出),那一条不用在这里操心。
   */
  async applyStyle(
    designPath: string,
    styleId: string,
  ): Promise<{ framesNeedRestyle: boolean; opened: OpenedDesign } | null> {
    const style = designStyleById(styleId);
    if (style === undefined) return null;
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return null;

    await this.backupSources(designPath);
    await this.fs.writeText(joinPath(designPath, "theme.css"), style.themeCss);
    await this.fs.writeText(joinPath(designPath, "DESIGN.md"), style.designMd);
    await this.writeManifest(designPath, { ...parsed.manifest, style: style.id });

    const opened = await this.openDesign(designPath);
    if (opened === null) return null;
    return { framesNeedRestyle: opened.manifest.frames.length > 0, opened };
  }

  /** 把整份设计的**源文件**复制进 `.build/style-backup/`。同一路径覆盖,是一步撤销。 */
  private async backupSources(designPath: string): Promise<void> {
    const backupRoot = joinPath(joinPath(designPath, BUILD_DIRECTORY), "style-backup");
    for (const file of await this.fs.listFiles(designPath)) {
      const bytes = await this.fs.readBytes(file.path);
      await this.fs.writeBytes(joinPath(backupRoot, file.relPath), bytes);
    }
  }

  /**
   * 新建一个空白帧,并把它接进清单。
   *
   * 这里只有两步:**写文件**、然后**对账**(`openDesign`)。
   *
   * 落点与尺寸都不在这里算:
   *
   * - **落点**由 `reconcile` 决定 —— "磁盘有、清单没有"那条规则本来就会把它放到最右帧的右边、
   *   顶边与最上帧对齐(`FRAME_GAP = 80`)。在画布那一侧再算一遍,就是第二份真相。
   * - **尺寸**取传入值,否则整份设计的 `defaultFrameSize`,否则全局兜底。
   *
   * 这一条也是"帧 id 就是文件名"那条约定的直接后果:新建一帧 = 写一个文件,没有注册步骤。
   */
  async createFrame(input: {
    designPath: string;
    title?: string;
    width?: number;
    height?: number;
    /** 用户画出来的落点。不给就走自动布局(最右帧的右边)。 */
    x?: number;
    y?: number;
  }): Promise<OpenedDesign | null> {
    const parsed = await this.readManifest(input.designPath);
    if (parsed === null) return null;

    // 磁盘上的也算占用:那可能是 agent 刚写进去、还没对账的帧。
    const onDisk = (await this.fs.listDirectory(joinPath(input.designPath, "frames")))
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.name.replace(/\.html$/, ""));
    const { id, ordinal } = nextFrameId([...parsed.manifest.frames.map((frame) => frame.id), ...onDisk]);

    /**
     * 尺寸兜底链,与 `resolveFrameSizes` **同一条**(帧自己声明 > 多数派 > 品类 > 全局):
     *
     * 1. 调用方给的
     * 2. **已有帧的多数派** —— 给一份手机设计加第二屏,不该得到一个 1440×900 的桌面画板
     * 3. 品类尺寸(`defaultFrameSize`,建包时声明的那一对)
     * 4. 全局兜底
     */
    const fallback =
      dominantOf(parsed.manifest.frames.map((frame) => ({ height: frame.height, width: frame.width }))) ??
      parsed.manifest.defaultFrameSize ??
      FALLBACK_FRAME_SIZE;
    const base = input.title?.trim();
    // 标题编号:画布上唯一的标签就是它,两帧同名等于没有标签。
    const title = base === undefined || base === "" ? id : `${base} ${ordinal}`;

    await this.fs.writeText(
      joinPath(input.designPath, `frames/${id}.html`),
      blankFrameSource({
        height: input.height ?? fallback.height,
        title,
        width: input.width ?? fallback.width,
      }),
    );

    // 对账把它接进清单;落点用用户画出来的那个,没画就给自动布局。
    const placements =
      input.x === undefined || input.y === undefined
        ? undefined
        : new Map([[id, { x: Math.round(input.x), y: Math.round(input.y) }]]);
    return await this.openDesign(input.designPath, placements);
  }

  /**
   * 删掉一帧。
   *
   * **只删文件** —— 清单不用碰:"清单里有、磁盘上没有"那条对账规则本来就会把它丢掉。
   * 少写一处清单,就少一处可以写歪的地方。
   *
   * 这是画布上唯一会**丢东西**的动作,所以它必须由用户明确发起(右键菜单),不做任何隐式删除。
   */
  async deleteFrame(designPath: string, frameId: string): Promise<OpenedDesign | null> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return null;
    const frame = parsed.manifest.frames.find((candidate) => candidate.id === frameId);
    if (frame === undefined) return null;

    await this.fs.remove(joinPath(designPath, frame.file));
    return await this.openDesign(designPath);
  }

  /**
   * 改一帧的**声明**(标题 / 尺寸)。
   *
   * 与 `moveFrames` 恰成一对,而这条分界是 §6.1 定的:
   *
   * | 谁拥有什么 | 存在哪 | 走哪条路 |
   * |---|---|---|
   * | 画布上的位置 | `design.json` | `moveFrames`(拖拽) |
   * | 标题、声明尺寸 | 帧文件里的 `@frame` 注释 | 这里 |
   *
   * 只改清单里的标题/尺寸没有意义 —— 下一次对账就会被帧文件改回去。所以画布上"重命名一帧"
   * 与"拖大一点"这两个动作,实际写的是**源码**。
   *
   * ## 返回值说的是"要的状态成立了吗",不是"写盘了吗"
   *
   * 这条踩过:重命名成一个**和现在一样**的标题时 `next === source`,于是返回 false、界面报
   * "改不了这一帧" —— 而用户要的状态其实已经成立了。一次无效果的改名不是失败,就像"把已经
   * 亮着的灯打开"不是失败一样。
   *
   * 真正做不到的只有三件,都返回 false:帧不在清单里、帧文件读不出来、帧里没有 `@frame`
   * 声明 —— 最后一条是刻意的:往猜出来的位置插一行注释会写坏文件,而漏声明的帧本来就会从
   * `design_status` 的 issues 报出来。
   */
  async updateFrameMeta(designPath: string, frameId: string, patch: FrameMetaPatch): Promise<boolean> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return false;
    const frame = parsed.manifest.frames.find((candidate) => candidate.id === frameId);
    if (frame === undefined) return false;

    const file = joinPath(designPath, frame.file);
    let source: string;
    try {
      source = await this.fs.readText(file);
    } catch {
      return false;
    }

    const next = withFrameMeta(source, patch);
    if (next === null) return false;
    // 内容一样就什么都不用写 —— 但这**不是失败**:要的状态已经成立了。
    if (next === source) return true;
    await this.fs.writeText(file, next);
    return true;
  }

  /**
   * 建一个设计包。
   *
   * 唯一性在这里探测(而不是在纯函数里):要问磁盘才知道目录名有没有被占,而**同名时加
   * 序号而不是覆盖** —— 覆盖会毁掉一份已经存在的设计。
   *
   * 文件按顺序写:先写帧与令牌,最后写清单。清单是"这份设计存在"的标志(扫描靠它反推
   * 目录),先写清单会在中途留下一个**看起来存在但内容不全**的设计。
   */
  async createDesign(input: {
    root: string;
    name: string;
    title: string;
    frameWidth: number;
    frameHeight: number;
    /** 选中的风格 id。解析不到就退回默认令牌,而不是拒绝建包。 */
    styleId?: string | null;
    /**
     * 构建能力。给了就在建包后**立刻构建一次** —— 新设计的第一帧就该是有样式的,
     * 否则用户看到的第一眼是一个白底段落,而原因在别处。
     */
    builds?: { runner: BuildRunner; recipes: readonly BuildRecipe[]; timeoutMs?: number };
  }): Promise<{ path: string; frameId: string; rename: DesignCreateRename | null; build: DesignBuildResult | null } | null> {
    try {
      const base = sanitizeDesignName(input.name);
      let name = base;
      let suffixUsed = 0;
      for (let suffix = 1; (await this.fs.stat(joinPath(input.root, `${name}${DESIGN_DIRECTORY_SUFFIX}`))) !== null; suffix += 1) {
        name = `${base}-${suffix}`;
        suffixUsed = suffix;
      }
      /**
       * 重名时**另选一个目录**,而不是报错 —— 画廊里用户确实可能想要第二份同名设计。
       *
       * 但这件事必须**说出去**:agent 重试一次就会多出一个包,而它手上的 4 个包里哪一个是
       * 刚才那一个,它看不出来(实测:一次会话建出 `garbage-ui` / `-1` / `-2` / `-3`,零报错)。
       */
      const rename = suffixUsed === 0 ? null : { requested: base, actual: name };

      const style = input.styleId ? (designStyleById(input.styleId) ?? null) : null;
      const scaffold = scaffoldDesign({
        root: input.root,
        name,
        title: input.title,
        frameWidth: input.frameWidth,
        frameHeight: input.frameHeight,
        style: style === null ? null : { id: style.id, themeCss: style.themeCss, designMd: style.designMd },
      });
      for (const file of scaffold.files) await this.fs.writeText(file.path, file.content);

      /**
       * **构建失败不能让建包失败。** 设计已经落盘了,把它当成"没建成"会得到一个更糟的
       * 状态:盘上有一份不错的设计,而调用方以为要重来一次。
       *
       * 结果如实带回去,由调用方决定怎么告诉用户 —— 而不是在这里悄悄吞掉。
       */
      let build: DesignBuildResult | null = null;
      if (input.builds !== undefined) {
        try {
          build = await this.buildDesign({
            designPath: scaffold.designPath,
            runner: input.builds.runner,
            recipes: input.builds.recipes,
            ...(input.builds.timeoutMs === undefined ? {} : { timeoutMs: input.builds.timeoutMs }),
          });
        } catch (error) {
          // `runDesignBuild` 自己不该抛,但**建包路径不能依赖那个保证** —— 它一旦抛,
          // 用户拿到的是"新建设计失败",而实际上设计已经建好了。
          build = {
            ok: false,
            code: "spawn-failed",
            detail: error instanceof Error ? error.message : String(error),
            stdout: "",
            stderr: "",
          };
        }
      }

      return { path: scaffold.designPath, frameId: scaffold.frameId, rename, build };
    } catch {
      // 建不出来就照实返回 null:调用方据此告诉模型"没建成",而不是让它以为成了。
      return null;
    }
  }

  /**
   * 读一份设计的**状态事实**,供 `design_status` 使用。
   *
   * 与 `openDesign` 的区别是**不触发修复**:`openDesign` 会把清单与磁盘对账一遍并回写,
   * 于是"清单里有、磁盘上没有"这类事实在读之前就被抹平了。状态查询要的恰恰是修复前的
   * 事实 —— 否则 agent 永远看不到"你清单里那帧其实不存在"。
   *
   * 也因此这里**不做对账**:它只报告,不改任何东西。
   */
  async describeDesign(designPath: string): Promise<DesignDescription | null> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return null;

    const directory = joinPath(designPath, "frames");
    const entries = await this.fs.listDirectory(directory);
    const onDisk = new Set(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));

    const frames: DesignDescription["frames"] = [];
    for (const frame of parsed.manifest.frames) {
      let declaredSize = false;
      const fileName = frame.file.split("/").pop() ?? "";
      if (onDisk.has(fileName)) {
        try {
          const source = await this.fs.readText(joinPath(designPath, frame.file));
          const meta = parseFrameMeta(source, frame.id);
          declaredSize = meta.width !== null && meta.height !== null;
        } catch {
          // 读不出来就按"没有声明"算:问题照报,不让一次读失败把状态查询整个打掉。
        }
      }
      frames.push({
        id: frame.id,
        title: frame.title,
        file: frame.file,
        declaredSize,
        fileExists: onDisk.has(fileName),
      });
    }

    return {
      path: designPath,
      name: designNameOf(designPath),
      mode: parsed.manifest.mode,
      style: parsed.manifest.style,
      hasDesignDoc: (await this.fs.stat(joinPath(designPath, "DESIGN.md"))) !== null,
      styles: await this.stylesStatus(designPath, parsed.manifest.mode, await this.sourceFingerprint(designPath)),
      frames,
    };
  }

  /** 保存画布视口。视口是纯相机状态,与内容无关。 */
  async saveCanvas(designPath: string, canvas: CanvasViewport): Promise<boolean> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return false;
    await this.writeManifest(designPath, { ...parsed.manifest, canvas });
    return true;
  }

  /**
   * 把可渲染的子集同步到 `dist/`,**保持相对路径**。
   *
   * 保留相对路径是关键:`frames/index.html` 里写的 `../theme.css` 在
   * `dist/frames/index.html` 下依然指向 `dist/theme.css`。于是源文件与产物用同一套
   * 引用,agent 写一次两边都对。
   *
   * **`built` 模式也同步,但不碰 `dist/theme.css`。**
   *
   * 两种模式的产物形状相同,差别只在 `theme.css` 从哪来:`static` 是源文件的拷贝,
   * `built` 是编译出来的。所以 `built` 下要刷新帧、又必须留住那份编译产物 —— 否则
   * 每次打开设计都会把样式删掉,而那正是 §14.10 里那个 bug 的形状。
   *
   * 这里同步的是**帧的改动**;新增的工具类要等下一次构建才会出现在样式表里。
   */
  async syncRenderRoot(designPath: string, manifest: DesignManifest): Promise<void> {
    const renderRoot = joinPath(designPath, "dist");
    if (manifest.mode === "static") await this.fs.remove(renderRoot);

    const files = await this.fs.listFiles(designPath);
    for (const file of files) {
      if (!isRenderableSource(file.relPath)) continue;
      // `built` 下这份是编译产物,不能拿源文件覆盖它。
      if (manifest.mode === "built" && file.relPath === "theme.css") continue;
      const bytes = await this.fs.readBytes(file.path);
      await this.fs.writeBytes(joinPath(renderRoot, file.relPath), bytes);
    }
  }

  /**
   * 源指纹 —— 决定"画布要不要重新贴图"和"样式要不要重编"的**同一个事实**。
   *
   * 吃参与渲染的那几样东西:`theme.css`(令牌)与 `frames/` 下的每个 `.html`(类名与内容),
   * 其余可渲染文件只算**路径**。图片不计内容:它不参与 CSS 编译,而给几 MB 的图算哈希
   * 是白花成本。缺口是"原地替换一张图不触发刷新",而那种改动至少要重开一次设计。
   *
   * `dist/` 与 `.build/` 由 `isRenderableSource` 挡在外面,所以**构建产物不会把自己判成
   * "源变了"** —— 否则每一次刷新都会触发下一次构建。
   */
  async sourceFingerprint(designPath: string): Promise<string> {
    const files = (await this.fs.listFiles(designPath))
      .filter((file) => isRenderableSource(file.relPath))
      .sort((left, right) => left.relPath.localeCompare(right.relPath));

    const hash = createHash("sha256");
    for (const file of files) {
      // 长度前缀让拼接无歧义,于是不需要任何分隔符 —— 而"选一个分隔符"正是这类哈希最
      // 容易写错的地方:一个能出现在路径里的字符会让两种不同的源算出同一个指纹。
      const bytes = isStyleSource(file.relPath) ? await this.readBytesOrEmpty(file.path) : null;
      hash.update(`${file.relPath}:${bytes === null ? "-" : bytes.byteLength};`);
      if (bytes !== null) hash.update(bytes);
    }
    return hash.digest("hex").slice(0, 16);
  }

  /**
   * 让一份设计回到当前磁盘状态:对账 → 同步 → 必要时重编样式。
   *
   * 这是画布的**心跳**,也是 agent 截图前的必经之路。三件事一起做,因为它们的前提是同一
   * 个判断(源变了吗):
   *
   * 1. **新帧上画布** —— `openDesign` 重读清单并与磁盘对账
   * 2. **帧内容刷新** —— `syncRenderRoot` 把帧与资源铺进 `dist/`
   * 3. **样式重编** —— `built` 下 `dist/theme.css` 只能由构建产出,而 agent 新加的
   *    工具类此刻还不存在。少了这一步,帧会**一条样式都不生效**
   *
   * 快路径只有两次读、不起任何进程 —— 那是轮询的常态,所以它必须便宜。
   */
  async refreshDesign(input: {
    designPath: string;
    builds?: { runner: BuildRunner; recipes: readonly BuildRecipe[]; timeoutMs?: number };
    /** 用户按的刷新:越过最短间隔(但不越过单飞)。 */
    force?: boolean;
  }): Promise<DesignRefreshResult> {
    const designPath = input.designPath;
    const revision = await this.sourceFingerprint(designPath);
    const record = await this.readBuildRecord(designPath);

    // 源与上一次应用过的指纹一致 —— 这就是"什么都没发生",而它是绝大多数次的样子。
    if (record !== null && record.fingerprint === revision) {
      return { revision, changed: false, applied: false, opened: null, build: null };
    }

    /**
     * 限流。`refreshing` 挡住叠加的构建,`refreshedAt` 挡住背靠背的构建 —— agent 连续写文件时
     * 每一次轮询都会看到新指纹,没有这两道闸,每一次都会变成一个子进程。
     *
     * **`force` 只越过时间那道闸,不越过单飞。** 用户按了刷新就是在等结果:他刚在编辑器里改完
     * 一帧,而心跳要么停了(agent 跑完)、要么刚好在限流窗口里 —— 那时静默什么都不做是最糟的
     * 一种"点了没反应"。但构建同时在跑时仍然要挡住:再叠一个子进程不会让他更快拿到结果。
     */
    if (
      this.refreshing.has(designPath) ||
      (input.force !== true &&
        this.now() - (this.refreshedAt.get(designPath) ?? Number.NEGATIVE_INFINITY) <
          DESIGN_REFRESH_MIN_INTERVAL_MS)
    ) {
      return { revision, changed: true, applied: false, opened: null, build: null };
    }

    this.refreshing.add(designPath);
    try {
      const opened = await this.openDesign(designPath);
      if (opened === null) return { revision, changed: true, applied: false, opened: null, build: null };

      let build: DesignBuildResult | null = null;
      if (opened.manifest.mode === "built" && input.builds !== undefined) {
        build = await this.buildDesign({
          designPath,
          runner: input.builds.runner,
          recipes: input.builds.recipes,
          ...(input.builds.timeoutMs === undefined ? {} : { timeoutMs: input.builds.timeoutMs }),
        });
      }

      const failed = build !== null && !build.ok ? build : null;

      /**
       * **指纹无论成败都记下来。**
       *
       * 记失败不是为了掩盖它:原因写进记录,`design_status` 读得到。记它是为了不要每秒
       * 重试一个坏构建 —— 那会得到一个永远在起子进程、又永远失败的循环,比一次可见的
       * 失败糟得多。下一次源变化自然会重试。
       */
      await this.writeBuildRecord(designPath, {
        fingerprint: revision,
        ok: failed === null,
        ...(failed === null ? {} : { detail: `${failed.code}: ${failed.detail}` }),
      });

      this.refreshedAt.set(designPath, this.now());
      return { revision, changed: true, applied: true, opened, build };
    } finally {
      this.refreshing.delete(designPath);
    }
  }

  /**
   * 样式表跟不跟得上源。
   *
   * 与 `describeDesign` 一样**只读**:状态查询不该顺手把事实改掉 —— 那样 agent 读到的
   * 会是它自己刚刚抹平过的世界。
   */
  private async stylesStatus(designPath: string, mode: DesignMode, revision: string): Promise<DesignStylesStatus> {
    // `static` 的样式表就是源文件本身,由同步渲染根铺过去,不存在"跟不上"这回事。
    if (mode !== "built") return { state: "fresh" };
    const record = await this.readBuildRecord(designPath);
    if (record === null) return { state: "never" };
    if (!record.ok) {
      return { state: "failed", ...(record.detail === undefined ? {} : { detail: record.detail }) };
    }
    if (record.fingerprint !== revision) return { state: "stale" };
    return { state: "fresh" };
  }

  /** 上一次构建记下来的事实。没有记录返回 `null`(新包,或这个机制之前建的包)。 */
  private async readBuildRecord(
    designPath: string,
  ): Promise<{ fingerprint: string; ok: boolean; detail?: string } | null> {
    let raw: string;
    try {
      raw = await this.fs.readText(joinPath(joinPath(designPath, BUILD_DIRECTORY), BUILD_STATUS_FILE));
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.fingerprint !== "string" || record.fingerprint === "") return null;
      return {
        fingerprint: record.fingerprint,
        ok: record.ok === true,
        ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
      };
    } catch {
      // 状态文件坏了按"没有记录"处理:它只是一份缓存,不该让设计打不开。
      return null;
    }
  }

  /** 写入走 write-then-rename,与清单同一条纪律:半截的状态文件会让"样式新不新"永远答不出来。 */
  /** 读字节;读不到按空处理。一次瞬时读失败不该被记进指纹 —— 那会凭空多出一次重建。 */
  private async readBytesOrEmpty(filePath: string): Promise<Uint8Array | null> {
    try {
      return await this.fs.readBytes(filePath);
    } catch {
      return null;
    }
  }

  private async writeBuildRecord(
    designPath: string,
    record: { fingerprint: string; ok: boolean; detail?: string },
  ): Promise<void> {
    const target = joinPath(joinPath(designPath, BUILD_DIRECTORY), BUILD_STATUS_FILE);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await this.fs.writeText(temporary, JSON.stringify(record));
    await this.fs.rename(temporary, target);
  }

  /**
   * 跑一次构建(`mode: "built"`)。
   *
   * **runner 由调用方注入、而不是构造时持有** —— 它是无状态的(一个方法、一次一个子进程),
   * 而 store 是有状态的。塞进构造参数会让每个只读测试都得先造一个假 runner;按次传入则
   * "谁发起构建、谁负责那一次子进程"这件事在签名上就看得见。
   *
   * 不是设计包时返回 `null`,与 `readManifest` 一致:调用方要用它区分"这里没有设计"和
   * "这里有一份构建失败的设计"。
   */
  async buildDesign(input: {
    designPath: string;
    runner: BuildRunner;
    /**
     * 覆盖注册表。默认就是第一方那张表 —— 留这个口子是因为 `runDesignBuild` 本身就按参数
     * 收方案,这里只是把它透传出去,而不是给测试开的后门。
     */
    recipes: readonly BuildRecipe[];
    /** 覆盖预算里的超时。 */
    timeoutMs?: number;
  }): Promise<DesignBuildResult | null> {
    const parsed = await this.readManifest(input.designPath);
    if (parsed === null) return null;
    return await runDesignBuild({
      fs: this.fs,
      runner: input.runner,
      manifest: parsed.manifest,
      designPath: input.designPath,
      recipes: input.recipes,
      timeoutMs: input.timeoutMs ?? DESIGN_RASTER_BUDGETS.buildTimeoutMs,
    });
  }

  /** 读清单。文件不存在或不是设计包都返回 null。 */
  private async readManifest(designPath: string): Promise<{ manifest: DesignManifest; repaired: boolean } | null> {
    let raw: string;
    try {
      raw = await this.fs.readText(manifestPathOf(designPath));
    } catch {
      return null;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      // 清单本身坏了:这不是"可以就地修复"的字段级损坏,而是整份不可读。
      // 仍然返回 null 让调用方把它当成"不是设计",而不是崩掉。
      return null;
    }
    return parseManifest(parsedJson);
  }

  private async writeManifest(designPath: string, manifest: DesignManifest): Promise<void> {
    const target = manifestPathOf(designPath);
    // 唯一的临时名:固定的 `.tmp` 在两处并发写时会互相截断。
    const temporary = `${target}.${randomUUID()}.tmp`;
    await this.fs.writeText(temporary, serializeManifest(manifest));
    await this.fs.rename(temporary, target);
  }

  /** 读 `frames/` 下的帧文件并解析声明。按文件名排序,保证结果稳定。 */
  private async readFramesFromDisk(designPath: string): Promise<DiskFrame[]> {
    const directory = joinPath(designPath, "frames");
    const entries = await this.fs.listDirectory(directory);
    const frames: DiskFrame[] = [];

    const files = entries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith(".html"))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const file of files) {
      const id = file.name.slice(0, -".html".length);
      if (id === "") continue;
      let source = "";
      try {
        source = await this.fs.readText(file.path);
      } catch {
        // 读不了就按"没有声明"处理:帧照常上画布,问题从 issues 报出去。
      }
      frames.push({ id, file: `frames/${file.name}`, parsed: parseFrameMeta(source, id) });
    }
    return frames;
  }
}

/** `…/x.wdesign/design.json` → `…/x.wdesign`。只看最后一段是不是设计包名。 */
function designPathFromManifestFile(root: string, relPath: string): string | null {
  const normalized = relPath.replaceAll("\\", "/");
  const suffix = `/${MANIFEST_FILE}`;
  if (!normalized.endsWith(suffix)) return null;
  const designRelPath = normalized.slice(0, -suffix.length);
  const directoryName = designRelPath.split("/").pop() ?? "";
  if (!isDesignDirectoryName(directoryName)) return null;
  return joinPath(root, designRelPath);
}

/**
 * 参与**样式**的那几样源:令牌与帧。
 *
 * 只有它们既决定"帧长什么样"又决定"样式表里该有哪些类名",所以只有它们的内容进指纹。
 * 其余可渲染文件(图片、字体)只按路径参与 —— 见 `sourceFingerprint`。
 */
function isStyleSource(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/");
  return normalized === "theme.css" || normalized.startsWith("frames/");
}




