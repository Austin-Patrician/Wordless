import assert from "node:assert/strict";
import test from "node:test";
import { fillReskinText, reskinPromptParts } from "../src/renderer/features/design/reskin-prompt.ts";

/**
 * 「按新体系全量重设」这条消息。
 *
 * 它是**功能本身**:换掉 `theme.css` 与 `DESIGN.md` 之后,真正让画框变样的是 agent,而它拿到的
 * 全部指令就是这段话。写得含糊,结果就是"只换了颜色" —— 而用户按的那个按钮上写的是「全量重设」。
 *
 * 而且它是一条**自动发出去、用户不会先审一遍**的消息:占位符漏一个,花括号就留在消息里。
 */

test("消息里带上规范与令牌的引用 —— 人也要能核对 agent 读的是哪两份文件", () => {
  const parts = reskinPromptParts({
    designDir: "meadow.wdesign",
    frameCount: 4,
    styleName: "深色精密",
    text: "重设",
  });

  assert.deepEqual(parts.map((part) => part.type), ["text", "workspace-reference", "workspace-reference"]);
  assert.deepEqual(parts[1], {
    kind: "file",
    name: "DESIGN.md",
    path: "meadow.wdesign/DESIGN.md",
    type: "workspace-reference",
  });
  assert.deepEqual(parts[2]?.path, "meadow.wdesign/theme.css");
});

test("三个占位符都替换掉,而且不留花括号", () => {
  // 用户按了确认就发出去了,没有"再看一眼"的机会。
  const text = fillReskinText("换成{name}:{count} 个画框,规范在 {dir}", {
    designDir: "meadow.wdesign",
    frameCount: 4,
    styleName: "深色精密",
  });

  assert.equal(text, "换成深色精密:4 个画框,规范在 meadow.wdesign");
  assert.equal(text.includes("{"), false);
});

test("正文里那几句缺一不可的话 —— 它们决定了结果是「全量」还是「只换颜色」", () => {
  const text = fillReskinText(
    "主题已换为「{name}」。请按新体系全量重设这份设计稿的全部 {count} 个画框:先读 {dir}/DESIGN.md(新规范)与 {dir}/theme.css(新令牌),只用它们定义的令牌,不要发明颜色或间距。「全量」指的是间距、层次、圆角、字号与字重都跟着新体系走,不是只换颜色。保留每一帧的内容、结构与 @frame 声明,不要改文案。",
    { designDir: "meadow.wdesign", frameCount: 4, styleName: "深色精密" },
  );

  // 换成哪一套 —— 否则它会去猜"新"是什么。
  assert.match(text, /深色精密/);
  // 几帧 —— 让它知道自己要过一遍多少屏。
  assert.match(text, /4 个画框/);
  // 规范与令牌在哪。
  assert.match(text, /meadow\.wdesign\/DESIGN\.md/);
  assert.match(text, /meadow\.wdesign\/theme\.css/);
  // "全量"到底指什么 —— 整段里最容易被省略、也最影响结果的一句。
  assert.match(text, /不是只换颜色/);
  // 什么不能动。
  assert.match(text, /@frame 声明/);
});
