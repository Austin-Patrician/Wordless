import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROXY_CONFIG,
  isProxyProtocol,
  mergeProxyConfigPatch,
  normalizeProxyConfig,
  proxyTarget,
  redactProxyConfig,
  resolveProxyConfig,
} from "../src/main/proxy/proxy-settings.ts";

const ON = { enabled: true, host: "127.0.0.1", port: 7890 };

test("falls back to the disabled default for junk input", () => {
  for (const value of [null, undefined, 42, "nope", []]) {
    assert.deepEqual(normalizeProxyConfig(value), DEFAULT_PROXY_CONFIG);
  }
});

test("accepts a numeric string port so a text input round-trips", () => {
  assert.equal(normalizeProxyConfig({ port: "1080" }).port, 1080);
  assert.equal(normalizeProxyConfig({ port: "" }).port, DEFAULT_PROXY_CONFIG.port);
});

test("keeps an out-of-range port instead of clamping it", () => {
  // Clamping would turn "you typed the wrong port" into "you are connected to
  // a different port"; resolveProxyConfig reports it instead.
  assert.equal(normalizeProxyConfig({ port: 99_999 }).port, 99_999);
  assert.equal(normalizeProxyConfig({ port: 0 }).port, 0);
  assert.equal(resolveProxyConfig({ ...DEFAULT_PROXY_CONFIG, ...ON, port: 99_999 }).ok, false);
});

test("rejects a protocol the transport cannot use", () => {
  assert.equal(isProxyProtocol("socks5"), false);
  assert.equal(isProxyProtocol("http"), true);
  // Unknown values fall back rather than being carried through.
  assert.equal(normalizeProxyConfig({ protocol: "socks5" }).protocol, "http");
});

test("does not trim the password, whose spaces may be meaningful", () => {
  assert.equal(normalizeProxyConfig({ password: "  secret  " }).password, "  secret  ");
  // The username is a normal field, so it is trimmed.
  assert.equal(normalizeProxyConfig({ username: "  user  " }).username, "user");
});

test("never hands the password to the renderer", () => {
  const snapshot = redactProxyConfig({ ...DEFAULT_PROXY_CONFIG, ...ON, password: "hunter2" });
  assert.equal(snapshot.passwordConfigured, true);
  assert.equal("password" in snapshot, false);
  // The whole point: no code path can read it back out of the snapshot.
  assert.equal(JSON.stringify(snapshot).includes("hunter2"), false);
});

test("reports no stored password when there is none", () => {
  assert.equal(redactProxyConfig({ ...DEFAULT_PROXY_CONFIG, password: "" }).passwordConfigured, false);
  assert.equal(redactProxyConfig(undefined).passwordConfigured, false);
});

test("keeps the stored password when the patch omits it", () => {
  const stored = { ...DEFAULT_PROXY_CONFIG, ...ON, password: "hunter2" };
  assert.equal(mergeProxyConfigPatch(stored, { port: 1080 }).password, "hunter2");
});

test("clears the password on an explicit empty string", () => {
  const stored = { ...DEFAULT_PROXY_CONFIG, ...ON, password: "hunter2" };
  assert.equal(mergeProxyConfigPatch(stored, { password: "" }).password, "");
});

test("a patch cannot smuggle in a field it was not given", () => {
  const merged = mergeProxyConfigPatch(DEFAULT_PROXY_CONFIG, { host: "10.0.0.1", nonsense: true });
  assert.deepEqual(Object.keys(merged).sort(), [
    "enabled",
    "host",
    "password",
    "port",
    "protocol",
    "username",
  ]);
});

test("a disabled config is reported as disabled rather than broken", () => {
  assert.deepEqual(resolveProxyConfig(DEFAULT_PROXY_CONFIG), { ok: false, reason: "disabled" });
  assert.deepEqual(resolveProxyConfig(undefined), { ok: false, reason: "disabled" });
});

test("rejects hosts that would break the URL or smuggle credentials", () => {
  for (const host of ["", "  ", "a b", "host/path", "host\\x", "user@host", "host#f", "host?q", "host%20"]) {
    const result = resolveProxyConfig({ ...DEFAULT_PROXY_CONFIG, ...ON, host });
    assert.deepEqual(result, { ok: false, reason: "bad-host" }, `host ${JSON.stringify(host)}`);
  }
});

test("builds a URL without credentials when no username is set", () => {
  const result = resolveProxyConfig({ ...DEFAULT_PROXY_CONFIG, ...ON });
  assert.deepEqual(result, { ok: true, target: "127.0.0.1:7890", url: "http://127.0.0.1:7890" });
});

test("encodes credentials so punctuation cannot escape the userinfo", () => {
  const result = resolveProxyConfig({
    ...DEFAULT_PROXY_CONFIG,
    ...ON,
    protocol: "https",
    username: "user@corp",
    password: "p@ss:word/1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.url, "https://user%40corp:p%40ss%3Aword%2F1@127.0.0.1:7890");
  // The reported target stays credential-free so it is safe to log and display.
  assert.equal(result.ok && result.target, "127.0.0.1:7890");
});

test("a target never contains the password even when one is set", () => {
  const config = { ...DEFAULT_PROXY_CONFIG, ...ON, username: "u", password: "hunter2" };
  assert.equal(proxyTarget(config).includes("hunter2"), false);
});
