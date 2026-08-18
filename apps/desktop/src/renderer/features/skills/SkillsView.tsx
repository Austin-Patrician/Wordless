import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Switch, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, AudioLines, BookOpen, Bot, Boxes, BrainCircuit, CalendarDays, Cable, ChartNoAxesCombined, CheckCircle2, CircleAlert, CircleOff, Code2, Command, Container, CreditCard, Database, ExternalLink, FileText, FolderTree, GitBranch, HardDrive, Image, KanbanSquare, KeyRound, Layers3, LoaderCircle, Mail, MapPin, MessagesSquare, Network, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Star, Terminal, Trash2, Upload, Video, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { McpMarketplaceEntry, SkillMarketplaceEntry, SkillMarketplacePreview, SkillSource, SkillSummary } from "@wordless/domain";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { SkillIcon } from "../../shared/SkillIcon";
import { ConnectorsView } from "./ConnectorsView";
import githubIcon from "../../../icons/mcp/github-fill.svg";
import figmaIcon from "../../../icons/mcp/figma-color.svg";
import firecrawlIcon from "../../../icons/mcp/firecrawl-color.svg";
import postgresqlIcon from "../../../icons/mcp/PostgreSQL.svg";
import cloudflareIcon from "../../../icons/provider-icons/cloudflare-color.svg";
import openaiIcon from "../../../icons/provider-icons/openai.svg";
import vercelIcon from "../../../icons/provider-icons/vercel.svg";
import googleCloudIcon from "../../../icons/common-icons/google_cloud-icon.svg";

type Translate = (key: MessageKey) => string;

const skillMarketKeywords = [
  { label: "Productivity", query: "productivity" },
  { label: "Data Analysis", query: "data analysis" },
  { label: "Writing", query: "writing" },
  { label: "Automation", query: "automation" },
  { label: "Frontend", query: "frontend" },
  { label: "Testing", query: "testing" },
  { label: "DevOps", query: "devops" },
];

const sourceNames: Record<SkillSource, string> = {
  "built-in": "Wordless built-in",
  wordless: "Wordless",
  pi: "Pi",
  agents: "Agent Skills",
  claude: "Claude Code",
  codex: "Codex",
  "workspace-pi": "Workspace / Pi",
  "workspace-claude": "Workspace / Claude",
  "workspace-codex": "Workspace / Codex",
};

function SkillStateBadge({ skill }: { skill: SkillSummary }) {
  const state = {
    active: { Icon: CheckCircle2, label: "Enabled", className: "text-[#718747] dark:text-[#c4df77]" },
    disabled: { Icon: CircleOff, label: "Disabled", className: "text-[#9a9a92] dark:text-muted-foreground" },
    shadowed: { Icon: Layers3, label: "Shadowed by another skill", className: "text-[#a47b3f] dark:text-[#d8b36e]" },
    invalid: { Icon: CircleAlert, label: "Invalid", className: "text-[#b35e50] dark:text-[#efaaa0]" },
  }[skill.state];
  const Icon = state.Icon;
  return <span aria-label={state.label} className="shrink-0" title={state.label}><Icon aria-hidden className={cn("h-4 w-4", state.className)} /></span>;
}

type SkillSectionProps = {
  label: string;
  meta: string;
  onSelect: (skill: SkillSummary) => void;
  skills: SkillSummary[];
};

function SkillSection({ label, meta, onSelect, skills }: SkillSectionProps) {
  return <section className="mb-9">
    <div className="flex items-baseline gap-3"><h2 className="text-[13px] font-semibold text-[#3d3d38] dark:text-foreground">{label}</h2><span className="font-mono text-[10px] text-[#96968f] dark:text-muted-foreground">{meta}</span><span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-[#96968f] dark:text-muted-foreground"><span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-[#718747] dark:text-[#c4df77]" />{skills.filter((s) => s.state === "active").length}</span><span className="inline-flex items-center gap-1"><CircleOff className="h-3 w-3 text-[#9a9a92] dark:text-muted-foreground" />{skills.filter((s) => s.state === "disabled" || s.state === "shadowed" || s.state === "invalid").length}</span></span></div>
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => {
        return <button className="group min-w-0 rounded-[8px] border border-[#e3e3de] bg-white p-3.5 text-left transition-colors hover:border-[#cfcfc8] hover:bg-[#fdfdfc] dark:border-border dark:bg-card dark:hover:bg-muted" key={skill.id} onClick={() => onSelect(skill)} type="button"><div className="flex items-start gap-3"><SkillIcon name={skill.name} className="h-9 w-9 rounded-[6px] bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]" textClassName="text-[15px] font-semibold" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">{skill.name}</span><SkillStateBadge skill={skill} /></span><span className="mt-1 block h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">{skill.description || skill.diagnostic || "No description available."}</span></span></div></button>;
      })}
    </div>
    {skills.length === 0 ? <p className="mt-3 text-[12px] text-[#92928b] dark:text-muted-foreground">No matching skills.</p> : null}
  </section>;
}

function SkillDetail({ busy, onBack, onRemove, onToggle, skill }: { busy: boolean; onBack: () => void; onRemove: () => void; onToggle: (enabled: boolean) => void; skill: SkillSummary }) {
  const { t } = usePreferences();
  const [sourceOpen, setSourceOpen] = useState(false);
  return <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--wordless-shell-workspace)] px-7 py-6 lg:px-10">
    <button className="flex w-fit items-center gap-1.5 text-[13px] font-semibold text-[#4d4d48] hover:text-[#151513] dark:text-muted-foreground dark:hover:text-foreground" onClick={onBack} type="button"><ArrowLeft className="h-3.5 w-3.5" />{t("skills")}</button>
    <div className="mt-14 flex items-start justify-between gap-6 border-b border-[#e1e1dc] pb-5 dark:border-border"><div className="flex min-w-0 items-start gap-3"><SkillIcon name={skill.name} /><div className="min-w-0"><h1 className="text-[22px] font-semibold text-[#252522] dark:text-foreground">{skill.name}</h1><p className="mt-3 max-w-[720px] text-[14px] leading-6 text-[#54544f] dark:text-muted-foreground">{skill.description || skill.diagnostic || "No description available."}</p></div></div><div className="flex shrink-0 items-center gap-3"><Switch aria-label={skill.enabled ? t("disableModel") : t("enableModel")} checked={skill.enabled} disabled={busy || skill.state === "invalid"} onCheckedChange={onToggle} />{skill.source === "wordless" ? <Button aria-label="Remove skill" className="text-[#8d6252]" disabled={busy} onClick={onRemove} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button> : null}</div></div>
    <div className="mt-5 rounded-[10px] border border-[#e3e3de] bg-white p-5 dark:border-border dark:bg-card"><div className="flex justify-end gap-1"><Button aria-label="Preview skill" className={cn(!sourceOpen && "bg-[#f1f1ee] dark:bg-muted")} onClick={() => setSourceOpen(false)} size="icon" type="button" variant="ghost"><Search className="h-4 w-4" /></Button><Button aria-label="Show skill source" className={cn(sourceOpen && "bg-[#f1f1ee] dark:bg-muted")} onClick={() => setSourceOpen(true)} size="icon" type="button" variant="ghost"><Command className="h-4 w-4" /></Button></div>{sourceOpen ? <pre className="mt-6 overflow-auto font-mono text-[11px] leading-6 text-[#4d4d48] dark:text-muted-foreground">{`name: ${skill.name}\nsource: ${sourceNames[skill.source]}\nlocation: ${skill.filePath}\nscope: ${skill.workspaceId ?? "global"}\nstate: ${skill.state}\n\n${skill.description || skill.diagnostic || ""}`}</pre> : <div className="mt-4 text-[13px] leading-7 text-[#44443f] dark:text-foreground"><p className="text-[11px] text-[#86867f] dark:text-muted-foreground">source</p><p>{sourceNames[skill.source]}</p><p className="mt-4 text-[11px] text-[#86867f] dark:text-muted-foreground">location</p><p className="break-all font-mono text-[11px] leading-5">{skill.filePath}</p><p className="mt-6 font-semibold">{skill.name}</p><p className="mt-2">{skill.description || skill.diagnostic || "No description available."}</p></div>}</div>
  </section>;
}

function MarketSkillCard({ entry, installed, installing, installDisabled, onInstall, onOpen }: { entry: SkillMarketplaceEntry; installed: boolean; installing: boolean; installDisabled: boolean; onInstall: () => void; onOpen: () => void }) {
  const { t } = usePreferences();
  const installLabel = installing ? t("marketplaceInstallingSkill") : installed ? t("marketplaceInstalledStatus") : t("marketplaceInstallSkill");
  return <article className="relative min-w-0 overflow-hidden rounded-[8px] border border-[#e3e3de] bg-white transition-colors hover:border-[#c9cec0] dark:border-border dark:bg-card dark:hover:border-[#566044]">
    <button aria-label={`${t("marketplaceViewDetails")}: ${entry.name}`} className="flex h-full min-h-[176px] w-full flex-col p-4 pr-12 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#aebd88]" onClick={onOpen} type="button">
      <div className="flex items-start gap-3"><SkillIcon name={entry.name} className="h-10 w-10 shrink-0 rounded-[7px] bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]" textClassName="text-[15px] font-semibold" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><h3 className="truncate text-[13px] font-semibold text-[#33332f] dark:text-foreground" title={entry.name}>{entry.name}</h3>{installed ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#718747]" /> : null}</div><p className="mt-1 truncate text-[10px] text-[#8a8a83] dark:text-muted-foreground">{entry.author} · SkillsMP</p></div></div>
      <p className="mt-3 line-clamp-3 min-h-[54px] text-[11px] leading-[18px] text-[#6e6e67] dark:text-muted-foreground">{entry.description}</p>
      <div className="mt-auto flex w-full items-center gap-3 pt-3 text-[9px] text-[#8a8a83] dark:text-muted-foreground"><span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{Intl.NumberFormat(undefined, { notation: "compact" }).format(entry.stars)}</span>{entry.contentLanguage ? <span className="uppercase">{entry.contentLanguage}</span> : null}<span className="ml-auto">{installed ? t("marketplaceInstalledStatus") : t("marketplaceReviewSkill")}</span></div>
    </button>
    <Tooltip><TooltipTrigger asChild><button aria-label={installLabel} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-[#d8d8d3] text-[#78826c] transition-colors hover:bg-[#f1f4ea] hover:text-[#53633d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8c991] disabled:cursor-default disabled:opacity-60 dark:border-border dark:text-[#b7c5a6] dark:hover:bg-muted" disabled={installDisabled || installed} onClick={(event) => { event.stopPropagation(); onInstall(); }} type="button">{installing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : installed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}</button></TooltipTrigger><TooltipContent>{installLabel}</TooltipContent></Tooltip>
  </article>;
}

function SkillMarkdownPreview({ markdown, onOpenUrl }: { markdown: string; onOpenUrl: (url: string) => void }) {
  return <div className="max-h-[280px] overflow-auto p-3 text-[11px] leading-5 text-[#4a4a45] dark:text-muted-foreground">
    <ReactMarkdown
      components={{
        a: ({ children, href }) => {
          const url = typeof href === "string" && /^https?:\/\//i.test(href) ? href : null;
          return url ? <a className="font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f6230] dark:text-[#c3df8a]" href={url} onClick={(event) => { event.preventDefault(); onOpenUrl(url); }} rel="noreferrer">{children}</a> : <span>{children}</span>;
        },
        blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-[#b9c7a8] bg-[#f5f7f1] py-1 pl-2.5 dark:border-[#647253] dark:bg-[#20231c]">{children}</blockquote>,
        code: ({ children, className }) => <code className={cn("rounded-[3px] bg-[#eeeeea] px-1 py-0.5 font-mono text-[10px] text-[#43433f] dark:bg-[#2c2e29] dark:text-[#d9ddd3]", className)}>{children}</code>,
        h1: ({ children }) => <h1 className="mb-1.5 mt-4 text-[15px] font-semibold leading-5 text-[#30302d] first:mt-0 dark:text-foreground">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1.5 mt-4 text-[14px] font-semibold leading-5 text-[#343431] first:mt-0 dark:text-foreground">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 mt-3 text-[12px] font-semibold leading-5 text-[#383834] first:mt-0 dark:text-foreground">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1 mt-3 text-[11px] font-semibold leading-5 text-[#41413d] first:mt-0 dark:text-foreground">{children}</h4>,
        hr: () => <hr className="my-3 border-0 border-t border-[#dfdfda] dark:border-border" />,
        img: () => null,
        li: ({ children }) => <li className="my-0.5 pl-0.5 marker:text-[#8a9a7a]">{children}</li>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
        p: ({ children }) => <p className="my-2 break-words first:mt-0 last:mb-0">{children}</p>,
        pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-[5px] bg-[#f0f0ec] p-2.5 font-mono text-[10px] leading-5 text-[#43433f] dark:bg-[#292b26] dark:text-[#d9ddd3]">{children}</pre>,
        table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="min-w-full border-collapse text-left text-[10px]">{children}</table></div>,
        td: ({ children }) => <td className="border border-[#deded9] px-2 py-1 align-top dark:border-border">{children}</td>,
        th: ({ children }) => <th className="border border-[#deded9] bg-[#f3f3f0] px-2 py-1 text-left font-semibold dark:border-border dark:bg-muted">{children}</th>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-0.5 pl-5">{children}</ul>,
      }}
      remarkPlugins={[remarkGfm]}
      skipHtml
    >
      {markdown}
    </ReactMarkdown>
  </div>;
}

function SkillMarketplaceDetailDialog({ busy, entry, error, installed, onInstall, onOpenChange, onOpenUrl, preview, previewLoading }: { busy: boolean; entry: SkillMarketplaceEntry | null; error: string | null; installed: boolean; onInstall: () => void; onOpenChange: (open: boolean) => void; onOpenUrl: (url: string) => void; preview: SkillMarketplacePreview | null; previewLoading: boolean }) {
  const { t } = usePreferences();
  return <Dialog onOpenChange={onOpenChange} open={entry !== null}>
    <DialogContent className="flex max-h-[min(640px,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] flex-col rounded-[10px] p-0" showCloseButton={false}>
      {entry ? <>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4"><SkillIcon name={entry.name} className="h-10 w-10 shrink-0 rounded-[7px] bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]" /><div className="min-w-0 flex-1"><DialogTitle className="truncate text-[15px] font-semibold">{entry.name}</DialogTitle><p className="mt-1 truncate text-[10px] text-muted-foreground">{entry.author} · {entry.contentLanguage?.toUpperCase() ?? t("marketplaceLanguageUnknown")}</p></div><DialogClose asChild><button aria-label={t("marketplaceCloseDetails")} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" type="button"><X className="h-4 w-4" /></button></DialogClose></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12px] leading-5 text-[#575750] dark:text-muted-foreground">{entry.description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{Intl.NumberFormat().format(entry.stars)}</span><button className="inline-flex items-center gap-1 text-[#5f7444] hover:underline dark:text-[#c4dc91]" onClick={() => onOpenUrl(entry.githubUrl)} type="button"><GitBranch className="h-3 w-3" />GitHub<ExternalLink className="h-3 w-3" /></button><button className="inline-flex items-center gap-1 text-[#5f7444] hover:underline dark:text-[#c4dc91]" onClick={() => onOpenUrl(entry.skillUrl)} type="button">SkillsMP<ExternalLink className="h-3 w-3" /></button></div>
          {previewLoading ? <div className="flex h-40 items-center justify-center gap-2 text-[11px] text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />{t("marketplacePreparingPreview")}</div> : preview ? <div className="mt-5 grid min-h-[220px] grid-cols-1 overflow-hidden rounded-[7px] border border-border bg-[#fafaf8] sm:grid-cols-[150px_minmax(0,1fr)] dark:bg-muted/40"><div className="max-h-[152px] overflow-y-auto border-b border-border p-2 sm:max-h-[310px] sm:border-b-0 sm:border-r"><p className="px-2 py-1 font-mono text-[9px] uppercase text-muted-foreground">{t("marketplaceFiles")} · {preview.files.length}</p>{preview.files.map((file) => <div className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[10px]" key={file.path}><FileText className="h-3 w-3 shrink-0 text-[#72804f]" /><span className="truncate" title={file.path}>{file.path}</span><span className="ml-auto shrink-0 text-[8px] text-muted-foreground">{Math.max(1, Math.ceil(file.size / 1024))} KB</span></div>)}</div><div className="min-w-0 overflow-hidden"><div className="flex items-center justify-between border-b border-border px-3 py-2"><code className="text-[10px]">SKILL.md</code><code className="text-[8px] text-muted-foreground">{preview.commitSha.slice(0, 8)}</code></div><SkillMarkdownPreview markdown={preview.skillMarkdown} onOpenUrl={onOpenUrl} /></div></div> : error ? <div className="mt-5 flex min-h-28 items-start gap-2 rounded-[7px] border border-destructive/30 bg-destructive/5 p-4 text-[11px] leading-5 text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
          <p className="mt-4 flex items-start gap-2 rounded-[6px] bg-[#f5f1e7] px-3 py-2 text-[10px] leading-4 text-[#79683f] dark:bg-[#41392a] dark:text-[#e1c98c]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("marketplaceThirdPartyWarning")}</p>
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3"><span className="text-[9px] text-muted-foreground">{preview ? `${preview.files.length} ${t("marketplaceFiles").toLowerCase()} · ${Math.ceil(preview.files.reduce((sum, file) => sum + file.size, 0) / 1024)} KB` : ""}</span><Button className="h-8 gap-1.5 text-[11px]" disabled={busy || installed || !preview} onClick={onInstall} type="button">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : installed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{installed ? t("marketplaceInstalledStatus") : busy ? t("marketplaceInstallingSkill") : t("marketplaceInstallSkill")}</Button></div>
      </> : null}
    </DialogContent>
  </Dialog>;
}

type MarketplaceIconTone = "source" | "collaboration" | "documents" | "projects" | "data" | "web" | "cloud" | "automation" | "security" | "ai" | "media" | "neutral";

type MarketplaceIconPresentation = {
  Icon?: LucideIcon;
  imageSrc?: string;
  label: string;
  tone: MarketplaceIconTone;
};

const marketplaceIconTones: Record<MarketplaceIconTone, string> = {
  source: "bg-[#edf0f3] text-[#4b5d6c] dark:bg-[#303940] dark:text-[#c5d0d8]",
  collaboration: "bg-[#f8ece8] text-[#a55e4e] dark:bg-[#4b322d] dark:text-[#f0b5a6]",
  documents: "bg-[#f4efe6] text-[#8a6831] dark:bg-[#463b2b] dark:text-[#e8cc92]",
  projects: "bg-[#eeeef6] text-[#65659b] dark:bg-[#36364e] dark:text-[#c5c4f0]",
  data: "bg-[#e8f2f6] text-[#39718d] dark:bg-[#294250] dark:text-[#a8d7eb]",
  web: "bg-[#e8f3ef] text-[#28755e] dark:bg-[#29443a] dark:text-[#a9dbc5]",
  cloud: "bg-[#e8eff8] text-[#4c719f] dark:bg-[#2e4056] dark:text-[#b4cdf0]",
  automation: "bg-[#f8f0e3] text-[#946c2b] dark:bg-[#4c3b25] dark:text-[#eac486]",
  security: "bg-[#e9f3e9] text-[#39734c] dark:bg-[#294531] dark:text-[#aee1bb]",
  ai: "bg-[#f1edf8] text-[#76589b] dark:bg-[#40344f] dark:text-[#d2b8ec]",
  media: "bg-[#f8ecef] text-[#a4586b] dark:bg-[#4b3039] dark:text-[#efb4c3]",
  neutral: "bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]",
};

function includesAny(value: string, terms: string[]) {
  const tokens = ` ${value.replace(/[^a-z0-9]+/g, " ")} `;
  return terms.some((term) => tokens.includes(` ${term.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `));
}

function marketplaceIconPresentation(entry: McpMarketplaceEntry): MarketplaceIconPresentation {
  const identity = `${entry.name} ${entry.title} ${entry.publisher}`.toLowerCase();
  const context = `${identity} ${entry.description} ${entry.capabilities.join(" ")}`.toLowerCase();
  const matchesIdentity = (...terms: string[]) => includesAny(identity, terms);
  const matches = (...terms: string[]) => includesAny(context, terms);

  // Specific service marks take precedence, then the broader job the MCP server performs.
  if (matchesIdentity("github")) return { imageSrc: githubIcon, label: "GitHub", tone: "source" };
  if (matchesIdentity("figma")) return { imageSrc: figmaIcon, label: "Figma", tone: "projects" };
  if (matchesIdentity("firecrawl")) return { imageSrc: firecrawlIcon, label: "Firecrawl", tone: "web" };
  if (matchesIdentity("postgres", "postgresql")) return { imageSrc: postgresqlIcon, label: "PostgreSQL", tone: "data" };
  if (matchesIdentity("openai", "chatgpt")) return { imageSrc: openaiIcon, label: "OpenAI", tone: "ai" };
  if (matchesIdentity("cloudflare")) return { imageSrc: cloudflareIcon, label: "Cloudflare", tone: "cloud" };
  if (matchesIdentity("vercel")) return { imageSrc: vercelIcon, label: "Vercel", tone: "cloud" };
  if (matchesIdentity("google cloud", "gcp")) return { imageSrc: googleCloudIcon, label: "Google Cloud", tone: "cloud" };

  if (matches("gitlab", "bitbucket", "source control", "repository", "version control", "git")) return { Icon: GitBranch, label: "Source control", tone: "source" };
  if (matches("slack", "discord", "microsoft teams", "mattermost", "feishu", "lark", "dingtalk", "chat")) return { Icon: MessagesSquare, label: "Team communication", tone: "collaboration" };
  if (matches("linear", "jira", "trello", "asana", "clickup", "project management", "issue tracker", "kanban")) return { Icon: KanbanSquare, label: "Project management", tone: "projects" };
  if (matches("notion", "confluence", "documentation", "knowledge base", "wiki")) return { Icon: BookOpen, label: "Documentation", tone: "documents" };
  if (matches("calendar", "schedule", "scheduling")) return { Icon: CalendarDays, label: "Calendar", tone: "collaboration" };
  if (matches("gmail", "outlook", "email", "mail")) return { Icon: Mail, label: "Email", tone: "collaboration" };
  if (matches("google drive", "gdrive", "dropbox", "onedrive", "file system", "filesystem", "file storage")) return { Icon: FolderTree, label: "File storage", tone: "documents" };
  if (matches("mysql", "sqlite", "supabase", "mongodb", "database", " sql ", "data warehouse")) return { Icon: Database, label: "Database", tone: "data" };
  if (matches("airtable", "spreadsheet", "table", "dataset")) return { Icon: Boxes, label: "Structured data", tone: "data" };
  if (matches("analytics", "metrics", "dashboard", "business intelligence")) return { Icon: ChartNoAxesCombined, label: "Analytics", tone: "data" };
  if (matches("stripe", "paypal", "payment", "billing", "invoice")) return { Icon: CreditCard, label: "Payments", tone: "automation" };
  if (matches("map", "geocode", "location", "places")) return { Icon: MapPin, label: "Location", tone: "web" };
  if (matches("image", "vision", "photo", "illustration")) return { Icon: Image, label: "Images", tone: "media" };
  if (matches("video", "youtube", "recording")) return { Icon: Video, label: "Video", tone: "media" };
  if (matches("audio", "music", "podcast", "speech", "voice")) return { Icon: AudioLines, label: "Audio", tone: "media" };
  if (matches("openapi", "browser", "web search", "search", "crawl", "scrape", "website", "http")) return { Icon: Search, label: "Web research", tone: "web" };
  if (matches("aws", "azure", "cloud", "kubernetes", "docker", "container", "deployment")) return { Icon: Container, label: "Cloud infrastructure", tone: "cloud" };
  if (matches("security", "authentication", "authorization", "oauth", "secret", "credential")) return { Icon: KeyRound, label: "Security", tone: "security" };
  if (matches("workflow", "automation", "zapier", "n8n", "webhook", "integration")) return { Icon: Workflow, label: "Automation", tone: "automation" };
  if (matches("ai", "llm", "model", "agent", "assistant", "embedding")) return { Icon: BrainCircuit, label: "AI", tone: "ai" };
  if (matches("code", "developer", "programming", "debug", "terminal", "ide")) return { Icon: Code2, label: "Developer tools", tone: "source" };
  if (matches("document", "pdf", "markdown", "text")) return { Icon: FileText, label: "Documents", tone: "documents" };
  if (matches("storage", "disk", "directory", "folder")) return { Icon: HardDrive, label: "Storage", tone: "documents" };
  if (entry.transport === "streamable-http") return { Icon: Network, label: "Remote MCP server", tone: "web" };
  if (entry.transport === "stdio") return { Icon: Terminal, label: "Local MCP server", tone: "automation" };
  return { Icon: Bot, label: "MCP server", tone: "neutral" };
}

function MarketplaceConnectorIcon({ entry }: { entry: McpMarketplaceEntry }) {
  const [available, setAvailable] = useState(Boolean(entry.iconUrl));
  useEffect(() => setAvailable(Boolean(entry.iconUrl)), [entry.iconUrl]);
  const presentation = marketplaceIconPresentation(entry);
  const Icon = presentation.Icon;
  return <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[7px]", marketplaceIconTones[presentation.tone])} title={presentation.label}>
    {available && entry.iconUrl ? <img alt="" className="h-7 w-7 object-contain" decoding="async" loading="lazy" onError={() => setAvailable(false)} referrerPolicy="no-referrer" src={entry.iconUrl} /> : presentation.imageSrc ? <img alt="" className="h-7 w-7 object-contain" src={presentation.imageSrc} /> : Icon ? <Icon className="h-[19px] w-[19px] stroke-[1.85]" /> : null}
  </span>;
}

function marketplacePrimaryActionLabel(entry: McpMarketplaceEntry, installed: boolean, updateAvailable: boolean, t: Translate) {
  if (updateAvailable) return `${t("marketplaceUpdateTo")} v${entry.version}`;
  return installed ? t("marketplaceInstalledStatus") : t("marketplaceInstallConnector");
}

function marketplaceTransportLabel(entry: McpMarketplaceEntry, t: Translate) {
  if (entry.transport === "streamable-http") return t("marketplaceRemoteHttp");
  if (entry.transport === "stdio") return t("marketplaceLocalStdio");
  return t("marketplaceManualSetupRequired");
}

function MarketConnectorCard({ entry, installed, updateAvailable, busy, onInstall, onOpen, onSetup }: { entry: McpMarketplaceEntry; installed: boolean; updateAvailable: boolean; busy: boolean; onInstall: () => void; onOpen: () => void; onSetup: () => void }) {
  const { t } = usePreferences();
  const canInstall = entry.installable || installed;
  const actionLabel = busy ? installed ? t("marketplaceUpdating") : t("marketplaceInstalling") : canInstall ? marketplacePrimaryActionLabel(entry, installed, updateAvailable, t) : t("marketplaceOpenSetupGuide");
  return <article className="relative min-w-0 rounded-[8px] border border-[#e3e3de] bg-white transition-colors hover:border-[#cfcfc8] dark:border-border dark:bg-card">
    <button aria-label={`${t("marketplaceViewDetails")}: ${entry.title}`} className="flex w-full flex-col rounded-[7px] p-4 pr-12 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#b8c991] dark:focus-visible:ring-[#6f8346]" onClick={onOpen} type="button">
      <div className="flex items-start gap-3"><MarketplaceConnectorIcon entry={entry} /><div className="min-w-0"><h3 className="truncate text-[13px] font-semibold text-[#33332f] dark:text-foreground" title={entry.title}>{entry.title}</h3><p className="mt-1 truncate text-[10px] text-[#8a8a83] dark:text-muted-foreground" title={`${entry.publisher} · ${entry.version}`}>{entry.publisher} · v{entry.version}</p></div></div>
      <p className="mt-3 min-h-[54px] text-[11px] leading-[18px] text-[#6e6e67] dark:text-muted-foreground">{entry.description}</p>
    </button>
    <Tooltip><TooltipTrigger asChild><button aria-label={actionLabel} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-[#d8d8d3] text-[#92928b] transition-colors hover:bg-[#f3f3f0] hover:text-[#5c5c56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8c991] disabled:cursor-default disabled:opacity-60 dark:border-border dark:hover:bg-muted" disabled={busy || (installed && !updateAvailable)} onClick={(event) => { event.stopPropagation(); if (canInstall) onInstall(); else onSetup(); }} type="button">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : updateAvailable ? <RefreshCw className="h-3.5 w-3.5" /> : installed ? <CheckCircle2 className="h-3.5 w-3.5" /> : canInstall ? <Plus className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}</button></TooltipTrigger><TooltipContent>{actionLabel}</TooltipContent></Tooltip>
  </article>;
}

function MarketplaceConnectorDetailDialog({ busy, entry, installed, updateAvailable, onInstall, onOpenChange, onOpenDocumentation, onSetup }: { busy: boolean; entry: McpMarketplaceEntry | null; installed: boolean; updateAvailable: boolean; onInstall: () => void; onOpenChange: (open: boolean) => void; onOpenDocumentation: (url: string) => void; onSetup: () => void }) {
  const { t } = usePreferences();
  const canInstall = Boolean(entry && (entry.installable || installed));
  const canAdd = Boolean(entry?.installable && !installed);
  const documentationUrl = entry?.websiteUrl ?? entry?.repositoryUrl ?? null;
  const documentationLabel = entry?.websiteUrl ? t("marketplacePublisherWebsite") : entry?.repositoryUrl ? t("marketplaceSourceRepository") : null;
  return <Dialog onOpenChange={onOpenChange} open={entry !== null}>
    <DialogContent className="flex max-h-[min(680px,calc(100vh-2rem))] w-[min(35rem,calc(100vw-2rem))] flex-col rounded-[10px] p-0" showCloseButton={false}>
      {entry ? <>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <MarketplaceConnectorIcon entry={entry} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2"><DialogTitle className="truncate text-[15px] font-semibold">{entry.title}</DialogTitle>{updateAvailable ? <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-[#eef4e4] px-1.5 py-0.5 text-[9px] font-medium text-[#5d733b] dark:bg-[#34412b] dark:text-[#c8dba9]"><RefreshCw className="h-2.5 w-2.5" />{t("marketplaceUpdateAvailable")}</span> : null}</div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{entry.publisher} · v{entry.version}</p>
          </div>
          <DialogClose asChild><button aria-label={t("marketplaceCloseDetails")} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" type="button"><X className="h-4 w-4" /></button></DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12px] leading-5 text-[#575750] dark:text-muted-foreground">{entry.description}</p>
          <dl className="mt-5 grid grid-cols-[116px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[11px]">
            {entry.packageName ? <><dt className="text-muted-foreground">{t("marketplacePackage")}</dt><dd className="break-all font-mono text-[10px]">{entry.packageName}{entry.setup?.packageVersion ? `@${entry.setup.packageVersion}` : ""}</dd></> : null}
            {entry.url ? <><dt className="text-muted-foreground">{t("marketplaceMcpUrl")}</dt><dd className="break-all font-mono text-[10px]">{entry.url}</dd></> : null}
            {documentationUrl && documentationLabel ? <><dt className="text-muted-foreground">{documentationLabel}</dt><dd className="min-w-0"><button className="inline-flex max-w-full items-center gap-1 text-left text-[#5f7444] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8c991] dark:text-[#c4dc91]" onClick={() => onOpenDocumentation(documentationUrl)} type="button"><span className="truncate">{documentationUrl}</span><ExternalLink className="h-3 w-3 shrink-0" /></button></dd></> : null}
          </dl>
        </div>
        {canAdd || !canInstall ? <div className="flex justify-end border-t border-border px-5 py-3">
          {canAdd ? <Tooltip><TooltipTrigger asChild><Button aria-label={t("marketplaceAddConnector")} disabled={busy} onClick={onInstall} size="icon" type="button">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}</Button></TooltipTrigger><TooltipContent>{t("marketplaceAddConnector")}</TooltipContent></Tooltip> : null}
          {!canInstall ? <Tooltip><TooltipTrigger asChild><Button aria-label={t("marketplaceOpenSetupGuide")} onClick={onSetup} size="icon" type="button" variant="outline"><Settings2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>{t("marketplaceOpenSetupGuide")}</TooltipContent></Tooltip> : null}
        </div> : null}
      </> : null}
    </DialogContent>
  </Dialog>;
}

function MarketplaceSetupDialog({ entry, onOpenChange, onOpenDocumentation }: { entry: McpMarketplaceEntry | null; onOpenChange: (open: boolean) => void; onOpenDocumentation: (url: string) => void }) {
  const { t } = usePreferences();
  const setup = entry?.setup ?? {
    registryType: null,
    packageVersion: null,
    runtimeHint: null,
    suggestedCommand: null,
    requiredInputs: [],
    documentationUrl: entry?.websiteUrl ?? entry?.repositoryUrl ?? null,
    documentationLabel: entry?.websiteUrl ? "Publisher website" as const : entry?.repositoryUrl ? "Source repository" as const : null,
  };
  const documentationLabel = setup.documentationLabel === "Publisher website" ? t("marketplacePublisherWebsite") : setup.documentationLabel === "Source repository" ? t("marketplaceSourceRepository") : null;
  return <Dialog onOpenChange={onOpenChange} open={entry !== null}>
    <DialogContent className="w-[min(34rem,calc(100vw-2rem))] rounded-[10px] p-0" showCloseButton={false}>
      {entry ? <>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <MarketplaceConnectorIcon entry={entry} />
          <div className="min-w-0 flex-1"><DialogTitle className="truncate text-[15px] font-semibold">{entry.title}</DialogTitle><p className="mt-1 text-[10px] text-muted-foreground">{t("marketplaceSetupMetadata")}</p></div>
          <DialogClose asChild><button aria-label={t("marketplaceCloseSetup")} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" type="button"><X className="h-4 w-4" /></button></DialogClose>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <p className="text-[11px] leading-5 text-muted-foreground">{t("marketplaceSetupUnavailableIntro")}</p>
          <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">{t("marketplaceTransport")}</dt><dd>{marketplaceTransportLabel(entry, t)}</dd>
            {setup.registryType ? <><dt className="text-muted-foreground">{t("marketplacePackageType")}</dt><dd>{setup.registryType}</dd></> : null}
            {entry.packageName ? <><dt className="text-muted-foreground">{t("marketplacePackage")}</dt><dd className="break-all font-mono text-[10px]">{entry.packageName}{setup.packageVersion ? `@${setup.packageVersion}` : ""}</dd></> : null}
            {setup.documentationUrl && documentationLabel ? <><dt className="text-muted-foreground">{documentationLabel}</dt><dd className="min-w-0"><button className="inline-flex max-w-full items-center gap-1 text-left text-[#5f7444] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8c991] dark:text-[#c4dc91]" onClick={() => onOpenDocumentation(setup.documentationUrl!)} type="button"><span className="truncate">{setup.documentationUrl}</span><ExternalLink className="h-3 w-3 shrink-0" /></button></dd></> : null}
            {entry.url ? <><dt className="text-muted-foreground">{t("marketplaceMcpUrl")}</dt><dd className="break-all font-mono text-[10px]">{entry.url}</dd></> : null}
          </dl>
          {setup.suggestedCommand ? <div className="mt-5"><p className="flex items-center gap-1.5 text-[11px] font-semibold"><Terminal className="h-3.5 w-3.5" />{t("marketplaceSuggestedCommand")}</p><code className="mt-2 block overflow-x-auto rounded-[6px] bg-muted px-3 py-2 font-mono text-[10px]">{setup.suggestedCommand}</code><p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">{t("marketplaceConfigurationOnly")}</p></div> : null}
          {setup.requiredInputs.length ? <div className="mt-5"><p className="text-[11px] font-semibold">{t("marketplaceRequiredConfiguration")}</p><div className="mt-2 space-y-2">{setup.requiredInputs.map((input) => <div className="rounded-[6px] border border-border px-3 py-2" key={`${input.kind}:${input.name}`}><div className="flex items-center justify-between gap-3"><code className="font-mono text-[10px]">{input.name}</code><span className="text-[9px] text-muted-foreground">{input.kind === "header" ? t("marketplaceHeader") : t("marketplaceEnvironment")}{input.secret ? ` · ${t("marketplaceSecret")}` : ""}</span></div>{input.description ? <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{input.description}</p> : null}</div>)}</div></div> : null}
          {!setup.documentationUrl ? <p className="mt-5 rounded-[6px] bg-muted px-3 py-2 text-[10px] leading-4 text-muted-foreground">{t("marketplaceNoPublisherLinks")}</p> : null}
        </div>
      </> : null}
    </DialogContent>
  </Dialog>;
}

function sortMarketplaceEntries(entries: McpMarketplaceEntry[]): McpMarketplaceEntry[] {
  const rank = (entry: McpMarketplaceEntry) => entry.installable ? 0 : entry.transport === "streamable-http" ? 1 : 2;
  return [...entries].sort((left, right) => rank(left) - rank(right) || left.title.localeCompare(right.title));
}

function MarketIntro({ kind, stale }: { kind: "skills" | "connectors"; stale?: boolean }) {
  const { t } = usePreferences();
  return <div className="mb-7 flex items-start justify-between gap-5 border-b border-[#e5e5e0] pb-5 dark:border-border"><div><div className="flex items-center gap-2"><h1 className="text-[20px] font-semibold text-[#282824] dark:text-foreground">{kind === "skills" ? t("marketplaceDiscoverSkills") : t("marketplaceDiscoverConnectors")}</h1></div><p className="mt-2 max-w-[620px] text-[12px] leading-5 text-[#777770] dark:text-muted-foreground">{kind === "skills" ? t("marketplaceSkillsIntro") : t("marketplaceConnectorsIntro")}</p></div><span className="hidden items-center gap-1.5 text-[10px] text-[#7f8b6e] sm:flex"><ShieldCheck className="h-3.5 w-3.5" />{stale ? t("marketplaceOfflineCache") : kind === "skills" ? "SkillsMP" : t("marketplaceOfficialRegistry")}</span></div>;
}

export function SkillsView({ onOpenImport }: { onOpenImport: () => void }) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [activeTab, setActiveTab] = useState<"skills" | "connectors">("skills");
  const [viewMode, setViewMode] = useState<"discover" | "installed">("discover");
  const [busy, setBusy] = useState<string | null>(null);
  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [marketConnectors, setMarketConnectors] = useState<McpMarketplaceEntry[]>([]);
  const [marketCursor, setMarketCursor] = useState<string | null>(null);
  const [marketStale, setMarketStale] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);
  const [selectedMarketConnector, setSelectedMarketConnector] = useState<McpMarketplaceEntry | null>(null);
  const [setupEntry, setSetupEntry] = useState<McpMarketplaceEntry | null>(null);
  const [marketSkills, setMarketSkills] = useState<SkillMarketplaceEntry[]>([]);
  const [skillMarketPage, setSkillMarketPage] = useState(1);
  const [skillMarketHasNext, setSkillMarketHasNext] = useState(false);
  const [skillMarketStale, setSkillMarketStale] = useState(false);
  const [skillMarketKeyword, setSkillMarketKeyword] = useState("productivity");
  const [selectedMarketSkill, setSelectedMarketSkill] = useState<SkillMarketplaceEntry | null>(null);
  const [marketSkillPreview, setMarketSkillPreview] = useState<SkillMarketplacePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const workspaceNames = new Map((snapshot?.workspaces ?? []).map((workspace) => [workspace.id, workspace.name]));
  const skills = useMemo(() => (snapshot?.skills.skills ?? []).filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.trim().toLowerCase())), [query, snapshot?.skills.skills]);
  const globalSkills = skills.filter((skill) => skill.workspaceId === null);
  const workspaceSkills = skills.filter((skill) => skill.workspaceId !== null);
  const installedRegistryEntries = new Map((snapshot?.connectors.connectors ?? []).flatMap((connector) => connector.marketplace ? [[connector.marketplace.registryName, connector.marketplace] as const] : []));
  const selectedInstalledEntry = selectedMarketConnector ? installedRegistryEntries.get(selectedMarketConnector.name) : undefined;
  const selectedUpdateAvailable = Boolean(selectedMarketConnector && selectedInstalledEntry && !marketStale && selectedInstalledEntry.version !== selectedMarketConnector.version);
  const installedMarketSkills = new Map((snapshot?.skills.skills ?? []).flatMap((skill) => skill.marketplace ? [[skill.marketplace.id, skill] as const] : []));
  const effectiveSkillMarketQuery = query.trim().length >= 2 ? query.trim() : skillMarketKeyword;

  useEffect(() => {
    if (activeTab !== "connectors" || viewMode !== "discover") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMarketLoading(true);
      setError(null);
      void client.searchMcpMarketplace(query.trim()).then((page) => {
        if (cancelled) return;
        setMarketConnectors(sortMarketplaceEntries(page.entries));
        setMarketCursor(page.nextCursor);
        setMarketStale(page.stale);
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (!cancelled) setMarketLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, client, query, viewMode]);

  useEffect(() => {
    if (activeTab !== "skills" || viewMode !== "discover" || (query.trim().length === 1)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMarketLoading(true);
      setError(null);
      void client.searchSkillMarketplace(effectiveSkillMarketQuery, 1, "stars").then((page) => {
        if (cancelled) return;
        setMarketSkills(page.entries);
        setSkillMarketPage(page.page);
        setSkillMarketHasNext(page.hasNext);
        setSkillMarketStale(page.stale);
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (!cancelled) setMarketLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, client, effectiveSkillMarketQuery, query, viewMode]);

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const currentSelectedSkill = selectedSkill ? snapshot?.skills.skills.find((skill) => skill.id === selectedSkill.id) ?? selectedSkill : null;
  if (currentSelectedSkill) return <SkillDetail busy={busy !== null} onBack={() => setSelectedSkill(null)} onRemove={() => void run(`remove:${currentSelectedSkill.id}`, async () => await client.removeManagedSkill(currentSelectedSkill.id))} onToggle={(enabled) => void run(`toggle:${currentSelectedSkill.id}`, async () => await client.setSkillEnabled(currentSelectedSkill.id, enabled))} skill={currentSelectedSkill} />;

  const installConnector = async (entry: McpMarketplaceEntry) => {
    setBusy(`install:${entry.id}`);
    setError(null);
    try {
      await client.installMcpMarketplaceEntry(entry.name);
      await refresh();
      setSelectedMarketConnector(null);
      setViewMode("installed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const loadMore = async () => {
    if (!marketCursor || marketLoading) return;
    setMarketLoading(true);
    setError(null);
    try {
      const page = await client.searchMcpMarketplace(query.trim(), marketCursor);
      setMarketConnectors((current) => sortMarketplaceEntries([...current, ...page.entries.filter((entry) => !current.some((item) => item.id === entry.id))]));
      setMarketCursor(page.nextCursor);
      setMarketStale(page.stale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMarketLoading(false);
    }
  };

  const loadMoreSkills = async () => {
    if (!skillMarketHasNext || marketLoading) return;
    setMarketLoading(true);
    setError(null);
    try {
      const page = await client.searchSkillMarketplace(effectiveSkillMarketQuery, skillMarketPage + 1, "stars");
      setMarketSkills((current) => [...current, ...page.entries.filter((entry) => !current.some((item) => item.id === entry.id))]);
      setSkillMarketPage(page.page);
      setSkillMarketHasNext(page.hasNext);
      setSkillMarketStale(page.stale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMarketLoading(false);
    }
  };

  const refreshSkillMarket = async () => {
    setMarketLoading(true);
    setError(null);
    try {
      const page = await client.searchSkillMarketplace(effectiveSkillMarketQuery, 1, "stars", true);
      setMarketSkills(page.entries);
      setSkillMarketPage(page.page);
      setSkillMarketHasNext(page.hasNext);
      setSkillMarketStale(page.stale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMarketLoading(false);
    }
  };

  const openMarketSkill = async (entry: SkillMarketplaceEntry) => {
    const requestId = ++previewRequest.current;
    setSelectedMarketSkill(entry);
    setMarketSkillPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setError(null);
    try {
      const preview = await client.previewSkillMarketplace(entry.id);
      if (requestId === previewRequest.current) setMarketSkillPreview(preview);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (requestId === previewRequest.current) setPreviewError(message);
    } finally {
      if (requestId === previewRequest.current) setPreviewLoading(false);
    }
  };

  const installMarketSkill = async () => {
    if (!selectedMarketSkill || !marketSkillPreview) return;
    setBusy(`skill-install:${selectedMarketSkill.id}`);
    setError(null);
    try {
      await client.installSkillMarketplacePreview(marketSkillPreview.previewId);
      await refresh();
      setSelectedMarketSkill(null);
      setMarketSkillPreview(null);
      setViewMode("installed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const quickInstallMarketSkill = async (entry: SkillMarketplaceEntry) => {
    if (installedMarketSkills.has(entry.id)) return;
    setBusy(`skill-install:${entry.id}`);
    setError(null);
    try {
      const preview = selectedMarketSkill?.id === entry.id && marketSkillPreview
        ? marketSkillPreview
        : await client.previewSkillMarketplace(entry.id);
      await client.installSkillMarketplacePreview(preview.previewId);
      await refresh();
      setViewMode("installed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const refreshMarket = async () => {
    setMarketLoading(true);
    setError(null);
    try {
      const page = await client.searchMcpMarketplace(query.trim(), undefined, true);
      setMarketConnectors(sortMarketplaceEntries(page.entries));
      setMarketCursor(page.nextCursor);
      setMarketStale(page.stale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMarketLoading(false);
    }
  };
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
    <div className="mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col">
      <div className="shrink-0 bg-[var(--wordless-shell-workspace)] px-7 pb-6 pt-8 lg:px-10">
        <header className="flex shrink-0 items-center justify-between gap-4">
          <nav aria-label="Skills and connectors" className="inline-flex border-b border-[#deded9] dark:border-border">
            <button className={cn("border-b-2 px-4 pb-2 text-[13px] font-semibold", activeTab === "skills" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881]")} onClick={() => { setActiveTab("skills"); setViewMode("discover"); setQuery(""); }} type="button">{t("skills")}</button>
            <button className={cn("border-b-2 px-4 pb-2 text-[13px] font-semibold", activeTab === "connectors" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881]")} onClick={() => { setActiveTab("connectors"); setViewMode("discover"); setQuery(""); }} type="button">MCP</button>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <label className="relative w-[240px]"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8d8d86]" /><input aria-label={activeTab === "skills" ? t("searchSkills") : t("connectors")} className="h-8 w-full rounded-[7px] border border-[#deded9] bg-white py-0 pl-8 pr-3 text-[12px] outline-none placeholder:text-[#a0a09a] focus:border-[#aeb58e] focus:ring-2 focus:ring-[#dfe5d1] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === "skills" ? t("searchSkills") : t("connectors")} value={query} /></label>
            {activeTab === "skills" ? <Button aria-label={t("importSkill")} className="border border-[#deded9] bg-white" onClick={onOpenImport} size="icon" type="button" variant="ghost"><Upload className="h-3.5 w-3.5" /></Button> : <Button className="h-8 gap-1.5 border border-[#deded9] bg-white px-2.5 text-[12px]" onClick={() => setConnectorDialogOpen(true)} type="button" variant="ghost"><Cable className="h-3.5 w-3.5" />{t("marketplaceCustomConnector")}</Button>}
            <Button aria-label={t("marketplaceRefresh")} className="border border-[#deded9] bg-white" disabled={busy !== null || marketLoading} onClick={() => viewMode === "installed" ? void run("refresh", async () => await client.refreshSkills()) : activeTab === "skills" ? void refreshSkillMarket() : void refreshMarket()} size="icon" type="button" variant="ghost"><RefreshCw className={cn("h-3.5 w-3.5", (busy === "refresh" || marketLoading) && "animate-spin")} /></Button>
          </div>
        </header>
        <nav aria-label="Skills and MCP view" className="mt-6 inline-flex rounded-[7px] border border-[#deded9] bg-[#f2f2ef] p-0.5 dark:border-border dark:bg-muted"><button className={cn("h-7 rounded-[5px] px-3 text-[11px] font-semibold", viewMode === "discover" ? "bg-white text-[#39491d] shadow-sm dark:bg-card dark:text-[#d7ef99]" : "text-[#777770]")} onClick={() => setViewMode("discover")} type="button">{t("marketplaceDiscover")}</button><button className={cn("h-7 rounded-[5px] px-3 text-[11px] font-semibold", viewMode === "installed" ? "bg-white text-[#39491d] shadow-sm dark:bg-card dark:text-[#d7ef99]" : "text-[#777770]")} onClick={() => setViewMode("installed")} type="button">{t("marketplaceInstalled")}</button></nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 lg:px-10">
        {viewMode === "discover" ? <div className="pt-7"><MarketIntro kind={activeTab === "skills" ? "skills" : "connectors"} stale={activeTab === "skills" ? skillMarketStale : marketStale} />{activeTab === "skills" ? <nav aria-label={t("marketplacePopularKeywords")} className="mb-5 -mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div className="flex min-w-max items-center gap-1"><span className="sr-only">{t("marketplacePopularKeywords")}</span>{skillMarketKeywords.map((keyword) => <button aria-pressed={query.trim() === "" && skillMarketKeyword === keyword.query} className={cn("h-8 shrink-0 whitespace-nowrap rounded-[6px] px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", query.trim() === "" && skillMarketKeyword === keyword.query ? "bg-[#efefeb] text-[#343431] dark:bg-muted dark:text-foreground" : "text-[#777770] hover:bg-[#f3f3f0] hover:text-[#454540] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground")} key={keyword.query} onClick={() => { setQuery(""); setSkillMarketKeyword(keyword.query); }} type="button">{keyword.label}</button>)}</div></nav> : null}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{activeTab === "skills" ? marketSkills.map((entry) => <MarketSkillCard entry={entry} installDisabled={busy !== null} installed={installedMarketSkills.has(entry.id)} installing={busy === `skill-install:${entry.id}`} key={entry.id} onInstall={() => void quickInstallMarketSkill(entry)} onOpen={() => void openMarketSkill(entry)} />) : marketConnectors.map((entry) => { const installedEntry = installedRegistryEntries.get(entry.name); return <MarketConnectorCard busy={busy === `install:${entry.id}`} entry={entry} installed={Boolean(installedEntry)} key={`${entry.id}:${entry.version}`} onInstall={() => void installConnector(entry)} onOpen={() => setSelectedMarketConnector(entry)} onSetup={() => setSetupEntry(entry)} updateAvailable={Boolean(installedEntry && !marketStale && installedEntry.version !== entry.version)} />; })}</div>{marketLoading && (activeTab === "skills" ? marketSkills.length === 0 : marketConnectors.length === 0) ? <div className="flex h-40 items-center justify-center gap-2 text-[12px] text-[#7b7b74]"><LoaderCircle className="h-4 w-4 animate-spin" />{activeTab === "skills" ? t("marketplaceLoadingSkills") : t("marketplaceLoading")}</div> : null}{!marketLoading && (activeTab === "skills" ? marketSkills.length === 0 : marketConnectors.length === 0) ? <p className="py-16 text-center text-[12px] text-[#8b8b84]">{activeTab === "skills" ? t("marketplaceNoSkillMatches") : t("marketplaceNoMatches")}</p> : null}{activeTab === "skills" && skillMarketHasNext ? <div className="mt-6 flex justify-center"><Button className="h-8 gap-2 text-[11px]" disabled={marketLoading} onClick={() => void loadMoreSkills()} type="button" variant="outline">{marketLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{t("marketplaceLoadMore")}</Button></div> : null}{activeTab === "connectors" && marketCursor ? <div className="mt-6 flex justify-center"><Button className="h-8 gap-2 text-[11px]" disabled={marketLoading} onClick={() => void loadMore()} type="button" variant="outline">{marketLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{t("marketplaceLoadMore")}</Button></div> : null}</div> : activeTab === "skills" ? <div className="pt-8"><SkillSection label={t("globalSkills")} meta="Available in every workspace" onSelect={setSelectedSkill} skills={globalSkills} /><SkillSection label={t("workspaceSkills")} meta={workspaceSkills.length === 1 ? workspaceNames.get(workspaceSkills[0]!.workspaceId!) ?? t("workspaceName") : `${workspaceSkills.length} skills`} onSelect={setSelectedSkill} skills={workspaceSkills} />{snapshot?.skills.diagnostics.length ? <div className="mb-8 border-t border-[#e7e7e2] pt-4 dark:border-border"><p className="font-mono text-[10px] uppercase text-[#8b6d39]">{t("skillDiagnostics")}</p>{snapshot.skills.diagnostics.map((diagnostic) => <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#846a3c]" key={`${diagnostic.source}:${diagnostic.path}:${diagnostic.message}`}><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{diagnostic.message}</p>)}</div> : null}</div> : <ConnectorsView dialogOpen={connectorDialogOpen} onDialogOpenChange={setConnectorDialogOpen} query={query} />}
        {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}
      </div>
    </div>
    <MarketplaceConnectorDetailDialog busy={busy === `install:${selectedMarketConnector?.id}`} entry={selectedMarketConnector} installed={Boolean(selectedInstalledEntry)} onInstall={() => selectedMarketConnector && void installConnector(selectedMarketConnector)} onOpenChange={(open) => { if (!open) setSelectedMarketConnector(null); }} onOpenDocumentation={(url) => void client.openExternalUrl(url)} onSetup={() => { if (!selectedMarketConnector) return; setSetupEntry(selectedMarketConnector); setSelectedMarketConnector(null); }} updateAvailable={selectedUpdateAvailable} />
    <MarketplaceSetupDialog entry={setupEntry} onOpenChange={(open) => { if (!open) setSetupEntry(null); }} onOpenDocumentation={(url) => void client.openExternalUrl(url)} />
    <SkillMarketplaceDetailDialog busy={busy === `skill-install:${selectedMarketSkill?.id}`} entry={selectedMarketSkill} error={previewError} installed={Boolean(selectedMarketSkill && installedMarketSkills.has(selectedMarketSkill.id))} onInstall={() => void installMarketSkill()} onOpenChange={(open) => { if (!open) { previewRequest.current += 1; setSelectedMarketSkill(null); setMarketSkillPreview(null); setPreviewError(null); setPreviewLoading(false); } }} onOpenUrl={(url) => void client.openExternalUrl(url)} preview={marketSkillPreview} previewLoading={previewLoading} />
  </section>;
}
