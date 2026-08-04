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
