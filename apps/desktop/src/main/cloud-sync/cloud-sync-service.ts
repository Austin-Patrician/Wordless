import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppPreferences, ConfiguredModelKind } from "@wordless/domain";
import type { CloudSyncConflictResolution, CloudSyncInitialStrategy, CloudSyncSnapshot, DesktopHostEvent } from "@wordless/protocol";
import type { WordlessRuntime } from "@wordless/runtime";
import type { GoogleAccountService } from "../account/google-account-service.ts";
import { GoogleDriveAppData, type DriveAppDataFile } from "./google-drive-app-data.ts";

const RESOURCE_FILES = { preferences: "wordless-preferences-v1.json", models: "wordless-model-catalog-v1.json" } as const;
type ResourceId = keyof typeof RESOURCE_FILES;

type SyncEnvelope = { version: 1; updatedAt: number; deviceId: string; payload: unknown };
type PersistedState = {
  version: 1;
  deviceId: string;
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  pendingCount: number;
  fileIds: Partial<Record<ResourceId, string>>;
  baseline: Partial<Record<ResourceId, unknown>>;
};

const EMPTY_STATE = (): PersistedState => ({ version: 1, deviceId: randomUUID(), enabled: false, lastSyncAt: null, lastError: null, pendingCount: 0, fileIds: {}, baseline: {} });

export class CloudSyncService {
  private state = EMPTY_STATE();
  private status: CloudSyncSnapshot["status"] = "disabled";
  private conflicts: string[] = [];
  private running: Promise<CloudSyncSnapshot> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  private readonly options: {
    statePath: string;
    runtime: WordlessRuntime;
    account: GoogleAccountService;
    drive: GoogleDriveAppData;
    send: (event: DesktopHostEvent) => void;
  };

  constructor(options: {
    statePath: string;
    runtime: WordlessRuntime;
    account: GoogleAccountService;
    drive: GoogleDriveAppData;
    send: (event: DesktopHostEvent) => void;
  }) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.options.statePath, "utf8")) as Partial<PersistedState>;
      if (value.version === 1 && typeof value.deviceId === "string") this.state = { ...EMPTY_STATE(), ...value, fileIds: value.fileIds ?? {}, baseline: value.baseline ?? {} };
    } catch {
      await this.persist();
    }
    this.status = !this.state.enabled ? "disabled" : this.options.account.getSnapshot().status === "signed-in" ? "idle" : "needs-reconnect";
    if (this.state.enabled && this.options.account.getSnapshot().status === "signed-in") setTimeout(() => void this.syncNow(), 2_000);
  }

  getSnapshot(): CloudSyncSnapshot {
    return {
      enabled: this.state.enabled,
      status: this.status,
      lastSyncAt: this.state.lastSyncAt,
      lastError: this.state.lastError,
      pendingCount: this.state.pendingCount,
      conflicts: [...this.conflicts],
      accountEmail: this.options.account.getSnapshot().email,
    };
  }

  async enable(strategy: CloudSyncInitialStrategy): Promise<CloudSyncSnapshot> {
    await this.options.account.authorizeDriveAppData();
    this.state.enabled = true;
    this.state.pendingCount = Math.max(1, this.state.pendingCount);
    this.status = "idle";
    await this.persistAndEmit();
    return await this.syncNow(strategy);
  }

  async disable(): Promise<CloudSyncSnapshot> {
    this.state.enabled = false;
    this.status = "disabled";
    this.conflicts = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    await this.persistAndEmit();
    return this.getSnapshot();
  }

  markDirty(): void {
    if (!this.state.enabled) return;
    this.state.pendingCount = Math.max(1, this.state.pendingCount);
    void this.persistAndEmit();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), 1_200);
  }

  syncNow(strategy?: CloudSyncInitialStrategy): Promise<CloudSyncSnapshot> {
    if (this.running) return this.running;
    this.running = this.performSync(strategy).finally(() => { this.running = null; });
    return this.running;
  }

  async resolveConflicts(resolution: CloudSyncConflictResolution): Promise<CloudSyncSnapshot> {
    this.conflicts = [];
    return await this.syncNow(resolution === "local" ? "local" : "remote");
  }

  async deleteRemote(): Promise<CloudSyncSnapshot> {
    const files = await this.options.drive.list();
    await Promise.all(files.filter((file) => Object.values(RESOURCE_FILES).includes(file.name as typeof RESOURCE_FILES[ResourceId])).map((file) => this.options.drive.delete(file.id)));
    this.state.fileIds = {};
    this.state.baseline = {};
    this.state.lastSyncAt = null;
    this.state.pendingCount = this.state.enabled ? 1 : 0;
    this.status = this.state.enabled ? "idle" : "disabled";
    await this.persistAndEmit();
    return this.getSnapshot();
  }

  onAccountLoggedOut(): void {
    if (!this.state.enabled) return;
    this.status = "needs-reconnect";
    this.state.lastError = "Sign in again to continue cloud sync.";
    this.emit();
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
  }

  private async performSync(strategy?: CloudSyncInitialStrategy): Promise<CloudSyncSnapshot> {
    if (!this.state.enabled) return this.getSnapshot();
    if (this.options.account.getSnapshot().status !== "signed-in") {
      this.status = "needs-reconnect";
      this.state.lastError = "Sign in again to continue cloud sync.";
      await this.persistAndEmit();
      return this.getSnapshot();
    }
    this.status = "syncing";
    this.state.lastError = null;
    this.emit();
    try {
      const files = await this.options.drive.list();
      this.conflicts = [];
      await this.syncResource("preferences", files, this.localPreferences(), (payload) => this.applyPreferences(payload), strategy);
      await this.syncResource("models", files, this.localModels(), (payload) => this.applyModels(payload), strategy);
      if (this.conflicts.length > 0) {
        this.status = "conflict";
        this.state.lastError = "Some settings were changed on more than one device.";
      } else {
        this.status = "synced";
        this.state.lastSyncAt = Date.now();
        this.state.pendingCount = 0;
      }
      await this.persistAndEmit();
    } catch (cause) {
      const error = cause as Error & { status?: number };
      this.state.lastError = error.name === "AbortError" ? "Cloud sync timed out." : error.message;
      this.status = error.status === 401 || error.status === 403 ? "needs-reconnect" : isNetworkError(error) ? "offline" : "error";
      await this.persistAndEmit();
    }
    return this.getSnapshot();
  }

  private async syncResource(id: ResourceId, files: DriveAppDataFile[], local: unknown, apply: (payload: unknown) => Promise<void> | void, strategy?: CloudSyncInitialStrategy): Promise<void> {
    const name = RESOURCE_FILES[id];
    const file = files.find((candidate) => candidate.name === name);
    if (!file) {
      const created = await this.options.drive.write(name, this.envelope(local));
      this.state.fileIds[id] = created.id;
      this.state.baseline[id] = local;
      return;
    }
    this.state.fileIds[id] = file.id;
    const envelope = await this.options.drive.read(file.id);
    const remote = readEnvelope(envelope);
    if (strategy === "local") {
      await this.options.drive.write(name, this.envelope(local), file.id);
      this.state.baseline[id] = local;
      return;
    }
    if (strategy === "remote") {
      await apply(remote);
      this.state.baseline[id] = remote;
      return;
    }
    const baseline = this.state.baseline[id];
    const result = baseline === undefined ? { value: mergeObjects(remote, local), conflicts: [] } : threeWayMerge(baseline, local, remote);
    if (result.conflicts.length > 0) {
      this.conflicts.push(...result.conflicts.map((path) => `${id}.${path}`));
      return;
    }
    await apply(result.value);
    await this.options.drive.write(name, this.envelope(result.value), file.id);
    this.state.baseline[id] = result.value;
  }

  private localPreferences(): Record<string, unknown> {
    const preferences = this.options.runtime.getSnapshot().preferences;
    return {
      locale: preferences.locale,
      theme: preferences.theme,
      fontScale: preferences.fontScale,
      reduceMotion: preferences.reduceMotion,
      notifications: preferences.notifications,
      appearance: preferences.appearance,
      defaultModel: preferences.defaultModel,
      entryModels: preferences.entryModels,
    };
  }

  private applyPreferences(payload: unknown): void {
    if (!isObject(payload)) throw new Error("Cloud preferences are invalid.");
    const current = this.options.runtime.getSnapshot().preferences;
    const next: AppPreferences = { ...current };
    if (payload.locale === "zh-CN" || payload.locale === "en-US") next.locale = payload.locale;
    if (payload.theme === "light" || payload.theme === "dark" || payload.theme === "system") next.theme = payload.theme;
    if (typeof payload.fontScale === "number" && payload.fontScale >= 0.8 && payload.fontScale <= 1.4) next.fontScale = payload.fontScale;
    if (typeof payload.reduceMotion === "boolean") next.reduceMotion = payload.reduceMotion;
    if (isObject(payload.notifications)) next.notifications = payload.notifications as unknown as AppPreferences["notifications"];
    if (isObject(payload.appearance)) next.appearance = payload.appearance as unknown as AppPreferences["appearance"];
    if (payload.defaultModel === null || isModelReference(payload.defaultModel)) next.defaultModel = payload.defaultModel;
    if (isObject(payload.entryModels)) next.entryModels = Object.fromEntries(Object.entries(payload.entryModels).filter((entry): entry is [string, AppPreferences["entryModels"][string]] => isModelReference(entry[1])));
    this.options.runtime.setPreferences(next);
  }

  private localModels(): Record<string, unknown> {
    const snapshot = this.options.runtime.getSnapshot().modelConfiguration;
    return {
      providers: snapshot.providers.filter((provider) => provider.configuration).map((provider) => ({ id: provider.id, kind: provider.kind, configuration: sanitizeProviderConfiguration(provider.configuration!) })),
      enabled: snapshot.models.filter((model) => model.enabled).map((model) => ({ kind: model.kind, providerId: model.providerId, modelId: model.modelId })),
    };
  }

  private async applyModels(payload: unknown): Promise<void> {
    if (!isObject(payload) || !Array.isArray(payload.providers) || !Array.isArray(payload.enabled)) throw new Error("Cloud model configuration is invalid.");
    const current = this.options.runtime.getSnapshot().modelConfiguration;
    for (const item of payload.providers) {
      if (!isObject(item) || typeof item.id !== "string" || (item.kind !== "chat" && item.kind !== "image") || !isObject(item.configuration)) continue;
      const existing = current.providers.find((provider) => provider.id === item.id && provider.kind === item.kind)?.configuration ?? {};
      const preserved = sensitiveProviderFields(existing);
      await this.options.runtime.saveProviderConfiguration(item.kind, item.id, { ...item.configuration, ...preserved });
    }
    const desired = new Set(payload.enabled.filter(isEnabledModel).map((item) => `${item.kind}:${item.providerId}/${item.modelId}`));
    const refreshed = this.options.runtime.getSnapshot().modelConfiguration;
    for (const model of refreshed.models) {
      const enabled = desired.has(`${model.kind}:${model.providerId}/${model.modelId}`);
      if (model.enabled !== enabled) await this.options.runtime.setConfiguredModelEnabled(model.kind, model.providerId, model.modelId, enabled);
    }
  }

  private envelope(payload: unknown): SyncEnvelope {
    return { version: 1, updatedAt: Date.now(), deviceId: this.state.deviceId, payload };
  }

  private async persistAndEmit(): Promise<void> { await this.persist(); this.emit(); }
  private emit(): void { this.options.send({ type: "cloud-sync.changed", snapshot: this.getSnapshot() }); }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.options.statePath), { recursive: true });
    const temporary = `${this.options.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state), "utf8");
    await rename(temporary, this.options.statePath);
  }
}

function readEnvelope(value: unknown): unknown {
  if (!isObject(value) || value.version !== 1 || !("payload" in value)) throw new Error("Cloud sync data uses an unsupported format.");
  return value.payload;
}

function sanitizeProviderConfiguration(configuration: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(["name", "avatarId", "baseUrl", "api", "authHeader", "compat", "models", "modelOverrides"]);
  return Object.fromEntries(Object.entries(configuration).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, sanitizeValue(value)]));
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:key|token|secret|password|header|credential|authorization)/i.test(key)).map(([key, child]) => [key, sanitizeValue(child)]));
}

function sensitiveProviderFields(configuration: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(configuration).filter(([key]) => /^(?:apiKey|headers)$/i.test(key)));
}

function isEnabledModel(value: unknown): value is { kind: ConfiguredModelKind; providerId: string; modelId: string } {
  return isObject(value) && (value.kind === "chat" || value.kind === "image") && typeof value.providerId === "string" && typeof value.modelId === "string";
}

function isModelReference(value: unknown): value is { connectionId: string; modelId: string } {
  return isObject(value) && typeof value.connectionId === "string" && typeof value.modelId === "string";
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function mergeObjects(remote: unknown, local: unknown): unknown {
  if (!isObject(remote) || !isObject(local)) return local;
  const result: Record<string, unknown> = { ...remote };
  for (const [key, value] of Object.entries(local)) result[key] = key in remote ? mergeObjects(remote[key], value) : value;
  return result;
}

function threeWayMerge(base: unknown, local: unknown, remote: unknown, prefix = ""): { value: unknown; conflicts: string[] } {
  if (equal(local, remote)) return { value: local, conflicts: [] };
  if (equal(local, base)) return { value: remote, conflicts: [] };
  if (equal(remote, base)) return { value: local, conflicts: [] };
  if (!isObject(base) || !isObject(local) || !isObject(remote)) return { value: local, conflicts: [prefix || "value"] };
  const value: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const result = threeWayMerge(base[key], local[key], remote[key], prefix ? `${prefix}.${key}` : key);
    value[key] = result.value;
    conflicts.push(...result.conflicts);
  }
  return { value, conflicts };
}

function isNetworkError(error: Error): boolean {
  return error.name === "AbortError" || /fetch failed|network|offline|timeout|ENOTFOUND|ECONN/i.test(error.message);
}
