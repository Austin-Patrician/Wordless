import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopProxyConfigSnapshot } from "../../../packages/protocol/src/index.ts";
import {
  proxyDraftFromSnapshot,
  proxyDraftIsDirty,
  proxyFormError,
  proxyPatchFromDraft,
} from "../src/renderer/features/settings/proxy-form.ts";

const STORED: DesktopProxyConfigSnapshot = {
  enabled: true,
  protocol: "http",
  host: "127.0.0.1",
  port: 7890,
  username: "",
  passwordConfigured: true,
};

const draft = (over: Partial<ReturnType<typeof proxyDraftFromSnapshot>> = {}) => ({
  ...proxyDraftFromSnapshot(STORED),
  ...over,
});

test("a snapshot becomes a draft without exposing the password", () => {
  const result = proxyDraftFromSnapshot(STORED);
  assert.equal(result.password, "");
  assert.equal(result.port, "7890");
});

test("a never-set port shows as an empty field rather than a zero", () => {
  assert.equal(proxyDraftFromSnapshot({ ...STORED, port: 0 }).port, "");
});

test("saving without touching the password omits it, so the stored one survives", () => {
  const patch = proxyPatchFromDraft(draft({ port: "1080" }), false);
  assert.equal("password" in patch, false);
  assert.equal(patch.port, 1080);
});

test("typing in the password field sends it", () => {
  assert.equal(proxyPatchFromDraft(draft({ password: "hunter2" }), true).password, "hunter2");
});

test("clearing the password sends an empty string, which is how it is removed", () => {
  assert.equal(proxyPatchFromDraft(draft({ password: "" }), true).password, "");
});

test("an unparsable port is sent as zero rather than replaced by a default", () => {
  // Substituting 7890 would connect the user somewhere they did not ask for.
  assert.equal(proxyPatchFromDraft(draft({ port: "" }), false).port, 0);
  assert.equal(proxyPatchFromDraft(draft({ port: "abc" }), false).port, 0);
});

test("host and username are trimmed, the password is not", () => {
  const patch = proxyPatchFromDraft(draft({ host: " 10.0.0.1 ", username: " u ", password: "  p  " }), true);
  assert.equal(patch.host, "10.0.0.1");
  assert.equal(patch.username, "u");
  assert.equal(patch.password, "  p  ");
});

test("field problems only apply once the proxy is enabled", () => {
  assert.equal(proxyFormError(draft({ enabled: false, host: "", port: "" })), null);
  assert.equal(proxyFormError(draft({ host: "" })), "host");
  assert.equal(proxyFormError(draft({ port: "" })), "port");
  assert.equal(proxyFormError(draft({ port: "70000" })), "port");
  assert.equal(proxyFormError(draft({ port: "0" })), "port");
  assert.equal(proxyFormError(draft()), null);
});

test("dirtiness ignores the password unless it was touched", () => {
  assert.equal(proxyDraftIsDirty(draft(), STORED, false), false);
  assert.equal(proxyDraftIsDirty(draft(), STORED, true), true);
  assert.equal(proxyDraftIsDirty(draft({ host: "10.0.0.1" }), STORED, false), true);
  assert.equal(proxyDraftIsDirty(draft({ enabled: false }), STORED, false), true);
});
