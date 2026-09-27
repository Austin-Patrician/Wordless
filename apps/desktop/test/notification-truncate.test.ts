import assert from "node:assert/strict";
import test from "node:test";
import {
  byteLength,
  remainingBytes,
  remainingChars,
  truncateToLimits,
} from "../src/main/notifications/truncate.ts";

/**
 * The shared truncator.
 *
 * The platforms limit the body in different units — Feishu caps the whole request
 * body in bytes, WeCom caps markdown in bytes, DingTalk caps the text in
 * *characters* — so a single byte cap is wrong for at least one of them. These
 * cases pin both ceilings and, crucially, which one wins.
 */

test("a value inside both ceilings is returned untouched", () => {
  assert.deepEqual(truncateToLimits("hello", { maxBytes: 100 }), { text: "hello", truncated: false });
  assert.deepEqual(truncateToLimits("hello", { maxBytes: 100, maxChars: 10 }), { text: "hello", truncated: false });
  // Exactly at the byte ceiling is still fine.
  const five = "abcde";
  assert.deepEqual(truncateToLimits(five, { maxBytes: 5 }), { text: five, truncated: false });
});

test("the ellipsis is reserved out of the budget, not appended on top", () => {
  // A full-budget body plus an ellipsis is how a message ends up a few bytes over
  // the limit after already being reported as sent.
  const result = truncateToLimits("x".repeat(100), { maxBytes: 10 });
  assert.equal(result.truncated, true);
  assert.ok(byteLength(result.text) <= 10, `got ${byteLength(result.text)} bytes`);
  assert.ok(result.text.endsWith("…"));
});

test("Chinese is trimmed to fit bytes, not characters", () => {
  // 100 characters is 300 bytes; a character-count check would let it through.
  const result = truncateToLimits("中".repeat(100), { maxBytes: 90 });
  assert.equal(result.truncated, true);
  assert.ok(byteLength(result.text) <= 90, `got ${byteLength(result.text)} bytes`);
  // Each Chinese character is 3 bytes, so 29 fit alongside the 3-byte ellipsis.
  assert.equal(result.text, `${"中".repeat(29)}…`);
});

test("the character ceiling binds when the platform documents characters", () => {
  // DingTalk: 4000 characters. Pure ASCII would pass a byte-only check at 4000
  // bytes but this pins the character ceiling too.
  const ascii = "a".repeat(5000);
  const byChars = truncateToLimits(ascii, { maxBytes: 100_000, maxChars: 20 });
  assert.equal(byChars.truncated, true);
  assert.equal(byChars.text, `${"a".repeat(19)}…`);
  assert.ok(byChars.text.length <= 20);
});

test("whichever ceiling binds first wins", () => {
  // Chinese: 20 characters is 60 bytes, so the byte ceiling binds first here.
  const chinese = "中".repeat(20);
  const byteBound = truncateToLimits(chinese, { maxBytes: 30, maxChars: 20 });
  assert.ok(byteLength(byteBound.text) <= 30);
  assert.equal(byteBound.text, `${"中".repeat(9)}…`);

  // ASCII: 30 characters is 30 bytes, so the character ceiling binds first.
  const ascii = "a".repeat(30);
  const charBound = truncateToLimits(ascii, { maxBytes: 100, maxChars: 10 });
  assert.equal(charBound.text, `${"a".repeat(9)}…`);

  // Applied together the result must satisfy both.
  const both = truncateToLimits("中".repeat(200), { maxBytes: 60, maxChars: 50 });
  assert.ok(byteLength(both.text) <= 60);
  assert.ok(both.text.length <= 50);
});

test("an emoji counts as two characters, which errs on the safe side", () => {
  // `String.length` counts UTF-16 units. Being stricter than a code-point count
  // means we may cut one character early, never one late.
  const result = truncateToLimits("👍👍👍", { maxBytes: 1000, maxChars: 5 });
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 5);
});

test("the remaining budget is derived from the rest of the message", () => {
  // What is left for a reply depends on the platform *and* on how much room the
  // user's own template already spent — which is why this is computed, not a
  // fixed reply length.
  assert.equal(remainingBytes({ maxBytes: 1000 }, ""), 999);
  assert.equal(remainingBytes({ maxBytes: 1000 }, "abcde"), 994);
  // A template that already overflows leaves nothing for the variable part.
  assert.equal(remainingBytes({ maxBytes: 10 }, "a".repeat(50)), 0);
  // Chinese spends three bytes per character.
  assert.equal(remainingBytes({ maxBytes: 100 }, "中"), 96);

  assert.equal(remainingChars({ maxBytes: 10, maxChars: 20 }, ""), 19);
  assert.equal(remainingChars({ maxBytes: 10, maxChars: 20 }, "abcde"), 14);
  assert.equal(remainingChars({ maxBytes: 10, maxChars: 3 }, "abcdefg"), 0);
  // No character ceiling means the byte ceiling is the only constraint.
  assert.equal(remainingChars({ maxBytes: 10 }, "abc"), Number.POSITIVE_INFINITY);
});
