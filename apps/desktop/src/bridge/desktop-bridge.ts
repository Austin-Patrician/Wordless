import type {
  AgentInteractionModeId,
  AppearanceBackgroundAsset,
  AppPreferences,
  AutomationRun,
  AutomationTask,
  AutomationTaskInput,
  TaskRecord,
  TaskRecordInput,
  TaskStatus,
  ConfiguredModelKind,
  ConnectorConfiguration,
  ConnectorPromptSummary,
  ConnectorResourceSummary,
  ConnectorSummary,
  McpMarketplaceEntry,
  McpMarketplacePage,
  SkillMarketplaceOrigin,
  SkillMarketplacePage,
  SkillMarketplacePreview,
  ExpertDefinition,
  ExpertDefinitionInput,
  ExpertTeamDefinition,
  ExpertTeamDefinitionInput,
  ExpertTeamDetail,
  MediaInlineImage,
  MediaLayoutUpdate,
  MediaViewportUpdate,
  MediaOperationRequest,
  MediaProject,
  ModelReference,
  ProviderModelCandidate,
  ProviderModelDiscoveryRequest,
  SessionAccessLevel,
  SessionDraft,
  SessionRecord,
  ThinkingLevel,
  UsageReport,
  UsageReportQuery,
  UserMessageSubmission,
  UserPromptPart,
  WorkspaceRecord,
} from "@wordless/domain";
import type { RemoteAccessState, RemoteRelayProbeResult, SessionUsageSnapshot } from "@wordless/protocol";
import type {
  AgentExtensionSnapshot,
  JsonObject,
} from "@wordless/agent-extension-sdk";
import type {
  DesignSaveImageRequestDto,
  DesignSaveImageResultDto,
  AccountSnapshot,
  AnalysisSessionSnapshot,
  AppSnapshot,
  ArtifactDescriptor,
  ArtifactIssue,
  ArtifactPreviewManifest,
  ArtifactSelection,
  CloudSyncConflictResolution,
  CloudSyncInitialStrategy,
  CloudSyncSnapshot,
  DataAnalysisCapabilitySnapshot,
  DesktopAppInfo,
  DesktopHostEvent,
  DesktopHostInfo,
  DesktopMenuId,
  DesktopRelease,
  DesktopUpdateSnapshot,
  HostEnvironmentFacts,
  HostPythonProvisionResult,
  OfficeEngineHealth,
  OnboardingState,
  PresentationTemplate,
  RuntimeEventEnvelope,
  ExpertMemberLiveMessage,
  SessionArtifactDiff,
  SessionArtifactPreview,
  SessionArtifactsSnapshot,
  SessionContextSnapshot,
  SessionHistoryPage,
  SessionHistoryPageRequest,
  SessionMessageSearchRequest,
  SessionMessageSearchResponse,
  SessionSnapshot,
  SessionViewSnapshot,
  SessionWorkspaceTextFile,
  SpreadsheetCapabilitySnapshot,
  SpreadsheetChangeRecord,
  SpreadsheetRangeProfile,
  BrowserNavigateResult,
  BrowserNavigationAction,
  BrowserPanelState,
  DesktopProxyConfigPatch,
  DesktopProxySnapshot,
  ProxyProbeCandidate,
  ProxyTestResult,
  BrowserSessionScope,
  BrowserViewBounds,
  SpreadsheetSelection,
  WorkspaceFileEntry,
  WebhookCreateInputDto,
  WebhookEndpointPublic,
  WebhookMessage,
  WebhookMutationResult,
  NotificationDefaults,
  DesignListRequestDto,
  CreateDesignRequestDto,
  CreateDesignResultDto,
  DesignLiveFrameRequestDto,
  DesignStyleDetailDto,
  DesignStyleDetailRequestDto,
  DesignStyleSummaryDto,
  DesignMoveFramesRequestDto,
  DesignRasterRequestDto,
  DesignRasterResultDto,
  ApplyDesignStyleRequestDto,
  ApplyDesignStyleResultDto,
  CreateDesignFrameRequestDto,
  DesignExportRequestDto,
  DesignExportResultDto,
  DeleteDesignFrameRequestDto,
  DesignRefreshRequestDto,
  DesignRefreshResultDto,
  DesignUpdateFrameMetaRequestDto,
  DesignOpenRequestDto,
  DesignOpenedDto,
  DesignSummaryDto,
  NotificationDefaultsPatchDto,
  NotificationDefaultsResult,
  WebhookProviderDescriptor,
  WebhookSendResult,
  WebhookSetEnabledRequestDto,
  WebhookTestRequestDto,
  WebhookUpdatePatchDto,
} from "@wordless/protocol";
import type { ToolApprovalMode } from "@wordless/domain";

export const DESKTOP_BRIDGE_VERSION = 57;

/**
 * 只读探测的结果(**整份**)。
 *
 * 单独定义成一份类型是刻意的:它是"计划据此做决定"的输入,而**每个字段都要往下传** ——
 * 以前只传了 node 那两项,于是"nginx 在跑"到不了计划,计划永远按 Caddy 走(真实抱怨)。
 * 以后探测里加一项,只改这一份类型,链路自动跟上。
 */
/** 卸载的两档:`stop` 可逆,`remove` 不可逆(所以界面上要先确认)。 */
export type RemoteUninstallScope = "stop" | "remove";

/** 撤下来的计划(与部署那份同一形状:`id` + 命令 + sudo + 在哪儿跑)。 */
export interface RemoteUninstallPlan {
  readonly steps: readonly { readonly id: string; readonly command: string; readonly sudo: boolean; readonly target: "local" | "server" }[];
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  readonly warnings: readonly { readonly key: string; readonly detail?: string }[];
  /** 这台服务器上没有我们的部署(界面据此说清,而不是摆一排点了没反应的按钮)。 */
  readonly nothingToDo: boolean;
}

export interface DeployProbeFacts {
  readonly system?: string;
  readonly user?: string;
  readonly sudo?: boolean;
  readonly arch?: string;
  readonly node?: { readonly present: boolean; readonly version?: string; readonly major?: number };
  readonly distro?: { readonly id?: string; readonly version?: string };
  readonly caddy?: boolean;
  readonly caddyActive?: boolean;
  readonly nginx?: boolean;
  readonly nginxActive?: boolean;
  readonly deployDirExists?: boolean;
  /** 服务器上那一版(读 `${目录}/version.json`;读不出来 = 上次部署比"记版本"更早,一定是旧的)。 */
  readonly deployedVersion?: string;
  /** 卸载要看这四项:服务单元、服务是否活着、我们写的 nginx 站点、Caddyfile 里我们那一段。 */
  readonly serviceExists?: boolean;
  readonly serviceActive?: boolean;
  readonly nginxSiteExists?: boolean;
  readonly caddyBlockExists?: boolean;
  readonly listeningPorts?: readonly number[];
  readonly aptBusy?: boolean;
  readonly sudoNoPassword?: boolean;
}

export interface DesktopBridge {
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  getHostInfo(): Promise<DesktopHostInfo>;
  getAppInfo(): Promise<DesktopAppInfo>;
  openApplicationMenu(menuId: DesktopMenuId): Promise<void>;
  getUpdateSnapshot(): Promise<DesktopUpdateSnapshot>;
  listReleases(refresh?: boolean): Promise<DesktopRelease[]>;
  checkForUpdates(): Promise<DesktopUpdateSnapshot>;
  downloadUpdate(): Promise<DesktopUpdateSnapshot>;
  installUpdate(): Promise<DesktopUpdateSnapshot>;
  openReleasePage(version?: string): Promise<void>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
  loginGoogle(): Promise<AccountSnapshot>;
  logoutGoogle(): Promise<void>;
  getCloudSyncSnapshot(): Promise<CloudSyncSnapshot>;
  /** 远程访问的当前状态(开关、中继地址、邀请、已配对设备)。 */
  getRemoteAccessState(): Promise<RemoteAccessState>;
  /**
   * 状态变化时的推送(手机连上、二维码被领取、设备掉线……)。
   *
   * 返回退订函数。**设置页必须用它**:只靠打开时取一次,界面会永远停在旧状态。
   */
  onRemoteAccessChanged(listener: (state: RemoteAccessState) => void): () => void;
  setRemoteAccessEnabled(enabled: boolean): Promise<RemoteAccessState>;
  /**
   * 准备远程部署包:把中继单文件与网页客户端复制到一个用户找得到的地方。
   *
   * 教程里那句 `scp` 必须指向**真实存在的路径** —— 让用户自己去安装目录里翻是不现实的。
   *
   * **只有教程档需要它**:自动部署上传的是安装目录里那一份(`uploadSource: "installed"`)。
   */
  prepareRemoteDeployBundle(): Promise<{ ok: boolean; dir?: string; error?: string }>;
  /** 取部署步骤(教程档渲染它;自动部署跑的**就是这一份**命令)。 */
  getRemoteDeployPlan(input: {
    server: string;
    user: string;
    domain?: string;
    /**
     * 上传来源。**必填、没有默认值** —— 两条路给的本来就不是同一个位置,猜错了不会报错,
     * 只会在几分钟后以"scp 找不到文件"的样子出现(那时服务器上已经建好目录了)。
     *
     * `bundle` = 部署包(教程档:那句 scp 要指得到);`installed` = 安装目录(自动部署:永远最新)。
     */
    uploadSource: "bundle" | "installed";
    /** 探测结果(**整份**带过去):跳过哪些步骤、走哪条反代路线都由它决定。 */
    facts?: DeployProbeFacts;
    /** 中继在服务器上监听的端口(默认 8787)。 */
    relayPort?: number;
    /** 对外端口(默认 443,走 Caddy)。 */
    publicPort?: number;
  }): Promise<{
    steps: Array<{ id: string; command: string; sudo: boolean; target: "local" | "server" }>;
    /** 走哪条反向代理路线(nginx 在跑就走 nginx —— 它多半占着 80/443)。 */
    proxy?: "caddy" | "nginx";
    /** 跳过了哪些步骤、为什么(界面照实说,别让它悄悄消失)。旧版本可能没有。 */
    skipped?: Array<{ id: string; reason: string }>;
    /** 不拦路、但要说出来的事(发行版不对、端口被占、已经部署过)。 */
    warnings?: Array<{ key: string; detail?: string }>;
    relayBaseUrl: string;
    secure: boolean;
    healthUrl: string;
  }>;
  /**
   * 自动部署:只读探测 → 预览 → 逐步执行。
   *
   * 用的就是 `getRemoteDeployPlan` 那一份命令(预览即所跑)。密码**只用于这一次连接**:
   * 不落盘、不进日志、不进命令行。
   */
  probeRemoteDeploy(input: {
    server: string;
    user: string;
    port?: number;
    /** 中继端口(默认 8787):一起测,免得"端口被占"要等部署到一半才发现。 */
    relayPort?: number;
    password?: string;
  }): Promise<{
    ok: boolean;
    findings: string[];
    /** 结构化的探测结果:计划据此跳过步骤、选路线。 */
    facts: DeployProbeFacts;
    error?: string;
  }>;
  runRemoteDeploy(input: {
    server: string;
    user: string;
    domain?: string;
    /**
     * 上传来源:自动部署固定给 `installed` —— 上传这台电脑安装目录里的那一份,
     * 不用用户先"准备部署包",而且永远是最新的。
     */
    uploadSource: "bundle" | "installed";
    /** 探测结果(**整份**带过来):跳过哪些步骤、走哪条反代路线都由它决定。 */
    facts?: DeployProbeFacts;
    /** SSH 端口(默认 22)。 */
    port?: number;
    /** 中继在服务器上监听的端口(默认 8787)。 */
    relayPort?: number;
    /** 对外端口(默认 443)。 */
    publicPort?: number;
    password?: string;
  }): Promise<{ ok: boolean; failedStep?: string; error?: string }>;
  cancelRemoteDeploy(): Promise<{ ok: boolean }>;
  /**
   * 把部署**撤下来**:`stop` = 停服务(保留文件与配置,可逆);`remove` = 卸载(删文件、摘配置)。
   *
   * 计划只包含**探测到确实存在**的东西 —— 卸载是删东西,不能照着脚本盲删一遍。
   */
  getRemoteUninstallPlan(input: {
    scope: RemoteUninstallScope;
    /** 中继端口(默认 8787):自检用它确认"没人再监听了"。 */
    relayPort?: number;
    /** 探测结果(**整份**带过来):要删哪几样由它决定。 */
    facts?: DeployProbeFacts;
  }): Promise<RemoteUninstallPlan>;
  runRemoteUninstall(input: {
    server: string;
    user: string;
    scope: RemoteUninstallScope;
    port?: number;
    relayPort?: number;
    facts?: DeployProbeFacts;
    password?: string;
    /** 服务器上没东西可撤时**不连服务器**,并把这件事如实带回来(界面据此说清楚,而不是说"已完成")。 */
  }): Promise<{ ok: boolean; failedStep?: string; error?: string; nothingToDo?: boolean }>;
  /** 部署进度(哪一步在跑、跑到哪了、失败时那一步的输出)。 */
  onRemoteDeployProgress(
    listener: (progress: { index: number; id: string; status: "running" | "done" | "failed"; output?: string }) => void,
  ): () => void;
  /** 切换接入方式:局域网(本机起中继)或远程(自己部署的中继)。 */
  setRemoteMode(mode: "lan" | "remote"): Promise<RemoteAccessState>;
  /**
   * 局域网模式的总开关:**一键** —— 在本机起中继、托管网页客户端、自动填地址并开启。
   *
   * 起不来(还没构建网页客户端、端口全被占)时**不开启**,并在状态里带回原因。
   */
  setRemoteLanMode(enabled: boolean): Promise<RemoteAccessState>;
  /** 换一个网卡地址(多网卡时用户挑的那一个)。 */
  setRemoteLanAddress(address: string): Promise<RemoteAccessState>;
  /** 传 undefined 表示"用回默认中继"。 */
  setRemoteRelayUrl(relayBaseUrl?: string): Promise<RemoteAccessState>;
  /** 探一次中继:在生成二维码之前就知道地址通不通。 */
  testRemoteRelay(relayBaseUrl?: string): Promise<RemoteRelayProbeResult>;
  createRemoteInvite(): Promise<RemoteAccessState>;
  withdrawRemoteInvite(): Promise<RemoteAccessState>;
  revokeRemoteDevice(deviceId: string): Promise<RemoteAccessState>;

  enableCloudSync(
    strategy?: CloudSyncInitialStrategy,
  ): Promise<CloudSyncSnapshot>;
  disableCloudSync(): Promise<CloudSyncSnapshot>;
  syncCloudNow(): Promise<CloudSyncSnapshot>;
  resolveCloudSyncConflict(
    resolution: CloudSyncConflictResolution,
  ): Promise<CloudSyncSnapshot>;
  deleteCloudSyncRemote(): Promise<CloudSyncSnapshot>;
  listAutomations(): Promise<AutomationTask[]>;
  createAutomation(input: AutomationTaskInput): Promise<AutomationTask>;
  updateAutomation(
    id: string,
    input: AutomationTaskInput,
  ): Promise<AutomationTask>;
  setAutomationsEnabled(ids: string[], enabled: boolean): Promise<void>;
  deleteAutomations(ids: string[]): Promise<void>;
  runAutomation(id: string): Promise<AutomationRun>;
  listAutomationRuns(limit?: number): Promise<AutomationRun[]>;
  deleteAutomationRun(id: string): Promise<void>;
  listTasks(): Promise<TaskRecord[]>;
  createTask(input: TaskRecordInput): Promise<TaskRecord>;
  updateTask(id: string, input: TaskRecordInput): Promise<TaskRecord>;
  moveTask(id: string, status: TaskStatus, position?: number): Promise<TaskRecord>;
  deleteTask(id: string): Promise<void>;
  executeTask(id: string): Promise<TaskRecord>;
  getSnapshot(): Promise<AppSnapshot>;
  listExperts(): Promise<ExpertDefinition[]>;
  saveExpert(
    input: ExpertDefinitionInput,
    id?: string,
  ): Promise<ExpertDefinition>;
  deleteExpert(id: string): Promise<void>;
  listExpertTeams(): Promise<ExpertTeamDefinition[]>;
  getExpertTeamDetail(id: string): Promise<ExpertTeamDetail>;
  saveExpertTeam(
    input: ExpertTeamDefinitionInput,
    id?: string,
  ): Promise<ExpertTeamDefinition>;
  deleteExpertTeam(id: string): Promise<void>;
  getUsageReport(query: UsageReportQuery): Promise<UsageReport>;
  /** 一个会话的总用量。来源是 journal,所以与逐轮面板同一套口径。 */
  getSessionUsage(sessionId: string): Promise<SessionUsageSnapshot>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
  getSessionView(sessionId: string): Promise<SessionViewSnapshot>;
  getSessionHistoryPage(
    sessionId: string,
    request: SessionHistoryPageRequest,
  ): Promise<SessionHistoryPage>;
  getExpertMemberHistory(
    sessionId: string,
    memberId: string,
    request: SessionHistoryPageRequest,
  ): Promise<SessionHistoryPage>;
  getExpertMemberLiveState(
    sessionId: string,
    memberId: string,
  ): Promise<ExpertMemberLiveMessage | null>;
  getExpertMemberToolOutput(
    sessionId: string,
    memberId: string,
    callId: string,
  ): Promise<string>;
  searchSessionMessages(
    sessionId: string,
    request: SessionMessageSearchRequest,
  ): Promise<SessionMessageSearchResponse>;
  getSessionToolOutput(sessionId: string, callId: string): Promise<string>;
  renameSession(sessionId: string, title: string): Promise<SessionRecord>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionRecord>;
  deleteSession(sessionId: string): Promise<void>;
  /**
   * Erases sessions and the files they own (journal, attachments, artifacts).
   * The host moves them to the OS trash when it can, so an accidental deletion
   * is still recoverable outside the app.
   */
  deleteSessions(sessionIds: string[]): Promise<{ deleted: string[]; failed: { sessionId: string; error: string }[] }>;
  /** Bytes owned by each session, for the storage column in session history. */
  getSessionStorageUsage(sessionIds?: string[]): Promise<Record<string, number>>;
  // Embedded browser panel. The renderer owns layout and intent, the main
  // process owns the pages; nothing but geometry and navigation crosses here.
  showBrowserView(): Promise<BrowserPanelState>;
  /** The stored proxy plus which proxy is actually in effect right now. */
  getProxySnapshot(): Promise<DesktopProxySnapshot>;
  /**
   * Save a change. The password is optional: omitting it keeps the stored one,
   * so a form that never received the plaintext can still save every other
   * field.
   */
  setProxyConfig(patch: DesktopProxyConfigPatch): Promise<DesktopProxySnapshot>;
  testProxyConnection(): Promise<ProxyTestResult>;
  /** Probes well-known local proxy ports; null when none of them answers. */
  detectLocalProxy(): Promise<ProxyProbeCandidate | null>;
  /**
   * Reports which session's chat the renderer is currently showing, or null when
   * it is not on a chat (another main view, a dialog or the tour on top).
   *
   * The host combines this with its own window-focus state to decide whether a
   * finished run needs a system notification: if the user is already looking at
   * that output, stay quiet. The renderer owns "what is on screen"; the host owns
   * focus, and neither can answer the other's half.
   */
  setForegroundSession(sessionId: string | null): Promise<void>;
  // Message push. Group-robot webhooks the host posts task-completion messages
  // to. As with the proxy, no credential crosses this boundary: the endpoints
  // carry a masked URL and a "a secret is stored" flag instead.
  listWebhookEndpoints(): Promise<WebhookEndpointPublic[]>;
  /** Descriptors let the form render the right fields without knowing any kind. */
  listWebhookProviders(): Promise<WebhookProviderDescriptor[]>;
  /**
   * Payloads are typed by the protocol DTOs rather than by hand.
   *
   * The renderer, the preload and the host all name the same type, so a change to
   * a payload shape is a compile error on both sides. Hand-written shapes are how
   * the update call once shipped sending `{ id, ...patch }` while the host
   * validated it against the patch schema alone — which rejected its own caller on
   * every single call.
   */
  createWebhookEndpoint(input: WebhookCreateInputDto): Promise<WebhookMutationResult>;
  /**
   * Omitting `url` or `signSecret` keeps what is stored, so a form that never
   * received the plaintext can still save every other field.
   */
  updateWebhookEndpoint(id: string, patch: WebhookUpdatePatchDto): Promise<WebhookMutationResult>;
  setWebhookEndpointEnabled(id: string, enabled: boolean): Promise<WebhookMutationResult>;
  /**
   * The global push subscription: what an automation nobody configured inherits.
   * Each automation can still override any field.
   */
  getNotificationDefaults(): Promise<NotificationDefaults>;
  setNotificationDefaults(patch: NotificationDefaultsPatchDto): Promise<NotificationDefaultsResult>;
  /**
   * Design packages under a workspace root.
   *
   * The renderer supplies the root because only it knows which workspace is open; the
   * host never trusts a path from here for anything but enumeration — every served
   * request goes through the design registry instead (see `design-url.ts`).
   */
  listDesigns(input: DesignListRequestDto): Promise<DesignSummaryDto[]>;
  /** Null when the path is not a design package, rather than throwing. */
  openDesign(input: DesignOpenRequestDto): Promise<DesignOpenedDto | null>;
  /**
   * Brings an open design back in line with what is on disk.
   *
   * The canvas polls this while the agent is running, because the frames it renders are a
   * snapshot of a directory the agent is still writing to. Three things ride on the one
   * answer — new frames appear, frame contents refresh, and the stylesheet is rebuilt when
   * frames introduce classes the last build never saw (`built` mode: `dist/theme.css` only
   * ever comes out of a build, so without this a frame renders with no CSS at all).
   *
   * `applied: false` is not a failure: nothing changed, or a refresh is already in flight
   * and this one was throttled. `revision` is the fingerprint the renderer keys its bitmap
   * cache by — when it moves, the bitmaps are stale and must be taken again.
   *
   * `force` is for the manual refresh button: it skips the host's minimum interval, so a click
   * always does the work instead of possibly landing inside a throttle window and silently
   * doing nothing. Concurrency is still bounded — a click while a build is running waits for it
   * rather than racing a second one.
   */
  refreshDesign(input: DesignRefreshRequestDto): Promise<DesignRefreshResultDto>;
  /**
   * Where the frames sit on the canvas.
   *
   * Layout only: it writes the manifest and never touches the frame sources, so a drag
   * cannot alter a frame's markup. Batched because one multi-select drag moves several
   * frames and they must land as a single revision.
   */
  moveDesignFrames(input: DesignMoveFramesRequestDto): Promise<boolean>;
  /**
   * Adds a blank frame, and returns the manifest **after** reconciliation.
   *
   * Where it lands is deliberately not an argument: the host already decides that for any frame
   * it finds on disk but not in the manifest (right of the rightmost, top-aligned), and a second
   * placement rule in the renderer would be a second source of truth. Sizes fall back the same way
   * a frame without its own `@frame` declaration does.
   *
   * Returns null when the path is not a design package, matching `openDesign`.
   */
  createDesignFrame(input: CreateDesignFrameRequestDto): Promise<DesignOpenedDto | null>;
  /**
   * Deletes a frame and returns the manifest after reconciliation.
   *
   * Only the frame's file is removed — the manifest picks the deletion up through the same
   * one-way reconcile that adds new files, so there is no second place to get it wrong. This is
   * the one canvas action that destroys work, so it is only ever reached from an explicit
   * gesture (the frame's context menu), never from a stray keystroke.
   */
  deleteDesignFrame(input: DeleteDesignFrameRequestDto): Promise<DesignOpenedDto | null>;
  /**
   * Applies one of the built-in styles to an existing design.
   *
   * Writes `theme.css` and `DESIGN.md` (after backing the package's sources up into
   * `.build/style-backup/`) and records the style id in the manifest.
   *
   * `framesNeedRestyle` is the part callers must not drop: a design cannot be re-skinned by
   * swapping tokens — spacing, hierarchy and type follow from the style too, so existing frames
   * have to be reworked against the new spec. Returns null for an unknown style id.
   */
  applyDesignStyle(input: ApplyDesignStyleRequestDto): Promise<ApplyDesignStyleResultDto | null>;
  /**
   * Exports the design's renders or its assets into a folder the user picks.
   *
   * Renders come out as PNG at `scale` (default 2): the canvas wants *small* bitmaps, but an
   * exported file is something the user keeps, and lossless is the difference they will notice on
   * type. `null` means this host has no exporter configured — same rule as `builds`, where an
   * absent capability reports itself rather than faking a success.
   */
  exportDesign(input: DesignExportRequestDto): Promise<DesignExportResultDto | null>;
  /**
   * Renames a frame, or changes its declared size.
   *
   * **Not the same place as `moveDesignFrames`.** Position lives in `design.json`; a
   * frame's title and size are declared in the frame source itself (the `@frame`
   * comment), which is why this writes a file and the move does not. Splitting them
   * keeps the ownership rule honest: editing the manifest would be silently reverted
   * by the next reconcile.
   *
   * Returns false when the frame is gone, the file cannot be read, or the frame has no
   * `@frame` declaration to write into — the last one deliberately, because inventing a
   * place for that comment corrupts the file.
   */
  updateDesignFrameMeta(input: DesignUpdateFrameMetaRequestDto): Promise<boolean>;
  /**
   * Rasterizes frames offscreen and returns the bitmaps.
   *
   * The renderer asks for the frames it is about to show; the host owns the offscreen
   * views. Results are matched by key, and a failure is reported per frame rather than
   * failing the batch — one frame that will not render must not blank the canvas.
   */
  rasterizeDesignFrames(input: DesignRasterRequestDto): Promise<DesignRasterResultDto[]>;
  /**
   * Hands one frame to a native view, or gives it back to the bitmap layer.
   *
   * At most one frame is live at a time — native views cannot be CSS-scaled, so they
   * are only correct at 1:1, and at 1:1 the user can only be editing one. The bounds
   * are in **window** coordinates and come from the same transform that positions the
   * bitmap, so the two cannot drift apart.
   */
  setDesignLiveFrame(input: DesignLiveFrameRequestDto): Promise<boolean>;
  disposeDesignResources(): Promise<void>;
  /** The built-in style catalog. Ships with the app — creating a design must not need the network. */
  listDesignStyles(): Promise<DesignStyleSummaryDto[]>;
  /** 一套风格的正文(示例页 + 规范)。按 id 现取,列表里只有 `hasDemo`。 */
  getDesignStyleDetail(input: DesignStyleDetailRequestDto): Promise<DesignStyleDetailDto | null>;
  /**
   * 把一套风格的资料(theme.css + DESIGN.md)落进工作区,供这一次会话当参考。
   *
   * 落的是**资料**不是设计包:包由 agent 的 `design_create` 建。
   */
  /** Creates a design package with the chosen style applied from its first frame. */
  createDesign(input: CreateDesignRequestDto): Promise<CreateDesignResultDto | null>;
  /** 存一张合成图。取消返回 `{ ok: false, reason: "cancelled" }` —— 那不是错误。 */
  /**
   * 保存一张合成图。图在 `input.data` 里,是 **base64** —— 载荷为什么要编码见 DTO 的说明
   * (`contextBridge` 上类型化数组不可靠)。
   */
  saveDesignImage(input: DesignSaveImageRequestDto): Promise<DesignSaveImageResultDto>;
  /** 把一张合成图放进剪贴板。剪贴板被占用时返回 false。 */
  copyDesignImage(input: { data: string }): Promise<boolean>;
  deleteWebhookEndpoint(id: string): Promise<void>;
  /** Sends through a stored endpoint; the text is supplied by the renderer. */
  testWebhookEndpoint(id: string, message: WebhookMessage): Promise<WebhookSendResult>;
  /** Narrower than the bridge method: the host reads no attachment path from here. */
  setBrowserPanelSession(sessionId: string | null): Promise<BrowserPanelState>;
  hideBrowserView(): Promise<void>;
  setBrowserViewBounds(bounds: BrowserViewBounds): Promise<void>;
  navigateBrowserView(action: BrowserNavigationAction, url?: string): Promise<BrowserNavigateResult>;
  createBrowserTab(url?: string): Promise<BrowserPanelState>;
  closeBrowserTab(tabId: string): Promise<BrowserPanelState>;
  selectBrowserTab(tabId: string): Promise<BrowserPanelState>;
  setBrowserSessionScope(scope: BrowserSessionScope): Promise<BrowserPanelState>;
  setBrowserTabShared(tabId: string, shared: boolean): Promise<BrowserPanelState>;
  setBrowserActionsAllowed(tabId: string, allowed: boolean): Promise<BrowserPanelState>;
  openBrowserViewDevTools(): Promise<void>;
  createMediaProject(title?: string): Promise<MediaProject>;
  getMediaProject(sessionId: string): Promise<MediaProject>;
  importMediaImages(
    sessionId: string,
    files: File[],
    targetPosition: { x: number; y: number },
  ): Promise<MediaProject>;
  duplicateMediaAsset(
    sessionId: string,
    assetId: string,
    targetPosition: { x: number; y: number },
  ): Promise<MediaProject>;
  deleteMediaAsset(sessionId: string, assetId: string): Promise<MediaProject>;
  readMediaAssetData(
    sessionId: string,
    assetId: string,
  ): Promise<MediaInlineImage>;
  downloadMediaAsset(sessionId: string, assetId: string): Promise<string>;
  startMediaOperation(request: MediaOperationRequest): Promise<MediaProject>;
  updateMediaLayout(update: MediaLayoutUpdate): Promise<MediaProject>;
  updateMediaViewport(update: MediaViewportUpdate): Promise<MediaViewportUpdate["viewport"]>;
  setMediaCoverAsset(sessionId: string, assetId: string): Promise<MediaProject>;
  cancelMediaOperation(sessionId: string, operationId: string): Promise<void>;
  openSessionFolder(sessionId: string): Promise<void>;
  createManagedWorkspace(name: string): Promise<WorkspaceRecord>;
  openWorkspace(path: string): Promise<WorkspaceRecord>;
  pickWorkspace(): Promise<WorkspaceRecord | null>;
  openExternalUrl(url: string): Promise<void>;
  createAndPrompt(
    draft: SessionDraft,
    parts: UserPromptPart[],
    submission: UserMessageSubmission,
    attachments?: File[],
  ): Promise<SessionRecord>;
  promptSession(
    sessionId: string,
    parts: UserPromptPart[],
    submission: UserMessageSubmission,
    attachments?: File[],
  ): Promise<void>;
  retrySessionTurn(
    sessionId: string,
    messageId: string,
    instruction?: string,
  ): Promise<void>;
  selectSessionTurnVersion(
    sessionId: string,
    messageId: string,
    version: number,
  ): Promise<void>;
  compactSession(sessionId: string): Promise<void>;
  getSessionContext(sessionId: string): Promise<SessionContextSnapshot>;
  getSessionArtifacts(sessionId: string): Promise<SessionArtifactsSnapshot>;
  readSessionArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<SessionArtifactPreview>;
  openSessionArtifact(sessionId: string, artifactId: string): Promise<void>;
  revealSessionArtifact(sessionId: string, artifactId: string): Promise<void>;
  saveSessionArtifactAs(sessionId: string, artifactId: string): Promise<void>;
  getOfficeEngineHealth(): Promise<OfficeEngineHealth>;
  /** 宿主环境事实(设置 → 环境面板)。只读:面板不装任何东西。 */
  getHostEnvironmentFacts(): Promise<HostEnvironmentFacts>;
  /** 重新探测一次,并返回新的事实(显式操作,不受探测节流限制)。 */
  redetectHostEnvironment(): Promise<HostEnvironmentFacts>;
  /** 把数据功能要的第三方包按需装进**内置那份** Python(用户点一次;会联网)。 */
  installHostPythonPackages(): Promise<HostPythonProvisionResult>;
  listPresentationTemplates(): Promise<PresentationTemplate[]>;
  listPresentationArtifacts(sessionId: string): Promise<ArtifactDescriptor[]>;
  createPresentationArtifact(
    sessionId: string,
    input?: { name?: string; templateId?: string | null },
  ): Promise<ArtifactDescriptor>;
  getPresentationPreview(
    sessionId: string,
    artifactId: string,
    force?: boolean,
  ): Promise<ArtifactPreviewManifest>;
  getPresentationSelection(
    sessionId: string,
    artifactId: string,
    surfaceId?: string,
  ): Promise<ArtifactSelection | null>;
  validatePresentationArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactIssue[]>;
  openPresentationArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<void>;
  revealPresentationArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<void>;
  listSpreadsheetArtifacts(sessionId: string): Promise<ArtifactDescriptor[]>;
  getSpreadsheetPreview(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactPreviewManifest>;
  getSpreadsheetSelection(
    sessionId: string,
    artifactId: string,
  ): Promise<SpreadsheetSelection | null>;
  getSpreadsheetCapabilities(): Promise<SpreadsheetCapabilitySnapshot>;
  profileSpreadsheetRange(
    sessionId: string,
    artifactId: string,
    sheet: string,
    range: string,
  ): Promise<SpreadsheetRangeProfile>;
  focusSpreadsheetLocator(
    sessionId: string,
    artifactId: string,
    locator: string,
  ): Promise<void>;
  clearSpreadsheetMarks(sessionId: string, artifactId: string): Promise<void>;
  getSpreadsheetChanges(
    sessionId: string,
    artifactId: string,
  ): Promise<SpreadsheetChangeRecord[]>;
  validateSpreadsheetArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactIssue[]>;
  openSpreadsheetArtifact(sessionId: string, artifactId: string): Promise<void>;
  revealSpreadsheetArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<void>;
  getDataAnalysisCapabilities(): Promise<DataAnalysisCapabilitySnapshot>;
  getAnalysisSnapshot(sessionId: string): Promise<AnalysisSessionSnapshot>;
  openAnalysisOutput(
    sessionId: string,
    analysisId: string,
    path: string,
  ): Promise<void>;
  revealAnalysisOutput(
    sessionId: string,
    analysisId: string,
    path: string,
  ): Promise<void>;
  getSessionArtifactDiff(
    sessionId: string,
    path: string,
  ): Promise<SessionArtifactDiff>;
  listSessionWorkspaceDirectory(
    sessionId: string,
    path: string,
  ): Promise<WorkspaceFileEntry[]>;
  searchSessionWorkspace(
    sessionId: string,
    query: string,
  ): Promise<WorkspaceFileEntry[]>;
  searchWorkspace(
    workspaceId: string,
    query: string,
  ): Promise<WorkspaceFileEntry[]>;
  readSessionWorkspaceTextFile(
    sessionId: string,
    path: string,
  ): Promise<SessionWorkspaceTextFile>;
  openSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  revealSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  saveSessionWorkspaceFileAs(sessionId: string, path: string): Promise<void>;
  trashSessionWorkspaceEntry(sessionId: string, path: string): Promise<void>;
  resolveOperationApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<void>;
  setSessionToolApprovalMode(
    sessionId: string,
    mode: ToolApprovalMode,
  ): Promise<void>;
  resolveUserRequest(
    sessionId: string,
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, string | string[] | boolean>;
      feedback?: string;
    },
  ): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  setSessionModel(
    sessionId: string,
    model: ModelReference,
    thinkingLevel?: ThinkingLevel,
  ): Promise<void>;
  setSessionThinkingLevel(
    sessionId: string,
    level: ThinkingLevel,
  ): Promise<SessionRecord>;
  setSessionAccess(
    sessionId: string,
    accessLevel: SessionAccessLevel,
  ): Promise<SessionRecord>;
  setSessionInteractionMode(
    sessionId: string,
    interactionMode: AgentInteractionModeId,
  ): Promise<SessionRecord>;
  resolveClarificationQuestion(
    sessionId: string,
    callId: string,
    value: string | boolean,
  ): Promise<UserMessageSubmission>;
  handoffClarification(
    sessionId: string,
    interactionMode: AgentInteractionModeId,
  ): Promise<void>;
  setPreferences(preferences: AppPreferences): Promise<void>;
  getOnboardingState(): Promise<OnboardingState>;
  completeOnboarding(): Promise<OnboardingState>;
  resetOnboarding(): Promise<OnboardingState>;
  /**
   * Starts a streaming translation of a message selection. Deltas, completion,
   * and failure arrive through `subscribeHost` as `translation` events keyed by
   * `requestId`, which the caller generates so it can correlate events from the
   * moment the request is issued.
   */
  translateSelection(request: {
    requestId: string;
    sessionId: string;
    text: string;
    targetLanguage?: string;
  }): Promise<void>;
  abortTranslation(requestId: string): Promise<void>;
  importAppearanceBackground(file: File): Promise<AppearanceBackgroundAsset>;
  removeAppearanceBackground(assetId: string): Promise<void>;
  getModelConfiguration(): Promise<AppSnapshot["modelConfiguration"]>;
  refreshSkills(): Promise<void>;
  importSkill(): Promise<boolean>;
  importSkillFile(file: File): Promise<void>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<void>;
  removeManagedSkill(skillId: string): Promise<void>;
  searchMcpMarketplace(query?: string, cursor?: string, refresh?: boolean): Promise<McpMarketplacePage>;
  getMcpMarketplaceDetail(name: string): Promise<McpMarketplaceEntry>;
  installMcpMarketplaceEntry(name: string): Promise<ConnectorSummary>;
  searchSkillMarketplace(query: string, page?: number, sortBy?: "stars" | "recent", refresh?: boolean): Promise<SkillMarketplacePage>;
  previewSkillMarketplace(skillId: string): Promise<SkillMarketplacePreview>;
  installSkillMarketplacePreview(previewId: string): Promise<SkillMarketplaceOrigin>;
  saveConnector(
    configuration: Omit<
      ConnectorConfiguration,
      "id" | "createdAt" | "updatedAt"
    > & { id?: string },
  ): Promise<ConnectorSummary>;
  testConnector(connectorId: string): Promise<void>;
  authorizeConnector(connectorId: string): Promise<ConnectorSummary>;
  trustConnector(connectorId: string): Promise<void>;
  setConnectorEnabled(connectorId: string, enabled: boolean): Promise<void>;
  removeConnector(connectorId: string): Promise<void>;
  setSessionConnectors(
    sessionId: string,
    connectorIds: string[],
  ): Promise<SessionRecord>;
  setSessionExpert(
    sessionId: string,
    selection: import("@wordless/domain").ExpertSelection | null,
  ): Promise<SessionRecord>;
  listConnectorResources(
    connectorId: string,
  ): Promise<ConnectorResourceSummary[]>;
  readConnectorResource(
    connectorId: string,
    uri: string,
  ): Promise<{ uri: string; content: string; mimeType: string | null }>;
  listConnectorPrompts(connectorId: string): Promise<ConnectorPromptSummary[]>;
  getConnectorPrompt(
    connectorId: string,
    name: string,
    argumentsValue: Record<string, string>,
  ): Promise<string>;
  discoverProviderModels(
    request: ProviderModelDiscoveryRequest,
  ): Promise<ProviderModelCandidate[]>;
  saveProviderConfiguration(
    kind: ConfiguredModelKind,
    providerId: string,
    configuration: Record<string, unknown>,
    enabledModelIds?: string[],
  ): Promise<void>;
  setConfiguredModelEnabled(
    kind: ConfiguredModelKind,
    providerId: string,
    modelId: string,
    enabled: boolean,
  ): Promise<void>;
  deleteCustomProvider(
    kind: ConfiguredModelKind,
    providerId: string,
  ): Promise<void>;
  loginProviderOAuth(providerId: string): Promise<void>;
  getExtensionSnapshot(): Promise<AgentExtensionSnapshot>;
  setExtensionEnabled(
    extensionId: string,
    enabled: boolean,
  ): Promise<AgentExtensionSnapshot>;
  updateExtensionSettings(
    extensionId: string,
    settings: JsonObject,
  ): Promise<AgentExtensionSnapshot>;
  interactWithSessionExtension(
    sessionId: string,
    extensionId: string,
    action: string,
    payload?: unknown,
  ): Promise<void>;
  setSessionExtensionState(
    sessionId: string,
    extensionId: string,
    state: JsonObject,
  ): Promise<void>;
  subscribe(listener: (event: RuntimeEventEnvelope) => void): () => void;
  subscribeHost(listener: (event: DesktopHostEvent) => void): () => void;
  /** Pushes browser panel state so the toolbar tracks in-page navigation. */
  subscribeBrowserViewState(listener: (state: BrowserPanelState) => void): () => void;
}

/**
 * Methods the preload must implement.
 *
 * Checked at startup by `desktopBridgeError`, and covered by a test so a method
 * added to the interface but forgotten here cannot pass silently — a missing
 * entry means no check at all for that method.
 */
export const requiredMethods: Array<Exclude<keyof DesktopBridge, "version">> = [
  "getHostInfo",
  "getAppInfo",
  "openApplicationMenu",
  "getUpdateSnapshot",
  "listReleases",
  "checkForUpdates",
  "downloadUpdate",
  "installUpdate",
  "openReleasePage",
  "getAccountSnapshot",
  "loginGoogle",
  "logoutGoogle",
  "getCloudSyncSnapshot",
  "enableCloudSync",
  "getRemoteAccessState",
  "onRemoteAccessChanged",
  "setRemoteAccessEnabled",
  "setRemoteMode",
  "prepareRemoteDeployBundle",
  "getRemoteDeployPlan",
  "probeRemoteDeploy",
  "runRemoteDeploy",
  "cancelRemoteDeploy",
  "getRemoteUninstallPlan",
  "runRemoteUninstall",
  "onRemoteDeployProgress",
  "setRemoteLanMode",
  "setRemoteLanAddress",
  "setRemoteRelayUrl",
  "testRemoteRelay",
  "createRemoteInvite",
  "withdrawRemoteInvite",
  "revokeRemoteDevice",
  "disableCloudSync",
  "syncCloudNow",
  "resolveCloudSyncConflict",
  "deleteCloudSyncRemote",
  "listAutomations",
  "createAutomation",
  "updateAutomation",
  "setAutomationsEnabled",
  "deleteAutomations",
  "runAutomation",
  "listAutomationRuns",
  "deleteAutomationRun",
  "listTasks",
  "createTask",
  "updateTask",
  "moveTask",
  "deleteTask",
  "executeTask",
  "getSnapshot",
  "listExperts",
  "saveExpert",
  "deleteExpert",
  "listExpertTeams",
  "getExpertTeamDetail",
  "saveExpertTeam",
  "deleteExpertTeam",
  "getUsageReport",
  "getSessionUsage",
  "getSessionSnapshot",
  "getSessionView",
  "getSessionHistoryPage",
  "getExpertMemberHistory",
  "getExpertMemberLiveState",
  "getExpertMemberToolOutput",
  "searchSessionMessages",
  "getSessionToolOutput",
  "renameSession",
  "setSessionPinned",
  "deleteSession",
  "deleteSessions",
  "getSessionStorageUsage",
  "showBrowserView",
    "getProxySnapshot",
    "setProxyConfig",
    "testProxyConnection",
    "detectLocalProxy",
    "setForegroundSession",
    "listWebhookEndpoints",
    "listWebhookProviders",
    "createWebhookEndpoint",
    "updateWebhookEndpoint",
    "setWebhookEndpointEnabled",
    "getNotificationDefaults",
    "setNotificationDefaults",
    "listDesigns",
    "openDesign",
    "refreshDesign",
    "moveDesignFrames",
    "createDesignFrame",
    "deleteDesignFrame",
    "exportDesign",
    "applyDesignStyle",
    "updateDesignFrameMeta",
    "rasterizeDesignFrames",
    "setDesignLiveFrame",
    "disposeDesignResources",
    "listDesignStyles",
    "getDesignStyleDetail",
    "createDesign",
    "saveDesignImage",
    "copyDesignImage",
    "deleteWebhookEndpoint",
    "testWebhookEndpoint",
  "setBrowserPanelSession",
  "hideBrowserView",
  "setBrowserViewBounds",
  "navigateBrowserView",
  "createBrowserTab",
  "closeBrowserTab",
  "selectBrowserTab",
  "setBrowserSessionScope",
  "setBrowserTabShared",
  "setBrowserActionsAllowed",
  "openBrowserViewDevTools",
  "createMediaProject",
  "getMediaProject",
  "importMediaImages",
  "duplicateMediaAsset",
  "deleteMediaAsset",
  "readMediaAssetData",
  "downloadMediaAsset",
  "startMediaOperation",
  "updateMediaLayout",
  "updateMediaViewport",
  "setMediaCoverAsset",
  "cancelMediaOperation",
  "openSessionFolder",
  "createManagedWorkspace",
  "openWorkspace",
  "pickWorkspace",
  "openExternalUrl",
  "createAndPrompt",
  "promptSession",
  "retrySessionTurn",
  "selectSessionTurnVersion",
  "compactSession",
  "getSessionContext",
  "getSessionArtifacts",
  "readSessionArtifact",
  "openSessionArtifact",
  "revealSessionArtifact",
  "saveSessionArtifactAs",
  "getOfficeEngineHealth",
  "getHostEnvironmentFacts",
  "redetectHostEnvironment",
  "installHostPythonPackages",
  "listPresentationTemplates",
  "listPresentationArtifacts",
  "createPresentationArtifact",
  "getPresentationPreview",
  "getPresentationSelection",
  "validatePresentationArtifact",
  "openPresentationArtifact",
  "revealPresentationArtifact",
  "listSpreadsheetArtifacts",
  "getSpreadsheetPreview",
  "getSpreadsheetSelection",
  "getSpreadsheetCapabilities",
  "profileSpreadsheetRange",
  "focusSpreadsheetLocator",
  "clearSpreadsheetMarks",
  "getSpreadsheetChanges",
  "validateSpreadsheetArtifact",
  "openSpreadsheetArtifact",
  "revealSpreadsheetArtifact",
  "getDataAnalysisCapabilities",
  "getAnalysisSnapshot",
  "openAnalysisOutput",
  "revealAnalysisOutput",
  "getSessionArtifactDiff",
  "listSessionWorkspaceDirectory",
  "searchSessionWorkspace",
  "searchWorkspace",
  "readSessionWorkspaceTextFile",
  "openSessionWorkspaceFile",
  "revealSessionWorkspaceFile",
  "saveSessionWorkspaceFileAs",
  "trashSessionWorkspaceEntry",
  "resolveOperationApproval",
  "setSessionToolApprovalMode",
  "resolveUserRequest",
  "cancelSession",
  "setSessionModel",
  "setSessionThinkingLevel",
  "setSessionAccess",
  "setSessionInteractionMode",
  "resolveClarificationQuestion",
  "handoffClarification",
  "setPreferences",
  "getOnboardingState",
  "completeOnboarding",
  "resetOnboarding",
  "importAppearanceBackground",
  "removeAppearanceBackground",
  "getModelConfiguration",
  "discoverProviderModels",
  "refreshSkills",
  "importSkill",
  "importSkillFile",
  "setSkillEnabled",
  "removeManagedSkill",
  "searchMcpMarketplace",
  "getMcpMarketplaceDetail",
  "installMcpMarketplaceEntry",
  "searchSkillMarketplace",
  "previewSkillMarketplace",
  "installSkillMarketplacePreview",
  "saveConnector",
  "testConnector",
  "authorizeConnector",
  "trustConnector",
  "setConnectorEnabled",
  "removeConnector",
  "setSessionConnectors",
  "setSessionExpert",
  "listConnectorResources",
  "readConnectorResource",
  "listConnectorPrompts",
  "getConnectorPrompt",
  "saveProviderConfiguration",
  "setConfiguredModelEnabled",
  "deleteCustomProvider",
  "loginProviderOAuth",
  "getExtensionSnapshot",
  "setExtensionEnabled",
  "updateExtensionSettings",
  "interactWithSessionExtension",
  "setSessionExtensionState",
  "translateSelection",
  "abortTranslation",
  "subscribe",
  "subscribeHost",
  "subscribeBrowserViewState",
];

export function desktopBridgeError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null)
    return "Electron preload bridge is unavailable.";
  const bridge = value as Record<string, unknown>;
  if (bridge.version !== DESKTOP_BRIDGE_VERSION)
    return "Electron preload bridge version is incompatible. Restart Wordless after rebuilding the desktop host.";
  const missing = requiredMethods.find(
    (method) => typeof bridge[method] !== "function",
  );
  return missing
    ? `Electron preload bridge is missing ${missing}. Restart Wordless after rebuilding the desktop host.`
    : undefined;
}

export function isDesktopBridge(value: unknown): value is DesktopBridge {
  return desktopBridgeError(value) === undefined;
}
