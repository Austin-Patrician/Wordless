import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@wordless/ui-kit";
import { useEffect, useMemo, useState } from "react";
import type { AgentInteractionModeId, ModelReference, PresentationGenerationMode, SessionAccessLevel, ThinkingLevel, ToolApprovalMode, UserPromptPart, WorkbenchEntryDefinition, WorkbenchMode } from "@wordless/domain";
import type { PresentationTemplate } from "@wordless/protocol";
import codeDevelopmentIcon from "../../../icons/common-icons/代码开发.svg";
import everydayWorkIcon from "../../../icons/common-icons/everydaywork.svg";
import uiDesignIcon from "../../../icons/common-icons/ui-design.svg";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { Composer } from "../thread/Composer";
import { createPendingThreadTurn, createUserMessageSubmission, type PendingThreadTurn } from "../thread/pending-thread-turn";
import { ModelPicker, thinkingLevelForModelSelection } from "./ModelPicker";
import { WorkspacePicker } from "./WorkspacePicker";
import { AgentEntryIcon } from "./AgentEntryIcon";

type WelcomeViewProps = {
  onOpenModels: () => void;
  onOpenSkillImport: () => void;
  onOpenSkills: () => void;
  onSessionCreated: (sessionId: string, pendingTurn: PendingThreadTurn) => void;
};

const modeOptions: { icon: string; id: WorkbenchMode; label: string }[] = [
  { id: "everyday", label: "Everyday work", icon: everydayWorkIcon },
  { id: "code", label: "Code", icon: codeDevelopmentIcon },
  { id: "create", label: "Create", icon: uiDesignIcon },
];

function defaultEntry(entries: WorkbenchEntryDefinition[], mode: WorkbenchMode): WorkbenchEntryDefinition | undefined {
  return entries.find((entry) => entry.mode === mode);
}

function PresentationLaunchControls({
  generationMode,
  onGenerationModeChange,
  onTemplateChange,
  templateId,
  templates,
}: {
  generationMode: PresentationGenerationMode;
  onGenerationModeChange: (mode: PresentationGenerationMode) => void;
  onTemplateChange: (templateId: string) => void;
  templateId: string;
  templates: PresentationTemplate[];
}) {
  return (
    <div className="mb-4 border-y border-[#e4e4df] py-3 dark:border-border">
      <div className="grid max-w-[460px] grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-4">
        <div className="min-w-0">
          <p className="h-4 text-[11px] font-semibold leading-4 text-[#464641] dark:text-foreground">Creation flow</p>
          <div className="mt-1.5 inline-flex h-7 rounded-[6px] bg-[#ededeb] p-0.5 dark:bg-muted">
            {(["guided", "quick"] as const).map((candidate) => (
              <button
                className={cn(
                  "h-6 rounded-[4px] px-2.5 text-[10px] font-semibold transition-colors",
                  generationMode === candidate
                    ? "bg-white text-[#39491d] shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:bg-card dark:text-[#d7ef99]"
                    : "text-[#777770] hover:text-[#42423d] dark:text-muted-foreground dark:hover:text-foreground",
                )}
                key={candidate}
                onClick={() => onGenerationModeChange(candidate)}
                type="button"
              >
                {candidate === "guided" ? "Guided" : "Quick"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <p className="h-4 text-[11px] font-semibold leading-4 text-[#464641] dark:text-foreground">Starting point</p>
          <Select onValueChange={onTemplateChange} value={templateId}>
            <SelectTrigger className="mt-1.5 h-7 min-w-0 rounded-[6px] bg-white px-2.5 py-0 text-[10px] text-[#565650] shadow-none focus:ring-1 dark:bg-card dark:text-foreground">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent className="rounded-[7px]">
              {(templates.length > 0 ? templates : [{ id: "auto", name: "Auto", description: "", tags: [] }]).map((template) => (
                <SelectItem className="min-h-7 px-2.5 py-1.5 text-[10px]" key={template.id} value={template.id}>{template.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        {generationMode === "guided" ? "Confirm an outline before the agent creates the deck." : "Generate the first complete deck immediately, then iterate in the workspace."}
      </p>
    </div>
  );
}

export function WelcomeView({ onOpenModels, onOpenSkillImport, onOpenSkills, onSessionCreated }: WelcomeViewProps) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [mode, setMode] = useState<WorkbenchMode>("everyday");
  const [entryId, setEntryId] = useState("general-work");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelReference | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [accessLevel, setAccessLevel] = useState<SessionAccessLevel>("default");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<AgentInteractionModeId>("default");
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("manual");
  const [presentationMode, setPresentationMode] = useState<PresentationGenerationMode>("guided");
  const [presentationTemplateId, setPresentationTemplateId] = useState("auto");
  const [presentationTemplates, setPresentationTemplates] = useState<PresentationTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const entries = snapshot?.entries ?? [];
  const modeEntries = useMemo(() => entries.filter((entry) => entry.mode === mode), [entries, mode]);
  const entry = entries.find((candidate) => candidate.id === entryId) ?? defaultEntry(entries, mode);
  const selectedWorkspace = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId);
  const selectedWorkspaceAvailable = workspaceId === null || selectedWorkspace?.availability === "available";
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

  useEffect(() => {
    if (workspaceId && !selectedWorkspaceAvailable) setWorkspaceId(null);
  }, [selectedWorkspaceAvailable, workspaceId]);

  useEffect(() => {
    if (entry?.workbenchId !== "presentation") return;
    void client.listPresentationTemplates().then(setPresentationTemplates).catch(() => setPresentationTemplates([]));
  }, [client, entry?.workbenchId]);

  const send = async (parts: UserPromptPart[]) => {
    if (!entry || entry.availability !== "available" || !model) return;
    if (!selectedWorkspaceAvailable) {
      setSubmissionError(t("unavailable"));
      setWorkspaceId(null);
      return;
    }
    setSubmitting(true);
    setSubmissionError(null);
    const submission = createUserMessageSubmission();
    const pendingTurn = createPendingThreadTurn(parts, submission);
    try {
      const session = await client.createAndPrompt({ mode, entryId: entry.id, workspaceId, accessLevel, model, thinkingLevel, connectorIds, interactionMode, toolApprovalMode, ...(entry.workbenchId === "presentation" ? { presentation: { generationMode: presentationMode, templateId: presentationTemplateId === "auto" ? null : presentationTemplateId } } : {}) }, parts, submission);
      onSessionCreated(session.id, pendingTurn);
      void refresh();
    } catch (cause) {
      setSubmissionError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
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

  const canSend = Boolean(entry && entry.availability === "available" && model && !submitting && selectedWorkspaceAvailable && (!workspaceRequired || workspaceId) && (interactionMode !== "clarify" || selectedModel?.capabilities.supportsToolUse !== false));

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
                  <AgentEntryIcon iconKey={candidate.iconKey} />
                  <span className="truncate">{t(candidate.labelKey as Parameters<typeof t>[0])}</span>
                </button>
              );
            })}
          </div>
          {entry?.workbenchId === "presentation" ? <PresentationLaunchControls generationMode={presentationMode} onGenerationModeChange={setPresentationMode} onTemplateChange={setPresentationTemplateId} templateId={presentationTemplateId} templates={presentationTemplates} /> : null}
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
              onToolApprovalModeChange={setToolApprovalMode}
              toolApprovalMode={toolApprovalMode}
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
              searchWorkspaceReferences={workspaceId ? (query) => client.searchWorkspace(workspaceId, query) : undefined}
              workspaceSearchScope={workspaceId ?? "no-workspace"}
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
                  onSelect={(connectionId, modelId, selectedThinkingLevel) => {
                    const next = snapshot.models.find((candidate) => candidate.connectionId === connectionId && candidate.modelId === modelId);
                    if (!next) return;
                    setThinkingLevel(selectedThinkingLevel ?? thinkingLevelForModelSelection(next, selectedModel, thinkingLevel));
                    setModel({ connectionId, modelId });
                  }}
                  open={modelOpen}
                  selected={model}
                  thinkingLevel={thinkingLevel}
                />
              </>
            ) : null}
          </div>
          {submissionError ? <p className="mt-3 text-[11px] leading-5 text-destructive" role="alert">{submissionError}</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">{t("caution")}</p>
        </div>
      </div>
    </div>
  );
}
