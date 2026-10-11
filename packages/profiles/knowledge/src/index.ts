import type { ProfileDefinition } from "@wordless/profile-sdk";

/**
 * 知识库整理画像。
 *
 * 这是**唯一**能写知识库页面的画像 —— 写工具与加工约定(skill)成对出现,因为"写是纪律":
 * 没有约定的写入会让知识库碎片化(近重复的概念页、发散的标签),而那个损伤累积且难回滚。
 * 其它画像只拿只读工具(见 `create-runtime.ts` 的分组注释)。
 *
 * ## 工具面里**刻意没有** bash / write / edit
 *
 * 三条理由,每条都是机制而不是偏好:
 *   1. **raws 不可变**。bash 绕过应用层的路径守卫(它走的是规则匹配,不是路径约束),
 *      所以"不给 bash"才是"原始文件改不了"的真正保证 —— 见设计文档 §7.2。
 *      同理不给 write/edit:页面只能经 `kb_write_page`,而它守 schema、拒写 `raws/**`。
 *   2. **提取靠工具不靠命令**。PDF / docx / 图片各有一条专用工具(把文本层或识别结果取回来),
 *      不需要模型自己拼命令行,也就不需要 shell。
 *   3. **无需临时文件**。这一版的加工是"读原文 → 写页",中间产物不落盘;所以不给写权限
 *      也不会卡住它。
 *
 * 加工约定(两阶段:先分析再生成、树形按语义组织、复用优先、审阅项)写在 `kb-processing`
 * skill 里,而不是塞进工具描述 —— 那是"怎么做得好",不是"能不能做"。
 */
export const knowledgeProfile: ProfileDefinition = {
  reference: { id: "knowledge", version: "1" },
  driverId: "generic",
  modelRequirements: { requiresToolUse: true },
  systemPrompt: [
    "You are Wordless Knowledge, the agent that maintains the user's knowledge base.",
    "",
    "The knowledge base is one directory. Its `raws/` folder holds the user's original files and is READ-ONLY: never write there, and never modify an original. Everything else — the pages under `sources/`, `concepts/` and `entities/`, plus the generated `index.md` and `log.md` — is yours to maintain, but only through `kb_write_page`.",
    "",
    "Load the `kb-processing` skill before you start: it holds the working conventions (how to turn one raw file into a page, how to keep concept pages from fragmenting, how to pick tags, what to report back). Follow it rather than improvising.",
    "",
    "Read the originals with the extraction tools rather than guessing: `extract_text_from_pdf`, `extract_text_from_docx` and `extract_text_from_image`. Read the catalogue (`index.md`) before creating anything, so you reuse what is already there.",
    "",
    "Report what you did in plain language: which files you turned into pages, which pages you updated, and anything you were unsure about. Do not claim to have read something you did not.",
  ].join("\n"),
  activeToolNames: [
    // 读原始文件与既有页面。**没有 bash / write / edit** —— 见上面的注释。
    "read",
    "ls",
    "find",
    "grep",
    // 把用户手上的文件变成文本(原始资料就是这些东西)。
    "extract_text_from_pdf",
    "extract_text_from_docx",
    "extract_text_from_image",
    "fetch_url",
    // 知识库自身:读两个、写一个。
    "kb_query",
    "kb_list_tags",
    "kb_write_page",
    "kb_retire_page",
  ],
  capabilityIds: ["filesystem", "documents", "knowledge"],
  skills: [{ id: "kb-processing", source: "built-in" }],
  artifactKinds: [],
  contextCompactionInstructions:
    "Preserve the knowledge base root path, which raw files were processed and which were not, the pages created or updated with their paths, the tag vocabulary in use, the sources each page derives from, unresolved uncertainties, and the next concrete step.",
  workbenchId: "conversation",
};
