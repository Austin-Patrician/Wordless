import { Button } from "@wordless/ui-kit";
import { FileKey, Plus, ShieldAlert, TerminalSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CommandSecurityRule, FileSecurityRule } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";

type RuleKind = "file" | "command";
type PendingDelete = { kind: RuleKind; id: string; label: string } | null;

export function SecuritySettings() {
  const { security, setSecurity, t } = usePreferences();
  const { refresh, snapshot } = useRuntime();
  const [adding, setAdding] = useState<RuleKind | null>(null);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRules = snapshot?.security.fileRules ?? [];
  const commandRules = snapshot?.security.commandRules ?? [];

  const closeAdd = () => {
    setAdding(null);
    setLabel("");
    setValue("");
    setError(null);
  };

  const persist = async (next: typeof security) => {
    setSaving(true);
    setError(null);
    try {
      await setSecurity(next);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const addRule = async () => {
    if (!adding || !label.trim() || !value.trim()) {
      setError(t("requiredResponse"));
      return;
    }
    const id = crypto.randomUUID();
    if (adding === "file") {
      await persist({ ...security, customFileRules: [...security.customFileRules, { id, label: label.trim(), pattern: value.trim() }] });
    } else {
      await persist({ ...security, customCommandRules: [...security.customCommandRules, { id, label: label.trim(), command: value.trim() }] });
    }
    closeAdd();
  };

  const deleteRule = async () => {
    if (!pendingDelete) return;
    const next = pendingDelete.kind === "file"
      ? { ...security, customFileRules: security.customFileRules.filter((rule) => rule.id !== pendingDelete.id) }
      : { ...security, customCommandRules: security.customCommandRules.filter((rule) => rule.id !== pendingDelete.id) };
    await persist(next);
    setPendingDelete(null);
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-9">
      <div className="mx-auto max-w-[680px]">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-[#e2d8d4] bg-[#fbf3f0] text-[#a45948] dark:border-[#5a3a33] dark:bg-[#2d211d] dark:text-[#e7ad9e]"><ShieldAlert className="h-4 w-4" /></span>
          <div><h2 className="text-[14px] font-semibold">{t("securityCenter")}</h2><p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("securityCenterHelp")}</p></div>
        </div>
        {error ? <p className="mt-4 border border-[#e4cfc8] bg-[#fbf3f0] px-3 py-2 text-[11px] text-[#9c5e4c] dark:border-[#654238] dark:bg-[#2c211d] dark:text-[#e8b9a9]">{error}</p> : null}
        <SecurityRuleSection icon={FileKey} kind="file" onAdd={() => setAdding("file")} onDelete={setPendingDelete} rules={fileRules} title={t("fileSecurity")} description={t("fileSecurityHelp")} />
        <SecurityRuleSection icon={TerminalSquare} kind="command" onAdd={() => setAdding("command")} onDelete={setPendingDelete} rules={commandRules} title={t("commandSecurity")} description={t("commandSecurityHelp")} />
      </div>
      {adding ? (
        <div aria-modal="true" className="fixed inset-x-0 bottom-0 top-[30px] z-[70] grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]" role="dialog">
          <div className="w-full max-w-[410px] rounded-xl border border-white/60 bg-white p-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:border-border dark:bg-[#1c1d18]">
            <h2 className="text-[15px] font-semibold">{adding === "file" ? t("addFileRule") : t("addCommandRule")}</h2>
            <label className="mt-5 block"><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{t("ruleName")}</span><input className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px] outline-none focus:border-[#879b65]" onChange={(event) => setLabel(event.target.value)} value={label} /></label>
            <label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{adding === "file" ? t("filePattern") : t("commandFragment")}</span><input className="h-9 w-full rounded-md border border-input bg-background px-2.5 font-mono text-[11px] outline-none focus:border-[#879b65]" onChange={(event) => setValue(event.target.value)} placeholder={adding === "file" ? "**/.env.*" : "terraform apply"} value={value} /></label>
            <div className="mt-5 flex justify-end gap-2"><Button disabled={saving} onClick={closeAdd} type="button" variant="ghost">{t("cancel")}</Button><Button disabled={saving} onClick={() => void addRule()} type="button">{t("save")}</Button></div>
          </div>
        </div>
      ) : null}
      {pendingDelete ? (
        <div aria-modal="true" className="fixed inset-x-0 bottom-0 top-[30px] z-[70] grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]" role="dialog">
          <div className="w-full max-w-[390px] rounded-xl border border-white/60 bg-white p-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:border-border dark:bg-[#1c1d18]">
            <h2 className="text-[15px] font-semibold">{t("deleteRule")}</h2><p className="mt-2 text-[12px] leading-5 text-muted-foreground">{t("deleteRuleHelp")}</p>
            <p className="mt-3 rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] text-foreground">{pendingDelete.label}</p>
            <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setPendingDelete(null)} type="button" variant="ghost">{t("cancel")}</Button><Button className="bg-[#b34b42] text-white hover:bg-[#963d35]" disabled={saving} onClick={() => void deleteRule()} type="button">{t("delete")}</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SecurityRuleSection({
  description,
  icon: Icon,
  kind,
  onAdd,
  onDelete,
  rules,
  title,
}: {
  description: string;
  icon: typeof FileKey;
  kind: RuleKind;
  onAdd: () => void;
  onDelete: (rule: PendingDelete) => void;
  rules: FileSecurityRule[] | CommandSecurityRule[];
  title: string;
}) {
  const { t } = usePreferences();
  const customRules = rules.filter((rule) => rule.source === "custom");
  return (
    <section className="mt-7 border-y border-border py-4">
      <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-border bg-muted/40 text-muted-foreground"><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><h3 className="text-[13px] font-semibold">{title}</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p></div><Button aria-label={kind === "file" ? t("addFileRule") : t("addCommandRule")} onClick={onAdd} size="icon" type="button" variant="ghost"><Plus className="h-4 w-4" /></Button></div>
      <div className="mt-4 divide-y divide-border border-y border-border">
        {rules.map((rule) => <div className="flex min-w-0 items-center gap-3 px-1 py-2" key={rule.id}><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{rule.label}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{"pattern" in rule ? rule.pattern : rule.command}</p></div>{rule.source === "builtin" ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{t("builtinRule")}</span> : <Button aria-label={`${t("delete")} ${rule.label}`} onClick={() => onDelete({ kind, id: rule.id, label: rule.label })} size="icon" type="button" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-[#9a5a4d]" /></Button>}</div>)}
      </div>
      {customRules.length === 0 ? <p className="mt-2 text-[10px] text-muted-foreground">{t("noCustomRules")}</p> : null}
    </section>
  );
}
