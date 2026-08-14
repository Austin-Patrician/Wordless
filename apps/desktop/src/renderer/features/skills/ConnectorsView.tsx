import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@wordless/ui-kit";
import {
  Cable,
  CheckCircle2,
  CircleAlert,
  CircleOff,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  CONNECTOR_OAUTH_REDIRECT_URI,
  type ConnectorConfiguration,
  type ConnectorSummary,
  type ConnectorTemplateId,
} from "@wordless/domain";
import connectionIcon from "../../../icons/common-icons/connection.svg";
import { ConnectorIcon } from "../../shared/ConnectorIcon";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import {
  connectorErrorDetail,
  connectorErrorKind,
  hasActiveConnectorAuthorization,
  type ConnectorErrorKind,
  type ConnectorOperation,
} from "./connector-ui-state";

type ConnectorDraft = Omit<
  ConnectorConfiguration,
  "id" | "createdAt" | "updatedAt"
>;

const templates: Array<{
  id: Exclude<ConnectorTemplateId, null>;
  label: string;
  detail: string;
  transport: ConnectorDraft["transport"];
}> = [
  {
    id: "feishu",
    label: "飞书",
    detail: "协作与知识服务",
    transport: "streamable-http",
  },
  {
    id: "dingtalk",
    label: "钉钉",
    detail: "组织与工作流服务",
    transport: "streamable-http",
  },
  {
    id: "wecom",
    label: "企业微信",
    detail: "企业协作服务",
    transport: "streamable-http",
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    detail: "数据库 MCP Server",
    transport: "stdio",
  },
  {
    id: "web-search",
    label: "Web Search",
    detail: "外部研究与搜索服务",
    transport: "streamable-http",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    detail: "网页搜索、抓取与解析服务",
    transport: "streamable-http",
  },
  {
    id: "github",
    label: "GitHub",
    detail: "仓库、Issue、Pull request 与 Actions",
    transport: "streamable-http",
  },
  {
    id: "ai-hot",
    label: "AI hot",
    detail: "AI 热点信息与趋势查询",
    transport: "streamable-http",
  },
];

const templateDefaults: Partial<Record<Exclude<ConnectorTemplateId, null>, Pick<ConnectorDraft, "url" | "oauth">>> = {
  firecrawl: {
    url: "https://mcp.firecrawl.dev/v2/mcp-oauth",
    oauth: null,
  },
  github: {
    url: "https://api.githubcopilot.com/mcp/",
    oauth: null,
  },
  "ai-hot": {
    url: "https://aihot.virxact.com/api/mcp?aihot_actor=eea353c7-0f39-4f14-91b0-31c11deccb5a",
    oauth: null,
  },
};

function requiresTemplateAuthorization(templateId: Exclude<ConnectorTemplateId, null>): boolean {
  return templateId === "firecrawl" || templateId === "github";
}

function newDraft(): ConnectorDraft {
  return {
    name: "",
    templateId: null,
    transport: "streamable-http",
    enabled: false,
    trustedAt: null,
    command: null,
    args: [],
    cwd: null,
    environment: {},
    url: null,
    headers: [],
    oauth: null,
  };
}

function statusLabel(status: ConnectorSummary["status"]) {
  return status === "ready"
    ? "已就绪"
    : status === "needs-auth"
      ? "需要授权"
      : status === "error"
        ? "连接失败"
        : "未连接";
}

function ConnectorEnabledBadge({ enabled }: { enabled: boolean }) {
  const state = enabled
    ? { Icon: CheckCircle2, label: "Enabled", className: "text-[#718747] dark:text-[#c4df77]" }
    : { Icon: CircleOff, label: "Disabled", className: "text-[#9a9a92] dark:text-muted-foreground" };
  const Icon = state.Icon;
  return <span aria-label={state.label} className="shrink-0" title={state.label}><Icon aria-hidden className={cn("h-4 w-4", state.className)} /></span>;
}

function headerLines(headers: ConnectorDraft["headers"]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

function parseHeaders(value: string): ConnectorDraft["headers"] {
  return value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return [];
    const name = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    return name ? [{ name, value: headerValue }] : [];
  });
}

function environmentLines(environment: ConnectorDraft["environment"]): string {
  return Object.entries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

function parseEnvironment(value: string): ConnectorDraft["environment"] {
  return Object.fromEntries(
    value.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) return [];
      const name = line.slice(0, separator).trim();
      const environmentValue = line.slice(separator + 1);
      return name ? [[name, environmentValue]] : [];
    }),
  );
}

function updateOAuth(
  draft: ConnectorDraft,
  changes: Partial<NonNullable<ConnectorDraft["oauth"]>>,
): ConnectorDraft {
  return { ...draft, oauth: { ...(draft.oauth ?? {}), ...changes } };
}

type ConnectorsViewProps = {
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  query: string;
};

type ConnectorUiError = { detail: string; kind: ConnectorErrorKind };
type TemplateUiError = ConnectorUiError & { templateId: Exclude<ConnectorTemplateId, null> };

const connectorErrorMessages: Record<ConnectorErrorKind, MessageKey> = {
  "authorization-busy": "connectorAuthorizationBusy",
  "authorization-denied": "connectorAuthorizationDenied",
  "authorization-expired": "connectorAuthorizationExpired",
  "authorization-failed": "connectorAuthorizationFailed",
  "authorization-timeout": "connectorAuthorizationTimeout",
  "operation-failed": "connectorOperationFailed",
  "test-failed": "connectorTestFailed",
};

export function ConnectorsView({
  dialogOpen,
  onDialogOpenChange,
  query,
}: ConnectorsViewProps) {
  const { client, refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [draft, setDraft] = useState<ConnectorDraft>(newDraft);
  const operationLocks = useRef(new Map<string, ConnectorOperation>());
  const [operations, setOperations] = useState<Record<string, ConnectorOperation>>({});
  const [connectorErrors, setConnectorErrors] = useState<Record<string, ConnectorUiError>>({});
  const [dialogError, setDialogError] = useState<ConnectorUiError | null>(null);
  const [templateError, setTemplateError] = useState<TemplateUiError | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<Exclude<ConnectorTemplateId, null> | null>(null);
  const [saving, setSaving] = useState(false);
  const connectors = snapshot?.connectors.connectors ?? [];
  const filteredConnectors = connectors.filter((connector) =>
    `${connector.name} ${connector.transport} ${connector.status}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const availableTemplates = templates
    .filter(
      (template) =>
        !connectors.some((connector) => connector.templateId === template.id),
    )
    .filter((template) =>
      `${template.label} ${template.detail}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );

  const runConnector = async (connectorId: string, action: ConnectorOperation, operation: () => Promise<void>) => {
    if (!client) return;
    if (operationLocks.current.has(connectorId)) return;
    if (action === "authorize" && [...operationLocks.current.values()].includes("authorize")) return;
    operationLocks.current.set(connectorId, action);
    setOperations(Object.fromEntries(operationLocks.current));
    setConnectorErrors((current) => {
      const next = { ...current };
      delete next[connectorId];
      return next;
    });
    try {
      await operation();
      await refresh();
    } catch (cause) {
      await refresh().catch(() => {});
      const detail = connectorErrorDetail(cause);
      setConnectorErrors((current) => ({ ...current, [connectorId]: { detail, kind: connectorErrorKind(detail, action) } }));
    } finally {
      operationLocks.current.delete(connectorId);
      setOperations(Object.fromEntries(operationLocks.current));
    }
  };

  const startTemplate = async (template: (typeof templates)[number]) => {
    if (!client || startingTemplateId !== null) return;
    const defaults = templateDefaults[template.id];
    if (!requiresTemplateAuthorization(template.id)) {
      setDraft({
        ...newDraft(),
        templateId: template.id,
        name: template.label,
        transport: template.transport,
        ...defaults,
      });
      onDialogOpenChange(true);
      return;
    }
    if (authorizationActive) return;
    setStartingTemplateId(template.id);
    setTemplateError(null);
    try {
      const saved = await client.saveConnector({
      ...newDraft(),
      templateId: template.id,
      name: template.label,
      transport: template.transport,
        ...defaults,
      });
      await runConnector(saved.id, "authorize", async () => {
        await client.authorizeConnector(saved.id);
        await client.testConnector(saved.id);
      });
    } catch (cause) {
      const detail = connectorErrorDetail(cause);
      setTemplateError({ templateId: template.id, detail, kind: connectorErrorKind(detail, "authorize") });
    } finally {
      setStartingTemplateId(null);
    }
  };

  const save = async () => {
    if (!client) return;
    setSaving(true);
    setDialogError(null);
    try {
      await client.saveConnector(draft);
      await refresh();
      onDialogOpenChange(false);
      setDraft(newDraft());
    } catch (cause) {
      await refresh().catch(() => {});
      const detail = connectorErrorDetail(cause);
      setDialogError({ detail, kind: "operation-failed" });
    } finally {
      setSaving(false);
    }
  };

  const authorizationActive = hasActiveConnectorAuthorization(operations);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto pt-8">
      <div className="grid grid-cols-1 gap-3 pb-8 sm:grid-cols-2 lg:grid-cols-3">
        {filteredConnectors.map((connector) => {
          const operation = operations[connector.id];
          const connectorBusy = operation !== undefined;
          const persistedErrorDetail = connector.lastError ? connectorErrorDetail(connector.lastError) : undefined;
          const persistedError = persistedErrorDetail
            ? {
                detail: persistedErrorDetail,
                kind: connectorErrorKind(persistedErrorDetail, connector.status === "needs-auth" ? "authorize" : "test"),
              }
            : undefined;
          const cardError = connectorBusy ? undefined : connectorErrors[connector.id] ?? persistedError;
          return (
            <article
              aria-busy={connectorBusy}
              className={cn(
                "group flex min-w-0 flex-col rounded-[8px] border bg-white p-3.5 transition-colors dark:bg-card",
                "border-[#e3e3de] hover:border-[#cfcfc8] dark:border-border",
              )}
              key={connector.id}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-[6px]",
                    "bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]",
                  )}
                >
                  <ConnectorIcon
                    templateId={connector.templateId}
                    transport={connector.transport}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">
                      {connector.name}
                    </p>
                    <ConnectorEnabledBadge enabled={connector.enabled} />
                  </div>
                  <p className="mt-1 h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">
                    {connector.transport === "stdio"
                      ? "Local command connector."
                      : "Remote MCP connector."}{" "}
                    {connector.tools.length} tools, {connector.resources.length}{" "}
                    resources.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">
                  {operation === "authorize"
                    ? t("connectorWaitingAuthorization")
                    : operation === "test" || operation === "trust"
                      ? t("connectorTesting")
                      : connector.enabled ? statusLabel(connector.status) : "已停用"}
                </span>
                <div className="flex items-center gap-1">
                  {connector.transport === "stdio" &&
                  connector.trustedAt === null ? (
                    <Button
                      className="h-7 px-2 text-[10px]"
                      disabled={connectorBusy}
                      onClick={() =>
                        void runConnector(connector.id, "trust", async () => {
                          await client?.trustConnector(connector.id);
                          await client?.testConnector(connector.id);
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      信任
                    </Button>
                  ) : connector.transport === "streamable-http" &&
                    connector.status === "needs-auth" ? (
                    <Button
                      aria-label={operation === "authorize" ? t("connectorWaitingAuthorization") : "连接"}
                      className="h-7 min-w-14 gap-1 px-2 text-[10px]"
                      disabled={connectorBusy || authorizationActive}
                      onClick={() =>
                        void runConnector(connector.id, "authorize", async () => {
                          await client?.authorizeConnector(connector.id);
                          await client?.testConnector(connector.id);
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      {operation === "authorize" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <><KeyRound className="h-3 w-3" /><span>连接</span></>}
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label="测试连接"
                          disabled={connectorBusy}
                          onClick={() =>
                            void runConnector(
                              connector.id,
                              "test",
                              async () =>
                                await client?.testConnector(connector.id),
                            )
                          }
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <img
                            alt=""
                            className={cn(
                              "h-4 w-4 object-contain dark:invert",
                              operation === "test" &&
                                "animate-pulse",
                            )}
                            src={connectionIcon}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>测试连接</TooltipContent>
                    </Tooltip>
                  )}
                  <Switch
                    aria-label={connector.enabled ? "Disable connector" : "Enable connector"}
                    checked={connector.enabled}
                    disabled={connectorBusy}
                    onCheckedChange={(enabled) =>
                      void runConnector(
                        connector.id,
                        "enabled",
                        async () =>
                          await client?.setConnectorEnabled(
                            connector.id,
                            enabled,
                          ),
                      )
                    }
                  />
                  <Button
                    aria-label="Remove connector"
                    className="text-[#8d6252]"
                    disabled={connectorBusy}
                    onClick={() =>
                      void runConnector(
                        connector.id,
                        "remove",
                        async () => await client?.removeConnector(connector.id),
                      )
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {cardError ? (
                <div className="mt-3 flex items-start gap-2 border-t border-[#eee4df] pt-2.5 text-[10px] leading-4 text-[#9a5749] dark:border-[#513a34] dark:text-[#efb0a3]">
                  <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{t(connectorErrorMessages[cardError.kind])}</span>
                </div>
              ) : null}
            </article>
          );
        })}
        {availableTemplates.map((template) => (
          <button
            className="group flex min-w-0 flex-col rounded-[8px] border border-[#e3e3de] bg-white p-3.5 text-left transition-colors hover:border-[#cfcfc8] hover:bg-[#fdfdfc] dark:border-border dark:bg-card dark:hover:bg-muted"
            key={template.id}
            aria-busy={startingTemplateId === template.id || (requiresTemplateAuthorization(template.id) && authorizationActive)}
            disabled={startingTemplateId !== null || (requiresTemplateAuthorization(template.id) && authorizationActive)}
            onClick={() => void startTemplate(template)}
            type="button"
          >
            <span className="flex min-w-0 items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[#f2f2ef] text-[#55554f] dark:bg-muted dark:text-muted-foreground">
                <ConnectorIcon
                  templateId={template.id}
                  transport={template.transport}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">
                  {template.label}
                </span>
                <span className="mt-1 block h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">
                  {template.detail}
                </span>
              </span>
            </span>
            <span className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">
                {startingTemplateId === template.id ? null : "AVAILABLE"}
              </span>
              <span
                aria-label={startingTemplateId === template.id ? t("connectorWaitingAuthorization") : undefined}
                className="grid h-7 w-7 place-items-center rounded-full border border-[#d8d8d3] text-[#92928b] transition-colors group-hover:bg-[#f3f3f0] group-hover:text-[#5c5c56] dark:border-border dark:group-hover:bg-muted"
              >
                {startingTemplateId === template.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </span>
            </span>
            {requiresTemplateAuthorization(template.id) && templateError?.templateId === template.id ? (
              <span className="mt-2 flex items-start gap-1.5 border-t border-[#eee4df] pt-2 text-[10px] leading-4 text-[#9a5749] dark:border-[#513a34] dark:text-[#efb0a3]">
                <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{t(connectorErrorMessages[templateError.kind])}</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {filteredConnectors.length === 0 && availableTemplates.length === 0 ? (
        <div className="py-16 text-center">
          <Cable className="mx-auto h-5 w-5 text-[#989891]" />
          <p className="mt-3 text-[12px] font-medium text-[#5d5d57] dark:text-foreground">
            没有匹配的连接器
          </p>
          <p className="mt-1 text-[11px] text-[#8a8a83] dark:text-muted-foreground">
            添加本地或远程 MCP 服务后，可按会话供 Agent 使用。
          </p>
        </div>
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          onDialogOpenChange(open);
          if (!open) {
            setDraft(newDraft());
            setDialogError(null);
          }
        }}
        open={dialogOpen}
      >
        <DialogContent
          className="w-[min(42rem,calc(100vw-2rem))] rounded-[12px] px-6 py-6"
          showCloseButton={false}
        >
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[17px] font-bold">
              {t("addConnector")}
            </DialogTitle>
            <DialogClose asChild>
              <button
                aria-label={t("closeConnectorDialog")}
                className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
          {dialogError ? (
            <div className="mt-4 flex items-start gap-2 border border-[#e6cbc4] bg-[#fdf5f2] px-3 py-2 text-[11px] text-[#a45748] dark:border-[#613f37] dark:bg-[#2b201d] dark:text-[#efb0a3]">
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{t(connectorErrorMessages[dialogError.kind])}</span>
            </div>
          ) : null}
          <label className="mt-5 block">
            <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
              {t("connectorName")}
            </span>
            <input
              className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              value={draft.name}
            />
          </label>
          <div className="mt-4 flex gap-1 rounded-[7px] bg-[#efefeb] p-1 dark:bg-muted">
            <button
              className={cn(
                "flex-1 rounded-[5px] px-2 py-1.5 text-[11px] font-medium",
                draft.transport === "streamable-http" &&
                  "bg-white shadow-sm dark:bg-card",
              )}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  transport: "streamable-http",
                }))
              }
              type="button"
            >
              {t("connectorRemoteHttp")}
            </button>
            <button
              className={cn(
                "flex-1 rounded-[5px] px-2 py-1.5 text-[11px] font-medium",
                draft.transport === "stdio" &&
                  "bg-white shadow-sm dark:bg-card",
              )}
              onClick={() =>
                setDraft((current) => ({ ...current, transport: "stdio" }))
              }
              type="button"
            >
              {t("connectorLocalCommand")}
            </button>
          </div>
          {draft.transport === "streamable-http" ? (
            <>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorMcpUrl")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      url: event.target.value || null,
                    }))
                  }
                  placeholder="https://example.com/mcp"
                  value={draft.url ?? ""}
                />
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                    {t("connectorOAuthClientId")}
                  </span>
                  <input
                    className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                    onChange={(event) =>
                      setDraft((current) =>
                        updateOAuth(current, {
                          clientId: event.target.value || undefined,
                        }),
                      )
                    }
                    placeholder={t("connectorOAuthClientIdPlaceholder")}
                    value={draft.oauth?.clientId ?? ""}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                    {t("connectorOAuthClientSecret")}
                  </span>
                  <input
                    className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                    onChange={(event) =>
                      setDraft((current) =>
                        updateOAuth(current, {
                          clientSecret: event.target.value || undefined,
                        }),
                      )
                    }
                    placeholder={t("connectorOAuthClientSecretPlaceholder")}
                    type="password"
                    value={draft.oauth?.clientSecret ?? ""}
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorOAuthScope")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) =>
                      updateOAuth(current, {
                        scope: event.target.value || undefined,
                      }),
                    )
                  }
                  placeholder={t("connectorOAuthScopePlaceholder")}
                  value={draft.oauth?.scope ?? ""}
                />
              </label>
              <p className="mt-1.5 font-mono text-[9px] leading-4 text-[#8a8a83] dark:text-muted-foreground">
                {t("connectorOAuthRedirectUri")} {CONNECTOR_OAUTH_REDIRECT_URI}
              </p>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorHeaders")}
                </span>
                <textarea
                  className="min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 font-mono text-[10px] leading-4 outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      headers: parseHeaders(event.target.value),
                    }))
                  }
                  placeholder={
                    "X-API-Key: your-api-key\nX-Workspace: workspace-id"
                  }
                  value={headerLines(draft.headers)}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorBearerToken")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) =>
                      event.target.value
                        ? updateOAuth(current, {
                            accessToken: event.target.value,
                          })
                        : {
                            ...current,
                            oauth:
                              current.oauth?.clientId ||
                              current.oauth?.clientSecret ||
                              current.oauth?.scope
                                ? {
                                    clientId: current.oauth.clientId,
                                    clientSecret: current.oauth.clientSecret,
                                    scope: current.oauth.scope,
                                  }
                                : null,
                          },
                    )
                  }
                  placeholder={t("connectorBearerTokenPlaceholder")}
                  type="password"
                  value={draft.oauth?.accessToken ?? ""}
                />
              </label>
            </>
          ) : (
            <>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorCommand")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      command: event.target.value || null,
                    }))
                  }
                  placeholder="npx"
                  value={draft.command ?? ""}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorArguments")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      args: event.target.value.trim()
                        ? event.target.value.trim().split(/\s+/)
                        : [],
                    }))
                  }
                  placeholder="-y package-name"
                  value={draft.args.join(" ")}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorWorkingDirectory")}
                </span>
                <input
                  className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cwd: event.target.value || null,
                    }))
                  }
                  placeholder={t("connectorWorkingDirectoryPlaceholder")}
                  value={draft.cwd ?? ""}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">
                  {t("connectorEnvironment")}
                </span>
                <textarea
                  className="min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 font-mono text-[10px] leading-4 outline-none focus:border-[#91a769] dark:border-border dark:bg-card"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      environment: parseEnvironment(event.target.value),
                    }))
                  }
                  placeholder={
                    "DATABASE_URL=postgres://...\nAPI_KEY=your-api-key"
                  }
                  value={environmentLines(draft.environment)}
                />
              </label>
            </>
          )}
          <div className="mt-6 flex items-center justify-between border-t border-[#ecece7] pt-4 dark:border-border">
            <span className="text-[10px] text-muted-foreground">
              {t("connectorSaveHelp")}
            </span>
            <Button
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {t("connectorSave")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
