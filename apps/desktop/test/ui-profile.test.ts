import assert from "node:assert/strict";
import test from "node:test";
import { uiProfile } from "@wordless/profile-ui";

/**
 * UI 设计画像的约束。
 *
 * 这些断言看着琐碎,但每一条都对应一次**实测的失败**:
 *
 * - 系统提示里写着 `x.wdesign/`(本意是"以 .wdesign 结尾的目录"的示意),模型把它当成了
 *   真路径,`design_status` 带着 `path: "x.wdesign"` 被调用了三次,三次全失败。
 * - `design_create` 返回的绝对路径旁边的说明是"Read theme.css" —— 不带目录。模型照做了
 *   三次(全 ENOENT),然后把内容写到了包外面。
 * - 工具表里声明了却跑不起来的工具,比没有更糟(§14.5):模型会去调它,然后拿到一个失败。
 */

test("系统提示里不给任何一个具体的目录名 —— 那是模型唯一会照抄成路径的东西", () => {
  const prompt = uiProfile.systemPrompt;

  // 示意性的 `x.wdesign/` 正是那次会话里被当成真路径的字符串。形状要说清,真名由
  // `design_create` 的返回文案给出。
  assert.equal(prompt.includes("x.wdesign"), false);
  // 反过来,它必须说清"名字以 .wdesign 结尾"这件事,否则模型不知道该建什么。
  assert.match(prompt, /ends in `\.wdesign`/);
});

test("系统提示里说清路径的基准 —— 目录是每一处路径的一部分", () => {
  const prompt = uiProfile.systemPrompt;

  assert.match(prompt, /relative to the workspace root/);
  // 那次会话里 read("theme.css") 失败了三次 —— 根源是没人说过目录要在路径里。
  assert.match(prompt, /<name>\.wdesign\/theme\.css/);
  // 以及"不要编路径"这条 —— 它是那个 `x.wdesign` 的直接对策。
  assert.match(prompt, /Never invent a path/);
});

test("系统提示保留那几条会让产出质量的硬约束", () => {
  const prompt = uiProfile.systemPrompt;

  // 帧的尺寸声明:漏了它帧照样上画布,但尺寸是猜的。
  assert.match(prompt, /@frame/);
  // 只用令牌里定义的 —— 这是"看起来像 AI 生成的"与"有设计"的分界。
  assert.match(prompt, /use only the tokens/);
  // 清单归工具,不归 agent。
  assert.match(prompt, /never edit `design\.json` by hand/);
  // 复核闭环,三轮上限。
  assert.match(prompt, /at most three cycles/);
});

test("声明的工具都存在,而且都要么是通用的、要么由设计工具面提供", () => {
  // `design_style_*` 与 `design_export` **刻意不在这里**:声明了却跑不起来的工具比没有更糟,
  // 模型会去调它然后拿到一个失败。
  const designTools = uiProfile.activeToolNames.filter((name) => name.startsWith("design_"));
  assert.deepEqual(designTools, ["design_create", "design_status", "design_inspect", "design_screenshot"]);

  // 需要视觉的模型才能看像素 —— 这是这个画像成立的前提。
  assert.equal(uiProfile.modelRequirements.requiresVision, true);
  assert.equal(uiProfile.workbenchId, "ui-preview");
});
