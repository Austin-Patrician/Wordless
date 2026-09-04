import { Type, type Static } from "typebox";
import type {
  AgentExtension,
  AgentExtensionDefinition,
  AgentExtensionContext,
  AgentTool,
  JsonObject,
} from "@wordless/agent-extension-sdk";

export type PlanMode = "off" | "planning" | "executing";

export interface PlanItem {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "in-progress" | "completed" | "blocked" | "failed";
}

export interface PlanModeState extends JsonObject {
  mode: PlanMode;
  plan: PlanItem[];
  activeStepId?: string;
}

const PlanItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }),
  title: Type.String({ minLength: 1, maxLength: 240 }),
  detail: Type.String({ minLength: 1, maxLength: 2_000 }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("in-progress"),
    Type.Literal("completed"),
    Type.Literal("blocked"),
    Type.Literal("failed"),
  ]),
});
const UpdatePlanSchema = Type.Object({
  steps: Type.Array(PlanItemSchema, { minItems: 1, maxItems: 100 }),
  activeStepId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  explanation: Type.Optional(Type.String({ maxLength: 2_000 })),
});
type UpdatePlanInput = Static<typeof UpdatePlanSchema>;

type PlanUpdateSummary = {
  added: string[];
  removed: string[];
  started: string[];
  completed: string[];
  blocked: string[];
  failed: string[];
  activeStep?: string;
  activeStepChanged: boolean;
  completedCount: number;
  totalCount: number;
  changed: boolean;
};

function summarizePlanUpdate(
  current: PlanModeState,
  next: PlanModeState,
): PlanUpdateSummary {
  const before = new Map(current.plan.map((step) => [step.id, step]));
  const after = new Map(next.plan.map((step) => [step.id, step]));
  const summary: PlanUpdateSummary = {
    added: [],
    removed: [],
    started: [],
    completed: [],
    blocked: [],
    failed: [],
    activeStepChanged: current.activeStepId !== next.activeStepId,
    completedCount: next.plan.filter((step) => step.status === "completed").length,
    totalCount: next.plan.length,
    changed: false,
  };
  for (const step of next.plan) {
    const previous = before.get(step.id);
    if (!previous) {
      summary.added.push(step.title);
      continue;
    }
    if (previous.status !== step.status) {
      summary.changed = true;
      if (step.status === "in-progress") summary.started.push(step.title);
      if (step.status === "completed") summary.completed.push(step.title);
      if (step.status === "blocked") summary.blocked.push(step.title);
      if (step.status === "failed") summary.failed.push(step.title);
    }
    if (previous.title !== step.title || previous.detail !== step.detail)
      summary.changed = true;
  }
  for (const step of current.plan) {
    if (!after.has(step.id)) summary.removed.push(step.title);
  }
  if (
    current.plan.length !== next.plan.length ||
    current.plan.some((step, index) => step.id !== next.plan[index]?.id)
  )
    summary.changed = true;
  summary.changed ||= summary.added.length > 0 || summary.removed.length > 0 || summary.activeStepChanged;
  if (next.activeStepId) {
    const active = after.get(next.activeStepId);
    if (active) summary.activeStep = active.title;
  }
  return summary;
}

function formatPlanUpdate(summary: PlanUpdateSummary, explanation?: string): string {
  const changes: string[] = [];
  if (summary.added.length) changes.push(`added: ${summary.added.join(", ")}`);
  if (summary.removed.length) changes.push(`removed: ${summary.removed.join(", ")}`);
  if (summary.started.length) changes.push(`started: ${summary.started.join(", ")}`);
  if (summary.completed.length) changes.push(`completed: ${summary.completed.join(", ")}`);
  if (summary.blocked.length) changes.push(`blocked: ${summary.blocked.join(", ")}`);
  if (summary.failed.length) changes.push(`failed: ${summary.failed.join(", ")}`);
  if (summary.activeStepChanged && summary.activeStep)
    changes.push(`active step: ${summary.activeStep}`);
  const progress = `progress: ${summary.completedCount}/${summary.totalCount}`;
  if (!changes.length)
    return `Plan unchanged (${progress}); no material changes were recorded.`;
  return `Plan updated (${progress}): ${changes.join("; ")}.`;
}

export const planModeExtension: AgentExtensionDefinition = {
  descriptor: {
    id: "wordless.plan-mode",
    version: "1",
    name: "Plan mode",
    description:
      "Structure a coding task into an explicit plan before implementation.",
    category: "workflow",
    builtin: true,
    defaultEnabled: false,
    supportedDriverIds: ["coding"],
  },
  create(context: AgentExtensionContext): AgentExtension {
    let localState: PlanModeState | undefined;
    const getPlanState = (): PlanModeState => {
      if (localState) return localState;
      const mode = context.state.mode;
      const plan = context.state.plan;
      return {
        mode: mode === "planning" || mode === "executing" ? mode : "off",
        plan: Array.isArray(plan)
          ? plan.flatMap((item) => (isPlanItem(item) ? [item] : []))
          : [],
        ...(typeof context.state.activeStepId === "string"
          ? { activeStepId: context.state.activeStepId }
          : {}),
      };
    };

    const updatePlanTool: AgentTool<typeof UpdatePlanSchema> = {
      name: "update_plan",
      label: "Update plan",
      description:
        "Mutate the persisted structured plan only when its steps or statuses change materially.",
      promptSnippet:
        "Change the persisted plan only for a new plan, a real step transition, a blocker/failure, or material replanning.",
      promptGuidelines: [
        "This is a state-mutation tool, not a progress log, status query, work narration tool, or place to submit explanations.",
        "Planning mode: explore first. If a concrete multi-step plan is genuinely useful or explicitly requested, call once near the end with the final ordered steps, all pending. Do not call while inspecting, reasoning, or narrating investigation. Do not create plans for simple answers or one-step work.",
        "Execution mode: use the approved plan as the source of truth. Call once when beginning a step (pending to in-progress), then do and verify the work, and call once when it is complete (in-progress to completed). Only one step may be in-progress.",
        "Call only when the persisted steps, statuses, or scope materially change: start, complete, block, fail, or materially replan. If the submitted plan is identical, do not call this tool.",
        "Keep step IDs stable. Do not change a step's title or detail for ordinary implementation discoveries; replan only when the approved scope or approach materially changes.",
      ],
      parameters: UpdatePlanSchema,
      async execute(_toolCallId, input: UpdatePlanInput) {
        const current = getPlanState();
        if (current.mode === "off")
          throw new Error(
            "update_plan is only available while Plan Mode is active",
          );
        if (current.mode === "executing" && current.plan.length === 0)
          throw new Error(
            "A structured plan must be approved before it can be updated during execution",
          );
        const ids = new Set<string>();
        for (const step of input.steps) {
          if (ids.has(step.id))
            throw new Error(`Duplicate plan step id: ${step.id}`);
          ids.add(step.id);
        }
        if (input.activeStepId && !ids.has(input.activeStepId))
          throw new Error("activeStepId must reference a plan step");
        if (
          input.steps.filter((step) => step.status === "in-progress").length > 1
        )
          throw new Error("Only one plan step may be in progress");
        if (
          current.mode === "planning" &&
          input.steps.some((step) => step.status !== "pending")
        )
          throw new Error("Planning mode can only create pending steps");
        const inProgressStepId = input.steps.find(
          (step) => step.status === "in-progress",
        )?.id;
        const activeStepId = current.mode === "executing"
          ? inProgressStepId
          : input.activeStepId ?? inProgressStepId;
        const next: PlanModeState = {
          mode: current.mode,
          plan: input.steps,
          ...(activeStepId ? { activeStepId } : {}),
        };
        const summary = summarizePlanUpdate(current, next);
        if (summary.changed) {
          localState = next;
          await context.setState(next);
          context.emit("plan.updated", {
            ...next,
            explanation: input.explanation,
          });
        }
        return {
          content: [
            {
              type: "text",
              text: formatPlanUpdate(summary, input.explanation),
            },
          ],
          details: { plan: next, summary, explanation: input.explanation },
        };
      },
    };

    return {
      async activate() {
        await context.registerTools([updatePlanTool]);
        context.harness.on("before_agent_start", (event) => {
          const state = getPlanState();
          if (state.mode === "off") return undefined;
          const instruction =
            state.mode === "planning"
              ? "You are in Plan Mode. Explore the workspace and reason about the request without changing files. A structured plan is optional. Only after exploration is complete, and only when a concrete multi-step plan is genuinely useful or explicitly requested, call update_plan once with the final ordered plan; every step must be pending. Do not call update_plan while inspecting, reasoning, narrating investigation, reporting work, or repeating an unchanged plan. Do not change files until the user explicitly asks to execute the plan."
              : "You are executing the user's request. An approved structured plan is the source of truth. update_plan mutates persisted plan state; it is not a progress log or status query. Call it only for an actual transition (pending to in-progress, in-progress to completed, blocked, failed) or material replanning. For each step, mark it in-progress before doing work, perform and verify the work, then mark it completed. If no persisted plan state changes, do not call update_plan. If no structured plan exists, complete the request normally.";
          return { systemPrompt: `${event.systemPrompt}\n\n${instruction}` };
        });
        context.emit("capability.available", {
          mode: getPlanState().mode,
          plan: getPlanState().plan,
        });
      },
      async interact(action, payload) {
        const current = getPlanState();
        if (
          action === "set-mode" &&
          (payload === "off" ||
            payload === "planning" ||
            payload === "executing")
        ) {
          if (payload === "executing" && current.plan.length === 0)
            throw new Error(
              "A structured plan must exist before execution can begin",
            );
          const resetPlan = payload === "planning" && current.mode === "off";
          const next: PlanModeState = resetPlan
            ? { mode: payload, plan: [] }
            : { ...current, mode: payload };
          localState = next;
          await context.setState(next);
          context.emit("plan.updated", next);
          return;
        }
        if (action === "set-plan" && Array.isArray(payload)) {
          if (current.mode === "off")
            throw new Error("A plan can only be set while Plan Mode is active");
          const plan = payload.flatMap((item) =>
            isPlanItem(item) ? [item] : [],
          );
          if (!plan.length)
            throw new Error("Plan must contain at least one step");
          if (new Set(plan.map((step) => step.id)).size !== plan.length)
            throw new Error("Plan step ids must be unique");
          if (plan.filter((step) => step.status === "in-progress").length > 1)
            throw new Error("Only one plan step may be in progress");
          if (
            current.mode === "planning" &&
            plan.some((step) => step.status !== "pending")
          )
            throw new Error("Planning mode can only create pending steps");
          const next = { ...current, plan } satisfies PlanModeState;
          localState = next;
          await context.setState(next);
          context.emit("plan.updated", next);
          return;
        }
        throw new Error(`Unknown Plan Mode action: ${action}`);
      },
      dispose() {},
    };
  },
};

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.detail === "string" &&
    (item.status === "pending" ||
      item.status === "in-progress" ||
      item.status === "completed" ||
      item.status === "blocked" ||
      item.status === "failed")
  );
}
