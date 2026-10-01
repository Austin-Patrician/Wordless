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
import { createOcrTools } from "@wordless/capability-ocr";
import { createDesignTools } from "@wordless/capability-design";
import { createDesignCapabilityPort } from "../design/design-capability-port";
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

export function createDesktopRuntime(userData: string, office: OfficeCliService, credentialVault = new ElectronCredentialVault(path.join(userData, "credentials.json")), dataAnalysis: DataAnalysisService = new DesktopDataAnalysisService({ metadataRoot: path.join(userData, "analysis-metadata"), resourcesRoot: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources") }), browser?: BrowserService, design?: DesignRuntimeDeps, ocr?: OcrService): WordlessRuntime {
  // OCR 工具按会话构建:端口捕获工作区根,"哪些路径允许读"属于会话。
  const ocrPaths = new WorkspacePathService();
  const ocrToolsFor = (workspaceRoot: string) =>
    ocr ? createOcrTools(createOcrPort(ocr, { workspaceRoot, isWithinRoot: (root, candidate) => ocrPaths.isWithinRoot(root, candidate) })) : [];
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
          ...(ocr ? { ocr: createOcrPort(ocr, { workspaceRoot, isWithinRoot: (root, candidate) => ocrPaths.isWithinRoot(root, candidate) }) } : {}),
        })
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
    profiles: createProfileRegistry([generalProfile, codingProfile, pptProfile, excelProfile, dataProfile, uiProfile]),
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
        ],
      }),
      createPresentationAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env, context.workspaceSearch),
        preflightWorkspaceOperation,
      }),
      createSpreadsheetAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env, context.workspaceSearch),
        preflightWorkspaceOperation,
      }),
    ]),
  });
}
