import assert from "node:assert/strict";
import test from "node:test";
import {
  connectorErrorDetail,
  connectorErrorKind,
  hasActiveConnectorAuthorization,
} from "../src/renderer/features/skills/connector-ui-state.ts";

test("removes Electron IPC internals from connector errors", () => {
  const detail = connectorErrorDetail(new Error("Error invoking remote method 'wordless:connectors:authorize': Error: token exchange failed"));
  assert.equal(detail, "token exchange failed");
});

test("maps connector failures to actionable UI categories", () => {
  assert.equal(connectorErrorKind("access_denied", "authorize"), "authorization-denied");
  assert.equal(connectorErrorKind("listen EADDRINUSE: 127.0.0.1:18191", "authorize"), "authorization-busy");
  assert.equal(connectorErrorKind("Existing OAuth client information is required", "authorize"), "authorization-failed");
  assert.equal(connectorErrorKind("connection refused", "test"), "test-failed");
});

test("only connector authorization is globally exclusive", () => {
  assert.equal(hasActiveConnectorAuthorization({ first: "test", second: "enabled" }), false);
  assert.equal(hasActiveConnectorAuthorization({ first: "test", second: "authorize" }), true);
});
