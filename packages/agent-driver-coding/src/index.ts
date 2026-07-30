import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentExtensionHostFactory } from "@wordless/agent-extension-sdk";
import type { AgentDriver } from "@wordless/agent-driver-sdk";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";

export function createCodingAgentDriver(options: { createExtensionHost?: AgentExtensionHostFactory } = {}): AgentDriver {
  return createAgentHarnessDriver({
    id: "coding",
    features: ["steer", "follow-up", "thinking", "compact", "branch", "commands", "artifacts", "approval", "user-request"],
    createTools(context) {
      return createHeadlessCodingTools(context.env);
    },
    preflightOperation: preflightWorkspaceOperation,
    createExtensionHost: options.createExtensionHost,
  });
}
