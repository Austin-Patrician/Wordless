import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { codingProfile } from "@wordless/profile-coding";
import { excelProfile } from "@wordless/profile-excel";
import { pptProfile } from "@wordless/profile-ppt";
import { dataProfile } from "@wordless/profile-data";
import { generalProfile } from "@wordless/profile-general";
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
 * 文字识别就这么漏过一次(问 agent 有哪些工具,列表里没有 `extract_text_from_image`)。
 * 这条测试就是钉住这件事:凡是装配了它的 profile,必须同时声明它。
 *
 * 反向的那一半由 harness 自己保证:声明了却没有实现会直接抛 `Unknown tool(s)`。
 */

/**
 * 工具名。
 *
 * 这里**故意写字符串而不是从能力包 import**:能力包内部用的是打包器风格的 `.js` 相对导入
 * (`./port.js`),`node --test` 直接加载不了它(vitest 可以)。所以名字的"真相"由
 * `packages/capabilities/ocr/test/tools.test.ts` 钉住(它断言导出的工具名就是这个字符串),
 * 这条测试负责另一半:装配了它的 profile 必须声明它。
 */
const OCR_TOOL_NAMES = ["extract_text_from_image"];

/**
 * `create-runtime.ts` 把 OCR 工具装配给了这两个驱动:
 * - 通用驱动 → `general` / `data` / `ui` 三个 profile
 * - 编码驱动 → `coding`
 * 表格(`excel`)与演示(`ppt`)没有装配,所以这里也不要求它们声明。
 */
const PROFILES_THAT_WIRE_OCR = [
  ["general", generalProfile],
  ["coding", codingProfile],
  ["data", dataProfile],
  ["ui", uiProfile],
] as const;

describe("OCR 工具在 profile 白名单里声明过", () => {
  it("能力包导出的工具名是我们期望的那一个", () => {
    assert.deepEqual(OCR_TOOL_NAMES, ["extract_text_from_image"]);
  });

  it("装配了它的每个 profile 都声明了它 —— 否则模型完全看不见", () => {
    for (const [name, profile] of PROFILES_THAT_WIRE_OCR) {
      for (const toolName of OCR_TOOL_NAMES) {
        assert.ok(
          profile.activeToolNames.includes(toolName),
          `${name} profile 装配了 ${toolName} 却没在 activeToolNames 里声明:模型看不到它,而且不会报错`,
        );
      }
    }
  });

  it("没有装配它的 profile 不要声明(声明了却跑不起来,harness 会抛 Unknown tool)", () => {
    // 表格与演示目前没有接 OCR 工具。哪天接上了,把这两个 profile 挪到上面的表里。
    for (const toolName of OCR_TOOL_NAMES) {
      assert.equal(excelProfile.activeToolNames.includes(toolName), false);
      assert.equal(pptProfile.activeToolNames.includes(toolName), false);
    }
  });

  it("extract_text_from_image 具备风格一致的公共图标", () => {
    const iconPath = path.resolve(
      import.meta.dirname,
      "../src/icons/common-icons/extract_text_from_image.svg",
    );
    assert.ok(fs.existsSync(iconPath), "缺少 extract_text_from_image.svg 图标");
    const content = fs.readFileSync(iconPath, "utf8");
    assert.match(content, /viewBox="0 0 1024 1024"/);
    assert.match(content, /<svg/);
    assert.match(content, /<\/svg>/);
  });
});
