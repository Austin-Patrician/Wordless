import { createHeadlessCodingTools } from "@wordless/coding-agent";
import type { AgentTool } from "@wordless/agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentExtensionHostFactory } from "@wordless/agent-extension-sdk";
import type { AgentDriver } from "@wordless/agent-driver-sdk";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";

export function createCodingAgentDriver(options: {
  createExtensionHost?: AgentExtensionHostFactory;
  /**
   * Host-supplied tools. Given the driver context so they can be built per
   * session, which the browser capability needs: its grants are per task.
   */
  extraTools?: (context: { record: { id: string }; resourceOwnerSessionId?: string }) => AgentTool[];
} = {}): AgentDriver {
  return createAgentHarnessDriver({
    id: "coding",
    features: ["steer", "follow-up", "thinking", "compact", "branch", "commands", "artifacts", "approval", "user-request"],
    createTools(context) {
      return [...createHeadlessCodingTools(context.env, context.workspaceSearch), ...(options.extraTools?.(context) ?? [])];
    },
    preflightOperation: preflightWorkspaceOperation,
    createExtensionHost: options.createExtensionHost,
  });
}
