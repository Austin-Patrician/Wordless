import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createKnowledgeReadTools, createKnowledgeWriteTools } from "@wordless/capability-knowledge";
import { codingProfile } from "@wordless/profile-coding";
import { dataProfile } from "@wordless/profile-data";
import { excelProfile } from "@wordless/profile-excel";
import { generalProfile } from "@wordless/profile-general";
import { knowledgeProfile } from "@wordless/profile-knowledge";
import { pptProfile } from "@wordless/profile-ppt";
import { uiProfile } from "@wordless/profile-ui";

/**
 * 知识库工具的**分组**与**声明**。
 *
 * 这里钉的是那条设计判断:**读是能力,写是纪律**。
 *   - 读工具(查页、查词表)进每一个画像 —— 只读、不产生累积损伤,而"关于 X 我们知道什么"
 *     对每种工作类型都有用;
 *   - 写工具只在 `knowledge` 画像上装配 —— 没有约定的写入会让知识库碎片化(近重复的概念页、
 *     发散的标签),而那个损伤累积且难回滚。
 *
 * 第二半同样重要:装配了却忘了声明 = 工具静默消失(harness 只按 `activeToolNames` 取工具),
 * 所以每个装配了 KB 工具的画像都必须在这里被点名。
 *
 * 反过来那一半(声明了却没装配)**不再抛错**:驱动会把没装上的名字丢掉。因为可选能力真的
 * 可能不在 —— 知识库开关一关,`create-runtime.ts` 就不给 `kb_query` / `kb_list_tags`,
 * 而那时抛错意味着**每个会话都起不来**(一个设置开关把应用弄坏)。
 * 见 `packages/agent-driver-generic/test/declared-tools.test.ts`。
 */

const READ_TOOL_NAMES = createKnowledgeReadTools({} as never).map((tool) => tool.name);
const WRITE_TOOL_NAMES = createKnowledgeWriteTools({} as never).map((tool) => tool.name);

/** `create-runtime.ts` 把读工具装配给了全部四个驱动,所以每个画像都该声明它们。 */
const ALL_PROFILES = [
  ["general", generalProfile],
  ["coding", codingProfile],
  ["data", dataProfile],
  ["ui", uiProfile],
  ["ppt", pptProfile],
  ["excel", excelProfile],
] as const;

/**
 * 按驱动工厂切块。
 *
 * **必须切块**:四个驱动共处一个 `createAgentDriverRegistry([...])` 里,一句
 * `source.includes(...)` 会被别的驱动的同名代码满足 —— 那是这个仓库踩过的坑
 * (见 `release-publishing.test.ts`)。
 */
function driverBlocks(source: string): Array<[string, string]> {
  const factories = ["createGenericAgentDriver", "createCodingAgentDriver", "createPresentationAgentDriver", "createSpreadsheetAgentDriver"];
  const starts = factories.map((factory) => source.indexOf(`${factory}(`));
  return factories.map((factory, index) => {
    const start = starts[index]!;
    const end = index + 1 < starts.length ? starts[index + 1]! : source.length;
    return [factory, source.slice(start, end)];
  });
}

describe("知识库工具的读/写分组", () => {
  it("能力包导出的名字就是我们期望的那几个", () => {
    assert.deepEqual(READ_TOOL_NAMES, ["kb_query", "kb_list_tags"]);
    assert.deepEqual(WRITE_TOOL_NAMES, ["kb_write_page", "kb_retire_page"]);
  });

  it("读工具进每一个画像 —— 每个 agent 都该能查知识库", () => {
    for (const [name, profile] of ALL_PROFILES) {
      for (const toolName of READ_TOOL_NAMES) {
        assert.ok(profile.activeToolNames.includes(toolName), `${name} 没有声明 ${toolName}:模型看不到它,而且不会报错`);
      }
    }
  });

  it("写工具只在知识库画像上 —— 别处只读", () => {
    for (const toolName of WRITE_TOOL_NAMES) {
      assert.ok(knowledgeProfile.activeToolNames.includes(toolName), `knowledge 画像必须能写`);
      for (const [name, profile] of ALL_PROFILES) {
        assert.equal(
          profile.activeToolNames.includes(toolName),
          false,
          `${name} 不该有 ${toolName}:写工具与加工约定成对出现,而这个画像没有加载约定`,
        );
      }
    }
  });

  it("整理画像的工具面里没有 bash / write / edit", () => {
    // 这三条是机制而不是偏好:bash 绕过应用层的路径守卫(它走规则匹配),所以"不给 bash"
    // 才是"raws 改不了"的真正保证;页面只能经 kb_write_page,而它守 schema、拒写 raws/**。
    for (const toolName of ["bash", "write", "edit"]) {
      assert.equal(knowledgeProfile.activeToolNames.includes(toolName), false, `knowledge 画像不该有 ${toolName}`);
    }
    // 但它必须能读原始文件 —— 否则什么都加工不了。
    for (const toolName of ["read", "extract_text_from_pdf", "extract_text_from_docx", "extract_text_from_image"]) {
      assert.ok(knowledgeProfile.activeToolNames.includes(toolName), `knowledge 画像需要 ${toolName}`);
    }
  });

  it("整理画像加载了加工约定(skill),而且那个 skill 真的存在", () => {
    const declared = knowledgeProfile.skills.map((skill) => skill.id);
    assert.deepEqual(declared, ["kb-processing"]);
    const skillPath = path.resolve(import.meta.dirname, "../resources/skills/kb-processing/SKILL.md");
    assert.ok(fs.existsSync(skillPath), "缺少 kb-processing skill:整理画像会没有约定可用");
    const content = fs.readFileSync(skillPath, "utf8");
    // skill 的名字取自 frontmatter,必须与画像里声明的 id 一致。
    assert.match(content, /^---\nname: kb-processing\n/);
  });

  it("四个驱动都装配了读工具 —— 声明了但没装配,修好之后是**静默少一个工具**", () => {
    // 修复"关掉知识库 = 会话起不来"之后,声明的名字若没装上也就不再抛错了(驱动会丢掉)。
    // 好处是应用不会坏,代价是**漏装配变成了静默的** —— 所以这一半必须由测试钉住。
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/bootstrap/create-runtime.ts"), "utf8");
    const blocks = driverBlocks(source);
    for (const [driver, block] of blocks) {
      assert.ok(
        block.includes("knowledgeReadToolsFor()"),
        `${driver} 没有装配知识库读工具:画像里声明了,却会被静默丢掉`,
      );
    }
    assert.equal(blocks.length, 4, "驱动数量变了 —— 新增驱动要自己决定是否装配读工具");
  });

  it("写工具只装配给整理画像 —— 而且是**装配处**就带条件,不是靠画像自律", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/bootstrap/create-runtime.ts"), "utf8");
    const occurrences = source.split("knowledgeWriteToolsFor()").length - 1;
    assert.equal(occurrences, 1, "写工具只该在通用驱动的装配里出现一次");
    // 唯一那处必须与画像判断写在同一个表达式里。
    assert.match(
      source,
      /context\.profile\.reference\.id === "knowledge" \? knowledgeWriteToolsFor\(\) : \[\]/,
      "写工具的装配条件不见了:没有纪律的写入会让知识库碎片化",
    );
  });

  it("三个工具都有公共图标,并且进了渲染层的图标映射", () => {
    const registry = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/features/workbench/renderer-registry.tsx"),
      "utf8",
    );
    for (const toolName of [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]) {
      const iconPath = path.resolve(import.meta.dirname, `../src/icons/common-icons/${toolName}.svg`);
      assert.ok(fs.existsSync(iconPath), `缺少 ${toolName}.svg 图标`);
      assert.match(fs.readFileSync(iconPath, "utf8"), /viewBox="0 0 1024 1024"/);
      assert.ok(new RegExp(`^\\s*${toolName}: \\{`, "m").test(registry), `renderer-registry 里缺少 ${toolName} 的映射`);
    }
  });
});
