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
   *
   * `model.input` 也在这里:宿主工具要不要把图片递给模型(截图)取决于模型能不能看图,
   * 而这是**会话级**判断 —— 同一个会话里换模型就该换行为。
   */
  extraTools?: (context: {
    record: { id: string; runtimeRootPath: string };
    resourceOwnerSessionId?: string;
    model: { input: string[] };
  }) => AgentTool[];
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
