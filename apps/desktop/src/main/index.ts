import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, session, shell, Tray } from "electron";
import {
  DEFAULT_KNOWLEDGE_BASE_NAME,
  DEFAULT_KNOWLEDGE_PREFERENCES,
  knowledgeSettingsFor,
  normalizeOcrPreferences,
  type AppPreferences,
} from "@wordless/domain";
import { createDesktopRuntime } from "./bootstrap/create-runtime";
import { prepareUserDataPath } from "./bootstrap/user-data";
import { registerRuntimeIpc } from "./ipc/register-runtime-ipc";
import { registerBrowserIpc } from "./ipc/register-browser-ipc";
import { WebContentsViewHost } from "./browser/browser-host";
import { BrowserService } from "./browser/browser-service";
import { DesktopNotificationService } from "./notifications/desktop-notification-service";
import { createDesktopNotificationHost } from "./notifications/desktop-notification-host";
import { registerDesktopNotificationIpc } from "./ipc/register-desktop-notification-ipc";
import { DesktopTranslationService } from "./translation/translation-service";
import { AppearanceAssetService } from "./appearance/appearance-asset-service";
import { registerAppearanceProtocol } from "./protocols/appearance";
import { registerMediaProtocol } from "./protocols/media";
import { registerPresentationProtocol } from "./protocols/presentation";
import { registerAnalysisProtocol } from "./protocols/analysis";
import { registerAttachmentProtocol } from "./protocols/attachment";
import { registerDesignProtocol, registerDesignScheme } from "./protocols/design";
import { registerOcrProtocol, registerOcrScheme } from "./protocols/ocr";
import { ElectronOcrRunner } from "./ocr/ocr-runner";
import { OcrService } from "./ocr/ocr-service";
import { DocumentService } from "./documents/document-service";
import { KnowledgeService } from "./knowledge/knowledge-service";
import {
  knowledgeBundlePath,
  looksLikeKnowledgeBundle,
  normalizeKnowledgeBaseName,
  resolveActiveKnowledgeBase,
} from "./knowledge/knowledge-library";
import { KNOWLEDGE_CHANGED_CHANNEL, KNOWLEDGE_PROCESSING_CHANNEL, registerKnowledgeIpc } from "./ipc/register-knowledge-ipc";
import { KnowledgePoller } from "./knowledge/knowledge-poller";
import type { KnowledgeRoundPlan } from "./knowledge/knowledge-service";
import {
  buildKnowledgeFilingPrompt,
  buildKnowledgeLintPrompt,
  buildKnowledgeRoundPrompt,
  citedPagesOf,
  promptTitle,
  summarizeHealthReport,
} from "./knowledge/knowledge-round-prompt";
import { settleKnowledgeRound } from "./knowledge/knowledge-settle";
import { isHealthReportClean } from "./knowledge/knowledge-lint";
import { knowledgeSessionRequest } from "./knowledge/knowledge-session";
import { createDesignHandlers } from "./design/handlers";
import { NodeDesignExporter } from "./design/design-exporter";
import { ElectronDesignClipboard } from "./design/design-clipboard";
import { RasterPool } from "./design/raster-pool";
import { ElectronOffscreenRaster } from "./design/electron-offscreen-raster";
import { WebContentsViewDesignHost } from "./design/design-view-host";
import { DESIGN_RASTER_BUDGETS } from "./design/raster-budgets";
import { registerDesignIpc } from "./ipc/register-design-ipc";
import { DesignStore } from "./design/design-store";
import { designBuildRecipes } from "./design/build-recipes";
import { NodeBuildRunner } from "./design/node-build-runner";
import { NodeDesignFs } from "./design/design-fs";
import { WorkspacePathService } from "@wordless/platform-node";
import { OnboardingService } from "./onboarding/onboarding-service";
import { createMainWindow, updateTitleBarOverlays } from "./windows/main-window";
import { closingQuitsApplication, createDesktopHostInfo } from "./platform/desktop-platform";
import { ApplicationMenuController } from "./menu/application-menu";
import { hydrateShellEnvironment } from "./environment/shell-environment";
import { HostEnvironmentService } from "./environment/host-environment-service";
import { DesktopUpdateService } from "./update/update-service";
import { OfficeCliService } from "./office/office-cli-service";
import { ElectronCredentialVault } from "./adapters/electron-credential-vault";
import { GoogleAccountService } from "./account/google-account-service";
import { CloudSyncService } from "./cloud-sync/cloud-sync-service";
import { GoogleDriveAppData } from "./cloud-sync/google-drive-app-data";
import { DesktopDataAnalysisService } from "./data-analysis/data-analysis-service";
import { configureHttpDispatcher } from "./network/http-dispatcher";
import { applyDesktopProxy, proxyRulesFromEnvironment } from "./proxy/proxy-runtime";
import { DesktopProxyStore } from "./proxy/proxy-store";
import { registerProxyIpc } from "./ipc/register-proxy-ipc";
import { DESIGN_STYLES } from "./design/style-catalog.ts";
import { createRuntimeSessionSurface } from "./remote/session-surface";
import { RemoteAccessService } from "./remote/remote-access-service";
import { createRemoteAccessStore } from "./remote/remote-access-store";
import { createRelayMailbox } from "./remote/relay-mailbox";
import { registerNotificationDefaultsIpc, registerNotificationIpc } from "./ipc/register-notification-ipc";
import { registerRemoteIpc } from "./ipc/register-remote-ipc";
import { sendToRendererWindow } from "./renderer-window";
import { hostname } from "node:os";
// `ws` 是 CJS 包:主进程被打成 single-file CJS 时,命名导入曾经是 undefined。
// 默认导入拿到的是类本身,而 `nodeWebSocketFactory` 三种形状都能吃。
import WebSocket from "ws";
import { WebSocketTransport, nodeWebSocketFactory, sha256Hex } from "@wordless/remote-control";
import { WebhookManager } from "./notifications/webhook/manager";
import { getProvider, isSupportedKind } from "./notifications/webhook/providers/registry.ts";
import {
  defaultNotificationDefaultsPath,
  loadNotificationDefaults,
  saveNotificationDefaults,
} from "./notifications/settings-store.ts";
import { NotificationBus } from "./notifications/bus.ts";
import { lastAssistantText } from "./notifications/reply.ts";
import { AutomationService } from "./automation/automation-service";

import { McpRegistryService } from "./marketplace/mcp-registry-service";
import { SkillsMpMarketplaceService } from "./marketplace/skillsmp-marketplace-service";

declare const __WORDLESS_GOOGLE_CLIENT_ID__: string;
declare const __WORDLESS_GOOGLE_CLIENT_SECRET__: string;
declare const __WORDLESS_SKILLSMP_API_KEY__: string;

app.setName("Wordless");
/**
 * The taskbar identity. Windows groups taskbar buttons and resolves their icon
 * through the AppUserModelID, so a dev run must not claim the shipped app's id:
 * while it did, running `npm run dev:electron` gave the packaged app's button the
 * dev binary's icon (the Electron default), and the two builds collided on one
 * taskbar entry. Packaged builds keep the id the NSIS shortcut registers.
 */
app.setAppUserModelId(app.isPackaged ? "com.wordless.desktop" : "com.wordless.desktop.dev");
const userData = prepareUserDataPath();
app.setPath("userData", userData.path);

let runtime: ReturnType<typeof createDesktopRuntime> | undefined;
let remoteAccess: RemoteAccessService | undefined;
let office: OfficeCliService | undefined;
/** 设计包读写。协议与 IPC 都经它拿注册表,所以必须是同一个实例。 */
let designStore: DesignStore | undefined;
/** 光栅化池。离屏窗口是真实渲染进程,退出时要一起关掉。 */
let designRaster: ElectronOffscreenRaster | undefined;
/** OCR 运行器:一个常驻隐藏窗口 + 常热引擎。退出时要一起关掉。 */
let ocrRunner: ElectronOcrRunner | undefined;
/** 加工调度器。模块级是因为 `before-quit` 要停它,而它在引导函数里构造。 */
let knowledgePoller: KnowledgePoller<KnowledgeRoundPlan> | undefined;
/** 活体视图宿主。至多一个,所以只需要一个实例。 */
let designViewHost: WebContentsViewDesignHost | undefined;
let account: GoogleAccountService | undefined;
let cloudSync: CloudSyncService | undefined;
let automation: AutomationService | undefined;
let translation: DesktopTranslationService | undefined;
let tray: Tray | undefined;
let disposing = false;
let quitting = false;
let browser: BrowserService | undefined;
let notifications: DesktopNotificationService | undefined;
let notificationBus: NotificationBus | undefined;
const hostInfo = createDesktopHostInfo();
let mainWindow: BrowserWindow | undefined;
const hasSingleInstance = app.requestSingleInstanceLock();

/**
 * 把事件发给**应用窗口**(晚绑定:`mainWindow` 在启动后才建出来)。
 *
 * 为什么不用 `BrowserWindow.getAllWindows()`:那个列表里还有**辅助窗口** ——
 * OCR 运行器、设计离屏栅格池。它们**不订阅**这些事件,而且**开了又关**;一个正在关掉的窗口,
 * 它的渲染帧已经没了,这时候 `send` 就是那句 `Render frame was disposed …`(用户报过)。
 * 事件本来只有应用窗口要,那就只发给它 —— 顺带把这类报错从源头上消掉。
 *
 * 检查本身在 `renderer-window.ts`:那是"能不能发"的唯一一处。
 */
function sendToAppWindow(channel: string, payload: unknown): void {
  // 退出中:**一个字都不再发**。这一段时间里窗口正在被拆(而且 `runtime.dispose()` 还会
  // 冒出最后几条事件)—— 往一个正在拆的帧发,就是那句 "Render frame was disposed"。
  // 退出时也没有人需要这些事件了。
  if (quitting) return;
  sendToRendererWindow(mainWindow, channel, payload);
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/**
 * 标题栏上那三个按钮的动作(Linux:系统不画那组按钮,渲染层自己画)。
 *
 * `close` 走的是 `window.close()` —— 与点窗口的 × 完全同一条路,所以"Linux 上关窗即退出、
 * 其他平台收进托盘"这条规则不会被按钮绕过去(见 `closingQuitsApplication`)。
 */
function controlMainWindow(action: import("@wordless/protocol").DesktopWindowControl): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (action === "minimize") window.minimize();
  else if (action === "toggle-maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
  else window.close();
}

/**
 * 主窗口的行为。**两处创建窗口(启动、`activate` 重建)必须挂同一套** —— 这里原来是复制粘贴的
 * 两份,加"窗口状态变化"这条事件时正好收成一处,免得下次再漏一处。
 *
 * 窗口状态是**推 + 拉**两条路:事件覆盖变化,`getWindowState` 覆盖"挂载时窗口已经是最大化的"
 * (窗口状态被系统恢复的情况)。只做推送的话,那一种情况下按钮的图标会一直错到用户手动切换为止。
 */
function attachMainWindowBehaviour(window: BrowserWindow): void {
  window.on("close", (event) => { if (!quitting && !closingQuitsApplication()) { event.preventDefault(); window.hide(); } });
  window.on("focus", () => notifications?.clearBadge());
  const sendWindowState = () =>
    sendToAppWindow("wordless:host-event", { type: "window.changed", state: { maximized: window.isMaximized() } });
  window.on("maximize", sendWindowState);
  window.on("unmaximize", sendWindowState);
}

function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, process.platform === "win32" ? "wordless.ico" : "wordless.png");
  if (process.platform !== "darwin") return nativeImage.createFromPath(iconPath);
  // Keep the 1024px source out of AppKit's status-item cache. A status item
  // only needs a small bitmap, especially on Retina where Electron supplies
  // the backing scale factor itself.
  return nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32, quality: "best" });
}

function updateTrayMenu(preferences: AppPreferences): void {
  if (!tray) return;
  const chinese = preferences.locale === "zh-CN";
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: chinese ? "打开 Wordless" : "Open Wordless", click: showWindow },
      { type: "separator" },
      {
        label: chinese ? "退出 Wordless" : "Quit Wordless",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// 必须在 `app.whenReady()` 之前:设计帧要解析相对 URL(`../theme.css`),
// 那要求这个 scheme 被登记成标准 scheme。见 protocols/design.ts 的说明。
registerDesignScheme();
// 同理,而且 OCR 那个还多一层:`secure` 与 COOP/COEP 是**多线程 wasm** 的前提
// (没有跨源隔离就没有 SharedArrayBuffer)。见 protocols/ocr.ts。
registerOcrScheme();

if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    sendToAppWindow("wordless:host-event", { type: "deep-link", url });
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstance) return;
  /**
   * 未打包运行时,dock 与**原生对话框**的图标是 Electron 自己的 —— 用户看到的就是那个
   * (实测被指出过:知识库「移动进来」的确认弹窗)。打包后图标来自应用包(见
   * electron-builder.yml 的 `icon`),所以这里只是把开发态补齐。
   */
  if (process.platform === "darwin" && app.dock !== undefined) {
    const icon = nativeImage.createFromPath(path.join(__dirname, "wordless.png"));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }
  await hydrateShellEnvironment(hostInfo);
  // Node 兜底(P2):没有可用 node 的机器上,把 Wordless 自带的那份放到 PATH 最前面(零字节 ——
  // Electron 本身就是 Node)。刻意不 await:命令是逐次 spawn 时才读 PATH 的,用户在窗口里点第一条
  // 消息之前它早就装好了,启动不该等它。探测与写入都吞错误(见 host-environment-service.ts)。
  // 内置 Python(P4):打包进来的是"可重定位的一份 CPython",首启拷到用户目录再跑(见
  // host-environment-service.seedPythonRuntime)。拷贝在第一次读环境事实时惰性发生,同样不阻塞启动。
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  const hostEnvironment = new HostEnvironmentService({
    binDirectory: path.join(userData.path, "bin"),
    pythonVendorDirectory: path.join(resourcesRoot, "python", `${process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux"}-${process.arch}`),
    runtimesDirectory: path.join(userData.path, "runtimes"),
  });
  void hostEnvironment.installNodeFallback();
  const appearanceAssets = new AppearanceAssetService(path.join(userData.path, "appearance", "backgrounds"));
  registerAppearanceProtocol(path.join(userData.path, "appearance", "backgrounds"));
  registerMediaProtocol(path.join(userData.path, "media-assets"));
  const presentationArtifactsRoot = path.join(userData.path, "presentation-artifacts");
  registerPresentationProtocol(presentationArtifactsRoot);
  const dataAnalysis = new DesktopDataAnalysisService({ metadataRoot: path.join(userData.path, "analysis-metadata"), resourcesRoot, hostEnvironment });
  registerAnalysisProtocol(dataAnalysis);
  // 文档抽取(本地 PDF / 网页 → 文本)。没有资产、没有协议、没有隐藏窗口:它只在被调用时
  // 才读文件或出网,而两个上限与 SSRF 判定都在服务里(见 document-service.ts)。
  const documents = new DocumentService();
  // 知识库。**放在用户可见的位置而不是 userData**:一个知识库是一份能带走的资产
  // (OKF bundle,含原始文件),埋进 app 容器就违背了这个目的。
  // 库名与位置在 P1 里先固定;「新建/切换知识库」属于界面那一层(见设计文档 §13)。
  //
  // `onChange` 在**服务里**触发(不是 IPC 层):写入包括 agent 在会话里写页那条路,而它
  // 不经过 IPC —— 界面因此不用轮询,也不会漏掉 agent 的改动。
  /**
   * 知识库的根目录:**每个子目录是一个库**。
   *
   * 清单**从文件系统推出来,不存注册表** —— 见 `knowledge-library.ts` 的文件头。
   */
  const knowledgeBaseRoot = path.join(app.getPath("documents"), "Wordless Knowledge");
  const knowledgeStateDirectory = path.join(userData.path, "knowledge-state");
  /** 建一个库的服务。服务只是路径持有者,所以按需构造、不必缓存。 */
  const knowledgeServiceAt = (name: string): KnowledgeService =>
    new KnowledgeService(knowledgeBundlePath(knowledgeBaseRoot, name), {
      // 变更通知在**服务里**触发(不是 IPC 层):写入包括 agent 在会话里写页那条路。
      onChange: () => sendToAppWindow(KNOWLEDGE_CHANGED_CHANNEL, undefined),
      // 失败账本放应用数据目录,且**按 bundle 根分文件** —— 每个库各记各的账。
      stateDirectory: knowledgeStateDirectory,
      // 每轮预算**懒读**(设置随时可能改),而且按**这个服务自己那个库**读:
      // 服务知道自己是谁,所以不必去问"当前是哪个库" —— 也就不会读到别的库的预算上。
      readBudget: () =>
        knowledgeSettingsFor(runtime?.getSnapshot().preferences.knowledge ?? DEFAULT_KNOWLEDGE_PREFERENCES, name).maxFilesPerRound,
    });

  /** 根目录下有哪些库:像库的才算(一个空目录不是库)。 */
  const listKnowledgeBaseNames = async (): Promise<string[]> => {
    const entries = await readdir(knowledgeBaseRoot, { withFileTypes: true }).catch(() => []);
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const children = await readdir(path.join(knowledgeBaseRoot, entry.name)).catch(() => []);
      if (looksLikeKnowledgeBundle(children)) names.push(entry.name);
    }
    return names.sort((a, b) => a.localeCompare(b));
  };

  /**
   * 当前在用的库。
   *
   * 记的那个名字可能已经不在了(用户在 Finder 里删了/改名了),那时**退到第一个可用的**;
   * 一个都没有就建默认那个 —— 用户不该先"新建一个库"才能开始用。
   */
  const activeKnowledgeBaseName = async (): Promise<string> => {
    const names = await listKnowledgeBaseNames();
    const preferred = runtime?.getSnapshot().preferences.knowledge.activeKnowledgeBase ?? null;
    const resolved = resolveActiveKnowledgeBase(names, preferred);
    if (resolved !== null) return resolved;
    await mkdir(knowledgeBundlePath(knowledgeBaseRoot, DEFAULT_KNOWLEDGE_BASE_NAME), { recursive: true });
    return DEFAULT_KNOWLEDGE_BASE_NAME;
  };

  const activeKnowledge = async (): Promise<KnowledgeService> => knowledgeServiceAt(await activeKnowledgeBaseName());
  /**
   * 加工调度器。
   *
   * **手动与定时走同一条路**:「立即整理」与定时轮询都调 `organize`,区别只有一个入参。
   * 两条路各写一遍"算待办 → 起会话 → 收尾",迟早会漂。
   */
  /**
   * 起一个知识会话。**轮询与归档共用** —— 两条路各写一遍"怎么起会话",迟早会漂
   * (工作类型、审批模式、模型解析都会分叉)。
   */
  const startKnowledgeSession = async (prompt: string, modelKey: string | null): Promise<string> => {
    const messageId = randomUUID();
    const { draft, options } = knowledgeSessionRequest({
      bundleRoot: (await activeKnowledge()).root,
      modelKey,
      title: promptTitle(),
      messageId,
      submittedAt: Date.now(),
    });
    const session = await runtime!.createAndPrompt(draft, prompt, [], { messageId, submittedAt: Date.now() }, options);
    return session.id;
  };

  /**
   * **当前这个库**配置的加工模型键(没有就 null = 跟随会话默认)。
   *
   * 异步是因为"当前是哪个库"要读文件系统 —— 库的清单就是目录,没有缓存的副本可查。
   */
  const processingModelKey = async (): Promise<string | null> => {
    const preferences = runtime?.getSnapshot().preferences.knowledge;
    if (preferences === undefined) return null;
    const model = knowledgeSettingsFor(preferences, await activeKnowledgeBaseName()).processingModel;
    return model === null ? null : `${model.connectionId}/${model.modelId}`;
  };

  knowledgePoller = new KnowledgePoller({
    readConfig: async () => {
      const preferences = runtime?.getSnapshot().preferences.knowledge;
      // **按当前在用的库**读间隔与模型:切了库,轮询就该跟着新库走(新库设成"只手动"就停)。
      const settings = knowledgeSettingsFor(preferences ?? DEFAULT_KNOWLEDGE_PREFERENCES, await activeKnowledgeBaseName());
      return {
        enabled: preferences?.enabled !== false,
        intervalMinutes: settings.autoProcessMinutes,
        modelKey: settings.processingModel
          ? `${settings.processingModel.connectionId}/${settings.processingModel.modelId}`
          : null,
      };
    },
    prepare: async (kind, now) => {
      // **按当前在用的库**:用户随时可能在设置里切库,而加工轮是异步起来的。
      const service = await activeKnowledge();
      if (kind === "lint") {
        // 体检:先把**算得出来**的问题算出来(死链、孤立页、无来源、标题撞车),
        // 干净就不起会话。要判断的那些(矛盾、缺页、缺引用)交给模型。
        const report = await service.healthReport();
        if (isHealthReportClean(report)) return null;
        return { kind, prompt: buildKnowledgeLintPrompt(report), summary: summarizeHealthReport(report), needsAgent: true };
      }
      const plan = await service.prepareRound(now);
      // 什么都没发生 → 不起会话、也不收尾:否则定时加工会每 N 分钟往 log.md 里写一行
      // "什么都没变",把真正发生过的事淹掉。
      if (plan.empty) return null;
      return {
        kind,
        prompt: buildKnowledgeRoundPrompt(plan),
        summary: `+${plan.diff.added.length} ~${plan.diff.changed.length}`,
        // 工程侧的动作(移动/删除/回收)不需要 agent;只有真有待办时才起会话。
        needsAgent: plan.needsProcessing,
        context: plan,
      };
    },
    startSession: startKnowledgeSession,
    finish: async (preparation, now) => {
      // **收尾只有这一个入口**(见 `knowledge-settle.ts` 的文件头:它以前散在两条路上,
      // 而失败对账只在其中一条里,于是会失败的那一轮从不记账)。
      await settleKnowledgeRound({
        service: await activeKnowledge(),
        kind: preparation.kind,
        needsAgent: preparation.needsAgent,
        plan: preparation.context ?? null,
        summary: preparation.summary,
        now,
      });
    },
    onProcessingChanged: (processing) => sendToAppWindow(KNOWLEDGE_PROCESSING_CHANNEL, processing),
    logger: { info: (message) => console.log(`[knowledge] ${message}`), warn: (message) => console.warn(`[knowledge] ${message}`) },
  });
  registerKnowledgeIpc({
    // **每次调用现解析**:用户可能刚切了库,而 IPC 处理器是长期注册的。
    resolveService: activeKnowledge,
    resolveLibraries: async () => ({
      active: await activeKnowledgeBaseName(),
      names: await listKnowledgeBaseNames(),
    }),
    // 界面上的「保留这一页」= 清孤儿标 + 去掉退役 + 标人工复核(三件事是一句话)。
    restorePage: async (path, now) => await (await activeKnowledge()).restorePage(path, now),
    deletePage: async (path, now) => await (await activeKnowledge()).deleteOrphanNow(path, now),
    clearPages: async () => await (await activeKnowledge()).clearDerivedPages(),
    createLibrary: async (name) => {
      const normalized = normalizeKnowledgeBaseName(name);
      // 具体规则在 `normalizeKnowledgeBaseName` 里(它同时挡路径逃逸与系统保留字符)。
      if (normalized === null) throw new Error("这个知识库名不能用:不能为空,也不能含路径分隔符或系统保留字符");
      await mkdir(knowledgeBundlePath(knowledgeBaseRoot, normalized), { recursive: true });
      await knowledgeServiceAt(normalized).ensureBundle();
      return normalized;
    },
    deleteLibrary: async (name) => {
      // **只删这个库自己的目录**。用户要删的东西就在这里,而它整个都是我们的。
      //
      // 归一挡的是**路径逃逸**:这是个 `rm -r`,库名又是从渲染层来的,`../..` 之类必须
      // 在这里就被挡掉 —— 归一之后再确认一次父目录,两道都要有。
      const normalized = normalizeKnowledgeBaseName(name);
      if (normalized === null) throw new Error("这个知识库名不能用:不能为空,也不能含路径分隔符或系统保留字符");
      const target = knowledgeBundlePath(knowledgeBaseRoot, normalized);
      if (path.dirname(target) !== knowledgeBaseRoot) throw new Error("拒绝删除知识库根目录之外的路径");
      await rm(target, { recursive: true, force: true });
    },
    organize: async (kind) => (await knowledgePoller?.organize("manual", kind)) ?? { skipped: "disabled" },
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
    },
    fileAnswer: async ({ text, sourceTitle }) => {
      // **引用页由工程抽**,不是让模型回忆:它回忆"我刚引了哪几页"不可靠,而 `sources` 是
      // 这一页能不能被核对的依据。归档用当前配置的加工模型(没配就跟随会话默认 —— 用户就在旁边)。
      const sessionId = await startKnowledgeSession(
        buildKnowledgeFilingPrompt({
          text,
          citedPages: citedPagesOf(text),
          ...(sourceTitle === undefined ? {} : { sourceTitle }),
        }),
        await processingModelKey(),
      );
      return { sessionId };
    },
    readUsage: async () => {
      // 加工会话按 `entryId` 认。**只读最近若干轮**:每一轮的用量要读那个会话的 journal,
      // 而一个跑了几百轮的知识库会把"打开视图"变成一次全库读盘。
      const SAMPLE = 50;
      const sessions = (runtime?.getSnapshot().sessions ?? [])
        .filter((session) => session.entryId === "knowledge")
        .sort((a, b) => b.updatedAt - a.updatedAt);
      let totalTokens = 0;
      let totalCost = 0;
      for (const session of sessions.slice(0, SAMPLE)) {
        const usage = await runtime!.getSessionUsage(session.id).catch(() => undefined);
        if (usage === undefined) continue;
        totalTokens += usage.chat.totalTokens;
        totalCost += usage.chat.totalCost;
      }
      return { rounds: Math.min(sessions.length, SAMPLE), totalTokens, totalCost, totalRounds: sessions.length };
    },
    revealPath: async (target) => {
      await shell.openPath(target);
    },
  });
  // 设计画布的协议。设计包路径**不进 URL**,只进注册表 —— 于是"从 URL 构造一个逃出
  // 设计包的路径"在结构上不可能(见 design-url.ts)。
  const designPaths = new WorkspacePathService();
  designStore = new DesignStore({ fs: new NodeDesignFs() });
  registerDesignProtocol({
    registry: designStore.registry,
    isWithinRoot: (root, candidate) => designPaths.isWithinRoot(root, candidate),
  });
  // OCR:资产在打包期准备好(`resources/ocr`),页面在 `dist/ocr-runner`(打包后在
  // `resources/ocr-runner`),两者都由 `wordless-ocr://` 供给那个隐藏窗口。
  registerOcrProtocol({
    runner: app.isPackaged ? path.join(process.resourcesPath, "ocr-runner") : path.resolve(__dirname, "../../dist/ocr-runner"),
    assets: path.join(resourcesRoot, "ocr"),
  });
  ocrRunner = new ElectronOcrRunner({
    entryUrl: "wordless-ocr://runner/index.html",
    preload: path.join(__dirname, "ocr-preload.cjs"),
    // 空闲即销毁窗口(连同引擎):热着的时候是个真实渲染进程,一直留着等于白占一份内存。
    idleMs: 5 * 60_000,
  });
  const ocr = new OcrService({
    assetsRoot: path.join(resourcesRoot, "ocr"),
    cacheRoot: path.join(userData.path, "ocr-cache"),
    runner: ocrRunner,
    // **现读偏好**,不是构造时快照:用户在设置里关掉缓存或改粒度之后,下一次识别就该照新的来。
    // runtime 还没建好时(构造顺序)退回默认值。
    readOptions: () => {
      const preferences = runtime?.getSnapshot().preferences.ocr;
      return preferences === undefined ? { cache: true, granularity: "text" } : normalizeOcrPreferences(preferences);
    },
  });
  const ocrAssetsRoot = path.join(resourcesRoot, "ocr");
  void ocr.status().then(async (status) => {
    // 只是让日志里能看出这一版有没有内置资产;界面上的状态由 IPC 现取(P3)。
    if (!status.available) console.warn(`[ocr] ${status.detail}`);
    // **面包屑**:把"这一版看到的资产目录与结论"写下来。用户报"文字识别不可用"时,这一份比
    // 任何转述都直接 —— 工具结果可能被模型改写、界面只显示一句 i18n 文案,而"看的是哪个目录"
    // 恰恰是唯一能分辨"打包版 vs 开发版 / 资产没准备"的信息。
    await writeFile(
      path.join(userData.path, "ocr-status.json"),
      JSON.stringify({ at: new Date().toISOString(), assetsRoot: ocrAssetsRoot, ...status }, null, 2),
      "utf8",
    ).catch(() => undefined);
  });

  // 离屏光栅化:窗口数跟池的并发数走 —— 两者不一致时池会等空闲窗口,不会出错但会变慢。
  designRaster = new ElectronOffscreenRaster({
    maxWindows: DESIGN_RASTER_BUDGETS.rasterConcurrency,
    // 空闲即销毁:两个离屏窗口各约 128MB,留着到退出等于每次用过画布就永久多付 264MB。
    idleMs: DESIGN_RASTER_BUDGETS.rasterIdleMs,
  });
  const rasterPool = new RasterPool({
    port: designRaster,
    concurrency: DESIGN_RASTER_BUDGETS.rasterConcurrency,
    timeoutMs: DESIGN_RASTER_BUDGETS.rasterTimeoutMs,
  });
  designViewHost = new WebContentsViewDesignHost(() => mainWindow);
  /**
   * 构建能力。**同一个对象同时给画廊的 IPC 与 agent 那条路。**
   *
   * 两边都要在建包与刷新时构建,各造一份的后果不是"多一个对象",而是"能不能构建"取决于
   * 用户走的是哪条路 —— 而 agent 那条路从前根本没有构建,那是设计帧没有样式的直接原因。
   */
  const designBuilds = {
    runner: new NodeBuildRunner(),
    // 脚本与主进程产物同目录(两者都由 `scripts/build-electron.mjs` 产出)。
    recipes: designBuildRecipes({ scriptPath: path.join(__dirname, "design-build.mjs") }),
  };
  /**
   * 导出用的宿主能力。
   *
   * 目录对话框要挂在窗口上(未挂载时 macOS 上会弹不出来),而窗口是**这个文件**才有的 ——
   * 所以 `handlers.ts` 拿到的是注入的端口,它自己不 import Electron。
   */
  const designExporter = new NodeDesignExporter(
    async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory", "createDirectory"],
        title: "导出到哪个文件夹",
      });
      return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
    },
    async (input) => {
      // 保存对话框同样要挂在窗口上,否则 macOS 上弹不出来。
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: input.suggestedName,
        filters:
          input.extension === "pdf"
            ? [{ name: "PDF", extensions: ["pdf"] }]
            : [{ name: "PNG", extensions: ["png"] }],
      });
      return result.canceled || result.filePath === undefined || result.filePath === "" ? null : result.filePath;
    },
  );
  registerDesignIpc({
    handlers: createDesignHandlers(
      designStore,
      rasterPool,
      designViewHost,
      designBuilds,
      designExporter,
      new ElectronDesignClipboard(),
      {
        dispose: () => {
          rasterPool.cancelAll();
          designRaster?.releaseIdle();
          designViewHost?.dispose();
        },
      },
    ),
  });
  const officeResourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  office = new OfficeCliService({ artifactsRoot: presentationArtifactsRoot, resourcesPath: officeResourcesPath });
  const credentialVault = new ElectronCredentialVault(path.join(userData.path, "credentials.json"));
  const remoteAccessStore = createRemoteAccessStore({ userDataPath: userData.path, vault: credentialVault });
  const accountNetworkSession = session.fromPartition("wordless-account-network");
  // Chromium networking ignores the proxy environment variables, so each session
  // the app browses through is told explicitly. The two browser partitions are
  // included so the embedded panel follows the same proxy as the rest of the app.
  const proxySessions = [
    session.defaultSession,
    accountNetworkSession,
    session.fromPartition("wordless-browser"),
    session.fromPartition("persist:wordless-browser"),
  ];
  const proxyStore = new DesktopProxyStore(userData.path, credentialVault);
  // Shared by the startup apply and every later save, so a change goes through
  // exactly the same path as the initial value.
  const proxyDeps = {
    configureSessions: async (proxyRules: string | undefined) => {
      // With no application proxy the inherited environment still decides: that
      // is where a user's own HTTPS_PROXY and the system-resolved proxy land.
      const rules = proxyRules ?? proxyRulesFromEnvironment();
      const mode = rules
        ? { mode: "fixed_servers" as const, proxyRules: rules }
        : { mode: "system" as const };
      for (const target of proxySessions) await target.setProxy(mode);
    },
    // Rebuilt on every change, because `EnvHttpProxyAgent` reads the environment
    // when it is constructed rather than per request.
    configureDispatcher: async () => {
      await configureHttpDispatcher(accountNetworkSession);
    },
  };
  // Applied before the runtime is built so agent commands inherit the proxy from
  // their very first invocation.
  const proxyActive = await applyDesktopProxy(await proxyStore.read(), proxyDeps);
  const sendHostEvent = (event: import("@wordless/protocol").DesktopHostEvent) => {
    sendToAppWindow("wordless:host-event", event);
  };
  account = new GoogleAccountService({
    clientId: process.env.WORDLESS_GOOGLE_CLIENT_ID?.trim() || __WORDLESS_GOOGLE_CLIENT_ID__,
    clientSecret: process.env.WORDLESS_GOOGLE_CLIENT_SECRET?.trim() || __WORDLESS_GOOGLE_CLIENT_SECRET__,
    credentialVault,
    profilePath: path.join(userData.path, "account", "google-profile.json"),
    send: sendHostEvent,
    fetch: async (input, init) => await accountNetworkSession.fetch(input, init),
    openExternal: async (url) => await shell.openExternal(url),
  });
  await account.initialize();
  // Constructed before the runtime so the agent driver can be handed the read-only
  // browser tools. Both the window and its content view are resolved lazily, so
  // building this before the window exists is safe.
  browser = new BrowserService({
    host: new WebContentsViewHost(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined)),
    onChange: (state) => {
      // The toolbar needs to follow navigations the page starts itself (a link
      // click, a redirect), not just the ones the user typed.
      sendToAppWindow("wordless:browser:state", state);
    },
  });
  runtime = createDesktopRuntime(
    userData.path,
    office,
    credentialVault,
    dataAnalysis,
    browser,
    // 设计工具与画布共用同一个 store 与离屏视图:注册表是共用状态,分开会各自持有半份。
    designRaster === undefined || designViewHost === undefined || designStore === undefined
      ? undefined
      : { store: designStore, raster: designRaster, evaluator: designRaster, builds: designBuilds },
    ocr,
    documents,
    // **解析器而不是实例**:用户在设置里切库之后,新会话的 KB 工具要落在新库上。
    activeKnowledge,
    // 懒读:工具按会话装配,而开关随时可能被改 —— 与 OCR 的 `readOptions` 同一做法。
    { isKnowledgeEnabled: () => runtime?.getSnapshot().preferences.knowledge.enabled !== false },
  );
  await runtime.initialize();
  // 会话事件转发给调度器:它据此判断"这一轮跑完了"。
  runtime.subscribe((envelope) => knowledgePoller?.handleRuntimeEvent(envelope));
  // 启动时按当前设置排一次(改设置时由 IPC 的偏好写入路径再排)。
  void knowledgePoller.reload();
  registerAttachmentProtocol(async (sessionId, previewPath) => await runtime!.resolveSessionAttachmentPreview(sessionId, previewPath));
  // Built before the automation service because that service is handed a way to
  // report finished runs. The bus's own dependencies point back at `automation`,
  // which is fine: they are closures, resolved when a run finishes, not now.
  const webhookManager = new WebhookManager({ userDataPath: userData.path, secrets: credentialVault });
  await webhookManager.reload();
  const notificationDefaultsPath = defaultNotificationDefaultsPath(userData.path);
  const readDefaults = async () => await loadNotificationDefaults(notificationDefaultsPath);
  const saveDefaults = async (defaults: import("@wordless/protocol").NotificationDefaults) =>
    await saveNotificationDefaults(notificationDefaultsPath, defaults);

  notificationBus = new NotificationBus({
    locale: () => runtime!.getSnapshot().preferences.locale,
    readDefaults,
    readSubscription: async (sourceId) => automation?.listTasks().find((task) => task.id === sourceId)?.notification,
    // Only enabled channels, and only ones this build can actually send through.
    listTargets: () =>
      webhookManager
        .list()
        .filter((endpoint) => endpoint.enabled && isSupportedKind(endpoint.kind))
        .map((endpoint) => {
          const capabilities = getProvider(endpoint.kind).capabilities;
          return {
            id: endpoint.id,
            name: endpoint.name,
            // Both ceilings when the platform declares one: DingTalk counts
            // characters, the others count bytes (see §15.3.5).
            limits: {
              maxBytes: capabilities.maxTextBytes,
              ...(capabilities.maxTextChars === undefined ? {} : { maxChars: capabilities.maxTextChars }),
            },
            ...(capabilities.maxMessagesPerMinute === undefined
              ? {}
              : { maxMessagesPerMinute: capabilities.maxMessagesPerMinute }),
          };
        }),
    readReply: async (event) => {
      // Only reached when the template uses {{reply}}; see NotificationBus.
      if (!event.sessionId) return undefined;
      const snapshot = await runtime!.getSessionSnapshot(event.sessionId);
      return lastAssistantText(snapshot.messages);
    },
    send: async (targetId, message) => await webhookManager.send(targetId, message),
    onResult: (event, failure) => {
      // Only on failure, and off the completion path: the run is already recorded.
      if (!failure) return;
      const runId = event.eventId.slice(event.eventId.indexOf(":") + 1);
      automation?.recordNotificationFailure(runId, failure);
    },
  });

  automation = new AutomationService({
    databasePath: path.join(userData.path, "wordless.db"),
    runtime,
    deleteSession: async (sessionId) => await runtime!.deleteSession(sessionId, async (record) => await office!.releaseSession(record.id, record.runtimeRootPath)),
    emit: (event) => {
      const envelope: import("@wordless/protocol").RuntimeEventEnvelope = { protocolVersion: 1, runtimeInstanceId: "desktop-automation", eventId: crypto.randomUUID(), sessionId: null, sequence: Date.now(), timestamp: Date.now(), event };
      sendToAppWindow("wordless:event", envelope);
    },
    // Synchronous by contract: this runs on the run-completion path, where a webhook
    // waiting on its 30s timeout would delay the run appearing as finished.
    notify: (event) => notificationBus?.emit(event),
  });
  automation.initialize();
  cloudSync = new CloudSyncService({
    statePath: path.join(userData.path, "cloud-sync", "state.json"),
    runtime,
    account,
    drive: new GoogleDriveAppData(account, async (input, init) => await accountNetworkSession.fetch(input, init)),
    send: sendHostEvent,
  });
  await cloudSync.initialize();
  // Everything platform-specific is injected, so the service itself has no
  // Electron import and its rules are testable with fakes.
  const notificationHost = createDesktopNotificationHost({
    // Late-bound: the window is created further down.
    getWindow: () => mainWindow,
    sendHostEvent,
    sessionTitle: (sessionId) => runtime?.getSnapshot().sessions.find((session) => session.id === sessionId)?.title,
  });
  notifications = new DesktopNotificationService(notificationHost);
  registerDesktopNotificationIpc({ notifications });
  // Built before the subscription below, which reads it on every preference change.
  const applicationMenu = new ApplicationMenuController(hostInfo, runtime.getSnapshot().preferences.shortcuts.bindings);
  applicationMenu.install();
  runtime.subscribe((event) => {
    notifications?.handle(event, runtime!.getSnapshot().preferences);
    if (event.event.type === "preferences.changed") {
      const preferences = runtime!.getSnapshot().preferences;
      updateTrayMenu(preferences);
      // The menu shows accelerators, so it has to follow a rebound key.
      applicationMenu.applyShortcutBindings(preferences.shortcuts.bindings);
    }
    sendToAppWindow("wordless:event", event);
  });
  const updateService = new DesktopUpdateService(sendHostEvent);
  updateService.initialize();
  translation = new DesktopTranslationService({
    getRuntime: () => runtime,
    send: sendHostEvent,
  });
  nativeTheme.on("updated", () => {
    const preferences = runtime?.getSnapshot().preferences;
    if (preferences) updateTitleBarOverlays(preferences);
  });
  registerRuntimeIpc(runtime, appearanceAssets, {
    reloadKnowledgePoller: async () => await knowledgePoller?.reload(),
    hostInfo,
    getAppInfo: () => updateService.getAppInfo(),
    showApplicationMenu: (menuId, window) => applicationMenu.show(menuId, window),
    controlWindow: (action) => controlMainWindow(action),
    getWindowState: () => ({ maximized: mainWindow?.isMaximized() ?? false }),
    getUpdateSnapshot: () => updateService.getSnapshot(),
    listReleases: (refresh) => updateService.listReleases(refresh),
    checkForUpdates: () => updateService.check(),
    downloadUpdate: () => updateService.download(),
    installUpdate: () => updateService.install(),
    openReleasePage: (version) => updateService.openReleasePage(version),
    account,
    cloudSync,
    office,
    dataAnalysis,
    hostEnvironment,
    // 文字识别状态由环境面板一起显示(合成发生在 IPC 边界,见 register-runtime-ipc)。
    ...(ocr === undefined ? {} : { ocr }),
    automation,
    mcpMarketplace: new McpRegistryService(userData.path),
    onboarding: new OnboardingService(userData.path),
    // The browser service is created above the runtime so its tools can be built
    // per session; handing it here lets session deletion drop that session's grants.
    ...(browser ? { browser } : {}),
    translation,
    skillMarketplace: new SkillsMpMarketplaceService(userData.path, {
      apiKey: process.env.WORDLESS_SKILLSMP_API_KEY?.trim() || __WORDLESS_SKILLSMP_API_KEY__,
    }),
  });
  mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
  attachMainWindowBehaviour(mainWindow);
  // The browser service needs the window, which is created after the runtime
  // IPC is registered, so it takes a late-bound accessor rather than the window
  // itself.
  registerBrowserIpc(browser);
  registerProxyIpc({ apply: async (config) => await applyDesktopProxy(config, proxyDeps), initialActive: proxyActive, store: proxyStore });
  // Message push. Constructed like the proxy store rather than as a singleton:
  // it owns no timers or sockets, so there is nothing to dispose, and a plain
  // local keeps the process-global surface unchanged.
  //
  // `reload` never throws — a corrupt file degrades to "nothing configured"
  // instead of blocking the window.
  registerNotificationIpc({ manager: webhookManager });
  registerNotificationDefaultsIpc({ readDefaults, saveDefaults });

  // 远程访问(浏览器客户端配对):偏好进文件、密钥进系统凭据库、每台设备一条中继链路。
  // 没开的时候它什么都不做 —— 不开端口、不连中继、不订阅运行时。
  remoteAccess = new RemoteAccessService({
    surface: createRuntimeSessionSurface({
      runtime: runtime!,
      // 与渲染层收到的是同一份事件流,所以远端看到的就是本机看到的。
      events: { subscribe: (listener) => runtime!.subscribe((envelope) => listener(envelope)) },
      // 设计风格:一份静态目录(与画廊用的是同一份),远端只是"把选择说出来"。
      // 只给 id / 名字 / 一句话 / 明暗 —— 那套 theme.css 有好几 KB,而且手机上不画真示例页。
      designStyles: () =>
        DESIGN_STYLES.map((style) => ({
          id: style.id,
          name: style.name,
          tagline: style.tagline,
          vibe: style.vibe,
        })),
    }),
    // 设备 id 是"机器名 + 数据目录"的哈希:稳定、可复现,而且**不把机器名交给中继**。
    // 机器名本身作为展示名发出去(手机要显示"我的电脑")—— 它属于中继可见的元数据,见文档 §6。
    deviceId: sha256Hex(`${hostname()}:${userData.path}`).slice(0, 16),
    deviceName: hostname(),
    readPreferences: () => remoteAccessStore.readPreferences(),
    writePreferences: (update) => remoteAccessStore.writePreferences(update),
    secrets: remoteAccessStore.secrets,
    createTransport: (url, protocols) =>
      new WebSocketTransport({ url, protocols: [...protocols], factory: nodeWebSocketFactory(WebSocket) }),
    mailbox: createRelayMailbox(),
    /**
     * 局域网模式:在**本进程内**起中继,并把网页客户端托管出去。
     *
     * 网页客户端目录有两条来源:开发版指向仓库里的构建产物,打包版指向随包发布的 `web-client`
     * (见 `electron-builder.yml` 的 extraResources)—— 打包版用户没有 npm,不能让他"先构建一次"。
     */
    lan: {
      resolveWebRoot: () =>
        app.isPackaged
          ? path.join(process.resourcesPath, "web-client")
          : path.resolve(__dirname, "../../../web-client/dist"),
      logger: (line) => process.stdout.write(`[lan] ${line}\n`),
    },
    defaultRelayBaseUrl: process.env.WORDLESS_REMOTE_RELAY ?? undefined,
    // 有设备接上来就弹一次系统通知。
    //
    // 这里**刻意不判断窗口是否在前台**:远程接入是一件安全相关的事,而它很罕见 ——
    // 用户宁可偶尔多看一眼,也不要不知道自己的电脑正在被远程使用。
    onDeviceConnected: ({ name }) => {
      // 通知是"顺带说一声",不是这条链路的一部分:弹不出来(无通知权限、测试环境)也不能影响配对本身。
      try {
        if (!notificationHost.notificationsSupported()) return;
        const notification = notificationHost.createNotification({
          title: "有设备正在远程使用这台电脑",
          body: `${name.length === 0 ? "一台手机" : name} 已连接。如果不是你,请到「设置 → 远程连接」解除配对。`,
        });
        notification.onClick(() => showWindow());
        notification.show();
      } catch (error) {
        console.error("[remote] 系统通知失败:", error);
      }
    },
  });
  /**
   * 部署要用的两条本机路径。
   *
   * 中继单文件随包发布(`resources/relay/relay.mjs`,见 `scripts/build-relay-bundle.mjs`),
   * 网页客户端与局域网模式用的是**同一份**产物 —— 两处指向同一个目录,升级时一起变。
   *
   * 两条路(教程与自动部署)读的就是这两条 —— 不再有"先复制一份部署包"那一步(§5.9)。
   */
  const webClientDir = app.isPackaged
    ? path.join(process.resourcesPath, "web-client")
    : path.resolve(__dirname, "../../../web-client/dist");
  registerRemoteIpc({
    service: remoteAccess,
    // 事件只发给应用窗口(辅助窗口不订阅,而且随时在关) —— 见 `renderer-window.ts`。
    getWindow: () => mainWindow,
    paths: {
      // 这一版是哪一版:写进服务器的 version.json,并和服务器上那一版比对。
      version: app.getVersion(),
      relayBundlePath: app.isPackaged
        ? path.join(process.resourcesPath, "relay", "relay.mjs")
        : path.resolve(__dirname, "../../resources/relay/relay.mjs"),
      webClientDir,
    },
  });
  // 先读偏好再开始服务:在那之前 getState() 只能给出默认值。
  void remoteAccess.start().catch((error: unknown) => {
    // 原始错误(含栈)打到终端:「设置页那一句」给用户看,这一行给我们查。
    console.error("[remote] 启动失败:", error);
  });
  // macOS AppKit synchronously redraws NSStatusItem replicants when the app
  // becomes active or display metrics change. That redraw runs on the main
  // thread and is the source of the focus-return hitch, so the Dock remains
  // the macOS entry point and the tray is kept for Windows/Linux only.
  if (process.platform !== "darwin") {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("Wordless");
    tray.on("click", showWindow);
    updateTrayMenu(runtime.getSnapshot().preferences);
  }
  setTimeout(() => void updateService.check(), 12_000);
  if (userData.notice) await dialog.showMessageBox({ type: "warning", message: userData.notice });

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (runtime) {
      mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
      attachMainWindowBehaviour(mainWindow);
    }
  });
});

app.on("window-all-closed", () => {
  // 托盘让应用继续活着(自动化照跑),所以这里平时什么都不做。
  // Linux 例外:那里关窗就是退出(见 closingQuitsApplication),窗口没了就该走正常退出流程。
  if (closingQuitsApplication()) app.quit();
});

app.on("before-quit", (event) => {
  // 停掉加工调度:一个还在跑的轮次不该拖住退出,也不该在退出过程中继续写页面。
  knowledgePoller?.stop();
  // 断开远端链路,并把未领取的邀请撤回(它只在内存里,进程结束即作废)。
  void remoteAccess?.stop().catch(() => undefined);
  if (disposing) return;
  event.preventDefault();
  disposing = true;
  quitting = true;
  notifications?.dispose();
  notificationBus?.dispose();
  browser?.dispose();
  automation?.dispose();
  translation?.dispose();
  tray?.destroy();
  cloudSync?.dispose();
  runtime?.dispose();
  account?.dispose();
  // 离屏窗口是真实渲染进程,不关掉会让进程残留。
  designRaster?.dispose();
  designViewHost?.dispose();
  ocrRunner?.dispose();
  void (office?.dispose() ?? Promise.resolve()).finally(() => app.quit());
});
