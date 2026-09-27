import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebhookManager } from "../src/main/notifications/webhook/manager.ts";
import { defaultWebhookConfigPath } from "../src/main/notifications/webhook/config-store.ts";
import type { WebhookSecretStore } from "../src/main/notifications/webhook/credential-store.ts";

const VALID_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d";

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

async function makeManager() {
  const dir = await mkdtemp(path.join(tmpdir(), "wordless-webhook-mgr-"));
  const vault = new FakeVault();
  const manager = new WebhookManager({ userDataPath: dir, secrets: vault });
  await manager.reload();
  return { dir, vault, manager };
}

/** Stubs `fetch` for the duration of `body`, restoring it afterwards. */
async function withFetch(
  handler: (url: string) => Promise<Response> | Response,
  body: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => handler(String(input))) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

const okResponse = () => new Response(JSON.stringify({ code: 0 }), { status: 200 });

test("create validates through the provider and writes nothing when it fails", async () => {
  const { vault, manager } = await makeManager();
  const result = await manager.create({ kind: "feishu", name: "Group", url: "http://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh" });
  assert.equal(result.ok, false);
  // The scheme is the only thing wrong, so it gets its own code rather than a
  // generic "invalid address".
  assert.equal(result.ok === false && result.code, "url-http-not-allowed");
  assert.equal(vault.values.size, 0);
  assert.deepEqual(manager.list(), []);
});

test("create rejects a channel this build does not implement", async () => {
  const { manager } = await makeManager();
  // All three kinds the type names are implemented now, so the guard is exercised
  // with one the type does not name at all — which is what a config written by a
  // newer build would carry.
  const result = await manager.create({ kind: "telegram" as never, name: "Group", url: "https://example.com/hook" });
  assert.equal(result.ok === false && result.code, "unsupported-kind");
  assert.deepEqual(manager.list(), []);
});

const DINGTALK_URL = "https://oapi.dingtalk.com/robot/send?access_token=abc123def456";

test("the provider's options schema is enforced, not merely declared", async () => {
  const { manager } = await makeManager();
  // A key the schema forbids. The form cannot produce this, but a hand-edited config
  // file or a config written by a newer build can, and the platform would reject the
  // send long after anyone could connect it back to this.
  const unknown = await manager.create({ kind: "feishu", name: "A", url: VALID_URL, options: { nope: true } });
  assert.equal(unknown.ok === false && unknown.code, "options-invalid");

  // A wrong type, which is the same class of problem one level down.
  const mistyped = await manager.create({ kind: "dingtalk", name: "B", url: DINGTALK_URL, options: { keyword: 5 } });
  assert.equal(mistyped.ok === false && mistyped.code, "options-invalid");
  assert.match(mistyped.ok === false ? mistyped.detail ?? "" : "", /keyword/);

  assert.deepEqual(manager.list(), []);
});

test("options this channel cannot send are dropped on load, so the row stays editable", async () => {
  const { dir, vault, manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "A", url: VALID_URL });
  assert.equal(created.ok, true);
  const id = created.ok ? created.endpoint.id : "";

  // What a hand edit or a newer build could leave behind: one key this channel does
  // not declare at all, and one declared but of the wrong type.
  const configPath = defaultWebhookConfigPath(dir);
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
    version: number;
    endpoints: Array<Record<string, unknown>>;
  };
  parsed.endpoints[0].options = { mentionAll: true, keyword: "报警", atMobiles: "13800000000" };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(configPath, JSON.stringify(parsed), "utf8");

  const reloaded = new WebhookManager({ userDataPath: dir, secrets: vault });
  await reloaded.reload();
  const [endpoint] = reloaded.list();
  // The declared-and-valid key survives; the two it cannot send are dropped, one at
  // a time — a bad entry costs that entry rather than the whole blob.
  assert.deepEqual(endpoint.options, { mentionAll: true });
  // The row itself is kept: it can still send, so dropping it would be the wrong
  // repair.
  assert.equal(endpoint.name, "A");

  // The reason the repair exists: the row can be saved again. Left alone, the form
  // would write those keys straight back and the save would fail with
  // "options-invalid" — an error pointing at an option the user never set.
  const updated = await reloaded.update(id, { name: "B" });
  assert.equal(updated.ok, true);
});

test("a channel that declares no options keeps none of them", async () => {
  const { dir, vault, manager } = await makeManager();
  const created = await manager.create({
    kind: "wecom",
    name: "A",
    url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc12345",
  });
  assert.equal(created.ok, true);

  const configPath = defaultWebhookConfigPath(dir);
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
    version: number;
    endpoints: Array<Record<string, unknown>>;
  };
  parsed.endpoints[0].options = { mentionAll: true };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(configPath, JSON.stringify(parsed), "utf8");

  const reloaded = new WebhookManager({ userDataPath: dir, secrets: vault });
  await reloaded.reload();
  // WeCom's markdown cannot mention anyone, so the key is not merely unused here — it
  // is one it cannot send, and it goes.
  assert.deepEqual(reloaded.list()[0].options, {});
});

test("an option belonging to another channel is refused rather than smuggled through", async () => {
  const { manager } = await makeManager();
  // This is what a kind switch used to do: options carried across, so DingTalk's
  // `keyword` arrived on a Feishu endpoint as an unknown key. The dialog now clears
  // options when the kind changes; this proves the host would have caught it anyway.
  const carried = await manager.create({
    kind: "feishu",
    name: "A",
    url: VALID_URL,
    options: { keyword: "报警", atMobiles: ["13800000000"] },
  });
  assert.equal(carried.ok === false && carried.code, "options-invalid");
  assert.deepEqual(manager.list(), []);
});

test("a well-formed options blob is accepted and round-trips", async () => {
  const { manager } = await makeManager();
  const options = { keyword: "报警", atMobiles: ["13800000000", "13900000000"], mentionAll: true };
  const created = await manager.create({ kind: "dingtalk", name: "A", url: DINGTALK_URL, options });
  assert.equal(created.ok, true);
  assert.deepEqual(created.ok ? created.endpoint.options : null, options);

  // An update that leaves options alone must not trip the check either.
  const updated = await manager.update(created.ok ? created.endpoint.id : "", { name: "B" });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.ok ? updated.endpoint.options : null, options);
});

test("the listed endpoint carries a mask and a flag, never the credential", async () => {
  const { manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Release group", url: VALID_URL, signSecret: "s3cret" });
  assert.equal(created.ok, true);

  const [endpoint] = manager.list();
  assert.equal(endpoint.name, "Release group");
  assert.equal(endpoint.urlMask, "https://open.feishu.cn/…1c2d");
  assert.equal(endpoint.hasSignSecret, true);
  // Nothing shaped like a credential may appear in the public view — this is what
  // the settings page, the logs and (later) the agent context all receive.
  const serialized = JSON.stringify(endpoint);
  assert.ok(!serialized.includes(VALID_URL), "the raw URL leaked into the public view");
  assert.ok(!serialized.includes("s3cret"), "the sign secret leaked into the public view");
});

test("the stored file holds no credential and no derived field", async () => {
  const { dir, manager } = await makeManager();
  await manager.create({ kind: "feishu", name: "Group", url: VALID_URL, signSecret: "s3cret" });

  const raw = await readFile(defaultWebhookConfigPath(dir), "utf8");
  assert.ok(!raw.includes(VALID_URL));
  assert.ok(!raw.includes("s3cret"));
  // Derived fields are recomputed from the vault on load; persisting them would
  // leave a stale mask behind after a credential rotation.
  assert.ok(!raw.includes("urlMask"));
  assert.ok(!raw.includes("hasSignSecret"));
});

test("reload drops rows whose credentials are gone and channels we cannot send", async () => {
  const { dir, vault, manager } = await makeManager();
  await manager.create({ kind: "feishu", name: "Kept", url: VALID_URL });
  const [kept] = manager.list();

  const configPath = defaultWebhookConfigPath(dir);
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as { version: number; endpoints: unknown[] };
  // A config that outlived its vault entry: nothing to send with.
  parsed.endpoints.push({ ...kept, id: "orphan", name: "Orphan" });
  // A channel named by a newer build. It *has* credentials, so the only reason to
  // drop it is that this build cannot send through it — which is what makes this
  // case cover the kind filter rather than repeating the credentials one.
  parsed.endpoints.push({ ...kept, id: "future", name: "Future", kind: "telegram" });
  await vault.write("webhook:future", JSON.stringify({ url: VALID_URL }));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(configPath, JSON.stringify(parsed), "utf8");

  const reloaded = new WebhookManager({ userDataPath: dir, secrets: vault });
  await reloaded.reload();
  assert.deepEqual(
    reloaded.list().map((endpoint) => endpoint.name),
    ["Kept"],
  );
  // Guard against this case silently degrading into a duplicate of the credentials
  // one: the unsupported row really does have credentials.
  assert.ok(vault.values.has("webhook:future"));
});

test("an unavailable keychain empties the list instead of throwing", async () => {
  const { vault, manager } = await makeManager();
  await manager.create({ kind: "feishu", name: "Group", url: VALID_URL });
  vault.failOnRead = true;
  await manager.reload();
  assert.deepEqual(manager.list(), []);
});

test("update keeps what it is not told about and clears on an explicit empty string", async () => {
  const { manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Group", url: VALID_URL, signSecret: "s3cret" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.endpoint.id : "";

  // Renaming alone must not require the credential to travel back down.
  const renamed = await manager.update(id, { name: "Renamed" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.ok && renamed.endpoint.hasSignSecret, true);
  assert.equal(renamed.ok && renamed.endpoint.urlMask, "https://open.feishu.cn/…1c2d");

  // An explicit empty string is how the user clears it.
  const cleared = await manager.update(id, { signSecret: "" });
  assert.equal(cleared.ok && cleared.endpoint.hasSignSecret, false);

  const rejected = await manager.update(id, { url: "https://evil.example.com/hook/abcdefgh" });
  assert.equal(rejected.ok === false && rejected.code, "url-wrong-host");
});

test("update and delete report a row that is no longer there", async () => {
  const { manager } = await makeManager();
  const updated = await manager.update("missing", { name: "x" });
  assert.equal(updated.ok === false && updated.code, "endpoint-not-found");
  assert.equal(await manager.delete("missing"), false);
});

test("enabling and disabling is a normal update", async () => {
  const { manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Group", url: VALID_URL });
  const id = created.ok ? created.endpoint.id : "";

  const off = await manager.setEnabled(id, false);
  assert.equal(off.ok && off.endpoint.enabled, false);
  assert.equal(manager.list()[0].enabled, false);
});

test("send reports a broken channel as a typed failure rather than throwing", async () => {
  const { vault, manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Group", url: VALID_URL });
  const id = created.ok ? created.endpoint.id : "";

  const missing = await manager.send("nope", { text: "x" });
  assert.equal(missing.ok === false && missing.code, "credentials-missing");

  vault.failOnRead = true;
  const unreadable = await manager.send(id, { text: "x" });
  assert.equal(unreadable.ok === false && unreadable.code, "credentials-missing");
});

test("broadcast skips disabled channels, honours onlyIds, and reports partial failure", async () => {
  const { manager } = await makeManager();
  const first = await manager.create({ kind: "feishu", name: "First", url: VALID_URL });
  const second = await manager.create({ kind: "feishu", name: "Second", url: VALID_URL });
  const third = await manager.create({ kind: "feishu", name: "Third", url: VALID_URL });
  const firstId = first.ok ? first.endpoint.id : "";
  const secondId = second.ok ? second.endpoint.id : "";
  const thirdId = third.ok ? third.endpoint.id : "";
  await manager.setEnabled(thirdId, false);

  // First succeeds, second is rejected by the platform.
  let call = 0;
  await withFetch(
    () => {
      call += 1;
      return call === 1 ? okResponse() : new Response(JSON.stringify({ code: 19024, msg: "no" }), { status: 200 });
    },
    async () => {
      const results = await manager.broadcast({ text: "done" }, { onlyIds: [firstId, secondId, thirdId] });
      // The disabled one is not a target at all.
      assert.equal(results.length, 2);
      assert.deepEqual(
        results.map((result) => [result.name, result.ok]),
        [
          ["First", true],
          ["Second", false],
        ],
      );
      assert.equal(results[1].code, "platform-rejected");
    },
  );

  // includeDisabled is what the test button uses.
  await withFetch(
    () => okResponse(),
    async () => {
      const results = await manager.broadcast({ text: "done" }, { includeDisabled: true });
      assert.equal(results.length, 3);
    },
  );
});

test("a duplicated endpoint id is dispatched once", async () => {
  const { manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Solo", url: VALID_URL });
  const id = created.ok ? created.endpoint.id : "";

  let sends = 0;
  await withFetch(
    () => {
      sends += 1;
      return okResponse();
    },
    async () => {
      await manager.broadcast({ text: "done" }, { onlyIds: [id, id, id] });
      assert.equal(sends, 1);
    },
  );
});

test("delete removes both the row and its credential", async () => {
  const { dir, vault, manager } = await makeManager();
  const created = await manager.create({ kind: "feishu", name: "Group", url: VALID_URL });
  const id = created.ok ? created.endpoint.id : "";

  assert.equal(await manager.delete(id), true);
  assert.deepEqual(manager.list(), []);
  assert.equal(vault.values.size, 0);
  assert.deepEqual(JSON.parse(await readFile(defaultWebhookConfigPath(dir), "utf8")).endpoints, []);
});

test("provider descriptors are exposed for the form to render from", async () => {
  const { manager } = await makeManager();
  const descriptors = manager.listProviderDescriptors();
  assert.deepEqual(descriptors.map((descriptor) => descriptor.kind).sort(), ["dingtalk", "feishu", "wecom"]);
  // The form renders fields and toggles from these, so the differences the platforms
  // actually have must be visible here.
  const feishu = descriptors.find((descriptor) => descriptor.kind === "feishu");
  const wecom = descriptors.find((descriptor) => descriptor.kind === "wecom");
  assert.equal(feishu?.capabilities.supportsSign, true);
  assert.equal(wecom?.capabilities.supportsSign, false);
  // No signature means no secret field is offered.
  assert.deepEqual(wecom?.credentialFields.map((field) => field.key), ["url"]);
  // Only DingTalk documents its limit in characters.
  assert.equal(descriptors.filter((descriptor) => descriptor.capabilities.maxTextChars !== undefined).length, 1);
});
