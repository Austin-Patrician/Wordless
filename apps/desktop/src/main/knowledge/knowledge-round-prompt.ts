import type { ModelReference } from "@wordless/domain";
import { extractBundleLinks, type KnowledgeHealthReport } from "./knowledge-lint.ts";
import type { KnowledgeRoundPlan } from "./knowledge-service.ts";

/**
 * 加工轮的**模型可见文本**:会话标题、prompt、模型键解析。
 *
 * 为什么这些字符串在宿主而不是界面:一轮加工是**宿主**在做(手动与定时共用同一条路,见
 * `knowledge-poller.ts`),而定时那一轮根本没有界面参与。文案跟着做事的这一层走。
 *
 * 用中文:与本仓其它主进程面向用户的文案一致(远程部署那套也是中文),而模型的加工约定
 * (`kb-processing` skill)本身也是中文 —— 一致比"英文更通用"更重要。
 */

/** 会话列表里显示的名字。带上这一轮的动作,便于回看时认出是哪一轮。 */
export function promptTitle(): string {
  return "知识库整理";
}

/**
 * 把待办拼成 prompt。
 *
 * **逐项列出来源文件与页路径**,而不是说"整理一下知识库":模型因此不必自己比对哪些改过 ——
 * 那件事它做不可靠(它看不到 hash),而做错的后果是漏加工或重复建页。
 */
/**
 * 给 agent 看的**可读路径**:`/raws/x.md` → `raws/x.md`。
 *
 * 文件工具(`read` / `ls` / `grep` / `find`)的路径是**会话根相对**的,前导斜杠会被当成
 * 文件系统绝对路径 —— `read /raws/health.md` 得到的是 `ENOENT: open '/raws/health.md'`。
 * 而 bundle 相对路径(带斜杠那种)是 `sources[].resource` 的形状,**不是**给文件工具用的形状。
 *
 * 这一条踩过:第一版 prompt 直接把 `raw.resource` 列出来,agent 照做 → 两次 ENOENT →
 * 靠 `find` 自己找回来。能力强的模型能自救,但那是白烧的几轮。
 */
function readableRawPath(resource: string): string {
  return resource.replace(/^\/+/, "");
}

export function buildKnowledgeRoundPrompt(plan: KnowledgeRoundPlan): string {
  const lines = [
    "请整理知识库。先读 index.md 与 kb_list_tags,按 kb-processing skill 的约定做。",
    "",
    "本轮由系统算好的待办(不要自己另找文件,也不要漏掉这些):",
  ];
  if (plan.diff.added.length > 0) {
    lines.push("", "新增文件(读原文 → 新建源页,1:1)。括号里是它的内容 hash,写页时原样传给 `kb_write_page` 的 `sourceHash`:");
    for (const raw of plan.diff.added) lines.push(`- ${readableRawPath(raw.resource)}(source_hash=${raw.hash})`);
  }
  if (plan.diff.changed.length > 0) {
    lines.push(
      "",
      "内容变更的文件(读原文 → 按路径更新已有的页,保住它原来的位置)。括号里是**新**的内容 hash,更新时原样传给 `sourceHash`:",
    );
    for (const change of plan.diff.changed) {
      lines.push(`- ${readableRawPath(change.resource)}(source_hash=${change.newHash}) → ${change.pagePath}`);
    }
  }
  if (plan.diff.deleted.length > 0) {
    lines.push(
      "",
      "原始文件已删除的页(系统已把它们标成孤儿;把有价值的内容并入相关页或重指引用,然后说明你做了什么):",
    );
    for (const gone of plan.diff.deleted) lines.push(`- ${readableRawPath(gone.resource)}(${gone.pagePath})`);
  }
  if (plan.diff.moved.length > 0) {
    // 工程侧已经改完了,列出来只是让模型知道"这些不用管"。
    lines.push("", "以下文件换了位置,系统已经改好元数据,你不需要处理:");
    for (const move of plan.diff.moved) lines.push(`- ${readableRawPath(move.from)} → ${readableRawPath(move.to)}`);
  }
  if (plan.needsReview.length > 0) {
    // 复核过的页不进待办(见 `applyVerificationGate`),但要说出来 —— 否则模型可能自己找到
    // 那一页、试图改写、然后拿到一个它无法理解的拒绝。
    lines.push(
      "",
      "以下页经过**人工复核**,系统不会自动改写它们(它们的来源变了,或它们的原始文件被删了)。",
      "**不要改写这些页** —— 把它们的情况写进你的汇报,由用户决定:",
    );
    for (const entry of plan.needsReview) lines.push(`- ${entry.pagePath}(${readableRawPath(entry.resource)})`);
  }
  if (plan.skipped.length > 0) {
    lines.push(
      "",
      "以下文件之前连续加工失败、已被隔离,本轮**不加工**(用户可在「设置 → 知识库」里重试):",
    );
    for (const raw of plan.skipped) lines.push(`- ${raw.resource}`);
  }
  lines.push("", "做完后用大白话汇报:把哪些文件变成了页面、更新了哪些页、有什么没把握。");
  return lines.join("\n");
}

/**
 * 把设置里存的模型键(`connectionId/modelId`)解析成 `ModelReference`。
 *
 * 解析不了就返回 null(跟随会话默认):一个半截的键不该让整轮失败 —— 用户能在设置里改回来。
 */
export function modelKeyFromKey(key: string): ModelReference | null {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return null;
  return { connectionId: key.slice(0, index), modelId: key.slice(index + 1) };
}

/** 体检报告的一句话摘要(日志与界面用)。 */
export function summarizeHealthReport(report: KnowledgeHealthReport): string {
  const parts: string[] = [];
  if (report.deadLinks.length > 0) parts.push(`死链 ${report.deadLinks.length}`);
  if (report.orphans.length > 0) parts.push(`孤立页 ${report.orphans.length}`);
  if (report.unsourced.length > 0) parts.push(`无来源 ${report.unsourced.length}`);
  if (report.duplicateTitles.length > 0) parts.push(`标题撞车 ${report.duplicateTitles.length}`);
  return parts.join("、");
}

/**
 * 体检 prompt。
 *
 * 分工写得很明白:**算得出来的问题直接给出事实**(模型不用去数链接,它数不准),而
 * **要判断的问题交给它**(矛盾、过期论断、缺页的概念、缺的交叉引用)—— 那些正是它擅长的。
 */
export function buildKnowledgeLintPrompt(report: KnowledgeHealthReport): string {
  const lines = [
    "请给知识库做一次体检。先读 index.md 与 kb_list_tags,按 kb-processing skill 的约定做。",
    "",
    "## 系统算出来的问题(这些是**事实**,不用你去核对)",
  ];
  if (report.deadLinks.length > 0) {
    lines.push("", "死链(指向不存在的页):");
    for (const entry of report.deadLinks) lines.push(`- ${entry.pagePath} → ${entry.link}`);
  }
  if (report.orphans.length > 0) {
    lines.push("", "孤立页(没有任何页指向它,检索走不到):");
    for (const entry of report.orphans) lines.push(`- ${entry.pagePath}`);
  }
  if (report.unsourced.length > 0) {
    lines.push("", "没有写来源的页(综合出来的结论却不说从哪来,无法核):");
    for (const entry of report.unsourced) lines.push(`- ${entry.pagePath}`);
  }
  if (report.duplicateTitles.length > 0) {
    lines.push("", "标题撞车的页(**重复页最可靠的信号**,合并它们):");
    for (const entry of report.duplicateTitles) lines.push(`- 「${entry.title}」:${entry.pagePaths.join("、")}`);
  }
  lines.push(
    "",
    "## 要你来判断的问题(系统算不出来)",
    "- **矛盾**:两份资料对同一件事说法不同 —— 两边都写下来,不要自己选一个。",
    "- **过期论断**:新资料已经推翻了旧说法,而旧页还在讲旧的。",
    "- **提到却没有自己的页的概念**:在某页正文里反复出现、值得单独成页的主题。",
    "- **缺的交叉引用**:相关的页之间没有互相链接 —— 用 `[标题](/concepts/x.md)` 补上。",
    "",
    "## 怎么处理",
    "- 修死链、补交叉引用:用 `kb_write_page` 改写那一页(路径不变)。",
    "- 合并重复页:把内容与 `sources` 并进留下的那一页,然后对另一页调 `kb_retire_page`,理由写清「并到哪去了」。",
    "- 孤立页:要么从相关页链过去,要么它确实是多余的 —— 后者用 `kb_retire_page`。",
    "- **人工复核过的页不要动**(系统会拒绝),把发现写进汇报。",
    "",
    "做完后用大白话汇报:修了什么、合并了什么、发现了哪些矛盾与缺页、有什么没把握。",
  );
  return lines.join("\n");
}

/**
 * 归档一段回答。
 *
 * 这是原典里最容易被忽略、也最值钱的那一条:**好的回答应该被存回 wiki** ——
 * "你问出来的对比、分析、发现的关联,不该消失在聊天记录里"。知识库因此不只积累资料,
 * 还积累**结论**。
 *
 * 两件事由工程做好再交给 agent:
 *   - **它引用了哪些页**:从正文里抽 bundle 相对链接(复用体检那套抽取)。模型自己回忆"我刚引了哪几页"
 *     不可靠,而 `sources` 是这一页能不能被核对的依据;
 *   - **它来自哪次对话**(可选):记进 prompt,便于回看时知道上下文。
 *
 * 剩下的是判断:放哪、叫什么、打什么标签 —— 那正是它擅长且必须做的部分。
 */
export function buildKnowledgeFilingPrompt(input: { text: string; citedPages: string[]; sourceTitle?: string }): string {
  const lines = [
    "请把下面这段回答**归档成一页**存进知识库。",
    "",
    "这不是加工原始文件:不要去找 raws 里的东西,也不要用 kb_retire_page。就写这一页。",
    "",
    "要求:",
    "- 用 `kb_write_page` 写**一页**,`type: Concept`(它是综合出来的结论,不是某个原始文件的转写)。",
    "- **保留这段回答的实质内容** —— 结论、对比、数据、推理链都不要删减。它是这次探索的产物,不是摘要。",
    "- `title` 与 `description` 按知识库的惯例写(description 一句话,它决定别人能不能找到这一页)。",
    "- **`sources` 用它引用过的页**(下面列出来了);如果它还引用了别的,自己补上。",
    "- 标签按 kb-processing skill 的纪律:先 kb_list_tags 看现有词表,复用优先,最多 5 个,只打粗粒度维度。",
    "- 路径由你按语义决定(放哪棵树、和谁相邻)。动手前先读 index.md,别建出一页和已有的重复。",
    "- 写完后用一句话说明你把它放在了哪、为什么。",
  ];
  if (input.sourceTitle !== undefined && input.sourceTitle.trim() !== "") {
    lines.push("", `这段回答来自会话「${input.sourceTitle.trim()}」。`);
  }
  if (input.citedPages.length > 0) {
    lines.push("", "它引用过的页(用作 sources):");
    for (const page of input.citedPages) lines.push(`- ${page}`);
  } else {
    // 没有引用页也要说 —— 否则模型会以为"工程漏了",或者干脆不写 sources。
    lines.push(
      "",
      "这段回答没有引用库里已有的页。那就说明它的依据是什么:如果来自你读过的页面,把那些页列进 sources;",
      "如果它其实是新知识(用户给的信息、你的推理),就在汇报里说清这一点。",
    );
  }
  lines.push("", "## 要归档的回答", "", input.text.trim());
  return lines.join("\n");
}

/** 从一段回答里抽出它引用的库内页面(去重,保持出现顺序)。 */
export function citedPagesOf(text: string): string[] {
  return [...new Set(extractBundleLinks(text).map((link) => link.replace(/^\/+/, "")))];
}
