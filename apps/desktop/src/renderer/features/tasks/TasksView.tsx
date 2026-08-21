import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@wordless/ui-kit";
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  CircleDashed,
  Columns3,
  Eye,
  List,
  ListTodo,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Search,
  SignalHigh,
  SignalLow,
  SignalMedium,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type {
  ModelReference,
  SessionAccessLevel,
  SkillSummary,
  TaskRecord,
  TaskRecordInput,
  TaskStatus,
  ThinkingLevel,
  ToolApprovalMode,
} from "@wordless/domain";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { usePreferences } from "../../shared/preferences";
import type { MessageKey } from "../../shared/i18n";
import { AgentEntryIcon } from "../workbench/AgentEntryIcon";
import {
  InlineSkillComposer,
  type InlineSkillComposerHandle,
  type InlineSkillComposerValue,
} from "../thread/InlineSkillComposer";
import {
  ConnectorSwitchMenu,
  SkillInsertMenu,
} from "../thread/PromptCapabilityControls";
import {
  ModelSelectMenu,
  SingleSelectMenu,
  ThinkingLevelMenu,
} from "../automation/AutomationView";

const columns: Array<{ id: TaskStatus; labelKey: MessageKey; tone: string }> = [
  { id: "todo", labelKey: "tasksTodo", tone: "bg-[#94958f]" },
  { id: "in-progress", labelKey: "tasksInProgress", tone: "bg-[#3979cf]" },
  { id: "review", labelKey: "tasksReview", tone: "bg-[#dfa424]" },
  { id: "done", labelKey: "tasksDone", tone: "bg-[#288a55]" },
];
const emptyValue: InlineSkillComposerValue = {
  parts: [],
  skillIds: [],
  skillTokenCounts: {},
  skillQuery: null,
  taskQuery: null,
  text: "",
  workspaceReferenceCount: 0,
  workspaceQuery: null,
};
const emptyInput = (): TaskRecordInput => ({
  title: "",
  detailParts: [],
  status: "todo",
  dueAt: null,
  entryId: "general-work",
  workspaceId: null,
  sessionId: null,
  model: null,
  thinkingLevel: "medium",
  accessLevel: "full",
  toolApprovalMode: "bypass",
  connectorIds: [],
});
type TaskFilter = {
  status?: TaskStatus;
  agent?: string;
  priority?: NonNullable<TaskRecord["priority"]>;
  overdue?: boolean;
};

function dateInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(
    timestamp - new Date(timestamp).getTimezoneOffset() * 60_000,
  );
  return date.toISOString().slice(0, 10);
}

function taskCompletionTimestamp(task: TaskRecord): number | null {
  if (task.completedAt !== null) return task.completedAt;
  // Older task records may have status=done without a completion timestamp.
  return task.status === "done" ? task.updatedAt : null;
}

function executionLabel(
  status: TaskRecord["execution"]["status"],
  t: (key: MessageKey) => string,
): string {
  const keys: Record<TaskRecord["execution"]["status"], MessageKey> = {
    idle: "taskNotRun",
    starting: "taskStarting",
    running: "taskRunning",
    waiting: "taskWaiting",
    completed: "taskRunComplete",
    failed: "taskRunFailed",
    cancelled: "taskCancelled",
    blocked: "taskBlocked",
    interrupted: "taskInterrupted",
  };
  return t(keys[status]);
}

function taskStatusLabelKey(status: TaskStatus): MessageKey {
  if (status === "done") return "tasksDone";
  if (status === "review") return "tasksReview";
  if (status === "in-progress") return "tasksInProgress";
  return "tasksTodo";
}

function taskStatusVisual(status: TaskStatus) {
  const visuals = {
    todo: { Icon: CircleDashed, className: "bg-muted text-[#777b73]" },
    "in-progress": { Icon: Timer, className: "bg-[#e7f0fb] text-[#2d6dad]" },
    review: { Icon: Eye, className: "bg-[#fbf1d9] text-[#9a6a08]" },
    done: { Icon: CheckCircle2, className: "bg-[#e6f2e8] text-[#287744]" },
  } satisfies Record<TaskStatus, { Icon: typeof CircleDashed; className: string }>;
  return visuals[status];
}

function taskPriorityVisual(priority: NonNullable<TaskRecord["priority"]>) {
  const visuals = {
    high: { Icon: SignalHigh, labelKey: "taskHigh" as const, className: "bg-[#f8e8e5] text-[#a34b42]" },
    medium: { Icon: SignalMedium, labelKey: "taskMedium" as const, className: "bg-[#fbf1d9] text-[#946708]" },
    low: { Icon: SignalLow, labelKey: "taskLow" as const, className: "bg-[#e7f0fb] text-[#2d6dad]" },
  } satisfies Record<NonNullable<TaskRecord["priority"]>, { Icon: typeof SignalHigh; labelKey: MessageKey; className: string }>;
  return visuals[priority];
}

export function TasksView({
  leftOpen,
  onOpenSession,
  onToggleLeft,
}: {
  leftOpen: boolean;
  onOpenSession: (sessionId: string) => void;
  onToggleLeft: () => void;
}) {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<
    "overview" | "board" | "timeline" | "list" | "dashboard"
  >(
    "overview",
  );
  const [editing, setEditing] = useState<TaskRecord | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [filter, setFilter] = useState<TaskFilter>({});
  const [listPage, setListPage] = useState(1);
  const listPageSize = 10;
  const refresh = async () => {
    try {
      setTasks(await client.listTasks());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    return client.subscribe((event) => {
      if (event.event.type === "task.changed") void refresh();
    });
  }, [client]);
  const visible = useMemo(
    () =>
      tasks.filter((task) =>
        `${task.title} ${task.detailParts.map((part) => (part.type === "text" ? part.text : part.name)).join(" ")}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [query, tasks],
  );
  const agentName = (task: TaskRecord) => {
    if (task.sessionId) {
      const session = snapshot?.sessions.find(
        (candidate) => candidate.id === task.sessionId,
      );
      if (session?.expertSelection)
        return (
          snapshot?.experts.find(
            (candidate) => candidate.id === session.expertSelection?.id,
          )?.name ?? session.entryId
        );
      const labelKey = snapshot?.entries.find(
        (candidate) => candidate.id === session?.entryId,
      )?.labelKey;
      return labelKey ? t(labelKey as MessageKey) : t("taskAgent");
    }
    if (task.expertSelection)
      return (
        snapshot?.experts.find(
          (candidate) => candidate.id === task.expertSelection?.id,
        )?.name ?? t("taskAgent")
      );
    return task.entryId
      ? (() => {
          const labelKey = snapshot?.entries.find(
            (candidate) => candidate.id === task.entryId,
          )?.labelKey;
          return labelKey ? t(labelKey as MessageKey) : task.entryId;
        })()
      : t("taskAgent");
  };
  const agentIconKey = (task: TaskRecord) => {
    const session = task.sessionId
      ? snapshot?.sessions.find((candidate) => candidate.id === task.sessionId)
      : undefined;
    const entryId = session?.entryId ?? task.entryId ?? "general-work";
    return snapshot?.entries.find((entry) => entry.id === entryId)?.iconKey ?? "sparkles";
  };
  const execute = async (task: TaskRecord) => {
    setError(null);
    try {
      await client.executeTask(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const move = async (event: DragEvent, status: TaskStatus) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/task");
    setDragOverStatus(null);
    setDraggingTaskId(null);
    if (id) await client.moveTask(id, status);
  };
  const filtered = useMemo(
    () =>
      visible.filter((task) => {
        if (filter.status && task.status !== filter.status) return false;
        if (filter.agent && agentName(task) !== filter.agent) return false;
        if (filter.priority && task.priority !== filter.priority) return false;
        if (
          filter.overdue &&
          (task.status === "done" ||
            task.dueAt === null ||
            task.dueAt >= Date.now())
        )
          return false;
        return true;
      }),
    [agentName, filter, visible],
  );
  const listPageCount = Math.max(1, Math.ceil(filtered.length / listPageSize));
  const listTasks = filtered.slice((listPage - 1) * listPageSize, listPage * listPageSize);
  useEffect(() => setListPage(1), [filter, query]);

  if (editing !== null) {
    return (
      <TaskEditor
        t={t}
        initial={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
      <header className="shrink-0 border-b border-border bg-card/75 px-5 py-3 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {!leftOpen ? (
              <Button
                aria-label={t("expandSidebar")}
                onClick={onToggleLeft}
                size="icon"
                variant="ghost"
              >
                <ChevronLeft className="h-4 w-4 rotate-180" />
              </Button>
            ) : null}
            <div className="flex h-9 items-center gap-4">
              <button
                className={`flex h-full items-center gap-1.5 border-b-2 px-1 text-[12px] ${view === "overview" ? "border-[#4c6f2e] text-foreground" : "border-transparent text-muted-foreground"}`}
                onClick={() => setView("overview")}
                type="button"
              >
                <Activity className="h-3.5 w-3.5" />
                {t("tasksOverview")}
              </button>
              <div
                className={`flex h-full items-center gap-2 border-b-2 px-1 text-[12px] ${["board", "timeline", "list"].includes(view) ? "border-[#4c6f2e] text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                <button
                  aria-label={t("tasksBoard")}
                  className="flex items-center gap-1.5"
                  onClick={() => setView("board")}
                  title={t("tasksBoard")}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  {t("tasksBoard")}
                </button>
                {["board", "timeline", "list"].includes(view) ? (
                  <div className="ml-1 flex items-center gap-0.5 rounded-[6px] bg-muted/60 p-0.5">
                    <button
                      aria-label={t("tasksBoard")}
                      className={`grid h-6 w-6 place-items-center rounded-[4px] transition-colors ${view === "board" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setView("board")}
                      title={t("tasksBoard")}
                      type="button"
                    >
                      <Columns3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      aria-label={t("tasksTimeline")}
                      className={`grid h-6 w-6 place-items-center rounded-[4px] transition-colors ${view === "timeline" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setView("timeline")}
                      title={t("tasksTimeline")}
                      type="button"
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                    </button>
                    <button
                      aria-label={t("tasksList")}
                      className={`grid h-6 w-6 place-items-center rounded-[4px] transition-colors ${view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setView("list")}
                      title={t("tasksList")}
                      type="button"
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                className={`flex h-full items-center gap-1.5 border-b-2 px-1 text-[12px] ${view === "dashboard" ? "border-[#4c6f2e] text-foreground" : "border-transparent text-muted-foreground"}`}
                onClick={() => setView("dashboard")}
                type="button"
              >
                <ChartNoAxesCombined className="h-3.5 w-3.5" />
                {t("tasksDashboard")}
              </button>
            </div>
          </div>
          {view === "overview" || view === "board" || view === "list" ? (
            <div className="flex min-w-0 items-center gap-2">
              {view === "board" || view === "list" ? (
                <label className="relative w-[min(30vw,240px)] min-w-[150px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="h-8 w-full rounded-[7px] border border-border bg-card pl-9 pr-3 text-[12px] outline-none focus:border-[#9aaf61]"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("tasksSearchPlaceholder")}
                    value={query}
                  />
                </label>
              ) : null}
              <Button
                className="h-8 shrink-0 text-[11px]"
                onClick={() => setEditing("new")}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("tasksNew")}
              </Button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[1440px]">
          {error ? (
            <p className="mb-4 flex items-center gap-2 rounded-[7px] border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              <CircleAlert className="h-3.5 w-3.5" />
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="grid h-52 place-items-center">
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : view === "overview" ? (
            <TaskOverview
              tasks={tasks}
              agentIconKey={agentIconKey}
              agentName={agentName}
              locale={locale}
              onOpenTask={setEditing}
              t={t}
            />
          ) : view === "timeline" ? (
            <TaskTimeline
              tasks={tasks}
              agentName={agentName}
              locale={locale}
              onOpenTask={setEditing}
              t={t}
            />
          ) : view === "dashboard" ? (
            <TaskDashboard
              tasks={filtered}
              agentName={agentName}
              locale={locale}
              onOpenTask={setEditing}
              onFilter={(next) => {
                setFilter(next);
                setView("list");
              }}
              t={t}
            />
          ) : view === "board" ? (
            <div className="grid min-h-[calc(100dvh-112px)] min-w-[960px] grid-cols-4 items-stretch gap-4 pb-2">
              {columns.map((column) => (
                <section
                  className={`h-full min-h-[560px] rounded-[8px] border p-3 transition-[border-color,background-color,box-shadow,transform] duration-150 dark:border-border ${dragOverStatus === column.id ? "border-[#9aaf61] bg-[#edf3df] shadow-[0_0_0_2px_rgba(154,175,97,0.2)] dark:bg-[#303a1c]" : "border-[#e5e5e1] bg-[#f5f5f3] dark:bg-muted/40"}`}
                  key={column.id}
                  onDragEnter={() => setDragOverStatus(column.id)}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDragOverStatus(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dragOverStatus !== column.id) setDragOverStatus(column.id);
                  }}
                  onDrop={(event) => void move(event, column.id)}
                >
                  <header className="mb-3 flex items-center gap-2 px-1">
                    <span className={`h-4 w-1 rounded-full ${column.tone}`} />
                    <h2 className="text-[12px] font-semibold">
                      {t(column.labelKey)}
                    </h2>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {
                        filtered.filter((task) => task.status === column.id)
                          .length
                      }
                    </span>
                    <button
                      className="ml-auto p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing("new")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </header>
                  <div className="space-y-2">
                    {visible
                      .filter((task) => task.status === column.id)
                      .map((task) => (
                        <TaskCard
                          agent={agentName(task)}
                          agentIconKey={agentIconKey(task)}
                          dragging={draggingTaskId === task.id}
                          onDragEnd={() => {
                            setDraggingTaskId(null);
                            setDragOverStatus(null);
                          }}
                          onDragStart={() => setDraggingTaskId(task.id)}
                          t={t}
                          key={task.id}
                          onEdit={() => setEditing(task)}
                          onExecute={() => void execute(task)}
                          onOpenSession={onOpenSession}
                          task={task}
                        />
                      ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-112px)] min-h-[560px] flex-col pb-2">
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
                <Select value={filter.status ?? "all"} onValueChange={(value) => setFilter((current) => ({ ...current, status: value === "all" ? undefined : value as TaskStatus }))}>
                  <SelectTrigger className="h-8 w-[128px] rounded-[6px] border-0 bg-muted/45 px-2.5 text-[11px] shadow-none"><SelectValue placeholder={t("tasksColumnStatus")} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t("tasksAllStatuses")}</SelectItem>{columns.map((column) => <SelectItem key={column.id} value={column.id}>{t(column.labelKey)}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filter.agent ?? "all"} onValueChange={(value) => setFilter((current) => ({ ...current, agent: value === "all" ? undefined : value }))}>
                  <SelectTrigger className="h-8 w-[150px] rounded-[6px] border-0 bg-muted/45 px-2.5 text-[11px] shadow-none"><SelectValue placeholder={t("tasksColumnAgent")} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t("tasksAllAgents")}</SelectItem>{[...new Set(visible.map(agentName))].map((agent) => <SelectItem key={agent} value={agent}>{agent}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filter.priority ?? "all"} onValueChange={(value) => setFilter((current) => ({ ...current, priority: value === "all" ? undefined : value as NonNullable<TaskRecord["priority"]> }))}>
                  <SelectTrigger className="h-8 w-[128px] rounded-[6px] border-0 bg-muted/45 px-2.5 text-[11px] shadow-none"><SelectValue placeholder={t("taskPriority")} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t("tasksAllPriorities")}</SelectItem><SelectItem value="high">{t("taskHigh")}</SelectItem><SelectItem value="medium">{t("taskMedium")}</SelectItem><SelectItem value="low">{t("taskLow")}</SelectItem></SelectContent>
                </Select>
                <button aria-pressed={filter.overdue === true} className={`h-8 rounded-[6px] px-3 text-[11px] transition ${filter.overdue ? "bg-[#f8e8e5] text-[#a34b42]" : "bg-muted/45 text-muted-foreground hover:text-foreground"}`} onClick={() => setFilter((current) => ({ ...current, overdue: current.overdue ? undefined : true }))}>{t("tasksOverdueOnly")}</button>
                <span className="ml-auto text-[10px] text-muted-foreground">{filtered.length} {t("tasksItems")}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto"><div className="min-w-[920px]">
              <div className="grid grid-cols-[minmax(260px,1fr)_116px_110px_145px_125px_150px] px-4 py-2 font-mono text-[9px] uppercase text-muted-foreground">
                <span>{t("tasksColumnTask")}</span>
                <span>{t("tasksColumnStatus")}</span>
                <span>{t("taskPriority")}</span>
                <span>{t("tasksColumnAgent")}</span>
                <span>{t("tasksColumnDue")}</span>
                <span>{t("tasksColumnExecution")}</span>
              </div>
              {listTasks.map((task) => (
                <button
                  className="grid w-full grid-cols-[minmax(260px,1fr)_116px_110px_145px_125px_150px] items-center px-4 py-3 text-left text-[11px] hover:bg-muted/35"
                  key={task.id}
                  onClick={() => setEditing(task)}
                >
                  <strong className="truncate pr-4 text-[12px]">
                    {task.title}
                  </strong>
                  {(() => {
                    const visual = taskStatusVisual(task.status);
                    const StatusIcon = visual.Icon;
                    const column = columns.find((candidate) => candidate.id === task.status);
                    return <span className={`inline-flex w-fit items-center gap-1.5 rounded-[5px] px-2 py-1 text-[10px] font-medium ${visual.className}`}><StatusIcon className="h-3.5 w-3.5 shrink-0" />{column ? t(column.labelKey) : null}</span>;
                  })()}
                  {task.priority ? (() => {
                    const priority = taskPriorityVisual(task.priority);
                    const PriorityIcon = priority.Icon;
                    return <span className={`inline-flex w-fit items-center gap-1.5 rounded-[5px] px-2 py-1 text-[10px] font-medium ${priority.className}`}><PriorityIcon className="h-3.5 w-3.5" />{t(priority.labelKey)}</span>;
                  })() : <span className="text-muted-foreground">-</span>}
                  <span className="truncate pr-3">{agentName(task)}</span>
                  <span>
                    {task.dueAt
                      ? new Intl.DateTimeFormat(locale).format(task.dueAt)
                      : "-"}
                  </span>
                  <span className={`inline-flex w-fit items-center gap-1.5 rounded-[5px] px-2 py-1 text-[10px] font-medium ${["starting", "running", "waiting"].includes(task.execution.status) ? "bg-[#e7f0fb] text-[#2d6dad]" : task.execution.status === "failed" || task.execution.status === "blocked" ? "bg-[#f8e8e5] text-[#a34b42]" : task.execution.status === "completed" ? "bg-[#e6f2e8] text-[#287744]" : "bg-muted text-muted-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${["starting", "running", "waiting"].includes(task.execution.status) ? "bg-[#3478c9]" : task.execution.status === "failed" || task.execution.status === "blocked" ? "bg-[#c7584c]" : task.execution.status === "completed" ? "bg-[#288a55]" : "bg-[#94958f]"}`} />{executionLabel(task.execution.status, t)}</span>
                </button>
              ))}
              </div></div>
              <div className="flex h-12 shrink-0 items-center justify-center gap-1"><button className="h-7 rounded-[5px] px-2 text-[11px] text-muted-foreground disabled:opacity-35" disabled={listPage <= 1} onClick={() => setListPage((page) => Math.max(1, page - 1))}>{t("tasksPreviousPage")}</button>{Array.from({ length: listPageCount }, (_, index) => index + 1).map((page) => <button className={`h-7 min-w-7 rounded-[5px] px-2 text-[11px] ${page === listPage ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`} key={page} onClick={() => setListPage(page)}>{page}</button>)}<button className="h-7 rounded-[5px] px-2 text-[11px] text-muted-foreground disabled:opacity-35" disabled={listPage >= listPageCount} onClick={() => setListPage((page) => Math.min(listPageCount, page + 1))}>{t("tasksNextPage")}</button></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TaskCard({
  agent,
  agentIconKey,
  dragging,
  t,
  onDragEnd,
  onDragStart,
  onEdit,
  onExecute,
  onOpenSession,
  task,
}: {
  agent: string;
  agentIconKey: string;
  t: (key: MessageKey) => string;
  onEdit: () => void;
  dragging: boolean;
  onDragEnd: () => void;
  onDragStart: () => void;
  onExecute: () => void;
  onOpenSession: (id: string) => void;
  task: TaskRecord;
}) {
  const running = ["starting", "running", "waiting"].includes(
    task.execution.status,
  );
  return (
    <article
      className={`group rounded-[7px] border bg-card p-3 shadow-[0_1px_2px_rgba(30,30,25,.04)] transition-[opacity,transform,box-shadow,border-color] duration-150 hover:border-[#cfcfc8] ${dragging ? "scale-[0.98] cursor-grabbing border-[#9aaf61] opacity-55 shadow-[0_8px_20px_rgba(76,111,46,0.16)]" : "border-[#e2e2de]"}`}
      draggable
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/task", task.id);
        onDragStart();
      }}
    >
      <button className="block w-full text-left" onClick={onEdit}>
        <div className="flex min-h-9 items-start gap-1.5">
          <span
            aria-label={agent}
            className="mt-[3px] shrink-0 opacity-75"
            title={agent}
          >
            <AgentEntryIcon className="h-[15px] w-[15px]" iconKey={agentIconKey} />
          </span>
          <p className="min-w-0 text-[12px] font-semibold leading-[1.5] tracking-[-0.01em]">
            {task.title}
          </p>
        </div>
        <div className="mt-2 flex min-h-6 items-center gap-1.5">
          {task.priority ? (() => {
            const priority = taskPriorityVisual(task.priority);
            const PriorityIcon = priority.Icon;
            return <span className={`inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[10px] font-medium ${priority.className}`} title={t(priority.labelKey)}><PriorityIcon className="h-3.5 w-3.5" />{t(priority.labelKey)}</span>;
          })() : null}
          {task.dueAt ? (
            <span
              className={`${task.dueAt < Date.now() && task.status !== "done" ? "text-destructive" : "text-muted-foreground"} ml-auto flex min-w-0 items-center gap-1 text-[9px]`}
            >
              <CalendarDays className="h-3 w-3" />
              <span className="truncate">{new Intl.DateTimeFormat().format(task.dueAt)}</span>
            </span>
          ) : null}
        </div>
      </button>
      <div className="mt-3 flex items-center border-t border-border pt-2">
        <span
          className={`text-[9px] ${task.execution.status === "failed" || task.execution.status === "blocked" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {executionLabel(task.execution.status, t)}
        </span>
        <div className="ml-auto flex gap-1">
          {task.sessionId ? (
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onOpenSession(task.sessionId!)}
              title={t("taskOpenSession")}
            >
              <ListTodo className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#e6f2e8] text-[#287744] transition-colors hover:bg-[#d8eadd] disabled:opacity-60 disabled:hover:bg-[#e6f2e8]"
            disabled={running}
            onClick={onExecute}
            title={t("taskRun")}
          >
            {running ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function relativeTaskTime(
  timestamp: number,
  now: number,
  locale: Intl.LocalesArgument,
  t: (key: MessageKey) => string,
): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("tasksOverviewUpdatedJustNow");
  if (minutes < 60) {
    return locale === "zh-CN"
      ? `${minutes} ${t("tasksOverviewMinutesAgo")}`
      : `${minutes} ${t("tasksOverviewMinutesAgo")}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("tasksOverviewHoursAgo")}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${t("tasksOverviewDaysAgo")}`;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function TaskOverview({
  tasks,
  agentIconKey,
  agentName,
  locale,
  onOpenTask,
  t,
}: {
  tasks: TaskRecord[];
  agentIconKey: (task: TaskRecord) => string;
  agentName: (task: TaskRecord) => string;
  locale: Intl.LocalesArgument;
  onOpenTask: (task: TaskRecord) => void;
  t: (key: MessageKey) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const attentionTasks = [...tasks]
    .filter((task) => {
      const executionNeedsAttention = [
        "failed",
        "blocked",
        "interrupted",
        "waiting",
      ].includes(task.execution.status);
      const overdue =
        task.status !== "done" && task.dueAt !== null && task.dueAt < now;
      return overdue || executionNeedsAttention || task.status === "review";
    })
    .sort((a, b) => {
      const aOverdue = a.dueAt !== null && a.dueAt < now && a.status !== "done";
      const bOverdue = b.dueAt !== null && b.dueAt < now && b.status !== "done";
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 8);
  const startOfDay = (timestamp: number) => {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const todayStart = startOfDay(now);
  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  const upcomingGroups = [
    { label: t("tasksOverviewToday"), tone: "text-[#288a55]" },
    { label: t("tasksOverviewTomorrow"), tone: "text-[#d97908]" },
    { label: t("tasksOverviewDayAfterTomorrow"), tone: "text-[#2d6dad]" },
  ].map(({ label, tone }, offset) => {
    const start = todayStart + offset * 86_400_000;
    const end = start + 86_400_000;
    const groupTasks = tasks
      .filter(
        (task) =>
          task.status !== "done" &&
          task.dueAt !== null &&
          task.dueAt >= now &&
          task.dueAt >= start &&
          task.dueAt < end,
      )
      .sort(
        (a, b) =>
          priorityOrder[a.priority ?? "low"] -
            priorityOrder[b.priority ?? "low"] ||
          b.updatedAt - a.updatedAt,
      )
      .slice(0, 2);
    return { label, tone, tasks: groupTasks };
  });
  const upcomingTaskCount = upcomingGroups.reduce(
    (count, group) => count + group.tasks.length,
    0,
  );
  const recentTasks = [...tasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  const formatDueTime = (dueAt: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(dueAt);
  const overviewCardClass =
    "overflow-hidden rounded-[8px] border border-border bg-card shadow-sm dark:shadow-none";

  return (
    <div className="relative overflow-hidden pb-6">
      <div className="space-y-5 pt-2">
        <div className="grid gap-5 xl:grid-cols-2">
          <section className={overviewCardClass}>
            <div className="flex h-[54px] items-center justify-between gap-3 border-b border-border px-5">
              <h2 className="text-[16px] font-semibold text-[#e14343]">
                {t("tasksOverviewNeedsAttention")}
              </h2>
              <span className="font-mono text-[11px] text-[#e14343]">
                {attentionTasks.length}
              </span>
            </div>
            {attentionTasks.length ? (
              <div className="px-5">
                {attentionTasks.map((task) => {
                  const overdue =
                    task.status !== "done" &&
                    task.dueAt !== null &&
                    task.dueAt < now;
                  return (
                    <div className="group flex min-h-[68px] items-center gap-3 border-b border-border last:border-b-0" key={task.id}>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f8e8e5] text-[#b34b42]">
                        <CircleAlert className="h-3.5 w-3.5" />
                      </span>
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onOpenTask(task)}
                        title={task.title}
                        type="button"
                      >
                        <span className="block truncate text-[12px] font-medium group-hover:text-[#4c6f2e]">
                          {task.title}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                          {agentName(task)}
                          {task.priority
                            ? ` · ${t(taskPriorityVisual(task.priority).labelKey)}`
                            : ` · ${executionLabel(task.execution.status, t)}`}
                        </span>
                      </button>
                      <span className={`shrink-0 text-[10px] ${overdue || ["failed", "blocked", "interrupted"].includes(task.execution.status) ? "text-[#b34b42]" : "text-muted-foreground"}`}>
                        {overdue
                          ? t("tasksOverviewOverdue")
                          : executionLabel(task.execution.status, t)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-5 py-10 text-[12px] text-muted-foreground">
                {t("tasksOverviewNoAttention")}
              </p>
            )}
          </section>

          <section className={overviewCardClass}>
            <div className="flex h-[54px] items-center justify-between gap-3 border-b border-border px-5">
              <h2 className="text-[16px] font-semibold">
                {t("tasksOverviewRecentActivity")}
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {recentTasks.length}
              </span>
            </div>
            {recentTasks.length ? (
              <div className="px-5">
                {recentTasks.map((task) => (
                  <div className="group flex min-h-[58px] items-center gap-3 border-b border-border last:border-b-0" key={task.id}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/60">
                      <AgentEntryIcon className="h-3.5 w-3.5 opacity-75" iconKey={agentIconKey(task)} />
                    </span>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onOpenTask(task)}
                      title={task.title}
                      type="button"
                    >
                      <span className="block truncate text-[12px] font-medium group-hover:text-[#4c6f2e]">
                        {task.title}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                        {agentName(task)} · {executionLabel(task.execution.status, t)}
                      </span>
                    </button>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {relativeTaskTime(task.updatedAt, now, locale, t)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 py-10 text-[12px] text-muted-foreground">
                {t("tasksOverviewNoRecentActivity")}
              </p>
            )}
          </section>
        </div>

        <section className={overviewCardClass}>
          <div className="flex h-[58px] items-center justify-between gap-3 border-b border-border px-5">
            <div className="flex min-w-0 items-baseline gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-[#288a55]" />
              <h2 className="text-[16px] font-semibold text-[#287744]">
                {t("tasksOverviewUpcoming")}
              </h2>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {t("tasksOverviewNextThreeDays")}
              </span>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {upcomingTaskCount}
            </span>
          </div>
          {upcomingTaskCount ? (
            <div className="grid divide-y divide-border xl:grid-cols-3 xl:divide-x xl:divide-y-0">
              {upcomingGroups.map((group) => (
                <div className="grid min-w-0 grid-cols-[68px_minmax(0,1fr)] px-5 py-4" key={group.label}>
                  <div className={`flex flex-col gap-1 pt-1 ${group.tone}`}>
                    <span className="text-[11px] font-medium">{group.label}</span>
                    <span className="font-mono text-[22px] font-semibold leading-none">
                      {group.tasks.length}
                    </span>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    {group.tasks.map((task) => (
                      <div className="group flex min-w-0 items-center gap-2" key={task.id}>
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onOpenTask(task)}
                          title={task.title}
                          type="button"
                        >
                          <span className="block truncate text-[12px] font-medium group-hover:text-[#4c6f2e]">
                            {task.title}
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                            {formatDueTime(task.dueAt!)}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-8 text-[12px] text-muted-foreground">
              {t("tasksOverviewNoUpcoming")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function TaskTimeline({
  tasks,
  agentName,
  locale,
  onOpenTask,
  t,
}: {
  tasks: TaskRecord[];
  agentName: (task: TaskRecord) => string;
  locale: Intl.LocalesArgument;
  onOpenTask: (task: TaskRecord) => void;
  t: (key: MessageKey) => string;
}) {
  type Scale = "week" | "month" | "quarter" | "year" | "custom";
  const scaleLabelKeys: Record<Scale, MessageKey> = {
    week: "tasksTimelineWeek",
    month: "tasksTimelineMonth",
    quarter: "tasksTimelineQuarter",
    year: "tasksTimelineYear",
    custom: "tasksTimelineCustom",
  };
  const [scale, setScale] = useState<Scale>("week");
  const [customStart, setCustomStart] = useState(dateInput(Date.now() - 6 * 86_400_000));
  const [customEnd, setCustomEnd] = useState(dateInput(Date.now() + 7 * 86_400_000));
  const [customRangeTouched, setCustomRangeTouched] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const day = 86_400_000;
  const startOfDay = (value: Date) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
  const startOfWeek = (value: Date) => { const d = startOfDay(value); const weekday = d.getDay(); d.setDate(d.getDate() - (weekday === 0 ? 6 : weekday - 1)); return d; };
  const timelineAnchor = useMemo(
    () => tasks.reduce((latest, task) => Math.max(latest, task.createdAt, taskCompletionTimestamp(task) ?? 0), 0) || Date.now(),
    [tasks],
  );
  const range = useMemo(() => {
    let start: Date;
    let end: Date;
    const anchor = new Date(timelineAnchor);
    if (scale === "custom") {
      start = new Date(`${customStart}T00:00:00`);
      end = new Date(`${customEnd}T23:59:59`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { start = startOfWeek(anchor); end = new Date(start.getTime() + 7 * day - 1); }
      if (start > end) [start, end] = [end, start];
    } else if (scale === "week") { start = startOfWeek(anchor); end = new Date(start.getTime() + 7 * day - 1); }
    else if (scale === "month") { start = new Date(anchor.getFullYear(), anchor.getMonth(), 1); end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1); end = new Date(end.getTime() - 1); }
    else if (scale === "quarter") { const q = Math.floor(anchor.getMonth() / 3) * 3; start = new Date(anchor.getFullYear(), q, 1); end = new Date(anchor.getFullYear(), q + 3, 1); end = new Date(end.getTime() - 1); }
    else { start = new Date(anchor.getFullYear(), 0, 1); end = new Date(anchor.getFullYear() + 1, 0, 1); end = new Date(end.getTime() - 1); }
    return { start: start.getTime(), end: end.getTime() };
  }, [customEnd, customStart, scale, timelineAnchor]);
  const format = useCallback(
    (value: number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(
        locale,
        options ?? { month: "short", day: "numeric" },
      ).format(value),
    [locale],
  );
  const units = useMemo(() => {
    const addUnit = (start: Date, end: Date, label: string) => ({ start: start.getTime(), end: Math.min(end.getTime() - 1, range.end), label });
    if (scale === "quarter" || scale === "year") {
      const monthCount = scale === "quarter" ? 3 : 12;
      return Array.from({ length: monthCount }, (_, index) => {
        const start = new Date(new Date(range.start).getFullYear(), new Date(range.start).getMonth() + index, 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        return addUnit(start, end, format(start.getTime(), { month: "short", year: scale === "quarter" ? "numeric" : undefined }));
      });
    }
    const count = Math.ceil((range.end - range.start + 1) / day);
    const step = scale === "custom" && count > 62 ? 7 : 1;
    return Array.from({ length: Math.ceil(count / step) }, (_, index) => {
      const start = new Date(range.start + index * step * day);
      const end = new Date(start.getTime() + step * day);
      return addUnit(start, end, format(start.getTime(), step === 1 ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" }));
    });
  }, [format, range.end, range.start, scale]);
  const span = Math.max(range.end - range.start + 1, day);
  const cellWidth = units.length > 45 ? 56 : units.length > 31 ? 72 : 104;
  const timelineWidth = Math.max(790, units.length * cellWidth);
  const timelineColumns = units.map((unit) => `${Math.max(1, unit.end - unit.start + 1)}fr`).join(" ");
  const now = Date.now();
  const currentUnitIndex = units.findIndex(
    (unit) => now >= unit.start && now <= unit.end,
  );
  const groups = new Map<string, TaskRecord[]>();
  tasks.forEach((task) => { const key = agentName(task); groups.set(key, [...(groups.get(key) ?? []), task]); });
  const statusColor = (status: TaskStatus) => status === "done" ? "#18864b" : status === "review" ? "#c58a08" : status === "in-progress" ? "#3478c9" : "#8b8f87";
  const unitStartFor = (timestamp: number) => {
    const unit = [...units].reverse().find((item) => timestamp >= item.start);
    return Math.max(range.start, Math.min(unit?.start ?? range.start, range.end));
  };
  const selectScale = (nextScale: Scale) => {
    if (nextScale === "custom" && !customRangeTouched) {
      const anchorDay = startOfDay(new Date(timelineAnchor)).getTime();
      setCustomStart(dateInput(anchorDay - 3 * day));
      setCustomEnd(dateInput(anchorDay + 3 * day));
    }
    setScale(nextScale);
  };
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      if (!scroller) return;
      const anchorOffset = ((timelineAnchor - range.start) / span) * timelineWidth;
      const visibleTimelineWidth = Math.max(1, scroller.clientWidth - 190);
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, anchorOffset - visibleTimelineWidth / 2),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [range.end, range.start, scale, span, timelineAnchor, timelineWidth]);
  return (
    <div className="flex h-[calc(100dvh-112px)] min-h-[560px] flex-col overflow-hidden bg-transparent pb-2">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{t("tasksTimeline")}</p><h2 className="mt-1 text-[17px] font-semibold">{format(range.start)} - {format(range.end)}</h2></div>
          <div className="flex items-center gap-1 rounded-[6px] border border-border bg-muted/30 p-1">{(["week", "month", "quarter", "year", "custom"] as Scale[]).map((item) => <button key={item} className={`h-7 rounded-[4px] px-2.5 text-[11px] ${scale === item ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`} onClick={() => selectScale(item)}>{t(scaleLabelKeys[item])}</button>)}</div>
        </div>
        {scale === "custom" ? <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]"><input aria-label={t("tasksTimelineStartDate")} type="date" value={customStart} onChange={(e) => { setCustomRangeTouched(true); setCustomStart(e.target.value); }} className="h-8 rounded-[5px] border border-border bg-background px-2" /><span className="text-muted-foreground">{t("tasksTimelineTo")}</span><input aria-label={t("tasksTimelineEndDate")} type="date" value={customEnd} onChange={(e) => { setCustomRangeTouched(true); setCustomEnd(e.target.value); }} className="h-8 rounded-[5px] border border-border bg-background px-2" /></div> : null}
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#3478c9]" />{t("tasksInProgress")}</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#c58a08]" />{t("tasksReview")}</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#18864b]" />{t("tasksDone")}</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full border border-[#8b8f87]" />{t("tasksTodo")}</span></div>
      </div>
      {groups.size ? <div className="min-h-0 flex-1 overflow-auto" ref={timelineScrollRef}><div className="min-h-full" style={{ minWidth: 190 + timelineWidth }}>
        <div className="sticky top-0 z-30 grid grid-cols-[190px_auto] border-b border-border bg-[var(--wordless-shell-workspace)]"><div className="sticky left-0 z-40 bg-[var(--wordless-shell-workspace)] px-5 py-3 text-[10px] font-semibold text-muted-foreground">{t("tasksTimelineAgentTask")}</div><div className="grid" style={{ width: timelineWidth, gridTemplateColumns: timelineColumns }}>{units.map((unit, index) => <div aria-current={index === currentUnitIndex ? "date" : undefined} className={`border-l border-border px-2 py-3 text-center text-[10px] text-muted-foreground ${index === currentUnitIndex ? "bg-[#eff8d3]/70 text-[#4f6c21] dark:bg-[#303a1c] dark:text-[#d7e9a4]" : ""}`} key={unit.start}>{unit.label}</div>)}</div></div>
        {[...groups.entries()].map(([agent, group]) => <div className="grid grid-cols-[190px_auto] border-b border-border last:border-0" key={agent}><div className="sticky left-0 z-20 bg-[var(--wordless-shell-workspace)] px-5 py-4 text-[11px] font-semibold"><span className="block truncate" title={agent}>{agent}</span><span className="mt-1 block font-mono text-[9px] font-normal text-muted-foreground">{group.length} {t("tasksTimelineTaskCount")}</span></div><div className="relative" style={{ width: timelineWidth }}><div className="absolute inset-0 z-0 grid pointer-events-none" style={{ gridTemplateColumns: timelineColumns }}>{units.map((unit, index) => <div className={`border-l border-border/70 ${index === currentUnitIndex ? "bg-[#eff8d3]/45 dark:bg-[#303a1c]/45" : ""}`} key={unit.start} />)}</div><div className="relative z-10 py-2">{group.sort((a,b) => a.createdAt-b.createdAt).map((task) => { const taskStart = unitStartFor(task.createdAt); const endTime = taskCompletionTimestamp(task) ?? now; const left = Math.min(timelineWidth - cellWidth * .3, Math.max(0, (taskStart - range.start) / span * timelineWidth)); const rawWidth = (Math.min(endTime, range.end) - Math.max(taskStart, range.start)) / span * timelineWidth; const width = Math.max(rawWidth, 176); const statusLabel = t(taskStatusLabelKey(task.status)); return <div className="relative h-12" key={task.id}><button title={`${task.title} • ${statusLabel}`} onClick={() => onOpenTask(task)} className={`absolute top-1 flex h-10 items-center gap-2 overflow-hidden rounded-[5px] border px-2.5 text-left text-[11px] shadow-sm transition hover:-translate-y-px hover:shadow-md ${taskCompletionTimestamp(task) == null ? "border-dashed" : "border-solid"}`} style={{ left, width, backgroundColor: `${statusColor(task.status)}20`, borderColor: `${statusColor(task.status)}80`, color: statusColor(task.status) }}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor(task.status) }} /><span className="min-w-0 flex-1 truncate font-semibold text-foreground">{task.title}</span><span className="shrink-0 text-[9px]">{statusLabel}</span></button></div>; })}</div></div></div>)}
      </div></div> : <div className="grid h-48 place-items-center text-[12px] text-muted-foreground">{t("tasksNoTasks")}</div>}
    </div>
  );
}

function TaskDashboard({
  tasks,
  agentName,
  locale,
  onOpenTask,
  onFilter,
  t,
}: {
  tasks: TaskRecord[];
  agentName: (task: TaskRecord) => string;
  locale: Intl.LocalesArgument;
  onOpenTask: (task: TaskRecord) => void;
  onFilter: (filter: TaskFilter) => void;
  t: (key: MessageKey) => string;
}) {
  const trendFrameRef = useRef<HTMLDivElement>(null);
  const [trendViewportWidth, setTrendViewportWidth] = useState(760);
  useEffect(() => {
    const frame = trendFrameRef.current;
    if (!frame) return;
    const updateWidth = () => {
      const width = Math.round(frame.clientWidth);
      if (width > 0)
        setTrendViewportWidth((current) =>
          current === width ? current : width,
        );
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) =>
      task.status !== "done" && task.dueAt !== null && task.dueAt < Date.now(),
  ).length;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const statusCounts = columns.map((column) => ({
    ...column,
    count: tasks.filter((task) => task.status === column.id).length,
  }));
  const agents = [...new Set(tasks.map(agentName))].map((agent) => ({
    agent,
    tasks: tasks.filter((task) => agentName(task) === agent),
  }));
  const metrics: Array<{
    labelKey: MessageKey;
    value: string | number;
    color: string;
    filter: TaskFilter;
  }> = [
    { labelKey: "tasksMetricTotal", value: tasks.length, color: "#d9eafd", filter: {} },
    {
      labelKey: "tasksMetricCompletionRate",
      value: `${rate}%`,
      color: "#ccf257",
      filter: { status: "done" },
    },
    {
      labelKey: "tasksMetricCompleted",
      value: done,
      color: "#dcefdc",
      filter: { status: "done" },
    },
    {
      labelKey: "tasksMetricOverdue",
      value: overdue,
      color: "#ffe2dc",
      filter: { overdue: true },
    },
  ];
  const day = 86_400_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const trend = Array.from({ length: 7 }, (_, index) => {
    const start = today.getTime() - (6 - index) * day;
    const end = start + day;
    return {
      label: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
        start,
      ),
      created: tasks.filter(
        (task) => task.createdAt >= start && task.createdAt < end,
      ).length,
      completed: tasks.filter(
        (task) => {
          const completedAt = taskCompletionTimestamp(task);
          return completedAt !== null && completedAt >= start && completedAt < end;
        },
      ).length,
    };
  });
  const trendMax = Math.max(
    1,
    ...trend.flatMap((item) => [item.created, item.completed]),
  );
  const trendWidth = trendViewportWidth;
  const trendHeight = 210;
  const chartPadding = { top: 18, right: 8, bottom: 30, left: 8 };
  const chartWidth = trendWidth - chartPadding.left - chartPadding.right;
  const chartHeight = trendHeight - chartPadding.top - chartPadding.bottom;
  const trendPoint = (value: number, index: number) => ({
    x: chartPadding.left + (index / Math.max(1, trend.length - 1)) * chartWidth,
    y: chartPadding.top + (1 - value / trendMax) * chartHeight,
  });
  const createdPoints = trend.map((item, index) => trendPoint(item.created, index));
  const completedPoints = trend.map((item, index) => trendPoint(item.completed, index));
  const smoothPath = (points: Array<{ x: number; y: number }>) => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
    return points.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1]!;
      const midpoint = (previous.x + point.x) / 2;
      return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
    }, "");
  };
  const createdTotal = trend.reduce((sum, item) => sum + item.created, 0);
  const completedTotal = trend.reduce((sum, item) => sum + item.completed, 0);
  const focusIndex = trend.reduce(
    (best, item, index) => (item.completed > 0 ? index : best),
    trend.length - 1,
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ labelKey, value, color, filter: metricFilter }) => (
          <button
            className="overflow-hidden rounded-[8px] border border-border bg-card text-left hover:border-[#9aaf61]"
            key={labelKey}
            onClick={() => onFilter(metricFilter as TaskFilter)}
          >
            <span
              className="block h-1"
              style={{ backgroundColor: String(color) }}
            />
            <div className="p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                {t(labelKey)}
              </p>
              <p className="mt-3 text-[28px] font-semibold">{value}</p>
            </div>
          </button>
        ))}
      </div>
      <section className="rounded-[10px] border border-[#e2e2dc] bg-card p-5 shadow-[0_8px_20px_rgba(36,36,30,.025)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-.04em]">
              {t("tasksDeliveryTrend")}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-[4px] bg-[#eff8d3] px-2 py-1 font-mono text-[9px] font-semibold text-[#4f6c21]">
              {rate}% {t("tasksComplete")}
            </span>
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-[7px] bg-[#fafaf8] pt-2 dark:bg-[#20221b]" ref={trendFrameRef}>
          <svg
            aria-label={t("tasksDeliveryTrendAria")}
            className="block h-[210px] w-full"
            fill="none"
            role="img"
            viewBox={`0 0 ${trendWidth} ${trendHeight}`}
          >
            {[0, 0.33, 0.66, 1].map((ratio) => {
              const y = chartPadding.top + ratio * chartHeight;
              return <line className="stroke-[#e9e9e4] dark:stroke-[#35372e]" key={ratio} strokeWidth="1" x1={chartPadding.left} x2={trendWidth - chartPadding.right} y1={y} y2={y} />;
            })}
            <path d={smoothPath(completedPoints)} stroke="#ccf257" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
            <path d={smoothPath(createdPoints)} stroke="#242521" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            {trend.map((item, index) => {
              const completed = completedPoints[index]!;
              return (
                <g key={item.label}>
                  {index === focusIndex ? <circle cx={completed.x} cy={completed.y} fill="#ccf257" r="5" stroke="white" strokeWidth="3"><title>{`${t("tasksMetricCompleted")}: ${item.completed}`}</title></circle> : null}
                  <text
                    className="fill-[#8b8b84] font-mono text-[10px]"
                    textAnchor={
                      index === 0
                        ? "start"
                        : index === trend.length - 1
                          ? "end"
                          : "middle"
                    }
                    x={completed.x}
                    y={trendHeight - 8}
                  >
                    {item.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-5 font-mono text-[10px] text-muted-foreground">
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ccf257]" />{t("tasksMetricCompleted")} <strong className="ml-1 font-normal text-foreground">{completedTotal}</strong></span>
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#242521]" />{t("tasksCreated")} <strong className="ml-1 font-normal text-foreground">{createdTotal}</strong></span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{t("tasksLastSevenDays")}</span>
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-[8px] border border-border bg-card p-5">
          <h3 className="text-[16px] font-semibold">
            {t("tasksStatusMix")}
          </h3>
          <div className="mt-5 space-y-3">
            {statusCounts.map((item) => (
              <div
                className="block w-full text-left"
                key={item.id}
              >
                <div className="mb-1 flex justify-between text-[11px]">
                  <span>{t(item.labelKey)}</span>
                  <span className="font-mono text-muted-foreground">
                    {item.count}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${item.tone}`}
                    style={{
                      width: `${tasks.length ? (item.count / tasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-[8px] border border-border bg-card p-5">
          <h3 className="text-[16px] font-semibold">
            {t("tasksAgentWorkload")}
          </h3>
          <div className="mt-5 space-y-2">
            {agents.length ? (
              agents.map(({ agent, tasks: agentTasks }) => (
                <button
                  className="flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left hover:bg-muted"
                  key={agent}
                  onClick={() => onFilter({ agent })}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[11px]"
                    title={agent}
                  >
                    {agent}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {agentTasks.filter((task) => task.status === "done").length}
                    /{agentTasks.length}
                  </span>
                  <span className="h-1.5 w-20 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-[#8cab55]"
                      style={{
                        width: `${(agentTasks.filter((task) => task.status === "done").length / agentTasks.length) * 100}%`,
                      }}
                    />
                  </span>
                </button>
              ))
            ) : (
              <p className="py-8 text-center text-[12px] text-muted-foreground">
                {t("tasksNoAgentData")}
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="rounded-[8px] border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-semibold">
              {t("tasksNeedsAttention")}
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">{overdue}</span>
        </div>
        {overdue ? (
          <div className="mt-3 divide-y divide-border">
            {tasks
              .filter(
                (task) =>
                  task.status !== "done" &&
                  task.dueAt !== null &&
                  task.dueAt < Date.now(),
              )
              .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
              .map((task) => (
                <button
                  className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted"
                  key={task.id}
                  onClick={() => onOpenTask(task)}
                >
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {task.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {agentName(task)}
                  </span>
                </button>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-[12px] text-muted-foreground">
            {t("tasksNoOverdueTasks")}
          </p>
        )}
      </section>
    </div>
  );
}

function TaskEditor({
  t,
  initial,
  onClose,
  onSaved,
}: {
  t: (key: MessageKey) => string;
  initial: TaskRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const [input, setInput] = useState<TaskRecordInput>(emptyInput());
  const [detail, setDetail] = useState(emptyValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const composer = useRef<InlineSkillComposerHandle>(null);
  useEffect(() => {
    const next = initial
      ? {
          title: initial.title,
          detailParts: initial.detailParts,
          expectedResult: initial.expectedResult,
          status: initial.status,
          priority: initial.priority,
          dueAt: initial.dueAt,
          entryId: initial.entryId,
          expertSelection: initial.expertSelection,
          workspaceId: initial.workspaceId,
          sessionId: initial.sessionId,
          model: initial.model,
          thinkingLevel: initial.thinkingLevel,
          accessLevel: initial.accessLevel,
          toolApprovalMode: initial.toolApprovalMode,
          connectorIds: initial.connectorIds,
        }
      : emptyInput();
    setInput(next);
    setDetail({ ...emptyValue, parts: next.detailParts });
    setError(null);
    window.setTimeout(
      () => composer.current?.setValue(next.detailParts, { focus: false }),
      0,
    );
  }, [initial]);
  const selectedSession = snapshot?.sessions.find(
    (session) => session.id === input.sessionId,
  );
  const selectedModel = snapshot?.models.find(
    (model) =>
      model.connectionId === input.model?.connectionId &&
      model.modelId === input.model.modelId,
  );
  const selectedConnection = snapshot?.connections.find(
    (connection) => connection.id === input.model?.connectionId,
  );
  const availableSkills =
    snapshot?.skills.skills.filter(
      (skill) => skill.enabled && skill.state === "active",
    ) ?? [];
  const connectors =
    snapshot?.connectors.connectors.filter(
      (item) => item.enabled && item.status === "ready",
    ) ?? [];
  const update = <K extends keyof TaskRecordInput>(
    key: K,
    value: TaskRecordInput[K],
  ) => setInput((current) => ({ ...current, [key]: value }));
  const insertSkill = (skill: SkillSummary) => {
    composer.current?.insertSkill(skill);
    window.setTimeout(() => composer.current?.focus(), 0);
  };
  const selectSession = (id: string | null) => {
    const session = snapshot?.sessions.find((candidate) => candidate.id === id);
    setInput((current) =>
      session
        ? {
            ...current,
            sessionId: session.id,
            entryId: session.entryId,
            expertSelection: session.expertSelection,
            workspaceId: session.workspaceId,
            model: session.model,
            thinkingLevel: session.thinkingLevel,
            accessLevel: session.accessLevel,
            toolApprovalMode: session.toolApprovalMode,
          }
        : { ...current, sessionId: null },
    );
  };
  const save = async () => {
    if (!input.title.trim()) return setError(t("taskTitleRequired"));
    if (!detail.text.trim()) return setError(t("taskDetailsRequired"));
    setSaving(true);
    setError(null);
    try {
      const value = {
        ...input,
        title: input.title.trim(),
        detailParts: detail.parts,
        expectedResult: input.expectedResult?.trim() || undefined,
      };
      initial
        ? await client.updateTask(initial.id, value)
        : await client.createTask(value);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
      setConfirmRisk(false);
    }
  };
  const requestSave = () =>
    input.accessLevel === "full" || input.toolApprovalMode === "bypass"
      ? setConfirmRisk(true)
      : void save();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
      <header className="flex min-h-[62px] shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
            onClick={onClose}
            type="button"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("tasks")}
          </button>
          <span className="text-muted-foreground">/</span>
          <h1 className="truncate text-[14px] font-semibold">
            {initial ? t("taskEdit") : t("tasksNew")}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            className="h-8 whitespace-nowrap text-[11px]"
            onClick={onClose}
            variant="outline"
          >
            {t("taskCancel")}
          </Button>
          {initial ? (
            <Button
              className="h-8 whitespace-nowrap !border-[#ff4d55] !bg-[#ff4d55] text-[11px] !text-white hover:!bg-[#e83e46] focus-visible:ring-[#ff4d55]"
              onClick={async () => {
                await client.deleteTask(initial.id);
                onSaved();
              }}
              variant="outline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("taskDelete")}
            </Button>
          ) : null}
          <Button
            className="h-8 whitespace-nowrap text-[11px]"
            disabled={saving}
            onClick={requestSave}
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("taskSave")}
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-[900px] space-y-4">
          <Field label={t("taskTitle")} required>
            <input
              autoFocus
              className="h-9 w-full rounded-[7px] border border-border bg-card px-3 text-[12px] outline-none focus:border-[#9aaf61]"
              maxLength={120}
              onChange={(event) => update("title", event.target.value)}
              value={input.title}
            />
          </Field>
          <Field compound label={t("taskDetails")} required>
            <div className="rounded-[9px] border border-border bg-card focus-within:border-[#96968f]">
              <InlineSkillComposer
                ariaLabel={t("taskDetails")}
                className="min-h-[130px] w-full overflow-y-auto bg-transparent px-3.5 py-3 text-[16px] font-medium leading-7 outline-none"
                onChange={setDetail}
                onSubmit={requestSave}
                placeholder={t("taskDetailsPlaceholder")}
                placeholderClassName="left-3.5 top-3 text-[16px] leading-7"
                ref={composer}
                submitDisabled={saving}
              />
              <div className="flex min-h-11 flex-wrap items-center gap-1 border-t border-border px-2.5 py-1.5">
                <SkillInsertMenu
                  onSelect={insertSkill}
                  skills={availableSkills}
                />
                <ConnectorSwitchMenu
                  connectors={connectors}
                  onChange={(ids) => update("connectorIds", ids)}
                  selected={input.connectorIds}
                />
                <SingleSelectMenu
                  danger={input.toolApprovalMode === "bypass"}
                  icon={<ShieldAlert className="h-3.5 w-3.5" />}
                  items={[
                    {
                      id: "manual",
                      label: t("toolApprovalManual"),
                      description: t("toolApprovalManualHelp"),
                    },
                    {
                      id: "auto",
                      label: t("toolApprovalAuto"),
                      description: t("toolApprovalAutoHelp"),
                    },
                    {
                      id: "bypass",
                      label: t("toolApprovalBypass"),
                      description: t("toolApprovalBypassHelp"),
                    },
                  ]}
                  label={
                    input.toolApprovalMode === "manual"
                      ? t("toolApprovalManual")
                      : input.toolApprovalMode === "auto"
                        ? t("toolApprovalAuto")
                        : t("toolApprovalBypass")
                  }
                  onChange={(value) =>
                    update("toolApprovalMode", value as ToolApprovalMode)
                  }
                  value={input.toolApprovalMode}
                />
                <SingleSelectMenu
                  danger={input.accessLevel === "full"}
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  items={[
                    {
                      id: "default",
                      label: t("defaultAccess"),
                      description: t("defaultAccessHelp"),
                    },
                    {
                      id: "full",
                      label: t("fullAccess"),
                      description: t("fullAccessHelp"),
                    },
                  ]}
                  label={
                    input.accessLevel === "full"
                      ? t("fullAccess")
                      : t("defaultAccess")
                  }
                  onChange={(value) =>
                    update("accessLevel", value as SessionAccessLevel)
                  }
                  value={input.accessLevel}
                />
                <span className="ml-auto flex items-center gap-1">
                  <ThinkingLevelMenu
                    level={input.thinkingLevel}
                    model={selectedModel}
                    onChange={(level) => update("thinkingLevel", level)}
                  />
                  <ModelSelectMenu
                    connections={snapshot?.connections ?? []}
                    model={input.model}
                    models={
                      snapshot?.models.filter((model) => model.enabled) ?? []
                    }
                    onChange={(model) => update("model", model)}
                    providerAvatarId={selectedConnection?.avatarId}
                    providerId={selectedConnection?.providerId}
                    selectedLabel={
                      selectedModel?.displayName ?? t("defaultModel")
                    }
                  />
                </span>
              </div>
            </div>
          </Field>
          <Field label={t("taskExpectedResult")}>
            <textarea
              className="min-h-20 w-full resize-y rounded-[7px] border border-border bg-card px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9aaf61]"
              onChange={(event) => update("expectedResult", event.target.value)}
              value={input.expectedResult ?? ""}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("taskLinkedSession")}>
              <Select
                onValueChange={(value) => selectSession(value || null)}
                value={input.sessionId ?? undefined}
              >
                <SelectTrigger className="h-9 min-w-0 rounded-lg border-border bg-white px-3 text-left text-[12px] dark:bg-[#181912]">
                  <SelectValue placeholder={t("taskNewSession")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem
                    className="min-h-7 px-2.5 py-1.5 text-[11px]"
                    value="none"
                  >
                    {t("taskNewSession")}
                  </SelectItem>
                  {(() => {
                    const sessions =
                      snapshot?.sessions.filter(
                        (session) => session.workbenchId !== "media-canvas",
                      ) ?? [];
                    const unscoped = sessions.filter(
                      (session) => !session.workspaceId,
                    );
                    const scoped = sessions.filter(
                      (session) => session.workspaceId,
                    );
                    const option = (session: (typeof sessions)[number]) => {
                      const workspace = snapshot?.workspaces.find(
                        (item) => item.id === session.workspaceId,
                      );
                      const label =
                        session.title.length > 30
                          ? `${session.title.slice(0, 30)}…`
                          : session.title;
                      return (
                        <SelectItem
                          className="min-h-7 max-w-full truncate px-2.5 py-1.5 text-[11px]"
                          key={session.id}
                          title={session.title}
                          value={session.id}
                        >
                          {label}
                          {workspace ? ` · ${workspace.name}` : ""}
                        </SelectItem>
                      );
                    };
                    const workspaceGroups = (snapshot?.workspaces ?? [])
                      .map((workspace) => ({
                        workspace,
                        sessions: scoped.filter(
                          (session) => session.workspaceId === workspace.id,
                        ),
                      }))
                      .filter((group) => group.sessions.length > 0);
                    return (
                      <>
                        {unscoped.length ? (
                          <SelectGroup>
                            <SelectLabel className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                              {t("taskNoWorkspace")}
                            </SelectLabel>
                            {unscoped.map(option)}
                          </SelectGroup>
                        ) : null}
                        {workspaceGroups.map(
                          ({ workspace, sessions: groupSessions }) => (
                            <SelectGroup key={workspace.id}>
                              <SelectLabel className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                                {workspace.name}
                              </SelectLabel>
                              {groupSessions.map(option)}
                            </SelectGroup>
                          ),
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("taskAgentType")}>
              <Select
                disabled={Boolean(selectedSession)}
                onValueChange={(value) => {
                  const [kind, id] = value.split(":");
                  if (!value)
                    setInput((current) => ({
                      ...current,
                      entryId: null,
                      expertSelection: undefined,
                    }));
                  else if (kind === "entry")
                    setInput((current) => ({
                      ...current,
                      entryId: id,
                      expertSelection: undefined,
                    }));
                  else {
                    const expert = snapshot?.experts.find(
                      (candidate) => candidate.id === id,
                    );
                    if (expert)
                      setInput((current) => ({
                        ...current,
                        entryId: "general-work",
                        expertSelection: {
                          kind: expert.kind,
                          id: expert.id,
                          version: expert.version,
                        },
                      }));
                  }
                }}
                value={
                  input.expertSelection
                    ? `expert:${input.expertSelection.id}`
                    : input.entryId
                      ? `entry:${input.entryId}`
                      : ""
                }
              >
                <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]">
                  <SelectValue placeholder={t("taskAgent")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {snapshot?.entries
                    .filter(
                      (entry) =>
                        entry.availability === "available" &&
                        entry.workbenchId !== "media-canvas",
                    )
                    .map((entry) => (
                      <SelectItem
                        className="min-h-7 px-2.5 py-1.5 text-[11px]"
                        key={entry.id}
                        value={`entry:${entry.id}`}
                      >
                        {t(entry.labelKey as MessageKey)}
                      </SelectItem>
                    ))}
                  {snapshot?.experts.map((expert) => (
                    <SelectItem
                      className="min-h-7 px-2.5 py-1.5 text-[11px]"
                      key={expert.id}
                      value={`expert:${expert.id}`}
                    >
                      {expert.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("taskWorkspace")}>
              <Select
                disabled={Boolean(selectedSession)}
                onValueChange={(value) => update("workspaceId", value || null)}
                value={input.workspaceId ?? undefined}
              >
                <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]">
                  <SelectValue placeholder={t("taskNone")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {snapshot?.workspaces
                    .filter(
                      (workspace) => workspace.availability === "available",
                    )
                    .map((workspace) => (
                      <SelectItem
                        className="min-h-7 px-2.5 py-1.5 text-[11px]"
                        key={workspace.id}
                        value={workspace.id}
                      >
                        {workspace.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("taskDueDate")}>
              <input
                className="h-9 w-full min-w-0 rounded-lg border border-border bg-white px-3 text-left text-[12px] shadow-none outline-none focus:ring-1 focus:ring-[#9aaf61] dark:bg-[#181912]"
                onChange={(event) =>
                  update(
                    "dueAt",
                    event.target.value
                      ? new Date(`${event.target.value}T23:59:59.999`).getTime()
                      : null,
                  )
                }
                type="date"
                value={dateInput(input.dueAt)}
              />
            </Field>
            <Field label={t("taskPriority")}>
              <Select
                onValueChange={(value) =>
                  update(
                    "priority",
                    (value === "none" ? undefined : value) as
                      TaskRecordInput["priority"] | undefined,
                  )
                }
                value={input.priority ?? "none"}
              >
                <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    className="min-h-7 px-2.5 py-1.5 text-[11px]"
                    value="none"
                  >
                    {t("taskNoPriority")}
                  </SelectItem>
                  <SelectItem
                    className="min-h-7 px-2.5 py-1.5 text-[11px]"
                    value="low"
                  >
                    {t("taskLow")}
                  </SelectItem>
                  <SelectItem
                    className="min-h-7 px-2.5 py-1.5 text-[11px]"
                    value="medium"
                  >
                    {t("taskMedium")}
                  </SelectItem>
                  <SelectItem
                    className="min-h-7 px-2.5 py-1.5 text-[11px]"
                    value="high"
                  >
                    {t("taskHigh")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
        </div>
        {confirmRisk ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/35 p-5">
            <div className="w-full max-w-[390px] rounded-[9px] border border-border bg-card p-5 shadow-xl">
              <h3 className="text-[14px] font-semibold">
                {t("taskConfirmRisk")}
              </h3>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {t("taskRiskDescription")}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  onClick={() => setConfirmRisk(false)}
                  size="sm"
                  variant="outline"
                >
                  {t("taskBack")}
                </Button>
                <Button
                  className="!bg-[#ff4d55] !text-white hover:!bg-[#e83e46] focus-visible:ring-[#ff4d55]"
                  onClick={() => void save()}
                  size="sm"
                >
                  {t("taskConfirm")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  children,
  compound = false,
  label,
  required = false,
}: {
  children: ReactNode;
  compound?: boolean;
  label: string;
  required?: boolean;
}) {
  const content = (
    <>
      <span className="mb-1.5 block text-[11px] font-medium text-foreground">
        {label}
        {required ? (
          <span className="ml-1 text-[#b34b42]" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {children}
    </>
  );
  if (compound) return <div className="block">{content}</div>;
  return <label className="block">{content}</label>;
}
