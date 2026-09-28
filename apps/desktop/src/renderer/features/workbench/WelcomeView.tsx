import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@wordless/ui-kit";
import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentInteractionModeId, ExpertSelection, ModelReference, PresentationGenerationMode, SessionAccessLevel, ThinkingLevel, ToolApprovalMode, UserPromptPart, WorkbenchEntryDefinition, WorkbenchMode } from "@wordless/domain";
import type { PresentationTemplate } from "@wordless/protocol";
import codeDevelopmentIcon from "../../../icons/common-icons/代码开发.svg";
import everydayWorkIcon from "../../../icons/common-icons/everydaywork.svg";
import uiDesignIcon from "../../../icons/common-icons/ui-design.svg";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { Composer, EMPTY_INLINE_SKILL_COMPOSER_VALUE } from "../thread/Composer";
import { AccessPicker } from "../thread/AccessPicker";
import { createPendingThreadTurn, createUserMessageSubmission, type PendingThreadTurn } from "../thread/pending-thread-turn";
import { DesignStyleLaunchStrip } from "../design/DesignStyleLaunchStrip";
import { designStyleStartParts } from "../design/style-start";
import { ModelPicker, thinkingLevelForModelSelection } from "./ModelPicker";
import { WorkspacePicker } from "./WorkspacePicker";
import { AgentEntryIcon } from "./AgentEntryIcon";
import { QuickModelSetup } from "./QuickModelSetup";
import { useOnboarding } from "../onboarding/OnboardingFlow";
import { ExpertPortrait } from "../experts/ExpertPortrait";
import { hasEnabledChatModel } from "./quick-model-setup-model";
import { supportsGeneralWorkAccessSelection } from "../thread/access-control";

type WelcomeViewProps = {
  onOpenModels: () => void;
  onOpenSkillImport: () => void;
  onOpenSkills: () => void;
  onSessionCreated: (sessionId: string, pendingTurn: PendingThreadTurn) => void;
  initialExpertSelection?: ExpertSelection;
  initialExpertPrompt?: string;
};

/**
 * 三个模式。标签走 i18n —— 它们原本是硬编码的英文,而这是中文优先的应用。
 *
 * 标签用「创作」而不是「界面设计」:这一栏装的是**模式**,不是某一个 entry。现在它底下只有
 * `ui-design` 一个(图片生成改成了内部 entry),但哪天再添一个,标签不必跟着改。
 */
const modeOptions: { icon: string; id: WorkbenchMode; labelKey: "modeEveryday" | "modeCode" | "modeCreate" }[] = [
  { id: "everyday", labelKey: "modeEveryday", icon: everydayWorkIcon },
  { id: "code", labelKey: "modeCode", icon: codeDevelopmentIcon },
  { id: "create", labelKey: "modeCreate", icon: uiDesignIcon },
];

/**
 * 新建页该提供的那一类里的第一个。
 *
 * 跳过 `internal`:`image-generation` 这类 entry 还要能被解析(媒体工作台按 id 取它),但不该
 * 在这里露头 —— 否则换一次顺序,新建页的默认项就可能变成它。
 */
function defaultEntry(entries: WorkbenchEntryDefinition[], mode: WorkbenchMode): WorkbenchEntryDefinition | undefined {
  return entries.find((entry) => entry.mode === mode && !entry.internal);
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

export function WelcomeView({ initialExpertPrompt, initialExpertSelection, onOpenModels, onOpenSkillImport, onOpenSkills, onSessionCreated }: WelcomeViewProps) {
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
  /** 这一栏选中的内置风格。`null` = 由 agent 自己定(默认,行为与从前一致)。 */
  const [designStyleId, setDesignStyleId] = useState<string | null>(null);
  const [presentationMode, setPresentationMode] = useState<PresentationGenerationMode>("guided");
  const [presentationTemplateId, setPresentationTemplateId] = useState("auto");
  const [presentationTemplates, setPresentationTemplates] = useState<PresentationTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [quickSetupDismissed, setQuickSetupDismissed] = useState(false);
  const [expertSelection, setExpertSelection] = useState<ExpertSelection | undefined>(initialExpertSelection);
  const initialDraft = initialExpertPrompt ? { ...EMPTY_INLINE_SKILL_COMPOSER_VALUE, parts: [{ type: "text" as const, text: initialExpertPrompt }], text: initialExpertPrompt } : undefined;

  const entries = snapshot?.entries ?? [];
  const modeEntries = useMemo(
    () => entries.filter((entry) => entry.mode === mode && !entry.internal),
    [entries, mode],
  );
  const entry = entries.find((candidate) => candidate.id === entryId) ?? defaultEntry(entries, mode);
  const selectedWorkspace = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId);
  const selectedWorkspaceAvailable = workspaceId === null || selectedWorkspace?.availability === "available";
  const selectedModel = snapshot?.models.find((candidate) => candidate.connectionId === model?.connectionId && candidate.modelId === model.modelId);
  const selectedConnection = snapshot?.connections.find((connection) => connection.id === model?.connectionId);
  const workspaceRequired = entry?.workbenchId === "code" || entry?.workbenchId === "analysis";
  const canPlan = entry?.workbenchId === "code" && (snapshot?.extensions.configurations["wordless.plan-mode"]?.enabled ?? false);
  const hasEnabledModels = snapshot ? hasEnabledChatModel(snapshot.modelConfiguration) : false;
  // The guide owns the screen while it runs. Letting the model setup dialog
  // open underneath it would leave two overlays competing for the same space,
  // so it waits until the guide is finished.
  const onboarding = useOnboarding();
  const quickSetupOpen = Boolean(snapshot && !hasEnabledModels && !quickSetupDismissed && !onboarding?.active);

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

  const send = async (parts: UserPromptPart[], attachments?: File[]) => {
    if (!entry || entry.availability !== "available" || !model) return;
    if (!selectedWorkspaceAvailable) {
      setSubmissionError(t("unavailable"));
      setWorkspaceId(null);
      return;
    }
    setSubmitting(true);
    setSubmissionError(null);
    const submission = createUserMessageSubmission();
    try {
      /*
        挑了一套风格:先把它的资料(theme.css + DESIGN.md)落进**工作区**,再把这两份资料作为引用
        带进第一条消息。落盘失败就**不建会话** —— 否则用户会拿到一个"看起来按那套风格开的"、其实
        没有资料的会话,而原因在几屏之外。
      */
      const styleId = entry.workbenchId === "ui-preview" ? designStyleId : null;
      const installed =
        styleId === null || selectedWorkspace === undefined
          ? null
          : await client.installDesignStyleResources({ root: selectedWorkspace.rootPath, styleId });
      if (styleId !== null && installed === null) {
        setSubmissionError(t("designStyleLaunchFailed"));
        return;
      }
      const messageParts = installed === null ? parts : [...parts, ...designStyleStartParts(installed)];
      const pendingTurn = createPendingThreadTurn(messageParts, submission, attachments);
      const session = await client.createAndPrompt({ mode, entryId: entry.id, workspaceId, accessLevel, model, thinkingLevel, connectorIds, interactionMode, toolApprovalMode, ...(expertSelection ? { expertSelection } : {}), ...(entry.workbenchId === "presentation" ? { presentation: { generationMode: presentationMode, templateId: presentationTemplateId === "auto" ? null : presentationTemplateId } } : {}) }, messageParts, submission, attachments);
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
                <img alt="" className={cn("h-3.5 w-3.5 shrink-0 object-contain", (option.id === "everyday" || option.id === "code") && "dark:invert")} draggable={false} src={option.icon} />
                <span className="truncate">{t(option.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10">
          {/*
            只有**一个**可选项时不摆这一行:一个按钮的"选择器"长得像可以选,其实没得选,而它占掉的
            是这一屏最值钱的位置(风格胶片与输入框之间)。
            判断按数据走而不是按模式写死(`mode === "create"` 这样):哪天这个模式下再添一个 entry
            或撤掉一个,这一行自己回来了,不必改这里。
          */}
          {modeEntries.length > 1 ? (
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
          ) : null}
          {entry?.workbenchId === "ui-preview" ? (
            <DesignStyleLaunchStrip
              bridge={client}
              onSelect={setDesignStyleId}
              selected={designStyleId}
              workspaceReady={selectedWorkspace !== undefined}
            />
          ) : null}
          {entry?.workbenchId === "presentation" ? <PresentationLaunchControls generationMode={presentationMode} onGenerationModeChange={setPresentationMode} onTemplateChange={setPresentationTemplateId} templateId={presentationTemplateId} templates={presentationTemplates} /> : null}
          <div className="relative rounded-t-[14px] bg-[#f1f1ef] dark:bg-[#252620]">
            <Composer
              accessLevel={accessLevel}
              connectors={snapshot?.connectors.connectors}
              canPlan={canPlan}
              disabled={submitting}
              interactionMode={interactionMode}
              initialDraft={initialDraft}
              modelLabel={selectedModel?.displayName ?? t("modelRequired")}
              modelProviderAvatarId={selectedConnection?.avatarId}
              modelProviderId={model?.connectionId}
              onAccessLevelChange={setAccessLevel}
              onToolApprovalModeChange={setToolApprovalMode}
              toolApprovalMode={toolApprovalMode}
              onConnectorIdsChange={setConnectorIds}
              experts={snapshot?.experts ?? []}
              selectedExpertSelection={expertSelection}
              onExpertSelectionChange={(selection) => setExpertSelection(selection ?? undefined)}
              showExpertPicker={entry?.id === "general-work"}
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
              onSend={send}
              searchWorkspaceReferences={workspaceId ? (query) => client.searchWorkspace(workspaceId, query) : undefined}
              workspaceSearchScope={workspaceId ?? "no-workspace"}
              sendDisabled={!canSend}
              skillContextWindow={selectedModel?.capabilities.contextWindow}
              selectedConnectorIds={connectorIds}
              skills={snapshot?.skills.skills.filter((skill) => skill.workspaceId === null || skill.workspaceId === workspaceId) ?? []}
              showAccessControl={false}
              showWorkspacePicker={false}
              workspaceLabel={selectedWorkspace?.name ?? t("selectWorkspace")}
            />
            {snapshot && entry ? (
              <>
                <ModelPicker
                  connections={snapshot.connections}
                  entry={entry}
                  models={snapshot.models}
                  onConfigure={() => {
                    if (!hasEnabledModels) {
                      setModelOpen(false);
                      setQuickSetupDismissed(false);
                      return;
                    }
                    onOpenModels();
                  }}
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
          {snapshot && entry ? (
            <div className="-mt-px flex flex-wrap items-center gap-1.5 rounded-b-[14px] border-x border-b border-[#e6e6e2] bg-[#f1f1ef] px-3.5 py-1.5 dark:border-border dark:bg-[#252620]">
              <div className="relative" data-tour="welcome-workspace">
                <Button
                  className="min-w-0 text-[#64645e]"
                  disabled={submitting}
                  onClick={() => setWorkspaceOpen(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span className="max-w-40 truncate">{selectedWorkspace?.name ?? t("selectWorkspace")}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
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
                  placement="below"
                  selectedWorkspaceId={workspaceId}
                  workspaces={snapshot.workspaces}
                />
              </div>
              {workspaceRequired || supportsGeneralWorkAccessSelection(entry.id) ? (
                <AccessPicker
                  disabled={submitting}
                  onChange={setAccessLevel}
                  value={accessLevel}
                />
              ) : null}
            </div>
          ) : null}
          {submissionError ? <p className="mt-3 text-[11px] leading-5 text-destructive" role="alert">{submissionError}</p> : null}
        </div>
      </div>
      {snapshot ? (
        <QuickModelSetup
          configuration={snapshot.modelConfiguration}
          onAdvanced={() => {
            setQuickSetupDismissed(true);
            onOpenModels();
          }}
          onConfigured={(providerId, modelId) => {
            setModel({ connectionId: providerId, modelId });
            setQuickSetupDismissed(true);
          }}
          onOpenChange={(open) => {
            if (!open) setQuickSetupDismissed(true);
          }}
          open={quickSetupOpen}
        />
      ) : null}
    </div>
  );
}
