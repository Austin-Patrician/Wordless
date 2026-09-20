import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer");
const appCss = readFileSync(join(rendererRoot, "styles", "app.css"), "utf8");

function block(selector: string): string {
  const start = appCss.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS block: ${selector}`);
  const end = appCss.indexOf("\n}", start);
  return appCss.slice(start, end);
}

// The first-run guide covers the whole window. The shell tokens turn
// translucent when a custom background is active so the background image can
// show through, so the overlay must not reuse them or the interface behind it
// bleeds into the guide.
test("the overlay surface is defined for both themes", () => {
  assert.match(block(":root {"), /--wordless-overlay-surface:\s*#[0-9a-f]{6};/);
  assert.match(block(':root[data-theme="dark"] {'), /--wordless-overlay-surface:\s*#[0-9a-f]{6};/);
});

test("the overlay surface is never made translucent by the background rules", () => {
  for (const selector of [
    ':root[data-appearance-background="active"] {',
    ':root[data-theme="dark"][data-appearance-background="active"] {',
  ]) {
    assert.doesNotMatch(block(selector), /--wordless-overlay-surface/, `${selector} must not restate the overlay surface`);
  }
});

test("the overlay surface stays opaque", () => {
  const declaration = block(":root {").match(/--wordless-overlay-surface:\s*([^;]+);/);
  assert.ok(declaration);
  assert.doesNotMatch(declaration[1], /rgb\(|rgba\(|transparent|\/\s*0?\.\d+\s*\)/, "the overlay surface must not be translucent");
});

test("the welcome screen paints the opaque overlay surface", () => {
  const source = readFileSync(join(rendererRoot, "features", "onboarding", "OnboardingWelcome.tsx"), "utf8");
  assert.match(source, /bg-\[var\(--wordless-overlay-surface\)\]/);
  assert.doesNotMatch(source, /bg-\[var\(--wordless-shell-workspace\)\]/, "the welcome screen must not reuse the shell token");
});
