import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNavigationInput } from "../src/main/browser/browser-url.ts";

test("keeps loopback addresses on http because dev servers rarely serve TLS", () => {
  assert.equal(normalizeNavigationInput("localhost:3000"), "http://localhost:3000/");
  assert.equal(normalizeNavigationInput("127.0.0.1:5173/app"), "http://127.0.0.1:5173/app");
  assert.equal(normalizeNavigationInput("localhost"), "http://localhost/");
});

test("upgrades bare hostnames to https", () => {
  assert.equal(normalizeNavigationInput("example.com"), "https://example.com/");
  assert.equal(normalizeNavigationInput("docs.example.com/a?b=1"), "https://docs.example.com/a?b=1");
});

test("preserves an explicit scheme", () => {
  assert.equal(normalizeNavigationInput("https://example.com"), "https://example.com/");
  assert.equal(normalizeNavigationInput("http://localhost:8080"), "http://localhost:8080/");
  assert.equal(normalizeNavigationInput("about:blank"), "about:blank");
});

test("refuses file and custom schemes", () => {
  // Reading local files from an agent-controlled page is a capability we add
  // deliberately behind session trust, not by typing it into the address bar.
  assert.equal(normalizeNavigationInput("file:///etc/passwd"), null);
  assert.equal(normalizeNavigationInput("javascript:alert(1)"), null);
  assert.equal(normalizeNavigationInput("wordless://settings"), null);
  assert.equal(normalizeNavigationInput("chrome://settings"), null);
});

test("returns null for empty or unusable input instead of guessing", () => {
  assert.equal(normalizeNavigationInput(""), null);
  assert.equal(normalizeNavigationInput("   "), null);
  assert.equal(normalizeNavigationInput("not a url"), null);
});

test("treats trimmed input as the address so pasted whitespace is harmless", () => {
  assert.equal(normalizeNavigationInput("  localhost:3000  "), "http://localhost:3000/");
});
