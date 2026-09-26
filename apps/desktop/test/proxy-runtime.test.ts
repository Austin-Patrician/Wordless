import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROXY_CONFIG } from "../src/main/proxy/proxy-settings.ts";
import {
  applyDesktopProxy,
  applyProxyEnv,
  isProxyFault,
  NO_PROXY_HOSTS,
  restoreProxyEnv,
} from "../src/main/proxy/proxy-runtime.ts";

const ON = { ...DEFAULT_PROXY_CONFIG, enabled: true, host: "127.0.0.1", port: 7890 };

function deps(env: NodeJS.ProcessEnv) {
  const sessions: Array<string | undefined> = [];
  let dispatchers = 0;
  return {
    env,
    sessions,
    get dispatchers() {
      return dispatchers;
    },
    configureSessions: async (proxyRules: string | undefined) => {
      sessions.push(proxyRules);
    },
    configureDispatcher: async () => {
      dispatchers += 1;
    },
  };
}

test("writes both cases plus the loopback exemption", () => {
  const env: NodeJS.ProcessEnv = {};
  applyProxyEnv(env, "http://127.0.0.1:7890");

  // curl ignores uppercase HTTP_PROXY by design, so the lowercase one is what
  // makes `curl http://…` and `git clone http://…` actually use the proxy.
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(env.http_proxy, "http://127.0.0.1:7890");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(env.https_proxy, "http://127.0.0.1:7890");
  assert.equal(env.ALL_PROXY, "http://127.0.0.1:7890");
  assert.equal(env.all_proxy, "http://127.0.0.1:7890");
  assert.equal(env.NO_PROXY, NO_PROXY_HOSTS);
  assert.equal(env.no_proxy, NO_PROXY_HOSTS);
  assert.match(NO_PROXY_HOSTS, /127\.0\.0\.1/);
});

test("keeps loopback and private ranges out of the proxy", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "10.0.0.0/8", "192.168.0.0/16", "*.local"]) {
    assert.ok(NO_PROXY_HOSTS.includes(host), host);
  }
});

test("restores what the process inherited rather than deleting it", () => {
  const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://corp:3128", no_proxy: "example.com" };
  applyProxyEnv(env, "http://127.0.0.1:7890");
  restoreProxyEnv(env);

  // The user's own proxy must come back: deleting it would silently remove a
  // proxy they had before ever opening this settings page.
  assert.equal(env.HTTPS_PROXY, "http://corp:3128");
  assert.equal(env.no_proxy, "example.com");
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
});

test("re-enabling after a restore does not accumulate a baseline", () => {
  const env: NodeJS.ProcessEnv = {};
  applyProxyEnv(env, "http://a:1");
  restoreProxyEnv(env);
  applyProxyEnv(env, "http://b:2");
  restoreProxyEnv(env);
  assert.equal(env.HTTP_PROXY, undefined);
});

test("a disabled config goes direct and clears the previous proxy", async () => {
  const env: NodeJS.ProcessEnv = {};
  applyProxyEnv(env, "http://127.0.0.1:7890");
  const d = deps(env);

  const active = await applyDesktopProxy({ ...ON, enabled: false }, d);

  assert.deepEqual(active, { source: "direct", invalid: false });
  assert.equal(env.HTTP_PROXY, undefined);
  assert.deepEqual(d.sessions, [undefined]);
});

test("an enabled config is applied to the environment and the sessions", async () => {
  const env: NodeJS.ProcessEnv = {};
  const d = deps(env);

  const active = await applyDesktopProxy(ON, d);

  assert.deepEqual(active, { source: "application", target: "127.0.0.1:7890", invalid: false });
  assert.equal(env.http_proxy, "http://127.0.0.1:7890");
  assert.deepEqual(d.sessions, ["http://127.0.0.1:7890"]);
});

test("an unusable config is reported invalid and leaves nothing behind", async () => {
  const env: NodeJS.ProcessEnv = {};
  applyProxyEnv(env, "http://stale:1");
  const d = deps(env);

  const active = await applyDesktopProxy({ ...ON, port: 99_999 }, d);

  assert.deepEqual(active, { source: "application", invalid: true });
  // The stale proxy must not survive: that would send traffic to a host the user
  // already replaced.
  assert.equal(env.HTTP_PROXY, undefined);
  assert.deepEqual(d.sessions, [undefined]);
});

test("credentials never reach the reported target", async () => {
  const env: NodeJS.ProcessEnv = {};
  const active = await applyDesktopProxy({ ...ON, username: "u", password: "hunter2" }, deps(env));

  assert.equal(active.target, "127.0.0.1:7890");
  assert.equal(JSON.stringify(active).includes("hunter2"), false);
  assert.equal(env.http_proxy?.includes("hunter2"), true);
});

test("the dispatcher is rebuilt on every apply so it picks up the new environment", async () => {
  const d = deps({});
  await applyDesktopProxy(ON, d);
  await applyDesktopProxy({ ...ON, enabled: false }, d);
  assert.equal(d.dispatchers, 2);
});

test("only an enabled-but-unusable config counts as a proxy fault", () => {
  assert.equal(isProxyFault(undefined), false);
  assert.equal(isProxyFault({ ...ON, enabled: false }), false);
  assert.equal(isProxyFault(ON), false);
  assert.equal(isProxyFault({ ...ON, host: "" }), true);
  assert.equal(isProxyFault({ ...ON, port: 0 }), true, "a bad port is a proxy fault");
});
