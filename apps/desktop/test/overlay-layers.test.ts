import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 浮层的层级顺序。
 *
 * 这是一个**跨组件的不变量**:任何单个组件文件都看不出它错在哪,只有把它们放在一起比才有
 * 意义。它真实的坏法是这样的:tooltip 曾经是 `z-50`,比 dialog 内容的 `z-[60]` 还低 ——
 * 弹层里的 tooltip 被弹层盖住,露在外面的那一角看得见、其余被压住,于是用户报的是
 * "有一部分被 modal 遮盖了"。这种 bug 在视觉上像"飘了",在代码里其实只是一个数字比另一个小。
 *
 * 所以这里按源码文本断言顺序(与 `desktop-bridge-contract.test.ts` 同一路数):浮层之间只能
 * 靠数字表达先后,那就在数字上钉住它。层级表本身写在 `tooltip.tsx` 的注释里。
 */

const componentsDir = path.join(import.meta.dirname, "../../../packages/ui-kit/src/components");

/**
 * 注释要剥掉再找:层级表就写在 `tooltip.tsx` 的注释里(那里连"曾经是 z-50"都写着),
 * 不剥的话解析器读的是散文而不是代码 —— 这条测试第一次跑就是这么被自己的注释骗到的。
 * `//` 前面的字符不能是 `:`(避开 `https://`)。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function source(name: string): string {
  return stripComments(readFileSync(path.join(componentsDir, name), "utf8"));
}

/** 在 `marker` 之后的一小段里找 z-index:同一个文件里有多个浮层时(如 dialog)靠它区分。 */
function zIndexAfter(file: string, marker: string): number {
  const from = file.indexOf(marker);
  assert.ok(from >= 0, `没有找到 ${marker}`);
  const match = file.slice(from, from + 400).match(/\bz-\[(\d+)\]|\bz-(\d+)\b/);
  assert.ok(match, `${marker} 附近没有 z-index`);
  return Number(match[1] ?? match[2]);
}

function zIndexFirst(file: string): number {
  const match = file.match(/\bz-\[(\d+)\]|\bz-(\d+)\b/);
  assert.ok(match, "文件里没有 z-index");
  return Number(match[1] ?? match[2]);
}

test("tooltip 高于所有浮层 —— 它标注的控件可能就住在那些浮层里", () => {
  const dialog = source("dialog.tsx");
  const overlay = zIndexAfter(dialog, "fixed inset-0");
  const dialogContent = zIndexAfter(dialog, "fixed left-1/2");
  const tooltip = zIndexFirst(source("tooltip.tsx"));
  const popover = zIndexFirst(source("popover.tsx"));
  const menu = zIndexFirst(source("context-menu.tsx"));
  const dropdown = zIndexFirst(source("dropdown-menu.tsx"));
  const hoverCard = zIndexFirst(source("hover-card.tsx"));

  assert.ok(
    tooltip > dialogContent,
    `tooltip(${tooltip}) 必须高于 dialog 内容(${dialogContent}):否则弹层里的 tooltip 会被弹层盖住`,
  );
  assert.ok(tooltip > popover, `tooltip(${tooltip}) 必须高于 popover(${popover})`);
  assert.ok(tooltip > menu, `tooltip(${tooltip}) 必须高于 context-menu(${menu})`);
  assert.ok(tooltip > dropdown, `tooltip(${tooltip}) 必须高于 dropdown-menu(${dropdown})`);
  assert.ok(tooltip > hoverCard, `tooltip(${tooltip}) 必须高于 hover-card(${hoverCard})`);
});

test("遮罩在弹层之下,弹层在各个菜单/popover 之下", () => {
  const dialog = source("dialog.tsx");
  const overlay = zIndexAfter(dialog, "fixed inset-0");
  const dialogContent = zIndexAfter(dialog, "fixed left-1/2");
  const popover = zIndexFirst(source("popover.tsx"));

  assert.ok(overlay < dialogContent, `遮罩(${overlay})必须在弹层内容(${dialogContent})之下`);
  assert.ok(dialogContent < popover, `弹层(${dialogContent})必须在 popover(${popover})之下`);
});
