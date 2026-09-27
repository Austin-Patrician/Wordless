import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DESKTOP_BRIDGE_VERSION, requiredMethods } from "../src/bridge/desktop-bridge.ts";

/**
 * Guards the renderer↔host contract against the one slip nothing else catches.
 *
 * `desktopBridgeError` (runtime) checks that each name in `requiredMethods` is a
 * function on the preload, and that the version matches. What it cannot see is a
 * method that was added to the interface but left out of `requiredMethods`: that
 * method then goes unchecked, which is silent.
 *
 * So the two sources are compared: the interface is the contract, and every method
 * in it must be required. The preload is checked too — the runtime check covers it,
 * but only once the app is running.
 */

const root = path.join(import.meta.dirname, "..");
const bridgeSource = readFileSync(path.join(root, "src/bridge/desktop-bridge.ts"), "utf8");
const preloadSource = readFileSync(path.join(root, "src/preload/index.ts"), "utf8");

/** Methods declared in `export interface DesktopBridge`, at the interface's own indent. */
function interfaceMethods(): string[] {
  const start = bridgeSource.indexOf("export interface DesktopBridge {");
  assert.ok(start >= 0, "DesktopBridge interface not found");
  const end = bridgeSource.indexOf("\n}", start);
  assert.ok(end > start, "DesktopBridge interface body not found");
  const body = bridgeSource.slice(start, end);
  // Two spaces and a name followed by `(`: nested object-literal members sit deeper.
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)].map((match) => match[1]);
}

test("every bridge method is declared as required", () => {
  const declared = interfaceMethods();
  assert.ok(declared.length > 50, `expected the full interface, parsed ${declared.length}`);
  const required = new Set<string>(requiredMethods);
  const missing = declared.filter((method) => !required.has(method));
  assert.deepEqual(
    missing,
    [],
    `these are on the bridge but not in requiredMethods, so nothing checks them: ${missing.join(", ")}`,
  );
});

test("requiredMethods has no duplicates and no stale entries", () => {
  assert.equal(new Set(requiredMethods).size, requiredMethods.length, "duplicate entries");
  const declared = new Set(interfaceMethods());
  const stale = requiredMethods.filter((method) => !declared.has(method));
  assert.deepEqual(stale, [], `required but no longer on the bridge: ${stale.join(", ")}`);
});

test("the preload implements every required method", () => {
  const absent = requiredMethods.filter((method) => !preloadSource.includes(`${method}:`));
  assert.deepEqual(absent, [], `preload is missing: ${absent.join(", ")}`);
});

test("the bridge version is a plain positive integer", () => {
  // The version is compared for equality across processes, so it must be a literal.
  assert.equal(Number.isInteger(DESKTOP_BRIDGE_VERSION), true);
  assert.ok(DESKTOP_BRIDGE_VERSION > 0);
});
