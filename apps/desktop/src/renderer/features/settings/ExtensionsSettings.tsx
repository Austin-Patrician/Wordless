import { Switch } from "@wordless/ui-kit";
import { Layers3, Puzzle, UsersRound } from "lucide-react";
import { useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";

const roles = [
  { id: "scout", label: "Scout" },
  { id: "planner", label: "Planner" },
  { id: "reviewer", label: "Reviewer" },
  { id: "worker", label: "Worker" },
] as const;

const icons = {
  "wordless.plan-mode": Puzzle,
  "wordless.subagent": UsersRound,
  "wordless.context-compaction": Layers3,
} as const;

export function ExtensionsSettings() {
  const { t } = usePreferences();
  const { client, refresh, snapshot } = useRuntime();
  const [saving, setSaving] = useState<string | null>(null);
  const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const extensions = snapshot?.extensions.descriptors ?? [];
  const enabledModels = snapshot?.modelConfiguration.models.filter((model) => model.kind === "chat" && model.enabled) ?? [];

  const toggle = async (extensionId: string, enabled: boolean) => {
    if (!client) return;
    setSaving(extensionId);
    setError(null);
    setEnabledOverrides((current) => ({ ...current, [extensionId]: enabled }));
    try {
      await client.setExtensionEnabled(extensionId, enabled);
      await refresh();
      setEnabledOverrides((current) => {
        const next = { ...current };
        delete next[extensionId];
        return next;
      });
    } catch (reason) {
      setEnabledOverrides((current) => {
        const next = { ...current };
        delete next[extensionId];
        return next;
      });
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(null);
    }
  };

  const setRoleModel = async (role: string, value: string) => {
    if (!client || !snapshot) return;
    const configuration = snapshot.extensions.configurations["wordless.subagent"];
    const roleModels = typeof configuration?.settings.roleModels === "object" && configuration.settings.roleModels !== null && !Array.isArray(configuration.settings.roleModels)
      ? { ...configuration.settings.roleModels as Record<string, unknown> }
      : {};
    if (!value) delete roleModels[role];
    else {
      const [connectionId, ...modelParts] = value.split("/");
      roleModels[role] = { connectionId, modelId: modelParts.join("/") };
    }
    setSaving("wordless.subagent");
    try {
      await client.updateExtensionSettings("wordless.subagent", { ...configuration?.settings, roleModels });
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-9">
      <div className="max-w-[680px]">
        <h2 className="text-[14px] font-semibold">{t("extensions")}</h2>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("extensionsHelp")}</p>
        {error ? <p className="mt-3 border border-[#e4cfc8] bg-[#fbf3f0] px-3 py-2 text-[11px] text-[#9c5e4c] dark:border-[#654238] dark:bg-[#2c211d] dark:text-[#e8b9a9]">{error}</p> : null}
        <div className="mt-6 divide-y divide-border border-y border-border">
          {extensions.map((extension) => {
            const Icon = icons[extension.id as keyof typeof icons] ?? Puzzle;
            const configuration = snapshot?.extensions.configurations[extension.id];
            const enabled = enabledOverrides[extension.id] ?? configuration?.enabled ?? false;
            const title = extension.id === "wordless.plan-mode" ? t("planMode") : extension.id === "wordless.subagent" ? t("subagent") : extension.id === "wordless.context-compaction" ? t("contextCompaction") : extension.name;
            const description = extension.id === "wordless.plan-mode" ? t("planModeDescription") : extension.id === "wordless.subagent" ? t("subagentDescription") : extension.id === "wordless.context-compaction" ? t("contextCompactionDescription") : extension.description;
            return (
              <div className="py-4" key={extension.id}>
                <div className="flex items-center gap-4">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-border bg-muted/30 text-muted-foreground"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{title}</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {enabled ? <span className="font-mono text-[10px] uppercase text-[#6f8250]">{t("extensionEnabled")}</span> : null}
                    <Switch aria-label={title} checked={enabled} disabled={saving === extension.id} onCheckedChange={(checked) => void toggle(extension.id, checked)} />
                  </div>
                </div>
              {extension.id === "wordless.subagent" && enabled ? <div className="ml-[52px] border-t border-border pb-1 pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">{t("subagentRoles")}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("inheritsSessionModel")}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {roles.map((role) => {
                    const roleModels = configuration?.settings.roleModels;
                    const selected = typeof roleModels === "object" && roleModels !== null && !Array.isArray(roleModels) && typeof (roleModels as Record<string, unknown>)[role.id] === "object" && (roleModels as Record<string, unknown>)[role.id] !== null
                      ? (roleModels as Record<string, { connectionId?: unknown; modelId?: unknown }>)[role.id]
                      : undefined;
                    const selectedValue = selected && typeof selected.connectionId === "string" && typeof selected.modelId === "string" ? `${selected.connectionId}/${selected.modelId}` : "";
                    return <label className="min-w-0" key={role.id}><span className="mb-1 block text-[10px] uppercase text-muted-foreground">{role.label} / {t("roleModel")}</span><select className="h-8 w-full min-w-0 border border-border bg-background px-2 text-[11px] outline-none focus:border-[#879b65]" disabled={saving === extension.id} onChange={(event) => void setRoleModel(role.id, event.target.value)} value={selectedValue}><option value="">{t("inheritsSessionModel")}</option>{enabledModels.map((model) => <option key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>{model.displayName}</option>)}</select></label>;
                  })}
                </div>
              </div> : null}
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
