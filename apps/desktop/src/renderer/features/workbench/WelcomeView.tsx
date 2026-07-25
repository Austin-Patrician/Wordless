import { cn } from "@wordless/ui-kit";
import { useEffect, useMemo, useState } from "react";
import type { AgentInteractionModeId, ModelReference, SessionAccessLevel, UserPromptPart, WorkbenchEntryDefinition, WorkbenchMode } from "@wordless/domain";
import codeDevelopmentIcon from "../../../icons/common-icons/代码开发.svg";
import spreadsheetIcon from "../../../icons/common-icons/电子表格.svg";
import everydayOfficeIcon from "../../../icons/common-icons/日常办公.svg";
import dataAnalysisIcon from "../../../icons/common-icons/数据分析.svg";
import websiteIcon from "../../../icons/common-icons/网站.svg";
import everydayWorkIcon from "../../../icons/common-icons/everydaywork.svg";
import innovationIcon from "../../../icons/common-icons/innovation.svg";
import uiDesignIcon from "../../../icons/common-icons/ui-design.svg";
import presentationIcon from "../../../icons/common-icons/presentation.svg";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { Composer, type WorkspaceAttachment } from "../thread/Composer";
import { ModelPicker } from "./ModelPicker";
import { WorkspacePicker } from "./WorkspacePicker";

type WelcomeViewProps = {
  onOpenModels: () => void;
  onOpenSkillImport: () => void;
  onOpenSkills: () => void;
  onSessionCreated: (sessionId: string) => void;
};

const modeOptions: { icon: string; id: WorkbenchMode; label: string }[] = [
  { id: "everyday", label: "Everyday work", icon: everydayWorkIcon },
  { id: "code", label: "Code", icon: codeDevelopmentIcon },
  { id: "create", label: "Create", icon: uiDesignIcon },
];

function EntryIcon({ iconKey }: { iconKey: string }) {
  const icons: Record<string, string> = {
    sparkles: everydayOfficeIcon,
    presentation: presentationIcon,
    table: spreadsheetIcon,
    chart: dataAnalysisIcon,
    code: codeDevelopmentIcon,
    palette: websiteIcon,
    image: innovationIcon,
  };
  return <img alt="" className="h-3.5 w-3.5 shrink-0 object-contain" draggable={false} src={icons[iconKey] ?? everydayOfficeIcon} />;
}

function defaultEntry(entries: WorkbenchEntryDefinition[], mode: WorkbenchMode): WorkbenchEntryDefinition | undefined {
  return entries.find((entry) => entry.mode === mode);
}

export function WelcomeView({ onOpenModels, onOpenSkillImport, onOpenSkills, onSessionCreated }: WelcomeViewProps) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [mode, setMode] = useState<WorkbenchMode>("everyday");
  const [entryId, setEntryId] = useState("general-work");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelReference | null>(null);
  const [accessLevel, setAccessLevel] = useState<SessionAccessLevel>("default");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<AgentInteractionModeId>("default");
  const [submitting, setSubmitting] = useState(false);

  const entries = snapshot?.entries ?? [];
  const modeEntries = useMemo(() => entries.filter((entry) => entry.mode === mode), [entries, mode]);
  const entry = entries.find((candidate) => candidate.id === entryId) ?? defaultEntry(entries, mode);
  const selectedWorkspace = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId);
  const selectedModel = snapshot?.models.find((candidate) => candidate.connectionId === model?.connectionId && candidate.modelId === model.modelId);
  const selectedConnection = snapshot?.connections.find((connection) => connection.id === model?.connectionId);
  const workspaceRequired = entry?.workbenchId === "code";
  const canPlan = entry?.workbenchId === "code" && (snapshot?.extensions.configurations["wordless.plan-mode"]?.enabled ?? false);

  useEffect(() => {
    const candidate = defaultEntry(entries, mode);
    if (!candidate) return;
    if (!entries.some((entry) => entry.id === entryId && entry.mode === mode)) setEntryId(candidate.id);
  }, [entries, entryId, mode]);

  useEffect(() => {
    if (model || !snapshot || !entry) return;
    const candidate =
      snapshot.preferences.entryModels[entry.id] ??
      snapshot.preferences.defaultModel ??
      snapshot.models.find(
        (candidateModel) =>
          candidateModel.enabled && (!entry.modelRequirements.requiresVision || candidateModel.capabilities.supportsVision),
      );
    if (candidate) {
      setModel({ connectionId: candidate.connectionId, modelId: candidate.modelId });
    }
  }, [entry, model, snapshot]);

  useEffect(() => {
    if (interactionMode === "plan" && !canPlan) setInteractionMode("default");
  }, [canPlan, interactionMode]);

  const send = async (parts: UserPromptPart[], _attachments: WorkspaceAttachment[]) => {
    if (!entry || entry.availability !== "available" || !model) return;
    setSubmitting(true);
    try {
      const session = await client.createAndPrompt({ mode, entryId: entry.id, workspaceId, accessLevel, model, connectorIds, interactionMode }, parts);
      await refresh();
      onSessionCreated(session.id);
    } finally {
      setSubmitting(false);
    }
  };

  const changeMode = (nextMode: WorkbenchMode) => {
    setMode(nextMode);
    const candidate = defaultEntry(entries, nextMode);
    if (candidate) setEntryId(candidate.id);
    setModel(null);
    setAccessLevel("default");
  };

  const canSend = Boolean(entry && entry.availability === "available" && model && !submitting && (!workspaceRequired || workspaceId) && (interactionMode !== "clarify" || selectedModel?.capabilities.supportsToolUse !== false));

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8 sm:px-12 lg:px-16">
      <div className="w-full max-w-[720px] pb-4">
        <div>
          <h1 className="text-[44px] font-bold leading-[1.08] tracking-[-0.04em] text-[#171716] dark:text-foreground">
            {t("welcomeTitle")}
            <br />
            {t("welcomeSubtitle")}
          </h1>
          <div className="mt-5 inline-flex max-w-full rounded-xl bg-[#ededeb] p-1 dark:bg-[#282a21]">
            {modeOptions.map((option) => (
              <button
                className={cn(
                  "flex min-w-0 items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold transition-all",
                  mode === option.id ? "bg-[#373735] text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:bg-[#eff4dc] dark:text-[#191b12]" : "text-[#5d5d58] hover:text-[#292927] dark:text-muted-foreground dark:hover:text-foreground",
                )}
                key={option.id}
                onClick={() => changeMode(option.id)}
                type="button"
              >
                <img alt="" className="h-3.5 w-3.5 shrink-0 object-contain" draggable={false} src={option.icon} />
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10">
          <div className="mb-3 flex flex-wrap gap-2">
            {modeEntries.map((candidate) => {
              const selected = entry?.id === candidate.id;
              return (
                <button
                  className={cn(
                    "flex max-w-full items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors",
                    selected ? "border-[#b9ce80] bg-[#eef4dc] text-[#354210] dark:border-[#739127] dark:bg-[#303a1c] dark:text-[#e8f5c6]" : "border-[#e4e4e0] bg-white text-[#44443f] hover:bg-[#f5f5f2] dark:border-border dark:bg-[#1c1d18] dark:text-foreground dark:hover:bg-[#25271f]",
                    candidate.availability === "unavailable" ? "cursor-not-allowed opacity-45" : "",
                  )}
                  disabled={candidate.availability === "unavailable"}
                  key={candidate.id}
                  onClick={() => {
                    setEntryId(candidate.id);
                    setModel(null);
                  }}
                  title={candidate.availability === "unavailable" ? t("unavailable") : undefined}
                  type="button"
                >
                  <EntryIcon iconKey={candidate.iconKey} />
                  <span className="truncate">{t(candidate.labelKey as Parameters<typeof t>[0])}</span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Composer
              accessLevel={accessLevel}
              connectors={snapshot?.connectors.connectors}
              canPlan={canPlan}
              disabled={submitting}
              interactionMode={interactionMode}
              modelLabel={selectedModel?.displayName ?? t("modelRequired")}
              modelProviderAvatarId={selectedConnection?.avatarId}
              modelProviderId={model?.connectionId}
              onAccessLevelChange={setAccessLevel}
              onConnectorIdsChange={setConnectorIds}
              onImportSkill={onOpenSkillImport}
              onInteractionModeChange={(nextMode) => {
                if (nextMode === "clarify" && selectedModel?.capabilities.supportsToolUse === false) {
                  setModelOpen(true);
                  return;
                }
                setInteractionMode(nextMode);
              }}
              onOpenSkills={onOpenSkills}
              onOpenModelPicker={() => setModelOpen(true)}
              onOpenWorkspacePicker={() => setWorkspaceOpen(true)}
              onSend={send}
              sendDisabled={!canSend}
              skillContextWindow={selectedModel?.capabilities.contextWindow}
              selectedConnectorIds={connectorIds}
              skills={snapshot?.skills.skills.filter((skill) => skill.workspaceId === null || skill.workspaceId === workspaceId) ?? []}
              showAccessControl={workspaceRequired}
              workspaceLabel={selectedWorkspace?.name ?? t("selectWorkspace")}
            />
            {snapshot && entry ? (
              <>
                <WorkspacePicker
                  allowNoWorkspace={!workspaceRequired}
                  onCreate={async (name) => {
                    const workspace = await client.createManagedWorkspace(name);
                    await refresh();
                    return workspace;
                  }}
                  onOpenChange={setWorkspaceOpen}
                  onOpenLocal={async () => {
                    const workspace = await client.pickWorkspace();
                    await refresh();
                    return workspace;
                  }}
                  onSelect={setWorkspaceId}
                  open={workspaceOpen}
                  selectedWorkspaceId={workspaceId}
                  workspaces={snapshot.workspaces}
                />
                <ModelPicker
                  connections={snapshot.connections}
                  entry={entry}
                  models={snapshot.models}
                  onConfigure={onOpenModels}
                  onOpenChange={setModelOpen}
                  onSelect={(connectionId, modelId) => setModel({ connectionId, modelId })}
                  open={modelOpen}
                  selected={model}
                />
              </>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("caution")}</p>
        </div>
      </div>
    </div>
  );
}
