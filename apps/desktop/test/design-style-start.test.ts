import assert from "node:assert/strict";
import test from "node:test";
import { designStyleStartParts } from "../src/renderer/features/design/style-start.ts";

/**
 * 挑了一套风格之后,第一条消息里带什么。
 *
 * 这两条断言对着的是两个真实约束:**资料落盘**之后 agent 才读得到(所以引用要指向真路径),以及
 * 顺序由主进程给的那份文件清单决定(它才决定先读哪一份)。
 */

test("落盘的资料变成工作区引用,路径按落点拼", () => {
  assert.deepEqual(
    designStyleStartParts({ dir: "design-resources/precise-dark", files: ["theme.css", "DESIGN.md"] }),
    [
      { type: "workspace-reference", kind: "file", name: "theme.css", path: "design-resources/precise-dark/theme.css" },
      { type: "workspace-reference", kind: "file", name: "DESIGN.md", path: "design-resources/precise-dark/DESIGN.md" },
    ],
  );
});

test("一份文件都没落下来时不给引用", () => {
  // 主进程写失败会让调用方根本走不到这里(它会拦住建会话),但空清单也不该凑出个空引用。
  assert.deepEqual(designStyleStartParts({ dir: "design-resources/x", files: [] }), []);
});

test("顺序照主进程给的走,不在这里重排", () => {
  const parts = designStyleStartParts({ dir: "design-resources/linear", files: ["DESIGN.md", "theme.css"] });
  assert.deepEqual(parts.map((part) => (part.type === "workspace-reference" ? part.name : "")), ["DESIGN.md", "theme.css"]);
});
