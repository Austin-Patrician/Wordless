import { randomUUID } from "node:crypto";
import { powerMonitor } from "electron";
import type {
  AutomationConfiguration,
  AutomationRun,
  AutomationTask,
  AutomationTaskInput,
  SessionDraft,
} from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import { WordlessDatabase } from "@wordless/persistence";
import type { WordlessRuntime } from "@wordless/runtime";
import {
  latestMissedAutomationRun,
  nextAutomationRun,
  validateAutomationClock,
} from "./automation-schedule";

const MAX_CONCURRENT_RUNS = 3;
const MAX_TIMER_DELAY = 2_147_000_000;
const AUTOMATION_SESSION_TITLE_PREFIX = "自动化 - ";

function automationSessionTitle(name: string): string {
  return `${AUTOMATION_SESSION_TITLE_PREFIX}${name}`.slice(0, 120);
}

type AutomationServiceOptions = {
  databasePath: string;
  runtime: WordlessRuntime;
  deleteSession: (sessionId: string) => Promise<void>;
  emit: (event: {
    type: "automation.changed" | "automation-run.changed";
    id?: string;
  }) => void;
};

export class AutomationService {
  private readonly options: AutomationServiceOptions;
  private readonly database: WordlessDatabase;
  private readonly queue: AutomationRun[] = [];
  private readonly active = new Map<string, string>();
  private readonly starting = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(options: AutomationServiceOptions) {
    this.options = options;
    this.database = new WordlessDatabase(options.databasePath);
    this.database.updateUnfinishedAutomationRuns("interrupted");
    this.unsubscribe = options.runtime.subscribe((event) =>
      this.handleRuntimeEvent(event),
    );
  }

  initialize(): void {
    void this.restoreSchedules();
    powerMonitor.on("resume", this.handleResume);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    powerMonitor.off("resume", this.handleResume);
    this.unsubscribe();
    this.database.close();
  }

  listTasks(): AutomationTask[] {
    return this.database.listAutomations();
  }
  listRuns(limit?: number): AutomationRun[] {
    return this.database.listAutomationRuns(limit);
  }

  createTask(input: AutomationTaskInput): AutomationTask {
    this.validateInput(input);
    const now = Date.now();
    const task: AutomationTask = {
      ...input,
      id: randomUUID(),
      nextRunAt: input.enabled
        ? nextAutomationRun(
            input.schedule,
            now,
            input.activeFrom,
            input.activeUntil,
          )
        : null,
      createdAt: now,
      updatedAt: now,
    };
    this.database.upsertAutomation(task);
    this.changed(task.id);
    this.scheduleTimer();
    return task;
  }

  updateTask(id: string, input: AutomationTaskInput): AutomationTask {
    this.validateInput(input);
    const current = this.requireTask(id);
    const now = Date.now();
    const task: AutomationTask = {
      ...input,
      id,
      createdAt: current.createdAt,
      updatedAt: now,
      nextRunAt: input.enabled
        ? nextAutomationRun(
            input.schedule,
            now,
            input.activeFrom,
            input.activeUntil,
          )
        : null,
    };
    this.database.upsertAutomation(task);
    this.changed(id);
    this.scheduleTimer();
    return task;
  }

  setEnabled(ids: string[], enabled: boolean): void {
    for (const id of ids) {
      const task = this.requireTask(id);
      const now = Date.now();
      this.database.upsertAutomation({
        ...task,
        enabled,
        nextRunAt: enabled
          ? nextAutomationRun(
              task.schedule,
              now,
              task.activeFrom,
              task.activeUntil,
            )
          : null,
        updatedAt: now,
      });
    }
    this.changed();
    this.scheduleTimer();
  }

  deleteTasks(ids: string[]): void {
    for (const id of ids) this.database.deleteAutomation(id);
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const run = this.queue[index];
      if (run?.automationId && ids.includes(run.automationId)) {
        this.database.updateAutomationRun({
          ...run,
          status: "cancelled",
          error: "Automation deleted before this run started",
          completedAt: Date.now(),
        });
        this.queue.splice(index, 1);
      }
    }
    this.changed();
    this.scheduleTimer();
  }

  runNow(id: string): AutomationRun {
    const task = this.requireTask(id);
    const run = this.enqueue(task, Date.now(), true);
    void this.drain();
    return run;
  }

  async deleteRun(id: string): Promise<void> {
    const run = this.database.getAutomationRun(id);
    if (!run) return;
    if (run.status === "running" || run.status === "waiting")
      throw new Error("A running automation cannot be deleted");
    if (run.sessionId) await this.options.deleteSession(run.sessionId);
    else this.database.deleteAutomationRun(id);
    this.runChanged(id);
  }

  onSessionDeleted(sessionId: string): void {
    this.database.deleteAutomationRunsForSession(sessionId);
    this.runChanged();
  }

  private readonly handleResume = () => {
    const nextZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (nextZone !== this.zone) this.zone = nextZone;
    void this.restoreSchedules();
  };

  private async restoreSchedules(): Promise<void> {
    const now = Date.now();
    for (const task of this.database.listAutomations()) {
      if (!task.enabled || task.nextRunAt === null) continue;
      const missedAt = latestMissedAutomationRun(
        task.schedule,
        task.nextRunAt,
        now,
        task.activeFrom,
        task.activeUntil,
      );
      if (missedAt !== null) this.enqueue(task, missedAt, false);
      const nextRunAt =
        task.schedule.kind === "once"
          ? null
          : nextAutomationRun(
              task.schedule,
              now,
              task.activeFrom,
              task.activeUntil,
            );
      if (nextRunAt !== task.nextRunAt || missedAt !== null)
        this.database.upsertAutomation({
          ...task,
          enabled: task.schedule.kind === "once" ? false : task.enabled,
          nextRunAt,
          updatedAt: now,
        });
    }
    this.changed();
    this.scheduleTimer();
    await this.drain();
  }

  private validateInput(input: AutomationTaskInput): void {
    if (!input.name.trim() || input.name.length > 120)
      throw new Error(
        "Automation name is required and must be at most 120 characters",
      );
    if (!input.prompt.trim()) throw new Error("Prompt is required");
    if (input.schedule.kind === "recurring")
      validateAutomationClock(input.schedule.time);
    if (
      input.schedule.kind === "interval" &&
      (!Number.isInteger(input.schedule.every) || input.schedule.every < 1)
    )
      throw new Error("Interval must be a positive integer");
    if (
      input.activeFrom !== null &&
      input.activeUntil !== null &&
      input.activeFrom > input.activeUntil
    )
      throw new Error("Active date range is invalid");
  }

  private requireTask(id: string): AutomationTask {
    const task = this.database.getAutomation(id);
    if (!task) throw new Error("Automation not found");
    return task;
  }

  private recalculate(task: AutomationTask, after: number): void {
    if (!task.enabled) return;
    const nextRunAt = nextAutomationRun(
      task.schedule,
      after,
      task.activeFrom,
      task.activeUntil,
    );
    if (nextRunAt !== task.nextRunAt)
      this.database.upsertAutomation({
        ...task,
        nextRunAt,
        updatedAt: Date.now(),
      });
  }

  private scheduleTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed) return;
    const next = this.database
      .listAutomations()
      .filter((task) => task.enabled && task.nextRunAt !== null)
      .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0]?.nextRunAt;
    const delay =
      next == null
        ? 60_000
        : Math.max(0, Math.min(60_000, MAX_TIMER_DELAY, next - Date.now()));
    this.timer = setTimeout(() => void this.collectDue(), delay);
  }

  private async collectDue(): Promise<void> {
    const now = Date.now();
    const nextZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (nextZone !== this.zone) {
      this.zone = nextZone;
      for (const task of this.database.listAutomations())
        this.recalculate(task, now);
    }
    for (const task of this.database
      .listAutomations()
      .filter(
        (candidate) =>
          candidate.enabled &&
          candidate.nextRunAt !== null &&
          candidate.nextRunAt <= now,
      )) {
      const scheduledFor = task.nextRunAt!;
      this.enqueue(task, scheduledFor, false);
      const nextRunAt =
        task.schedule.kind === "once"
          ? null
          : nextAutomationRun(
              task.schedule,
              scheduledFor,
              task.activeFrom,
              task.activeUntil,
            );
      this.database.upsertAutomation({
        ...task,
        enabled: task.schedule.kind === "once" ? false : task.enabled,
        nextRunAt,
        updatedAt: now,
      });
    }
    this.changed();
    this.scheduleTimer();
    await this.drain();
  }

  private enqueue(
    task: AutomationTask,
    scheduledFor: number,
    manual: boolean,
  ): AutomationRun {
    const configuration: AutomationConfiguration = {
      prompt: task.prompt,
      entryId: task.entryId,
      workspaceId: task.workspaceId,
      accessLevel: task.accessLevel,
      model: task.model,
      thinkingLevel: task.thinkingLevel,
      skillIds: [...task.skillIds],
      connectorIds: [...task.connectorIds],
    };
    const run: AutomationRun = {
      id: randomUUID(),
      automationId: task.id,
      automationName: task.name,
      configuration,
      scheduledFor,
      sessionId: null,
      status: "queued",
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };
    if (!this.database.insertAutomationRun(run)) {
      const existing = this.database
        .listAutomationRuns(1000)
        .find(
          (candidate) =>
            candidate.automationId === task.id &&
            candidate.scheduledFor === scheduledFor,
        );
      if (existing) return existing;
    }
    this.queue.push(run);
    this.runChanged(run.id);
    if (manual) this.scheduleTimer();
    return run;
  }

  private async drain(): Promise<void> {
    while (
      this.active.size + this.starting.size < MAX_CONCURRENT_RUNS &&
      this.queue.length > 0
    ) {
      const run = this.queue.shift()!;
      this.starting.add(run.id);
      void this.startRun(run);
    }
  }

  private invalidConfiguration(
    configuration: AutomationConfiguration,
  ): string | null {
    const snapshot = this.options.runtime.getSnapshot();
    if (
      !snapshot.entries.some(
        (entry) =>
          entry.id === configuration.entryId &&
          entry.availability === "available",
      )
    )
      return "Selected agent is unavailable";
    if (
      configuration.workspaceId &&
      !snapshot.workspaces.some(
        (workspace) =>
          workspace.id === configuration.workspaceId &&
          workspace.availability === "available",
      )
    )
      return "Selected workspace is unavailable";
    if (
      configuration.model &&
      !snapshot.modelConfiguration.models.some(
        (model) =>
          model.providerId === configuration.model!.connectionId &&
          model.modelId === configuration.model!.modelId &&
          model.enabled,
      )
    )
      return "Selected model is unavailable";
    if (
      configuration.skillIds.some(
        (id) =>
          !snapshot.skills.skills.some(
            (skill) =>
              skill.id === id && skill.enabled && skill.state === "active",
          ),
      )
    )
      return "One or more selected skills are unavailable";
    if (
      configuration.connectorIds.some(
        (id) =>
          !snapshot.connectors.connectors.some(
            (connector) =>
              connector.id === id &&
              connector.enabled &&
              connector.status === "ready",
          ),
      )
    )
      return "One or more selected connectors are unavailable";
    return null;
  }

  private async startRun(run: AutomationRun): Promise<void> {
    const invalid = this.invalidConfiguration(run.configuration);
    if (invalid) {
      this.starting.delete(run.id);
      this.database.updateAutomationRun({
        ...run,
        status: "configuration-error",
        error: invalid,
        completedAt: Date.now(),
      });
      this.runChanged(run.id);
      void this.drain();
      return;
    }
    try {
      const entry = this.options.runtime
        .getSnapshot()
        .entries.find(
          (candidate) => candidate.id === run.configuration.entryId,
        )!;
      const draft: SessionDraft = {
        mode: entry.mode,
        entryId: entry.id,
        title: automationSessionTitle(run.automationName),
        workspaceId: run.configuration.workspaceId,
        accessLevel: run.configuration.accessLevel,
        model: run.configuration.model,
        thinkingLevel: run.configuration.thinkingLevel,
        connectorIds: run.configuration.connectorIds,
        interactionMode: "default",
        toolApprovalMode: "bypass",
      };
      const session = await this.options.runtime.createAndPrompt(
        draft,
        run.configuration.prompt,
        run.configuration.skillIds,
        { messageId: randomUUID(), submittedAt: Date.now() },
      );
      const snapshot = await this.options.runtime.getSessionSnapshot(
        session.id,
      );
      const waiting = snapshot.messages.some((message) =>
        message.blocks.some(
          (block) =>
            block.type === "tool" &&
            (block.state === "awaiting-approval" ||
              block.state === "awaiting-user-input"),
        ),
      );
      const next = {
        ...run,
        sessionId: session.id,
        status: (waiting ? "waiting" : "running") as "waiting" | "running",
        startedAt: Date.now(),
      };
      this.starting.delete(run.id);
      this.active.set(session.id, run.id);
      this.database.updateAutomationRun(next);
      this.runChanged(run.id);
      if (!snapshot.isRunning) {
        this.database.updateAutomationRun({
          ...next,
          status: "completed",
          completedAt: Date.now(),
        });
        this.active.delete(session.id);
        this.runChanged(run.id);
        void this.drain();
      }
    } catch (cause) {
      this.starting.delete(run.id);
      this.database.updateAutomationRun({
        ...run,
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
        completedAt: Date.now(),
      });
      this.runChanged(run.id);
      void this.drain();
    }
  }

  private handleRuntimeEvent(envelope: RuntimeEventEnvelope): void {
    if (!envelope.sessionId) return;
    const runId = this.active.get(envelope.sessionId);
    if (!runId) return;
    const run = this.database.getAutomationRun(runId);
    if (!run) return;
    if (
      envelope.event.type === "approval.requested" ||
      envelope.event.type === "user-request.requested"
    )
      this.database.updateAutomationRun({ ...run, status: "waiting" });
    else if (
      envelope.event.type === "approval.resolved" ||
      envelope.event.type === "user-request.resolved" ||
      envelope.event.type === "run.started"
    )
      this.database.updateAutomationRun({ ...run, status: "running" });
    else if (
      envelope.event.type === "run.completed" ||
      envelope.event.type === "run.failed" ||
      envelope.event.type === "run.cancelled"
    ) {
      const status =
        envelope.event.type === "run.completed"
          ? "completed"
          : envelope.event.type === "run.failed"
            ? "failed"
            : "cancelled";
      this.database.updateAutomationRun({
        ...run,
        status,
        error:
          envelope.event.type === "run.failed"
            ? envelope.event.message
            : run.error,
        completedAt: Date.now(),
      });
      this.active.delete(envelope.sessionId);
      void this.drain();
    }
    this.runChanged(run.id);
  }

  private changed(id?: string): void {
    this.options.emit({ type: "automation.changed", id });
  }
  private runChanged(id?: string): void {
    this.options.emit({ type: "automation-run.changed", id });
  }
}
