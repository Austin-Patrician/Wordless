import assert from "node:assert/strict";
import test from "node:test";

import type { MessageToolBlock } from "@wordless/domain";
import { messages } from "../src/renderer/shared/i18n.ts";
import {
  activityState,
  toolCompletedWarning,
  toolDisplayName,
  toolExitCode,
  toolRowDetail,
  toolRowSummary,
} from "../src/renderer/features/workbench/tool-row-presentation.ts";

/**
 * 工具行的话术。
 *
 * 这些函数是从**现场渲染**里抽出来的(`renderer-registry.tsx` 的代码工作台工具行),
 * 现在同时被现场与导出预览/Markdown 调用 —— 抽出来就得钉住:现场那行话怎么说,导出就怎么说。
 * 抽错一个字,两边一起错,而且只有肉眼能发现。
 */

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

function tool(parts: Partial<MessageToolBlock> & { name: string }): MessageToolBlock {
  return { type: "tool", callId: `call-${parts.name}`, state: "complete", ...parts } as MessageToolBlock;
}

test("行中间那格:命令优先,其次是模式+路径,最后是路径;都没有就是 undefined", () => {
  assert.equal(toolRowDetail(tool({ name: "bash", input: { command: "pnpm test" } }), zh), "pnpm test");
  assert.equal(toolRowDetail(tool({ name: "read", input: { path: "src/a.ts" } }), zh), "src/a.ts");
  assert.equal(
    toolRowDetail(tool({ name: "grep", input: { pattern: "TODO", path: "src" } }), zh),
    '"TODO" 在 src 中',
  );
  assert.equal(toolRowDetail(tool({ name: "grep", input: { pattern: "TODO" } }), zh), '"TODO"');
  // input 缺失时退到 details —— 与现场同一套取值。
  assert.equal(toolRowDetail(tool({ name: "read", details: { path: "src/b.ts" } }), zh), "src/b.ts");
  assert.equal(toolRowDetail(tool({ name: "read" }), zh), undefined);
});

test("行右侧那格:退出码优先 —— 那是「完成但失败」的唯一线索", () => {
  assert.equal(
    toolRowSummary(tool({ name: "bash", input: { command: "exit 1" }, details: { exitCode: 1 } }), zh),
    "退出码 1",
  );
  // 退出码为 0 不算告警,继续看别的线索。
  assert.equal(toolRowSummary(tool({ name: "bash", details: { exitCode: 0 } }), zh), undefined);
  assert.equal(toolRowSummary(tool({ name: "read", details: { lineCount: 42 } }), zh), "已读取 42 行");
  assert.equal(toolRowSummary(tool({ name: "grep", details: { count: 3 } }), zh), "3 个匹配");
  // 还有下一页时补一个 `+`:数字是"至少这么多"。
  assert.equal(
    toolRowSummary(tool({ name: "grep", details: { count: 3, nextCursor: "next" } }), zh),
    "3 个匹配+",
  );
  assert.equal(toolRowSummary(tool({ name: "find", details: { count: 7 } }), zh), "已找到 7 个文件");
  // 没有结果线索时落到状态词;完成没有状态词(行尾图标已经说了)。
  assert.equal(toolRowSummary(tool({ name: "read" }), zh), undefined);
  assert.equal(toolRowSummary(tool({ name: "read", state: "error" }), zh), "失败");
  assert.equal(toolRowSummary(tool({ name: "read", state: "running" }), zh), "运行中");
});

test("状态词覆盖全部非完成态", () => {
  assert.equal(activityState(tool({ name: "x", state: "pending" }), zh), "等待执行");
  assert.equal(activityState(tool({ name: "x", state: "awaiting-approval" }), zh), "等待审批");
  assert.equal(activityState(tool({ name: "x", state: "awaiting-user-input" }), zh), "等待输入");
  assert.equal(activityState(tool({ name: "x", state: "running" }), zh), "运行中");
  assert.equal(activityState(tool({ name: "x", state: "error" }), zh), "失败");
  assert.equal(activityState(tool({ name: "x", state: "complete" }), zh), undefined);
});

test("退出码:0 是「拿到了且成功」,拿不到才是 undefined", () => {
  assert.equal(toolExitCode(tool({ name: "bash", details: { exitCode: 0 } })), 0);
  assert.equal(toolExitCode(tool({ name: "bash", details: { exitCode: 2 } })), 2);
  assert.equal(toolExitCode(tool({ name: "bash" })), undefined);
  assert.equal(toolCompletedWarning(tool({ name: "bash", details: { exitCode: 0 } })), false);
  assert.equal(toolCompletedWarning(tool({ name: "bash", details: { exitCode: 2 } })), true);
});

test("MCP 工具显示连接器名 —— 用户认的是连接器,不是工具内部名", () => {
  assert.equal(toolDisplayName(tool({ name: "mcp_call" })), "mcp_call");
  assert.equal(
    toolDisplayName(
      tool({
        name: "mcp_call",
        source: {
          kind: "mcp",
          connectorId: "c1",
          connectorName: "Notion",
          toolName: "search",
          templateId: "notion",
          transport: "stdio",
        } as MessageToolBlock["source"],
      }),
    ),
    "Notion",
  );
});
