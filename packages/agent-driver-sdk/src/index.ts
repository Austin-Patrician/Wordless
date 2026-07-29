import type { AgentTool, ExecutionEnv, Session, SessionMetadata, ThinkingLevel } from "@wordless/agent";
import type { Api, Model, Models } from "@wordless/ai";
import type {
  AgentExtensionEvent,
  AgentExtensionInteraction,
  SubagentRunner,
} from "@wordless/agent-extension-sdk";
import type {
  AgentDriverId,
  ConversationMessage,
  ConversationUsage,
  ContextCompactionRecord,
  ContextCompactionTrigger,
  MessageAttachmentBlock,
  MessageBlock,
  ModelCapabilities,
  ModelReference,
  ModelRequirements,
  ProfileReference,
  SecurityPolicySnapshot,
  SessionRecord,
  SkillSource,
  UserPromptPart,
  UserMessageSubmission,
  ToolOperationApproval,
  ToolApprovalMode,
  UserRequest,
  UserRequestResolution,
  WorkbenchId,
} from "@wordless/domain";

export type AgentDriverFeature =
  | "steer"
  | "follow-up"
  | "thinking"
  | "compact"
  | "branch"
  | "commands"
  | "artifacts"
  | "approval"
  | "user-request"
  | "extensions";

export interface AgentTextAttachment {
  path: string;
  name: string;
  mediaType: string;
  content?: string;
}

export interface OperationApprovalRequest {
  approvalId: string;
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
  risk: ToolOperationApproval["risk"];
  severity: ToolOperationApproval["severity"];
  summary: string;
  preview: ToolOperationApproval["preview"];
  matchedRules: ToolOperationApproval["matchedRules"];
}

export interface SessionFileBaseline {
  path: string;
  existed: boolean;
  content: string | null;
}

export interface OperationApprovalDefinition extends Pick<OperationApprovalRequest, "risk" | "severity" | "summary" | "preview" | "matchedRules"> {
  sessionFileBaseline?: SessionFileBaseline;
}

export type OperationPreflightDecision =
  | { type: "allow"; sessionFileBaseline?: SessionFileBaseline }
  | { type: "block"; reason: string }
  | { type: "approval"; approval: OperationApprovalDefinition };

export interface ConnectorToolPolicy {
  agentToolName: string;
  connectorId: string;
  connectorName: string;
  toolName: string;
  readOnly: boolean;
  destructive: boolean | null;
}

export interface OperationApprovalResolution {
  approvalId: string;
  approved: boolean;
  feedback?: string;
}

export const OPERATION_APPROVAL_JOURNAL_TYPE = "wordless.operation-approval";
export const SESSION_FILE_BASELINE_JOURNAL_TYPE = "wordless.session-file-baseline";
export const USER_REQUEST_JOURNAL_TYPE = "wordless.user-request";
export const CONTEXT_COMPACTION_JOURNAL_TYPE = "wordless.context-compaction";

export interface PersistedOperationApproval {
  callId: string;
  approval: OperationApprovalRequest;
  resolution?: OperationApprovalResolution;
}

export interface PersistedSessionFileBaseline {
  callId: string;
  baseline: SessionFileBaseline;
}

export interface PersistedUserRequest {
  callId: string;
  request: UserRequest;
  resolution?: UserRequestResolution;
}

export interface PersistedContextCompaction {
  compactionId: string;
  trigger: ContextCompactionTrigger;
  tokensAfter: number;
  model: ModelReference;
  recoveredFailureEntryId?: string;
}

const WORKSPACE_ATTACHMENT_START = "\n<wordless-workspace-attachments>\n";
const WORKSPACE_ATTACHMENT_END = "\n</wordless-workspace-attachments>";
const SKILL_REFERENCE_START = "<wordless-skill-reference>";
const SKILL_REFERENCE_END = "</wordless-skill-reference>";
const WORKSPACE_REFERENCE_START = "<wordless-workspace-reference>";
const WORKSPACE_REFERENCE_END = "</wordless-workspace-reference>";
const ARTIFACT_REFERENCE_START = "<wordless-artifact-reference>";
const ARTIFACT_REFERENCE_END = "</wordless-artifact-reference>";

type SerializedSkillReference = {
  version: 1;
  id: string;
  skillId: string;
  name: string;
  source: SkillSource;
};

type SerializedWorkspaceReference = {
  version: 1;
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
};

type SerializedArtifactReference = {
  version: 1;
  id: string;
  artifactId: string;
  kind: "presentation" | "document" | "spreadsheet" | "browser";
  name: string;
  revision: number;
  surfaceId: string;
  locator: string;
  locators?: string[];
  intent?: "reference" | "analyze" | "formula" | "chart" | "pivot";
};

type SerializedPromptContext = {
  version: 1;
  attachments: AgentTextAttachment[];
} | {
  version: 2;
  attachments: AgentTextAttachment[];
  skills: Array<Pick<AgentRuntimeSkill, "id" | "name" | "source" | "baseDir" | "content">>;
};

export function formatPromptWithAttachments(
  text: string,
  attachments: readonly AgentTextAttachment[],
): string {
  if (attachments.length === 0) return text;
  const serialized: SerializedPromptContext = { version: 1, attachments: [...attachments] };
  return `${text}${WORKSPACE_ATTACHMENT_START}${JSON.stringify(serialized)}${WORKSPACE_ATTACHMENT_END}`;
}

export function formatPromptWithSkillReferences(parts: readonly UserPromptPart[]): string {
  return parts.map((part, index) => {
    if (part.type === "text") return part.text;
    if (part.type === "workspace-reference") {
      const reference: SerializedWorkspaceReference = { version: 1, id: `${part.path}:${index}`, path: part.path, name: part.name, kind: part.kind };
      return `${WORKSPACE_REFERENCE_START}${encodeURIComponent(JSON.stringify(reference))}${WORKSPACE_REFERENCE_END}`;
    }
    if (part.type === "artifact-reference") {
      const reference: SerializedArtifactReference = { version: 1, id: `${part.artifactId}:${part.surfaceId}:${index}`, artifactId: part.artifactId, kind: part.kind, name: part.name, revision: part.revision, surfaceId: part.surfaceId, locator: part.locator, ...(part.locators ? { locators: part.locators } : {}), ...(part.intent ? { intent: part.intent } : {}) };
      return `${ARTIFACT_REFERENCE_START}${encodeURIComponent(JSON.stringify(reference))}${ARTIFACT_REFERENCE_END}`;
    }
    const reference: SerializedSkillReference = {
      version: 1,
      id: `${part.skillId}:${index}`,
      skillId: part.skillId,
      name: part.name,
      source: part.source,
    };
    return `${SKILL_REFERENCE_START}${encodeURIComponent(JSON.stringify(reference))}${SKILL_REFERENCE_END}`;
  }).join("");
}

export function selectedSkillIdsFromPromptParts(parts: readonly UserPromptPart[]): string[] {
  const seen = new Set<string>();
  return parts.flatMap((part) => {
    if (part.type !== "skill-reference" || seen.has(part.skillId)) return [];
    seen.add(part.skillId);
    return [part.skillId];
  });
}

function parseSkillReference(value: string): SerializedSkillReference | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !("version" in parsed) ||
      !("id" in parsed) ||
      !("skillId" in parsed) ||
      !("name" in parsed) ||
      !("source" in parsed) ||
      parsed.version !== 1 ||
      typeof parsed.id !== "string" ||
      typeof parsed.skillId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.source !== "string"
    ) return undefined;
    return parsed as SerializedSkillReference;
  } catch {
    return undefined;
  }
}

export function stripPromptSkillReferences(text: string): string {
  const pattern = new RegExp(`${SKILL_REFERENCE_START}([^<]*)${SKILL_REFERENCE_END}`, "g");
  return text.replace(pattern, (marker, encoded: string) => parseSkillReference(encoded) ? "" : marker);
}

export function formatPromptArtifactReferencesForModel(text: string): string {
  const pattern = new RegExp(`${ARTIFACT_REFERENCE_START}([^<]*)${ARTIFACT_REFERENCE_END}`, "g");
  return text.replace(pattern, (marker, encoded: string) => {
    const reference = parseArtifactReference(encoded);
    if (!reference) return marker;
    const locators = reference.locators?.length ? reference.locators : [reference.locator];
    return [
      "<wordless_artifact_reference>",
      `artifact_id=${reference.artifactId}`,
      `kind=${reference.kind}`,
      `revision=${reference.revision}`,
      ...(reference.intent ? [`intent=${reference.intent}`] : []),
      `exact_selection=${JSON.stringify(locators)}`,
      "Use the exact selection for the requested operation. Do not replace it with the used range or the whole sheet.",
      "</wordless_artifact_reference>",
    ].join("\n");
  });
}

function projectPromptSkillReferences(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = new RegExp(`${SKILL_REFERENCE_START}([^<]*)${SKILL_REFERENCE_END}`, "g");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const reference = parseSkillReference(match[1] ?? "");
    if (!reference) continue;
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: "text", text: text.slice(cursor, index) });
    blocks.push({ type: "skill-reference", id: reference.id, skillId: reference.skillId, name: reference.name, source: reference.source });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ type: "text", text: text.slice(cursor) });
  return blocks;
}

function parseWorkspaceReference(value: string): SerializedWorkspaceReference | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const valueRecord = parsed as Record<string, unknown>;
    if (valueRecord.version !== 1 || typeof valueRecord.id !== "string" || typeof valueRecord.path !== "string" || typeof valueRecord.name !== "string" || (valueRecord.kind !== "file" && valueRecord.kind !== "directory")) return undefined;
    return valueRecord as SerializedWorkspaceReference;
  } catch {
    return undefined;
  }
}

function projectPromptWorkspaceReferences(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = new RegExp(`${WORKSPACE_REFERENCE_START}([^<]*)${WORKSPACE_REFERENCE_END}`, "g");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const reference = parseWorkspaceReference(match[1] ?? "");
    if (!reference) continue;
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: "text", text: text.slice(cursor, index) });
    blocks.push({ type: "workspace-reference", id: reference.id, path: reference.path, name: reference.name, kind: reference.kind });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ type: "text", text: text.slice(cursor) });
  return blocks;
}

function parseArtifactReference(value: string): SerializedArtifactReference | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || typeof record.id !== "string" || typeof record.artifactId !== "string" || typeof record.name !== "string" || typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision < 1 || typeof record.surfaceId !== "string" || typeof record.locator !== "string") return undefined;
    if (record.kind !== "presentation" && record.kind !== "document" && record.kind !== "spreadsheet" && record.kind !== "browser") return undefined;
    if (record.locators !== undefined && (!Array.isArray(record.locators) || record.locators.some((locator) => typeof locator !== "string"))) return undefined;
    if (record.intent !== undefined && record.intent !== "reference" && record.intent !== "analyze" && record.intent !== "formula" && record.intent !== "chart" && record.intent !== "pivot") return undefined;
    return record as SerializedArtifactReference;
  } catch {
    return undefined;
  }
}

function projectPromptArtifactReferences(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = new RegExp(`${ARTIFACT_REFERENCE_START}([^<]*)${ARTIFACT_REFERENCE_END}`, "g");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const reference = parseArtifactReference(match[1] ?? "");
    if (!reference) continue;
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: "text", text: text.slice(cursor, index) });
    blocks.push({ type: "artifact", artifactId: reference.artifactId, kind: reference.kind, name: reference.name, revision: reference.revision, surfaceId: reference.surfaceId, locator: reference.locator });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ type: "text", text: text.slice(cursor) });
  return blocks;
}

export function splitPromptAttachments(text: string): { text: string; attachments: MessageAttachmentBlock[] } {
  const start = text.lastIndexOf(WORKSPACE_ATTACHMENT_START);
  if (start === -1 || !text.endsWith(WORKSPACE_ATTACHMENT_END)) return { text, attachments: [] };
  const payload = text.slice(start + WORKSPACE_ATTACHMENT_START.length, -WORKSPACE_ATTACHMENT_END.length);
  try {
    const value = JSON.parse(payload) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      !("attachments" in value) ||
      (value.version !== 1 && value.version !== 2) ||
      !Array.isArray(value.attachments)
    ) {
      return { text, attachments: [] };
    }
    const attachments = value.attachments.flatMap((attachment, index): MessageAttachmentBlock[] => {
      if (
        typeof attachment !== "object" ||
        attachment === null ||
        !("path" in attachment) ||
        !("name" in attachment) ||
        !("mediaType" in attachment) ||
        typeof attachment.path !== "string" ||
        typeof attachment.name !== "string" ||
        typeof attachment.mediaType !== "string"
      ) {
        return [];
      }
      return [{ type: "attachment", id: `${attachment.path}:${index}`, name: attachment.name, mediaType: attachment.mediaType }];
    });
    return { text: text.slice(0, start), attachments };
  } catch {
    return { text, attachments: [] };
  }
}

export function projectUserMessageContent(content: unknown): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const appendText = (text: string) => {
    const visibleText = text
      .replace(/\n*<wordless-presentation(?:\s[^>]*)?>[\s\S]*?<\/wordless-presentation>\s*/gi, "")
      .trimEnd();
    const parsed = splitPromptAttachments(visibleText);
    for (const artifactBlock of projectPromptArtifactReferences(parsed.text)) {
      if (artifactBlock.type !== "text") {
        blocks.push(artifactBlock);
        continue;
      }
      for (const block of projectPromptWorkspaceReferences(artifactBlock.text)) {
        if (block.type === "text") blocks.push(...projectPromptSkillReferences(block.text));
        else blocks.push(block);
      }
    }
    blocks.push(...parsed.attachments);
  };

  if (typeof content === "string") {
    appendText(content);
    return blocks;
  }
  if (!Array.isArray(content)) return blocks;

  for (const item of content) {
    if (typeof item !== "object" || item === null || Array.isArray(item) || !("type" in item) || item.type !== "text" || !("text" in item) || typeof item.text !== "string") continue;
    appendText(item.text);
  }
  return blocks;
}

export interface AgentSkillReference {
  id: string;
  source: "built-in" | "workspace" | "future-extension";
}

export interface AgentRuntimeSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation: boolean;
  source: SkillSource;
  workspaceId: string | null;
  baseDir: string;
}

export interface AgentProfileDefinition {
  reference: ProfileReference;
  driverId: AgentDriverId;
  modelRequirements: ModelRequirements;
  systemPrompt: string;
  activeToolNames: string[];
  capabilityIds: string[];
  defaultConnectorTemplateIds?: string[];
  skills: AgentSkillReference[];
  artifactKinds: string[];
  contextCompactionInstructions?: string;
  workbenchId: WorkbenchId;
}

export type AgentDriverCommand =
  | { type: "prompt"; text: string; attachments?: AgentTextAttachment[]; selectedSkills?: AgentRuntimeSkill[]; submission?: UserMessageSubmission }
  | { type: "steer"; text: string; attachments?: AgentTextAttachment[]; submission?: UserMessageSubmission }
  | { type: "follow-up"; text: string; attachments?: AgentTextAttachment[]; submission?: UserMessageSubmission }
  | { type: "cancel" }
  | { type: "resolve-approval"; resolution: OperationApprovalResolution }
  | { type: "set-tool-approval-mode"; mode: ToolApprovalMode }
  | { type: "resolve-user-request"; resolution: UserRequestResolution }
  | { type: "set-model"; model: ModelReference }
  | { type: "set-thinking"; level: ThinkingLevel }
  | { type: "compact"; trigger: ContextCompactionTrigger; instructions?: string }
  | { type: "extension.interact"; interaction: AgentExtensionInteraction };

export type AgentDriverEventBase =
  | { type: "message.started"; message: ConversationMessage }
  | { type: "message.text.delta"; messageId: string; delta: string }
  | { type: "message.reasoning.delta"; messageId: string; delta: string }
  | { type: "message.completed"; message: ConversationMessage }
  | { type: "tool.started"; messageId: string; callId: string; name: string; input: Record<string, unknown> }
  | { type: "tool.updated"; messageId: string; callId: string; output: string; details?: unknown; usage?: ConversationUsage }
  | { type: "tool.completed"; messageId: string; callId: string; output: string; details?: unknown; usage?: ConversationUsage; isError: boolean }
  | { type: "approval.requested"; messageId: string; approval: OperationApprovalRequest }
  | { type: "approval.resolved"; messageId: string; resolution: OperationApprovalResolution }
  | { type: "user-request.requested"; messageId: string; request: UserRequest }
  | { type: "user-request.resolved"; messageId: string; resolution: UserRequestResolution }
  | { type: "model.changed"; model: ModelReference }
  | { type: "context.compaction.started"; trigger: ContextCompactionTrigger }
  | { type: "context.compaction.completed"; compaction: ContextCompactionRecord }
  | { type: "context.compaction.failed"; trigger: ContextCompactionTrigger; message: string };

export type AgentDriverEvent =
  | AgentDriverEventBase
  | { type: "extension.event"; event: AgentExtensionEvent };

export interface AgentDriverSessionContext {
  record: SessionRecord;
  profile: AgentProfileDefinition;
  model: Model<Api>;
  modelCapabilities: ModelCapabilities;
  models: Models;
  session: Session<SessionMetadata>;
  env: ExecutionEnv;
  skills: AgentRuntimeSkill[];
  connectorTools: AgentTool[];
  connectorToolPolicies: ConnectorToolPolicy[];
  security: SecurityPolicySnapshot;
  resolveModel(reference: ModelReference): Model<Api>;
  executionKind?: "primary" | "subagent";
  subagentRunner?: SubagentRunner;
  toolApprovalMode?: ToolApprovalMode;
}

export interface AgentDriverSession {
  readonly features: readonly AgentDriverFeature[];
  execute(command: AgentDriverCommand): Promise<void>;
  subscribe(listener: (event: AgentDriverEvent) => void): () => void;
  dispose(): void;
}

export interface AgentDriver {
  readonly id: AgentDriverId;
  readonly features: readonly AgentDriverFeature[];
  createSession(context: AgentDriverSessionContext): Promise<AgentDriverSession>;
}

export interface AgentDriverRegistry {
  get(id: AgentDriverId): AgentDriver | undefined;
  list(): AgentDriver[];
}

export function createAgentDriverRegistry(drivers: AgentDriver[]): AgentDriverRegistry {
  const byId = new Map<AgentDriverId, AgentDriver>();
  for (const driver of drivers) {
    if (byId.has(driver.id)) throw new Error(`Duplicate Agent Driver: ${driver.id}`);
    byId.set(driver.id, driver);
  }
  return {
    get(id) {
      return byId.get(id);
    },
    list() {
      return [...byId.values()];
    },
  };
}
