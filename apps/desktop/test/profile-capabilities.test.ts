import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { codingProfile } from "../../../packages/profiles/coding/src/index.ts";
import { dataProfile } from "../../../packages/profiles/data/src/index.ts";
import { excelProfile } from "../../../packages/profiles/excel/src/index.ts";
import { generalProfile } from "../../../packages/profiles/general/src/index.ts";
import { pptProfile } from "../../../packages/profiles/ppt/src/index.ts";

/**
 * Guards a trap that silently produced a dead capability.
 *
 * A profile declares what it can do twice: `capabilityIds` is the intent, and
 * `activeToolNames` is the gate — the agent driver builds the model's tool list
 * and system prompt from the latter alone. `general`, `coding` and `data` all
 * declared the `browser` capability while listing none of its tools, so the
 * browser tools were filtered out before the model ever saw them. Nothing
 * failed; the agent simply behaved as though the feature did not exist and asked
 * the user for a URL instead.
 *
 * So the two declarations are checked against each other here.
 */
const CAPABILITY_TOOLS: Record<string, readonly string[]> = {
  filesystem: ["read", "write", "edit", "find", "ls", "grep"],
  shell: ["bash"],
  browser: ["browser_tabs", "browser_snapshot", "browser_console", "browser_screenshot"],
  data: ["data_catalog", "data_inspect"],
  // The office capability spans both families: the workbook profile drives the
  // spreadsheet tools, the presentation profile the presentation ones.
  office: ["spreadsheet_catalog", "presentation_catalog"],
  design: ["presentation_help"],
};

const PROFILES = [
  ["general", generalProfile],
  ["coding", codingProfile],
  ["data", dataProfile],
  ["excel", excelProfile],
  ["ppt", pptProfile],
] as const;

test("every declared capability has at least one of its tools enabled", () => {
  for (const [name, profile] of PROFILES) {
    for (const capabilityId of profile.capabilityIds) {
      const expected = CAPABILITY_TOOLS[capabilityId];
      assert.ok(expected, `${name} declares an unknown capability "${capabilityId}" — add it to CAPABILITY_TOOLS`);
      const enabled = expected.filter((tool) => profile.activeToolNames.includes(tool));
      assert.ok(
        enabled.length > 0,
        `${name} declares the "${capabilityId}" capability but enables none of ${expected.join(", ")} in activeToolNames`,
      );
    }
  }
});

test("every enabled tool name looks like a real tool name", () => {
  // The gate is a plain string list, so a typo reads as "capability missing"
  // rather than as a broken config.
  for (const [name, profile] of PROFILES) {
    for (const toolName of profile.activeToolNames) {
      assert.match(toolName, /^[a-z][a-z0-9_]*$/, `${name} lists a malformed tool name "${toolName}"`);
    }
    assert.equal(new Set(profile.activeToolNames).size, profile.activeToolNames.length, `${name} lists a duplicate tool`);
  }
});

test("the browser capability is enabled exactly where it is declared", () => {
  // Regression: the three profiles declaring `browser` listed none of its tools.
  const withBrowser = PROFILES.filter(([, profile]) => profile.capabilityIds.includes("browser")).map(([name]) => name);
  assert.deepEqual(withBrowser, ["general", "coding", "data"]);
  for (const [name, profile] of PROFILES) {
    const declares = profile.capabilityIds.includes("browser");
    const enables = profile.activeToolNames.includes("browser_snapshot");
    assert.equal(enables, declares, `${name}: declares browser=${declares} but enables its tools=${enables}`);
  }
});

test("enables every browser tool wherever the browser capability is declared", () => {
  // Regression, and the general shape of the bug it came from: the capability
  // package is the authority on which tools exist, and the profile's
  // `activeToolNames` is the gate the agent driver builds the tool list from.
  // When the two disagree the capability is silently absent — the agent behaves
  // as though the feature does not exist rather than reporting an error.
  //
  // The names are read out of the capability's source rather than listed here, so
  // adding a browser tool without registering it fails this test instead of
  // shipping. Reading the file avoids importing it: the package uses NodeNext
  // `./x.js` specifiers, which Node's type stripping in this test runner cannot
  // resolve.
  const source = readFileSync(new URL("../../../packages/capabilities/browser/src/index.ts", import.meta.url), "utf8");
  // Two shapes in the source: reading tools declare `name: "browser_x"`, acting
  // tools pass the name as the first argument of the shared `actTool` helper.
  // Matching only the first shape silently checked half the surface.
  const browserToolNames = [...source.matchAll(/(?:name: |actTool\()"(browser_[a-z_]+)"/g)].map((match) => match[1]!);
  assert.ok(browserToolNames.length >= 7, `expected all seven browser tools, parsed ${browserToolNames.length}: ${browserToolNames.join(", ")}`);

  for (const [name, profile] of PROFILES) {
    const declares = profile.capabilityIds.includes("browser");
    for (const toolName of browserToolNames) {
      assert.equal(
        profile.activeToolNames.includes(toolName),
        declares,
        `${name}: declares browser=${declares} but has ${toolName}=${profile.activeToolNames.includes(toolName)}`,
      );
    }
  }
});
