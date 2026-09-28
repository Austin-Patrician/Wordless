import type { DesignListEntry } from "./port.js";

/**
 * 挑出这一次要操作的设计包。
 *
 * ## 为什么值得单独抽出来
 *
 * 一次真实会话(`f6f1471a`,profile `ui`)里 22 次工具调用有 7 次硬失败,其中三次是
 * `design_status` 带着 `path: "x.wdesign"` —— 而那个字符串是画像的 systemPrompt 里
 * **作为示意**写的目录名,模型把它当成了真路径。
 *
 * 这类失败不该靠"再写一句不要这样做"来收敛:路径是一个每个工具都要求、而模型手上只有
 * 一段散文的东西。给它一条**解析链**,它就不需要拼路径了:
 *
 * 1. 显式给的(仍然优先 —— 工作在两个设计之间时,只有调用方知道是哪一个)
 * 2. 工作区里**唯一**的那一份(绝大多数会话就是这一种)
 * 3. 报错,并**把候选列出来**
 *
 * 第 3 条是这里最要紧的:原来那句 `x.wdesign is not a design package` 是一堵墙 ——
 * 模型看到它只能再猜一次路径。而"盘上有这几份,请指名道姓"是它能立刻照做的下一步。
 */

export type DesignTargetResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "ambiguous"; candidates: readonly DesignListEntry[] };

export function resolveDesignTarget(input: {
  /** 调用方显式给的路径。给了就用它,不再校验 —— 不是设计包时由 `read` 照实说。 */
  explicit?: string | undefined;
  /** 工作区里扫到的设计包。 */
  designs: readonly DesignListEntry[];
}): DesignTargetResolution {
  const explicit = input.explicit?.trim();
  if (explicit !== undefined && explicit !== "") return { ok: true, path: explicit };

  const first = input.designs[0];
  if (first === undefined) return { ok: false, reason: "none" };
  if (input.designs.length > 1) return { ok: false, reason: "ambiguous", candidates: input.designs };
  return { ok: true, path: first.path };
}

/** 列出一份份设计。歧义与"你给的那个不存在"两种情况共用同一句话。 */
export function describeDesigns(designs: readonly DesignListEntry[]): string {
  return designs.map((design) => `- ${design.path} (${design.frameCount} frames)`).join("\n");
}

/**
 * 路径用不了时的说法。
 *
 * **必须带下一步。** 原来那句话只说了"这不是设计包",于是模型的下一个动作是再猜一个路径
 * (实测:同一个错路径被调用了三次)。候选列表把它从"猜"变成"读"。
 */
export function unknownDesignMessage(target: string, designs: readonly DesignListEntry[]): string {
  if (designs.length === 0) {
    return `${target} is not a design package, and this workspace has no design at all. Call design_create first — a design is a directory whose name ends in .wdesign, holding design.json and frames/.`;
  }
  return [
    `${target} is not a design package (no readable design.json there).`,
    "",
    "These are the designs in this workspace — pass one of these paths:",
    describeDesigns(designs),
    "",
    "Paths are relative to the workspace root, and the .wdesign directory is part of every path (for example `<name>.wdesign/theme.css`).",
  ].join("\n");
}
