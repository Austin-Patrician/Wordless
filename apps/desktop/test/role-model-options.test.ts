import assert from "node:assert/strict";
import test from "node:test";
import { roleModelSelect, storedRoleModel } from "../src/renderer/features/settings/role-model-options.ts";

/**
 * 这个控件的缺陷曾经让整个 subagent 功能不可用:角色配的连接已经不存在了,而下拉框把它
 * 显示成**空白** —— 于是"看起来没配过",用户根本不会想到去清它。
 */

const ENABLED = [
  { value: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek v4.1 Flash" },
  { value: "xai/grok-4.5", label: "Grok 4.5" },
];

test("an unset role shows inherit and offers only the enabled models", () => {
  const select = roleModelSelect({ stored: null, enabled: ENABLED });

  assert.equal(select.value, "", "空串 = 继承会话模型");
  assert.deepEqual(
    select.options.map((option) => option.value),
    ["opencode-go/deepseek-v4.1-flash", "xai/grok-4.5"],
  );
  assert.equal(select.options.some((option) => option.unavailable), false);
});

test("a stored reference that is still available is selected normally", () => {
  const select = roleModelSelect({ stored: "xai/grok-4.5", enabled: ENABLED });

  assert.equal(select.value, "xai/grok-4.5");
  assert.equal(select.options.some((option) => option.unavailable), false);
});

test("a stored reference that is no longer available is shown, not hidden", () => {
  // 真实情形:这一条指向的 `deepseek` 连接早就不在了。旧控件把它渲染成空白,
  // 而运行时仍然按它走。
  const select = roleModelSelect({ stored: "deepseek/deepseek-v4-flash", enabled: ENABLED });

  assert.equal(select.value, "deepseek/deepseek-v4-flash", "value 必须与存储一致,否则控件又在对用户说谎");
  const unavailable = select.options.find((option) => option.unavailable);
  assert.notEqual(unavailable, undefined, "必须有一条标为不可用的选项");
  assert.equal(unavailable?.label, "deepseek/deepseek-v4-flash", "标出它到底指向什么,用户才知道要清哪条");
  assert.equal(select.options[0]?.unavailable, true, "放最前面:它是当前生效的那条");
});

test("the enabled models are still offered alongside an unavailable stored one", () => {
  const select = roleModelSelect({ stored: "deepseek/deepseek-v4-flash", enabled: ENABLED });

  // 用户要能一步改到"继承会话模型",或改到任何一个真实可用的模型。
  assert.equal(select.options.filter((option) => !option.unavailable).length, ENABLED.length);
});

test("storedRoleModel reads what is actually stored, including a reference that is now dead", () => {
  // 用户磁盘上的真实形状。`deepseek` 这个连接早就不在了 —— 而**必须读出来**,
  // 读成 null 就又回到"看起来没配过"。
  const settings = {
    roleModels: {
      scout: { connectionId: "hyb-d4.1", modelId: "deepseek-v4.1-flash" },
      reviewer: { connectionId: "deepseek", modelId: "deepseek-v4-flash" },
    },
  };

  assert.equal(storedRoleModel(settings, "reviewer"), "deepseek/deepseek-v4-flash");
  assert.equal(storedRoleModel(settings, "worker"), null, "没配的 role 是 null");
  assert.equal(storedRoleModel({}, "reviewer"), null);
  assert.equal(storedRoleModel(null, "reviewer"), null);
  // 半截的引用不算配置 —— 那本来就是坏数据。
  assert.equal(storedRoleModel({ roleModels: { reviewer: { connectionId: "deepseek" } } }, "reviewer"), null);
});
