import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createDocumentTools } from "@wordless/capability-documents";
import { codingProfile } from "@wordless/profile-coding";
import { dataProfile } from "@wordless/profile-data";
import { excelProfile } from "@wordless/profile-excel";
import { generalProfile } from "@wordless/profile-general";
import { pptProfile } from "@wordless/profile-ppt";
import { uiProfile } from "@wordless/profile-ui";

/**
 * 工具**装配了**不等于模型**看得见**。
 *
 * `AgentHarness` 只用 `profile.activeToolNames` 里声明过的名字去取工具
 * (`packages/agent/src/harness/agent-harness.ts` 里那句
 * `this.activeToolNames.map((name) => this.tools.get(name)).filter(...)`)。
 * 所以"在 `create-runtime.ts` 里装配、却忘了写进 profile"的结果是:工具静默消失 ——
 * **不报错、日志里也没有**,只有模型自己说"我没有这个工具"。
 *
 * 与 OCR 那条同类测试的区别:这里**直接 import 能力包**读真实工具名,而不是抄一份字面量。
 * 本包是唯一能被 `node --test` 加载的能力包(`port.ts` 只有类型,于是它没有运行时的相对
 * 导入),所以工具名的"真相"可以直接来自实现 —— 名字改了这里就会红。
 */

const DOCUMENT_TOOL_NAMES = createDocumentTools({} as never).map((tool) => tool.name);

/**
 * `create-runtime.ts` 把文档工具装配给了这两个驱动:
 * - 通用驱动 → `general` / `data` / `ui` 三个 profile
 * - 编码驱动 → `coding`
 * 表格(`excel`)与演示(`ppt`)没有装配,所以这里也不要求它们声明。
 */
const PROFILES_THAT_WIRE_DOCUMENTS = [
  ["general", generalProfile],
  ["coding", codingProfile],
  ["data", dataProfile],
  ["ui", uiProfile],
] as const;

describe("文档工具在 profile 白名单里声明过", () => {
  it("能力包导出的工具名就是我们期望的这三个", () => {
    assert.deepEqual(DOCUMENT_TOOL_NAMES, ["extract_text_from_pdf", "extract_text_from_docx", "fetch_url"]);
  });

  it("装配了它的每个 profile 都声明了它 —— 否则模型完全看不见", () => {
    for (const [name, profile] of PROFILES_THAT_WIRE_DOCUMENTS) {
      for (const toolName of DOCUMENT_TOOL_NAMES) {
        assert.ok(
          profile.activeToolNames.includes(toolName),
          `${name} profile 装配了 ${toolName} 却没在 activeToolNames 里声明:模型看不到它,而且不会报错`,
        );
      }
    }
  });

  it("没有装配它的 profile 不要声明(声明了却跑不起来,harness 会抛 Unknown tool)", () => {
    // 表格与演示走的是各自的驱动,没有接文档工具。哪天接上了,把这两个挪到上面的表里。
    for (const toolName of DOCUMENT_TOOL_NAMES) {
      assert.equal(excelProfile.activeToolNames.includes(toolName), false);
      assert.equal(pptProfile.activeToolNames.includes(toolName), false);
    }
  });

  it("两个工具都具备风格一致的公共图标", () => {
    for (const toolName of DOCUMENT_TOOL_NAMES) {
      const iconPath = path.resolve(import.meta.dirname, `../src/icons/common-icons/${toolName}.svg`);
      assert.ok(fs.existsSync(iconPath), `缺少 ${toolName}.svg 图标`);
      const content = fs.readFileSync(iconPath, "utf8");
      assert.match(content, /viewBox="0 0 1024 1024"/);
      assert.match(content, /<svg/);
      assert.match(content, /<\/svg>/);
    }
  });

  it("两个工具都进了渲染层的图标映射(否则会静默退化成通用扳手)", () => {
    const registry = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/features/workbench/renderer-registry.tsx"),
      "utf8",
    );
    for (const toolName of DOCUMENT_TOOL_NAMES) {
      assert.ok(
        new RegExp(`^\\s*${toolName}: \\{`, "m").test(registry),
        `renderer-registry 里缺少 ${toolName} 的图标映射`,
      );
      assert.ok(
        registry.includes(`common-icons/${toolName}.svg`),
        `renderer-registry 里没有 import ${toolName}.svg`,
      );
    }
  });
});
