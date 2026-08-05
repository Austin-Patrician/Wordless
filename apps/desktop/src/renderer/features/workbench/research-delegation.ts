import type { ResearchDelegationDetails, ResearchDelegationEvent, ResearchDelegationTask, ResearchDelegationTaskStatus } from "@wordless/domain";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function taskStatus(value: unknown): ResearchDelegationTaskStatus | undefined {
  return value === "queued" || value === "running" || value === "awaiting-approval" || value === "awaiting-user-input" || value === "completed" || value === "failed" || value === "cancelled" ? value : undefined;
}

function delegationEvent(value: unknown): ResearchDelegationEvent | undefined {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.label !== "string" || typeof item.timestamp !== "number") return undefined;
  return {
    id: item.id,
    kind: item.kind === "status" ? "status" : "tool",
    label: item.label,
    timestamp: item.timestamp,
    ...(item.state === "running" || item.state === "complete" || item.state === "error" ? { state: item.state } : {}),
    ...(typeof item.toolCallId === "string" ? { toolCallId: item.toolCallId } : {}),
    ...(typeof item.toolName === "string" ? { toolName: item.toolName } : {}),
    ...(typeof item.inputSummary === "string" ? { inputSummary: item.inputSummary } : {}),
    ...(typeof item.outputPreview === "string" ? { outputPreview: item.outputPreview } : {}),
  };
}

function delegationTask(value: unknown, index: number): ResearchDelegationTask | undefined {
  const item = record(value);
  const status = taskStatus(item?.status);
  if (!item || typeof item.taskId !== "string" || !status) return undefined;
  const dimensionId = typeof item.dimensionId === "string" ? item.dimensionId : `task-${index + 1}`;
  const activeTool = record(item.activeTool);
  return {
    taskId: item.taskId,
    dimensionId,
    dimensionName: typeof item.dimensionName === "string" ? item.dimensionName : `Research ${String(index + 1).padStart(2, "0")}`,
    question: typeof item.question === "string" ? item.question : "",
    agent: item.agent === "research-reviewer" ? "research-reviewer" : "researcher",
    status,
    events: Array.isArray(item.events) ? item.events.flatMap((event) => delegationEvent(event) ?? []) : [],
    ...(typeof item.startedAt === "number" ? { startedAt: item.startedAt } : {}),
    ...(typeof item.completedAt === "number" ? { completedAt: item.completedAt } : {}),
    ...(activeTool && typeof activeTool.name === "string" && (activeTool.state === "running" || activeTool.state === "complete" || activeTool.state === "error") ? { activeTool: {
      name: activeTool.name,
      state: activeTool.state,
      ...(typeof activeTool.callId === "string" ? { callId: activeTool.callId } : {}),
      ...(typeof activeTool.inputSummary === "string" ? { inputSummary: activeTool.inputSummary } : {}),
      ...(typeof activeTool.outputPreview === "string" ? { outputPreview: activeTool.outputPreview } : {}),
    } } : {}),
    ...(typeof item.output === "string" ? { output: item.output } : typeof item.text === "string" ? { output: item.text } : {}),
    ...(typeof item.error === "string" ? { error: item.error } : {}),
    ...(record(item.usage) ? { usage: item.usage as ResearchDelegationTask["usage"] } : {}),
    ...(item.approval !== undefined ? { approval: item.approval } : {}),
    ...(item.userRequest !== undefined ? { userRequest: item.userRequest } : {}),
  };
}

export function researchDelegationDetails(value: unknown): ResearchDelegationDetails | undefined {
  const details = record(value);
  if (!details || typeof details.analysisId !== "string") return undefined;
  const taskValues = Array.isArray(details.tasks) ? details.tasks : Array.isArray(details.results) ? details.results : [];
  const tasks = taskValues.flatMap((task, index) => delegationTask(task, index) ?? []);
  if (tasks.length === 0) return undefined;
  const startedAt = typeof details.startedAt === "number" ? details.startedAt : Math.min(...tasks.map((task) => task.startedAt ?? Date.now()));
  return {
    version: 1,
    analysisId: details.analysisId,
    mode: details.mode === "sequential" ? "sequential" : "parallel",
    startedAt,
    updatedAt: typeof details.updatedAt === "number" ? details.updatedAt : startedAt,
    tasks,
  };
}

export function researchEvidenceCount(task: ResearchDelegationTask): number {
  return task.events.filter((event) => event.toolName === "research_snapshot" && event.state === "complete").length;
}

export function researchClaimsSubmitted(task: ResearchDelegationTask): boolean {
  return task.events.some((event) => event.toolName === "research_submit_dimension" && event.state === "complete");
}

export function researchDelegationPhase(details: ResearchDelegationDetails, chinese: boolean): string {
  const active = details.tasks.some((task) => task.status === "running" || task.status === "queued");
  const awaiting = details.tasks.some((task) => task.status === "awaiting-approval" || task.status === "awaiting-user-input");
  const failed = details.tasks.some((task) => task.status === "failed");
  const terminal = details.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
  const hasReview = details.tasks.some((task) => task.agent === "research-reviewer");
  if (awaiting) return chinese ? "需要处理" : "Action required";
  if (active) return hasReview ? chinese ? "正在审查证据" : "Reviewing evidence" : chinese ? "正在研究" : "Researching";
  if (failed) return chinese ? "研究失败" : "Research failed";
  if (terminal && hasReview) return chinese ? "等待验证" : "Validation pending";
  if (terminal) return chinese ? "证据已收集" : "Evidence collected";
  return chinese ? "等待调度" : "Queued";
}

export type ResearchDelegationGroup = {
  block: import("@wordless/domain").MessageToolBlock;
  details: ResearchDelegationDetails;
  taskCallIds: Record<string, string>;
};

export function groupResearchDelegationBlocks(blocks: readonly import("@wordless/domain").MessageToolBlock[]): ResearchDelegationGroup[] {
  const groups = new Map<string, ResearchDelegationGroup>();
  for (const block of blocks) {
    const details = researchDelegationDetails(block.details);
    if (!details) continue;
    const existing = groups.get(details.analysisId);
    if (!existing) {
      groups.set(details.analysisId, { block, details: { ...details, tasks: [...details.tasks] }, taskCallIds: Object.fromEntries(details.tasks.map((task) => [task.taskId, block.callId])) });
      continue;
    }
    const taskByKey = new Map(existing.details.tasks.map((task) => [`${task.dimensionId}:${task.agent}`, task]));
    for (const task of details.tasks) {
      const key = `${task.dimensionId}:${task.agent}`;
      taskByKey.set(key, task);
      existing.taskCallIds[task.taskId] = block.callId;
    }
    existing.details = { ...details, startedAt: Math.min(existing.details.startedAt, details.startedAt), updatedAt: Math.max(existing.details.updatedAt, details.updatedAt), tasks: [...taskByKey.values()] };
  }
  return [...groups.values()];
}
