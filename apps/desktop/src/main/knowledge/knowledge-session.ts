import { KNOWLEDGE_ROUND_SOURCE, type PromptSessionOptions, type SessionDraft } from "@wordless/domain";

/**
 * "知识库整理"这个入口的 id —— 与 `packages/runtime` 的 entry 表里那一条同源。
 *
 * 加工轮次按它建会话,而宿主侧还有一处要按它判断(渲染层建的会话要补上会话根,见
 * `knowledge-session-root.ts`)。写成常量是为了让两处一起走,不再各写一份字面量。
 */
export const KNOWLEDGE_SESSION_ENTRY_ID = "knowledge";

/**
 * 一轮加工要怎么开会话。
 *
 * 抽成纯函数有两个理由:
 *   1. **会话根 = 知识库** 这件事必须可断言。它错了的表现不是报错,而是 agent 拿着
 *      "raws/health.md" 去会话的临时目录里找文件、拿到 ENOENT —— 而它明明照着说明书在做。
 *      这个 bug 出现过一次(见 docs/architecture/knowledge-base.md §6 / §7.1),不该有第二次。
 *   2. 加工会话的定义(入口、来源、工作台、审批模式)从 `main/index.ts` 里出来,和它的
 *      理由放在一起。
 */
export interface KnowledgeSessionRequest {
  /** 当前库的 bundle 根。会话根就是它。 */
  bundleRoot: string;
  /** 当前库配置的加工模型键;`null` = 跟随会话默认(只对手动整理有效)。 */
  modelKey: string | null;
  title: string;
  messageId: string;
  submittedAt: number;
}

/** 模型键 `connectionId/modelId` → 模型引用。半截的键当没配。 */
export function modelFromKey(key: string | null): { connectionId: string; modelId: string } | null {
  if (key === null) return null;
  const [connectionId, ...rest] = key.split("/");
  const modelId = rest.join("/");
  return connectionId === undefined || connectionId === "" || modelId === "" ? null : { connectionId, modelId };
}

export function knowledgeSessionRequest(input: KnowledgeSessionRequest): {
  draft: SessionDraft;
  options: PromptSessionOptions;
} {
  return {
    draft: {
      mode: "everyday",
      entryId: KNOWLEDGE_SESSION_ENTRY_ID,
      title: input.title,
      // **轮次的标记**:侧边栏/知识库页/用量三处都按它认,见 KNOWLEDGE_ROUND_SOURCE。
      source: KNOWLEDGE_ROUND_SOURCE,
      workspaceId: null,
      accessLevel: "default",
      model: modelFromKey(input.modelKey),
      interactionMode: "default",
      // 无人值守:一轮加工不该停下来等人。定时那一轮尤其没有人守着。
      toolApprovalMode: "bypass",
    },
    // **会话根就是知识库。** 任务清单与加工约定里的路径(`raws/x.pdf`、`index.md`)都是
    // bundle 相对路径,只有会话根=库时才指向对的地方。给了这个根,`read` / `grep` / `find` /
    // `ls` 与抽取工具(`extract_text_from_pdf` 等,它们的根也是会话根)才读得到原文。
    options: { sessionRootPath: input.bundleRoot },
  };
}
