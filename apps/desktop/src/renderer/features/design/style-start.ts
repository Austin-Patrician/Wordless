import type { UserPromptPart } from "@wordless/domain";

/**
 * 挑了一套风格之后,第一条消息该带什么。
 *
 * ## 为什么是引用,而不是把规范内联进提示词
 *
 * 两条路都通,选这条(§14.20):
 *
 * - agent 要的是能 `Read`、能**拷进**设计包的东西 —— "应用一套风格"在我们这边的定义就是把它那份
 *   `theme.css` 与 `DESIGN.md` 拷过去。规范内联进提示词的话,它得凭记忆重写一遍。
 * - **扛得住上下文压缩**:文件在盘上,被压掉的是提示词里那句话,不是资料。
 * - 引用是**用户看得见**的:消息里会出现 `DESIGN.md` / `theme.css` 两个引用块,他能核对 agent
 *   按什么在做,而不用相信一段看不见的隐式设定。
 *
 * 不带任何"请按这套风格做"的散文:那段话的解释属于**设计画像**(它才知道 `design-resources/`
 * 是什么意思),与 `<wordless-theme-token-reference>` 那条同一个取舍。
 *
 * ## 名字用文件名
 *
 * 引用块上显示的是 `DESIGN.md` / `theme.css` —— 与设计对话里其它引用同一套语言(§14.x 重设那份
 * 也是这两个引用),而风格名在 `DESIGN.md` 的标题里。
 *
 * 本文件不 import React。
 */

/** 落盘结果(主进程给的):工作区相对目录 + 实际写下的文件名。 */
export interface InstalledStyleResources {
  dir: string;
  files: readonly string[];
}

/** 把落盘的资料变成消息里的引用。**顺序照主进程给的** —— 它才决定先读哪一份。 */
export function designStyleStartParts(installed: InstalledStyleResources): UserPromptPart[] {
  return installed.files.map((file) => ({
    type: "workspace-reference",
    kind: "file",
    name: file,
    path: `${installed.dir}/${file}`,
  }));
}
