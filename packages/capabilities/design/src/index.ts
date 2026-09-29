import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import { designIssues, isBlocking, type DesignIssue } from "./issues.js";
import type { DesignFactsDto, DesignPort, DesignStylesFactsDto } from "./port.js";
import { describeDesigns, resolveDesignTarget, unknownDesignMessage } from "./resolve-design.js";
export { LAYOUT_PROBE_EXPRESSION } from "./probe-script.js";
export { describeDesigns, resolveDesignTarget, unknownDesignMessage } from "./resolve-design.js";
export type { DesignCreatedDto } from "./port.js";
export { designIssues, isBlocking } from "./issues.js";
export type { DesignFacts, DesignIssue, DesignIssueCode, FrameFacts } from "./issues.js";
export type { DesignPort, LayoutFinding } from "./port.js";

/**
 * Agent 的设计工具。
 *
 * 这套工具存在的前提是:**设计稿是文件,而画布由人看**。所以工具做两件事 ——
 * 让 agent 知道文件现在的状态,以及让它**看见自己写出来的东西**。
 *
 * 质量闭环照抄 ppt 画像已经验证过的那套:
 *
 * > 确定性检查 → 渲染每一帧 → **看真实像素** → 记录复核 → 修,最多三轮 → 状态里没有
 * > 阻塞问题才算完成
 *
 * 这里是它的前两步(`design_inspect` 与 `design_screenshot`)加上状态查询
 * (`design_status`)。"最多三轮"写进了画像的 systemPrompt,不在工具里强制 —— 那是一个工作
 * 方式的约束,不是接口的约束。
 *
 * 风格那两条(`design_style_list` / `design_style_apply`)以及 `design_create` 的 `styleId`
 * 参数是 §14.22 加的:用户挑的风格**不再先落到工作区再由 agent 抄一遍**,而是由宿主直接写进
 * 设计包。`design_frames` 与 `design_export` 仍然没有 —— 声明了却跑不起来的工具比没有更糟。
 */

type ToolDetails = Record<string, unknown>;

/** 保留参数推断:每个工具的 `input` 由它的 schema 推出。 */
function tool<TParameters extends ReturnType<typeof Type.Object>>(
  definition: AgentTool<TParameters, ToolDetails>,
): AgentTool<TParameters, ToolDetails> {
  return definition;
}

function textResult(content: string, details: ToolDetails = {}): AgentToolResult<ToolDetails> {
  return { content: [{ type: "text", text: content }], details };
}

/**
 * "这是哪一份设计" —— `design_inspect` 与 `design_screenshot` 共用的第一步。
 *
 * 两者都只读,所以失败时要说的话是同一句:要么工作区里一份设计都没有(先去建),要么有好几
 * 份而调用方没指名(报出候选)。共用它是为了这两处不漂开。
 *
 * 注意它和 `design_status` **不共用**同一条路径:`design_status` 恰好是那个"用来看有哪些
 * 候选"的工具,所以它的歧义分支必须给出候选列表,而不是让调用方再去看别的什么。
 */
async function resolveTarget(
  port: DesignPort,
  explicit: string | undefined,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const designs = await port.list();
  const resolved = resolveDesignTarget({ explicit, designs });
  if (resolved.ok) return { ok: true, path: resolved.path };
  if (resolved.reason === "none") return { ok: false, message: NO_DESIGN_MESSAGE };
  return {
    ok: false,
    message: [
      `This workspace has ${designs.length} designs — pass \`path\`:`,
      describeDesigns(resolved.candidates),
    ].join("\n"),
  };
}

const NO_DESIGN_MESSAGE =
  "There is no design package in this workspace. Call design_create first — a design is a directory named x.wdesign holding design.json and frames/.";

export function createDesignTools(port: DesignPort): AgentTool[] {
  const status = tool({
    name: "design_status",
    label: "Read a design's state",
    description:
      "List the design packages in this workspace, or read one design's frames and problems. Call this before editing and after every change: the problems it reports are the deterministic half of the review, and anything it still reports means the work is not finished.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description:
            "Design package directory. Omit to use the only design in the workspace; if there are several, this reports them and asks you to name one.",
        }),
      ),
    }),
    async execute(_toolCallId: string, input: { path?: string }) {
      const designs = await port.list();
      const resolved = resolveDesignTarget({ explicit: input.path, designs });
      if (!resolved.ok) {
        if (resolved.reason === "none") return textResult(NO_DESIGN_MESSAGE, { designs: 0 });
        // 有多份时**列出来让模型选**,而不是替它挑一份 —— 挑错了它会去改另一份设计。
        return textResult(
          [
            `This workspace has ${designs.length} designs. Pass the one you mean as \`path\`, or omit \`path\` to mean "the only one".`,
            describeDesigns(resolved.candidates),
          ].join("\n"),
          { designs: designs.length },
        );
      }

      const facts = await port.read(resolved.path);
      if (facts === null) {
        return textResult(unknownDesignMessage(resolved.path, designs), { path: resolved.path });
      }

      const issues = designIssues(facts);
      return textResult(describeDesign(facts, issues), {
        path: facts.path,
        frameCount: facts.frames.length,
        issues: issues.map((issue) => issue.code),
        blocking: issues.some(isBlocking),
      });
    },
  });

  const create = tool({
    name: "design_create",
    label: "Create a design package",
    description:
      "Create a design package with one blank frame. Pass the frame size that matches what is being designed (a phone screen is 390×844, a laptop 1440×900) — it is only a fallback for frames that forget to declare their own size, but declaring it once here is what keeps that fallback honest. When the person picked a built-in style before starting, pass its `styleId` here: the tokens are written into the package as part of creation, so the first frame already has them.",
    parameters: Type.Object({
      name: Type.String({ description: "Design name, used for the directory name x.wdesign." }),
      title: Type.String({ description: "Title of the first frame, shown on the canvas." }),
      width: Type.Number({ minimum: 1, description: "Frame width in pixels." }),
      height: Type.Number({ minimum: 1, description: "Frame height in pixels." }),
      styleId: Type.Optional(
        Type.String({
          description:
            "Built-in style id, from design_style_list or from the person's pick in the first message. Unknown ids fall back to the default tokens.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      input: { name: string; title: string; width: number; height: number; styleId?: string },
    ) {
      const created = await port.create({
        name: input.name,
        title: input.title,
        frameWidth: input.width,
        frameHeight: input.height,
        ...(input.styleId === undefined ? {} : { styleId: input.styleId }),
      });
      if (created === null) return textResult("Could not create the design package.", { created: false });
      /**
       * 风格 id 认不出来时**要说出来**。
       *
       * 宿主那边是"解析不到就退回默认令牌,而不是拒绝建包" —— 那是对的(建包不该因为一个 id
       * 拼错就失败),但代价是模型会以为风格已经生效了,然后照着默认令牌一路写下去。所以这里
       * 拿库里的 id 核一遍,不匹配就说清楚,并把可用的 id 列出来。
       */
      const appliedStyleId = input.styleId ?? null;
      const styleKnown =
        appliedStyleId === null || (await port.listStyles()).some((style) => style.id === appliedStyleId);
      /**
       * **每一处路径都带目录,而且相对工作区根。**
       *
       * 原来这里给的是绝对路径,紧接着说 "Read theme.css" —— 不带目录。模型照做了三次,三次
       * 都是 ENOENT(它去读的是工作区根下那个 `theme.css`),然后它把 theme.css 与
       * frames/index.html 写到了包外面。那一整次会话的产出就是这样丢的。
       */
      const dir = created.path.split(/[\\/]/).pop() ?? created.path;
      const lines = [
        // 重名先说:它改变了"这是哪一份设计"这个前提。
        ...(created.rename === null
          ? []
          : [
              `Note: \`${created.rename.requested}.wdesign\` already existed, so this is a SECOND, EMPTY design at \`${created.rename.actual}.wdesign\`. If you meant to continue the existing one, call design_status and work on that one instead.`,
              "",
            ]),
        `Created ${created.path}.`,
        "",
        ...(appliedStyleId === null
          ? []
          : styleKnown
            ? [
                `It starts from the \`${appliedStyleId}\` style: \`${dir}/theme.css\` and \`${dir}/DESIGN.md\` already hold that style's tokens and spec. Read them before writing any styling, and do not replace them.`,
                "",
              ]
            : [
                `Note: there is no style called \`${appliedStyleId}\`, so this package got the default tokens. Call design_style_list for the real ids, and design_style_apply to change it now (before writing frames).`,
                "",
              ]),
        `Every path below is relative to the workspace root, and \`${dir}\` is part of it:`,
        `- the manifest is \`${dir}/design.json\` — read it, never edit it`,
        `- the tokens are \`${dir}/theme.css\` — read this before writing any styling`,
        `- the first frame is \`${dir}/frames/${created.frameId}.html\`, with a @frame declaration for ${input.width}×${input.height}`,
        "",
        `Frames reference \`../theme.css\` and \`../assets/...\` — keep those exactly as they are; the same relative paths hold when the frame is rendered.`,
        `Keep the @frame declaration at the top of every frame file.`,
      ];
      return textResult(lines.join("\n"), { created: true, path: created.path, frameId: created.frameId });
    },
  });

  const inspect = tool({
    name: "design_inspect",
    label: "Run layout checks on frames",
    description:
      "Run deterministic layout checks on one or more frames: content overflowing its box, text cut off without an ellipsis, nowrap text wider than its parent, row items wider than their row, painted surfaces clipped by a parent. Returns coordinate facts, not opinions. Run this once a batch of structural changes is in place (not after each edit); an empty result means none of these known failure shapes are present, not that the design looks right — use design_screenshot for that.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Design package directory. Omit to use the only design in the workspace." }),
      ),
      frameIds: Type.Optional(
        Type.Array(Type.String(), { description: "Frames to check. Omit to check every frame." }),
      ),
    }),
    async execute(_toolCallId: string, input: { path?: string; frameIds?: string[] }) {
      const target = await resolveTarget(port, input.path);
      if (!target.ok) return textResult(target.message, { findings: 0 });

      const facts = await port.read(target.path);
      if (facts === null) {
        return textResult(unknownDesignMessage(target.path, await port.list()), { path: target.path });
      }
      const frameIds = input.frameIds && input.frameIds.length > 0 ? input.frameIds : facts.frames.map((frame) => frame.id);
      if (frameIds.length === 0) return textResult("This design has no frames to check.", { findings: 0 });

      const findings = await port.inspect(target.path, frameIds);
      if (findings.length === 0) {
        return textResult(
          `Checked ${frameIds.length} frame(s): no layout problems from the known shapes. This is not the same as looking right — take a screenshot too.`,
          { findings: 0, frameIds },
        );
      }
      const lines = findings.map(
        (finding) => `- [${finding.kind}] ${finding.selector}: ${finding.detail}`,
      );
      return textResult(
        [`Found ${findings.length} layout problem(s):`, ...lines, "", "Fix these before taking a screenshot."].join("\n"),
        { findings: findings.length, frameIds },
      );
    },
  });

  const screenshot = tool({
    name: "design_screenshot",
    label: "Look at a frame",
    description:
      "Render a frame offscreen and return the actual pixels. Use this to check the design the way the person you are working with will see it — type, spacing, alignment, colour. You cannot judge those from markup. Take one after the layout checks pass, and again after fixing anything it shows.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Design package directory. Omit to use the only design in the workspace." }),
      ),
      frameId: Type.String({ description: "Frame to render." }),
    }),
    async execute(_toolCallId: string, input: { path?: string; frameId: string }) {
      const target = await resolveTarget(port, input.path);
      if (!target.ok) return textResult(target.message, { ok: false, frameId: input.frameId });

      const shot = await port.screenshot(target.path, input.frameId);
      if (!shot.ok) {
        return textResult(
          `Could not render ${input.frameId}: ${shot.reason}. Call design_status to see the frames this design actually has.`,
          { ok: false, frameId: input.frameId },
        );
      }
      return {
        content: [
          { type: "text", text: `Rendered ${input.frameId}. Look at it, not at the markup.` },
          { type: "image", data: shot.data, mimeType: shot.mimeType },
        ],
        details: { ok: true, frameId: input.frameId },
      };
    },
  });

  /**
   * 风格库列表。
   *
   * **不回正文**:一份 `theme.css` + `DESIGN.md` 是几 KB,29 套一起进上下文是纯浪费。它只回答
   * "有哪几套、各是什么方向";真正落进设计包是 `design_style_apply` / `design_create(styleId)`
   * 的事,宿主做。
   */
  const styleList = tool({
    name: "design_style_list",
    label: "List the built-in styles",
    description:
      "List the built-in design styles: id, name, and one line describing what it looks like. Use this when the person asked for a style but did not pick one — offer them a few with request_user_input instead of choosing by yourself. Pass a style id to design_create (or design_style_apply) to actually use it.",
    parameters: Type.Object({}),
    async execute() {
      const styles = await port.listStyles();
      if (styles.length === 0) return textResult("No built-in styles are available.", { styles: 0 });
      return textResult(
        [`${styles.length} built-in styles:`, ...styles.map((style) => `- ${style.id} — ${style.name}: ${style.tagline}`)].join("\n"),
        { styles: styles.length },
      );
    },
  });

  /**
   * 把一套风格应用到**已有**设计上。
   *
   * 新建时不要用它 —— `design_create({ styleId })` 一步就位,而且不会覆盖任何东西。这个工具存在
   * 是为了"用户明确要换风格"那条路,以及补上"忘了在建包时带上风格"。
   */
  const styleApply = tool({
    name: "design_style_apply",
    label: "Apply a built-in style to a design",
    description:
      "Apply a built-in style: overwrites the design's theme.css and DESIGN.md and records the style in the manifest. The whole design is backed up first (under .build/style-backup/). Prefer passing styleId to design_create when starting a new design — frames written before this call keep the old tokens, and framesNeedRestyle tells you when that is the case.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Design package directory. Omit to use the only design in the workspace." }),
      ),
      styleId: Type.String({ description: "Built-in style id, from design_style_list or from the person's pick." }),
    }),
    async execute(_toolCallId: string, input: { path?: string; styleId: string }) {
      const target = await resolveTarget(port, input.path);
      if (!target.ok) return textResult(target.message, { applied: false });
      const applied = await port.applyStyle(target.path, input.styleId);
      if (applied === null) {
        const styles = await port.listStyles();
        return textResult(
          `Could not apply the style \`${input.styleId}\` to ${target.path}.${styles.some((style) => style.id === input.styleId) ? "" : ` No such style — available ids: ${styles.map((style) => style.id).join(", ")}.`}`,
          { applied: false },
        );
      }
      return textResult(
        [
          `Applied \`${applied.styleId}\` to ${target.path}. Its theme.css and DESIGN.md now come from that style, and the previous ones are in ${target.path}/.build/style-backup/.`,
          applied.framesNeedRestyle
            ? "This design already has frames, and they were written against the previous tokens — they will not restyle themselves. Tell the person what changed and check the frames that depend on the old tokens."
            : "It had no frames yet, so there is nothing to restyle: write the first frame against these tokens.",
        ].join("\n"),
        { applied: true, styleId: applied.styleId, framesNeedRestyle: applied.framesNeedRestyle },
      );
    },
  });

  return [status, create, inspect, screenshot, styleList, styleApply];
}

/**
 * 样式表的状态。**这一行是必须的。**
 *
 * 构建没跟上时帧会一条样式都不生效,而截图看起来只是"这个设计很朴素" —— agent 拿不到
 * 任何理由,就会照着白页改颜色、改间距。说清楚是"样式表还没编出来",而不是"你写得不好",
 * 是这条信息唯一的用处。
 */
function stylesLine(styles: DesignStylesFactsDto): string {
  switch (styles.state) {
    case "fresh":
      return "Stylesheet: built and up to date with the frames.";
    case "never":
      return "Stylesheet: NOT BUILT YET — nothing in theme.css or the frames has any effect right now. It is compiled on the next refresh, so screenshot a frame (or call design_status again in a moment) before judging how it looks.";
    case "stale":
      return "Stylesheet: STALE — the frames changed after the last build, so utility classes you just added do not exist yet. The next refresh rebuilds it.";
    case "failed":
      return `Stylesheet: BUILD FAILED (${styles.detail ?? "no detail"}). Styles from the last good build are still in effect, so new classes will not appear. Report this instead of editing around it.`;
    default:
      return "Stylesheet: unknown state.";
  }
}

function describeDesign(facts: DesignFactsDto, issues: readonly DesignIssue[]): string {
  const lines = [
    `${facts.path} (${facts.mode}${facts.style === null ? ", no style applied" : `, style ${facts.style}`})`,
    stylesLine(facts.styles),
  ];

  if (facts.frames.length === 0) {
    lines.push("No frames.");
  } else {
    lines.push(`Frames (${facts.frames.length}):`);
    for (const frame of facts.frames) {
      const size = frame.declaredSize ? "" : " — no @frame declaration, size falls back";
      lines.push(`- ${frame.id}: "${frame.title}" (${frame.file})${size}`);
    }
  }

  if (issues.length > 0) {
    lines.push("", `Problems (${issues.length}):`);
    for (const issue of issues) {
      const scope = issue.frameId === null ? "design" : issue.frameId;
      lines.push(`- [${issue.code}] ${scope}: ${issue.message}`);
    }
    lines.push(
      "",
      issues.some(isBlocking)
        ? "There are blocking problems. Not finished yet."
        : "No blocking problems. Take a screenshot of the frames you changed before finishing.",
    );
  } else {
    lines.push("", "No problems found. Take a screenshot of the frames you changed before finishing.");
  }

  return lines.join("\n");
}
