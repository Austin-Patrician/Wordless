import { ipcMain } from "electron";
import { Value } from "typebox/value";
import {
  FileKnowledgeAnswerSchema,
  ImportKnowledgeBundleSchema,
  MutateKnowledgeLibrarySchema,
  ImportKnowledgeFilesSchema,
  SetKnowledgeVerificationSchema,
  type ImportKnowledgeFilesResult,
  type KnowledgeOrganizeResult,
  type KnowledgeImportPlan,
  type KnowledgeClearPlan,
  type KnowledgePageContent,
  type KnowledgeSnapshot,
  type KnowledgeUsageSummary,
  KnowledgePageContentRequestSchema,
  ClearKnowledgePagesSchema,
  DeleteKnowledgePageSchema,
  RestoreKnowledgePageSchema,
} from "@wordless/protocol";
import type { KnowledgeService } from "../knowledge/knowledge-service.ts";

/**
 * 知识库的 IPC 边界。
 *
 * 与设计画布、远程访问那两处同一套做法:通道名写成常量,载荷在这里校验,业务逻辑留在
 * **不 import Electron** 的服务里(`knowledge-service.ts`)。于是这一层只做转接,能测的部分
 * 都不在这里。
 *
 * 只有三个方法,**加工不在其中**:整理知识库 = 开一个 `knowledge` 工作类型的会话,走既有的
 * `createAndPrompt`。为此新造一条"开始加工"的通道,等于把会话生命周期复制一份 —— 而它会漂。
 */

export const KNOWLEDGE_SNAPSHOT_CHANNEL = "wordless:knowledge:snapshot";
export const KNOWLEDGE_IMPORT_CHANNEL = "wordless:knowledge:import";
export const KNOWLEDGE_REVEAL_CHANNEL = "wordless:knowledge:reveal";
/** 立即整理一轮。**与定时轮询走同一条路**(见 `knowledge-poller.ts`)。 */
export const KNOWLEDGE_ORGANIZE_CHANNEL = "wordless:knowledge:organize";
/** 把一段回答归档进知识库。 */
export const KNOWLEDGE_FILE_ANSWER_CHANNEL = "wordless:knowledge:file-answer";
/** 把一页从"待回收"里救回来。 */
export const KNOWLEDGE_RESTORE_CHANNEL = "wordless:knowledge:restore";
/** 清空整理结果(保留原始文件)。 */
export const KNOWLEDGE_CLEAR_PAGES_CHANNEL = "wordless:knowledge:clear-pages";
/** 立即删除一页(不等宽限期)。 */
export const KNOWLEDGE_DELETE_PAGE_CHANNEL = "wordless:knowledge:delete-page";
/** 读一页的正文(界面预览用)。 */
export const KNOWLEDGE_PAGE_CONTENT_CHANNEL = "wordless:knowledge:page-content";
/** 库清单(当前用哪个 + 有哪些)。 */
export const KNOWLEDGE_LIBRARIES_CHANNEL = "wordless:knowledge:libraries";
/** 新建 / 删除一个库。 */
export const KNOWLEDGE_LIBRARY_MUTATE_CHANNEL = "wordless:knowledge:library-mutate";
/** 导入别人的 OKF bundle:选目录 → 看计划 → 确认。 */
export const KNOWLEDGE_IMPORT_BUNDLE_CHANNEL = "wordless:knowledge:import-bundle";
/** 知识库的累计用量。 */
export const KNOWLEDGE_USAGE_CHANNEL = "wordless:knowledge:usage";
/** 标记/取消一页的人工复核。 */
export const KNOWLEDGE_VERIFY_CHANNEL = "wordless:knowledge:verify";
/** 「正在整理」的状态变化。 */
export const KNOWLEDGE_PROCESSING_CHANNEL = "wordless:knowledge:processing";
/**
 * 库变了(导入、或 agent 在会话里写了页)—— 界面据此重取快照。
 *
 * 由**服务**的 `onChange` 触发(见 `main/index.ts`),不经过这里:写入发生在服务里,
 * 包括 agent 在会话里写页那条路,而它不经过 IPC。
 */
export const KNOWLEDGE_CHANGED_CHANNEL = "wordless:knowledge:changed";

export interface RegisterKnowledgeIpcOptions {
  /**
   * **每次调用现解析**当前在用的库。
   *
   * 不在这里缓存一个 service:用户随时可能在设置里切库,而 IPC 处理器是长期注册的 ——
   * 缓存下来的那个会让"切了库但操作还落在旧库上"变成一类很难查的怪事。
   */
  resolveService: () => Promise<KnowledgeService>;
  /** 库清单与当前那个。清单从文件系统推出来(见 knowledge-library.ts)。 */
  resolveLibraries: () => Promise<{ active: string; names: string[] }>;
  /** 新建一个库(返回归一后的名字)。 */
  createLibrary: (name: string) => Promise<string>;
  /** 删掉一个库的目录。**只删它自己**。 */
  deleteLibrary: (name: string) => Promise<void>;
  /** 把一页从"待回收"里救回来(清孤儿标 + 去掉退役 + 标人工复核)。 */
  restorePage: (path: string, now: string) => Promise<void>;
  /** 立即删除一页(与定时回收同一个实现,所以"摘引用"不会漏)。 */
  deletePage: (path: string, now: string) => Promise<void>;
  /** 清空整理结果(保留原始文件)。 */
  clearPages: () => Promise<KnowledgeClearPlan>;
  /** 立即跑一轮。由 poller 提供 —— 手动与定时必须走同一条路。 */
  organize: (kind: "process" | "lint") => Promise<{ sessionId?: string; skipped?: string }>;
  /** 累计用量。由宿主提供 —— 只有它能按 `entryId` 找到加工会话并读它们的用量。 */
  readUsage: () => Promise<KnowledgeUsageSummary>;
  /** 归档一段回答。由宿主提供 —— 它知道怎么起知识会话、用哪个模型。 */
  fileAnswer: (input: { text: string; sourceTitle?: string }) => Promise<{ sessionId: string }>;
  /** 选一个目录(系统对话框)。返回 null = 用户取消。 */
  pickDirectory: () => Promise<string | null>;
  /** 在系统文件管理器里打开一个目录(宿主注入,便于测试与复用)。 */
  revealPath: (path: string) => Promise<void>;
}

export function registerKnowledgeIpc(options: RegisterKnowledgeIpcOptions): void {
  const { resolveService, resolveLibraries, createLibrary, deleteLibrary, restorePage, deletePage, clearPages, organize, readUsage, fileAnswer, pickDirectory, revealPath } = options;

  ipcMain.handle(KNOWLEDGE_SNAPSHOT_CHANNEL, async (): Promise<KnowledgeSnapshot> => {
    // 打开视图时先建骨架:用户第一次点进来时库里什么都没有,而"什么都没有"不该是一屏空白。
    await (await resolveService()).ensureBundle();
    return await (await resolveService()).snapshot();
  });

  ipcMain.handle(KNOWLEDGE_RESTORE_CHANNEL, async (_event, payload: unknown): Promise<void> => {
    if (!Value.Check(RestoreKnowledgePageSchema, payload)) throw new Error("Invalid request payload");
    await restorePage(payload.path, new Date().toISOString());
  });

  ipcMain.handle(KNOWLEDGE_CLEAR_PAGES_CHANNEL, async (_event, payload: unknown): Promise<KnowledgeClearPlan> => {
    if (!Value.Check(ClearKnowledgePagesSchema, payload)) throw new Error("Invalid request payload");
    // 不带 confirm = 先只看一遍会失去什么(与导入那份"先看再导"同一套)。
    if (payload.confirm !== true) return await (await resolveService()).clearPlan();
    return await (await resolveService()).clearDerivedPages();
  });

  ipcMain.handle(KNOWLEDGE_DELETE_PAGE_CHANNEL, async (_event, payload: unknown): Promise<void> => {
    if (!Value.Check(DeleteKnowledgePageSchema, payload)) throw new Error("Invalid request payload");
    await deletePage(payload.path, new Date().toISOString());
  });

  ipcMain.handle(KNOWLEDGE_PAGE_CONTENT_CHANNEL, async (_event, payload: unknown): Promise<KnowledgePageContent | null> => {
    if (!Value.Check(KnowledgePageContentRequestSchema, payload)) throw new Error("Invalid request payload");
    return await (await resolveService()).pageContent(payload.path);
  });

  ipcMain.handle(KNOWLEDGE_IMPORT_CHANNEL, async (_event, payload: unknown): Promise<ImportKnowledgeFilesResult> => {
    if (!Value.Check(ImportKnowledgeFilesSchema, payload)) throw new Error("Invalid request payload");
    return await (await resolveService()).importFiles(payload.sourcePaths, payload.mode);
  });

  ipcMain.handle(KNOWLEDGE_ORGANIZE_CHANNEL, async (_event, payload: unknown): Promise<KnowledgeOrganizeResult> => {
    // kind 只有两种取值,而且它不是用户输入 —— 手写校验比为一个字面量联合引入 schema 更省。
    const kind = payload === "lint" ? "lint" : "process";
    const outcome = await organize(kind);
    return {
      ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
      ...(outcome.skipped === undefined ? {} : { skipped: outcome.skipped }),
    };
  });

  ipcMain.handle(KNOWLEDGE_VERIFY_CHANNEL, async (_event, payload: unknown): Promise<void> => {
    if (!Value.Check(SetKnowledgeVerificationSchema, payload)) throw new Error("Invalid request payload");
    await (await resolveService()).setPageVerification(payload.path, payload.verified, new Date().toISOString());
  });

  ipcMain.handle(KNOWLEDGE_USAGE_CHANNEL, async (): Promise<KnowledgeUsageSummary> => await readUsage());

  ipcMain.handle(KNOWLEDGE_FILE_ANSWER_CHANNEL, async (_event, payload: unknown): Promise<{ sessionId: string }> => {
    if (!Value.Check(FileKnowledgeAnswerSchema, payload)) throw new Error("Invalid request payload");
    return await fileAnswer({
      text: payload.text,
      ...(payload.sourceTitle === undefined ? {} : { sourceTitle: payload.sourceTitle }),
    });
  });

  ipcMain.handle(KNOWLEDGE_LIBRARIES_CHANNEL, async () => await resolveLibraries());

  ipcMain.handle(KNOWLEDGE_LIBRARY_MUTATE_CHANNEL, async (_event, payload: unknown): Promise<{ active?: string }> => {
    if (!Value.Check(MutateKnowledgeLibrarySchema, payload)) throw new Error("Invalid request payload");
    if (payload.action === "create") {
      const name = await createLibrary(payload.name);
      // 新建完就切过去:用户刚建了一个库,他的下一步一定是在里面做事。
      return { active: name };
    }
    await deleteLibrary(payload.name);
    return {};
  });

  ipcMain.handle(KNOWLEDGE_IMPORT_BUNDLE_CHANNEL, async (_event, payload: unknown): Promise<KnowledgeImportPlan | null> => {
    // 一次调用两步:没有 directory = 让用户选(并返回计划);有 directory = 就那份计划执行。
    // 中间不存"上次看的那份":状态留在界面手里,宿主保持无状态(它本来就不该记得 UI 走到哪一步)。
    if (payload !== undefined && Value.Check(ImportKnowledgeBundleSchema, payload)) {
      const result = await (await resolveService()).applyImport(payload.directory, payload.onConflict, new Date().toISOString());
      await (await resolveService()).rebuildIndex();
      return {
        directory: payload.directory,
        added: result.imported,
        conflicts: [],
        damaged: [],
        raws: result.raws,
        sourceFilesMissing: false,
        droppedFields: {},
        mappedTypes: {},
        truncatedTags: 0,
      };
    }
    const directory = await pickDirectory();
    if (directory === null) return null;
    const plan = await (await resolveService()).planImport(directory);
    return {
      directory,
      added: plan.added.length,
      conflicts: plan.conflicts,
      damaged: plan.damaged,
      raws: plan.raws,
      sourceFilesMissing: plan.sourceFilesMissing,
      droppedFields: plan.droppedFields,
      mappedTypes: plan.mappedTypes,
      truncatedTags: plan.truncatedTags,
    };
  });

  ipcMain.handle(KNOWLEDGE_REVEAL_CHANNEL, async (): Promise<void> => {
    await (await resolveService()).ensureBundle();
    await revealPath((await resolveService()).bundleRoot);
  });
}
