import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentExtension,
  AgentExtensionConfiguration,
  AgentExtensionContext,
  AgentExtensionDefinition,
  AgentExtensionEvent,
  AgentExtensionHost,
  AgentExtensionHostFactory,
  AgentExtensionInteraction,
  AgentExtensionSessionState,
  AgentExtensionSnapshot,
  AgentTool,
  JsonObject,
  SubagentResult,
  SubagentRunner,
  SubagentTask,
  SubagentTaskProgress,
} from "@wordless/agent-extension-sdk";
import {
  AGENT_EXTENSION_STATE_JOURNAL_TYPE,
  cloneJsonObject,
  createDisabledConfiguration,
  isJsonObject,
} from "@wordless/agent-extension-sdk";
import type { AgentHarness, ExecutionEnv, Session } from "@wordless/agent";
import type { AgentDriverId, SessionRecord } from "@wordless/domain";

type PersistedExtensionFile = {
  version: 1;
  configurations: Record<string, AgentExtensionConfiguration>;
};

type JournalEntry = {
  type: string;
  customType?: string;
  data?: unknown;
};

function asState(value: unknown): AgentExtensionSessionState | undefined {
  if (!isJsonObject(value) || typeof value.extensionId !== "string" || typeof value.updatedAt !== "number" || !isJsonObject(value.state)) return undefined;
  return { extensionId: value.extensionId, updatedAt: value.updatedAt, state: cloneJsonObject(value.state) };
}

async function readPersisted(pathname: string): Promise<PersistedExtensionFile | undefined> {
  try {
    const value = JSON.parse(await readFile(pathname, "utf8")) as unknown;
    if (!isJsonObject(value) || value.version !== 1 || !isJsonObject(value.configurations)) return undefined;
    const configurations: Record<string, AgentExtensionConfiguration> = {};
    for (const [id, candidate] of Object.entries(value.configurations)) {
      if (!isJsonObject(candidate) || typeof candidate.enabled !== "boolean" || !isJsonObject(candidate.settings)) continue;
      configurations[id] = { enabled: candidate.enabled, settings: cloneJsonObject(candidate.settings) };
    }
    return { version: 1, configurations };
  } catch {
    return undefined;
  }
}

async function writePersisted(pathname: string, value: PersistedExtensionFile): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface AgentExtensionManagerOptions {
  path: string;
  definitions: AgentExtensionDefinition[];
  subagentRunner?: SubagentRunner;
}

export class AgentExtensionManager implements AgentExtensionHostFactory {
  private readonly filePath: string;
  private readonly definitions: Map<string, AgentExtensionDefinition>;
  private readonly subagentRunner?: SubagentRunner;
  private configurations = new Map<string, AgentExtensionConfiguration>();

  constructor(options: AgentExtensionManagerOptions) {
    this.filePath = options.path;
    this.subagentRunner = options.subagentRunner;
    this.definitions = new Map();
    for (const definition of options.definitions) {
      if (this.definitions.has(definition.descriptor.id)) throw new Error(`Duplicate agent extension: ${definition.descriptor.id}`);
      this.definitions.set(definition.descriptor.id, definition);
    }
  }

  async initialize(): Promise<void> {
    const persisted = await readPersisted(this.filePath);
    this.configurations = new Map();
    for (const definition of this.definitions.values()) {
      const stored = persisted?.configurations[definition.descriptor.id];
      this.configurations.set(definition.descriptor.id, stored ? { enabled: stored.enabled, settings: cloneJsonObject(stored.settings) } : createDisabledConfiguration());
    }
    await this.persist();
  }

  snapshot(): AgentExtensionSnapshot {
    const configurations: Record<string, AgentExtensionConfiguration> = {};
    for (const [id, configuration] of this.configurations) configurations[id] = { enabled: configuration.enabled, settings: cloneJsonObject(configuration.settings) };
    return { descriptors: [...this.definitions.values()].map((definition) => definition.descriptor), configurations };
  }

  async setEnabled(id: string, enabled: boolean): Promise<AgentExtensionSnapshot> {
    const current = this.requireConfiguration(id);
    this.configurations.set(id, { ...current, enabled });
    await this.persist();
    return this.snapshot();
  }

  async updateSettings(id: string, settings: JsonObject): Promise<AgentExtensionSnapshot> {
    const current = this.requireConfiguration(id);
    this.configurations.set(id, { ...current, settings: cloneJsonObject(settings) });
    await this.persist();
    return this.snapshot();
  }

  async create(context: {
    record: SessionRecord;
    env: ExecutionEnv;
    session: Session;
    harness: AgentHarness;
    contextCompactionInstructions?: string;
    subagentRunner?: SubagentRunner;
    registerTools(tools: AgentTool[]): Promise<void>;
    getCurrentPrompt(): string | undefined;
    emit(event: AgentExtensionEvent): void;
  }): Promise<AgentExtensionHost> {
    const states = await readSessionStates(context.session);
    const instances = new Map<string, { definition: AgentExtensionDefinition; state: AgentExtensionSessionState; instance: AgentExtension }>();
    for (const definition of this.definitions.values()) {
      const configuration = this.configurations.get(definition.descriptor.id) ?? createDisabledConfiguration();
      if (!configuration.enabled || !definition.descriptor.supportedDriverIds.includes(context.record.driverId)) continue;
      const state = states.get(definition.descriptor.id) ?? { extensionId: definition.descriptor.id, state: {}, updatedAt: Date.now() };
      const instance = definition.create({
        descriptor: definition.descriptor,
        configuration,
        record: context.record,
        env: context.env,
        session: context.session,
        harness: context.harness,
        contextCompactionInstructions: context.contextCompactionInstructions,
        subagentRunner: context.subagentRunner ?? this.subagentRunner,
        registerTools: context.registerTools,
        getCurrentPrompt: context.getCurrentPrompt,
        state: cloneJsonObject(state.state),
        setState: async (next) => {
          const entry: AgentExtensionSessionState = { extensionId: definition.descriptor.id, state: cloneJsonObject(next), updatedAt: Date.now() };
          await (context.session as unknown as { appendCustomEntry(customType: string, data?: unknown): Promise<string> }).appendCustomEntry(AGENT_EXTENSION_STATE_JOURNAL_TYPE, entry);
          states.set(definition.descriptor.id, entry);
          context.emit({ extensionId: definition.descriptor.id, type: "state.changed", payload: entry });
        },
        emit: (type, payload) => context.emit({ extensionId: definition.descriptor.id, type, payload }),
      });
      instances.set(definition.descriptor.id, { definition, state, instance });
    }
    return new ExtensionHost(instances);
  }

  private requireConfiguration(id: string): AgentExtensionConfiguration {
    const configuration = this.configurations.get(id);
    if (!configuration) throw new Error(`Unknown agent extension: ${id}`);
    return configuration;
  }

  private async persist(): Promise<void> {
    const configurations: Record<string, AgentExtensionConfiguration> = {};
    for (const [id, configuration] of this.configurations) configurations[id] = configuration;
    await writePersisted(this.filePath, { version: 1, configurations });
  }
}

class ExtensionHost implements AgentExtensionHost {
  private readonly instances: Map<string, { definition: AgentExtensionDefinition; state: AgentExtensionSessionState; instance: AgentExtension }>;

  constructor(instances: Map<string, { definition: AgentExtensionDefinition; state: AgentExtensionSessionState; instance: AgentExtension }>) {
    this.instances = instances;
  }

  async activate(): Promise<void> {
    for (const { instance } of this.instances.values()) await instance.activate();
  }

  async interact(interaction: AgentExtensionInteraction): Promise<void> {
    const instance = this.instances.get(interaction.extensionId);
    if (!instance?.instance.interact) throw new Error(`Agent extension is not active: ${interaction.extensionId}`);
    await instance.instance.interact(interaction.action, interaction.payload);
  }

  getState(extensionId: string): AgentExtensionSessionState | undefined {
    const instance = this.instances.get(extensionId);
    return instance ? { ...instance.state, state: cloneJsonObject(instance.state.state) } : undefined;
  }

  async dispose(): Promise<void> {
    for (const { instance } of this.instances.values()) await instance.dispose();
  }
}

async function readSessionStates(session: Session): Promise<Map<string, AgentExtensionSessionState>> {
  const states = new Map<string, AgentExtensionSessionState>();
  for (const entry of (await session.getEntries()) as JournalEntry[]) {
    if (entry.type !== "custom" || entry.customType !== AGENT_EXTENSION_STATE_JOURNAL_TYPE) continue;
    const state = asState(entry.data);
    if (state) states.set(state.extensionId, state);
  }
  return states;
}

export async function readAgentExtensionStates(session: Session): Promise<AgentExtensionSessionState[]> {
  return [...(await readSessionStates(session)).values()];
}

export function createAgentExtensionHostFactory(manager: AgentExtensionManager): AgentExtensionHostFactory {
  return manager;
}

export async function ensureAgentExtensionFile(pathname: string): Promise<void> {
  try {
    await access(pathname);
  } catch {
    await writePersisted(pathname, { version: 1, configurations: {} });
  }
}

export interface SubagentTaskExecutor {
  execute(task: SubagentTask, signal: AbortSignal, onUpdate?: (progress: SubagentTaskProgress) => void): Promise<SubagentResult>;
}

export interface SubagentProcessPoolOptions {
  executor: SubagentTaskExecutor;
  maxTasks?: number;
  maxConcurrency?: number;
}

export class SubagentTaskPool implements SubagentRunner {
  private readonly executor: SubagentTaskExecutor;
  private readonly maxTasks: number;
  private readonly maxConcurrency: number;
  private readonly pending = new Map<string, { task: SubagentTask; onUpdate?: (progress: SubagentTaskProgress) => void; resolve: (result: SubagentResult) => void; reject: (cause: unknown) => void }>();
  private readonly active = new Map<string, AbortController>();

  constructor(options: SubagentProcessPoolOptions) {
    this.executor = options.executor;
    this.maxTasks = options.maxTasks ?? 8;
    this.maxConcurrency = options.maxConcurrency ?? 4;
  }

  run(task: SubagentTask, options: { signal?: AbortSignal; onUpdate?: (progress: SubagentTaskProgress) => void } = {}): Promise<SubagentResult> {
    if (this.pending.size + this.active.size >= this.maxTasks) return Promise.reject(new Error("The subagent task limit has been reached"));
    return new Promise<SubagentResult>((resolve, reject) => {
      this.pending.set(task.id, { task, onUpdate: options.onUpdate, resolve, reject });
      options.onUpdate?.({ taskId: task.id, status: "queued" });
      if (options.signal) {
        if (options.signal.aborted) {
          this.pending.delete(task.id);
          resolve({ taskId: task.id, status: "cancelled", text: "", error: "The task was cancelled before it started" });
        } else {
          options.signal.addEventListener("abort", () => void this.cancel(task.id), { once: true });
        }
      }
      this.schedule();
    });
  }

  async cancel(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (pending) {
      this.pending.delete(taskId);
      pending.resolve({ taskId, status: "cancelled", text: "", error: "The task was cancelled" });
      return;
    }
    this.active.get(taskId)?.abort();
  }

  async dispose(): Promise<void> {
    const taskIds = new Set([...this.pending.keys(), ...this.active.keys()]);
    await Promise.all([...taskIds].map((taskId) => this.cancel(taskId)));
  }

  private schedule(): void {
    while (this.active.size < this.maxConcurrency && this.pending.size > 0) {
      const next = this.pending.values().next().value as { task: SubagentTask; onUpdate?: (progress: SubagentTaskProgress) => void; resolve: (result: SubagentResult) => void; reject: (cause: unknown) => void } | undefined;
      if (!next) return;
      this.pending.delete(next.task.id);
      const controller = new AbortController();
      this.active.set(next.task.id, controller);
      void this.execute(next, controller);
    }
  }

  private async execute(task: { task: SubagentTask; onUpdate?: (progress: SubagentTaskProgress) => void; resolve: (result: SubagentResult) => void; reject: (cause: unknown) => void }, controller: AbortController): Promise<void> {
    try {
      task.onUpdate?.({ taskId: task.task.id, status: "running" });
      task.resolve(await this.executor.execute(task.task, controller.signal, task.onUpdate));
    } catch (cause) {
      task.reject(cause);
    } finally {
      this.active.delete(task.task.id);
      this.schedule();
    }
  }
}

export { SubagentTaskPool as SubagentProcessPool };

export { AGENT_EXTENSION_STATE_JOURNAL_TYPE } from "@wordless/agent-extension-sdk";

export type { AgentDriverId };
