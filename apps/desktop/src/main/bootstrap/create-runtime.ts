import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { AgentExtensionManager } from "@wordless/agent-extension-runtime";
import { contextCompactionExtension } from "@wordless/agent-extension-context-compaction";
import { planModeExtension } from "@wordless/agent-extension-plan-mode";
import {
  expertTeamExtension,
  subagentExtension,
} from "@wordless/agent-extension-subagent";
import { createCodingAgentDriver } from "@wordless/agent-driver-coding";
import { createPresentationAgentDriver } from "@wordless/agent-driver-presentation";
import { createSpreadsheetAgentDriver } from "@wordless/agent-driver-spreadsheet";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { createGenericAgentDriver } from "@wordless/agent-driver-generic";
import { createDataAnalysisTools, type DataAnalysisService } from "@wordless/capability-data";
import { createAgentDriverRegistry } from "@wordless/agent-driver-sdk";
import { codingProfile } from "@wordless/profile-coding";
import { generalProfile } from "@wordless/profile-general";
import { pptProfile } from "@wordless/profile-ppt";
import { excelProfile } from "@wordless/profile-excel";
import { dataProfile } from "@wordless/profile-data";
import { createProfileRegistry } from "@wordless/profile-sdk";
import { WordlessRuntime } from "@wordless/runtime";
import { WorkspaceSearchService } from "@wordless/platform-node";
import { ElectronCredentialVault } from "../adapters/electron-credential-vault";
import { OfficeCliService } from "../office/office-cli-service";
import { DesktopDataAnalysisService } from "../data-analysis/data-analysis-service";

export function createDesktopRuntime(userData: string, office: OfficeCliService, credentialVault = new ElectronCredentialVault(path.join(userData, "credentials.json")), dataAnalysis: DataAnalysisService = new DesktopDataAnalysisService({ metadataRoot: path.join(userData, "analysis-metadata"), resourcesRoot: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources") })): WordlessRuntime {
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  const extensions = new AgentExtensionManager({
    path: path.join(userData, "agent-extensions.json"),
    definitions: [
      planModeExtension,
      subagentExtension,
      expertTeamExtension,
      contextCompactionExtension,
    ],
  });
  const workspaceSearch = new WorkspaceSearchService({
    ...(app.isPackaged ? {
      fffModuleUrl: pathToFileURL(path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@ff-labs", "fff-node", "dist", "src", "index.js")).href,
    } : {}),
  });
  return new WordlessRuntime({
    paths: {
      dataRoot: userData,
      databasePath: path.join(userData, "wordless.db"),
      builtInSkillsRoot: path.join(resourcesRoot, "skills"),
      journalsRoot: path.join(userData, "sessions"),
      modelConfiguration: {
        extensionsRoot: path.join(userData, "provider-extensions"),
        modelsPath: path.join(userData, "models.json"),
        settingsPath: path.join(userData, "settings.json"),
      },
      sessionWorkspacesRoot: path.join(userData, "session-workspaces"),
    },
    credentialVault,
    defaultWorkspaceRoot: path.join(app.getPath("documents"), "Wordless"),
    profiles: createProfileRegistry([generalProfile, codingProfile, pptProfile, excelProfile, dataProfile]),
    extensions,
    workspaceSearch,
    drivers: createAgentDriverRegistry([
      createGenericAgentDriver({
        createExtensionHost: extensions,
        createTools: (context) => [
          ...createHeadlessCodingTools(context.env, context.workspaceSearch),
          ...(context.profile.reference.id === "data" ? createDataAnalysisTools(dataAnalysis, {
            sessionId: context.resourceOwnerSessionId ?? context.record.id,
            workspaceRoot: context.record.runtimeRootPath,
            webResearchAvailable: context.connectorTools.some((tool) => /(?:web|search)/i.test(`${tool.name} ${tool.label} ${tool.description}`)),
            subagentRunner: context.subagentRunner,
          }) : []),
        ],
        preflightOperation: preflightWorkspaceOperation,
      }),
      createCodingAgentDriver({ createExtensionHost: extensions }),
      createPresentationAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env, context.workspaceSearch),
        preflightWorkspaceOperation,
      }),
      createSpreadsheetAgentDriver(office, {
        createWorkspaceTools: (context) => createHeadlessCodingTools(context.env, context.workspaceSearch),
        preflightWorkspaceOperation,
      }),
    ]),
  });
}
