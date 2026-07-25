import type { AgentExtension, AgentExtensionDefinition, AgentExtensionContext, JsonObject } from "@wordless/agent-extension-sdk";

export type PlanMode = "off" | "planning" | "executing";

export interface PlanItem {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "in-progress" | "completed";
}

export interface PlanModeState extends JsonObject {
  mode: PlanMode;
  plan: PlanItem[];
}

export const planModeExtension: AgentExtensionDefinition = {
  descriptor: {
    id: "wordless.plan-mode",
    version: "1",
    name: "Plan mode",
    description: "Structure a coding task into an explicit plan before implementation.",
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
        plan: Array.isArray(plan) ? plan.flatMap((item) => isPlanItem(item) ? [item] : []) : [],
      };
    };

    return {
      activate() {
        context.harness.on("before_agent_start", (event) => {
          const state = getPlanState();
          if (state.mode === "off") return undefined;
          const instruction = state.mode === "planning"
            ? "You are in Plan Mode. Inspect the workspace and produce or refine a concise ordered implementation plan. Do not change files until the user explicitly asks to execute the plan."
            : "You are executing an approved plan. Keep changes aligned with the plan, update progress clearly, and verify the result.";
          return { systemPrompt: `${event.systemPrompt}\n\n${instruction}` };
        });
        context.emit("capability.available", { mode: getPlanState().mode, plan: getPlanState().plan });
      },
      async interact(action, payload) {
        const current = getPlanState();
        if (action === "set-mode" && (payload === "off" || payload === "planning" || payload === "executing")) {
          const next = { ...current, mode: payload } satisfies PlanModeState;
          localState = next;
          await context.setState(next);
          context.emit("plan.updated", next);
          return;
        }
        if (action === "set-plan" && Array.isArray(payload)) {
          const plan = payload.flatMap((item) => isPlanItem(item) ? [item] : []);
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.detail === "string" && (item.status === "pending" || item.status === "in-progress" || item.status === "completed");
}
