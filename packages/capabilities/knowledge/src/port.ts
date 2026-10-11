/**
 * 知识库能力的契约。
 *
 * 与仓库里其它能力同一套做法:**能力包只声明它消费的端口,实现留在宿主**。所以这里的工具
 * 不 import Electron、不碰文件系统、也不知道 bundle 在哪。
 *
 * 端口刻意很窄(读页面列表 + 写一个页面),因为**判定都在宿主**:封闭 schema 的校验、路径
 * 规则、派生产物的重建,全部发生在写路径上。工具层只做两件事 —— 把模型的意图翻成一次端口
 * 调用,再把结果排版成模型能读的文字。
 */

/** 页面类型。OKF 的 `type` 不集中注册,但生产者要挑自解释的值。 */
export type KnowledgePageKind = "Source" | "Concept" | "Entity";

/** 一个页面的只读视图 —— 工具需要的全部字段。 */
export interface KnowledgePageView {
  /** 相对 bundle 根的路径,如 `concepts/增值税流程.md`。 */
  path: string;
  kind: KnowledgePageKind;
  title: string;
  description: string;
  tags: string[];
  /** 这一页综合自哪些原始资料(bundle 相对路径或 URL)。 */
  sources: string[];
  /** 是否已被标成孤儿(原始文件删了,等宽限期回收)。 */
  orphaned: boolean;
}

export interface KnowledgeWriteInput {
  /** 目标路径,相对 bundle 根,如 `sources/合同.md`。由调用方按语义决定。 */
  path: string;
  kind: KnowledgePageKind;
  title: string;
  description: string;
  tags: string[];
  /** 来源(OKF 的 provenance)。源页给一个,综合页给多个。 */
  sources?: Array<{ id?: string; resource: string }>;
  /** 正文 markdown(不含 frontmatter)。 */
  body: string;
  /** 原始文件的内容 hash —— 只有源页需要(它是增量加工的内容身份)。 */
  sourceHash?: string;
}

export interface KnowledgeWriteOutcome {
  path: string;
  action: "create" | "update";
}

export interface KnowledgePort {
  /** 列出全部页面(含孤儿;调用方自己决定要不要过滤)。 */
  listPages(): Promise<KnowledgePageView[]>;
  /**
   * 退役一页:标成孤儿,**不立刻删**。
   *
   * 下一轮才回收,中间那一轮就是宽限期(写入即复活);回收时别处对它的 `sources[]` 引用会被
   * 摘掉,而不是留下死引用。人工复核过的页会被拒绝。
   */
  retirePage(path: string, reason: string): Promise<void>;
  /**
   * 写一个页面(新建或就地更新)。
   *
   * 校验失败**抛错**:封闭 schema 的价值就在于写错了立刻知道,而不是静默写进文件。
   */
  writePage(input: KnowledgeWriteInput): Promise<KnowledgeWriteOutcome>;
}
