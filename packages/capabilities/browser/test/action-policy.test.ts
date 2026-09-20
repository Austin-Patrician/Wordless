import { expect, it } from "vitest";
import {
  ACTION_LIMIT_PER_WINDOW,
  ACTION_WINDOW_MS,
  checkActionBudget,
  evaluateActRequest,
  isLoopbackUrl,
  originOf,
} from "../src/action-policy.ts";

const NOW = 1_000_000;

function request(overrides: Partial<Parameters<typeof evaluateActRequest>[0]> = {}) {
  return evaluateActRequest({ shared: true, url: "http://localhost:3000/", history: [], now: NOW, ...overrides });
}

it("allows acting on a shared local dev page", () => {
  expect(request()).toEqual({ allowed: true, history: [] });
});

it("refuses to act on a tab the user has not shared", () => {
  // Acting never widens the read gate; the same per-tab decision applies.
  const result = request({ shared: false, url: "https://example.com/" });
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error("unreachable");
  expect(result.denial.code).toBe("not_shared");
  expect(result.denial.message).toMatch(/not shared/);
});

it("refuses a shared page whose origin the user has not approved", () => {
  const result = request({ url: "https://example.com/" });
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error("unreachable");
  expect(result.denial.code).toBe("origin_not_allowed");
  if (result.denial.code !== "origin_not_allowed") throw new Error("unreachable");
  expect(result.denial.origin).toBe("https://example.com");
  // The message has to name the remedy: this is a permission the user can grant,
  // not a permanent limit the agent should give up on.
  expect(result.denial.message).toMatch(/Allow actions/);
});

it("allows an origin the user approved", () => {
  const result = request({ url: "https://example.com/app", allowedOrigins: ["https://example.com"] });
  expect(result.allowed).toBe(true);
});

it("does not carry an approval to a different host on navigation", () => {
  // The grant is per origin, so a link to somewhere else does not inherit it.
  const result = request({ url: "https://other.example/app", allowedOrigins: ["https://example.com"] });
  expect(result.allowed).toBe(false);
});

it("does not treat a subdomain as covered by its parent's approval", () => {
  const result = request({ url: "https://evil.example.com/", allowedOrigins: ["https://example.com"] });
  expect(result.allowed).toBe(false);
});

it("treats every loopback spelling as local", () => {
  expect(isLoopbackUrl("http://localhost:3000/x")).toBe(true);
  expect(isLoopbackUrl("https://localhost")).toBe(true);
  expect(isLoopbackUrl("http://127.0.0.1:5173")).toBe(true);
  expect(isLoopbackUrl("http://0.0.0.0:8080")).toBe(true);
  expect(isLoopbackUrl("http://[::1]:3000")).toBe(true);
  // Vite serves project subdomains this way.
  expect(isLoopbackUrl("http://app.localhost:3000")).toBe(true);
});

it("rejects lookalike hosts that only resemble localhost", () => {
  // A suffix check written loosely would accept these.
  expect(isLoopbackUrl("https://localhost.evil.com")).toBe(false);
  expect(isLoopbackUrl("https://notlocalhost")).toBe(false);
  expect(isLoopbackUrl("https://127.0.0.1.evil.com")).toBe(false);
  expect(isLoopbackUrl("https://example.com")).toBe(false);
});

it("rejects non-http schemes", () => {
  expect(isLoopbackUrl("file:///etc/passwd")).toBe(false);
  expect(isLoopbackUrl("data:text/html,<p>")).toBe(false);
  expect(isLoopbackUrl("about:blank")).toBe(false);
  expect(isLoopbackUrl("not a url")).toBe(false);
});

it("allows actions up to the limit, then asks the agent to stop", () => {
  // Backstop against a page that reloads its own markup after every click.
  const history = Array.from({ length: ACTION_LIMIT_PER_WINDOW }, () => NOW - 10);
  const result = request({ history });
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error("unreachable");
  expect(result.denial.code).toBe("rate_limited");
});

it("forgets actions that have aged out of the window", () => {
  const history = Array.from({ length: ACTION_LIMIT_PER_WINDOW }, () => NOW - ACTION_WINDOW_MS - 1);
  const result = request({ history });
  expect(result.allowed).toBe(true);
});

it("reports how long until the window clears", () => {
  const history = Array.from({ length: 5 }, (_, index) => NOW - index * 1_000);
  const budget = checkActionBudget(history, NOW, { limit: 5, windowMs: 60_000 });
  expect(budget.allowed).toBe(false);
  // The oldest action has to age out first, and it is 4s old.
  expect(budget.retryAfterMs).toBe(56_000);
});

it("keeps only in-window timestamps in the returned history", () => {
  const budget = checkActionBudget([NOW - 120_000, NOW - 1_000], NOW, { windowMs: 60_000 });
  expect(budget.allowed).toBe(true);
  expect(budget.history).toEqual([NOW - 1_000]);
});

it("reports no origin for an unparsable url", () => {
  expect(originOf("not a url")).toBeNull();
  expect(originOf("http://localhost:3000/a/b?c=1")).toBe("http://localhost:3000");
});
