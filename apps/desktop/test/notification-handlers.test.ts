import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createNotificationHandlers } from "../src/main/notifications/webhook/handlers.ts";
import { WebhookManager } from "../src/main/notifications/webhook/manager.ts";
import type { WebhookSecretStore } from "../src/main/notifications/webhook/credential-store.ts";

/**
 * The IPC boundary between the preload and the host.
 *
 * This file exists because of a shipped bug: `update` sent `{ id, ...patch }`
 * while the host validated the payload against the *patch* schema, which has
 * `additionalProperties: false` and so rejected `id`. Every update call failed.
 *
 * Neither existing suite could see it — the manager tests call `manager.update`
 * directly, and the renderer tests mock the client — so the boundary had no
 * coverage at all. The envelopes below mirror `src/preload/index.ts`; the
 * `satisfies` annotations there now make a shape change a compile error, and these
 * cases make a schema change fail at runtime.
 *
 * A coordinated change to *both* sides is still only caught by review, which is
 * why the preload builds its envelopes from the same DTOs this file validates.
 */

const VALID_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d";

class FakeVault implements WebhookSecretStore {
  readonly values = new Map<string, string>();
  async delete(id: string): Promise<void> {
    this.values.delete(id);
  }
  async read(id: string): Promise<string | undefined> {
    return this.values.get(id);
  }
  async write(id: string, value: string): Promise<void> {
    this.values.set(id, value);
  }
}

async function makeHandlers() {
  const dir = await mkdtemp(path.join(tmpdir(), "wordless-webhook-ipc-"));
  const manager = new WebhookManager({ userDataPath: dir, secrets: new FakeVault() });
  await manager.reload();
  return { manager, handlers: createNotificationHandlers(manager) };
}

const CREATE_PAYLOAD = {
  kind: "feishu" as const,
  name: "Release group",
  url: VALID_URL,
  signSecret: "s3cret",
  enabled: true,
  options: {},
};

test("the update envelope the preload sends is accepted and applied", async () => {
  const { manager, handlers } = await makeHandlers();
  const created = await handlers.create(CREATE_PAYLOAD);
  assert.equal(created.ok, true);
  const id = created.ok ? created.endpoint.id : "";

  // Exactly what `src/preload/index.ts` puts on the wire.
  const result = await handlers.update({ id, patch: { name: "Renamed", enabled: false, options: {} } });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.endpoint.name, "Renamed");
  assert.equal(result.ok && result.endpoint.enabled, false);
  assert.equal(manager.list()[0].name, "Renamed");
});

test("an update without its id is refused instead of silently applying to nothing", async () => {
  const { handlers } = await makeHandlers();
  // The shape that broke: the patch alone, with the id lost. Failing loudly is the
  // point — a normalised-away id would look like a save that did nothing.
  await assert.rejects(async () => await handlers.update({ name: "Renamed" }), /Invalid request payload/);
  await assert.rejects(async () => await handlers.update(undefined), /Invalid request payload/);
  await assert.rejects(async () => await handlers.update({ id: "x" }), /Invalid request payload/);
});

test("payload-taking handlers reject an unknown field", async () => {
  const { handlers } = await makeHandlers();
  const created = await handlers.create(CREATE_PAYLOAD);
  const id = created.ok ? created.endpoint.id : "";

  // A typo in the renderer has to be loud: dropping the field silently would turn
  // it into a setting that never applies.
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["create", async () => await handlers.create({ ...CREATE_PAYLOAD, nmae: "typo" })],
    ["update", async () => await handlers.update({ id, patch: { name: "a", enabld: true } })],
    ["update envelope", async () => await handlers.update({ id, patch: { name: "a" }, extra: 1 })],
    ["set-enabled", async () => await handlers.setEnabled({ id, enabled: true, extra: 1 })],
    ["delete", async () => await handlers.delete({ id, extra: 1 })],
    ["test", async () => await handlers.test({ id, message: { text: "x" }, extra: 1 })],
  ];
  for (const [label, run] of cases) {
    await assert.rejects(run, /Invalid request payload/, label);
  }

  // The two payload-free handlers ignore arguments entirely, so a stray one
  // cannot make them fail.
  assert.deepEqual(await handlers.list(), [created.endpoint]);
  assert.equal((await handlers.providers()).length, 3);
});

test("every channel runs against a real manager", async () => {
  const { manager, handlers } = await makeHandlers();

  assert.deepEqual(await handlers.list(), []);
  const descriptors = await handlers.providers();
  assert.deepEqual(descriptors.map((descriptor) => descriptor.kind).sort(), ["dingtalk", "feishu", "wecom"]);

  const created = await handlers.create(CREATE_PAYLOAD);
  assert.equal(created.ok, true);
  const id = created.ok ? created.endpoint.id : "";

  const disabled = await handlers.setEnabled({ id, enabled: false });
  assert.equal(disabled.ok && disabled.endpoint.enabled, false);

  await handlers.delete({ id });
  assert.deepEqual(await handlers.list(), []);
  assert.equal(manager.list().length, 0);
});

test("the test channel sends through the stored endpoint", async () => {
  const { handlers } = await makeHandlers();
  const created = await handlers.create(CREATE_PAYLOAD);
  const id = created.ok ? created.endpoint.id : "";

  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await handlers.test({
      id,
      message: { title: "Message push test", text: "A test message", level: "info" },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("a well-formed payload with a bad address returns a code, not a boundary error", async () => {
  const { handlers } = await makeHandlers();
  // Deliberately just inside the schema and wrong for the platform: the kind of
  // mistake a user makes, which must come back as a code the page can translate.
  const result = await handlers.create({ ...CREATE_PAYLOAD, url: "https://evil.example.com/hook/abcdefgh" });
  assert.equal(result.ok === false && result.code, "url-wrong-host");

  // Schema-level garbage throws instead, because that is a caller bug.
  await assert.rejects(async () => await handlers.create({ ...CREATE_PAYLOAD, url: "" }), /Invalid request payload/);
});
