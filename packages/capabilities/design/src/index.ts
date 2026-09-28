import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import { designIssues, isBlocking, type DesignFacts, type DesignIssue } from "./issues.js";
import type { DesignPort } from "./port.js";
export { LAYOUT_PROBE_EXPRESSION } from "./probe-script.js";
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
 * (`design_status`)。"最多三轮"写进了画像的 systemPrompt,不在工具里强制 —— 那是一个
 * 工作方式的约束,不是接口的约束。
 *
 * `design_style_*` 与 `design_export` **尚未实现**(见 docs/architecture/design-canvas.md 的
 * P6/P7),所以这里刻意不声明它们:声明了却跑不起来的工具比没有更糟。
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

const NO_DESIGN_MESSAGE =
  "There is no design package in this workspace. Call design_create first — a design is a directory named x.wdesign holding design.json and frames/.";

export function createDesignTools(port: DesignPort): AgentTool[] {
  const status = tool({
    name: "design_status",
    label: "Read a design's state",
    description:
      "List the design packages in this workspace, or read one design's frames and problems. Call this before editing and after every change: the problems it reports are the deterministic half of the review, and anything it still reports means the work is not finished.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Design package directory. Omit to list what exists." })),
    }),
    async execute(_toolCallId: string, input: { path?: string }) {
      let target = input.path;
      if (target === undefined) {
        const designs = await port.list();
        if (designs.length === 0) return textResult(NO_DESIGN_MESSAGE, { designs: 0 });
        if (designs.length > 1) {
          // 有多份时**列出来让模型选**,而不是替它挑一份 —— 挑错了它会去改另一份设计。
          const lines = designs.map((design) => `- ${design.path} (${design.frameCount} frames)`);
          return textResult(
            [`This workspace has ${designs.length} designs. Pass the one you mean:`, ...lines].join("\n"),
            { designs: designs.length },
          );
        }
        target = designs[0]?.path;
        if (target === undefined) return textResult(NO_DESIGN_MESSAGE, { designs: 0 });
      }

      const facts = await port.read(target);
      if (facts === null) {
        return textResult(`${target} is not a design package (no readable design.json).`, { path: target });
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
      "Create a design package with one blank frame. Pass the frame size that matches what is being designed (a phone screen is 390×844, a laptop 1440×900) — it is only a fallback for frames that forget to declare their own size, but declaring it once here is what keeps that fallback honest.",
    parameters: Type.Object({
      name: Type.String({ description: "Design name, used for the directory name x.wdesign." }),
      title: Type.String({ description: "Title of the first frame, shown on the canvas." }),
      width: Type.Number({ minimum: 1, description: "Frame width in pixels." }),
      height: Type.Number({ minimum: 1, description: "Frame height in pixels." }),
    }),
    async execute(_toolCallId: string, input: { name: string; title: string; width: number; height: number }) {
      const created = await port.create({
        name: input.name,
        title: input.title,
        frameWidth: input.width,
        frameHeight: input.height,
      });
      if (created === null) return textResult("Could not create the design package.", { created: false });
      return textResult(
        [
          `Created ${created.path}.`,
          `Its first frame is frames/${created.frameId}.html with a @frame declaration for ${input.width}×${input.height}.`,
          "Read theme.css before writing any styling, and keep the @frame declaration at the top of every frame file.",
        ].join("\n"),
        { created: true, path: created.path, frameId: created.frameId },
      );
    },
  });

  const inspect = tool({
    name: "design_inspect",
    label: "Run layout checks on frames",
    description:
      "Run deterministic layout checks on one or more frames: content overflowing its box, text cut off without an ellipsis, nowrap text wider than its parent, row items wider than their row, painted surfaces clipped by a parent. Returns coordinate facts, not opinions. Run this once a batch of structural changes is in place (not after each edit); an empty result means none of these known failure shapes are present, not that the design looks right — use design_screenshot for that.",
    parameters: Type.Object({
      path: Type.String({ description: "Design package directory." }),
      frameIds: Type.Optional(
        Type.Array(Type.String(), { description: "Frames to check. Omit to check every frame." }),
      ),
    }),
    async execute(_toolCallId: string, input: { path: string; frameIds?: string[] }) {
      const facts = await port.read(input.path);
      if (facts === null) {
        return textResult(`${input.path} is not a design package.`, { path: input.path });
      }
      const frameIds = input.frameIds && input.frameIds.length > 0 ? input.frameIds : facts.frames.map((frame) => frame.id);
      if (frameIds.length === 0) return textResult("This design has no frames to check.", { findings: 0 });

      const findings = await port.inspect(input.path, frameIds);
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
      path: Type.String({ description: "Design package directory." }),
      frameId: Type.String({ description: "Frame to render." }),
    }),
    async execute(_toolCallId: string, input: { path: string; frameId: string }) {
      const shot = await port.screenshot(input.path, input.frameId);
      if (!shot.ok) {
        return textResult(`Could not render ${input.frameId}: ${shot.reason}`, { ok: false, frameId: input.frameId });
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

  return [status, create, inspect, screenshot];
}

function describeDesign(facts: DesignFacts, issues: readonly DesignIssue[]): string {
  const lines = [
    `${facts.path} (${facts.mode}${facts.style === null ? ", no style applied" : `, style ${facts.style}`})`,
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
