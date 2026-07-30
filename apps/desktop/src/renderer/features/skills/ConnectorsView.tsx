import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Switch, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import { Cable, CheckCircle2, KeyRound, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { CONNECTOR_OAUTH_REDIRECT_URI, type ConnectorConfiguration, type ConnectorSummary, type ConnectorTemplateId } from "@wordless/domain";
import connectionIcon from "../../../icons/common-icons/connection.svg";
import { ConnectorIcon } from "../../shared/ConnectorIcon";
import { useRuntime } from "../../shared/runtime";

type ConnectorDraft = Omit<ConnectorConfiguration, "id" | "createdAt" | "updatedAt">;

const templates: Array<{ id: Exclude<ConnectorTemplateId, null>; label: string; detail: string; transport: ConnectorDraft["transport"] }> = [
  { id: "feishu", label: "飞书", detail: "协作与知识服务", transport: "streamable-http" },
  { id: "dingtalk", label: "钉钉", detail: "组织与工作流服务", transport: "streamable-http" },
  { id: "wecom", label: "企业微信", detail: "企业协作服务", transport: "streamable-http" },
  { id: "postgresql", label: "PostgreSQL", detail: "数据库 MCP Server", transport: "stdio" },
  { id: "web-search", label: "Web Search", detail: "外部研究与搜索服务", transport: "streamable-http" },
];

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

function statusClass(status: ConnectorSummary["status"]) {
  return status === "ready" ? "bg-[#5e7b3a]" : status === "needs-auth" ? "bg-[#bf813d]" : status === "error" ? "bg-[#b86050]" : "bg-[#a2a29c]";
}

function statusLabel(status: ConnectorSummary["status"]) {
  return status === "ready" ? "已就绪" : status === "needs-auth" ? "需要授权" : status === "error" ? "连接失败" : "未连接";
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
  return Object.entries(environment).map(([name, value]) => `${name}=${value}`).join("\n");
}

function parseEnvironment(value: string): ConnectorDraft["environment"] {
  return Object.fromEntries(value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    if (separator < 1) return [];
    const name = line.slice(0, separator).trim();
    const environmentValue = line.slice(separator + 1);
    return name ? [[name, environmentValue]] : [];
  }));
}

function updateOAuth(draft: ConnectorDraft, changes: Partial<NonNullable<ConnectorDraft["oauth"]>>): ConnectorDraft {
  return { ...draft, oauth: { ...(draft.oauth ?? {}), ...changes } };
}

type ConnectorsViewProps = {
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  query: string;
};

export function ConnectorsView({ dialogOpen, onDialogOpenChange, query }: ConnectorsViewProps) {
  const { client, refresh, snapshot } = useRuntime();
  const [draft, setDraft] = useState<ConnectorDraft>(newDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectors = snapshot?.connectors.connectors ?? [];
  const filteredConnectors = connectors.filter((connector) => `${connector.name} ${connector.transport} ${connector.status}`.toLowerCase().includes(query.trim().toLowerCase()));
  const availableTemplates = templates.filter((template) => !connectors.some((connector) => connector.templateId === template.id)).filter((template) => `${template.label} ${template.detail}`.toLowerCase().includes(query.trim().toLowerCase()));

  const run = async (key: string, operation: () => Promise<void>) => {
    if (!client) return;
    setBusy(key);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const startTemplate = (template: typeof templates[number]) => {
    setDraft({ ...newDraft(), templateId: template.id, name: template.label, transport: template.transport });
    onDialogOpenChange(true);
  };

  const save = async () => {
    if (!client) return;
    setBusy("save");
    setError(null);
    try {
      await client.saveConnector(draft);
      await refresh();
      onDialogOpenChange(false);
      setDraft(newDraft());
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return <section className="min-h-0 flex-1 overflow-y-auto pt-8">
    {error ? <p className="mb-4 border border-[#e6cbc4] bg-[#fdf5f2] px-3 py-2 text-[11px] text-[#a45748] dark:border-[#613f37] dark:bg-[#2b201d] dark:text-[#efb0a3]">{error}</p> : null}
    <div className="grid grid-cols-1 gap-3 pb-8 sm:grid-cols-2 lg:grid-cols-3">
      {filteredConnectors.map((connector) => {
        const connected = connector.enabled && connector.status === "ready";
        return <article className={cn("group flex min-w-0 flex-col rounded-[8px] border bg-white p-3.5 transition-colors dark:bg-card", connected ? "border-[#aeb58e] hover:border-[#9cae75] dark:border-[#617843]" : "border-[#e3e3de] hover:border-[#cfcfc8] dark:border-border")} key={connector.id}><div className="flex min-w-0 items-start gap-3"><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[6px]", connected ? "bg-[#f2f6e3] text-[#7a8f52] dark:bg-[#303c22] dark:text-[#c4df77]" : "bg-[#f2f2ef] text-[#55554f] dark:bg-muted dark:text-muted-foreground")}><ConnectorIcon templateId={connector.templateId} transport={connector.transport} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">{connector.name}</p><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusClass(connector.status))} /></div><p className="mt-1 h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">{connector.transport === "stdio" ? "Local command connector." : "Remote MCP connector."} {connector.tools.length} tools, {connector.resources.length} resources.</p></div></div><div className="mt-3 flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">{statusLabel(connector.status)}</span><div className="flex items-center gap-1">{connector.transport === "stdio" && connector.trustedAt === null ? <Button className="h-7 px-2 text-[10px]" disabled={busy !== null} onClick={() => void run(`trust:${connector.id}`, async () => { await client?.trustConnector(connector.id); await client?.testConnector(connector.id); })} type="button" variant="outline">信任</Button> : connector.transport === "streamable-http" && connector.status === "needs-auth" ? <Button className="h-7 gap-1 px-2 text-[10px]" disabled={busy !== null} onClick={() => void run(`authorize:${connector.id}`, async () => { await client?.authorizeConnector(connector.id); await client?.testConnector(connector.id); })} type="button" variant="outline"><KeyRound className="h-3 w-3" />连接</Button> : <Tooltip><TooltipTrigger asChild><Button aria-label="测试连接" disabled={busy !== null} onClick={() => void run(`test:${connector.id}`, async () => await client?.testConnector(connector.id))} size="icon" type="button" variant="ghost"><img alt="" className={cn("h-4 w-4 object-contain dark:invert", busy === `test:${connector.id}` && "animate-pulse")} src={connectionIcon} /></Button></TooltipTrigger><TooltipContent>测试连接</TooltipContent></Tooltip>}<Switch checked={connector.enabled} disabled={busy !== null} onCheckedChange={(enabled) => void run(`enabled:${connector.id}`, async () => await client?.setConnectorEnabled(connector.id, enabled))} /><Button aria-label="Remove connector" className="text-[#8d6252]" disabled={busy !== null} onClick={() => void run(`remove:${connector.id}`, async () => await client?.removeConnector(connector.id))} size="icon" type="button" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button></div></div></article>;
      })}
      {availableTemplates.map((template) => <button className="group flex min-w-0 flex-col rounded-[8px] border border-[#e3e3de] bg-white p-3.5 text-left transition-colors hover:border-[#cfcfc8] hover:bg-[#fdfdfc] dark:border-border dark:bg-card dark:hover:bg-muted" key={template.id} onClick={() => startTemplate(template)} type="button"><span className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[#f2f2ef] text-[#55554f] dark:bg-muted dark:text-muted-foreground"><ConnectorIcon templateId={template.id} transport={template.transport} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">{template.label}</span><span className="mt-1 block h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">{template.detail}</span></span></span><span className="mt-3 flex items-center justify-between"><span className="font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">AVAILABLE</span><span className="grid h-7 w-7 place-items-center rounded-full border border-[#d8d8d3] text-[#92928b] transition-colors group-hover:bg-[#f3f3f0] group-hover:text-[#5c5c56] dark:border-border dark:group-hover:bg-muted"><Plus className="h-3.5 w-3.5" /></span></span></button>)}
    </div>
    {filteredConnectors.length === 0 && availableTemplates.length === 0 ? <div className="py-16 text-center"><Cable className="mx-auto h-5 w-5 text-[#989891]" /><p className="mt-3 text-[12px] font-medium text-[#5d5d57] dark:text-foreground">没有匹配的连接器</p><p className="mt-1 text-[11px] text-[#8a8a83] dark:text-muted-foreground">添加本地或远程 MCP 服务后，可按会话供 Agent 使用。</p></div> : null}
    <Dialog onOpenChange={(open) => { onDialogOpenChange(open); if (!open) setDraft(newDraft()); }} open={dialogOpen}>
      <DialogContent className="w-[min(42rem,calc(100vw-2rem))] rounded-[12px] px-6 py-6" showCloseButton={false}>
        <div className="flex items-center justify-between gap-4"><DialogTitle className="text-[17px] font-bold">添加连接器</DialogTitle><DialogClose asChild><button aria-label="Close" className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" type="button"><X className="h-4 w-4" /></button></DialogClose></div>
        <label className="mt-5 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">名称</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} value={draft.name} /></label>
        <div className="mt-4 flex gap-1 rounded-[7px] bg-[#efefeb] p-1 dark:bg-muted"><button className={cn("flex-1 rounded-[5px] px-2 py-1.5 text-[11px] font-medium", draft.transport === "streamable-http" && "bg-white shadow-sm dark:bg-card")} onClick={() => setDraft((current) => ({ ...current, transport: "streamable-http" }))} type="button">远程 HTTP</button><button className={cn("flex-1 rounded-[5px] px-2 py-1.5 text-[11px] font-medium", draft.transport === "stdio" && "bg-white shadow-sm dark:bg-card")} onClick={() => setDraft((current) => ({ ...current, transport: "stdio" }))} type="button">本地命令</button></div>
        {draft.transport === "streamable-http" ? <><label className="mt-4 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">MCP URL</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value || null }))} placeholder="https://example.com/mcp" value={draft.url ?? ""} /></label><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">OAuth client ID</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => updateOAuth(current, { clientId: event.target.value || undefined }))} placeholder="Optional for dynamic registration" value={draft.oauth?.clientId ?? ""} /></label><label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">OAuth client secret</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => updateOAuth(current, { clientSecret: event.target.value || undefined }))} placeholder="Optional for public clients" type="password" value={draft.oauth?.clientSecret ?? ""} /></label></div><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">OAuth scope</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => updateOAuth(current, { scope: event.target.value || undefined }))} placeholder="Optional space-separated scopes" value={draft.oauth?.scope ?? ""} /></label><p className="mt-1.5 font-mono text-[9px] leading-4 text-[#8a8a83] dark:text-muted-foreground">Official OAuth redirect URI: {CONNECTOR_OAUTH_REDIRECT_URI}</p><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">请求头</span><textarea className="min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 font-mono text-[10px] leading-4 outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, headers: parseHeaders(event.target.value) }))} placeholder={"X-API-Key: your-api-key\nX-Workspace: workspace-id"} value={headerLines(draft.headers)} /></label><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">Bearer token</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => event.target.value ? updateOAuth(current, { accessToken: event.target.value }) : { ...current, oauth: current.oauth?.clientId || current.oauth?.clientSecret || current.oauth?.scope ? { clientId: current.oauth.clientId, clientSecret: current.oauth.clientSecret, scope: current.oauth.scope } : null })} placeholder="Optional access token" type="password" value={draft.oauth?.accessToken ?? ""} /></label></> : <><label className="mt-4 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">命令</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value || null }))} placeholder="npx" value={draft.command ?? ""} /></label><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">参数</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [] }))} placeholder="-y package-name" value={draft.args.join(" ")} /></label><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">工作目录</span><input className="h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 font-mono text-[11px] outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value || null }))} placeholder="Optional working directory" value={draft.cwd ?? ""} /></label><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-[#55554f] dark:text-foreground">环境变量</span><textarea className="min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 font-mono text-[10px] leading-4 outline-none focus:border-[#91a769] dark:border-border dark:bg-card" onChange={(event) => setDraft((current) => ({ ...current, environment: parseEnvironment(event.target.value) }))} placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=your-api-key"} value={environmentLines(draft.environment)} /></label></>}
        <div className="mt-6 flex items-center justify-between border-t border-[#ecece7] pt-4 dark:border-border"><span className="text-[10px] text-muted-foreground">保存后可从连接器卡片测试连接并完成授权。</span><Button disabled={busy === "save"} onClick={() => void save()} type="button">{busy === "save" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}保存</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
