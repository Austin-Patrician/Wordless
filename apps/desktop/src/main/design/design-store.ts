import { randomUUID } from "node:crypto";
import type { DesignFs } from "./design-fs.ts";
import { parseFrameMeta } from "./frame-meta.ts";
import { isIgnoredDesignPath, isRenderableSource } from "./design-fs.ts";
import { DesignRegistry } from "./design-registry.ts";
import {
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
import { reconcileFrames, type DiskFrame } from "./reconcile.ts";
import { DESIGN_DIRECTORY_SUFFIX, joinPath, sanitizeDesignName, scaffoldDesign } from "./scaffold.ts";
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

/** `describeDesign` 的结果:一份设计的只读事实,不含任何修复。 */
export interface DesignDescription {
  path: string;
  name: string;
  mode: DesignMode;
  style: string | null;
  /** 参考目录里有没有 `DESIGN.md`。 */
  hasDesignDoc: boolean;
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

export interface DesignStoreOptions {
  fs: DesignFs;
  registry?: DesignRegistry;
}

export class DesignStore {
  private readonly fs: DesignFs;
  readonly registry: DesignRegistry;

  constructor(options: DesignStoreOptions) {
    this.fs = options.fs;
    this.registry = options.registry ?? new DesignRegistry();
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
  async openDesign(designPath: string): Promise<OpenedDesign | null> {
    const parsed = await this.readManifest(designPath);
    if (parsed === null) return null;

    const onDisk = await this.readFramesFromDisk(designPath);
    const reconciled = reconcileFrames({
      onDisk,
      inManifest: parsed.manifest.frames,
      defaultFrameSize: parsed.manifest.defaultFrameSize ?? null,
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
  }): Promise<{ path: string; frameId: string; build: DesignBuildResult | null } | null> {
    try {
      const base = sanitizeDesignName(input.name);
      let name = base;
      for (let suffix = 1; (await this.fs.stat(joinPath(input.root, `${name}${DESIGN_DIRECTORY_SUFFIX}`))) !== null; suffix += 1) {
        name = `${base}-${suffix}`;
      }

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

      return { path: scaffold.designPath, frameId: scaffold.frameId, build };
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




