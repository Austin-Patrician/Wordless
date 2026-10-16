import { KNOWLEDGE_SESSION_ENTRY_ID } from "./knowledge-session.ts";

/** 解析出"当前这个库"的根。`undefined` = 宿主还没有知识库(测试、或没有这个功能的宿主)。 */
export type KnowledgeRootResolver = () => Promise<string | undefined>;

/**
 * 给"知识库整理"会话补上**会话根 = 知识库**。
 *
 * ## 为什么需要这一步
 *
 * 加工轮次的全部意义建立在会话根就是知识库上(见 `knowledge-session.ts`):会话根错了**不会
 * 报错**,只是 agent 拿着任务清单里的 `raws/x.md` 去别处找、拿到 ENOENT —— 它明明照着说明书
 * 在做。从知识库页发起的那几条路(定时、立即整理、归档)都在主进程里直接把根传给了
 * `createAndPrompt`;而从**渲染层**发起的路拿不到:
 *
 *   - `CreateAndPromptSchema` 里根本没有 `sessionRootPath` 这个字段,IPC 只转发 attachments;
 *   - 渲染层也不知道库在哪(`KnowledgeLibraries` 只有 `{ active, names }`,没有路径)。
 *
 * 于是运行时落到三级兜底的最后一级(`sessionRootPath ?? 工作区根 ?? 会话临时目录`)—— 一个
 * 一次性临时目录。**用户从新建页点"知识库整理"建出来的会话因此读不到库**,而它能写:
 * `kb_write_page` 这些是宿主侧按配置的库解析的,所以症状是"半能用",更难看出来。
 *
 * ## 为什么按 `entryId` 注入,而不是让渲染层传
 *
 * 按入口注入能一次覆盖**所有**渲染层入口(新建页那张卡、以及自动化任务里选了 knowledge
 * entry 的定时任务 —— 后者连第 5 个参数都没传,同样是坏的),而不是每加一条路就修一次。
 * 渲染层要传根,还得先改协议、把库路径暴露到界面上、升 bridge 版本,代价更大且更容易漂。
 *
 * 返回对象而不是布尔值:调用点要的就是"并进 options 的那一小块",让它自己拼字段等于把
 * "哪些会话需要根"这条规则又写一遍。
 */
export async function knowledgeSessionRootOption(
  draft: { entryId: string },
  resolveRoot: KnowledgeRootResolver | undefined,
): Promise<{ sessionRootPath?: string }> {
  // 先看入口再解析:普通会话不该为这个去读一次文件系统。
  if (draft.entryId !== KNOWLEDGE_SESSION_ENTRY_ID) return {};
  if (resolveRoot === undefined) return {};
  const root = await resolveRoot();
  // 空字符串不是根 —— 宁可让它落到兜底目录(能跑起来但读不到库),也不要把 "" 传下去。
  if (root === undefined || root === "") return {};
  return { sessionRootPath: root };
}
