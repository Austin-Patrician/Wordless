import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DesktopHostEvent } from "@wordless/protocol";
import type { WordlessRuntime } from "@wordless/runtime";
import { CloudSyncService } from "../src/main/cloud-sync/cloud-sync-service.ts";
import type { GoogleDriveAppData } from "../src/main/cloud-sync/google-drive-app-data.ts";
import type { GoogleAccountService } from "../src/main/account/google-account-service.ts";

function runtimeFixture(): WordlessRuntime {
  const preferences = {
    locale: "zh-CN", theme: "system", fontScale: 1, reduceMotion: false,
    notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
    security: { customFileRules: [{ id: "private", label: "Home", pattern: "/Users/private/**" }], customCommandRules: [] },
    appearance: { background: { source: { kind: "none" }, fit: "cover", position: { x: 50, y: 50 }, intensity: 40, blurPx: 0 } },
    defaultWorkspaceRoot: "/Users/private/Wordless", defaultModel: null, entryModels: {},
  };
  return {
    getSnapshot: () => ({ preferences, modelConfiguration: {
      providers: [{ id: "custom", kind: "chat", source: "custom", displayName: "Custom", avatarId: null, baseUrl: "https://models.example", authStatus: "configured", enabledModelCount: 1, modelCount: 1, apiKeyConfigured: true, supportsOAuth: false, configuration: { name: "Custom", apiKey: "secret", headers: { Authorization: "Bearer secret" }, models: [{ id: "model", headers: { "X-Secret": "secret" } }] } }],
      models: [{ kind: "chat", providerId: "custom", providerAvatarId: null, modelId: "model", displayName: "Model", enabled: true, supportsVision: false, supportsReasoning: false, supportedThinkingLevels: ["off"], contextWindow: 1000, api: "openai-responses", imageCapabilities: null }], diagnostics: [],
    } }),
    setPreferences: () => undefined,
    saveProviderConfiguration: async () => undefined,
    setConfiguredModelEnabled: async () => undefined,
  } as unknown as WordlessRuntime;
}

test("cloud sync is opt-in and excludes credentials and machine paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-cloud-sync-"));
  const uploaded: unknown[] = [];
  let authorized = false;
  const account = { getSnapshot: () => ({ status: "signed-in", email: "user@example.com" }), authorizeDriveAppData: async () => { authorized = true; } } as unknown as GoogleAccountService;
  const drive = {
    list: async () => [],
    write: async (name: string, value: unknown) => { uploaded.push({ name, value }); return { id: name, name, modifiedTime: new Date().toISOString(), version: "1" }; },
  } as unknown as GoogleDriveAppData;
  const events: DesktopHostEvent[] = [];
  const service = new CloudSyncService({ statePath: join(root, "state.json"), runtime: runtimeFixture(), account, drive, send: (event) => events.push(event) });
  try {
    await service.initialize();
    assert.equal(service.getSnapshot().enabled, false);
    assert.equal(uploaded.length, 0);
    const snapshot = await service.enable("merge");
    assert.equal(authorized, true);
    assert.equal(snapshot.status, "synced");
    const serialized = JSON.stringify(uploaded);
    assert.doesNotMatch(serialized, /secret|\/Users\/private/);
    assert.doesNotMatch(serialized, /customFileRules|defaultWorkspaceRoot/);
    assert.match(serialized, /wordless-preferences-v1/);
    assert.match(serialized, /wordless-model-catalog-v1/);
    assert.equal(events.at(-1)?.type, "cloud-sync.changed");
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud failures remain contained in sync status", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-cloud-failure-"));
  const account = { getSnapshot: () => ({ status: "signed-in", email: "user@example.com" }), authorizeDriveAppData: async () => undefined } as unknown as GoogleAccountService;
  const drive = { list: async () => { throw new TypeError("fetch failed"); } } as unknown as GoogleDriveAppData;
  const service = new CloudSyncService({ statePath: join(root, "state.json"), runtime: runtimeFixture(), account, drive, send: () => undefined });
  try {
    await service.initialize();
    const snapshot = await service.enable("merge");
    assert.equal(snapshot.status, "offline");
    assert.equal(snapshot.enabled, true);
    assert.match(snapshot.lastError ?? "", /fetch failed/);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
