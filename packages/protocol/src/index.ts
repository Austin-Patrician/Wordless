import { Type, type Static } from "typebox";
import { PROVIDER_MODEL_FETCHERS } from "@wordless/domain";
import type {
  AgentExtensionEvent,
  AgentExtensionSessionState,
  AgentExtensionSnapshot,
} from "@wordless/agent-extension-sdk";
import type {
  AppPreferences,
  AutomationTaskInput,
  ContextCompactionRecord,
  ConversationMessage,
  ConversationUsage,
  EnabledModelRecord,
  ModelConfigurationSnapshot,
  MediaLayoutUpdate,
  MediaViewportUpdate,
  MediaOperationRequest,
  MediaProject,
  MediaProjectSummary,
  MessageToolSource,
  ModelReference,
  ModelRetryState,
  ProviderConnectionRecord,
  SessionDraft,
  SessionContextUsage,
  SessionTurnUsage,
  SessionRecord,
  SecurityPolicySnapshot,
  SkillCatalogSnapshot,
  ToolOperationApproval,
  UserPromptPart,
  UserRequest,
  UserRequestResolution,
  UsageReport,
  WorkbenchEntryDefinition,
  WorkspaceRecord,
  ConnectorCatalogSnapshot,
  ToolApprovalMode,
  ExpertSelection,
  ExpertSummary,
  ExpertDefinitionInput,
  ExpertTeamDefinitionInput,
  ExpertPortrait,
  SessionExpertTeamMemberSnapshot,
  WebhookAttachment,
  WebhookEndpointPublic,
  WebhookKind,
  WebhookMessage,
  WebhookMessageLevel,
  WebhookMutationResult,
  WebhookOptions,
  WebhookProviderDescriptor,
  WebhookSendErrorCode,
  WebhookSendResult,
  WebhookValidationErrorCode,
  NotificationDefaults,
  NotificationDefaultsResult,
  NotificationSubscription,
  NotificationTemplateErrorCode,
} from "@wordless/domain";

export type { ConversationMessage } from "@wordless/domain";

// Re-exported so the main process, preload and the renderer can all import the
// message-push contract from one place, exactly like the proxy types below.
export type {
  WebhookAttachment,
  WebhookCredentialField,
  WebhookDispatchResult,
  WebhookEndpointPublic,
  WebhookEndpointSecret,
  WebhookKind,
  WebhookMessage,
  WebhookMessageLevel,
  WebhookMutationErrorCode,
  WebhookMutationResult,
  WebhookOptions,
  WebhookProviderCapabilities,
  WebhookProviderDescriptor,
  WebhookSendErrorCode,
  WebhookSendResult,
  WebhookValidationErrorCode,
  WebhookValidationResult,
  NotificationDefaults,
  NotificationDefaultsResult,
  NotificationEvent,
  NotificationFailure,
  NotificationSubscription,
  NotificationTemplateErrorCode,
} from "@wordless/domain";

export const PROTOCOL_VERSION = 1;

export const DesktopHostInfoSchema = Type.Object({
  platform: Type.Union([
    Type.Literal("darwin"),
    Type.Literal("win32"),
    Type.Literal("linux"),
  ]),
  arch: Type.Union([
    Type.Literal("arm64"),
    Type.Literal("x64"),
    Type.Literal("ia32"),
  ]),
  windowChrome: Type.Union([
    Type.Literal("mac-hidden-inset"),
    Type.Literal("overlay"),
    Type.Literal("framed"),
  ]),
  menuPresentation: Type.Union([
    Type.Literal("system"),
    Type.Literal("in-window"),
  ]),
  modifier: Type.Union([Type.Literal("meta"), Type.Literal("control")]),
  shellFamily: Type.Union([
    Type.Literal("zsh"),
    Type.Literal("bash"),
    Type.Literal("powershell"),
    Type.Literal("sh"),
  ]),
  capabilities: Type.Object({
    dockBadge: Type.Boolean(),
    nativeNotifications: Type.Boolean(),
    titleBarOverlay: Type.Boolean(),
  }),
});

export type DesktopHostInfo = Static<typeof DesktopHostInfoSchema>;

export type DesktopMenuId = "file" | "edit" | "window" | "help";

export type DesktopCommand =
  "new-thread" | "open-settings" | "search" | "show-about";

export type DesktopAppInfo = {
  name: string;
  version: string;
  repositoryUrl: string;
  packaged: boolean;
  platform: "darwin" | "win32" | "linux";
  arch: string;
};

/**
 * First-run guide progress, persisted by the desktop host so the guide is shown
 * once per installation and can be replayed later from Settings.
 */
export type OnboardingState = {
  /** Guide revision this record was written for. */
  version: number;
  /** Milliseconds since epoch when the user finished the guide, or null. */
  completedAt: number | null;
};

/// Application proxy
///
/// The proxy is configured in Settings and stored by the host, never in the
/// renderer: the password is only ever held by the main process. Everything the
/// renderer receives goes through `DesktopProxyConfigSnapshot`, which replaces
/// the password with a boolean.

/**
 * Proxy protocols the host can actually use.
 *
 * Deliberately only http/https: the AI transport rejects anything else, and
 * undici's proxy agents speak HTTP CONNECT. A socks or pac URL is reported as an
 * unsupported protocol rather than being silently accepted and then failing
 * every request.
 */
export type DesktopProxyProtocol = "http" | "https";

export type DesktopProxyConfig = {
  enabled: boolean;
  protocol: DesktopProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
};

/** The renderer's view of the config: no password, only whether one is stored. */
export type DesktopProxyConfigSnapshot = Omit<DesktopProxyConfig, "password"> & {
  passwordConfigured: boolean;
};

/**
 * The renderer's write shape.
 *
 * `password` is optional on purpose: omitting it keeps the stored password, so
 * saving an unrelated field never requires the plaintext to travel back down to
 * the renderer. An explicit empty string clears it.
 */
export type DesktopProxyConfigPatch = Partial<Omit<DesktopProxyConfig, "password">> & {
  password?: string;
};

/** A local address that answered as an HTTP proxy when probed. */
export type ProxyProbeCandidate = {
  host: string;
  port: number;
};

/**
 * Why a probe of the effective proxy failed, if it did.
 *
 * Two cases only, because those are the two that can happen: the config cannot
 * be used at all, or the address did not answer.
 */
export type ProxyTestFailure = "invalid" | "unreachable";

export type ProxyTestResult = { ok: true } | { ok: false; reason: ProxyTestFailure };

/**
 * Which proxy the process is actually using right now.
 *
 * `environment` and `system` are detection results the user did not enter here;
 * `application` means the config below is in effect. `invalid` is separate from
 * `source` because an enabled-but-unusable config is still a distinct state the
 * settings page has to be able to say out loud.
 */
export type DesktopProxyActive = {
  source: "environment" | "system" | "application" | "direct";
  /** `host:port` of the effective proxy; never includes credentials. */
  target?: string;
  invalid: boolean;
};

export type DesktopProxySnapshot = {
  active: DesktopProxyActive;
  config: DesktopProxyConfigSnapshot;
};

/**
 * What the renderer may send when saving.
 *
 * `additionalProperties: false` so an unknown field is rejected at the boundary
 * rather than being quietly dropped by normalisation — a typo in the renderer
 * should be a loud error, not a setting that silently never applies.
 */
export const DesktopProxyConfigPatchSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    protocol: Type.Optional(Type.String()),
    host: Type.Optional(Type.String()),
    port: Type.Optional(Type.Number()),
    username: Type.Optional(Type.String()),
    password: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/// Embedded browser panel
///
/// The panel hosts a real Chromium `WebContentsView` that the main process
/// owns, so the renderer and the agent only ever exchange layout and
/// navigation intent — never page content. `getBoundingClientRect` values from
/// the renderer are already in device-independent pixels relative to the window
/// content area, which is exactly what `View.setBounds` consumes.

export type BrowserViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserNavigationAction = "url" | "back" | "forward" | "reload";

/**
 * Why a main-frame load failed. Surfaced to the panel so it can explain the
 * failure instead of leaving a blank rectangle, and so the native view can step
 * aside and let DOM render that explanation.
 */
export type BrowserLoadError = {
  /** Chromium net error code, e.g. -102 for ERR_CONNECTION_REFUSED. */
  code: number;
  /** Chromium's symbolic name for `code`, which is what users recognise. */
  description: string;
  /** The address that failed. */
  url: string;
};

export type BrowserTabState = {
  id: string;
  /** Last committed URL, or "" before the first navigation. */
  url: string;
  title: string;
  loading: boolean;
  /** True after this tab's renderer process died; the page is rebuilt on demand. */
  crashed: boolean;
  /** Set after a failed main-frame load, cleared when the next load starts. */
  loadError: BrowserLoadError | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * Whether the session currently shown in the panel has shared this tab.
   *
   * Relative to a session, not to the app: tabs are global like a browser's, but a
   * grant belongs to the task the user was working on when they gave it.
   */
  sharedWithAgent: boolean;
  /**
   * Whether the session shown in the panel may click and type on this tab's
   * *current* origin.
   *
   * Loopback pages qualify as soon as they are shared, since verifying a dev
   * server is what this is for. Anything else needs that session to approve the
   * origin, and the answer follows the page: navigating to another host turns it
   * off again until that host is approved.
   */
  actionsAllowed: boolean;
};

/**
 * Where a tab keeps cookies and storage.
 *
 * `ephemeral` lives in memory and disappears with the app; `persistent` is
 * written to disk so logins survive a restart.
 */
export type BrowserSessionScope = "ephemeral" | "persistent";

export type BrowserPanelState = {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  /**
   * Scope applied to tabs opened from now on. Changing it starts a fresh strip,
   * because an Electron session is fixed at view creation.
   */
  sessionScope: BrowserSessionScope;
  /** Whether the active tab's native view is currently mounted on the window. */
  attached: boolean;
  /** How many tabs the strip allows, so the panel can explain a refusal. */
  tabLimit: number;
};

/**
 * Result of a navigation request.
 *
 * `accepted` is reported separately from the resulting state because a refused
 * address and a refused connection both leave `url` unchanged, and the panel
 * needs to tell them apart to say the right thing.
 */
export type BrowserNavigateResult = {
  state: BrowserPanelState;
  accepted: boolean;
};

export const BrowserViewBoundsSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

export const BrowserNavigateSchema = Type.Object({
  action: Type.Union([
    Type.Literal("url"),
    Type.Literal("back"),
    Type.Literal("forward"),
    Type.Literal("reload"),
  ]),
  url: Type.Optional(Type.String()),
});

export const BrowserTabIdSchema = Type.Object({ tabId: Type.String() });

export const BrowserSetSharedSchema = Type.Object({ tabId: Type.String(), shared: Type.Boolean() });

export const BrowserSetActionsAllowedSchema = Type.Object({ tabId: Type.String(), allowed: Type.Boolean() });

export const BrowserPanelSessionSchema = Type.Object({ sessionId: Type.Union([Type.String(), Type.Null()]) });

export const BrowserCreateTabSchema = Type.Object({ url: Type.Optional(Type.String()) });

export const BrowserSessionScopeSchema = Type.Object({
  scope: Type.Union([Type.Literal("ephemeral"), Type.Literal("persistent")]),
});

export type AccountStatus = "signed-out" | "signed-in" | "needs-login";

export interface AccountSnapshot {
  status: AccountStatus;
  subject: string | null;
  email: string | null;
  name: string | null;
  pictureUrl: string | null;
  emailVerified: boolean;
  signedInAt: number | null;
}

export type CloudSyncStatus =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error"
  | "needs-reconnect"
  | "conflict";

export interface CloudSyncSnapshot {
  enabled: boolean;
  status: CloudSyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  pendingCount: number;
  conflicts: string[];
  accountEmail: string | null;
}

export type CloudSyncInitialStrategy = "merge" | "local" | "remote";
export type CloudSyncConflictResolution = "local" | "remote";

export type DesktopRelease = {
  version: string;
  title: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  prerelease: boolean;
};

export type DesktopUpdateSnapshot = {
  state:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  progress?: number;
  checkedAt?: number;
  error?: string;
  installMode?: "restart-install" | "manual-dmg";
};

export type DesktopHostEvent =
  | { type: "command"; command: DesktopCommand }
  | { type: "deep-link"; url: string }
  | { type: "update"; snapshot: DesktopUpdateSnapshot }
  | { type: "account.changed"; account: AccountSnapshot }
  | { type: "cloud-sync.changed"; snapshot: CloudSyncSnapshot }
  // Selection translation streams over the host channel on purpose: it is not
  // part of any session journal, so it must not travel as a runtime event.
  | { type: "translation"; event: TranslationStreamEvent }
  /**
   * Asked for by the host, usually because the user clicked a desktop
   * notification: bring the window forward and show this session.
   */
  | { type: "open-session"; sessionId: string };

export type DesktopUpdateState = DesktopUpdateSnapshot;

export interface ProtocolFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type ProtocolResult<T> =
  { ok: true; value: T } | { ok: false; error: ProtocolFailure };

export const ModelReferenceSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
});

export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

export const SessionAccessLevelSchema = Type.Union([
  Type.Literal("default"),
  Type.Literal("full"),
]);

export const ToolApprovalModeSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("auto"),
  Type.Literal("bypass"),
]);

export const AutomationScheduleSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("recurring"),
    cadence: Type.Union([
      Type.Literal("daily"),
      Type.Literal("weekdays"),
      Type.Literal("weekly"),
      Type.Literal("monthly"),
    ]),
    time: Type.String({ pattern: "^[0-2][0-9]:[0-5][0-9]$" }),
    weekdays: Type.Optional(
      Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7 }),
    ),
    dayOfMonth: Type.Optional(Type.Integer({ minimum: 1, maximum: 31 })),
  }),
  Type.Object({
    kind: Type.Literal("interval"),
    every: Type.Integer({ minimum: 1, maximum: 100000 }),
    unit: Type.Union([
      Type.Literal("minutes"),
      Type.Literal("hours"),
      Type.Literal("days"),
    ]),
  }),
  Type.Object({ kind: Type.Literal("once"), at: Type.Number({ minimum: 0 }) }),
]);

/**
 * A template is a body with `{{variable}}` holes. Validated where it is saved so a
 * typo can never reach a group chat as a literal `{{nam}}`.
 */
export const NOTIFICATION_TEMPLATE_VARIABLES = ["name", "status", "startedAt", "duration", "reply", "error"] as const;

export const NotificationNotifyWhenSchema = Type.Union([
  Type.Literal("always"),
  Type.Literal("success"),
  Type.Literal("failure"),
]);

export const NotificationSubscriptionSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    endpointIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 }),
    when: NotificationNotifyWhenSchema,
    template: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

export const NotificationDefaultsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    endpointIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 }),
    when: NotificationNotifyWhenSchema,
    template: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

/** `additionalProperties: false` so a typo in the renderer is a loud error. */
export const NotificationDefaultsPatchSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    endpointIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })),
    when: Type.Optional(NotificationNotifyWhenSchema),
    template: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const AutomationTaskInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  notification: Type.Optional(NotificationSubscriptionSchema),
  prompt: Type.String({ minLength: 1, maxLength: 100000 }),
  entryId: Type.String({ minLength: 1 }),
  workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  sessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  accessLevel: SessionAccessLevelSchema,
  toolApprovalMode: ToolApprovalModeSchema,
  model: Type.Union([ModelReferenceSchema, Type.Null()]),
  thinkingLevel: ThinkingLevelSchema,
  skillIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
  connectorIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
  schedule: AutomationScheduleSchema,
  activeFrom: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  activeUntil: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  enabled: Type.Boolean(),
});

export type AutomationTaskInputDto = AutomationTaskInput;

export const AgentInteractionModeSchema = Type.Union([
  Type.Literal("default"),
  Type.Literal("clarify"),
  Type.Literal("plan"),
]);

const SkillSourceSchema = Type.Union([
  Type.Literal("built-in"),
  Type.Literal("wordless"),
  Type.Literal("pi"),
  Type.Literal("agents"),
  Type.Literal("claude"),
  Type.Literal("codex"),
  Type.Literal("workspace-pi"),
  Type.Literal("workspace-claude"),
  Type.Literal("workspace-codex"),
]);

export const UserPromptPartSchema = Type.Union([
  Type.Object({
    type: Type.Literal("text"),
    text: Type.String({ maxLength: 100_000 }),
  }),
  Type.Object({
    type: Type.Literal("skill-reference"),
    skillId: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    source: SkillSourceSchema,
  }),
  Type.Object({
    type: Type.Literal("workspace-reference"),
    path: Type.String({ minLength: 1, maxLength: 1024 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
  }),
  /**
   * 画布色彩面板上点选的令牌。
   *
   * **这条一直在漏**:渲染层从 `InlineSkillComposer` 把这种 part 直接交给 `promptSession`,而边界
   * 校验里没有它 —— 于是"挂一枚色块再发送"会以 `Invalid request payload` 结束。schema 太窄和太宽
   * 一样是 bug,只是它报错的位置离原因更远。
   */
  Type.Object({
    type: Type.Literal("theme-token-reference"),
    path: Type.String({ minLength: 1, maxLength: 1_024 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    value: Type.String({ minLength: 1, maxLength: 256 }),
  }),
  /**
   * 用户在新建成页挑的内置风格。
   *
   * 只带 id:令牌与规范由 `design_create({ styleId })` 落进设计包(§14.22),这里不做落盘。
   */
  Type.Object({
    type: Type.Literal("design-style"),
    styleId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    type: Type.Literal("artifact-reference"),
    artifactId: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union([
      Type.Literal("presentation"),
      Type.Literal("document"),
      Type.Literal("spreadsheet"),
      Type.Literal("browser"),
    ]),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    revision: Type.Integer({ minimum: 1 }),
    surfaceId: Type.String({ minLength: 1, maxLength: 512 }),
    locator: Type.String({ minLength: 1, maxLength: 2_048 }),
    locators: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), {
        minItems: 1,
        maxItems: 10_000,
      }),
    ),
    intent: Type.Optional(
      Type.Union([
        Type.Literal("reference"),
        Type.Literal("analyze"),
        Type.Literal("formula"),
        Type.Literal("chart"),
        Type.Literal("pivot"),
      ]),
    ),
  }),
]);

export const UserPromptPartsSchema = Type.Array(UserPromptPartSchema, {
  minItems: 1,
  maxItems: 1_024,
});
export const PromptAttachmentInputSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mediaType: Type.String({ maxLength: 256 }),
  size: Type.Integer({ minimum: 0, maximum: 52_428_800 }),
  source: Type.Union([
    Type.Object({ type: Type.Literal("path"), path: Type.String({ minLength: 1, maxLength: 4_096 }) }),
    Type.Object({ type: Type.Literal("bytes"), base64: Type.String({ minLength: 1, maxLength: 70_000_000 }) }),
  ]),
});
export const PromptAttachmentsSchema = Type.Array(PromptAttachmentInputSchema, { maxItems: 10 });
export type ProtocolUserPromptPart = Static<typeof UserPromptPartSchema> &
  UserPromptPart;

export const UserMessageSubmissionSchema = Type.Object({
  messageId: Type.String({ minLength: 1, maxLength: 128 }),
  submittedAt: Type.Number({ minimum: 0 }),
});

export const SessionDraftSchema = Type.Object({
  mode: Type.Union([
    Type.Literal("everyday"),
    Type.Literal("code"),
    Type.Literal("create"),
  ]),
  entryId: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  accessLevel: SessionAccessLevelSchema,
  model: Type.Union([ModelReferenceSchema, Type.Null()]),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
  connectorIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
  ),
  interactionMode: Type.Optional(AgentInteractionModeSchema),
  toolApprovalMode: Type.Optional(ToolApprovalModeSchema),
  expertSelection: Type.Optional(
    Type.Object({
      kind: Type.Union([Type.Literal("expert"), Type.Literal("team")]),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      version: Type.String({ minLength: 1, maxLength: 32 }),
    }),
  ),
  presentation: Type.Optional(
    Type.Object({
      generationMode: Type.Union([
        Type.Literal("guided"),
        Type.Literal("quick"),
      ]),
      templateId: Type.Union([
        Type.String({ minLength: 1, maxLength: 128 }),
        Type.Null(),
      ]),
    }),
  ),
});

export const CreateWorkspaceSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 96 }),
});

export const OpenWorkspaceSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
});

export const OpenExternalUrlSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 8_192 }),
});

/**
 * Starts a streaming translation of a message selection.
 *
 * `requestId` is generated by the renderer so it can correlate stream events
 * from the moment it issues the request, without racing the acknowledgement.
 * `targetLanguage` is an optional one-off override of the stored preference.
 */
export const TranslateSelectionSchema = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  sessionId: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1, maxLength: 20_000 }),
  targetLanguage: Type.Optional(Type.String({ minLength: 2, maxLength: 40 })),
});

export const AbortTranslationSchema = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
});

export type TranslationStreamPhase = "start" | "delta" | "done" | "error" | "aborted";

export type TranslationStreamEvent = {
  requestId: string;
  phase: TranslationStreamPhase;
  /** Incremental text for `delta`; the complete text for `done`. */
  text: string;
  targetLanguage?: string;
  model?: ModelReference;
  error?: string;
};

export const CreateAndPromptSchema = Type.Object({
  draft: SessionDraftSchema,
  parts: UserPromptPartsSchema,
  submission: UserMessageSubmissionSchema,
  attachments: Type.Optional(PromptAttachmentsSchema),
});

const TaskStatusSchema = Type.Union([
  Type.Literal("todo"),
  Type.Literal("in-progress"),
  Type.Literal("review"),
  Type.Literal("done"),
]);
export const TaskRecordInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  detailParts: UserPromptPartsSchema,
  expectedResult: Type.Optional(Type.String({ maxLength: 20_000 })),
  status: TaskStatusSchema,
  priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
  dueAt: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  position: Type.Optional(Type.Number({ minimum: 0 })),
  entryId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  expertSelection: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("expert"), Type.Literal("team")]), id: Type.String({ minLength: 1, maxLength: 128 }), version: Type.String({ minLength: 1, maxLength: 32 }) })),
  workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  sessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  model: Type.Union([ModelReferenceSchema, Type.Null()]),
  thinkingLevel: ThinkingLevelSchema,
  accessLevel: SessionAccessLevelSchema,
  toolApprovalMode: ToolApprovalModeSchema,
  connectorIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
});
export const TaskIdSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
export const TaskMoveSchema = Type.Object({ id: Type.String({ minLength: 1 }), status: TaskStatusSchema, position: Type.Optional(Type.Number({ minimum: 0 })) });

const ExpertMetadataSchema = {
  tags: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 32 }),
  ),
  categories: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 16 }),
  ),
  roleLabel: Type.Optional(Type.String({ maxLength: 120 })),
};
const expertPortraitChoice = (values: readonly string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const ExpertPortraitColorSchema = Type.String({
  pattern: "^(transparent|[a-fA-F0-9]{6})$",
});
export const ExpertPortraitSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("builtin"),
    key: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    kind: Type.Literal("avataaars"),
    schemaVersion: Type.Literal(1),
    options: Type.Object({
      backgroundColor: ExpertPortraitColorSchema,
      skinColor: ExpertPortraitColorSchema,
      top: expertPortraitChoice(["hat", "hijab", "turban", "winterHat1", "winterHat02", "winterHat03", "winterHat04", "bob", "bun", "curly", "curvy", "dreads", "frida", "fro", "froBand", "longButNotTooLong", "miaWallace", "shavedSides", "straight02", "straight01", "straightAndStrand", "dreads01", "dreads02", "frizzle", "shaggy", "shaggyMullet", "shortCurly", "shortFlat", "shortRound", "shortWaved", "sides", "theCaesar", "theCaesarAndSidePart", "bigHair"]),
      hairColor: ExpertPortraitColorSchema,
      hatColor: ExpertPortraitColorSchema,
      eyes: expertPortraitChoice(["closed", "cry", "default", "eyeRoll", "happy", "hearts", "side", "squint", "surprised", "winkWacky", "wink", "xDizzy"]),
      eyebrows: expertPortraitChoice(["angryNatural", "defaultNatural", "flatNatural", "frownNatural", "raisedExcitedNatural", "sadConcernedNatural", "unibrowNatural", "upDownNatural", "angry", "default", "raisedExcited", "sadConcerned", "upDown"]),
      mouth: expertPortraitChoice(["concerned", "default", "disbelief", "eating", "grimace", "sad", "screamOpen", "serious", "smile", "tongue", "twinkle", "vomit"]),
      facialHair: expertPortraitChoice(["none", "beardLight", "beardMajestic", "beardMedium", "moustacheFancy", "moustacheMagnum"]),
      facialHairColor: ExpertPortraitColorSchema,
      clothing: expertPortraitChoice(["blazerAndShirt", "blazerAndSweater", "collarAndSweater", "graphicShirt", "hoodie", "overall", "shirtCrewNeck", "shirtScoopNeck", "shirtVNeck"]),
      clothesColor: ExpertPortraitColorSchema,
      accessories: expertPortraitChoice(["none", "kurt", "prescription01", "prescription02", "round", "sunglasses", "wayfarers", "eyepatch"]),
      accessoriesColor: ExpertPortraitColorSchema,
    }),
  }),
]);
export const SaveExpertSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  input: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    systemPrompt: Type.String({ minLength: 1, maxLength: 30000 }),
    portrait: ExpertPortraitSchema,
    skillIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
    ),
    connectorIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
    ),
    ...ExpertMetadataSchema,
  }),
});
export const DeleteExpertSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
});
export type ExpertDefinitionInputDto = ExpertDefinitionInput;
const ExpertExecutionProfileSchema = Type.Union([
  Type.Literal("read-only"),
  Type.Literal("review"),
  Type.Literal("research"),
  Type.Literal("workspace-write"),
]);
export const SaveExpertTeamSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  input: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    portrait: ExpertPortraitSchema,
    leaderMemberId: Type.String({ minLength: 1, maxLength: 128 }),
    members: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 128 }),
        name: Type.String({ minLength: 1, maxLength: 80 }),
        portrait: ExpertPortraitSchema,
        systemPrompt: Type.String({ minLength: 1, maxLength: 30000 }),
        skillIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
        connectorIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
        model: Type.Optional(ModelReferenceSchema),
        thinkingLevel: Type.Optional(ThinkingLevelSchema),
        executionProfile: ExpertExecutionProfileSchema,
        responsibility: Type.String({ minLength: 1, maxLength: 1000 }),
        needsReview: Type.Optional(Type.Boolean()),
      }),
      { minItems: 2, maxItems: 9 },
    ),
    systemPrompt: Type.String({ minLength: 1, maxLength: 30000 }),
    ...ExpertMetadataSchema,
  }),
});
export const DeleteExpertTeamSchema = DeleteExpertSchema;
export type ExpertTeamDefinitionInputDto = ExpertTeamDefinitionInput;
export const GetExpertTeamDetailSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
});

export const PromptSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  parts: UserPromptPartsSchema,
  submission: UserMessageSubmissionSchema,
  attachments: Type.Optional(PromptAttachmentsSchema),
});

/**
 * Regenerates the assistant response of one user turn.
 *
 * `messageId` is the journal entry id of the user message (the renderer message
 * id), so the retry always anchors to the turn the user asked to redo. The
 * previous response stays in the session journal as an inactive branch version.
 */
export const RetrySessionTurnSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  messageId: Type.String({ minLength: 1, maxLength: 128 }),
  /** Optional style directive for the new response, e.g. a length instruction. */
  instruction: Type.Optional(
    Type.String({ minLength: 1, maxLength: 4_000 }),
  ),
});

/** Switches which retry version of a turn is active for the session. */
export const SelectSessionTurnVersionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  messageId: Type.String({ minLength: 1, maxLength: 128 }),
  version: Type.Integer({ minimum: 1, maximum: 64 }),
});

export const WorkspaceReferenceSearchSchema = Type.Object({
  workspaceId: Type.String({ minLength: 1 }),
  query: Type.String({ maxLength: 256 }),
});

export const SessionWorkspaceReferenceSearchSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  query: Type.String({ maxLength: 256 }),
});

export const WorkspaceDeleteSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const SetSkillEnabledSchema = Type.Object({
  skillId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const RemoveManagedSkillSchema = Type.Object({
  skillId: Type.String({ minLength: 1 }),
});

export const ImportSkillFileSchema = Type.Object({
  sourcePath: Type.String({ minLength: 1, maxLength: 4_096 }),
});

export const ConnectorConfigurationSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  templateId: Type.Union([
    Type.Literal("feishu"),
    Type.Literal("dingtalk"),
    Type.Literal("wecom"),
    Type.Literal("postgresql"),
    Type.Literal("web-search"),
    Type.Literal("firecrawl"),
    Type.Literal("github"),
    Type.Literal("ai-hot"),
    Type.Null(),
  ]),
  transport: Type.Union([
    Type.Literal("stdio"),
    Type.Literal("streamable-http"),
  ]),
  enabled: Type.Boolean(),
  trustedAt: Type.Union([Type.Number(), Type.Null()]),
  command: Type.Union([Type.String(), Type.Null()]),
  args: Type.Array(Type.String()),
  cwd: Type.Union([Type.String(), Type.Null()]),
  environment: Type.Record(Type.String(), Type.String()),
  url: Type.Union([Type.String(), Type.Null()]),
  headers: Type.Array(
    Type.Object({ name: Type.String(), value: Type.String() }),
  ),
  oauth: Type.Union([
    Type.Object({
      clientId: Type.Optional(Type.String()),
      clientSecret: Type.Optional(Type.String()),
      scope: Type.Optional(Type.String()),
      accessToken: Type.Optional(Type.String()),
      refreshToken: Type.Optional(Type.String()),
      expiresAt: Type.Optional(Type.Number()),
    }),
    Type.Null(),
  ]),
  marketplace: Type.Optional(Type.Object({
    source: Type.Literal("official-mcp-registry"),
    registryName: Type.String({ minLength: 1, maxLength: 240 }),
    version: Type.String({ minLength: 1, maxLength: 120 }),
    sourceUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
  })),
});

export const ConnectorIdSchema = Type.Object({
  connectorId: Type.String({ minLength: 1 }),
});

export const SetConnectorEnabledSchema = Type.Object({
  connectorId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const SetSessionConnectorsSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  connectorIds: Type.Array(Type.String({ minLength: 1 })),
});
export const SetSessionExpertSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  selection: Type.Union([
    Type.Null(),
    Type.Object({
      kind: Type.Union([Type.Literal("expert"), Type.Literal("team")]),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      version: Type.String({ minLength: 1, maxLength: 32 }),
    }),
  ]),
});

export const ConnectorPromptSchema = Type.Object({
  connectorId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: Type.Record(Type.String(), Type.String()),
});

export const CompactSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

export const SessionHistoryPageRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  after: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  before: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  aroundTurnId: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 48 })),
});

export const ExpertMemberHistoryRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  memberId: Type.String({ minLength: 1, maxLength: 120 }),
  after: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  before: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  aroundTurnId: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 48 })),
});

export const ExpertMemberToolOutputRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  memberId: Type.String({ minLength: 1, maxLength: 120 }),
  callId: Type.String({ minLength: 1 }),
});

export const ExpertMemberLiveStateRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  memberId: Type.String({ minLength: 1, maxLength: 120 }),
});

export const SessionMessageSearchRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  query: Type.String({ minLength: 1, maxLength: 500 }),
  role: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

export const SessionToolOutputRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  callId: Type.String({ minLength: 1 }),
});

export const WorkspaceFileRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const SessionArtifactRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  artifactId: Type.String({ minLength: 1, maxLength: 128 }),
});

export const ListWorkspaceDirectorySchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ maxLength: 1024 }),
});

export const ResolveOperationApprovalSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  approvalId: Type.String({ minLength: 1 }),
  approved: Type.Boolean(),
  feedback: Type.Optional(Type.String({ maxLength: 4_000 })),
});

export const SetSessionToolApprovalModeSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  mode: ToolApprovalModeSchema,
});

export const ResolveUserRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal("submitted"), Type.Literal("cancelled")]),
  answers: Type.Optional(
    Type.Record(
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Union([
        Type.String({ maxLength: 4_000 }),
        Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 32 }),
        Type.Boolean(),
      ]),
    ),
  ),
  feedback: Type.Optional(Type.String({ maxLength: 4_000 })),
});

export const RenameSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
});

export const SetSessionPinnedSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  pinned: Type.Boolean(),
});

export const DeleteSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

/**
 * Erases sessions, including their journals, attachments and artifacts. The
 * desktop host routes the removal through the OS trash where it can.
 */
export const DeleteSessionsSchema = Type.Object({
  sessionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

export const SetSessionModelSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  model: ModelReferenceSchema,
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
});

export const SetSessionThinkingLevelSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  level: ThinkingLevelSchema,
});

export const SetSessionAccessSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  accessLevel: SessionAccessLevelSchema,
});

export const SetSessionInteractionModeSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  interactionMode: AgentInteractionModeSchema,
});

export const ResolveClarificationQuestionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  callId: Type.String({ minLength: 1 }),
  value: Type.Union([Type.String({ maxLength: 8_000 }), Type.Boolean()]),
});

export const HandoffClarificationSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  interactionMode: Type.Union([
    Type.Literal("default"),
    Type.Literal("clarify"),
    Type.Literal("plan"),
  ]),
});

export const SetPreferenceSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  value: Type.Unknown(),
});

export const UsageReportQuerySchema = Type.Object({
  startAt: Type.Number({ minimum: 0 }),
  endAt: Type.Number({ minimum: 0 }),
  groupBy: Type.Union([Type.Literal("provider"), Type.Literal("model")]),
});

export const ImportAppearanceBackgroundSchema = Type.Object({
  sourcePath: Type.String({ minLength: 1, maxLength: 4_096 }),
});

export const RemoveAppearanceBackgroundSchema = Type.Object({
  assetId: Type.String({ minLength: 1, maxLength: 96 }),
});

export const SetExtensionEnabledSchema = Type.Object({
  extensionId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const UpdateExtensionSettingsSchema = Type.Object({
  extensionId: Type.String({ minLength: 1 }),
  settings: Type.Object({}, { additionalProperties: true }),
});

export const SessionExtensionInteractionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  extensionId: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  payload: Type.Optional(Type.Unknown()),
});

export const SetSessionExtensionStateSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  extensionId: Type.String({ minLength: 1 }),
  state: Type.Object({}, { additionalProperties: true }),
});

export const SaveCustomProviderSchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 96 }),
  baseUrl: Type.String({ minLength: 1 }),
  api: Type.Union([
    Type.Literal("openai-completions"),
    Type.Literal("openai-responses"),
  ]),
  modelId: Type.String({ minLength: 1 }),
  modelName: Type.String({ minLength: 1 }),
  apiKey: Type.Optional(Type.String()),
});

export const SetEnabledModelSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const SaveBuiltinCredentialSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  apiKey: Type.String({ minLength: 1 }),
});

export const SaveProviderConfigurationSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
  configuration: Type.Object({}, { additionalProperties: true }),
  enabledModelIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { maxItems: 10_000 }),
  ),
});

export const DiscoverProviderModelsSchema = Type.Object({
  providerId: Type.String({ minLength: 1, maxLength: 200 }),
  providerFamily: Type.Union([
    Type.String({ minLength: 1, maxLength: 100 }),
    Type.Null(),
  ]),
  baseUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
  apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
  api: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  headers: Type.Optional(
    Type.Record(
      Type.String({ maxLength: 200 }),
      Type.String({ maxLength: 20_000 }),
    ),
  ),
  authHeader: Type.Optional(Type.Boolean()),
  modelFetcher: Type.Optional(
    Type.Union(PROVIDER_MODEL_FETCHERS.map((fetcher) => Type.Literal(fetcher))),
  ),
});

export const SetConfiguredModelEnabledSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const DeleteCustomProviderSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
});

export const MediaAssetSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
  origin: Type.Union([Type.Literal("uploaded"), Type.Literal("generated")]),
  kind: Type.Union([Type.Literal("image"), Type.Literal("video")]),
  status: Type.Union([
    Type.Literal("rendering"),
    Type.Literal("ready"),
    Type.Literal("failed"),
  ]),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  url: Type.Union([
    Type.String({ minLength: 1, maxLength: 16_384 }),
    Type.Null(),
  ]),
  errorMessage: Type.Union([
    Type.String({ minLength: 1, maxLength: 4_000 }),
    Type.Null(),
  ]),
  pixelWidth: Type.Union([
    Type.Number({ minimum: 1, maximum: 32_768 }),
    Type.Null(),
  ]),
  pixelHeight: Type.Union([
    Type.Number({ minimum: 1, maximum: 32_768 }),
    Type.Null(),
  ]),
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 160, maximum: 720 }),
  height: Type.Number({ minimum: 120, maximum: 720 }),
  outputIndex: Type.Number({ minimum: 0, maximum: 15 }),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

const MediaOperationKindSchema = Type.Union([
  Type.Literal("upload"),
  Type.Literal("generate"),
  Type.Literal("regenerate"),
  Type.Literal("variation"),
  Type.Literal("crop"),
  Type.Literal("local-edit"),
  Type.Literal("remove-background"),
  Type.Literal("remove-object"),
  Type.Literal("multi-view"),
]);

const CacheUsageReportingSchema = Type.Union([
  Type.Literal("unavailable"),
  Type.Literal("read-only"),
  Type.Literal("read-write"),
]);

const ConversationUsageSchema = Type.Object({
  inputTokens: Type.Number({ minimum: 0 }),
  outputTokens: Type.Number({ minimum: 0 }),
  cacheReadTokens: Type.Number({ minimum: 0 }),
  cacheWriteTokens: Type.Number({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  totalCost: Type.Number({ minimum: 0 }),
  /**
   * 这次调用 provider **有没有**上报缓存读写明细。缺省 = `unavailable`(历史记录天生如此)。
   * 没有它,"cacheRead 为 0"就分不清"没命中"和"没上报",界面上会出现假的 0% 命中率。
   */
  cacheUsageReporting: Type.Optional(CacheUsageReportingSchema),
  /** provider 自报的 prompt 总数,只用于对账(见 `packages/domain`)。 */
  reportedPromptTokens: Type.Optional(Type.Number({ minimum: 0 })),
  /** 以下为**聚合**字段:合并多条用量时累计,逐条记录不写。 */
  cacheReadObservedCalls: Type.Optional(Type.Number({ minimum: 0 })),
  cacheWriteObservedCalls: Type.Optional(Type.Number({ minimum: 0 })),
  cacheReadObservedPromptTokens: Type.Optional(Type.Number({ minimum: 0 })),
  cacheWriteObservedPromptTokens: Type.Optional(Type.Number({ minimum: 0 })),
  cacheReadObservedTokens: Type.Optional(Type.Number({ minimum: 0 })),
  cacheWriteObservedTokens: Type.Optional(Type.Number({ minimum: 0 })),
  cacheHitCalls: Type.Optional(Type.Number({ minimum: 0 })),
});

/**
 * 一次用量汇总的 JSON 形状(与 `@wordless/domain` 的 `TokenUsageSummary` 一一对应)。
 *
 * 率一律允许 `null`:`null` 是"没有可用的数据"(未上报 / 分母为 0),**不是** 0%。
 */
const TokenUsageSummarySchema = Type.Object({
  modelCalls: Type.Number({ minimum: 0 }),
  primaryCalls: Type.Number({ minimum: 0 }),
  delegatedCalls: Type.Number({ minimum: 0 }),
  inputTokens: Type.Number({ minimum: 0 }),
  outputTokens: Type.Number({ minimum: 0 }),
  cacheReadTokens: Type.Number({ minimum: 0 }),
  cacheWriteTokens: Type.Number({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  totalCost: Type.Number({ minimum: 0 }),
  promptTokens: Type.Number({ minimum: 0 }),
  cacheReadObservedCalls: Type.Number({ minimum: 0 }),
  cacheWriteObservedCalls: Type.Number({ minimum: 0 }),
  cacheReadObservedPromptTokens: Type.Number({ minimum: 0 }),
  cacheReadObservedTokens: Type.Number({ minimum: 0 }),
  cacheWriteObservedTokens: Type.Number({ minimum: 0 }),
  cacheHitCalls: Type.Number({ minimum: 0 }),
  tokenHitRate: Type.Union([Type.Number(), Type.Null()]),
  requestHitRate: Type.Union([Type.Number(), Type.Null()]),
  writeRate: Type.Union([Type.Number(), Type.Null()]),
  readCallCoverage: Type.Union([Type.Number(), Type.Null()]),
  readTokenCoverage: Type.Union([Type.Number(), Type.Null()]),
  writeCallCoverage: Type.Union([Type.Number(), Type.Null()]),
  cacheWriteObservation: Type.Union([
    Type.Literal("reported"),
    Type.Literal("read-only"),
    Type.Literal("unavailable"),
  ]),
  reportedPromptTokens: Type.Number({ minimum: 0 }),
  reportedPromptCount: Type.Number({ minimum: 0 }),
  reportedPromptDriftCount: Type.Number({ minimum: 0 }),
  reportedPromptMaxDrift: Type.Number({ minimum: 0 }),
});

/**
 * 会话总计。来源是 **journal**(唯一权威),所以它和逐轮面板由同一套纯函数算出。
 *
 * 图片单独放在 `image` 里:它的计费形态不同(按张 / 按 token 混着),**不并进对话的命中率分母**。
 */
export const SessionUsageSnapshotSchema = Type.Object({
  chat: TokenUsageSummarySchema,
  image: Type.Object({
    operations: Type.Number({ minimum: 0 }),
    unmeteredOperations: Type.Number({ minimum: 0 }),
    totalTokens: Type.Number({ minimum: 0 }),
    totalCost: Type.Number({ minimum: 0 }),
  }),
  /** 有助手消息但拿不到用量的调用数 —— "我们不知道",与"花了 0"不同。 */
  unmeasuredCalls: Type.Number({ minimum: 0 }),
});

/** IPC 契约上的会话总计。 */
export type SessionUsageSnapshot = Static<typeof SessionUsageSnapshotSchema>;

const MediaUsageEventSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  timestamp: Type.Number({ minimum: 0 }),
  usage: Type.Optional(ConversationUsageSchema),
});

export const MediaOperationSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: MediaOperationKindSchema,
  inputs: Type.Array(
    Type.Object({
      assetId: Type.String({ minLength: 1 }),
      role: Type.Union([Type.Literal("parent"), Type.Literal("reference")]),
    }),
    { maxItems: 16 },
  ),
  outputAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
  prompt: Type.Union([
    Type.String({ minLength: 1, maxLength: 8_000 }),
    Type.Null(),
  ]),
  ratio: Type.String({ minLength: 1, maxLength: 24 }),
  outputCount: Type.Number({ minimum: 0, maximum: 16 }),
  outputTotal: Type.Number({ minimum: 1, maximum: 16 }),
  providerId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  modelId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  status: Type.Union([
    Type.Literal("rendering"),
    Type.Literal("ready"),
    Type.Literal("partial"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),
  errorMessage: Type.Union([
    Type.String({ minLength: 1, maxLength: 4_000 }),
    Type.Null(),
  ]),
  usageEvents: Type.Optional(
    Type.Array(MediaUsageEventSchema, { maxItems: 128 }),
  ),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

export const MediaProjectSchema = Type.Object({
  documentVersion: Type.Literal(3),
  sessionId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  assets: Type.Array(MediaAssetSchema, { maxItems: 2_048 }),
  operations: Type.Array(MediaOperationSchema, { maxItems: 2_048 }),
  coverAssetId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  viewport: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    zoom: Type.Number({ minimum: 0.1, maximum: 3 }),
  }),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

export const CreateMediaProjectSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
});

export const MediaProjectRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

const MediaPositionSchema = Type.Object({ x: Type.Number(), y: Type.Number() });
const MediaProviderRequestBase = {
  sessionId: Type.String({ minLength: 1 }),
  parentAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
  referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
    maxItems: 16,
  }),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1, maxLength: 8_000 }),
  ratio: Type.String({ minLength: 1, maxLength: 24 }),
  outputCount: Type.Number({ minimum: 1, maximum: 4 }),
  imageParameters: Type.Optional(
    Type.Object(
      {
        aspectRatio: Type.Optional(
          Type.String({ minLength: 1, maxLength: 24 }),
        ),
        resolution: Type.Optional(Type.String({ minLength: 1, maxLength: 24 })),
        size: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
        quality: Type.Optional(Type.String({ minLength: 1, maxLength: 24 })),
        outputFormat: Type.Optional(
          Type.String({ minLength: 1, maxLength: 16 }),
        ),
        outputCompression: Type.Optional(
          Type.Number({ minimum: 0, maximum: 100 }),
        ),
        seed: Type.Optional(Type.Number({ minimum: 0 })),
        watermark: Type.Optional(Type.Boolean()),
        promptEnhancement: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  ),
  targetPosition: MediaPositionSchema,
};
const MediaInlineImageSchema = Type.Object({
  mimeType: Type.Literal("image/png"),
  data: Type.String({ minLength: 1, maxLength: 70_000_000 }),
});

export const StartMediaOperationSchema = Type.Union([
  Type.Object({
    ...MediaProviderRequestBase,
    action: Type.Union([
      Type.Literal("generate"),
      Type.Literal("regenerate"),
      Type.Literal("variation"),
    ]),
  }),
  Type.Object({
    ...MediaProviderRequestBase,
    action: Type.Union([
      Type.Literal("local-edit"),
      Type.Literal("remove-object"),
    ]),
    mask: MediaInlineImageSchema,
  }),
  Type.Object({
    ...MediaProviderRequestBase,
    action: Type.Literal("remove-background"),
    preserveSubject: Type.Union([
      Type.Literal("object"),
      Type.Literal("person"),
    ]),
  }),
  Type.Object({
    ...MediaProviderRequestBase,
    action: Type.Literal("multi-view"),
    views: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        label: Type.String({ minLength: 1, maxLength: 80 }),
        yaw: Type.Number({ minimum: -180, maximum: 180 }),
        pitch: Type.Number({ minimum: -90, maximum: 90 }),
      }),
      { minItems: 1, maxItems: 8 },
    ),
  }),
  Type.Object({
    sessionId: Type.String({ minLength: 1 }),
    action: Type.Literal("crop"),
    sourceAssetId: Type.String({ minLength: 1 }),
    crop: Type.Object({
      x: Type.Number({ minimum: 0, maximum: 1 }),
      y: Type.Number({ minimum: 0, maximum: 1 }),
      width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
      height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    }),
    image: MediaInlineImageSchema,
    targetPosition: MediaPositionSchema,
  }),
]);

export const ImportMediaImagesSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  sourcePaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
    minItems: 1,
    maxItems: 16,
  }),
  targetPosition: MediaPositionSchema,
});
export const DuplicateMediaAssetSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  assetId: Type.String({ minLength: 1 }),
  targetPosition: MediaPositionSchema,
});
export const DeleteMediaAssetSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  assetId: Type.String({ minLength: 1 }),
});
export const UpdateMediaLayoutSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  assets: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      x: Type.Number(),
      y: Type.Number(),
      width: Type.Number({ minimum: 160, maximum: 720 }),
      height: Type.Number({ minimum: 120, maximum: 720 }),
    }),
    { maxItems: 2_048 },
  ),
  viewport: Type.Optional(Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    zoom: Type.Number({ minimum: 0.1, maximum: 3 }),
  })),
});
export const UpdateMediaViewportSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  viewport: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    zoom: Type.Number({ minimum: 0.1, maximum: 3 }),
  }),
});
export const SetMediaCoverSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  assetId: Type.String({ minLength: 1 }),
});
export const CancelMediaOperationSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
});

export type ModelReferenceDto = Static<typeof ModelReferenceSchema>;
export type SessionDraftDto = Static<typeof SessionDraftSchema>;
export type SessionAccessLevelDto = Static<typeof SessionAccessLevelSchema>;
export type CreateWorkspaceDto = Static<typeof CreateWorkspaceSchema>;
export type OpenWorkspaceDto = Static<typeof OpenWorkspaceSchema>;
export type OpenExternalUrlDto = Static<typeof OpenExternalUrlSchema>;
export type CreateAndPromptDto = Static<typeof CreateAndPromptSchema>;
export type PromptSessionDto = Static<typeof PromptSessionSchema>;
export type RetrySessionTurnDto = Static<typeof RetrySessionTurnSchema>;
export type SelectSessionTurnVersionDto = Static<
  typeof SelectSessionTurnVersionSchema
>;
export type CompactSessionDto = Static<typeof CompactSessionSchema>;
export type SessionHistoryPageRequestDto = Static<
  typeof SessionHistoryPageRequestSchema
>;
export type SessionMessageSearchRequestDto = Static<
  typeof SessionMessageSearchRequestSchema
>;
export type SessionToolOutputRequestDto = Static<
  typeof SessionToolOutputRequestSchema
>;
export type WorkspaceFileRequestDto = Static<typeof WorkspaceFileRequestSchema>;
export type ListWorkspaceDirectoryDto = Static<
  typeof ListWorkspaceDirectorySchema
>;
export type ResolveOperationApprovalDto = Static<
  typeof ResolveOperationApprovalSchema
>;
export type ResolveUserRequestDto = Static<typeof ResolveUserRequestSchema>;
export type RenameSessionDto = Static<typeof RenameSessionSchema>;
export type SetSessionPinnedDto = Static<typeof SetSessionPinnedSchema>;
export type DeleteSessionDto = Static<typeof DeleteSessionSchema>;
export type DeleteSessionsDto = Static<typeof DeleteSessionsSchema>;
export type SetSessionModelDto = Static<typeof SetSessionModelSchema>;
export type SetSessionAccessDto = Static<typeof SetSessionAccessSchema>;
export type SetPreferenceDto = Static<typeof SetPreferenceSchema>;
export type UsageReportQueryDto = Static<typeof UsageReportQuerySchema>;
export type SetExtensionEnabledDto = Static<typeof SetExtensionEnabledSchema>;
export type UpdateExtensionSettingsDto = Static<
  typeof UpdateExtensionSettingsSchema
>;
export type SessionExtensionInteractionDto = Static<
  typeof SessionExtensionInteractionSchema
>;
export type SetSessionExtensionStateDto = Static<
  typeof SetSessionExtensionStateSchema
>;
export type SaveCustomProviderDto = Static<typeof SaveCustomProviderSchema>;
export type SetEnabledModelDto = Static<typeof SetEnabledModelSchema>;
export type SaveBuiltinCredentialDto = Static<
  typeof SaveBuiltinCredentialSchema
>;
export type SaveProviderConfigurationDto = Static<
  typeof SaveProviderConfigurationSchema
>;
export type DiscoverProviderModelsDto = Static<
  typeof DiscoverProviderModelsSchema
>;
export type SetConfiguredModelEnabledDto = Static<
  typeof SetConfiguredModelEnabledSchema
>;
export type DeleteCustomProviderDto = Static<typeof DeleteCustomProviderSchema>;
export type MediaProjectDto = Static<typeof MediaProjectSchema>;
export type CreateMediaProjectDto = Static<typeof CreateMediaProjectSchema>;
export type MediaProjectRequestDto = Static<typeof MediaProjectRequestSchema>;
export type StartMediaOperationDto = Static<typeof StartMediaOperationSchema>;
export type ImportMediaImagesDto = Static<typeof ImportMediaImagesSchema>;
export type DuplicateMediaAssetDto = Static<typeof DuplicateMediaAssetSchema>;
export type DeleteMediaAssetDto = Static<typeof DeleteMediaAssetSchema>;
export type UpdateMediaLayoutDto = Static<typeof UpdateMediaLayoutSchema>;
export type SetSkillEnabledDto = Static<typeof SetSkillEnabledSchema>;
export type RemoveManagedSkillDto = Static<typeof RemoveManagedSkillSchema>;
export type ImportSkillFileDto = Static<typeof ImportSkillFileSchema>;
export type ConnectorConfigurationDto = Static<
  typeof ConnectorConfigurationSchema
>;
export type ConnectorIdDto = Static<typeof ConnectorIdSchema>;
export type SetConnectorEnabledDto = Static<typeof SetConnectorEnabledSchema>;
export type SetSessionConnectorsDto = Static<typeof SetSessionConnectorsSchema>;
export type ConnectorPromptDto = Static<typeof ConnectorPromptSchema>;

export interface AppSnapshot {
  preferences: AppPreferences;
  entries: WorkbenchEntryDefinition[];
  workspaces: WorkspaceRecord[];
  sessions: SessionRecord[];
  runningSessionIds: string[];
  connections: ProviderConnectionRecord[];
  models: EnabledModelRecord[];
  modelConfiguration: ModelConfigurationSnapshot;
  security: SecurityPolicySnapshot;
  extensions: AgentExtensionSnapshot;
  skills: SkillCatalogSnapshot;
  connectors: ConnectorCatalogSnapshot;
  mediaProjects: MediaProjectSummary[];
  experts: ExpertSummary[];
}

export type {
  MediaLayoutUpdate,
  MediaViewportUpdate,
  MediaOperationRequest,
  MediaProject,
  MediaProjectSummary,
};
export type { UsageReport };

export interface SessionSnapshot {
  session: SessionRecord;
  messages: ConversationMessage[];
  contextUsage?: SessionContextUsage;
  turnUsage?: SessionTurnUsage;
  contextCompactions: ContextCompactionRecord[];
  isRunning: boolean;
  modelRetry?: ModelRetryState;
  isCompacting: boolean;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  compactionError?: string;
  extensions: AgentExtensionSessionState[];
  toolApprovalMode: ToolApprovalMode;
  expertCollaboration?: ExpertCollaborationSnapshot;
  /**
   * Retry version information keyed by user message id. Present only for turns
   * whose assistant response has more than one version.
   */
  turnVersions?: Record<string, { active: number; total: number }>;
}

export type ExpertCollaborationStatus =
  | "queued"
  | "running"
  | "awaiting-approval"
  | "awaiting-user-input"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "blocked"
  | "skipped";

export interface ExpertMemberLiveMessage {
  memberId: string;
  taskId: string;
  message: ConversationMessage;
  revision: number;
}

export type ExpertTaskPhase =
  | "queued"
  | "thinking"
  | "tool"
  | "approval"
  | "user-input"
  | "finished";

export interface ExpertCollaborationMember {
  memberId: string;
  name: string;
  portrait: ExpertPortrait;
  executionProfile: SessionExpertTeamMemberSnapshot["executionProfile"];
  latestStatus: ExpertCollaborationStatus;
  phase?: ExpertTaskPhase;
  startedAt?: number;
  updatedAt?: number;
  activeToolName?: string;
  blockedByTaskId?: string;
  terminalReason?: string;
  taskCount: number;
  lastActiveAt: number;
}

export interface ExpertCollaborationLeader {
  expertId: string;
  name: string;
  portrait: ExpertPortrait;
}

export interface ExpertCollaborationSnapshot {
  teamId: string;
  teamName: string;
  teamPortrait: ExpertPortrait;
  leader: ExpertCollaborationLeader;
  members: ExpertCollaborationMember[];
}

export interface SessionHistoryTurn {
  id: string;
  anchorMessageId: string;
  messages: ConversationMessage[];
  timestamp: number;
  /**
   * Present when the turn has more than one assistant response version, i.e.
   * the response was retried. `active` is 1-based.
   */
  versions?: SessionHistoryTurnVersions;
}

export interface SessionHistoryTurnVersions {
  active: number;
  total: number;
}

export type SessionHistoryTimelineItem =
  | { type: "turn"; turn: SessionHistoryTurn }
  | { type: "compaction"; compaction: ContextCompactionRecord };

export interface SessionTurnSummary {
  excerpt: string;
  messageId: string;
  ordinal: number;
  timestamp: number;
  tokens: number;
  turnId: string;
}

export interface SessionHistoryPage {
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  items: SessionHistoryTimelineItem[];
  nextAfterCursor?: string;
  nextBeforeCursor?: string;
  revision: string;
}

export interface SessionHistoryPageRequest {
  after?: string;
  aroundTurnId?: string;
  before?: string;
  limit?: number;
}

export type SessionMessageSearchRole = "user" | "assistant";

export interface SessionMessageSearchRequest {
  limit?: number;
  query: string;
  role?: SessionMessageSearchRole;
}

export interface SessionMessageSearchResult {
  matchEnd: number;
  matchStart: number;
  messageId: string;
  role: SessionMessageSearchRole;
  snippet: string;
  timestamp: number;
  turnId: string;
}

export interface SessionMessageSearchResponse {
  results: SessionMessageSearchResult[];
  total: number;
  truncated: boolean;
}

export interface SessionViewSnapshot {
  compactionError?: string;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  contextUsage?: SessionContextUsage;
  extensions: AgentExtensionSessionState[];
  history: SessionHistoryPage;
  isCompacting: boolean;
  isRunning: boolean;
  modelRetry?: ModelRetryState;
  session: SessionRecord;
  turnSummaries: SessionTurnSummary[];
  turnUsage?: SessionTurnUsage;
  toolApprovalMode: ToolApprovalMode;
  expertCollaboration?: ExpertCollaborationSnapshot;
}

export interface SessionWorkspaceSummary {
  id: string | null;
  name: string;
  available: boolean;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
  mtimeMs: number;
}

export interface SessionArtifactFile {
  path: string;
  name: string;
  kind: "created" | "modified";
  diffAvailable: boolean;
}

export interface SessionContextSnapshot {
  workspace: SessionWorkspaceSummary | null;
  artifacts: SessionArtifactFile[];
  changes: SessionArtifactFile[];
}

export interface SessionArtifactProducer {
  kind: "primary" | "expert-member" | "builtin-subagent";
  id?: string;
  name: string;
  portrait?: ExpertPortrait;
}

export interface SessionGeneratedArtifact {
  id: string;
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  previewKind: "text" | "markdown" | "image" | "external";
  producer: SessionArtifactProducer;
  group: "primary" | "shared" | string;
}

export interface SessionArtifactsSnapshot {
  revision: string;
  artifacts: SessionGeneratedArtifact[];
}

export type SessionArtifactPreview =
  | {
      status: "available";
      kind: "text";
      name: string;
      content: string;
    }
  | {
      status: "available";
      kind: "image";
      name: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      data: string;
    }
  | {
      status: "unavailable";
      reason: "binary" | "missing" | "too-large" | "unsupported";
    };

export type ArtifactKind =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "browser"
  | "report"
  | "dataset"
  | "chart"
  | "image";

export interface DataAnalysisCapabilitySnapshot {
  status: "ready" | "missing" | "error";
  command: string | null;
  version: string | null;
  message?: string;
  supportedFormats: string[];
  dependencies?: Record<string, boolean>;
}

export type AnalysisResearchMode = "quick" | "normal" | "heavy";
export type AnalysisResearchStatus =
  | "not-needed"
  | "awaiting-confirmation"
  | "blocked"
  | "researching"
  | "reviewing"
  | "ready"
  | "failed";

export interface AnalysisResearchSource {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  accessedAt: number;
  snapshotPath: string | null;
  contentHash: string | null;
  sourceType: "web" | "academic" | "filing" | "workspace" | "other";
}

export interface AnalysisResearchClaim {
  id: string;
  dimensionId: string;
  statement: string;
  kind: "external" | "synthesis";
  evidenceRefs: string[];
  confidence: "high" | "medium" | "low" | "contested";
  caveats: string[];
}

export interface AnalysisResearchDimension {
  id: string;
  name: string;
  question: string;
  status: "planned" | "researching" | "ready" | "needs-research" | "failed";
  claimCount: number;
  sourceCount: number;
  review?: { verdict: "pass" | "revise"; notes: string[] };
}

export interface AnalysisResearchState {
  researchId: string;
  status: AnalysisResearchStatus;
  mode: AnalysisResearchMode | null;
  objective: string | null;
  questions: string[];
  dimensions: AnalysisResearchDimension[];
  sources: AnalysisResearchSource[];
  claims: AnalysisResearchClaim[];
  conflicts: string[];
  sourceCount: number;
  completedDimensions: number;
  updatedAt: number;
  blockedReason?: string;
  error?: string;
}

export interface AnalysisDatasetSummary {
  path: string;
  name: string;
  format: string;
  size: number;
  fingerprint: string;
  datasets: Array<{
    name: string;
    rows: number;
    columns: Array<{
      name: string;
      inferredType: string;
      nullCount: number | null;
    }>;
    sample: Array<Record<string, unknown>>;
    warnings: string[];
  }>;
  warnings: string[];
}

export interface AnalysisChartSummary {
  id: string;
  title: string;
  path: string;
  mimeType: "image/png" | "image/svg+xml";
  url: string;
}

export interface AnalysisOutputFile {
  path: string;
  name: string;
  kind: "report" | "manifest" | "chart" | "script" | "data" | "other";
  size: number;
  updatedAt: number;
}

export interface AnalysisRunDescriptor {
  id: string;
  sessionId: string;
  title: string;
  status: "inspecting" | "working" | "validated" | "published" | "failed";
  outputRoot: string;
  reportPath: string | null;
  reportContent: string | null;
  datasets: AnalysisDatasetSummary[];
  charts: AnalysisChartSummary[];
  files: AnalysisOutputFile[];
  errors: string[];
  warnings: string[];
  research?: AnalysisResearchState;
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisSessionSnapshot {
  sessionId: string;
  capabilities: DataAnalysisCapabilitySnapshot;
  runs: AnalysisRunDescriptor[];
}

export interface ArtifactDescriptor {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  sourcePath: string;
  displayName: string;
  mimeType: string;
  revision: number;
  status: "creating" | "ready" | "updating" | "failed";
  capabilities: Array<"preview" | "select" | "validate" | "export" | "open">;
  quality?: ArtifactQualitySummary;
  updatedAt: number;
}

export interface ArtifactQualitySummary {
  revision: number;
  status: "draft" | "needs-review" | "needs-fix" | "ready";
  cycle: number;
  totalSlides: number;
  reviewedSlides: number;
  issueCount: number;
  checkedAt: number;
}

export interface ArtifactIssue {
  severity: "warning" | "error";
  message: string;
  locator?: string;
  code?: string;
  category?: "schema" | "format" | "content" | "structure" | "visual";
  surfaceId?: string;
  suggestion?: string;
}

export interface ArtifactPreviewSurface {
  id: string;
  kind: "slide" | "page" | "sheet" | "browser-frame";
  label: string;
  thumbnailUrl?: string;
}

export interface ArtifactPreviewManifest {
  artifactId: string;
  revision: number;
  htmlUrl?: string;
  watchUrl?: string;
  surfaces: ArtifactPreviewSurface[];
  issues: ArtifactIssue[];
}

export interface ArtifactSelection {
  artifactId: string;
  kind: ArtifactKind;
  revision: number;
  surfaceId: string;
  locator: string;
  label: string;
  locators?: string[];
  intent?: "reference" | "analyze" | "formula" | "chart" | "pivot";
}

export interface SpreadsheetSelectionRange {
  sheetName: string;
  range: string;
  locator: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetSelection extends ArtifactSelection {
  paths: string[];
  ranges: SpreadsheetSelectionRange[];
  elements: string[];
  selectionKind: "range" | "multi-range" | "elements" | "mixed";
  sheetName?: string;
  range?: string;
  rowCount?: number;
  columnCount?: number;
  displayValue?: string;
  formula?: string;
}

export interface SpreadsheetCapabilitySnapshot {
  version: string;
  elements: string[];
  highLevelTools: string[];
}

export interface SpreadsheetRangeProfile {
  artifactId: string;
  revision: number;
  sheetName: string;
  range: string;
  rowCount: number;
  columnCount: number;
  populatedCells: number;
  blankCells: number;
  numericCells: number;
  duplicateValues: number;
  minimum?: number;
  maximum?: number;
  average?: number;
}

export interface SpreadsheetChangeRecord {
  revision: number;
  updatedAt: number;
  operations: Array<{
    command: string;
    locator?: string;
    elementType?: string;
  }>;
}

export interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface OfficeEngineHealth {
  status: "ready" | "missing" | "error";
  version?: string;
  message?: string;
  bundled: boolean;
}

/** 命令解释器的种类。宿主用它向用户说清"现在跑的是什么"。 */
export type HostShellKind = "pwsh" | "powershell" | "cmd" | "bash" | "sh" | "other";

/**
 * 这个运行时从哪来。
 *
 * `wordless` = 用的是 Wordless 内置的那份(Node 走 Electron 自带的,Python 走打包进来的
 * python-build-standalone)。两边的差别对用户是可感的 —— Node 那份没有 npm、Python 那份不带第三方包
 * —— 所以要能说清。
 */
export type HostRuntimeSource = "system" | "wordless" | "none";

export type HostPythonDependency = "openpyxl" | "pyarrow" | "pandas";

/**
 * 宿主环境的事实(设置 → 环境面板读它,命令工具的失败提示由它派生)。
 *
 * 只有事实,没有建议:装什么、去哪装是界面的事(见 docs/architecture/host-environment.md)。
 */
/**
 * 本地文字识别的状态。
 *
 * `available: false` **不是错误**:构建时可以不带 OCR 资产(`WORDLESS_SKIP_OCR=1`),这时界面
 * 该如实说"未就绪",而不是显示一个失败。
 */
export interface HostOcrStatus {
  available: boolean;
  /** 形如 `ppocrv5`;未就绪时为 null。 */
  modelSet: string | null;
  /** 一句话说明,直接给界面用。 */
  detail: string;
}

export interface HostEnvironmentFacts {
  platform: string;
  shell: { kind: HostShellKind; executable: string } | null;
  node: { found: boolean; version?: string; source: HostRuntimeSource };
  python: {
    found: boolean;
    version?: string;
    executable?: string;
    source: HostRuntimeSource;
    packages: Record<HostPythonDependency, boolean>;
  };
  /**
   * 文字识别。
   *
   * 它和 shell/node/python 不是一类东西(那三样是"能不能跑"),但对用户是同一个问题:"这台机器
   * 上 agent 能做什么"。所以放在同一份事实里,界面一屏说完。
   *
   * **可选**:`HostEnvironmentService` 只负责探测 shell/node/python,OCR 状态由 IPC 边界合成
   * (两个服务各自独立)。没有这个字段 = 这一版没有文字识别。
   */
  ocr?: HostOcrStatus;
  probedAt: number;
}

/** 按需安装第三方包的结果(面板要显示成功/失败与原因)。 */
export interface HostPythonProvisionResult {
  ok: boolean;
  /** 这次真的装了哪些包(已经装好时为[])。 */
  installed: string[];
  message?: string;
}

export type SessionWorkspaceTextFile =
  | { status: "available"; path: string; name: string; content: string }
  | { status: "unavailable"; reason: "binary" | "missing" | "too-large" };

export type SessionArtifactDiff =
  | { status: "available"; path: string; patch: string }
  | {
      status: "unavailable";
      reason: "baseline-missing" | "binary" | "missing" | "too-large";
    };

export type RuntimeEvent =
  | { type: "preferences.changed" }
  | { type: "skills.changed" }
  | { type: "experts.changed" }
  | { type: "connectors.changed" }
  | { type: "model-configuration.changed" }
  | {
      type: "media.project.changed";
      sessionId: string;
      source?: "viewport" | "layout" | "asset";
    }
  | { type: "automation.changed"; id?: string }
  | { type: "automation-run.changed"; id?: string }
  | { type: "task.changed"; id: string }
  | {
      type: "artifact.changed";
      artifactId: string;
      kind: ArtifactKind;
      revision: number;
      affectedLocators: string[];
    }
  | { type: "session.artifacts.changed"; revision: string; count: number }
  | { type: "run.started"; runId: string }
  | { type: "run.completed"; runId: string }
  | { type: "run.failed"; runId: string; message: string }
  | { type: "run.cancelled"; runId: string }
  | {
      type: "context.compaction.started";
      trigger: ContextCompactionRecord["trigger"];
    }
  | {
      type: "context.compaction.completed";
      compaction: ContextCompactionRecord;
      recoveredFailureMessageId?: string;
    }
  | {
      type: "context.compaction.failed";
      trigger: ContextCompactionRecord["trigger"];
      message: string;
    }
  | { type: "context.usage.updated"; contextUsage: SessionContextUsage }
  | { type: "message.started"; message: ConversationMessage }
  | { type: "message.text.delta"; messageId: string; delta: string }
  | { type: "message.reasoning.delta"; messageId: string; delta: string }
  | { type: "message.completed"; message: ConversationMessage }
  | { type: "model.retry.scheduled"; retry: ModelRetryState }
  | {
      type: "model.retry.started";
      attempt: number;
      maxRetries: number;
    }
  | {
      type: "expert-member.message.started";
      memberId: string;
      taskId: string;
      message: ConversationMessage;
      revision: number;
    }
  | {
      type: "expert-member.message.text.delta";
      memberId: string;
      taskId: string;
      messageId: string;
      delta: string;
      revision: number;
    }
  | {
      type: "expert-member.message.reasoning.delta";
      memberId: string;
      taskId: string;
      messageId: string;
      delta: string;
      revision: number;
    }
  | {
      type: "expert-member.message.completed";
      memberId: string;
      taskId: string;
      message: ConversationMessage;
      revision: number;
    }
  | {
      type: "expert-member.tool.started";
      memberId: string;
      taskId: string;
      messageId: string;
      callId: string;
      name: string;
      input: Record<string, unknown>;
      source?: MessageToolSource;
    }
  | {
      type: "expert-member.tool.updated";
      memberId: string;
      taskId: string;
      messageId: string;
      callId: string;
      output: string;
      details?: unknown;
      source?: MessageToolSource;
    }
  | {
      type: "expert-member.tool.completed";
      memberId: string;
      taskId: string;
      messageId: string;
      callId: string;
      output: string;
      details?: unknown;
      isError: boolean;
      source?: MessageToolSource;
    }
  | {
      type: "expert-member.approval.requested";
      memberId: string;
      taskId: string;
      messageId: string;
      approval: {
        approvalId: string;
        callId: string;
        toolName: string;
        input: Record<string, unknown>;
        risk: ToolOperationApproval["risk"];
        severity: ToolOperationApproval["severity"];
        summary: string;
        preview: ToolOperationApproval["preview"];
        matchedRules: ToolOperationApproval["matchedRules"];
        requiresElevation?: boolean;
      };
    }
  | {
      type: "expert-member.approval.resolved";
      memberId: string;
      taskId: string;
      messageId: string;
      resolution: { approvalId: string; approved: boolean; feedback?: string };
    }
  | {
      type: "tool.started";
      messageId: string;
      callId: string;
      name: string;
      input: Record<string, unknown>;
      source?: MessageToolSource;
    }
  | {
      type: "tool.updated";
      messageId: string;
      callId: string;
      output: string;
      details?: unknown;
      usage?: ConversationUsage;
      source?: MessageToolSource;
    }
  | {
      type: "tool.completed";
      messageId: string;
      callId: string;
      output: string;
      details?: unknown;
      usage?: ConversationUsage;
      isError: boolean;
      source?: MessageToolSource;
    }
  | {
      type: "approval.requested";
      messageId: string;
      approval: {
        approvalId: string;
        callId: string;
        toolName: string;
        input: Record<string, unknown>;
        risk: ToolOperationApproval["risk"];
        severity: ToolOperationApproval["severity"];
        summary: string;
        preview: ToolOperationApproval["preview"];
        matchedRules: ToolOperationApproval["matchedRules"];
        requiresElevation?: boolean;
      };
    }
  | {
      type: "approval.resolved";
      messageId: string;
      resolution: { approvalId: string; approved: boolean; feedback?: string };
    }
  | { type: "user-request.requested"; messageId: string; request: UserRequest }
  | {
      type: "user-request.resolved";
      messageId: string;
      resolution: UserRequestResolution;
    }
  /**
   * The set of sessions changed — one was created or removed.
   *
   * Distinct from the run events: those describe what a session is doing, this says
   * the list itself is different. The renderer's snapshot is the only place the
   * sidebar reads sessions from, and a session created by the *host* (an automation
   * or a task) has no other way to reach it — the renderer refreshes after its own
   * mutations, so a host-created session used to stay invisible until some unrelated
   * event happened to refresh the snapshot.
   */
  | { type: "sessions.changed" }
  | { type: "model.changed"; model: ModelReference }
  | { type: "extension.event"; event: AgentExtensionEvent }
  | { type: "session.idle" };

export interface RuntimeEventEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  runtimeInstanceId: string;
  eventId: string;
  sessionId: string | null;
  runId?: string;
  turnId?: string;
  sequence: number;
  timestamp: number;
  event: RuntimeEvent;
}

/// Message push (group-robot webhooks)
///
/// Wire shapes for the Settings page only. The agent-facing side is a capability
/// that runs in the main process and calls the manager through a port, so it
/// needs no IPC — which also means the renderer cannot ask the host to read an
/// arbitrary file path as an attachment.
///
/// Inputs are validated at the boundary with `additionalProperties: false`: a
/// typo in the renderer should fail loudly rather than be dropped by
/// normalisation and turn into a setting that silently never applies.

export const WebhookKindSchema = Type.Union([
  Type.Literal("feishu"),
  Type.Literal("dingtalk"),
  Type.Literal("wecom"),
]);

export const WebhookMessageLevelSchema = Type.Union([
  Type.Literal("info"),
  Type.Literal("warn"),
  Type.Literal("error"),
  Type.Literal("success"),
]);

/**
 * Opaque to the wire. Each provider owns a schema for its own slice, so adding a
 * channel does not change this file.
 */
export const WebhookOptionsSchema = Type.Record(Type.String(), Type.Unknown());

export const WebhookAttachmentSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal("image"), Type.Literal("file")]),
    sizeBytes: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const WebhookCredentialFieldSchema = Type.Object(
  {
    key: Type.Union([Type.Literal("url"), Type.Literal("signSecret")]),
    required: Type.Boolean(),
    urlHint: Type.Optional(Type.String()),
    secret: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const WebhookProviderCapabilitiesSchema = Type.Object(
  {
    supportsSign: Type.Boolean(),
    supportsImage: Type.Boolean(),
    supportsFile: Type.Boolean(),
    supportsMentionAll: Type.Boolean(),
    supportsMentionByMobile: Type.Boolean(),
    maxTextBytes: Type.Number({ minimum: 1 }),
    /** Only for platforms whose documented limit is in characters (DingTalk). */
    maxTextChars: Type.Optional(Type.Number({ minimum: 1 })),
    maxTitleBytes: Type.Number({ minimum: 1 }),
    maxMessagesPerMinute: Type.Optional(Type.Number({ minimum: 1 })),
    supportsMarkdown: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Drives the form: the page renders fields from this and never branches on kind. */
export const WebhookProviderDescriptorSchema = Type.Object(
  {
    kind: WebhookKindSchema,
    iconClass: Type.Optional(Type.String()),
    credentialFields: Type.Array(WebhookCredentialFieldSchema),
    capabilities: WebhookProviderCapabilitiesSchema,
  },
  { additionalProperties: false },
);

export const WebhookEndpointPublicSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: WebhookKindSchema,
    name: Type.String(),
    enabled: Type.Boolean(),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    urlMask: Type.Optional(Type.String()),
    hasSignSecret: Type.Boolean(),
    options: WebhookOptionsSchema,
  },
  { additionalProperties: false },
);

export const WebhookCreateInputSchema = Type.Object(
  {
    kind: WebhookKindSchema,
    name: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    signSecret: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    options: Type.Optional(WebhookOptionsSchema),
  },
  { additionalProperties: false },
);

/**
 * `url` and `signSecret` are optional so saving an unrelated field never requires
 * the secret to travel back down to the renderer. An explicit empty string clears
 * the secret; omitting it keeps the stored one.
 */
export const WebhookUpdatePatchSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1 })),
    url: Type.Optional(Type.String({ minLength: 1 })),
    signSecret: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    options: Type.Optional(WebhookOptionsSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const WebhookIdRequestSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/**
 * An update is `{ id, patch }` rather than a flattened `{ id, ...patch }`.
 *
 * The flattened form is what shipped first, and it was broken for every call:
 * the handler validated the whole payload against the *patch* schema, which has
 * `additionalProperties: false` and therefore rejected `id`. Nesting the patch
 * means the patch schema is reused verbatim, so the two shapes cannot drift apart
 * again — a flat envelope duplicates the field list and nothing checks it.
 */
export const WebhookUpdateRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    patch: WebhookUpdatePatchSchema,
  },
  { additionalProperties: false },
);

export const WebhookSetEnabledRequestSchema = Type.Object(
  { id: Type.String({ minLength: 1 }), enabled: Type.Boolean() },
  { additionalProperties: false },
);

/**
 * The test message comes *from the renderer* so the main process needs no copy
 * table: it runs scheduled work with no window, and a locale-dependent string
 * table on this side would be one more thing to keep in sync.
 */
export const WebhookTestRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    message: Type.Object(
      {
        title: Type.Optional(Type.String()),
        text: Type.String({ minLength: 1 }),
        level: Type.Optional(WebhookMessageLevelSchema),
        attachments: Type.Optional(Type.Array(WebhookAttachmentSchema)),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type WebhookCreateInputDto = Static<typeof WebhookCreateInputSchema>;
export type WebhookUpdatePatchDto = Static<typeof WebhookUpdatePatchSchema>;
export type WebhookUpdateRequestDto = Static<typeof WebhookUpdateRequestSchema>;
export type WebhookIdRequestDto = Static<typeof WebhookIdRequestSchema>;
export type WebhookSetEnabledRequestDto = Static<typeof WebhookSetEnabledRequestSchema>;
export type WebhookTestRequestDto = Static<typeof WebhookTestRequestSchema>;

export type NotificationDefaultsDto = Static<typeof NotificationDefaultsSchema>;
export type NotificationDefaultsPatchDto = Static<typeof NotificationDefaultsPatchSchema>;
export type NotificationSubscriptionDto = Static<typeof NotificationSubscriptionSchema>;

/* ── 设计画布 ─────────────────────────────────────────────────────────────── */

export const DesignModeSchema = Type.Union([Type.Literal("static"), Type.Literal("built")]);

export const DesignCanvasSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), zoom: Type.Number({ minimum: 0.05 }) },
  { additionalProperties: false },
);

export const DesignSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    mode: DesignModeSchema,
    style: Type.Union([Type.String(), Type.Null()]),
    frameCount: Type.Number({ minimum: 0 }),
    /**
     * 最近改动时间(毫秒时间戳)。画廊按它倒序 —— "继续昨天那份"比"翻一个月前那份"常见得多,
     * 而它只能从磁盘上算(见 `design-store` 的 `latestModified`)。
     */
    updatedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DesignFrameSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    file: Type.String({ minLength: 1 }),
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 1 }),
    height: Type.Number({ minimum: 1 }),
    title: Type.String(),
  },
  { additionalProperties: false },
);

export const DesignManifestSchema = Type.Object(
  {
    version: Type.Literal(1),
    type: Type.Literal("wordless-design"),
    canvas: DesignCanvasSchema,
    mode: DesignModeSchema,
    style: Type.Union([Type.String(), Type.Null()]),
    defaultFrameSize: Type.Optional(
      Type.Object({ width: Type.Number({ minimum: 1 }), height: Type.Number({ minimum: 1 }) }, { additionalProperties: false }),
    ),
    frames: Type.Array(DesignFrameSchema),
  },
  { additionalProperties: false },
);

export const DesignOpenedSchema = Type.Object(
  {
    summary: DesignSummarySchema,
    manifest: DesignManifestSchema,
    /** 解析或与磁盘对账时发生过修复,且已回写。 */
    repaired: Type.Boolean(),
    /**
     * frameId → 帧 URL。
     *
     * 由主进程生成而不是渲染层拼:URL 里那个 id 是不透明标识,渲染层不该知道它的构造
     * 规则,更不该有机会拼出一个指向别处的地址。
     */
    frameUrls: Type.Record(Type.String(), Type.String()),
  },
  { additionalProperties: false },
);

export const DesignListRequestSchema = Type.Object(
  { root: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const DesignOpenRequestSchema = Type.Object(
  { path: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/**
 * 样式表与源是否同步。
 *
 * `built` 模式的 `dist/theme.css` **只能由一次构建产出**(同步渲染根时会刻意跳过它),所以
 * "样式新不新"是一个必须能回答的问题 —— 答不出来的后果不是"难看一点",是**一帧样式都不
 * 生效**,而它在界面上与"设计还没做完"长得一模一样。
 *
 * - `never` 这份设计还没有过成功的构建(新包,或构建从未跑起来)
 * - `fresh` 上次构建之后源没变过
 * - `stale` 源变了、构建还没跟上(新增的工具类此刻**还不存在**)
 * - `failed` 构建跑过但失败了,`detail` 是原因
 */
export const DesignStylesStatusSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("never"),
      Type.Literal("fresh"),
      Type.Literal("stale"),
      Type.Literal("failed"),
    ]),
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * 让一份设计回到当前磁盘状态。
 *
 * 这是画布的**心跳**:渲染层每秒问一次,主进程用源指纹做短路,所以常态只有两次读、
 * 不起任何进程。它同时承载三件事 —— 新帧上画布、帧内容刷新、样式表重编 —— 因为这三件
 * 事的前提是同一个事实:源变了吗。
 */
export const DesignRefreshRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    /**
     * 用户按的刷新:越过主进程的最短间隔。
     *
     * 不给的话,一次手动刷新可能刚好落在限流窗口里而**静默什么都不做** —— 一个点了没反应的
     * 按钮比没有这个按钮更糟。(单飞仍然生效:构建正在跑时再叠一个不会让用户更快拿到结果。)
     */
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const DesignFrameMoveSchema = Type.Object(
  { frameId: Type.String({ minLength: 1 }), x: Type.Number(), y: Type.Number() },
  { additionalProperties: false },
);

export const DesignMoveFramesRequestSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), moves: Type.Array(DesignFrameMoveSchema, { minItems: 1 }) },
  { additionalProperties: false },
);

/**
 * 新建一个空白帧。
 *
 * 只带"想建成什么样"的三样:标题与尺寸都给默认值(设计的 `defaultFrameSize`),而**落点不在这里**
 * —— 新帧放到哪由主进程的对账规则决定(最右帧的右边、顶边对齐),在渲染层再算一遍就是第二份真相。
 */
export const CreateDesignFrameRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    /** 标题前缀。主进程会补上序号 —— 画布上唯一的标签就是标题,两帧同名等于没有标签。 */
    title: Type.Optional(Type.String({ maxLength: 120 })),
    width: Type.Optional(Type.Number({ minimum: 1 })),
    height: Type.Optional(Type.Number({ minimum: 1 })),
    /** 用户**在画布上画出来**的落点。不给就走自动布局(最右帧的右边)。 */
    x: Type.Optional(Type.Number()),
    y: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * 导出。
 *
 * 两件事共用一个入口,因为它们**只差在语料**:渲染图是现场光栅出来的 PNG,素材是设计包里
 * 已有的文件。而"用户挑一个目录、我们把东西放进去、把落点告诉他"这一整套是一样的。
 */
export const DesignExportRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    /**
     * `frames` = 只要各帧的渲染图;`assets` = 渲染图**加**规范与素材文件(整套交接)。
     *
     * **没有倍率参数。** 原来有一个 `scale`,而它是错的:倍数只能来自**设备像素比**,不是把
     * 窗口放大 —— 放大窗口会让页面按新视口重排,导出的图比页面大一圈、周边留白(实测)。
     * 而设备像素比在真实现里尚未生效,所以现在没有"2 倍导出"这件事可说 —— 留一个做不到的
     * 参数,比没有它更糟。
     */
    what: Type.Union([Type.Literal("frames"), Type.Literal("assets")]),
  },
  { additionalProperties: false },
);

export const DesignExportResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      /** 文件落在哪 —— 界面要把它说出来,否则用户不知道东西去哪了。 */
      directory: Type.String({ minLength: 1 }),
      files: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([
        /** 用户在对话框里取消了。**不是错误**,界面上不该报红。 */
        Type.Literal("cancelled"),
        /** 没有可导出的东西(设计一帧都没有、或者没有素材)。 */
        Type.Literal("empty"),
        /** 渲染/复制过程中出了问题。 */
        Type.Literal("failed"),
      ]),
      detail: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

/**
 * 把一套内置风格应用到已有设计上。
 *
 * 结果里的 `framesNeedRestyle` 是这个功能的**关键信息**:设计不能靠替换令牌机械改风格,所以
 * 应用之后已有帧要由 agent 按新规范重设 —— 用户必须知道这件事,否则他会以为画布没生效。
 */
export const ApplyDesignStyleRequestSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), styleId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const ApplyDesignStyleResultSchema = Type.Object(
  {
    framesNeedRestyle: Type.Boolean(),
    opened: DesignOpenedSchema,
  },
  { additionalProperties: false },
);

/** 删掉一帧。只删文件 —— 清单由对账更新,少一处可以写歪的地方。 */
export const DeleteDesignFrameRequestSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), frameId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/**
 * 改一帧的声明。**没给的字段保持原值。**
 *
 * 与上面的"移动"分开,因为它们落在**不同的地方**:位置进 `design.json`,而标题与尺寸写回
 * 帧源码里的 `@frame` 注释 —— 那是它们真正的家,清单里那份只是上次同步的快照。
 */
export const DesignFrameMetaSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 120 })),
    width: Type.Optional(Type.Number({ minimum: 1 })),
    height: Type.Optional(Type.Number({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const DesignUpdateFrameMetaRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    frameId: Type.String({ minLength: 1 }),
    meta: DesignFrameMetaSchema,
  },
  { additionalProperties: false },
);

export const DesignRasterFrameSchema = Type.Object(
  {
    frameId: Type.String({ minLength: 1 }),
    /** 位图缩放档位,来自 `DESIGN_CANVAS_BUDGETS.zoomBuckets`。 */
    bucket: Type.Number({ minimum: 0.01 }),
  },
  { additionalProperties: false },
);

export const DesignRasterRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    frames: Type.Array(DesignRasterFrameSchema, { minItems: 1, maxItems: 256 }),
  },
  { additionalProperties: false },
);

export const DesignLiveBoundsSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number({ minimum: 0 }), height: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

export const DesignLiveFrameRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    frameId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    /** 窗口坐标下的矩形。帧被隐藏时为 null。 */
    bounds: Type.Union([DesignLiveBoundsSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const DesignStyleSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    /**
     * 分类 **key**(`dev` / `playful` / …),不是展示串。
     *
     * 展示文案在渲染层 i18n 的 `designStyleCategory*`(见 `features/design/style-copy.ts`)——
     * 一条 DTO 不该决定某个语言下它该显示成什么。
     */
    category: Type.String(),
    vibe: Type.Union([Type.Literal("light"), Type.Literal("dark")]),
    tagline: Type.String(),
    /**
     * 完整的 `theme.css`。
     *
     * 带过来是为了让画廊卡片**用该风格自己的令牌**画缩略图 —— 那是单一真源,卡片再抽一次
     * 就不可能与它漂开。
     */
    themeCss: Type.String(),
    /**
     * 有没有整页示例。
     *
     * **示例正文不在这里**:一份 20-30KB,而列表每次进页都要拉。这里只带"有没有"这个事实,
     * 正文由 `styleDetail` 按 id 现取 —— 摘要就该是摘要。
     */
    hasDemo: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * 取一套风格的正文(示例页 + 规范)。按 id 现取。
 *
 * 为什么不塞进列表:一份示例 20-30KB、一份规范 2-6KB,而用户真正打开详情的次数远少于把风格墙
 * 拉起来的次数。列表里只留 `hasDemo` 这个事实。
 */
export const DesignStyleDetailRequestSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const DesignStyleDetailSchema = Type.Object(
  {
    /** 自包含的整页示例:令牌内联,无脚本无外链,直接进 `sandbox` 的 iframe。 */
    demoHtml: Type.String(),
    /** 完整的 `DESIGN.md`。详情里只用它列"规范写了哪几节";agent 侧读的也是同一份。 */
    designMd: Type.String(),
  },
  { additionalProperties: false },
);

export const CreateDesignRequestSchema = Type.Object(
  {
    root: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    /** 选中的内置风格;不选就只建一个带默认令牌的空包。 */
    styleId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/**
 * 建包后那次构建的结果。
 *
 * **失败必须能走到用户面前。** 构建失败时设计仍然建好了 —— 但那意味着画布上每一帧都是
 * "还没有产物"的占位卡,而用户看到的是一个空白画布加一句"新建成功",无从知道原因。
 */
export const DesignBuildOutcomeSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    {
      ok: Type.Literal(false),
      /** 失败分类(`DesignBuildResult` 的 code)。 */
      code: Type.String({ minLength: 1 }),
      /** 给人看的一句话,来自构建器的 `detail`。 */
      detail: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export const CreateDesignResultSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    frameId: Type.String({ minLength: 1 }),
    /** `null` = 这一侧没启用构建(而不是"构建没发生过")。 */
    build: Type.Union([DesignBuildOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const DesignRefreshResultSchema = Type.Object(
  {
    /** 源指纹。画布把它当作位图缓存的代号:变了就必须重新光栅。 */
    revision: Type.String({ minLength: 1 }),
    /** 源与上次应用过的指纹不一致(而不仅仅是"查过一遍")。 */
    changed: Type.Boolean(),
    /**
     * 这一次真的做了同步/构建,所以 `opened` 是当前的真实状态。
     *
     * 被限流或已经在刷新时为 false —— 那不是失败,下一次轮询会补上。区分的理由是画布
     * 要知道"该不该拿这个 `opened` 覆盖自己",而不是拿一个 `null` 去猜。
     */
    applied: Type.Boolean(),
    opened: Type.Union([DesignOpenedSchema, Type.Null()]),
    build: Type.Union([DesignBuildOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type DesignBuildOutcomeDto = Static<typeof DesignBuildOutcomeSchema>;
export type CreateDesignResultDto = Static<typeof CreateDesignResultSchema>;
export type DesignModeDto = Static<typeof DesignModeSchema>;
export type DesignCanvasDto = Static<typeof DesignCanvasSchema>;
export type DesignSummaryDto = Static<typeof DesignSummarySchema>;
export type DesignFrameDto = Static<typeof DesignFrameSchema>;
export type DesignManifestDto = Static<typeof DesignManifestSchema>;
export type DesignOpenedDto = Static<typeof DesignOpenedSchema>;
export type DesignListRequestDto = Static<typeof DesignListRequestSchema>;
export type DesignOpenRequestDto = Static<typeof DesignOpenRequestSchema>;
export type DesignFrameMoveDto = Static<typeof DesignFrameMoveSchema>;
export type DesignFrameMetaDto = Static<typeof DesignFrameMetaSchema>;
export type CreateDesignFrameRequestDto = Static<typeof CreateDesignFrameRequestSchema>;
export type DeleteDesignFrameRequestDto = Static<typeof DeleteDesignFrameRequestSchema>;
export type ApplyDesignStyleRequestDto = Static<typeof ApplyDesignStyleRequestSchema>;
export type ApplyDesignStyleResultDto = Static<typeof ApplyDesignStyleResultSchema>;
/**
 * 导出合成图的一次保存。
 *
 * 合成发生在**渲染层**(canvas 在那儿),所以字节是**渲染层 → 主进程**的方向。
 *
 * ## 为什么载荷是 base64 字符串,而不是 `Uint8Array`
 *
 * 这条通道要过 `contextBridge`(渲染层拿到的是 `window.wordless`,见 preload),而**类型化
 * 数组在这道桥上不可靠**:它可能被序列化成一个普通对象,也可能在调用点直接抛"无法克隆" ——
 * 两种表现在这里都是"点保存就失败"。
 *
 * 这不是猜的:这个 app 里所有过桥的字节都是 base64 字符串(`MediaInlineImage.data`,以及
 * preload 里把 `ArrayBuffer` 转成 `btoa(binary)` 的那处)。这里跟着同一套走。
 */
export const DESIGN_IMAGE_PAYLOAD_LIMIT = 64 * 1024 * 1024;

/** base64 形式的上限:原始字节上限按 4/3 换算,再加补齐的余量。 */
export const DESIGN_IMAGE_BASE64_MAX_LENGTH = Math.ceil((DESIGN_IMAGE_PAYLOAD_LIMIT * 4) / 3) + 4;

export const DesignSaveImageRequestSchema = Type.Object(
  {
    /** 建议的文件名(不含扩展名)。真正的落点由保存对话框决定。 */
    fileName: Type.String({ minLength: 1, maxLength: 120 }),
    extension: Type.Union([Type.Literal("png"), Type.Literal("pdf")]),
    /**
     * 图本身,**base64**(没有 `data:` 前缀)。理由见上面的载荷说明。
     *
     * 上限放在 schema 里(string 的 `maxLength`)是为了让"太大"在**进 handler 之前**就被拒:
     * base64 大约膨胀 1/3,所以按 4/3 换算。
     */
    data: Type.String({ minLength: 1, maxLength: DESIGN_IMAGE_BASE64_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const DesignSaveImageResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      /** 文件落在哪 —— 界面要把它说出来,否则用户不知道东西去哪了。 */
      path: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([
        /** 用户在对话框里取消了。**不是错误**,界面上不该报红。 */
        Type.Literal("cancelled"),
        /** 写盘失败(权限、磁盘满)。 */
        Type.Literal("failed"),
      ]),
      detail: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

/**
 * base64 载荷的守卫。仍然是 O(1):逐字符 walk 几 MB 的字符串是白花成本,而"非空 + 有上限"
 * 给的是同样的保证 —— 内容本身合不合法由解码那边兜底(解出来是一堆垃圾的话,写出来的文件
 * 打不开,那不是这一层能判的)。
 *
 * 上限按**原始字节**算,所以这里先换算回 base64 的长度(`4/3` 加上补齐的余量)。
 */
export function isDesignImagePayload(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DESIGN_IMAGE_BASE64_MAX_LENGTH
  );
}

export const DesignCopyImageRequestSchema = Type.Object(
  { data: Type.String({ minLength: 1, maxLength: DESIGN_IMAGE_BASE64_MAX_LENGTH }) },
  { additionalProperties: false },
);

export type DesignSaveImageRequestDto = Static<typeof DesignSaveImageRequestSchema>;
export type DesignCopyImageRequestDto = Static<typeof DesignCopyImageRequestSchema>;
export type DesignSaveImageResultDto = Static<typeof DesignSaveImageResultSchema>;
export type DesignExportRequestDto = Static<typeof DesignExportRequestSchema>;
export type DesignExportResultDto = Static<typeof DesignExportResultSchema>;
export type DesignUpdateFrameMetaRequestDto = Static<typeof DesignUpdateFrameMetaRequestSchema>;
export type DesignRasterFrameDto = Static<typeof DesignRasterFrameSchema>;
export type DesignLiveBoundsDto = Static<typeof DesignLiveBoundsSchema>;
export type DesignStyleSummaryDto = Static<typeof DesignStyleSummarySchema>;
export type DesignStyleDetailRequestDto = Static<typeof DesignStyleDetailRequestSchema>;
export type DesignStyleDetailDto = Static<typeof DesignStyleDetailSchema>;
export type CreateDesignRequestDto = Static<typeof CreateDesignRequestSchema>;
export type DesignLiveFrameRequestDto = Static<typeof DesignLiveFrameRequestSchema>;
export type DesignRasterRequestDto = Static<typeof DesignRasterRequestSchema>;
export type DesignStylesStatusDto = Static<typeof DesignStylesStatusSchema>;
export type DesignRefreshRequestDto = Static<typeof DesignRefreshRequestSchema>;
export type DesignRefreshResultDto = Static<typeof DesignRefreshResultSchema>;

/**
 * 光栅化的结果。
 *
 * **刻意没有 schema**:载荷里是位图字节,每次 IPC 都按 schema 校验一遍几 MB 的数组是白花
 * 成本,而它又完全由主进程自己产出 —— 请求需要校验(来自渲染层),响应不需要(来自我们)。
 */
export type DesignRasterResultDto =
  // `Uint8Array<ArrayBuffer>` 而不是默认的 `Uint8Array`:`Blob` 的构造不接受可能是
  // `SharedArrayBuffer` 背书的视图,而这个字节最终就是喂给 `Blob` 的。
  | { ok: true; key: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { ok: false; key: string; code: "timeout" | "load-failed" | "capture-failed" | "cancelled" };
export type DesignMoveFramesRequestDto = Static<typeof DesignMoveFramesRequestSchema>;
