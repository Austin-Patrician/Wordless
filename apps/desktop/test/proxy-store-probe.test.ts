import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DesktopProxyStore } from "../src/main/proxy/proxy-store.ts";
import {
  findLocalProxy,
  LOCAL_PROXY_CANDIDATES,
  proxyUrlFor,
  testProxy,
  type ProxyProbe,
} from "../src/main/proxy/proxy-probe.ts";
import { DEFAULT_PROXY_CONFIG } from "../src/main/proxy/proxy-settings.ts";

/** In-memory stand-in for the keychain-backed vault. */
function fakeSecrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    delete: async (id: string) => void values.delete(id),
    read: async (id: string) => values.get(id),
    write: async (id: string, value: string) => void values.set(id, value),
  };
}

async function withStore(run: (store: DesktopProxyStore, dir: string, secrets: ReturnType<typeof fakeSecrets>) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "wordless-proxy-"));
  const secrets = fakeSecrets();
  try {
    await run(new DesktopProxyStore(dir, secrets), dir, secrets);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ON = { ...DEFAULT_PROXY_CONFIG, enabled: true, host: "127.0.0.1", port: 7890 };

test("a missing config file reads as no proxy", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.read(), DEFAULT_PROXY_CONFIG);
  });
});

test("an unreadable config file reads as no proxy rather than throwing", async () => {
  await withStore(async (store, dir) => {
    await writeFile(path.join(dir, "proxy.json"), "{ this is not json", "utf8");
    assert.deepEqual(await store.read(), DEFAULT_PROXY_CONFIG);
  });
});

test("the password goes to the secret store, never into the config file", async () => {
  await withStore(async (store, dir, secrets) => {
    await store.write({ ...ON, username: "u", password: "hunter2" });

    const onDisk = await readFile(path.join(dir, "proxy.json"), "utf8");
    assert.equal(onDisk.includes("hunter2"), false);
    assert.equal(onDisk.includes("password"), false);
    assert.equal(secrets.values.get("proxy-password"), "hunter2");
  });
});

test("round-trips a config including its password", async () => {
  await withStore(async (store) => {
    const written = await store.write({ ...ON, username: "u", password: "hunter2" });
    assert.deepEqual(await store.read(), written);
    assert.equal((await store.read()).password, "hunter2");
  });
});

test("clearing the password removes it from the secret store", async () => {
  await withStore(async (store, _dir, secrets) => {
    await store.write({ ...ON, password: "hunter2" });
    await store.write({ ...ON, password: "" });
    assert.equal(secrets.values.has("proxy-password"), false);
    assert.equal((await store.read()).password, "");
  });
});

test("a stored config with junk fields is normalised on read", async () => {
  await withStore(async (store, dir) => {
    await writeFile(
      path.join(dir, "proxy.json"),
      JSON.stringify({ enabled: true, host: "127.0.0.1", port: "7890", protocol: "socks5", extra: 1 }),
      "utf8",
    );
    const config = await store.read();
    assert.equal(config.port, 7890);
    assert.equal(config.protocol, "http");
  });
});

// --- probe selection -------------------------------------------------------

const always = (ok: boolean): ProxyProbe => async () => ok;

test("the candidate list is loopback only", () => {
  for (const candidate of LOCAL_PROXY_CANDIDATES) {
    assert.equal(candidate.host, "127.0.0.1");
    assert.ok(candidate.port > 0 && candidate.port < 65_536);
  }
});

test("returns the first address that answers", async () => {
  const seen: string[] = [];
  const probe: ProxyProbe = async (url) => {
    seen.push(url);
    return url.endsWith(":7897");
  };

  assert.deepEqual(await findLocalProxy(probe), { host: "127.0.0.1", port: 7897 });
  // Stops at the first hit: probing the rest would be pointless traffic.
  assert.deepEqual(seen, ["http://127.0.0.1:7890", "http://127.0.0.1:7897"]);
});

test("returns nothing when no address answers", async () => {
  assert.equal(await findLocalProxy(always(false)), undefined);
});

test("a probe that throws is treated as a miss, not a crash", async () => {
  const probe: ProxyProbe = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await findLocalProxy(probe), undefined);
});

test("testing an address reports success only when it answers", async () => {
  assert.deepEqual(await testProxy("http://127.0.0.1:7890", always(true)), { ok: true });
  // The probe resolves false instead of throwing, so a naive `await` would have
  // reported success here.
  assert.deepEqual(await testProxy("http://127.0.0.1:7890", always(false)), {
    ok: false,
    reason: "unreachable",
  });
});

test("proxy urls are credential-free loopback urls", () => {
  assert.equal(proxyUrlFor({ host: "127.0.0.1", port: 7890 }), "http://127.0.0.1:7890");
});
