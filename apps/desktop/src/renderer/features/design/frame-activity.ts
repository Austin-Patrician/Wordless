import type { DesignFrameDto } from "@wordless/protocol";

/**
 * 帧上的活动态 —— "agent 现在在干什么"。
 *
 * 画布上的位图是**磁盘的快照**,而 agent 在改磁盘。唯一的证据是工具调用:它读了哪个文件、
 * 写了哪个文件。参考实现把 `tool-call-start/end` 投影成逐帧的活动态(浏览 / 修改 / 创作),
 * 这里做同一件事。
 *
 * 本文件是纯函数,不 import React。**三个判断各自被单测覆盖** —— 它们在参考实现里都是
 * 一堆散在事件回调里的三元表达式,而"粒子亮错了帧"这种错既看不见也测不到。
 */

export type FrameActivity = "reading" | "modifying" | "creating" | "updated";

/** 会点亮帧的三态。`updated` 是一次改动的收尾,不是工具直接产生的。 */
export type ActiveFrameActivity = Exclude<FrameActivity, "updated">;

/**
 * 工具名 → 活动态。
 *
 * `write` 是"创作"而不是"修改":对设计来说,写一个新帧是**从无到有**,它与改一帧是两件
 * 事(参考实现同样如此)。其余带路径但叫不出名字的工具按"修改"兜底 —— 猜错方向比完全不亮好。
 */
const TOOL_ACTIVITY: Readonly<Record<string, ActiveFrameActivity>> = {
  read: "reading",
  edit: "modifying",
  write: "creating",
};

export function activityKindForTool(toolName: string): ActiveFrameActivity | null {
  return TOOL_ACTIVITY[toolName] ?? null;
}

/** 工具参数里可能带路径的键。名字取自各工具自己的 schema。 */
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;

export function toolPathOf(input: Record<string, unknown> | undefined): string | null {
  if (input === undefined) return null;
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/** 归一化:统一分隔符、去掉末尾斜杠。只在比较用,不碰文件系统。 */
export function normalizeToolPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * 这次工具调用落在设计包的哪里 —— `null` 表示不在包里(于是什么都不点亮)。
 *
 * 只按**目录名**定位,不按绝对路径:`read` 拿到的可能是 `meadow.wdesign/frames/index.html`
 * (相对工作区根),也可能是主进程给的绝对路径,两者指的是同一份设计。按名字找那一段,
 * 两种写法都成立,而渲染层并不需要知道工作区根在哪。
 */
export function designRelativePath(input: { path: string; designName: string }): string | null {
  const path = normalizeToolPath(input.path);
  const name = normalizeToolPath(input.designName);
  if (name === "") return null;

  if (path === name) return "";
  if (path.startsWith(`${name}/`)) return path.slice(name.length + 1);
  const marker = `/${name}/`;
  const at = path.lastIndexOf(marker);
  if (at === -1) return null;
  return path.slice(at + marker.length);
}

/**
 * 这次调用该点亮哪些帧。
 *
 * - `frames/<id>.html` → **那一帧**
 * - 包里其余的东西(`theme.css`、`assets/**`)→ **全部帧** —— 它们是共享件,改一次每帧都变。
 *   这条判定与"位图要不要重取"共用同一个源指纹(见 `use-design-textures`),不另立一套。
 * - 包外、或路径不是这一类 → 空数组
 */
export function activityTargets(input: {
  path: string;
  designName: string;
  frames: readonly DesignFrameDto[];
}): string[] {
  const relative = designRelativePath({ path: input.path, designName: input.designName });
  if (relative === null) return [];

  const frameId = frameIdOfRelativePath(relative);
  if (frameId !== null) return [frameId];
  // 共享件。空 relative(路径就是设计包目录本身)也算 —— 那多半是一次列举。
  return input.frames.map((frame) => frame.id);
}

/** `frames/login.html` → `login`。其余路径返回 null。 */
export function frameIdOfRelativePath(relative: string): string | null {
  if (!relative.startsWith("frames/")) return null;
  const file = relative.slice("frames/".length);
  if (!file.endsWith(".html")) return null;
  const id = file.slice(0, -".html".length);
  // 只在帧目录的**直接子文件**里认:`frames/nested/x.html` 不是一帧。
  return id === "" || id.includes("/") ? null : id;
}

/**
 * 一次工具调用至少要亮多久。
 *
 * 工具调用常常不到一秒就返回,而活动态是**给人看的**:一闪而过等于没有。参考实现用
 * 2.5s,理由相同(它记录的是一条注释:「工具调用常常不到 1 秒就返回,动画一闪而过」)。
 */
export const MIN_ACTIVITY_MS = 2_500;

/** 一次改动之后"已更新"停留多久。 */
export const UPDATED_ACTIVITY_MS = 2_000;

/**
 * 活动态的视觉:一个色相 + 一条 i18n 键。
 *
 * 色相**同时承担语义** —— 扫一眼画布就知道 agent 在干什么,不用读文字。三色取自参考实现
 * 的同一组(青=在看、靛=在改、品红=从无到有),它们与设计本身的配色无关,所以在任何风格的
 * 设计上都读得出来。`updated` 用绿:那是收尾,不是一种正在进行的动作。
 */
export interface FrameActivityVisual {
  /** 环与徽标的颜色。 */
  color: string;
  labelKey: "designActivityReading" | "designActivityModifying" | "designActivityCreating" | "designActivityUpdated";
}

export const FRAME_ACTIVITY_VISUALS: Readonly<Record<FrameActivity, FrameActivityVisual>> = {
  reading: { color: "#0ea5e9", labelKey: "designActivityReading" },
  modifying: { color: "#6366f1", labelKey: "designActivityModifying" },
  creating: { color: "#d946ef", labelKey: "designActivityCreating" },
  updated: { color: "#10b981", labelKey: "designActivityUpdated" },
};

export function remainingHoldMs(startedAt: number, now: number, minimum = MIN_ACTIVITY_MS): number {
  return Math.max(0, minimum - (now - startedAt));
}

/**
 * 工具结束之后该怎么收场。
 *
 * 三个分支各自对应一件真实会发生的事:
 *
 * - **读**没有改动任何东西 → 直接消失,不翻"已更新"(否则看了一眼前就跳一下,看起来像改过)
 * - **出错**的调用也没改成 → 同样直接消失
 * - 其余(改 / 写)→ 先亮"已更新"再落定
 *
 * `delayMs` 是"最短停留还差多久":活干得比人眼快时,收场要等一会儿,否则整段动画只是闪一下。
 * 由纯函数算出来、由调用方去排定时器 —— 定时器是副作用,判断不是。
 */
export function activitySettlement(input: {
  kind: ActiveFrameActivity;
  isError: boolean;
  startedAt: number;
  now: number;
}): { result: "clear" | "updated"; delayMs: number } {
  const delayMs = remainingHoldMs(input.startedAt, input.now);
  if (input.kind === "reading" || input.isError) return { result: "clear", delayMs };
  return { result: "updated", delayMs };
}
