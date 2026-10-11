import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { AgentExtensionManager } from "@wordless/agent-extension-runtime";
import { contextCompactionExtension } from "@wordless/agent-extension-context-compaction";
import { planModeExtension } from "@wordless/agent-extension-plan-mode";
import {
  expertTeamExtension,
  subagentExtension,
} from "@wordless/agent-extension-subagent";
import { createCodingAgentDriver } from "@wordless/agent-driver-coding";
import { createPresentationAgentDriver } from "@wordless/agent-driver-presentation";
import { createSpreadsheetAgentDriver } from "@wordless/agent-driver-spreadsheet";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { createGenericAgentDriver } from "@wordless/agent-driver-generic";
import { createDataAnalysisTools, type DataAnalysisService } from "@wordless/capability-data";
import { createBrowserTools } from "@wordless/capability-browser";
import { createDocumentTools } from "@wordless/capability-documents";
import { createKnowledgeReadTools, createKnowledgeWriteTools } from "@wordless/capability-knowledge";
import { createOcrTools } from "@wordless/capability-ocr";
import { createDesignTools } from "@wordless/capability-design";
import { createDesignCapabilityPort } from "../design/design-capability-port";
import { createDocumentPort } from "../documents/document-port";
import type { DocumentService } from "../documents/document-service";
import { createKnowledgePort } from "../knowledge/knowledge-port";
import type { KnowledgeService } from "../knowledge/knowledge-service";
import { createOcrPort } from "../ocr/ocr-port";
import type { OcrService } from "../ocr/ocr-service";
import { WorkspacePathService } from "@wordless/platform-node";
import type { DesignStore } from "../design/design-store";
import type { OffscreenEvaluatePort, RasterPort } from "../design/raster-port";
import { createAgentDriverRegistry } from "@wordless/agent-driver-sdk";
import { codingProfile } from "@wordless/profile-coding";
import { generalProfile } from "@wordless/profile-general";
import { pptProfile } from "@wordless/profile-ppt";
import { excelProfile } from "@wordless/profile-excel";
import { dataProfile } from "@wordless/profile-data";
import { uiProfile } from "@wordless/profile-ui";
import { knowledgeProfile } from "@wordless/profile-knowledge";
import { createProfileRegistry } from "@wordless/profile-sdk";
import { WordlessRuntime } from "@wordless/runtime";
import { WorkspaceSearchService } from "@wordless/platform-node";
import { DESIGN_RASTER_BUDGETS } from "../design/raster-budgets";
import type { BuildRecipe } from "../design/build-recipes";
import type { BuildRunner } from "../design/design-builder";
import { ElectronCredentialVault } from "../adapters/electron-credential-vault";
import { OfficeCliService } from "../office/office-cli-service";
import { DesktopDataAnalysisService } from "../data-analysis/data-analysis-service";
import { createBrowserPort } from "../browser/browser-port";
import type { BrowserService } from "../browser/browser-service";

export interface DesignRuntimeDeps {
  store: DesignStore;
  raster: RasterPort;
  evaluator: OffscreenEvaluatePort;
  /**
   * 构建能力。**agent 那条路也要它。**
   *
   * 从前这里没有它,于是 `design_create` 建出来的包从来没被编译过 —— 而
   * `built` 模式下 `dist/theme.css` 只能由构建产出,所以那些设计的每一帧都**一条样式都
   * 不生效**。它同时用于"建包即构建"与"刷新时补齐样式"。
   */
  builds?: { runner: BuildRunner; recipes: readonly BuildRecipe[] };
}

export function createDesktopRuntime(userData: string, office: OfficeCliService, credentialVault = new ElectronCredentialVault(path.join(userData, "credentials.json")), dataAnalysis: DataAnalysisService = new DesktopDataAnalysisService({ metadataRoot: path.join(userData, "analysis-metadata"), resourcesRoot: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources") }), browser?: BrowserService, design?: DesignRuntimeDeps, ocr?: OcrService, documents?: DocumentService, knowledge?: () => Promise<KnowledgeService>, options: { isKnowledgeEnabled?: () => boolean } = {}): WordlessRuntime {
  // OCR 工具按会话构建:端口捕获工作区根,"哪些路径允许读"属于会话。
  // 三个能力(文字识别、浏览器、文档)共用同一个路径约束实现:它只是"这个路径在不在
  // 工作区内"的判定,不带任何能力自己的状态。
  const workspacePaths = new WorkspacePathService();
  const ocrToolsFor = (workspaceRoot: string) =>
    ocr ? createOcrTools(createOcrPort(ocr, { workspaceRoot, isWithinRoot: (root, candidate) => workspacePaths.isWithinRoot(root, candidate) })) : [];
  // Browser tools are built per session, following the data capability: the port
  // captures the session id, because sharing and action grants belong to the task
  // the user was working on rather than to the app as a whole.
  /**
   * 浏览器工具按会话构建。
   *
   * 看不了图的模型有两种下场:有文字识别时把截图**读成文字**(截图的常见用途就是"页面上写了
   * 什么报错"),没有时连截都不截,回一句实话。
   */
  const browserToolsFor = (sessionId: string, imagesVisible: boolean, workspaceRoot: string) =>
    browser
      ? createBrowserTools(createBrowserPort(browser, sessionId), {
          imagesVisible,
          ...(ocr ? { ocr: createOcrPort(ocr, { workspaceRoot, isWithinRoot: (root, candidate) => workspacePaths.isWithinRoot(root, candidate) }) } : {}),
        })
      : [];
  /**
   * 文档工具按会话构建,与文字识别同一个理由:端口捕获工作区根,而"哪些文件属于这次会话"
   * 是会话的属性。
   *
   * 与文字识别的关系是**互补而不是重叠**:文字识别读图里的字,这两个工具读 PDF 与网页的
   * 文本层。扫描件(没有文本层的 PDF)两者都读不了 —— 这正是文档工具要**明确说出来**的原因。
   */
  /**
   * 知识库工具,**按读/写分成两组**。
   *
   * **不按工作区构建**:知识库是应用拥有的位置,不在任何会话工作区之内 —— 这是刻意的
   * (见 `docs/architecture/knowledge-base.md` §3.1:投递箱与用户的工作区零纠缠)。
   * 路径约束因此改由页面规则承担:`raws/**` 与派生物写不进去。
   *
   * 为什么分两组:**读是能力,写是纪律**。查页与查词表只读、不产生累积损伤,而且"关于 X 我们
   * 知道什么"对每一种工作类型都有用,所以它们进每个驱动;而写页没有约定就会让知识库碎片化
   * (近重复的概念页、发散的标签),那个损伤累积且难回滚,所以它只在加载了加工约定的 profile
   * 上装配。判据见 `docs/architecture/knowledge-base.md` §6.2。
   */
  const knowledgePortFor = () => (knowledge ? createKnowledgePort(knowledge) : undefined);
  // **懒读**偏好,不在这里取快照:工具是按会话装配的,而开关随时可能被改。
  // 与 OCR 的 `readOptions` 同一做法(它在 main/index.ts 里闭包了同一个 runtime 变量)。
  const knowledgeToolsAllowed = () => documents !== undefined || knowledge !== undefined ? (options.isKnowledgeEnabled?.() ?? true) : false;
  const knowledgeReadToolsFor = () => {
    const port = knowledgePortFor();
    return port && knowledgeToolsAllowed() ? createKnowledgeReadTools(port) : [];
  };
  const knowledgeWriteToolsFor = () => {
    const port = knowledgePortFor();
    return port && knowledgeToolsAllowed() ? createKnowledgeWriteTools(port) : [];
  };
  const documentToolsFor = (workspaceRoot: string) =>
    documents
      ? createDocumentTools(
          createDocumentPort(documents, { workspaceRoot, isWithinRoot: (root, candidate) => workspacePaths.isWithinRoot(root, candidate) }),
          {
            // 扫描件回退:没有文本层的 PDF 页渲染成图后交给文字识别。与 `browser_screenshot`
            // 用同一个端口、同一个取舍 —— 像素递不过去时,能读成文字总比什么都不做强。
            ...(ocr ? { ocr: createOcrPort(ocr, { workspaceRoot, isWithinRoot: (root, candidate) => workspacePaths.isWithinRoot(root, candidate) }) } : {}),
          },
        )
      : [];
  /**
   * 设计工具按会话构建,与浏览器那套同一个理由:端口捕获工作区根,而"哪份设计"属于
   * 用户当时在做的任务,不属于应用整体。
   */
  const designToolsFor = (workspaceRoot: string) =>
    design
      ? createDesignTools(
          createDesignCapabilityPort({
            store: design.store,
            raster: design.raster,
            evaluator: design.evaluator,
            builds: design.builds,
            poolOptions: {
              concurrency: DESIGN_RASTER_BUDGETS.rasterConcurrency,
              timeoutMs: DESIGN_RASTER_BUDGETS.rasterTimeoutMs,
            },
            workspaceRoot,
          }),
        )
      : [];
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  const extensions = new AgentExtensionManager({
    path: path.join(userData, "agent-extensions.json"),
    definitions: [
      planModeExtension,
      subagentExtension,
      expertTeamExtension,
      contextCompactionExtension,
    ],
  });
  const workspaceSearch = new WorkspaceSearchService({
    ...(app.isPackaged ? {
      fffModuleUrl: pathToFileURL(path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@ff-labs", "fff-node", "dist", "src", "index.js")).href,
    } : {}),
  });
  return new WordlessRuntime({
    paths: {
      dataRoot: userData,
      databasePath: path.join(userData, "wordless.db"),
      builtInSkillsRoot: path.join(resourcesRoot, "skills"),
      journalsRoot: path.join(userData, "sessions"),
      modelConfiguration: {
        extensionsRoot: path.join(userData, "provider-extensions"),
        modelsPath: path.join(userData, "models.json"),
        settingsPath: path.join(userData, "settings.json"),
      },
      sessionWorkspacesRoot: path.join(userData, "session-workspaces"),
    },
    credentialVault,
    defaultWorkspaceRoot: path.join(app.getPath("documents"), "Wordless"),
    profiles: createProfileRegistry([generalProfile, codingProfile, pptProfile, excelProfile, dataProfile, uiProfile, knowledgeProfile]),
    extensions,
    workspaceSearch,
    drivers: createAgentDriverRegistry([
      createGenericAgentDriver({
        createExtensionHost: extensions,
        createTools: (context) => [
          ...createHeadlessCodingTools(context.env, context.workspaceSearch),
          ...browserToolsFor(context.resourceOwnerSessionId ?? context.record.id, context.model.input.includes("image"), context.record.runtimeRootPath),
          ...(context.profile.reference.id === "ui" ? designToolsFor(context.record.runtimeRootPath) : []),
          // 文字识别对所有 profile 都可用:它只是"读图里的字",没有任何写操作。
          ...ocrToolsFor(context.record.runtimeRootPath),
          // 文档抽取同理:读 PDF 与网页的文本层,没有写操作,也不碰网络之外的东西
          // (出网策略在服务里)。这两个工具是"agent 能消费用户手上文件"的前提。
          ...documentToolsFor(context.record.runtimeRootPath),
          // 知识库:读工具对通用驱动的三个 profile 都可用;写工具只给整理 profile。
          ...knowledgeReadToolsFor(),
          ...(context.profile.reference.id === "knowledge" ? knowledgeWriteToolsFor() : []),
          ...(context.profile.reference.id === "data" ? createDataAnalysisTools(dataAnalysis, {
            sessionId: context.resourceOwnerSessionId ?? context.record.id,
            workspaceRoot: context.record.runtimeRootPath,
            webResearchAvailable: context.connectorTools.some((tool) => /(?:web|search)/i.test(`${tool.name} ${tool.label} ${tool.description}`)),
            subagentRunner: context.subagentRunner,
          }) : []),
        ],
        preflightOperation: preflightWorkspaceOperation,
      }),
      createCodingAgentDriver({
        createExtensionHost: extensions,
        extraTools: (context) => [
          ...browserToolsFor(context.resourceOwnerSessionId ?? context.record.id, context.model.input.includes("image"), context.record.runtimeRootPath),
          // 贴一张报错截图然后问"哪里错了"最常发生在写代码这条路,所以这里也要有。
          ...ocrToolsFor(context.record.runtimeRootPath),
          // 同理:写代码时常要读一份规格 PDF 或一个接口文档页。
          ...documentToolsFor(context.record.runtimeRootPath),
          // 只读:写代码时"这个项目约定过什么"值得查,但整理知识库不是编码会话的事。
          ...knowledgeReadToolsFor(),
        ],
      }),
      createPresentationAgentDriver(office, {
        createWorkspaceTools: (context) => [
          ...createHeadlessCodingTools(context.env, context.workspaceSearch),
          // 做演示时常要引用用户资料库里的口径与结论 —— 只读。
          ...knowledgeReadToolsFor(),
        ],
        preflightWorkspaceOperation,
      }),
      createSpreadsheetAgentDriver(office, {
        createWorkspaceTools: (context) => [
          ...createHeadlessCodingTools(context.env, context.workspaceSearch),
          // 同上:口径与定义值得查知识库。
          ...knowledgeReadToolsFor(),
        ],
        preflightWorkspaceOperation,
      }),
    ]),
  });
}
