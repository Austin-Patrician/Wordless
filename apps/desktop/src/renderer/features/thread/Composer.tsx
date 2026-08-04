import { Button, Switch, cn, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { Archive, ArrowUpRight, ChevronDown, ChevronRight, CircleHelp, FileText, Folder, Layers3, Mic, Pin, PinOff, Plus, Send, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePreferences } from "../../shared/preferences";
import type { AgentInteractionModeId, ConnectorSummary, ProviderAvatarId, SessionAccessLevel, SessionContextUsage, SkillSummary, ToolApprovalMode, UserPromptPart } from "@wordless/domain";
import planIcon from "../../../icons/common-icons/plan.svg";
import mcpIcon from "../../../icons/common-icons/mcp.svg";
import skillsIcon from "../../../icons/common-icons/skills.svg";
import { ConnectorIcon } from "../../shared/ConnectorIcon";
import { AccessPicker } from "./AccessPicker";
import { BypassPermissionsDialog } from "./BypassPermissionsDialog";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { InlineSkillComposer, type InlineSkillComposerHandle, type InlineSkillComposerValue, type InlineWorkspaceReferenceToken } from "./InlineSkillComposer";
import { ProviderIcon } from "../settings/provider-icons";
import type { ArtifactSelection, WorkspaceFileEntry } from "@wordless/protocol";

type ComposerProps = {
  accessLevel?: SessionAccessLevel;
  toolApprovalMode?: ToolApprovalMode;
  compact?: boolean;
  compacting?: boolean;
  connectors?: ConnectorSummary[];
  contextUsage?: SessionContextUsage;
  interactionMode?: AgentInteractionModeId;
  canPlan?: boolean;
  contextCompactionAvailable?: boolean;
  disabled?: boolean;
  modelLabel: string;
  modelProviderAvatarId?: ProviderAvatarId | null;
  modelProviderId?: string;
  planMode?: "off" | "planning" | "executing";
  onTogglePlanMode?: () => void;
  onOpenModelPicker: () => void;
  onOpenWorkspacePicker?: () => void;
  onAccessLevelChange?: (accessLevel: SessionAccessLevel) => void | Promise<void>;
  onToolApprovalModeChange?: (mode: ToolApprovalMode) => void | Promise<void>;
  onCompactContext?: () => void | Promise<void>;
  onConnectorIdsChange?: (connectorIds: string[]) => void | Promise<void>;
  onImportSkill?: () => void | Promise<void>;
  onInteractionModeChange?: (interactionMode: AgentInteractionModeId) => void | Promise<void>;
  onOpenSkills?: () => void;
  onSend: (parts: UserPromptPart[]) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  running?: boolean;
  skillContextWindow?: number;
  selectedConnectorIds?: string[];
  skills?: SkillSummary[];
  sendDisabled?: boolean;
  showWorkspacePicker?: boolean;
  showAccessControl?: boolean;
  workspaceLocked?: boolean;
  workspaceLabel?: string;
  searchWorkspaceReferences?: (query: string) => Promise<WorkspaceFileEntry[]>;
  workspaceSearchScope?: string;
  pendingWorkspaceReferences?: InlineWorkspaceReferenceToken[];
  onPendingWorkspaceReferencesConsumed?: () => void;
  artifactSelection?: ArtifactSelection | null;
  onArtifactSelectionConsumed?: () => void;
  userMessageHistory?: Array<{ id: string; parts: UserPromptPart[] }>;
};

const EMPTY_INLINE_SKILL_COMPOSER_VALUE: InlineSkillComposerValue = { parts: [], skillIds: [], skillTokenCounts: {}, text: "", workspaceReferenceCount: 0, workspaceQuery: null };

export function Composer({
  compact = false,
  compacting = false,
  connectors = [],
  contextUsage,
  interactionMode,
  canPlan = false,
  contextCompactionAvailable = false,
  disabled = false,
  accessLevel = "default",
  toolApprovalMode = "manual",
  modelLabel,
  modelProviderAvatarId,
  modelProviderId,
  planMode = "off",
  onTogglePlanMode,
  onOpenModelPicker,
  onOpenWorkspacePicker,
  onAccessLevelChange,
  onToolApprovalModeChange,
  onCompactContext,
  onConnectorIdsChange,
  onImportSkill,
  onInteractionModeChange,
  onOpenSkills,
  onSend,
  onStop,
  running = false,
  skillContextWindow,
  selectedConnectorIds = [],
  skills = [],
  sendDisabled = false,
  showWorkspacePicker = true,
  showAccessControl = false,
  workspaceLocked = false,
  workspaceLabel,
  searchWorkspaceReferences,
  workspaceSearchScope = "default",
  pendingWorkspaceReferences = [],
  onPendingWorkspaceReferencesConsumed,
  artifactSelection,
  onArtifactSelectionConsumed,
  userMessageHistory = [],
}: ComposerProps) {
  const [draft, setDraft] = useState<InlineSkillComposerValue>(EMPTY_INLINE_SKILL_COMPOSER_VALUE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalChanging, setApprovalChanging] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bypassConfirmOpen, setBypassConfirmOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null);
  const [workspaceMatches, setWorkspaceMatches] = useState<WorkspaceFileEntry[]>([]);
  const [workspacePickerIndex, setWorkspacePickerIndex] = useState(0);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspacePickerPosition, setWorkspacePickerPosition] = useState({ left: 12, bottom: 52 });
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>(() => {
    try {
      const value = localStorage.getItem("wordless.pinned-skill-ids");
      if (!value) return [];
      const ids: unknown = JSON.parse(value);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [composerHeight, setComposerHeight] = useState<number | undefined>();
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InlineSkillComposerHandle>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLSpanElement>(null);
  const connectorDockRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ height: number; y: number } | null>(null);
  const draftRef = useRef<InlineSkillComposerValue>(EMPTY_INLINE_SKILL_COMPOSER_VALUE);
  const draftFrameRef = useRef<number | undefined>(undefined);
  const workspaceSearchReferencesRef = useRef(searchWorkspaceReferences);
  const workspaceSearchCacheRef = useRef(new Map<string, { expiresAt: number; results?: WorkspaceFileEntry[]; promise?: Promise<WorkspaceFileEntry[]> }>());
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef<InlineSkillComposerValue>(EMPTY_INLINE_SKILL_COMPOSER_VALUE);
  const applyingHistoryRef = useRef(false);
  const { locale, t } = usePreferences();
  workspaceSearchReferencesRef.current = searchWorkspaceReferences;
  const hasActionMenu = Boolean(onInteractionModeChange || onTogglePlanMode || onCompactContext || onImportSkill || onOpenSkills || onToolApprovalModeChange || skills.length > 0 || connectors.length > 0);
  const interactionDisabled = disabled || compacting;
  const effectiveInteractionMode = interactionMode ?? (planMode === "off" ? "default" : "plan");
  const interactionModes: Array<{ id: "clarify" | "plan"; description: string; label: string }> = [
    ...(onInteractionModeChange ? [{ id: "clarify" as const, label: locale === "zh-CN" ? "澄清" : "Clarify", description: locale === "zh-CN" ? "提问并理清思路，不执行" : "Question and sharpen thinking without execution" }] : []),
    ...(canPlan || (!onInteractionModeChange && onTogglePlanMode) ? [{ id: "plan" as const, label: locale === "zh-CN" ? "计划" : "Plan", description: locale === "zh-CN" ? "先规划，再决定是否执行" : "Plan before execution" }] : []),
  ];
  const approvalModes: Array<{ id: ToolApprovalMode; description: string; label: string }> = [
    { id: "manual", label: locale === "zh-CN" ? "手动审批" : "Manual approval", description: locale === "zh-CN" ? "每次工具操作都需要确认" : "Ask before each tool action" },
    { id: "auto", label: locale === "zh-CN" ? "本次自动审批" : "Auto-Approve for this session", description: locale === "zh-CN" ? "普通操作自动通过，高风险操作仍需确认" : "Normal actions auto-approve; high-risk actions still ask" },
    { id: "bypass", label: locale === "zh-CN" ? "绕过工具审批" : "Bypass permissions", description: locale === "zh-CN" ? "普通与高风险审批均自动通过" : "Auto-approve normal and high-risk actions" },
  ];
  const interactionModeDescription = effectiveInteractionMode === "plan"
    ? locale === "zh-CN" ? "当前为计划模式，将先规划任务，等你确认后再执行。" : "Plan mode is active. Wordless will plan first and wait for confirmation before execution."
    : effectiveInteractionMode === "clarify"
      ? locale === "zh-CN" ? "当前为澄清模式，将通过提问理清思路，不执行任务。" : "Clarify mode is active. Wordless will ask questions and clarify the direction without execution."
      : locale === "zh-CN" ? "当前为默认模式，可直接回答并执行任务。" : "Default mode is active. Wordless can answer and execute tasks directly.";
  const showActionSubmenu = useCallback((submenu: "approval" | "connectors" | "mode" | "skills" | null) => {
    setApprovalOpen(submenu === "approval");
    setConnectorsOpen(submenu === "connectors");
    setModeOpen(submenu === "mode");
    setSkillsOpen(submenu === "skills");
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!resizeStart.current) return;
      const minimum = compact ? 120 : 170;
      const maximum = compact ? 360 : 440;
      setComposerHeight(Math.min(maximum, Math.max(minimum, resizeStart.current.height + resizeStart.current.y - event.clientY)));
    };
    const up = () => {
      resizeStart.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [compact]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target))
      ) return;
      setMenuOpen(false);
      showActionSubmenu(null);
    };
    document.addEventListener("pointerdown", closeMenu, true);
    return () => document.removeEventListener("pointerdown", closeMenu, true);
  }, [menuOpen, showActionSubmenu]);

  useEffect(() => {
    if (activeConnectorId === null) return;
    const closeConnectorCard = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && connectorDockRef.current?.contains(target)) return;
      setActiveConnectorId(null);
    };
    document.addEventListener("pointerdown", closeConnectorCard, true);
    return () => document.removeEventListener("pointerdown", closeConnectorCard, true);
  }, [activeConnectorId]);

  useEffect(() => {
    localStorage.setItem("wordless.pinned-skill-ids", JSON.stringify(pinnedSkillIds));
  }, [pinnedSkillIds]);

  useEffect(() => {
    if (!running) return;
    setMenuOpen(false);
    showActionSubmenu(null);
  }, [running, showActionSubmenu]);

  useEffect(() => () => {
    if (draftFrameRef.current !== undefined) cancelAnimationFrame(draftFrameRef.current);
  }, []);

  const userMessageHistoryKey = userMessageHistory.map((message) => message.id).join("\u0000");
  useEffect(() => {
    historyIndexRef.current = null;
    historyDraftRef.current = EMPTY_INLINE_SKILL_COMPOSER_VALUE;
  }, [userMessageHistoryKey]);

  useEffect(() => {
    const query = draft.workspaceQuery;
    if (query === null || !searchWorkspaceReferences || disabled || running) {
      setWorkspacePickerOpen(false);
      setWorkspaceMatches([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchWorkspace(query).then((matches) => {
        if (!active) return;
        setWorkspaceMatches(matches);
        setWorkspacePickerIndex(0);
        setWorkspacePickerOpen(true);
      }).catch(() => {
        if (active) setWorkspacePickerOpen(false);
      });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [disabled, draft.workspaceQuery, running, workspaceSearchScope]);

  useEffect(() => {
    if (pendingWorkspaceReferences.length === 0 || disabled || running) return;
    for (const reference of pendingWorkspaceReferences) inputRef.current?.insertWorkspaceReference(reference);
    onPendingWorkspaceReferencesConsumed?.();
  }, [disabled, onPendingWorkspaceReferencesConsumed, pendingWorkspaceReferences, running]);

  const updateDraft = useCallback((nextDraft: InlineSkillComposerValue) => {
    if (applyingHistoryRef.current) applyingHistoryRef.current = false;
    else if (historyIndexRef.current !== null) {
      historyIndexRef.current = null;
      historyDraftRef.current = EMPTY_INLINE_SKILL_COMPOSER_VALUE;
    }
    draftRef.current = nextDraft;
    if (nextDraft.parts.length > 0) setSendError(null);
    const cursor = inputRef.current?.getCursorRect();
    const container = composerRef.current?.getBoundingClientRect();
    if (cursor && container) {
      setWorkspacePickerPosition({
        left: Math.max(8, Math.min(cursor.left - container.left, Math.max(8, container.width - 440))),
        bottom: Math.max(48, container.bottom - cursor.top + 8),
      });
    }
    if (draftFrameRef.current !== undefined) return;
    draftFrameRef.current = requestAnimationFrame(() => {
      draftFrameRef.current = undefined;
      setDraft(draftRef.current);
    });
  }, []);

  async function searchWorkspace(query: string): Promise<WorkspaceFileEntry[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const key = `${workspaceSearchScope}:${normalizedQuery}`;
    const now = Date.now();
    const cached = workspaceSearchCacheRef.current.get(key);
    if (cached?.results && cached.expiresAt > now) return cached.results;
    if (cached?.promise) return await cached.promise;
    const request = workspaceSearchReferencesRef.current?.(query) ?? Promise.resolve([]);
    const promise = request.then((results) => {
      workspaceSearchCacheRef.current.set(key, { results, expiresAt: Date.now() + 5_000 });
      return results;
    }).catch((error) => {
      workspaceSearchCacheRef.current.delete(key);
      throw error;
    });
    workspaceSearchCacheRef.current.set(key, { expiresAt: 0, promise });
    return await promise;
  }

  const send = async () => {
    const currentDraft = inputRef.current?.getValue() ?? draftRef.current;
    if (currentDraft.parts.length === 0 || interactionDisabled || running || sendDisabled) return;
    const parts: UserPromptPart[] = artifactSelection
      ? [{ type: "artifact-reference", artifactId: artifactSelection.artifactId, kind: artifactSelection.kind, name: artifactSelection.label, revision: artifactSelection.revision, surfaceId: artifactSelection.surfaceId, locator: artifactSelection.locator, ...(artifactSelection.locators ? { locators: artifactSelection.locators } : {}), ...(artifactSelection.intent ? { intent: artifactSelection.intent } : {}) }, ...currentDraft.parts]
      : currentDraft.parts;
    setSendError(null);
    try {
      await onSend(parts);
      if (artifactSelection) onArtifactSelectionConsumed?.();
      inputRef.current?.clear();
      if (draftFrameRef.current !== undefined) cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = undefined;
      draftRef.current = EMPTY_INLINE_SKILL_COMPOSER_VALUE;
      setDraft(EMPTY_INLINE_SKILL_COMPOSER_VALUE);
      historyIndexRef.current = null;
      historyDraftRef.current = EMPTY_INLINE_SKILL_COMPOSER_VALUE;
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const availableSkills = skills
    .filter((skill) => skill.state === "active")
    .sort((left, right) => {
      const leftPinned = pinnedSkillIds.includes(left.id);
      const rightPinned = pinnedSkillIds.includes(right.id);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  const filteredSkills = availableSkills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(skillQuery.trim().toLowerCase()));
  const selectedSkills = draft.skillIds.flatMap((id) => {
    const skill = availableSkills.find((candidate) => candidate.id === id);
    return skill ? [skill] : [];
  });
  const selectedSkillTokens = Math.ceil(selectedSkills.reduce((total, skill) => total + skill.contentBytes, 0) / 4);
  const skillWarning = skillContextWindow !== undefined && selectedSkillTokens > Math.floor(skillContextWindow * 0.2);
  const availableConnectors = connectors.filter((connector) => connector.enabled && connector.status === "ready");
  const selectedConnectors = selectedConnectorIds.flatMap((id) => {
    const connector = availableConnectors.find((candidate) => candidate.id === id);
    return connector ? [connector] : [];
  });

  const insertSkill = (skill: SkillSummary) => {
    inputRef.current?.insertSkill(skill);
    setMenuOpen(false);
    setSkillsOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const setConnectorSelected = (connectorId: string, selected: boolean) => {
    const next = selected
      ? [...new Set([...selectedConnectorIds, connectorId])]
      : selectedConnectorIds.filter((id) => id !== connectorId);
    void onConnectorIdsChange?.(next);
    if (!selected) setActiveConnectorId((current) => current === connectorId ? null : current);
  };

  const changeToolApprovalMode = async (mode: ToolApprovalMode) => {
    if (!onToolApprovalModeChange || mode === toolApprovalMode || approvalChanging) return;
    setApprovalChanging(true);
    setApprovalError(null);
    try {
      await onToolApprovalModeChange(mode);
      setApprovalOpen(false);
      setMenuOpen(false);
      setBypassConfirmOpen(false);
    } catch {
      setApprovalError(locale === "zh-CN" ? "工具审批设置失败" : "Could not update tool approval mode");
    } finally {
      setApprovalChanging(false);
    }
  };

  const requestToolApprovalModeChange = (mode: ToolApprovalMode) => {
    if (mode === toolApprovalMode || approvalChanging) return;
    if (mode === "bypass") {
      setApprovalError(null);
      setMenuOpen(false);
      showActionSubmenu(null);
      setBypassConfirmOpen(true);
      return;
    }
    void changeToolApprovalMode(mode);
  };

  const changeInteractionMode = async (mode: "clarify" | "plan") => {
    const nextMode: AgentInteractionModeId = effectiveInteractionMode === mode ? "default" : mode;
    try {
      if (onInteractionModeChange) await onInteractionModeChange(nextMode);
      else if (mode === "plan") await onTogglePlanMode?.();
      setMenuOpen(false);
      setModeOpen(false);
    } catch {
      // The session keeps its previous mode when the host rejects the change.
    }
  };

  const insertWorkspaceReference = (entry: WorkspaceFileEntry) => {
    inputRef.current?.insertWorkspaceReference({ path: entry.path, name: entry.name, kind: entry.kind });
    setWorkspacePickerOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const workspacePickerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (!workspacePickerOpen) return false;
    if (event.key === "ArrowDown") { setWorkspacePickerIndex((index) => Math.min(index + 1, Math.max(0, workspaceMatches.length - 1))); return true; }
    if (event.key === "ArrowUp") { setWorkspacePickerIndex((index) => Math.max(0, index - 1)); return true; }
    if ((event.key === "Enter" || event.key === "Tab") && workspaceMatches[workspacePickerIndex]) { insertWorkspaceReference(workspaceMatches[workspacePickerIndex]!); return true; }
    if (event.key === "Escape") { setWorkspacePickerOpen(false); return true; }
    return false;
  };

  const composerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (workspacePickerKeyDown(event)) return true;
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;

    const direction = event.key === "ArrowUp" ? "previous" : "next";
    if (!inputRef.current?.canNavigateHistory(direction)) return false;
    if (direction === "previous") {
      if (userMessageHistory.length === 0) return false;
      const currentIndex = historyIndexRef.current;
      if (currentIndex === null) historyDraftRef.current = inputRef.current.getValue();
      const nextIndex = currentIndex === null
        ? userMessageHistory.length - 1
        : Math.max(0, currentIndex - 1);
      historyIndexRef.current = nextIndex;
      applyingHistoryRef.current = true;
      inputRef.current.setValue(userMessageHistory[nextIndex]!.parts);
      return true;
    }

    const currentIndex = historyIndexRef.current;
    if (currentIndex === null) return false;
    const nextIndex = currentIndex + 1;
    applyingHistoryRef.current = true;
    if (nextIndex >= userMessageHistory.length) {
      historyIndexRef.current = null;
      inputRef.current.setValue(historyDraftRef.current.parts);
    } else {
      historyIndexRef.current = nextIndex;
      inputRef.current.setValue(userMessageHistory[nextIndex]!.parts);
    }
    return true;
  };

  return (
    <>
    <div
      ref={composerRef}
      className={cn(
        "relative flex flex-col border border-[#e6e6e2] bg-white dark:border-border dark:bg-[#1c1d18]",
        compact ? "min-h-[120px] rounded-[10px] p-2.5 shadow-[0_12px_35px_rgba(22,22,18,0.045)]" : "min-h-[170px] rounded-[14px] px-3.5 py-3 shadow-[0_14px_28px_rgba(34,34,30,0.045)]",
      )}
      style={{ height: composerHeight ?? (compact ? 120 : 170) }}
    >
      <div
        aria-label="Resize message input"
        className="absolute -top-1.5 left-0 z-10 h-3 w-full cursor-row-resize touch-none before:absolute before:left-1/2 before:top-1.5 before:h-px before:w-8 before:-translate-x-1/2 before:bg-transparent before:content-[''] hover:before:bg-[#b8b8b0] dark:hover:before:bg-muted-foreground"
        onPointerDown={(event) => {
          const composer = composerRef.current;
          if (!composer) return;
          event.preventDefault();
          resizeStart.current = { height: composer.offsetHeight, y: event.clientY };
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
        }}
        role="separator"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden pr-0.5">
        {artifactSelection ? <div className="flex h-7 shrink-0 min-w-0 items-center gap-1.5 self-start rounded-[6px] border border-[#b8d6cb] bg-[#edf8f4] px-2 text-[#345f53] dark:border-[#416b5e] dark:bg-[#20372f] dark:text-[#bae2d3]"><Layers3 className="h-3.5 w-3.5 shrink-0" /><span className="max-w-[min(360px,calc(100vw-12rem))] truncate text-[10px] font-medium" title={artifactSelection.locator}>{artifactSelection.label}</span><button aria-label="Remove selected artifact" className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-[#66857b] hover:bg-[#d7eee6] hover:text-[#274f44] dark:hover:bg-[#36564b] dark:hover:text-white" disabled={interactionDisabled || running} onClick={() => onArtifactSelectionConsumed?.()} type="button"><X className="h-3 w-3" /></button></div> : null}
        <InlineSkillComposer
          ariaLabel={t("send")}
          className="min-h-[40px] w-full min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-0.5 text-[16px] font-medium leading-7 text-[#353532] caret-[#252624] outline-none placeholder:font-normal placeholder:text-[#a2a29b] selection:bg-[#dff09b] disabled:cursor-not-allowed read-only:cursor-default dark:text-foreground dark:caret-foreground dark:placeholder:text-muted-foreground dark:selection:bg-[#4a5a26]"
          disabled={interactionDisabled}
          onChange={updateDraft}
          onWorkspaceReferenceKeyDown={composerKeyDown}
          onStop={() => void onStop?.()}
          onSubmit={() => void send()}
          placeholder={effectiveInteractionMode === "plan" ? t("planPromptPlaceholder") : effectiveInteractionMode === "clarify" ? locale === "zh-CN" ? "输入想要理清的问题..." : "Describe what you want to clarify..." : compact ? t("compactPromptPlaceholder") : t("promptPlaceholder")}
          ref={inputRef}
          stopEnabled={running}
          submitDisabled={running}
        />
        {workspacePickerOpen ? <div className="absolute z-40 w-[min(520px,calc(100vw-3rem))] overflow-hidden rounded-[8px] border border-[#cadbd5] bg-white p-1 shadow-[0_14px_34px_rgba(27,46,40,0.16)] dark:border-[#3c655a] dark:bg-card" style={{ left: workspacePickerPosition.left, bottom: workspacePickerPosition.bottom }}>
          <div className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#688278] dark:text-[#9bbfb2]">Workspace files</div>
          <div className="max-h-52 overflow-y-auto">{workspaceMatches.length > 0 ? workspaceMatches.map((entry, index) => { const Icon = entry.kind === "directory" ? Folder : FileText; return <button className={cn("flex w-full min-w-0 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left", index === workspacePickerIndex ? "bg-[#eaf5f1] dark:bg-[#28443b]" : "hover:bg-[#f2f6f4] dark:hover:bg-muted")} key={entry.path} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setWorkspacePickerIndex(index)} onClick={() => insertWorkspaceReference(entry)} title={entry.path} type="button"><Icon className="h-3.5 w-3.5 shrink-0 text-[#5b9280]" /><span className="w-32 shrink-0 truncate text-[12px] font-medium text-[#3a4d47] dark:text-foreground">{entry.name}</span><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#788982] dark:text-muted-foreground">{entry.path}</span><span className="w-9 shrink-0 text-right font-mono text-[10px] uppercase text-[#6f897f] dark:text-[#9bbfb2]">{entry.kind === "directory" ? "Dir" : "File"}</span></button>; }) : <p className="px-2 py-3 text-[11px] text-muted-foreground">No workspace matches</p>}</div>
        </div> : null}
      </div>
      {skillWarning ? <p className="mt-1 shrink-0 text-[10px] text-[#9b6c2d] dark:text-[#d7b47d]">{t("skillContextWarning")}</p> : null}
      {sendError ? <p className="mt-1 shrink-0 text-[10px] leading-4 text-destructive" role="alert">{sendError}</p> : null}
      {hasActionMenu && menuOpen ? <div className="absolute bottom-[48px] left-2 z-30 flex items-end gap-1.5" onMouseLeave={() => showActionSubmenu(null)} ref={menuRef}>
        <div className="w-[188px] rounded-[10px] border border-[#dfdfdb] bg-white p-1.5 shadow-[0_14px_34px_rgba(28,28,25,0.12)] dark:border-border dark:bg-card">
          {onInteractionModeChange || onTogglePlanMode ? <button className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[#3f3f3a] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted", modeOpen && "bg-[#eeeeeb] dark:bg-muted")} onClick={() => showActionSubmenu("mode")} onFocus={() => showActionSubmenu("mode")} onMouseEnter={() => showActionSubmenu("mode")} type="button">
            <Sparkles className="h-4 w-4 text-[#62625d]" /><span className="flex-1">{t("mode")}</span><ChevronRight className="h-3 w-3 text-[#898981]" />
          </button> : null}
          {onToolApprovalModeChange ? <button aria-expanded={approvalOpen} className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[#3f3f3a] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted", approvalOpen && "bg-[#eeeeeb] dark:bg-muted")} onClick={() => showActionSubmenu("approval")} onFocus={() => showActionSubmenu("approval")} onMouseEnter={() => showActionSubmenu("approval")} type="button">
            <ShieldCheck className={cn("h-4 w-4", toolApprovalMode === "bypass" ? "text-[#bd5147] dark:text-[#f09a90]" : toolApprovalMode === "auto" ? "text-[#a47a2a]" : "text-[#62625d]")} /><span className="min-w-0 flex-1 truncate">{locale === "zh-CN" ? "工具审批" : "Tool approval"}</span><ChevronRight className="h-3 w-3 shrink-0 text-[#898981]" />
          </button> : null}
          {onCompactContext ? <button className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[#3f3f3a] hover:bg-[#f3f3f0] disabled:cursor-not-allowed disabled:opacity-45 dark:text-foreground dark:hover:bg-muted" disabled={interactionDisabled || running || !contextCompactionAvailable} onClick={() => { setMenuOpen(false); showActionSubmenu(null); void onCompactContext(); }} onMouseEnter={() => showActionSubmenu(null)} type="button"><Archive className="h-4 w-4 shrink-0 text-[#62625d]" /><span>{t("compressContext")}</span></button> : null}
          <button className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[#3f3f3a] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted", skillsOpen && "bg-[#eeeeeb] dark:bg-muted")} onClick={() => showActionSubmenu("skills")} onFocus={() => showActionSubmenu("skills")} onMouseEnter={() => showActionSubmenu("skills")} type="button"><img alt="" className="h-4 w-4 shrink-0 object-contain dark:invert" src={skillsIcon} /><span>{t("skills")}</span><ChevronRight className="ml-auto h-3 w-3 text-[#898981]" /></button>
          <button className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[#3f3f3a] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted", connectorsOpen && "bg-[#eeeeeb] dark:bg-muted")} onClick={() => showActionSubmenu("connectors")} onFocus={() => showActionSubmenu("connectors")} onMouseEnter={() => showActionSubmenu("connectors")} type="button"><img alt="" className="h-4 w-4 shrink-0 object-contain dark:invert" src={mcpIcon} /><span>{t("connectors")}</span><ChevronRight className="ml-auto h-3 w-3 text-[#898981]" /></button>
        </div>
        {modeOpen && (onInteractionModeChange || onTogglePlanMode) ? <div className="absolute left-[187px] top-0 w-[244px] rounded-[10px] border border-[#dfdfdb] bg-white p-1.5 shadow-[0_14px_34px_rgba(28,28,25,0.12)] dark:border-border dark:bg-card"><p className="px-2.5 pb-2 pt-1 text-[10px] leading-4 text-[#7f7f78] dark:text-muted-foreground">{interactionModeDescription}</p><div className="border-t border-[#ecece8] pt-1 dark:border-border">{interactionModes.map((option) => {
          const selected = effectiveInteractionMode === option.id;
          return <button aria-pressed={selected} className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted" key={option.id} onClick={() => void changeInteractionMode(option.id)} type="button"><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-[#42423d] dark:text-foreground">{option.label}</span><span className="mt-0.5 block truncate text-[10px] leading-4 text-[#85857e] dark:text-muted-foreground">{option.description}</span></span><span aria-hidden="true" className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", selected ? "bg-[#74a92f] dark:bg-[#a6ca61]" : "bg-[#e7e7e2] dark:bg-[#484a43]")}><span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.16)] transition-transform", selected ? "translate-x-3.5" : "translate-x-0.5")} /></span></button>;
        })}</div></div> : null}
        {approvalOpen && onToolApprovalModeChange ? <div className="w-[276px] rounded-[10px] border border-[#dfdfdb] bg-white p-1.5 shadow-[0_14px_34px_rgba(28,28,25,0.14)] dark:border-border dark:bg-card" role="radiogroup" aria-label={locale === "zh-CN" ? "工具审批方式" : "Tool approval mode"}>
          {approvalError ? <p className="px-2.5 pb-1 text-[10px] text-[#a0522d] dark:text-[#e5a47d]" role="alert">{approvalError}</p> : null}
          {approvalModes.map((option) => <button aria-checked={toolApprovalMode === option.id} className={cn("flex w-full items-start gap-2 rounded-[7px] px-2.5 py-2 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted", toolApprovalMode === option.id && (option.id === "bypass" ? "bg-[#f9e9e6] dark:bg-[#452824]" : "bg-[#edf2df] dark:bg-[#313d20]"))} disabled={approvalChanging} key={option.id} onClick={() => requestToolApprovalModeChange(option.id)} role="radio" type="button"><span className={cn("mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-[9px]", toolApprovalMode === option.id ? option.id === "bypass" ? "border-[#bd5147] bg-[#bd5147] text-white" : "border-[#6d8438] bg-[#6d8438] text-white" : "border-[#bdbdb6] text-transparent dark:border-muted-foreground")}>✓</span><span className="min-w-0"><span className={cn("block text-[12px] font-medium dark:text-foreground", option.id === "bypass" ? "text-[#9f453d] dark:text-[#f09a90]" : "text-[#42423d]")}>{option.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-[#85857e] dark:text-muted-foreground">{option.description}</span></span></button>)}
        </div> : null}
        {skillsOpen ? <div className="w-[294px] rounded-[10px] border border-[#dfdfdb] bg-white p-2 shadow-[0_14px_34px_rgba(28,28,25,0.12)] dark:border-border dark:bg-card">
          <input aria-label={t("searchSkills")} autoFocus className="h-8 w-full rounded-[6px] border border-[#e4e4df] bg-[#fafaf8] px-2 text-[12px] text-[#3f3f3a] outline-none placeholder:text-[#9b9b94] focus:border-[#9dad75] dark:border-border dark:bg-muted dark:text-foreground" onChange={(event) => setSkillQuery(event.target.value)} placeholder={t("searchSkills")} value={skillQuery} />
          <div className="mt-1 max-h-[232px] overflow-y-auto">
            {filteredSkills.map((skill) => {
              const tokenCount = draft.skillTokenCounts[skill.id] ?? 0;
              const pinned = pinnedSkillIds.includes(skill.id);
              return <div className="group flex items-center gap-1 rounded-[7px] px-1 py-0.5 hover:bg-[#f3f3f0] dark:hover:bg-muted" key={skill.id}><button className="flex min-w-0 flex-1 items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-left" onClick={() => insertSkill(skill)} type="button"><span className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border border-[#bdbdb6] text-[#66665f] dark:border-muted-foreground"><Plus className="h-2.5 w-2.5" /></span><span className="min-w-0"><Tooltip><TooltipTrigger asChild><span className="block truncate text-[12px] font-semibold text-[#3f3f3a] dark:text-foreground">{skill.name}</span></TooltipTrigger><TooltipContent className="max-w-[260px] text-[11px] leading-4">{skill.description}</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><span className="mt-0.5 block truncate text-[10px] leading-4 text-[#86867e] dark:text-muted-foreground">{skill.description}</span></TooltipTrigger><TooltipContent className="max-w-[260px] text-[11px] leading-4">{skill.description}</TooltipContent></Tooltip></span></button>{tokenCount > 0 ? <span className="mr-0.5 min-w-4 rounded-[4px] bg-[#e9eee0] px-1 text-center font-mono text-[9px] leading-4 text-[#58633e] dark:bg-[#3b4728] dark:text-[#d5e3ad]">{tokenCount}</span> : null}<Tooltip><TooltipTrigger asChild><button aria-label={pinned ? t("unpinSkill") : t("pinSkill")} className={cn("mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[#92928b] hover:bg-white hover:text-[#42423e] dark:hover:bg-card dark:hover:text-foreground", pinned && "text-[#60773a] dark:text-[#c4eb58]")} onClick={() => setPinnedSkillIds((current) => pinned ? current.filter((id) => id !== skill.id) : [...current, skill.id])} type="button">{pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button></TooltipTrigger><TooltipContent>{pinned ? t("unpinSkill") : t("pinSkill")}</TooltipContent></Tooltip></div>;
            })}
            {filteredSkills.length === 0 ? <p className="px-2 py-3 text-[11px] text-[#8b8b84] dark:text-muted-foreground">{t("noSkillsAvailable")}</p> : null}
          </div>
          <div className="mt-1 space-y-0.5 border-t border-[#ecece8] pt-1 dark:border-border"><button className="w-full rounded-[6px] px-2 py-1.5 text-left text-[11px] text-[#565650] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted" onClick={() => { setSkillsOpen(false); setMenuOpen(false); void onImportSkill?.(); }} type="button">{t("importSkill")}</button><button className="w-full rounded-[6px] px-2 py-1.5 text-left text-[11px] text-[#565650] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted" onClick={() => { setSkillsOpen(false); setMenuOpen(false); onOpenSkills?.(); }} type="button">{t("manageSkills")}</button></div>
        </div> : null}
        {connectorsOpen ? <div className="w-[248px] rounded-[10px] border border-[#dfdfdb] bg-white p-1.5 shadow-[0_14px_34px_rgba(28,28,25,0.12)] dark:border-border dark:bg-card">
          <div className="max-h-[248px] overflow-y-auto">
            {availableConnectors.map((connector) => {
              const selected = selectedConnectorIds.includes(connector.id);
              return <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[7px] px-2 hover:bg-[#f3f3f0] dark:hover:bg-muted" key={connector.id}><ConnectorIcon className="h-4 w-4 shrink-0" templateId={connector.templateId} transport={connector.transport} /><span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#3f3f3a] dark:text-foreground">{connector.name}</span><Switch aria-label={`${selected ? "Disable" : "Enable"} ${connector.name}`} checked={selected} disabled={interactionDisabled || running} onCheckedChange={(checked) => setConnectorSelected(connector.id, checked)} /></div>;
            })}
            {availableConnectors.length === 0 ? <p className="px-2 py-3 text-[11px] text-[#8b8b84] dark:text-muted-foreground">{locale === "zh-CN" ? "没有已连接并启用的 MCP" : "No connected and enabled MCP servers"}</p> : null}
          </div>
          <div className="mt-1 border-t border-[#ecece8] pt-1 dark:border-border"><button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-[11px] font-medium text-[#565650] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted" onClick={() => { setConnectorsOpen(false); setMenuOpen(false); onOpenSkills?.(); }} type="button"><ArrowUpRight className="h-3.5 w-3.5" />{locale === "zh-CN" ? "选择更多连接器" : "Choose more connectors"}</button></div>
        </div> : null}
      </div> : null}
      <div className={cn("flex shrink-0 items-center justify-between gap-3", compact ? "mt-1.5 px-0.5" : "mt-3")}>
        <div className="flex min-w-0 items-center gap-1.5">
          {hasActionMenu ? <span className="inline-flex" ref={menuTriggerRef}><Button aria-expanded={menuOpen} aria-label={t("mode")} className={cn("text-[#686862]", menuOpen && "bg-[#eeeeeb] text-[#353532] dark:bg-muted dark:text-foreground")} disabled={interactionDisabled || running} onClick={() => { setActiveConnectorId(null); setMenuOpen((current) => !current); showActionSubmenu(null); }} size="icon" type="button" variant="ghost"><span className="relative grid h-4 w-4 place-items-center"><Plus className={cn("absolute h-4 w-4 transition-all duration-200", menuOpen ? "rotate-90 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100")} /><X className={cn("absolute h-4 w-4 transition-all duration-200", menuOpen ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-75 opacity-0")} /></span></Button></span> : null}
          {selectedConnectors.length > 0 ? <div className="flex min-w-0 items-center gap-1" ref={connectorDockRef}>{selectedConnectors.map((connector) => <div className="relative shrink-0" key={connector.id}><Tooltip><TooltipTrigger asChild><button aria-expanded={activeConnectorId === connector.id} aria-label={connector.name} className={cn("grid h-7 w-7 place-items-center rounded-[6px] text-[#5d5d57] transition-colors hover:bg-[#efefeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground dark:hover:bg-muted", activeConnectorId === connector.id && "bg-[#e9e9e5] dark:bg-muted")} onClick={() => { setMenuOpen(false); showActionSubmenu(null); setActiveConnectorId((current) => current === connector.id ? null : connector.id); }} type="button"><ConnectorIcon className="h-4 w-4" templateId={connector.templateId} transport={connector.transport} /></button></TooltipTrigger><TooltipContent>{connector.name}</TooltipContent></Tooltip>{activeConnectorId === connector.id ? <div className="absolute bottom-[calc(100%+9px)] left-0 z-40 w-[240px] overflow-hidden rounded-[11px] border border-[#deded9] bg-white shadow-[0_14px_34px_rgba(28,28,25,0.14)] dark:border-border dark:bg-card"><div className="flex h-11 min-w-0 items-center gap-2.5 px-3"><ConnectorIcon className="h-4 w-4 shrink-0" templateId={connector.templateId} transport={connector.transport} /><span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#33332f] dark:text-foreground">{connector.name}</span><Switch aria-label={`Disable ${connector.name}`} checked disabled={interactionDisabled || running} onCheckedChange={(checked) => setConnectorSelected(connector.id, checked)} /></div><div className="border-t border-[#ecece7] p-1.5 dark:border-border"><button className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-[11px] font-medium text-[#565650] hover:bg-[#f3f3f0] dark:text-foreground dark:hover:bg-muted" onClick={() => { setActiveConnectorId(null); setMenuOpen(true); showActionSubmenu("connectors"); }} type="button"><ArrowUpRight className="h-3.5 w-3.5" />{locale === "zh-CN" ? "选择更多连接器" : "Choose more connectors"}</button></div></div> : null}</div>)}</div> : null}
          {showAccessControl && onAccessLevelChange ? <AccessPicker disabled={interactionDisabled || running} onChange={onAccessLevelChange} value={accessLevel} /> : null}
          {effectiveInteractionMode !== "default" ? <><span className="hidden h-4 w-px bg-[#e1e1dc] sm:block" /><button aria-label={locale === "zh-CN" ? "退出当前模式" : "Exit current mode"} className="flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium text-[#4f4f49] transition-colors hover:bg-[#f1f1ee] disabled:cursor-not-allowed disabled:opacity-50 dark:text-foreground dark:hover:bg-muted" disabled={interactionDisabled || running} onClick={() => { if (onInteractionModeChange) void Promise.resolve(onInteractionModeChange("default")).catch(() => {}); else onTogglePlanMode?.(); }} type="button">{effectiveInteractionMode === "plan" ? <img alt="" className="h-3.5 w-3.5 shrink-0 object-contain" src={planIcon} /> : <CircleHelp className="h-3.5 w-3.5 shrink-0 text-[#667d2f] dark:text-[#d1e689]" />}{effectiveInteractionMode === "plan" ? t("plan") : locale === "zh-CN" ? "澄清" : "Clarify"}</button></> : null}
          {showWorkspacePicker && onOpenWorkspacePicker ? <Button className="hidden min-w-0 text-[#64645e] sm:inline-flex" disabled={interactionDisabled || running || workspaceLocked} onClick={onOpenWorkspacePicker} size="sm" type="button" variant="ghost">
            <Folder className="h-3.5 w-3.5" />
            <span className="max-w-32 truncate">{workspaceLabel}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button> : null}
        </div>
        <div className="flex items-center gap-1">
          <ContextUsageIndicator contextUsage={contextUsage} draftMessage={draft.text} draftSkillTokens={selectedSkillTokens} />
          <Button className="hidden max-w-44 text-[#474741] sm:inline-flex" disabled={interactionDisabled || running} onClick={onOpenModelPicker} size="sm" type="button" variant="ghost">
            <ProviderIcon avatarId={modelProviderAvatarId} className="h-3.5 w-3.5 shrink-0 object-contain" providerId={modelProviderId} />
            <span className="truncate">{modelLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={t("useVoice")} className="text-[#686862]" disabled={interactionDisabled || running} size="icon" type="button" variant="ghost">
                <Mic className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("useVoice")}</TooltipContent>
          </Tooltip>
          <Button aria-label={running ? "Stop agent" : t("send")} className="rounded-full disabled:bg-[#b5b5b1]" disabled={running ? false : interactionDisabled || sendDisabled || draft.parts.length === 0} onClick={() => running ? void onStop?.() : void send()} size="icon" type="button">
            {running ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
    <BypassPermissionsDialog error={approvalError} onCancel={() => { if (approvalChanging) return; setBypassConfirmOpen(false); setApprovalError(null); }} onConfirm={() => void changeToolApprovalMode("bypass")} open={bypassConfirmOpen} saving={approvalChanging} />
    </>
  );
}
