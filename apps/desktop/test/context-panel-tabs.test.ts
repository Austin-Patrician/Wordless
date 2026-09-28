import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_CONTEXT_PANEL_WORKBENCH_IDS,
  CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS,
  mainColumnFills,
  sharedContextPanelViews,
} from "../src/renderer/features/workbench/context-panel-tabs.ts";

/**
 * 右侧栏该有哪些页签。
 *
 * 用户报的"UI 设计会话的右侧栏太乱"就长在这里:面板上并排着翻译、浏览器和画布三个页签,
 * 而画布是**无限画布** —— 并排放着就意味着它只能用到面板的一部分,而用户来看的就是画布。
 *
 * 这条判断原本是 `WorkbenchShell` 里一串展开表达式,组件里既看不见也测不到。
 */

test("设计画布的面板只有它自己 —— 不追加翻译,也不追加浏览器", () => {
  // 不是"少写一行":画布要的是整块面板。参考实现的画布也是以最大宽度打开的。
  assert.deepEqual(sharedContextPanelViews("ui-preview"), []);
});

test("设计会话不在能放浏览器的那一列里", () => {
  // 这两件事**必须**分开:那个集合说"这里放得下图一面页",这个判断说"这里不放别的"。
  // 曾经 `ui-preview` 在浏览器集合里,于是设计会话的面板上多出一个浏览器页签。
  assert.equal(BROWSER_CONTEXT_PANEL_WORKBENCH_IDS.has("ui-preview"), false);
  assert.equal(CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS.has("ui-preview"), true);
});

test("代码会话保留翻译与浏览器 —— 正在开发的页面在那里验证", () => {
  assert.deepEqual(sharedContextPanelViews("code"), ["translation", "browser"]);
});

test("普通对话保留翻译与浏览器 —— agent 可能自己去开一个页面", () => {
  assert.deepEqual(sharedContextPanelViews("conversation"), ["translation", "browser"]);
});

test("面板已被占满的工作台只拿翻译", () => {
  for (const workbenchId of ["presentation", "spreadsheet", "analysis", "media-canvas", "conversation-not-a-workbench"]) {
    assert.deepEqual(sharedContextPanelViews(workbenchId), ["translation"], workbenchId);
  }
});

test("还没有工作台时也给翻译 —— 它是全局能力", () => {
  assert.deepEqual(sharedContextPanelViews(undefined), ["translation"]);
  assert.deepEqual(sharedContextPanelViews(null), ["translation"]);
});

test("折叠画布之后,对话列必须撑满 —— 否则右边留一片空白", () => {
  /*
    **这条是踩出来的。** 漏掉 `panelOpen` 的那一版把对话列无条件设成固定宽,于是用户点折叠
    之后:画布没了,但对话仍是 420 宽,右边留一整片空背景 —— 读起来像「折叠没生效、还留了
    个画布占位」,而且左边的会话列表也不再自适应。
  */
  assert.equal(
    mainColumnFills({ exclusive: true, panelFullscreen: false, panelOpen: false }),
    true,
    "画布关着 → 对话撑满",
  );

  // 画布开着才是"画布为主":对话定宽、画布吃掉剩下的。
  assert.equal(mainColumnFills({ exclusive: true, panelFullscreen: false, panelOpen: true }), false);

  // 全屏:主区整个让给画布,这一列不参与分配。
  assert.equal(mainColumnFills({ exclusive: true, panelFullscreen: true, panelOpen: true }), true);

  // 别的画布工作台从来不是"画布为主"。
  for (const panelOpen of [true, false]) {
    assert.equal(mainColumnFills({ exclusive: false, panelFullscreen: false, panelOpen }), true);
  }
});
