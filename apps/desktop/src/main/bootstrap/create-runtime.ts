import path from "node:path";
import { app } from "electron";
import { AgentExtensionManager } from "@wordless/agent-extension-runtime";
import { contextCompactionExtension } from "@wordless/agent-extension-context-compaction";
import { planModeExtension } from "@wordless/agent-extension-plan-mode";
import { subagentExtension } from "@wordless/agent-extension-subagent";
import { createCodingAgentDriver } from "@wordless/agent-driver-coding";
import { createPresentationAgentDriver } from "@wordless/agent-driver-presentation";
import { createSpreadsheetAgentDriver } from "@wordless/agent-driver-spreadsheet";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { createGenericAgentDriver } from "@wordless/agent-driver-generic";
import { createAgentDriverRegistry } from "@wordless/agent-driver-sdk";
import { codingProfile } from "@wordless/profile-coding";
import { generalProfile } from "@wordless/profile-general";
import { pptProfile } from "@wordless/profile-ppt";
import { excelProfile } from "@wordless/profile-excel";
import { createProfileRegistry } from "@wordless/profile-sdk";
import { WordlessRuntime } from "@wordless/runtime";
import { ElectronCredentialVault } from "../adapters/electron-credential-vault";
import { OfficeCliService } from "../office/office-cli-service";

export function createDesktopRuntime(userData: string, office: OfficeCliService): WordlessRuntime {
  const extensions = new AgentExtensionManager({
    path: path.join(userData, "agent-extensions.json"),
    definitions: [planModeExtension, subagentExtension, contextCompactionExtension],
  });
  return new WordlessRuntime({
    paths: {
      dataRoot: userData,
      databasePath: path.join(userData, "wordless.db"),
      journalsRoot: path.join(userData, "sessions"),
      modelConfiguration: {
        extensionsRoot: path.join(userData, "provider-extensions"),
        modelsPath: path.join(userData, "models.json"),
        settingsPath: path.join(userData, "settings.json"),
      },
      sessionWorkspacesRoot: path.join(userData, "session-workspaces"),
    },
    credentialVault: new ElectronCredentialVault(path.join(userData, "credentials.json")),
    defaultWorkspaceRoot: path.join(app.getPath("documents"), "Wordless"),
    profiles: createProfileRegistry([generalProfile, codingProfile, pptProfile, excelProfile]),
    extensions,
    drivers: createAgentDriverRegistry([
      createGenericAgentDriver({
        createTools: (context) => createHeadlessCodingTools(context.env),
        preflightOperation: preflightWorkspaceOperation,
      }),
      createCodingAgentDriver({ createExtensionHost: extensions }),
      createPresentationAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env),
        preflightWorkspaceOperation,
      }),
      createSpreadsheetAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env),
        preflightWorkspaceOperation,
      }),
    ]),
  });
}
