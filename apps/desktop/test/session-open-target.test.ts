import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionOpenTarget } from "../src/renderer/features/workbench/session-open-target.ts";

/**
 * 这条判断曾经坏过,而且坏得很难看:点开一个 UI 设计会话,主区域被画布**取代**,对话
 * (`ThreadView`)根本不挂载、右侧面板一起隐藏,画布上也没有任何回到对话的入口 ——
 * 一次"切走再切回来"就再也回不到对话流。
 *
 * 组件里它是一句三元表达式,既看不见也测不到;抽成纯映射表之后,它就是可断言的事实。
 */

test("a UI design session opens its conversation, with the canvas beside it", () => {
  const target = resolveSessionOpenTarget("ui-preview");

  // 会话就是对话。产物是这一轮工作的结果,不是它的替代品 —— 取代它意味着 agent 干活的
  // 时候你看不见它在干什么。
  assert.equal(target.mainView, "thread");
  // 但画布要**同时**调出来,否则画布没有入口(它唯一的入口就是"点会话")。
  assert.equal(target.contextView, "design");
});

test("an ordinary session opens its conversation and leaves the panel alone", () => {
  assert.deepEqual(resolveSessionOpenTarget("conversation"), { mainView: "thread", contextView: null });
});

test("a session with no workbench id still opens the conversation", () => {
  assert.deepEqual(resolveSessionOpenTarget(undefined), { mainView: "thread", contextView: null });
  assert.deepEqual(resolveSessionOpenTarget(null), { mainView: "thread", contextView: null });
});

test("the media canvas keeps its own full-screen surface", () => {
  // 媒体画室不一样:它的画布是整屏的,并且有自己的"回到素材库"回路,所以这里不并排。
  assert.deepEqual(resolveSessionOpenTarget("media-canvas"), { mainView: "media", contextView: null });
});

test("no session ever opens straight into the canvas as the main view", () => {
  // 钉住这条,是因为"画布当主视图"正是那个 bug 的形状:它必然伴随着"对话没有入口"。
  for (const workbenchId of ["ui-preview", "media-canvas", "conversation", "code", "analysis", undefined]) {
    const target = resolveSessionOpenTarget(workbenchId);
    assert.ok(
      target.mainView === "thread" || target.mainView === "media",
      `${workbenchId} 打开了 ${target.mainView}`,
    );
  }
});
