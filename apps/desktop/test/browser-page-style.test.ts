import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_SCROLLBAR_CSS } from "../src/main/browser/browser-page-style.ts";

test("scopes injected scrollbar styling to the viewport only", () => {
  // Regression guard: a bare `::-webkit-scrollbar` rule would restyle every
  // scroll area the page owns — code editors, side panes, chat lists. Only the
  // viewport scrollbar is ours to touch, and the app does not get to make that
  // call for someone else's page.
  // Matches selector blocks only: `[^{}]` cannot cross a brace, so declarations
  // inside a rule are never mistaken for selectors.
  const selectors = [...PAGE_SCROLLBAR_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .flatMap((match) => match[1]!.split(","))
    .map((selector) => selector.trim())
    .filter(Boolean);
  assert.ok(selectors.length > 0, "the stylesheet has selectors");
  for (const selector of selectors) {
    assert.match(
      selector,
      /^(html|body)::-webkit-scrollbar/,
      `${selector} must target html or body, not the page at large`,
    );
  }
});

test("avoids scrollbar-width, which would disable the webkit rules", () => {
  // In Chromium, setting `scrollbar-width` makes the `::-webkit-scrollbar` rules
  // inert — the two cannot be combined, so only one may appear.
  assert.equal(PAGE_SCROLLBAR_CSS.includes("scrollbar-width"), false);
  assert.equal(PAGE_SCROLLBAR_CSS.includes("::-webkit-scrollbar-thumb"), true);
});

test("does not tint the thumb for a specific theme", () => {
  // The app knows whether it is light or dark, not what the page looks like, so
  // a tinted thumb would vanish against a site of the opposite theme.
  assert.equal(/data-theme/.test(PAGE_SCROLLBAR_CSS), false);
});
