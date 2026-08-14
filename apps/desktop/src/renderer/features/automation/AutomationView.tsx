import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from "@wordless/ui-kit";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  Funnel,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AutomationRun,
  AutomationSchedule,
  AutomationTask,
  AutomationTaskInput,
  ConnectorSummary,
  EnabledModelRecord,
  ModelReference,
  ProviderConnectionRecord,
  SessionAccessLevel,
  SkillSummary,
  ThinkingLevel,
  UserPromptPart,
} from "@wordless/domain";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { usePreferences } from "../../shared/preferences";
import { ProviderIcon } from "../settings/provider-icons";
import {
  InlineSkillComposer,
  type InlineSkillComposerHandle,
  type InlineSkillComposerValue,
} from "../thread/InlineSkillComposer";
import { ConnectorSwitchMenu, SkillInsertMenu } from "../thread/PromptCapabilityControls";
import toolApprovalIcon from "../../../icons/common-icons/tool-approval.svg";

type Page =
  | { kind: "list" }
  | { kind: "templates" }
  | { kind: "form"; task?: AutomationTask; template?: Template };
type Tab = "scheduled" | "runs";
type Template = {
  name: string;
  prompt: string;
  schedule: AutomationSchedule;
  icon: string;
};
type TemplateDefinition = Omit<Template, "name" | "prompt"> & {
  nameKey: import("../../shared/i18n").MessageKey;
  promptKey: import("../../shared/i18n").MessageKey;
};
type RunGroup = {
  id: string;
  name: string;
  runs: AutomationRun[];
};
const control =
  "h-9 w-full rounded-[7px] border border-border bg-card px-3 pr-9 text-[12px] outline-none focus:border-[#9aaf61] focus:ring-1 focus:ring-[#9aaf61]/30";
const automationSwitchClass =
  "data-[state=checked]:border-accent data-[state=checked]:bg-accent dark:data-[state=checked]:border-accent dark:data-[state=checked]:bg-accent";
const EMPTY_PROMPT_VALUE: InlineSkillComposerValue = {
  parts: [],
  skillIds: [],
  skillTokenCounts: {},
  skillQuery: null,
  text: "",
  workspaceReferenceCount: 0,
  workspaceQuery: null,
};
const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function thinkingLevelForModel(
  model: EnabledModelRecord | undefined,
  current: ThinkingLevel,
): ThinkingLevel {
  if (!model) return current;
  if (!model.capabilities.supportsReasoning) return "off";
  const supported = model.capabilities.supportedThinkingLevels;
  if (supported.includes(current)) return current;
  const index = THINKING_LEVELS.indexOf(current);
  for (let next = index; next < THINKING_LEVELS.length; next += 1) {
    const candidate = THINKING_LEVELS[next];
    if (supported.includes(candidate)) return candidate;
  }
  for (let next = index - 1; next >= 0; next -= 1) {
    const candidate = THINKING_LEVELS[next];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}

function thinkingLevelLabel(level: ThinkingLevel, t: ReturnType<typeof usePreferences>["t"]): string {
  return (
    {
      off: t("thinkingLevel_off"),
      minimal: t("thinkingLevel_minimal"),
      low: t("thinkingLevel_low"),
      medium: t("thinkingLevel_medium"),
      high: t("thinkingLevel_high"),
      xhigh: t("thinkingLevel_xhigh"),
      max: t("thinkingLevel_max"),
    } as const
  )[level];
}

const templateDefinitions: TemplateDefinition[] = [
  {
    nameKey: "automationTemplateAiNewsName",
    promptKey: "automationTemplateAiNewsPrompt",
    schedule: { kind: "recurring", cadence: "daily", time: "09:00" },
    icon: "▤",
  },
  {
    nameKey: "automationTemplateWordsName",
    promptKey: "automationTemplateWordsPrompt",
    schedule: { kind: "recurring", cadence: "daily", time: "09:00" },
    icon: "A",
  },
  {
    nameKey: "automationTemplateStoryName",
    promptKey: "automationTemplateStoryPrompt",
    schedule: { kind: "recurring", cadence: "daily", time: "20:30" },
    icon: "◔",
  },
  {
    nameKey: "automationTemplateWeeklyName",
    promptKey: "automationTemplateWeeklyPrompt",
    schedule: {
      kind: "recurring",
      cadence: "weekly",
      weekdays: [5],
      time: "17:30",
    },
    icon: "▣",
  },
  {
    nameKey: "automationTemplateMovieName",
    promptKey: "automationTemplateMoviePrompt",
    schedule: {
      kind: "recurring",
      cadence: "weekly",
      weekdays: [6],
      time: "10:00",
    },
    icon: "◫",
  },
  {
    nameKey: "automationTemplateTodayName",
    promptKey: "automationTemplateTodayPrompt",
    schedule: { kind: "recurring", cadence: "daily", time: "08:30" },
    icon: "□",
  },
  {
    nameKey: "automationTemplateWhyName",
    promptKey: "automationTemplateWhyPrompt",
    schedule: { kind: "recurring", cadence: "daily", time: "12:00" },
    icon: "?",
  },
  {
    nameKey: "automationTemplateFamilyName",
    promptKey: "automationTemplateFamilyPrompt",
    schedule: {
      kind: "recurring",
      cadence: "weekly",
      weekdays: [0],
      time: "10:00",
    },
    icon: "♙",
  },
  {
    nameKey: "automationTemplateHealthName",
    promptKey: "automationTemplateHealthPrompt",
    schedule: { kind: "once", at: Date.now() + 86_400_000 },
    icon: "+",
  },
  {
    nameKey: "automationTemplateInterviewName",
    promptKey: "automationTemplateInterviewPrompt",
    schedule: { kind: "interval", every: 2, unit: "hours" },
    icon: "◌",
  },
  {
    nameKey: "automationTemplateMeetingName",
    promptKey: "automationTemplateMeetingPrompt",
    schedule: { kind: "once", at: Date.now() + 3_600_000 },
    icon: "⌘",
  },
];

function useAutomationTemplates(): Template[] {
  const { locale, t } = usePreferences();
  return useMemo(
    () => templateDefinitions.map(({ nameKey, promptKey, ...template }) => ({
      ...template,
      name: t(nameKey),
      prompt: t(promptKey),
    })),
    [t],
  );
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(`{${key}}`, String(value)),
    template,
  );
}

function formatDateTime(
  value: number | null,
  locale: ReturnType<typeof usePreferences>["locale"],
  t: ReturnType<typeof usePreferences>["t"],
): string {
  return value === null
    ? t("automationNoNextRun")
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);
}

function scheduleLabel(
  schedule: AutomationSchedule,
  locale: ReturnType<typeof usePreferences>["locale"],
  t: ReturnType<typeof usePreferences>["t"],
): string {
  if (schedule.kind === "once")
    return `${t("automationOnce")} · ${formatDateTime(schedule.at, locale, t)}`;
  if (schedule.kind === "interval")
    return formatMessage(t("automationEveryInterval"), {
      count: schedule.every,
      unit: t(
        schedule.unit === "minutes"
          ? "automationMinutes"
          : schedule.unit === "hours"
            ? "automationHours"
            : "automationDays",
      ),
    });
  const weekdays = locale === "zh-CN"
    ? ["日", "一", "二", "三", "四", "五", "六"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cadence =
    schedule.cadence === "daily"
      ? t("automationDaily")
      : schedule.cadence === "weekdays"
        ? t("automationWeekdays")
        : schedule.cadence === "monthly"
          ? `${t("automationMonthly")} ${schedule.dayOfMonth ?? 1}`
          : `${t("automationWeekly")} ${(schedule.weekdays ?? []).map((day) => weekdays[day]).join(locale === "zh-CN" ? "、" : ", ")}`;
  return `${cadence} ${schedule.time}`;
}

function statusLabel(
  status: AutomationRun["status"],
  t: ReturnType<typeof usePreferences>["t"],
): string {
  return (
    {
      queued: t("automationQueued"),
      running: t("automationRunning"),
      waiting: t("automationWaiting"),
      completed: t("automationCompleted"),
      failed: t("automationFailed"),
      cancelled: t("automationCancelled"),
      "configuration-error": t("automationConfigError"),
      interrupted: t("automationInterrupted"),
    } as const
  )[status];
}

export function AutomationView({
  leftOpen,
  onOpenSession,
  onToggleLeft,
}: {
  leftOpen: boolean;
  onOpenSession: (sessionId: string) => void;
  onToggleLeft: () => void;
}) {
  const client = useRuntimeClient();
  const { locale, t } = usePreferences();
  const templates = useAutomationTemplates();
  const [page, setPage] = useState<Page>({ kind: "list" });
  const [tab, setTab] = useState<Tab>("scheduled");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [query, setQuery] = useState("");
  const [runStatus, setRunStatus] = useState<"all" | AutomationRun["status"]>(
    "all",
  );
  const [collapsedRunGroups, setCollapsedRunGroups] = useState<Set<string>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextTasks, nextRuns] = await Promise.all([
        client.listAutomations(),
        client.listAutomationRuns(500),
      ]);
      setTasks(nextTasks);
      setRuns(nextRuns);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    return client.subscribe((event) => {
      if (
        event.event.type === "automation.changed" ||
        event.event.type === "automation-run.changed"
      )
        void load();
    });
  }, [client, load]);
  const run = async (operation: () => Promise<unknown>) => {
    try {
      setError(null);
      await operation();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const shownTasks = tasks.filter((task) =>
    `${task.name} ${task.prompt}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const shownRuns = runs.filter(
    (item) =>
      (runStatus === "all" || item.status === runStatus) &&
      `${item.automationName} ${item.error ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const runGroups = useMemo<RunGroup[]>(() => {
    const groups = new Map<string, RunGroup>();
    for (const run of shownRuns) {
      const id = run.automationId ?? `deleted:${run.automationName}`;
      const group = groups.get(id) ?? {
        id,
        name: run.automationName,
        runs: [],
      };
      group.runs.push(run);
      groups.set(id, group);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        runs: [...group.runs].sort(
          (left, right) => right.scheduledFor - left.scheduledFor,
        ),
      }))
      .sort(
        (left, right) =>
          right.runs[0]!.scheduledFor - left.runs[0]!.scheduledFor,
      );
  }, [shownRuns]);
  if (page.kind === "form")
    return (
      <AutomationForm
        initial={page.task}
        onBack={() => setPage({ kind: "list" })}
        onSaved={async () => {
          await load();
          setPage({ kind: "list" });
        }}
        template={page.template}
      />
    );
  if (page.kind === "templates")
    return (
      <TemplateGallery
        leftOpen={leftOpen}
        onBack={() => setPage({ kind: "list" })}
        onChoose={(template) => setPage({ kind: "form", template })}
        onToggleLeft={onToggleLeft}
      />
    );
  const batch = async (action: "enable" | "disable" | "delete") => {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      action === "delete" &&
      !window.confirm(
        formatMessage(t("automationDeleteSelectedConfirm"), { count: ids.length }),
      )
    )
      return;
    await run(() =>
      action === "delete"
        ? client.deleteAutomations(ids)
        : client.setAutomationsEnabled(ids, action === "enable"),
    );
    setSelected(new Set());
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Automation views" className="inline-flex border-b border-[#deded9] dark:border-border">
              <TabButton
                active={tab === "scheduled"}
                onClick={() => setTab("scheduled")}
              >
                {t("automationScheduledTasks")}
              </TabButton>
              <TabButton active={tab === "runs"} onClick={() => setTab("runs")}>
                {t("automationRunHistory")}
              </TabButton>
            </nav>
            {tasks.length ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                {tab === "runs" ? (
                  <RunStatusFilter
                    onChange={setRunStatus}
                    value={runStatus}
                  />
                ) : null}
                <label
                  className={`flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-[7px] bg-[#f0f0ed] px-2.5 dark:bg-muted ${tab === "runs" ? "w-[168px] shrink-0" : "min-w-[140px] flex-1 basis-[180px]"}`}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={tab === "runs" ? t("automationSearchRuns") : t("automationSearch")}
                    value={query}
                  />
                </label>
                {tab === "scheduled" ? (
                  <>
                    <Button
                      className="h-8 whitespace-nowrap text-[11px]"
                      onClick={() => setPage({ kind: "templates" })}
                      variant="secondary"
                    >
                      <LayoutTemplate className="h-3.5 w-3.5" />
                      {t("automationAddFromTemplate")}
                    </Button>
                    <Button
                      className="h-8 whitespace-nowrap text-[11px]"
                      onClick={() => setPage({ kind: "form" })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("automationAdd")}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-[7px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => setError(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="grid min-h-[320px] place-items-center">
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "scheduled" ? (
            tasks.length === 0 ? (
              <EmptyState
                onCreate={() => setPage({ kind: "form" })}
                onChooseTemplate={(template) =>
                  setPage({ kind: "form", template })
                }
              />
            ) : (
              <div className="mt-6">
                {selected.size ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 border-y border-border py-2 text-[11px]">
                    <span className="mr-auto text-muted-foreground">
                      {formatMessage(t("automationSelected"), { count: selected.size })}
                    </span>
                    <Button
                      className="h-7 text-[10px]"
                      onClick={() => void batch("enable")}
                      variant="outline"
                    >
                      {t("automationEnable")}
                    </Button>
                    <Button
                      className="h-7 text-[10px]"
                      onClick={() => void batch("disable")}
                      variant="outline"
                    >
                      {t("automationDisable")}
                    </Button>
                    <Button
                      className="h-7 text-[10px] text-destructive"
                      onClick={() => void batch("delete")}
                      variant="outline"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("delete")}
                    </Button>
                  </div>
                ) : null}
                <div className="space-y-1">
                  {shownTasks.map((task) => (
                    <TaskRow
                      checked={selected.has(task.id)}
                      key={task.id}
                      onCheck={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          checked ? next.add(task.id) : next.delete(task.id);
                          return next;
                        })
                      }
                      onDelete={() => {
                        if (
                          window.confirm(
                            formatMessage(t("automationDeleteConfirm"), { name: task.name }),
                          )
                        )
                          void run(() => client.deleteAutomations([task.id]));
                      }}
                      onEdit={() => setPage({ kind: "form", task })}
                      onRun={() =>
                        void run(() => client.runAutomation(task.id))
                      }
                      onToggle={() =>
                        void run(() =>
                          client.setAutomationsEnabled(
                            [task.id],
                            !task.enabled,
                          ),
                        )
                      }
                      task={task}
                    />
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="mt-6 space-y-3">
              {runGroups.length ? (
                runGroups.map((group) => (
                  <RunGroupSection
                    collapsed={collapsedRunGroups.has(group.id)}
                    group={group}
                    key={group.id}
                    onDelete={(item) => {
                      if (window.confirm(t("automationDeleteRunConfirm")))
                        void run(() => client.deleteAutomationRun(item.id));
                    }}
                    onOpen={(item) =>
                      item.sessionId && onOpenSession(item.sessionId)
                    }
                    onToggle={() =>
                      setCollapsedRunGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                  />
                ))
              ) : (
                <p className="py-20 text-center text-[12px] text-muted-foreground">
                  {t("automationNoRuns")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors ${active ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptyState({
  onCreate,
  onChooseTemplate,
}: {
  onCreate: () => void;
  onChooseTemplate: (template: Template) => void;
}) {
  const { locale, t } = usePreferences();
  const templates = useAutomationTemplates();
  return (
    <>
      <section className="flex min-h-[390px] flex-1 flex-col items-center justify-center pb-8">
        <div className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#c9cac4] text-[#aeb0a9]">
          <Check className="h-6 w-6" />
        </div>
        <p className="mt-5 text-[12px] text-muted-foreground">
          {t("automationFirstTask")}
        </p>
        <Button
          className="mt-5 h-8 text-[11px]"
          onClick={onCreate}
          variant="secondary"
        >
          <Plus className="h-3.5 w-3" />
          {t("automationAdd")}
        </Button>
      </section>
      <section className="pb-5">
        <h2 className="mb-4 text-[14px] font-semibold">{t("automationTemplates")}</h2>
        <TemplateGrid
          onChoose={(template) => template && onChooseTemplate(template)}
          templates={templates}
        />
      </section>
    </>
  );
}

function RunStatusFilter({
  onChange,
  value,
}: {
  onChange: (status: "all" | AutomationRun["status"]) => void;
  value: "all" | AutomationRun["status"];
}) {
  const { t } = usePreferences();
  const options: Array<{
    label: string;
    value: "all" | AutomationRun["status"];
  }> = [
    { value: "all", label: t("automationStatusAll") },
    { value: "queued", label: t("automationQueued") },
    { value: "running", label: t("automationRunning") },
    { value: "waiting", label: t("automationWaiting") },
    { value: "completed", label: t("automationCompleted") },
    { value: "failed", label: t("automationFailed") },
    { value: "configuration-error", label: t("automationConfigError") },
    { value: "cancelled", label: t("automationCancelled") },
    { value: "interrupted", label: t("automationInterrupted") },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("automationStatusAll")}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${value === "all" ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "bg-[#e8efd8] text-[#5f7430] dark:bg-[#4b5b2d] dark:text-[#d9ed9d]"}`}
        type="button"
      >
        <Funnel className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[148px] p-1.5">
        {options.map((option) => (
          <DropdownMenuItem
            className="justify-between"
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            {option.label}
            {value === option.value ? (
              <Check className="h-3.5 w-3.5 text-[#6d8438]" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplateGrid({
  onChoose,
  templates: items,
}: {
  onChoose: (template?: Template) => void;
  templates: Template[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((template) => (
        <button
          className="flex min-h-[82px] items-start gap-4 rounded-[8px] border border-border bg-card px-5 py-4 text-left shadow-[0_6px_16px_rgba(35,36,31,.035)] hover:border-[#bad275]"
          key={template.name}
          onClick={() => onChoose(template)}
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center text-[17px]">
            {template.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">
              {template.name}
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
              {template.prompt}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TemplateGallery({
  leftOpen,
  onBack,
  onChoose,
  onToggleLeft,
}: {
  leftOpen: boolean;
  onBack: () => void;
  onChoose: (template: Template) => void;
  onToggleLeft: () => void;
}) {
  const { t } = usePreferences();
  const templates = useAutomationTemplates();
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
      <header className="flex h-[62px] shrink-0 items-center border-b border-border px-5">
        {!leftOpen ? (
          <Button onClick={onToggleLeft} size="icon" variant="ghost">
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </Button>
        ) : null}
        <button
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("automations")}
        </button>
        <span className="mx-2 text-muted-foreground">/</span>
        <h1 className="text-[14px] font-semibold">{t("automationTemplateGallery")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-[1280px]">
          <TemplateGrid
            onChoose={(template) => template && onChoose(template)}
            templates={templates}
          />
        </div>
      </div>
    </section>
  );
}

function TaskRow({
  checked,
  onCheck,
  onDelete,
  onEdit,
  onRun,
  onToggle,
  task,
}: {
  checked: boolean;
  onCheck: (value: boolean) => void;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  task: AutomationTask;
}) {
  const { locale, t } = usePreferences();
  return (
    <div className="group flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-2 py-3 sm:flex-nowrap">
      <input
        aria-label={formatMessage(t("automationSelectTask"), { name: task.name })}
        checked={checked}
        onChange={(event) => onCheck(event.target.checked)}
        type="checkbox"
      />
      <Switch
        aria-label={task.enabled ? t("automationDisable") : t("automationEnable")}
        checked={task.enabled}
        className={automationSwitchClass}
        onCheckedChange={onToggle}
      />
      <div className="min-w-0 flex-1 basis-[200px]">
        <p className="truncate text-[12px] font-medium">{task.name}</p>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          {scheduleLabel(task.schedule, locale, t)} ·{" "}
          {task.workspaceId ? t("automationWorkspace") : t("automationRecentSession")}
        </p>
      </div>
      <div className="min-w-0 basis-[140px] text-left sm:text-right">
        <p className="text-[10px] text-muted-foreground">{t("automationNextRun")}</p>
        <p className="mt-1 text-[11px]">{formatDateTime(task.nextRunAt, locale, t)}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          aria-label={t("automationRunNow")}
          onClick={onRun}
          size="icon"
          title={t("automationRunNow")}
          variant="ghost"
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("automationEdit")}
          onClick={onEdit}
          size="icon"
          title={t("automationEdit")}
          variant="ghost"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("delete")}
          className="text-destructive"
          onClick={onDelete}
          size="icon"
          title={t("delete")}
          variant="ghost"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RunGroupSection({
  collapsed,
  group,
  onDelete,
  onOpen,
  onToggle,
}: {
  collapsed: boolean;
  group: RunGroup;
  onDelete: (item: AutomationRun) => void;
  onOpen: (item: AutomationRun) => void;
  onToggle: () => void;
}) {
  const { t } = usePreferences();
  return (
    <section className="overflow-hidden rounded-[8px] border border-border bg-card">
      <button
        aria-expanded={!collapsed}
        className="flex min-h-10 w-full items-center gap-2 px-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {group.name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatMessage(t("automationRunCount"), { count: group.runs.length })}
        </span>
      </button>
      {!collapsed ? (
        <div className="border-t border-border px-2">
          {group.runs.map((item) => (
            <RunRow
              item={item}
              key={item.id}
              onDelete={() => onDelete(item)}
              onOpen={() => onOpen(item)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunRow({
  item,
  onDelete,
  onOpen,
}: {
  item: AutomationRun;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { locale, t } = usePreferences();
  const active = item.status === "running" || item.status === "waiting";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-2 py-3 sm:flex-nowrap">
      {item.status === "completed" ? (
        <Check
          aria-label={statusLabel(item.status, t)}
          className="h-3.5 w-3.5 shrink-0 text-[#6d8438]"
        />
      ) : (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${item.status === "failed" || item.status === "configuration-error" ? "bg-destructive" : active ? "bg-[#d5a53d]" : "bg-muted-foreground"}`}
        />
      )}
      <button
        className="min-w-0 flex-1 basis-[180px] truncate text-left text-[12px] font-medium hover:underline disabled:no-underline"
        disabled={!item.sessionId}
        onClick={onOpen}
      >
        {item.automationName}
      </button>
      <span className="text-[10px] text-muted-foreground">
        {formatDateTime(item.scheduledFor, locale, t)}
      </span>
      <span className="min-w-[72px] text-[11px]">
        {statusLabel(item.status, t)}
      </span>
      {active ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <Button
          aria-label={t("automationDeleteRun")}
          className="text-destructive"
          onClick={onDelete}
          size="icon"
          variant="ghost"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      {item.error ? (
        <p className="basis-full pl-5 text-[10px] text-destructive">
          {item.error}
        </p>
      ) : null}
    </div>
  );
}

function AutomationForm({
  initial,
  onBack,
  onSaved,
  template,
}: {
  initial?: AutomationTask;
  onBack: () => void;
  onSaved: () => Promise<void>;
  template?: Template;
}) {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const defaultEntry =
    snapshot?.entries.find((entry) => entry.id === "general-work") ??
    snapshot?.entries.find((entry) => entry.availability === "available");
  const defaultModel =
    snapshot?.preferences.defaultModel ??
    (snapshot?.models.find((item) => item.enabled)
      ? {
          connectionId: snapshot.models.find((item) => item.enabled)!
            .connectionId,
          modelId: snapshot.models.find((item) => item.enabled)!.modelId,
        }
      : null);
  const source = initial ?? template;
  const [name, setName] = useState(source?.name ?? "");
  const [promptValue, setPromptValue] = useState<InlineSkillComposerValue>(
    EMPTY_PROMPT_VALUE,
  );
  const promptRef = useRef<InlineSkillComposerHandle>(null);
  const promptHydrated = useRef(false);
  const [entryId, setEntryId] = useState(
    initial?.entryId ?? defaultEntry?.id ?? "general-work",
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initial?.workspaceId ?? null,
  );
  const [model, setModel] = useState<ModelReference | null>(
    initial?.model ?? defaultModel,
  );
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    initial?.thinkingLevel ?? "medium",
  );
  const [accessLevel, setAccessLevel] = useState<SessionAccessLevel>(
    initial?.accessLevel ?? "full",
  );
  const [connectorIds, setConnectorIds] = useState<string[]>(
    initial?.connectorIds ?? [],
  );
  const [schedule, setSchedule] = useState<AutomationSchedule>(
    initial?.schedule ??
      template?.schedule ?? {
        kind: "recurring",
        cadence: "daily",
        time: "09:00",
      },
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [activeFrom, setActiveFrom] = useState<number | null>(
    initial?.activeFrom ?? null,
  );
  const [activeUntil, setActiveUntil] = useState<number | null>(
    initial?.activeUntil ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false);
  const [fullAccessAcknowledged, setFullAccessAcknowledged] = useState(false);
  const availableSkills =
    snapshot?.skills.skills.filter(
      (item) => item.enabled && item.state === "active",
    ) ?? [];
  const allSkills = snapshot?.skills.skills ?? [];
  const availableConnectors =
    snapshot?.connectors.connectors.filter(
      (item) => item.enabled && item.status === "ready",
    ) ?? [];
  const selectedModel = snapshot?.models.find(
    (item) =>
      item.connectionId === model?.connectionId &&
      item.modelId === model.modelId,
  );
  const selectedConnection = snapshot?.connections.find(
    (item) => item.id === model?.connectionId,
  );
  useEffect(() => {
    const nextLevel = thinkingLevelForModel(selectedModel, thinkingLevel);
    if (nextLevel !== thinkingLevel) setThinkingLevel(nextLevel);
  }, [selectedModel, thinkingLevel]);
  useEffect(() => {
    if (promptHydrated.current || !snapshot) return;
    const legacySkillIds = initial?.skillIds ?? [];
    const legacySkills = legacySkillIds.flatMap((id) => {
      const skill = allSkills.find((item) => item.id === id);
      return skill ? [skill] : [];
    });
    const parts: UserPromptPart[] = [
      ...(source?.prompt ? [{ type: "text" as const, text: source.prompt }] : []),
      ...legacySkills.map((skill) => ({
        type: "skill-reference" as const,
        skillId: skill.id,
        name: skill.name,
        source: skill.source,
      })),
    ];
    promptRef.current?.setValue(parts, { focus: false });
    promptHydrated.current = true;
  }, [allSkills, initial?.skillIds, snapshot, source?.prompt]);
  const selectModel = (next: ModelReference) => {
    const nextModel = snapshot?.models.find(
      (item) =>
        item.connectionId === next.connectionId && item.modelId === next.modelId,
    );
    setModel(next);
    setThinkingLevel((current) => thinkingLevelForModel(nextModel, current));
  };
  const insertSkill = (skill: SkillSummary) => {
    promptRef.current?.insertSkill(skill);
    window.setTimeout(() => promptRef.current?.focus(), 0);
  };
  const input: AutomationTaskInput = {
    name: name.trim(),
    prompt: promptValue.text.trim(),
    entryId,
    workspaceId,
    accessLevel,
    model,
    thinkingLevel,
    skillIds: promptValue.skillIds,
    connectorIds,
    schedule,
    activeFrom,
    activeUntil,
    enabled,
  };
  const hasRequiredFields = () => {
    if (!name.trim() || !promptValue.text.trim() || !entryId || !model) {
      setError(t("automationRequiredFields"));
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!hasRequiredFields()) return;
    setSaving(true);
    setError(null);
    try {
      initial
        ? await client.updateAutomation(initial.id, input)
        : await client.createAutomation(input);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const requestSave = () => {
    if (!hasRequiredFields()) return;
    if (accessLevel === "full") {
      setFullAccessConfirmOpen(true);
      return;
    }
    void save();
  };
  const confirmFullAccessSave = () => {
    if (!fullAccessAcknowledged) return;
    setFullAccessConfirmOpen(false);
    void save();
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
      <header className="flex min-h-[62px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
            onClick={onBack}
          >
            <ChevronLeft className="h-4 w-4" />
            {t("automations")}
          </button>
          <span className="text-muted-foreground">/</span>
          <h1 className="truncate text-[14px] font-semibold">
            {initial ? t("automationEditTitle") : t("automationCreateTitle")}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            className="h-8 whitespace-nowrap text-[11px]"
            onClick={onBack}
            variant="outline"
          >
            {t("cancel")}
          </Button>
          <Button
            className="h-8 whitespace-nowrap text-[11px]"
            disabled={saving}
            onClick={requestSave}
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("automationSave")}
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <form
          className="mx-auto w-full max-w-[920px] space-y-5 pb-12"
          onSubmit={(event) => {
            event.preventDefault();
            requestSave();
          }}
        >
          <Field label={t("automationName")}>
            <input
              autoFocus
              className={control}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("automationNamePlaceholder")}
              value={name}
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("automationAgent")}>
              <select
                className={control}
                onChange={(event) => setEntryId(event.target.value)}
                value={entryId}
              >
                {snapshot?.entries
                  .filter((item) => item.availability === "available")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("automationWorkspaceOptional")}>
              <select
                className={control}
                onChange={(event) => setWorkspaceId(event.target.value || null)}
                value={workspaceId ?? ""}
              >
                <option value="">{t("automationNoWorkspace")}</option>
                {snapshot?.workspaces
                  .filter((item) => item.availability === "available")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field compound label={t("automationPrompt")}>
            <div className="rounded-[10px] border border-[#cfcfca] bg-card shadow-[0_1px_2px_rgba(0,0,0,.025)] focus-within:border-[#96968f] dark:border-border">
              <InlineSkillComposer
                ariaLabel={t("automationPrompt")}
                className="min-h-[150px] w-full resize-y overflow-y-auto bg-transparent px-3.5 py-3 text-[16px] font-medium leading-7 text-[#353532] caret-[#252624] outline-none selection:bg-[#dff09b] dark:text-foreground dark:caret-foreground dark:selection:bg-[#4a5a26]"
                onChange={setPromptValue}
                onSubmit={() => void save()}
                placeholder={t("automationPromptPlaceholder")}
                placeholderClassName="left-3.5 top-3 text-[16px] font-normal leading-7"
                ref={promptRef}
                submitDisabled={saving}
              />
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <SkillInsertMenu
                    onSelect={insertSkill}
                    skills={availableSkills}
                  />
                  <ConnectorSwitchMenu
                    connectors={availableConnectors}
                    onChange={setConnectorIds}
                    selected={connectorIds}
                  />
                  <SingleSelectMenu
                    icon={<img alt="" className="h-3.5 w-3.5 shrink-0 object-contain" src={toolApprovalIcon} />}
                    items={[
                      {
                        description: t("automationFullAccessHelp"),
                        id: "full",
                        label: t("automationFullAccess"),
                      },
                      {
                        description: t("automationDefaultAccessHelp"),
                        id: "default",
                        label: t("automationDefaultAccess"),
                      },
                    ]}
                    label={
                      accessLevel === "full" ? t("automationFullAccess") : t("automationDefaultAccess")
                    }
                    onChange={(value) =>
                      setAccessLevel(value as SessionAccessLevel)
                    }
                    value={accessLevel}
                  />
                </div>
                <div className="ml-auto flex min-w-0 items-center gap-1">
                  <ThinkingLevelMenu
                    level={thinkingLevel}
                    model={selectedModel}
                    onChange={setThinkingLevel}
                  />
                  <ModelSelectMenu
                    model={model}
                    connections={snapshot?.connections ?? []}
                    models={
                      snapshot?.models.filter((item) => item.enabled) ?? []
                    }
                    onChange={selectModel}
                    providerAvatarId={selectedConnection?.avatarId}
                    providerId={selectedConnection?.providerId}
                    selectedLabel={selectedModel?.displayName ?? t("automationSelectModel")}
                  />
                </div>
              </div>
            </div>
          </Field>
          {accessLevel === "default" ? (
            <p className="rounded-[7px] border border-[#d8c787] bg-[#fff9e7] px-3 py-2 text-[10px] leading-4 text-[#79611b] dark:bg-[#302b1c] dark:text-[#e2ca77]">
              {t("automationAccessWarning")}
            </p>
          ) : null}
          <Field label={t("automationFrequency")}>
            <ScheduleEditor schedule={schedule} setSchedule={setSchedule} />
          </Field>
          <Field label={t("automationActiveDates")}>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                aria-label={t("automationStartDate")}
                className={control}
                lang={locale}
                onChange={(event) =>
                  setActiveFrom(
                    event.target.value
                      ? new Date(`${event.target.value}T00:00:00`).getTime()
                      : null,
                  )
                }
                type="date"
                value={
                  activeFrom === null
                    ? ""
                    : new Date(
                        activeFrom -
                          new Date(activeFrom).getTimezoneOffset() * 60_000,
                      )
                        .toISOString()
                        .slice(0, 10)
                }
              />
              <input
                aria-label={t("automationEndDate")}
                className={control}
                lang={locale}
                onChange={(event) =>
                  setActiveUntil(
                    event.target.value
                      ? new Date(`${event.target.value}T23:59:59.999`).getTime()
                      : null,
                  )
                }
                type="date"
                value={
                  activeUntil === null
                    ? ""
                    : new Date(
                        activeUntil -
                          new Date(activeUntil).getTimezoneOffset() * 60_000,
                      )
                        .toISOString()
                        .slice(0, 10)
                }
              />
            </div>
          </Field>
          <div className="flex min-h-11 items-center justify-between rounded-[8px] border border-border bg-card px-3">
            <div>
              <p className="text-[12px] font-medium">{t("automationEnableAfterSave")}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t("automationEnableAfterSaveHelp")}
              </p>
            </div>
            <Switch
              aria-label={t("automationEnableAfterSave")}
              checked={enabled}
              className={automationSwitchClass}
              onCheckedChange={setEnabled}
            />
          </div>
          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
        </form>
      </div>
      <AutomationFullAccessConfirmDialog
        acknowledged={fullAccessAcknowledged}
        isEditing={Boolean(initial)}
        onCancel={() => {
          if (saving) return;
          setFullAccessConfirmOpen(false);
          setFullAccessAcknowledged(false);
        }}
        onConfirm={confirmFullAccessSave}
        onUseDefault={() => {
          if (saving) return;
          setAccessLevel("default");
          setFullAccessConfirmOpen(false);
          setFullAccessAcknowledged(false);
        }}
        onAcknowledgedChange={setFullAccessAcknowledged}
        open={fullAccessConfirmOpen}
        saving={saving}
      />
    </section>
  );
}

function AutomationFullAccessConfirmDialog({
  acknowledged,
  isEditing,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
  onUseDefault,
  open,
  saving,
}: {
  acknowledged: boolean;
  isEditing: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onUseDefault: () => void;
  open: boolean;
  saving: boolean;
}) {
  const { t } = usePreferences();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open, saving]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-[#21211f]/45 px-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onCancel();
      }}
    >
      <section
        aria-describedby="automation-full-access-description"
        aria-labelledby="automation-full-access-title"
        aria-modal="true"
        className="w-full max-w-[440px] rounded-[18px] border border-white/60 bg-white p-5 text-[#242421] shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:border-border dark:bg-card dark:text-foreground"
        role="alertdialog"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#b34b42]" />
          <h2 className="text-[15px] font-semibold" id="automation-full-access-title">
            {t("automationFullAccessConfirmTitle")}
          </h2>
        </div>
        <p
          className="mt-4 text-[12px] leading-5 text-[#5c5c56] dark:text-muted-foreground"
          id="automation-full-access-description"
        >
          {t("automationFullAccessConfirmIntro")}
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[12px] leading-5 text-[#3f3f3a] dark:text-foreground">
          <li>{t("automationFullAccessConfirmFile")}</li>
          <li>{t("automationFullAccessConfirmConnector")}</li>
          <li>{t("automationFullAccessConfirmCommand")}</li>
        </ul>
        <label className="mt-5 flex cursor-pointer items-center gap-2 text-[12px] text-[#4e4e49] dark:text-muted-foreground">
          <input
            checked={acknowledged}
            className="h-4 w-4 accent-[#b34b42]"
            disabled={saving}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
            type="checkbox"
          />
          <span>{t("fullAccessAcknowledgement")}</span>
        </label>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button className="mr-auto h-8 whitespace-nowrap text-[11px]" disabled={saving} onClick={onUseDefault} type="button" variant="ghost">
            {t("automationUseDefaultAccess")}
          </Button>
          <Button className="h-8 text-[11px]" disabled={saving} onClick={onCancel} type="button" variant="outline">
            {t("cancel")}
          </Button>
          <Button
            className="h-8 bg-[#b34b42] text-[11px] text-white hover:bg-[#963d35] disabled:bg-[#d5a29c]"
            disabled={!acknowledged || saving}
            onClick={onConfirm}
            type="button"
          >
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {isEditing ? t("automationConfirmSave") : t("automationConfirmCreate")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Field({
  children,
  compound = false,
  label,
}: {
  children: React.ReactNode;
  compound?: boolean;
  label: string;
}) {
  if (compound) {
    return (
      <div className="block">
        <span className="mb-1.5 block text-[12px] text-muted-foreground">
          {label}
        </span>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
type MenuOption = {
  description?: string;
  icon?: React.ReactNode;
  id: string;
  label: string;
};

function MenuTrigger({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenuTrigger
      className="inline-flex h-8 max-w-[180px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[11px] font-medium text-[#555650] outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground"
      type="button"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>
  );
}

function SingleSelectMenu({
  icon,
  items,
  label,
  onChange,
  value,
}: {
  icon: React.ReactNode;
  items: MenuOption[];
  label: string;
  onChange: (id: string) => void;
  value: string;
}) {
  const { t } = usePreferences();
  return (
    <DropdownMenu>
      <MenuTrigger icon={icon} label={label} />
      <DropdownMenuContent align="start" className="w-[296px] max-w-[calc(100vw-24px)] p-1.5">
        {items.map((item) => (
          <DropdownMenuItem
            className="min-h-[56px] items-start gap-2 px-2 py-2"
            key={item.id}
            onSelect={() => onChange(item.id)}
          >
            <span
              className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-[9px] ${value === item.id ? "border-[#6d8438] bg-[#6d8438] text-white" : "border-[#bdbdb6] text-transparent"}`}
            >
              ✓
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {item.label}
              </span>
              {item.description ? (
                <span className="mt-0.5 block whitespace-normal text-[10px] leading-[1.45] text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThinkingLevelMenu({
  level,
  model,
  onChange,
}: {
  level: ThinkingLevel;
  model: EnabledModelRecord | undefined;
  onChange: (level: ThinkingLevel) => void;
}) {
  const { t } = usePreferences();
  const supportedLevels: ThinkingLevel[] = model?.capabilities.supportsReasoning
    ? model.capabilities.supportedThinkingLevels
    : ["off"];

  return (
    <DropdownMenu>
      <MenuTrigger
        icon={<Brain className="h-3.5 w-3.5" />}
        label={thinkingLevelLabel(level, t)}
      />
      <DropdownMenuContent align="end" className="w-[168px] p-1.5">
        {supportedLevels.map((candidate) => (
          <DropdownMenuItem
            className="justify-between"
            key={candidate}
            onSelect={() => onChange(candidate)}
          >
            {thinkingLevelLabel(candidate, t)}
            {candidate === level ? (
              <Check className="h-3.5 w-3.5 text-[#6d8438]" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelSelectMenu({
  connections,
  model,
  models,
  onChange,
  providerAvatarId,
  providerId,
  selectedLabel,
}: {
  connections: ProviderConnectionRecord[];
  model: ModelReference | null;
  models: EnabledModelRecord[];
  onChange: (model: ModelReference) => void;
  providerAvatarId?: import("@wordless/domain").ProviderAvatarId | null;
  providerId?: string;
  selectedLabel: string;
}) {
  const { t } = usePreferences();
  return (
    <DropdownMenu>
      <MenuTrigger
        icon={
          <ProviderIcon
            avatarId={providerAvatarId}
            className="h-3.5 w-3.5 shrink-0 object-contain"
            providerId={providerId}
          />
        }
        label={selectedLabel}
      />
      <DropdownMenuContent
        align="end"
        className="max-h-[320px] w-[280px] overflow-y-auto p-1.5"
      >
        {models.length ? (
          models.map((item) => {
            const connection = connections.find(
              (candidate) => candidate.id === item.connectionId,
            );
            const selected =
              model?.connectionId === item.connectionId &&
              model.modelId === item.modelId;
            return (
              <DropdownMenuItem
                className="min-h-9 gap-2"
                key={`${item.connectionId}:${item.modelId}`}
                onSelect={() =>
                  onChange({
                    connectionId: item.connectionId,
                    modelId: item.modelId,
                  })
                }
              >
                <ProviderIcon
                  avatarId={connection?.avatarId}
                  className="h-4 w-4 shrink-0 object-contain"
                  providerId={connection?.providerId}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {item.displayName}
                </span>
                {selected ? (
                  <Check className="h-3.5 w-3.5 text-[#6d8438]" />
                ) : null}
              </DropdownMenuItem>
            );
          })
        ) : (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            {t("automationNoModels")}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScheduleEditor({
  schedule,
  setSchedule,
}: {
  schedule: AutomationSchedule;
  setSchedule: (schedule: AutomationSchedule) => void;
}) {
  const { locale, t } = usePreferences();
  const kind = schedule.kind;
  const weekdays = locale === "zh-CN"
    ? ["日", "一", "二", "三", "四", "五", "六"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div>
      <div className="inline-flex rounded-[8px] bg-[#eeeeeb] p-1 dark:bg-muted">
        {(["recurring", "interval", "once"] as const).map((item) => (
          <button
            className={`rounded-[6px] px-3 py-1.5 text-[11px] whitespace-nowrap ${kind === item ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            key={item}
            onClick={() =>
              setSchedule(
                item === "recurring"
                  ? { kind: "recurring", cadence: "daily", time: "09:00" }
                  : item === "interval"
                    ? { kind: "interval", every: 1, unit: "hours" }
                    : { kind: "once", at: Date.now() + 3_600_000 },
              )
            }
            type="button"
          >
            {item === "recurring"
              ? t("automationRecurring")
              : item === "interval"
                ? t("automationInterval")
                : t("automationOnce")}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {schedule.kind === "recurring" ? (
          <>
            <select
              className={`${control} w-auto`}
              onChange={(event) =>
                setSchedule({
                  ...schedule,
                  cadence: event.target.value as typeof schedule.cadence,
                  ...(event.target.value === "weekly" ? { weekdays: [1] } : {}),
                  ...(event.target.value === "monthly"
                    ? { dayOfMonth: 1 }
                    : {}),
                })
              }
              value={schedule.cadence}
            >
              <option value="daily">{t("automationDaily")}</option>
              <option value="weekdays">{t("automationWeekdays")}</option>
              <option value="weekly">{t("automationWeekly")}</option>
              <option value="monthly">{t("automationMonthly")}</option>
            </select>
            {schedule.cadence === "weekly" ? (
              <span className="flex h-9 max-w-full items-center gap-1 overflow-x-auto">
                {weekdays.map(
                  (label, index) => {
                    const active = (schedule.weekdays ?? []).includes(index);
                    return (
                      <button
                        aria-pressed={active}
                        className={`grid h-8 min-w-8 place-items-center rounded-[6px] border px-1 text-[10px] ${active ? "border-[#7d963f] bg-[#edf4d9] text-[#40521a] dark:bg-[#303b1d]" : "border-border bg-card text-muted-foreground"}`}
                        key={label}
                        onClick={() => {
                          const current = schedule.weekdays ?? [];
                          const next = active
                            ? current.filter((day) => day !== index)
                            : [...current, index].sort();
                          setSchedule({
                            ...schedule,
                            weekdays: next.length ? next : [index],
                          });
                        }}
                        type="button"
                      >
                        {label}
                      </button>
                    );
                  },
                )}
              </span>
            ) : null}
            {schedule.cadence === "monthly" ? (
              <input
                className={`${control} w-24`}
                max={31}
                min={1}
                onChange={(event) =>
                  setSchedule({
                    ...schedule,
                    dayOfMonth: Number(event.target.value),
                  })
                }
                type="number"
                value={schedule.dayOfMonth ?? 1}
              />
            ) : null}
            <input
              className={`${control} w-auto`}
              onChange={(event) =>
                setSchedule({ ...schedule, time: event.target.value })
              }
              type="time"
              value={schedule.time}
            />
          </>
        ) : schedule.kind === "interval" ? (
          <>
            <input
              className={`${control} w-24`}
              min={1}
              onChange={(event) =>
                setSchedule({ ...schedule, every: Number(event.target.value) })
              }
              type="number"
              value={schedule.every}
            />
            <select
              className={`${control} w-auto`}
              onChange={(event) =>
                setSchedule({
                  ...schedule,
                  unit: event.target.value as typeof schedule.unit,
                })
              }
              value={schedule.unit}
            >
              <option value="minutes">{t("automationMinutes")}</option>
              <option value="hours">{t("automationHours")}</option>
              <option value="days">{t("automationDays")}</option>
            </select>
          </>
        ) : (
          <input
            className={`${control} w-auto`}
            onChange={(event) =>
              setSchedule({
                kind: "once",
                at: new Date(event.target.value).getTime(),
              })
            }
            type="datetime-local"
            value={new Date(
              schedule.at - new Date(schedule.at).getTimezoneOffset() * 60_000,
            )
              .toISOString()
              .slice(0, 16)}
          />
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {t("automationScheduleTimezoneHelp")}
      </p>
    </div>
  );
}
