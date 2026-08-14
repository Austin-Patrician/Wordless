import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Session,
  SessionError,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
} from "@wordless/agent";
import type {
  AppPreferences,
  AutomationRun,
  AutomationRunStatus,
  AutomationTask,
  EnabledModelRecord,
  MediaProject,
  ProviderConnectionRecord,
  SessionRecord,
  UsageModelKind,
  WorkspaceRecord,
  ExpertDefinition,
  SessionExpertSnapshot,
  ExpertTeamDefinition,
} from "@wordless/domain";

type SqlRow = Record<string, string | number | bigint | Uint8Array | null>;

function asString(value: string | number | bigint | Uint8Array | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: string | number | bigint | Uint8Array | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export type UsageSourceRecord = {
  sourceId: string;
  sessionId: string;
  sourceKind: "journal" | "media";
  revision: string;
  updatedAt: number;
};

export type UsageEventRecord = {
  sourceId: string;
  eventId: string;
  occurredAt: number;
  providerId: string;
  modelId: string;
  modelKind: UsageModelKind;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requestCount: number;
  usageAvailable: boolean;
  unmeteredOperationCount: number;
};

export class WordlessDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  getPreferences(defaults: AppPreferences): AppPreferences {
    const row = this.database.prepare("SELECT value FROM preferences WHERE key = ?").get("app") as SqlRow | undefined;
    if (!row) return defaults;
    try {
      const stored = parseJson<Partial<AppPreferences>>(asString(row.value));
      return {
        ...defaults,
        ...stored,
        entryModels: stored.entryModels ?? defaults.entryModels,
        notifications: {
          ...defaults.notifications,
          ...(typeof stored.notifications === "object" && stored.notifications !== null && !Array.isArray(stored.notifications) ? stored.notifications : {}),
        },
        security: {
          ...defaults.security,
          ...(typeof stored.security === "object" && stored.security !== null && !Array.isArray(stored.security) ? stored.security : {}),
        },
        appearance: {
          ...defaults.appearance,
          ...(typeof stored.appearance === "object" && stored.appearance !== null && !Array.isArray(stored.appearance) ? stored.appearance : {}),
          background: {
            ...defaults.appearance.background,
            ...(typeof stored.appearance === "object" && stored.appearance !== null && !Array.isArray(stored.appearance) && "background" in stored.appearance && typeof stored.appearance.background === "object" && stored.appearance.background !== null && !Array.isArray(stored.appearance.background) ? stored.appearance.background : {}),
          },
        },
      };
    } catch {
      return defaults;
    }
  }

  savePreferences(preferences: AppPreferences): void {
    this.database
      .prepare(
        "INSERT INTO preferences(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run("app", JSON.stringify(preferences), Date.now());
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.database
      .prepare("SELECT * FROM workspaces ORDER BY last_opened_at DESC, created_at DESC")
      .all()
      .map((row) => this.readWorkspace(row));
  }

  findWorkspaceByCanonicalRoot(canonicalRootPath: string): WorkspaceRecord | undefined {
    const row = this.database.prepare("SELECT * FROM workspaces WHERE canonical_root_path = ?").get(canonicalRootPath);
    return row ? this.readWorkspace(row) : undefined;
  }

  upsertWorkspace(workspace: WorkspaceRecord): void {
    this.database
      .prepare(
        `INSERT INTO workspaces(id, kind, name, root_path, canonical_root_path, availability, created_at, updated_at, last_opened_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           name = excluded.name,
           root_path = excluded.root_path,
           canonical_root_path = excluded.canonical_root_path,
           availability = excluded.availability,
           updated_at = excluded.updated_at,
           last_opened_at = excluded.last_opened_at`,
      )
      .run(
        workspace.id,
        workspace.kind,
        workspace.name,
        workspace.rootPath,
        workspace.canonicalRootPath,
        workspace.availability,
        workspace.createdAt,
        workspace.updatedAt,
        workspace.lastOpenedAt,
      );
  }

  listSessions(): SessionRecord[] {
    return this.database
      .prepare("SELECT * FROM sessions ORDER BY pinned_at IS NULL ASC, pinned_at DESC, updated_at DESC")
      .all()
      .map((row) => this.readSession(row));
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.database.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? this.readSession(row) : undefined;
  }

  upsertSession(session: SessionRecord): void {
    this.database
      .prepare(
        `INSERT INTO sessions(id, title, workspace_id, runtime_root_path, mode, entry_id, profile_id, profile_version, driver_id, journal_format, workbench_id, access_level, model_connection_id, model_id, journal_path, connector_ids, interaction_mode, tool_approval_mode, thinking_level, pinned_at, expert_selection, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           workspace_id = excluded.workspace_id,
           runtime_root_path = excluded.runtime_root_path,
           mode = excluded.mode,
           entry_id = excluded.entry_id,
           profile_id = excluded.profile_id,
           profile_version = excluded.profile_version,
           driver_id = excluded.driver_id,
           journal_format = excluded.journal_format,
           workbench_id = excluded.workbench_id,
           access_level = excluded.access_level,
           model_connection_id = excluded.model_connection_id,
           model_id = excluded.model_id,
           journal_path = excluded.journal_path,
           connector_ids = excluded.connector_ids,
           interaction_mode = excluded.interaction_mode,
           tool_approval_mode = excluded.tool_approval_mode,
           thinking_level = excluded.thinking_level,
           pinned_at = excluded.pinned_at,
           expert_selection = excluded.expert_selection,
           updated_at = excluded.updated_at`,
      )
      .run(
        session.id,
        session.title,
        session.workspaceId,
        session.runtimeRootPath,
        session.mode,
        session.entryId,
        session.profile.id,
        session.profile.version,
        session.driverId,
        session.journalFormat,
        session.workbenchId,
        session.accessLevel,
        session.model.connectionId,
        session.model.modelId,
        session.journalPath,
        JSON.stringify(session.connectorIds),
        session.interactionMode ?? "default",
        session.toolApprovalMode,
        session.thinkingLevel,
        session.pinnedAt,
        session.expertSelection ? JSON.stringify(session.expertSelection) : null,
        session.createdAt,
        session.updatedAt,
      );
  }

  renameSession(id: string, title: string): SessionRecord | undefined {
    const current = this.getSession(id);
    if (!current) return undefined;
    const next = { ...current, title, updatedAt: Date.now() };
    this.upsertSession(next);
    return next;
  }

  setSessionPinned(id: string, pinned: boolean): SessionRecord | undefined {
    const current = this.getSession(id);
    if (!current) return undefined;
    const next = { ...current, pinnedAt: pinned ? Date.now() : null, updatedAt: Date.now() };
    this.upsertSession(next);
    return next;
  }

  deleteSession(id: string): boolean {
    return this.database.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
  }

  listMediaProjects(): MediaProject[] {
    return this.database
      .prepare("SELECT document FROM media_projects ORDER BY updated_at DESC")
      .all()
      .flatMap((row): MediaProject[] => {
        try {
          return [parseJson<MediaProject>(asString((row as SqlRow).document))];
        } catch {
          return [];
        }
      });
  }

  getMediaProject(sessionId: string): MediaProject | undefined {
    const row = this.database.prepare("SELECT document FROM media_projects WHERE session_id = ?").get(sessionId) as SqlRow | undefined;
    if (!row) return undefined;
    try {
      return parseJson<MediaProject>(asString(row.document));
    } catch {
      return undefined;
    }
  }

  upsertMediaProject(project: MediaProject): void {
    this.database
      .prepare(
        `INSERT INTO media_projects(session_id, title, document, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           title = excluded.title,
           document = excluded.document,
           updated_at = excluded.updated_at`,
      )
      .run(project.sessionId, project.title, JSON.stringify(project), project.createdAt, project.updatedAt);
  }

  deleteMediaProject(sessionId: string): boolean {
    return this.database.prepare("DELETE FROM media_projects WHERE session_id = ?").run(sessionId).changes > 0;
  }

  listConnections(): ProviderConnectionRecord[] {
    return this.database
      .prepare("SELECT * FROM provider_connections ORDER BY created_at ASC")
      .all()
      .map((row) => this.readConnection(row));
  }

  getConnection(id: string): ProviderConnectionRecord | undefined {
    const row = this.database.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id);
    return row ? this.readConnection(row) : undefined;
  }

  upsertConnection(connection: ProviderConnectionRecord): void {
    this.database
      .prepare(
        `INSERT INTO provider_connections(id, kind, provider_id, display_name, base_url, api, auth_status, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           provider_id = excluded.provider_id,
           display_name = excluded.display_name,
           base_url = excluded.base_url,
           api = excluded.api,
           auth_status = excluded.auth_status,
           updated_at = excluded.updated_at`,
      )
      .run(
        connection.id,
        connection.kind,
        connection.providerId,
        connection.displayName,
        connection.baseUrl,
        connection.api,
        connection.authStatus,
        connection.createdAt,
        connection.updatedAt,
      );
  }

  listEnabledModels(): EnabledModelRecord[] {
    return this.database
      .prepare("SELECT * FROM enabled_models ORDER BY connection_id, display_name")
      .all()
      .map((row) => this.readEnabledModel(row));
  }

  upsertEnabledModel(model: EnabledModelRecord): void {
    this.database
      .prepare(
        `INSERT INTO enabled_models(connection_id, model_id, display_name, capabilities, enabled, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, model_id) DO UPDATE SET
           display_name = excluded.display_name,
           capabilities = excluded.capabilities,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(model.connectionId, model.modelId, model.displayName, JSON.stringify(model.capabilities), model.enabled ? 1 : 0, model.updatedAt);
  }

  listUsageSources(): UsageSourceRecord[] {
    return this.database
      .prepare("SELECT * FROM usage_sources")
      .all()
      .map((row) => this.readUsageSource(row));
  }

  upsertUsageSource(source: UsageSourceRecord): void {
    this.database
      .prepare(
        `INSERT INTO usage_sources(source_id, session_id, source_kind, revision, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           session_id = excluded.session_id,
           source_kind = excluded.source_kind,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
      )
      .run(source.sourceId, source.sessionId, source.sourceKind, source.revision, source.updatedAt);
  }

  replaceUsageEvents(source: UsageSourceRecord, events: UsageEventRecord[]): void {
    this.database.exec("BEGIN");
    try {
      this.upsertUsageSource(source);
      this.database.prepare("DELETE FROM usage_events WHERE source_id = ?").run(source.sourceId);
      const insert = this.database.prepare(
        `INSERT INTO usage_events(source_id, event_id, occurred_at, provider_id, model_id, model_kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, estimated_cost, request_count, usage_available, unmetered_operation_count)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of events) {
        insert.run(
          event.sourceId,
          event.eventId,
          event.occurredAt,
          event.providerId,
          event.modelId,
          event.modelKind,
          event.inputTokens,
          event.outputTokens,
          event.cacheReadTokens,
          event.cacheWriteTokens,
          event.totalTokens,
          event.estimatedCost,
          event.requestCount,
          event.usageAvailable ? 1 : 0,
          event.unmeteredOperationCount,
        );
      }
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  deleteUsageSource(sourceId: string): void {
    this.database.prepare("DELETE FROM usage_sources WHERE source_id = ?").run(sourceId);
  }

  listUsageEvents(startAt: number, endAt: number): UsageEventRecord[] {
    return this.database
      .prepare("SELECT * FROM usage_events WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at ASC")
      .all(startAt, endAt)
      .map((row) => this.readUsageEvent(row));
  }

  claimMigration(version: number): boolean {
    const result = this.database.prepare("INSERT OR IGNORE INTO migrations(version) VALUES(?)").run(version);
    return result.changes > 0;
  }

  clearLegacyModelConfiguration(): ProviderConnectionRecord[] {
    const connections = this.listConnections();
    this.database.exec("DELETE FROM enabled_models; DELETE FROM provider_connections;");
    return connections;
  }

  listExperts(): ExpertDefinition[] {
    return this.database.prepare("SELECT document FROM experts ORDER BY updated_at DESC").all().flatMap((row) => {
      try { return [parseJson<ExpertDefinition>(asString((row as SqlRow).document))]; } catch { return []; }
    });
  }

  getExpert(id: string): ExpertDefinition | undefined {
    const row = this.database.prepare("SELECT document FROM experts WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) return undefined;
    try { return parseJson<ExpertDefinition>(asString(row.document)); } catch { return undefined; }
  }

  upsertExpert(expert: ExpertDefinition): void {
    this.database.prepare("INSERT INTO experts(id, version, document, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, document = excluded.document, updated_at = excluded.updated_at").run(expert.id, expert.version, JSON.stringify(expert), expert.updatedAt);
  }

  deleteExpert(id: string): void { this.database.prepare("DELETE FROM experts WHERE id = ?").run(id); }

  listExpertTeams(): ExpertTeamDefinition[] { return this.database.prepare("SELECT document FROM expert_teams ORDER BY updated_at DESC").all().flatMap((row) => { try { return [parseJson<ExpertTeamDefinition>(asString((row as SqlRow).document))]; } catch { return []; } }); }
  getExpertTeam(id: string): ExpertTeamDefinition | undefined { const row = this.database.prepare("SELECT document FROM expert_teams WHERE id = ?").get(id) as SqlRow | undefined; if (!row) return undefined; try { return parseJson<ExpertTeamDefinition>(asString(row.document)); } catch { return undefined; } }
  upsertExpertTeam(team: ExpertTeamDefinition): void { this.database.prepare("INSERT INTO expert_teams(id, version, document, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, document = excluded.document, updated_at = excluded.updated_at").run(team.id, team.version, JSON.stringify(team), team.updatedAt); }
  deleteExpertTeam(id: string): void { this.database.prepare("DELETE FROM expert_teams WHERE id = ?").run(id); }

  getSessionExpertSnapshot(sessionId: string): SessionExpertSnapshot | undefined {
    const row = this.database.prepare("SELECT document FROM session_expert_snapshots WHERE session_id = ?").get(sessionId) as SqlRow | undefined;
    if (!row) return undefined;
    try { return parseJson<SessionExpertSnapshot>(asString(row.document)); } catch { return undefined; }
  }

  saveSessionExpertSnapshot(sessionId: string, snapshot: SessionExpertSnapshot): void {
    this.database.prepare("INSERT INTO session_expert_snapshots(session_id, document) VALUES(?, ?) ON CONFLICT(session_id) DO UPDATE SET document = excluded.document").run(sessionId, JSON.stringify(snapshot));
  }
  deleteSessionExpertSnapshot(sessionId: string): void { this.database.prepare("DELETE FROM session_expert_snapshots WHERE session_id = ?").run(sessionId); }

  listAutomations(): AutomationTask[] {
    return this.database.prepare("SELECT document FROM automations ORDER BY updated_at DESC").all().flatMap((row): AutomationTask[] => {
      try { return [parseJson<AutomationTask>(asString((row as SqlRow).document))]; } catch { return []; }
    });
  }

  getAutomation(id: string): AutomationTask | undefined {
    const row = this.database.prepare("SELECT document FROM automations WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) return undefined;
    try { return parseJson<AutomationTask>(asString(row.document)); } catch { return undefined; }
  }

  upsertAutomation(task: AutomationTask): void {
    this.database.prepare(`INSERT INTO automations(id, name, enabled, next_run_at, document, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, enabled=excluded.enabled,
      next_run_at=excluded.next_run_at, document=excluded.document, updated_at=excluded.updated_at`)
      .run(task.id, task.name, task.enabled ? 1 : 0, task.nextRunAt, JSON.stringify(task), task.createdAt, task.updatedAt);
  }

  deleteAutomation(id: string): boolean {
    return this.database.prepare("DELETE FROM automations WHERE id = ?").run(id).changes > 0;
  }

  listAutomationRuns(limit = 200): AutomationRun[] {
    return this.database.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(limit, 1000))).flatMap((row): AutomationRun[] => {
      try { return [this.readAutomationRun(row as SqlRow)]; } catch { return []; }
    });
  }

  getAutomationRun(id: string): AutomationRun | undefined {
    const row = this.database.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) return undefined;
    try { return this.readAutomationRun(row); } catch { return undefined; }
  }

  insertAutomationRun(run: AutomationRun): boolean {
    return this.database.prepare(`INSERT OR IGNORE INTO automation_runs(id, automation_id, session_id, status, scheduled_for, document, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.automationId, run.sessionId, run.status, run.scheduledFor, JSON.stringify(run), run.createdAt, Date.now()).changes > 0;
  }

  updateAutomationRun(run: AutomationRun): void {
    this.database.prepare("UPDATE automation_runs SET session_id=?, status=?, document=?, updated_at=? WHERE id=?")
      .run(run.sessionId, run.status, JSON.stringify(run), Date.now(), run.id);
  }

  updateUnfinishedAutomationRuns(status: AutomationRunStatus): void {
    const rows = this.listAutomationRuns(1000).filter((run) => run.status === "queued" || run.status === "running" || run.status === "waiting");
    for (const run of rows) this.updateAutomationRun({ ...run, status, error: "Wordless exited before this run finished", completedAt: Date.now() });
  }

  deleteAutomationRun(id: string): AutomationRun | undefined {
    const run = this.getAutomationRun(id);
    if (run) this.database.prepare("DELETE FROM automation_runs WHERE id = ?").run(id);
    return run;
  }

  deleteAutomationRunsForSession(sessionId: string): void {
    this.database.prepare("DELETE FROM automation_runs WHERE session_id = ?").run(sessionId);
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL UNIQUE,
        availability TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace_id TEXT,
        runtime_root_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        model_connection_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        journal_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_projects(
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_projects_updated_at ON media_projects(updated_at DESC);
      CREATE TABLE IF NOT EXISTS provider_connections(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        base_url TEXT,
        api TEXT,
        auth_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS enabled_models(
        connection_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(connection_id, model_id)
      );
      INSERT OR IGNORE INTO migrations(version) VALUES(1);
    `);
    if (this.claimMigration(3)) {
      this.database.exec("ALTER TABLE sessions ADD COLUMN driver_id TEXT NOT NULL DEFAULT 'generic';");
      this.database.exec("ALTER TABLE sessions ADD COLUMN journal_format TEXT NOT NULL DEFAULT 'wordless-agent-v1';");
      this.database.exec("ALTER TABLE sessions ADD COLUMN workbench_id TEXT NOT NULL DEFAULT 'conversation';");
    }
    if (this.claimMigration(4)) this.database.exec("ALTER TABLE sessions ADD COLUMN pinned_at INTEGER;");
    if (this.claimMigration(5)) this.database.exec("ALTER TABLE sessions ADD COLUMN access_level TEXT NOT NULL DEFAULT 'default';");
    if (this.claimMigration(6)) this.database.exec("ALTER TABLE sessions ADD COLUMN connector_ids TEXT NOT NULL DEFAULT '[]';");
    if (this.claimMigration(7)) {
      this.database.exec(`
        CREATE TABLE usage_sources(
          source_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          source_kind TEXT NOT NULL,
          revision TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE usage_events(
          source_id TEXT NOT NULL REFERENCES usage_sources(source_id) ON DELETE CASCADE,
          event_id TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          model_kind TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          estimated_cost REAL NOT NULL,
          request_count INTEGER NOT NULL,
          usage_available INTEGER NOT NULL,
          unmetered_operation_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(source_id, event_id)
        );
        CREATE INDEX usage_events_occurred_at ON usage_events(occurred_at);
        CREATE INDEX usage_events_provider_time ON usage_events(provider_id, occurred_at);
        CREATE INDEX usage_events_model_time ON usage_events(provider_id, model_id, occurred_at);
      `);
    }
    if (this.claimMigration(8)) this.database.exec("ALTER TABLE sessions ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'default';");
    if (this.claimMigration(9)) this.database.exec("ALTER TABLE sessions ADD COLUMN tool_approval_mode TEXT NOT NULL DEFAULT 'manual';");
    if (this.claimMigration(10)) this.database.exec("ALTER TABLE sessions ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'medium';");
    if (this.claimMigration(11)) this.database.exec(`
      CREATE TABLE automations(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, next_run_at INTEGER,
        document TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX automations_due ON automations(enabled, next_run_at);
      CREATE TABLE automation_runs(
        id TEXT PRIMARY KEY, automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL,
        scheduled_for INTEGER NOT NULL, document TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(automation_id, scheduled_for)
      );
      CREATE INDEX automation_runs_task_time ON automation_runs(automation_id, created_at DESC);
      CREATE INDEX automation_runs_status ON automation_runs(status, created_at);
      CREATE INDEX automation_runs_session ON automation_runs(session_id);
    `);
    if (this.claimMigration(12)) this.database.exec("ALTER TABLE sessions ADD COLUMN expert_selection TEXT;");
    if (this.claimMigration(13)) this.database.exec("CREATE TABLE experts(id TEXT PRIMARY KEY, version TEXT NOT NULL, document TEXT NOT NULL, updated_at INTEGER NOT NULL);");
    if (this.claimMigration(14)) this.database.exec("CREATE TABLE session_expert_snapshots(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, document TEXT NOT NULL);");
    if (this.claimMigration(15)) this.database.exec("CREATE TABLE expert_teams(id TEXT PRIMARY KEY, version TEXT NOT NULL, document TEXT NOT NULL, updated_at INTEGER NOT NULL);");
  }

  private readWorkspace(row: SqlRow): WorkspaceRecord {
    return {
      id: asString(row.id),
      kind: asString(row.kind) as WorkspaceRecord["kind"],
      name: asString(row.name),
      rootPath: asString(row.root_path),
      canonicalRootPath: asString(row.canonical_root_path),
      availability: asString(row.availability) as WorkspaceRecord["availability"],
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
      lastOpenedAt: asNumber(row.last_opened_at),
    };
  }

  private readSession(row: SqlRow): SessionRecord {
    return {
      id: asString(row.id),
      title: asString(row.title),
      workspaceId: row.workspace_id === null ? null : asString(row.workspace_id),
      runtimeRootPath: asString(row.runtime_root_path),
      mode: asString(row.mode) as SessionRecord["mode"],
      entryId: asString(row.entry_id),
      profile: { id: asString(row.profile_id), version: asString(row.profile_version) },
      driverId: asString(row.driver_id) || "generic",
      journalFormat: (asString(row.journal_format) || "wordless-agent-v1") as SessionRecord["journalFormat"],
      workbenchId: (asString(row.workbench_id) || "conversation") as SessionRecord["workbenchId"],
      accessLevel: (asString(row.access_level) || "default") as SessionRecord["accessLevel"],
      model: { connectionId: asString(row.model_connection_id), modelId: asString(row.model_id) },
      journalPath: asString(row.journal_path),
      connectorIds: (() => {
        try {
          return asString(row.connector_ids) ? parseJson<unknown>(asString(row.connector_ids)) as unknown[] : [];
        } catch {
          return [];
        }
      })().filter((id): id is string => typeof id === "string"),
      interactionMode: (asString(row.interaction_mode) || "default") as SessionRecord["interactionMode"],
      toolApprovalMode: asString(row.tool_approval_mode) === "auto" ? "auto" : asString(row.tool_approval_mode) === "bypass" ? "bypass" : "manual",
      thinkingLevel: (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).includes(asString(row.thinking_level) as SessionRecord["thinkingLevel"])
        ? asString(row.thinking_level) as SessionRecord["thinkingLevel"]
        : "medium",
      pinnedAt: row.pinned_at === null || row.pinned_at === undefined ? null : asNumber(row.pinned_at),
      expertSelection: (() => {
        if (!row.expert_selection) return undefined;
        try {
          const value = parseJson<unknown>(asString(row.expert_selection));
          if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
          const candidate = value as Record<string, unknown>;
          return (candidate.kind === "expert" || candidate.kind === "team") && typeof candidate.id === "string" && typeof candidate.version === "string"
            ? { kind: candidate.kind, id: candidate.id, version: candidate.version }
            : undefined;
        } catch { return undefined; }
      })(),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    };
  }

  private readConnection(row: SqlRow): ProviderConnectionRecord {
    return {
      id: asString(row.id),
      kind: asString(row.kind) as ProviderConnectionRecord["kind"],
      providerId: asString(row.provider_id),
      avatarId: null,
      displayName: asString(row.display_name),
      baseUrl: row.base_url === null ? null : asString(row.base_url),
      api: row.api === null ? null : (asString(row.api) as ProviderConnectionRecord["api"]),
      authStatus: asString(row.auth_status) as ProviderConnectionRecord["authStatus"],
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    };
  }

  private readEnabledModel(row: SqlRow): EnabledModelRecord {
    return {
      connectionId: asString(row.connection_id),
      modelId: asString(row.model_id),
      displayName: asString(row.display_name),
      capabilities: parseJson<EnabledModelRecord["capabilities"]>(asString(row.capabilities)),
      enabled: asNumber(row.enabled) === 1,
      updatedAt: asNumber(row.updated_at),
    };
  }

  private readUsageSource(row: SqlRow): UsageSourceRecord {
    return {
      sourceId: asString(row.source_id),
      sessionId: asString(row.session_id),
      sourceKind: asString(row.source_kind) === "media" ? "media" : "journal",
      revision: asString(row.revision),
      updatedAt: asNumber(row.updated_at),
    };
  }

  private readUsageEvent(row: SqlRow): UsageEventRecord {
    return {
      sourceId: asString(row.source_id),
      eventId: asString(row.event_id),
      occurredAt: asNumber(row.occurred_at),
      providerId: asString(row.provider_id),
      modelId: asString(row.model_id),
      modelKind: asString(row.model_kind) === "image" ? "image" : "chat",
      inputTokens: asNumber(row.input_tokens),
      outputTokens: asNumber(row.output_tokens),
      cacheReadTokens: asNumber(row.cache_read_tokens),
      cacheWriteTokens: asNumber(row.cache_write_tokens),
      totalTokens: asNumber(row.total_tokens),
      estimatedCost: asNumber(row.estimated_cost),
      requestCount: asNumber(row.request_count),
      usageAvailable: asNumber(row.usage_available) === 1,
      unmeteredOperationCount: asNumber(row.unmetered_operation_count),
    };
  }

  private readAutomationRun(row: SqlRow): AutomationRun {
    const document = parseJson<AutomationRun>(asString(row.document));
    return {
      ...document,
      automationId: row.automation_id === null ? null : asString(row.automation_id),
      sessionId: row.session_id === null ? null : asString(row.session_id),
      status: asString(row.status) as AutomationRun["status"],
      scheduledFor: asNumber(row.scheduled_for),
      createdAt: asNumber(row.created_at),
    };
  }
}

export interface WordlessSessionMetadata extends SessionMetadata {
  cwd: string;
  path: string;
  metadata: Record<string, unknown>;
}

type JournalHeader = { type: "wordless.session"; metadata: WordlessSessionMetadata };
type JournalLeaf = { type: "wordless.leaf"; leafId: string | null };

function isJournalHeader(value: unknown): value is JournalHeader {
  return typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "wordless.session";
}

function isJournalLeaf(value: unknown): value is JournalLeaf {
  return typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "wordless.leaf";
}

export class WordlessJsonlSessionStorage implements SessionStorage<WordlessSessionMetadata> {
  private readonly metadata: WordlessSessionMetadata;
  private readonly entries = new Map<string, SessionTreeEntry>();
  private readonly order: string[] = [];
  private leafId: string | null = null;

  private constructor(metadata: WordlessSessionMetadata) {
    this.metadata = metadata;
  }

  static async create(metadata: WordlessSessionMetadata): Promise<WordlessJsonlSessionStorage> {
    await mkdir(dirname(metadata.path), { recursive: true });
    await writeFile(metadata.path, `${JSON.stringify({ type: "wordless.session", metadata } satisfies JournalHeader)}\n`, "utf8");
    return new WordlessJsonlSessionStorage(metadata);
  }

  static async open(path: string): Promise<WordlessJsonlSessionStorage> {
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const first = lines.shift();
    if (!first) throw new SessionError("invalid_session", `Missing session metadata: ${path}`);
    const header = parseJson<unknown>(first);
    if (!isJournalHeader(header)) throw new SessionError("invalid_session", `Invalid session metadata: ${path}`);
    const storage = new WordlessJsonlSessionStorage(header.metadata);
    for (const line of lines) {
      const parsed = parseJson<unknown>(line);
      if (isJournalLeaf(parsed)) {
        storage.leafId = parsed.leafId;
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && "id" in parsed && "parentId" in parsed && "type" in parsed) {
        const entry = parsed as SessionTreeEntry;
        storage.entries.set(entry.id, entry);
        storage.order.push(entry.id);
        storage.leafId = entry.id;
      }
    }
    return storage;
  }

  getMetadata(): Promise<WordlessSessionMetadata> {
    return Promise.resolve(this.metadata);
  }

  getLeafId(): Promise<string | null> {
    return Promise.resolve(this.leafId);
  }

  async setLeafId(leafId: string | null): Promise<void> {
    this.leafId = leafId;
    await appendFile(this.metadata.path, `${JSON.stringify({ type: "wordless.leaf", leafId } satisfies JournalLeaf)}\n`, "utf8");
  }

  createEntryId(): Promise<string> {
    return Promise.resolve(randomUUID());
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    this.order.push(entry.id);
    this.leafId = entry.id;
    await appendFile(this.metadata.path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return Promise.resolve(this.entries.get(id));
  }

  findEntries<TType extends SessionTreeEntry["type"]>(type: TType): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return Promise.resolve(
      this.order
        .map((id) => this.entries.get(id))
        .filter((entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry?.type === type),
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    let label: string | undefined;
    for (const entry of await this.getEntries()) {
      if (entry.type !== "label") continue;
      const candidate = entry as { targetId: string; label: string | undefined };
      if (candidate.targetId === id) label = candidate.label;
    }
    return label;
  }

  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    const path: SessionTreeEntry[] = [];
    let currentId = leafId;
    while (currentId) {
      const entry = this.entries.get(currentId);
      if (!entry) break;
      path.unshift(entry);
      currentId = entry.parentId;
    }
    return Promise.resolve(path);
  }

  getEntries(): Promise<SessionTreeEntry[]> {
    return Promise.resolve(this.order.map((id) => this.entries.get(id)).filter((entry): entry is SessionTreeEntry => entry !== undefined));
  }
}

export async function createWordlessSession(metadata: WordlessSessionMetadata): Promise<Session<WordlessSessionMetadata>> {
  return new Session(await WordlessJsonlSessionStorage.create(metadata));
}

export async function openWordlessSession(path: string): Promise<Session<WordlessSessionMetadata>> {
  return new Session(await WordlessJsonlSessionStorage.open(path));
}
