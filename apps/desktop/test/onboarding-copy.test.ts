import assert from "node:assert/strict";
import test from "node:test";
import { messages } from "../src/renderer/shared/i18n.ts";

const LOCALES = ["zh-CN", "en-US"] as const;

test("every locale exposes the same message keys", () => {
  const [reference, ...rest] = LOCALES;
  const expected = Object.keys(messages[reference]).sort();
  for (const locale of rest) {
    const actual = Object.keys(messages[locale]).sort();
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    assert.deepEqual(missing, [], `${locale} is missing keys`);
    assert.deepEqual(extra, [], `${locale} has unknown keys`);
  }
});

test("no message is empty", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(messages[locale])) {
      assert.ok(String(value).trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

test("the first-run guide has copy for every step in both locales", () => {
  const required = [
    "onboardingWelcomeTitle",
    "onboardingWelcomeBody",
    "onboardingStartTour",
    "onboardingSkip",
    "onboardingStepProgress",
    "onboardingNext",
    "onboardingFinish",
    "onboardingReplayTitle",
    "onboardingReplayAction",
  ];
  for (const locale of LOCALES) {
    for (const key of required) {
      assert.ok(key in messages[locale], `${locale} is missing ${key}`);
    }
  }
});

// The guide's step copy is referenced by key from the step definitions, so a
// renamed key must fail here rather than render the raw identifier at runtime.
test("each tour step resolves to existing title and body copy", async () => {
  const { ONBOARDING_STEPS } = await import("../src/renderer/features/onboarding/onboarding-steps.ts");
  for (const step of ONBOARDING_STEPS) {
    for (const locale of LOCALES) {
      assert.ok(step.titleKey in messages[locale], `${locale} is missing title for ${step.id}`);
      assert.ok(step.bodyKey in messages[locale], `${locale} is missing body for ${step.id}`);
    }
  }
});
