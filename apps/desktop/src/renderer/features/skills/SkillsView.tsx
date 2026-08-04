import { Button, Switch, cn } from "@wordless/ui-kit";
import { ArrowLeft, Cable, CircleAlert, Command, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { SkillSource, SkillSummary } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ConnectorsView } from "./ConnectorsView";

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

function skillIcon(skill: SkillSummary): string {
  // 取技能名称的首字母（支持中英文）
  const firstChar = skill.name.trim()[0];
  if (!firstChar) return "?";

  // 如果是中文字符，直接返回
  if (/[一-龥]/.test(firstChar)) {
    return firstChar;
  }

  // 英文字符转大写
  return firstChar.toUpperCase();
}

type SkillSectionProps = {
  label: string;
  meta: string;
  onSelect: (skill: SkillSummary) => void;
  skills: SkillSummary[];
};

function SkillSection({ label, meta, onSelect, skills }: SkillSectionProps) {
  return <section className="mb-9">
    <div className="flex items-baseline gap-2"><h2 className="text-[13px] font-semibold text-[#3d3d38] dark:text-foreground">{label}</h2><span className="font-mono text-[10px] text-[#96968f] dark:text-muted-foreground">{meta}</span></div>
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => {
        const iconText = skillIcon(skill);
        return <button className="group min-w-0 rounded-[8px] border border-[#e3e3de] bg-white p-3.5 text-left transition-colors hover:border-[#cfcfc8] hover:bg-[#fdfdfc] dark:border-border dark:bg-card dark:hover:bg-muted" key={skill.id} onClick={() => onSelect(skill)} type="button"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[#f2f2ef] text-[#55554f] dark:bg-muted dark:text-muted-foreground"><span className="text-[15px] font-semibold">{iconText}</span></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold text-[#3b3b37] dark:text-foreground">{skill.name}</span><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", skill.state === "active" ? "bg-[#7a8f52]" : "bg-[#b2b2ab]")} /></span><span className="mt-1 block h-9 overflow-hidden text-[11px] leading-[18px] text-[#7d7d76] dark:text-muted-foreground">{skill.description || skill.diagnostic || "No description available."}</span></span></div></button>;
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
    <div className="mt-14 flex items-start justify-between gap-6 border-b border-[#e1e1dc] pb-5 dark:border-border"><div className="min-w-0"><h1 className="text-[22px] font-semibold text-[#252522] dark:text-foreground">{skill.name}</h1><p className="mt-3 max-w-[720px] text-[14px] leading-6 text-[#54544f] dark:text-muted-foreground">{skill.description || skill.diagnostic || "No description available."}</p></div><div className="flex shrink-0 items-center gap-3"><Switch aria-label={skill.enabled ? t("disableModel") : t("enableModel")} checked={skill.enabled} disabled={busy || skill.state === "invalid"} onCheckedChange={onToggle} />{skill.source === "wordless" ? <Button aria-label="Remove skill" className="text-[#8d6252]" disabled={busy} onClick={onRemove} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button> : null}</div></div>
    <div className="mt-5 rounded-[10px] border border-[#e3e3de] bg-white p-5 dark:border-border dark:bg-card"><div className="flex justify-end gap-1"><Button aria-label="Preview skill" className={cn(!sourceOpen && "bg-[#f1f1ee] dark:bg-muted")} onClick={() => setSourceOpen(false)} size="icon" type="button" variant="ghost"><Search className="h-4 w-4" /></Button><Button aria-label="Show skill source" className={cn(sourceOpen && "bg-[#f1f1ee] dark:bg-muted")} onClick={() => setSourceOpen(true)} size="icon" type="button" variant="ghost"><Command className="h-4 w-4" /></Button></div>{sourceOpen ? <pre className="mt-6 overflow-auto font-mono text-[11px] leading-6 text-[#4d4d48] dark:text-muted-foreground">{`name: ${skill.name}\nsource: ${sourceNames[skill.source]}\nlocation: ${skill.filePath}\nscope: ${skill.workspaceId ?? "global"}\nstate: ${skill.state}\n\n${skill.description || skill.diagnostic || ""}`}</pre> : <div className="mt-4 text-[13px] leading-7 text-[#44443f] dark:text-foreground"><p className="text-[11px] text-[#86867f] dark:text-muted-foreground">source</p><p>{sourceNames[skill.source]}</p><p className="mt-4 text-[11px] text-[#86867f] dark:text-muted-foreground">location</p><p className="break-all font-mono text-[11px] leading-5">{skill.filePath}</p><p className="mt-6 font-semibold">{skill.name}</p><p className="mt-2">{skill.description || skill.diagnostic || "No description available."}</p></div>}</div>
  </section>;
}

export function SkillsView({ onOpenImport }: { onOpenImport: () => void }) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [activeTab, setActiveTab] = useState<"skills" | "connectors">("skills");
  const [busy, setBusy] = useState<string | null>(null);
  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const workspaceNames = new Map((snapshot?.workspaces ?? []).map((workspace) => [workspace.id, workspace.name]));
  const skills = useMemo(() => (snapshot?.skills.skills ?? []).filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.trim().toLowerCase())), [query, snapshot?.skills.skills]);
  const globalSkills = skills.filter((skill) => skill.workspaceId === null);
  const workspaceSkills = skills.filter((skill) => skill.workspaceId !== null);

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

  if (selectedSkill) return <SkillDetail busy={busy !== null} onBack={() => setSelectedSkill(null)} onRemove={() => void run(`remove:${selectedSkill.id}`, async () => await client.removeManagedSkill(selectedSkill.id))} onToggle={(enabled) => void run(`toggle:${selectedSkill.id}`, async () => await client.setSkillEnabled(selectedSkill.id, enabled))} skill={selectedSkill} />;

  return <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--wordless-shell-workspace)]"><div className="mx-auto w-full max-w-[1120px] px-7 py-8 lg:px-10"><header className="flex shrink-0 items-center justify-between gap-4"><nav aria-label="Skills and connectors" className="inline-flex border-b border-[#deded9] dark:border-border"><button className={cn("border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors", activeTab === "skills" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground")} onClick={() => { setActiveTab("skills"); setQuery(""); }} type="button">{t("skills")}</button><button className={cn("border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors", activeTab === "connectors" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground")} onClick={() => { setActiveTab("connectors"); setQuery(""); }} type="button">MCP</button></nav><div className="flex shrink-0 items-center gap-2"><label className="relative w-[240px]"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8d8d86]" /><input aria-label={activeTab === "skills" ? t("searchSkills") : t("connectors")} className="w-full rounded-[7px] border border-[#deded9] bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-[#a0a09a] focus:border-[#aeb58e] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === "skills" ? t("searchSkills") : t("connectors")} value={query} /></label>{activeTab === "skills" ? <Button aria-label={t("importSkill")} className="border border-[#deded9] bg-white text-[#5c5c56] hover:bg-[#f3f3f0] dark:border-border dark:bg-card" onClick={onOpenImport} size="icon" type="button" variant="ghost"><Upload className="h-3.5 w-3.5" /></Button> : <Button className="h-7 gap-1.5 border border-[#deded9] bg-white px-2.5 text-[12px] font-semibold text-[#5c5c56] hover:bg-[#f3f3f0] dark:border-border dark:bg-card" onClick={() => setConnectorDialogOpen(true)} type="button" variant="ghost"><Cable className="h-3.5 w-3.5" />Custom Connector</Button>}<Button aria-label={activeTab === "skills" ? t("refreshSkills") : "Refresh connectors"} className="border border-[#deded9] bg-white text-[#5c5c56] hover:bg-[#f3f3f0] dark:border-border dark:bg-card" disabled={busy !== null} onClick={() => activeTab === "skills" ? void run("refresh", async () => await client.refreshSkills()) : void refresh()} size="icon" type="button" variant="ghost"><RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} /></Button></div></header>{activeTab === "skills" ? <div className="pt-8"><SkillSection label={t("globalSkills")} meta="Available in every workspace" onSelect={setSelectedSkill} skills={globalSkills} /><SkillSection label={t("workspaceSkills")} meta={workspaceSkills.length === 1 ? workspaceNames.get(workspaceSkills[0]!.workspaceId!) ?? t("workspaceName") : `${workspaceSkills.length} skills`} onSelect={setSelectedSkill} skills={workspaceSkills} />{snapshot?.skills.diagnostics.length ? <div className="mb-8 border-t border-[#e7e7e2] pt-4 dark:border-border"><p className="font-mono text-[10px] uppercase text-[#8b6d39]">{t("skillDiagnostics")}</p>{snapshot.skills.diagnostics.map((diagnostic) => <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#846a3c] dark:text-[#d0b980]" key={`${diagnostic.source}:${diagnostic.path}:${diagnostic.message}`}><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{diagnostic.message}</p>)}</div> : null}</div> : <ConnectorsView dialogOpen={connectorDialogOpen} onDialogOpenChange={setConnectorDialogOpen} query={query} />}{error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}</div></section>;
}
