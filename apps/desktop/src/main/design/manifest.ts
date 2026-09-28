/**
 * 设计包清单(`design.json`)。
 *
 * **职责划分**(与参考实现的关键差异):文件系统是「内容」的真相,清单是「布局」的
 * 真相。清单只记哪些帧、帧在哪、视口在哪,以及帧的标题与声明尺寸的**上次快照**;
 * 帧本身存不存在由磁盘决定。这样就不需要"最后写入者胜"那种双向对账。
 *
 * 本文件不 import React、不 import Electron。
 */

export const MANIFEST_FILE = "design.json";
export const DESIGN_TYPE = "wordless-design";
export const MANIFEST_VERSION = 1;

/**
 * 帧漏声明尺寸、整份设计也没有多数派、又没有品类时的最后兜底。
 *
 * 取桌面而不是手机:「一个 390 宽的仪表盘」是最常见的失败形态 —— 猜宽了顶多留白,
 * 猜窄了整个布局是塌的。
 */
export const FALLBACK_FRAME_SIZE = { width: 1440, height: 900 } as const;

export type DesignMode = "static" | "built";

export interface FrameSize {
  width: number;
  height: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DesignFrameEntry {
  id: string;
  /** 相对设计包根目录,例如 `frames/login.html`。 */
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

/**
 * `mode: "built"` 用哪一套构建。
 *
 * **这里存的是方案 id,不是命令。** 命令一律由 `build-recipes.ts` 那张第一方表产生:
 * 设计包是 agent 写的,清单若能携带命令,一次「重新构建」就等于执行 agent 写下的任意
 * 命令,而仓库对命令的约束在 shell 工具的边界上,这里走不到。
 */
export interface DesignBuildSpec {
  recipe: string;
}

export interface DesignManifest {
  version: typeof MANIFEST_VERSION;
  type: typeof DESIGN_TYPE;
  canvas: CanvasViewport;
  mode: DesignMode;
  /** 仅 `mode: "built"` 有意义。 */
  build?: DesignBuildSpec;
  /** 当前应用的风格体系 id;没应用过为 null。 */
  style: string | null;
  /**
   * 品类,用创建时声明的一对像素表示。只在某个帧漏声明、且整份设计还没有多数派时
   * 兜底。存下来的理由:「用户要的是什么品类」在创建那一刻最清晰,之后没有别处记着。
   */
  defaultFrameSize?: FrameSize;
  frames: DesignFrameEntry[];
}

export function emptyManifest(): DesignManifest {
  return {
    version: MANIFEST_VERSION,
    type: DESIGN_TYPE,
    canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static",
    style: null,
    frames: [],
  };
}

/** `x.wdesign/` → 其中的清单文件。 */
export function manifestPathOf(designPath: string): string {
  return `${trimTrailingSlash(designPath)}/${MANIFEST_FILE}`;
}

/** `x.wdesign/` → `x`。 */
export function designNameOf(designPath: string): string {
  const base = trimTrailingSlash(designPath).split(/[\\/]/).pop() ?? designPath;
  return base.replace(/\.wdesign$/i, "");
}

/** 目录名是否像一个设计包。用于扫描时先做便宜的过滤。 */
export function isDesignDirectoryName(name: string): boolean {
  return /\.wdesign$/i.test(name);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface ParsedManifest {
  manifest: DesignManifest;
  /** 有字段被修复或丢弃 —— 调用方据此决定是否回写。 */
  repaired: boolean;
}

/**
 * 解析清单。**不是设计包时返回 null**(而不是抛错或返回空清单),因为调用方要用这个
 * 区分"这里没有设计"和"这里有一份坏掉的设计"。
 *
 * 其余每一处损坏都**就地修复而不是整体失败** —— 一份清单里一个坏字段不该让整个设计
 * 打不开。`repaired` 报告是否发生过修复,由调用方决定回写时机(启动时不写用户文件)。
 */
export function parseManifest(raw: unknown): ParsedManifest | null {
  if (!isRecord(raw)) return null;
  if (raw.type !== DESIGN_TYPE) return null;

  let repaired = false;

  if (raw.version !== MANIFEST_VERSION) repaired = true;

  const canvas = parseCanvas(raw.canvas);
  if (canvas === null) repaired = true;

  let mode: DesignMode = "static";
  if (raw.mode === "static" || raw.mode === "built") mode = raw.mode;
  else repaired = true;

  let style: string | null = null;
  if (typeof raw.style === "string" && raw.style.trim() !== "") style = raw.style.trim();
  else if (raw.style !== null && raw.style !== undefined) repaired = true;

  const defaultFrameSize = parseSize(raw.defaultFrameSize);
  if (raw.defaultFrameSize !== undefined && defaultFrameSize === null) repaired = true;

  const build = parseBuildSpec(raw.build);
  if (raw.build !== undefined && build === null) repaired = true;

  const frames: DesignFrameEntry[] = [];
  if (Array.isArray(raw.frames)) {
    for (const candidate of raw.frames) {
      const frame = parseFrameEntry(candidate);
      if (frame === null) {
        repaired = true;
        continue;
      }
      frames.push(frame);
    }
  } else if (raw.frames !== undefined) {
    repaired = true;
  }

  return {
    manifest: {
      version: MANIFEST_VERSION,
      type: DESIGN_TYPE,
      canvas: canvas ?? { x: 0, y: 0, zoom: 1 },
      mode,
      style,
      ...(defaultFrameSize ? { defaultFrameSize } : {}),
      ...(build ? { build } : {}),
      frames,
    },
    repaired,
  };
}

function parseCanvas(raw: unknown): CanvasViewport | null {
  if (!isRecord(raw)) return null;
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const zoom = positiveNumber(raw.zoom);
  if (x === null || y === null || zoom === null) return null;
  return { x, y, zoom };
}

/** 构建方案声明。没有 recipe 就是坏的 —— 一个空的 `build: {}` 不代表任何东西。 */
function parseBuildSpec(raw: unknown): DesignBuildSpec | null {
  if (!isRecord(raw)) return null;
  const recipe = nonEmptyString(raw.recipe);
  if (recipe === null) return null;
  return { recipe };
}

function parseSize(raw: unknown): FrameSize | null {
  if (!isRecord(raw)) return null;
  const width = positiveNumber(raw.width);
  const height = positiveNumber(raw.height);
  if (width === null || height === null) return null;
  return { width, height };
}

/** 一帧的必需字段。缺 `id` / `file` / 几何就是坏的,丢掉而不是补默认值。 */
function parseFrameEntry(raw: unknown): DesignFrameEntry | null {
  if (!isRecord(raw)) return null;
  const id = nonEmptyString(raw.id);
  const file = nonEmptyString(raw.file);
  if (id === null || file === null) return null;
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const width = positiveNumber(raw.width);
  const height = positiveNumber(raw.height);
  if (x === null || y === null || width === null || height === null) return null;
  const title = nonEmptyString(raw.title) ?? id;
  return { id, file, x, y, width, height, title };
}

/** 序列化。用制表符缩进 —— 这份文件是给人看也给人改的。 */
export function serializeManifest(manifest: DesignManifest): string {
  return `${JSON.stringify(manifest, null, "\t")}\n`;
}
