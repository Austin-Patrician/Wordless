import type { UserPromptPart } from "@wordless/domain";

/**
 * 「按新体系全量重设」这条消息的内容。
 *
 * ## 为什么它值得单独成文件
 *
 * 这条消息是**功能本身**:换掉 `theme.css` 与 `DESIGN.md` 之后,真正让画框变样的是 agent,而
 * 它拿到的全部指令就是这段话。写得含糊,结果就是"只换了颜色"—— 而用户按的那个按钮上写的是
 * 「全量重设」。
 *
 * 所以它必须同时说清四件事,少一件都会出偏差:
 *
 * 1. **换成了哪一套** —— 否则它会去猜"新"是什么。
 * 2. **规范与令牌在哪** —— 以 `workspace-reference` 的形式给,于是它既能读、也看得见路径。
 * 3. **"全量"到底指什么** —— 间距、层次、圆角、字号字重,不是只替换颜色。这一条是整段里最
 *    容易被省略、也最影响结果的。
 * 4. **什么不能动** —— 内容、结构、`@frame` 声明。改风格不是重写页面。
 *
 * 本文件不 import React。
 */

export interface ReskinPromptInput {
  /** 设计包在**工作区相对**路径下的位置,例如 `meadow.wdesign`。 */
  designDir: string;
  /** 画框数量。写进正文,让 agent 知道自己要过一遍多少屏。 */
  frameCount: number;
  /** 新体系的名字(不是 id):人读的正文里说名字,令牌文件才用得上 id。 */
  styleName: string;
  /** 复数与语序各语言不同,所以正文由调用方按语言模板拼好传进来。 */
  text: string;
}

export function reskinPromptParts(input: ReskinPromptInput): UserPromptPart[] {
  return [
    { text: input.text, type: "text" },
    /**
     * 规范与令牌都以引用块给出去。
     *
     * 只写路径也行(agent 有 read),但引用块让**人**在对话里一眼看到 agent 读的是哪两份文件 ——
     * 而这条消息是用户按了按钮之后自动发出去的,他需要能核对"它到底按什么改的"。
     */
    {
      kind: "file",
      name: "DESIGN.md",
      path: `${input.designDir}/DESIGN.md`,
      type: "workspace-reference",
    },
    {
      kind: "file",
      name: "theme.css",
      path: `${input.designDir}/theme.css`,
      type: "workspace-reference",
    },
  ];
}

/**
 * 正文模板的占位替换。
 *
 * 抽出来是为了它可断言:三个占位符里漏一个,消息里就会留下一对花括号 —— 而那是一条**自动
 * 发出去、用户不会先审一遍**的消息。
 */
export function fillReskinText(
  template: string,
  input: { designDir: string; frameCount: number; styleName: string },
): string {
  return template
    .replaceAll("{name}", input.styleName)
    .replaceAll("{count}", String(input.frameCount))
    .replaceAll("{dir}", input.designDir);
}
