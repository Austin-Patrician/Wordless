import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultWebhookConfigPath, loadWebhookConfig, saveWebhookConfig } from "../src/main/notifications/webhook/config-store.ts";
import {
  deleteSecret,
  maskWebhookUrl,
  readSecret,
  writeSecret,
  type WebhookSecretStore,
} from "../src/main/notifications/webhook/credential-store.ts";

/**
 * A userData-shaped directory. The `notifications` subdirectory is created here
 * because some tests write a file by hand without going through save, which is
 * what creates it in production.
 */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "wordless-webhook-"));
  await mkdir(path.join(dir, "notifications"), { recursive: true });
  return dir;
}

class FakeVault implements WebhookSecretStore {
  readonly values = new Map<string, string>();
  failOnRead = false;
  async delete(id: string): Promise<void> {
    this.values.delete(id);
  }
  async read(id: string): Promise<string | undefined> {
    if (this.failOnRead) throw new Error("keychain unavailable");
    return this.values.get(id);
  }
  async write(id: string, value: string): Promise<void> {
    this.values.set(id, value);
  }
}

test("a missing config file reads as nothing configured", async () => {
  const dir = await tempDir();
  assert.deepEqual(await loadWebhookConfig(defaultWebhookConfigPath(dir)), []);
});

test("an unreadable config file degrades instead of throwing", async () => {
  const dir = await tempDir();
  const file = defaultWebhookConfigPath(dir);
  await saveWebhookConfig(file, []);
  // A truncated or hand-edited file must not be able to block the window.
  await writeFile(file, "{ not json", "utf8");
  assert.deepEqual(await loadWebhookConfig(file), []);

  await writeFile(file, JSON.stringify({ version: 1, endpoints: "nope" }), "utf8");
  assert.deepEqual(await loadWebhookConfig(file), []);
});

test("unsalvageable rows are dropped, salvageable ones are repaired", async () => {
  const dir = await tempDir();
  const file = defaultWebhookConfigPath(dir);
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      endpoints: [
        { kind: "feishu", name: "no id" },
        { id: "a", name: "no kind" },
        null,
        "nope",
        // Kept, with the name and options repaired.
        { id: "b", kind: "feishu", name: "   ", enabled: 1, options: "not an object" },
      ],
    }),
    "utf8",
  );

  const endpoints = await loadWebhookConfig(file);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].id, "b");
  assert.equal(endpoints[0].name, "未命名");
  assert.equal(endpoints[0].enabled, true);
  assert.deepEqual(endpoints[0].options, {});
  assert.equal(endpoints[0].hasSignSecret, false);
});

test("saving writes a versioned file that reads back identically", async () => {
  const dir = await tempDir();
  const file = defaultWebhookConfigPath(dir);
  const endpoint = {
    id: "b",
    kind: "feishu" as const,
    name: "Release group",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasSignSecret: true,
    options: { mentionAll: true },
  };
  await saveWebhookConfig(file, [endpoint]);

  const raw = JSON.parse(await readFile(file, "utf8")) as { version: number; endpoints: unknown[] };
  assert.equal(raw.version, 1);
  assert.deepEqual(await loadWebhookConfig(file), [endpoint]);
});

test("the secret store round-trips and never leaks a shape it cannot read", async () => {
  const vault = new FakeVault();
  await writeSecret(vault, "id-1", { url: "https://example.com/hook/abcdefgh", signSecret: "s" });
  assert.deepEqual(await readSecret(vault, "id-1"), { url: "https://example.com/hook/abcdefgh", signSecret: "s" });

  // An empty secret is stored as absent, so `hasSignSecret` stays false.
  await writeSecret(vault, "id-2", { url: "https://example.com/hook/abcdefgh", signSecret: "" });
  assert.deepEqual(await readSecret(vault, "id-2"), { url: "https://example.com/hook/abcdefgh" });

  await deleteSecret(vault, "id-1");
  assert.equal(await readSecret(vault, "id-1"), undefined);

  // Anything unreadable is treated as absent: the row then asks for credentials
  // again instead of breaking the whole list.
  vault.values.set("webhook:id-3", "not json");
  assert.equal(await readSecret(vault, "id-3"), undefined);
  vault.values.set("webhook:id-4", JSON.stringify({ signSecret: "s" }));
  assert.equal(await readSecret(vault, "id-4"), undefined);
});

test("the URL mask keeps the host and the last four characters only", () => {
  assert.equal(maskWebhookUrl("https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d"), "https://open.feishu.cn/…1c2d");
  // A malformed URL still yields something a user can tell apart.
  assert.equal(maskWebhookUrl("garbage"), "…bage");
  assert.equal(maskWebhookUrl(""), "…");
});
