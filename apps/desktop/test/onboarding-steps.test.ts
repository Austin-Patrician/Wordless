import assert from "node:assert/strict";
import test from "node:test";
import {
  findOnboardingAnchor,
  ONBOARDING_CARD_GAP,
  ONBOARDING_STEPS,
  positionOnboardingCard,
  type OnboardingStep,
} from "../src/renderer/features/onboarding/onboarding-steps.ts";

const step = (anchors: string[]): OnboardingStep => ({
  id: "settings",
  titleKey: "onboardingStepSettingsTitle",
  bodyKey: "onboardingStepSettingsBody",
  anchors,
  placement: "right",
});

test("every step declares at least one anchor and a placement", () => {
  assert.equal(ONBOARDING_STEPS.length, 7);
  for (const entry of ONBOARDING_STEPS) {
    assert.ok(entry.anchors.length > 0, `${entry.id} needs an anchor`);
    assert.notEqual(entry.placement, "center");
  }
});

// The model step highlights the model selector inside the composer but must not
// drop its card on top of the input area, so the card is positioned against the
// composer instead. Without this the card covers the text the user is reading.
test("the model step highlights the composer's model control but anchors its card to the composer", () => {
  const model = ONBOARDING_STEPS.find((entry) => entry.id === "model");
  assert.ok(model);
  assert.deepEqual(model.anchors, ['[data-tour="composer-model"]']);
  assert.deepEqual(model.cardAnchors, ['[data-tour="composer"]']);
});

test("steps without card anchors fall back to their highlight anchor", () => {
  const plain = ONBOARDING_STEPS.find((entry) => entry.id === "composer");
  assert.ok(plain);
  assert.equal(plain.cardAnchors, undefined);
});

test("the first matching selector wins and a missing anchor resolves to null", () => {
  const find = (selectors: string[], present: Record<string, Element>) =>
    findOnboardingAnchor(step(selectors), {
      querySelector: (selector: string) => present[selector] ?? null,
    } as Pick<Document, "querySelector">, () => true);

  const found = find(['[data-tour="missing"]', '[data-tour="present"]'], {
    '[data-tour="present"]': { id: "present" } as unknown as Element,
  });
  assert.equal((found as unknown as { id: string } | null)?.id, "present");

  assert.equal(find(['[data-tour="missing"]'], {}), null);
});

// A `display: contents` wrapper, or an element hidden with `hidden`/`display:none`,
// reports a zero-size rect. Highlighting it would collapse the spotlight into the
// corner of the window, so such an anchor must be skipped.
test("anchors with no layout box are skipped in favour of the next selector", () => {
  const boxed = (width: number, height: number): Element =>
    ({ getBoundingClientRect: () => ({ width, height }) }) as unknown as Element;
  const collapsed = boxed(0, 0); // display: contents / display: none
  const real = boxed(120, 24);

  const resolved = findOnboardingAnchor(
    step(['[data-tour="collapsed"]', '[data-tour="real"]']),
    {
      querySelector: (selector: string) =>
        selector === '[data-tour="collapsed"]' ? collapsed : real,
    } as Pick<Document, "querySelector">,
  );
  assert.equal(resolved, real);

  // When every match is unmeasurable the step falls back to a centered card.
  assert.equal(
    findOnboardingAnchor(step(['[data-tour="collapsed"]']), {
      querySelector: () => collapsed,
    } as Pick<Document, "querySelector">),
    null,
  );
});

test("cards placed to the right sit beside the anchor and stay inside the viewport", () => {
  const rect = { top: 100, left: 20, width: 200, height: 40 };
  const card = { width: 320, height: 180 };
  const viewport = { width: 1280, height: 800 };

  const right = positionOnboardingCard(rect, "right", card, viewport);
  assert.equal(right.left, rect.left + rect.width + ONBOARDING_CARD_GAP);
  assert.equal(right.top, rect.top + rect.height / 2 - card.height / 2);

  // An anchor flush against the right edge must not push the card off-screen.
  const clamped = positionOnboardingCard({ top: 0, left: 1200, width: 80, height: 40 }, "right", card, viewport);
  assert.ok(clamped.left <= viewport.width - card.width, "card must stay inside the viewport");
});

test("centered cards are used when a step has no anchor on screen", () => {
  const viewport = { width: 1280, height: 800 };
  const card = { width: 320, height: 180 };
  const centered = positionOnboardingCard({ top: 0, left: 0, width: 0, height: 0 }, "center", card, viewport);
  assert.equal(centered.left, (viewport.width - card.width) / 2);
  assert.equal(centered.top, (viewport.height - card.height) / 2);
});

test("cards never render outside the viewport for extreme anchors", () => {
  const card = { width: 320, height: 180 };
  const viewport = { width: 1280, height: 800 };
  for (const placement of ["right", "top", "bottom"] as const) {
    for (const rect of [
      { top: -500, left: -500, width: 100, height: 40 },
      { top: 900, left: 1400, width: 100, height: 40 },
    ]) {
      const position = positionOnboardingCard(rect, placement, card, viewport);
      assert.ok(position.left >= 0 && position.left <= viewport.width, `${placement} left in range`);
      assert.ok(position.top >= 0 && position.top <= viewport.height, `${placement} top in range`);
    }
  }
});
