import assert from "node:assert/strict";
import test from "node:test";
import { NOTIFICATION_COPY, notificationStatusWord } from "../src/main/notifications/copy.ts";
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  renderForBudget,
  renderTemplate,
  templateVariables,
  validateTemplate,
} from "../src/main/notifications/template.ts";

/**
 * Templates and the two halves of this feature's user-facing text.
 *
 * Two rules here are worth more than the rest: an unknown variable is refused when
 * the template is saved (so it can never reach a group chat as a literal), and a
 * long reply gives way to the rest of the message rather than pushing it out.
 */

test("variables are found regardless of spacing", () => {
  assert.deepEqual(templateVariables("{{name}} {{ status }} {{duration}}"), ["name", "status", "duration"]);
  assert.deepEqual(templateVariables("{{name}}{{name}}"), ["name", "name"]);
  assert.deepEqual(templateVariables("no variables"), []);
  // Not a variable: the pattern requires letters only.
  assert.deepEqual(templateVariables("{{1}} {{a.b}} {{}}"), []);
});

test("a typo is refused at save time", () => {
  assert.equal(validateTemplate("{{name}} {{status}}"), undefined);
  assert.equal(validateTemplate("{{nam}}"), "template-unknown-variable");
  assert.equal(validateTemplate("{{nmae}}"), "template-unknown-variable");
  assert.equal(validateTemplate("   "), "template-empty");
  assert.equal(validateTemplate(""), "template-empty");
});

test("known variables are substituted and empty ones leave no gap", () => {
  assert.equal(renderTemplate("{{name}} — {{status}}", { name: "Report", status: "Completed" }), "Report — Completed");
  // An empty optional part collapses: a template with {{error}} must not arrive with
  // a hole where the error would have been.
  assert.equal(renderTemplate("a\n\n{{reply}}\n\n{{error}}", { reply: "", error: "" }), "a");
  assert.equal(renderTemplate("a\n\n{{reply}}\n\n{{error}}", { reply: "did it", error: "" }), "a\n\ndid it");
  // Trailing whitespace on a line is dropped, so a substituted value cannot leave
  // indentation behind.
  assert.equal(renderTemplate("a  \n{{error}}", { error: "" }), "a");
});

test("an unknown variable renders literally, as a stale template's tell", () => {
  // Validation should have caught it on save; if one is stored anyway (a renamed
  // variable, say) it is better seen than silently blanked.
  assert.equal(renderTemplate("{{gone}}", {}), "{{gone}}");
});

test("the reply takes what is left after the rest of the message", () => {
  const values = { duration: "2m", reply: "x".repeat(500) };
  const rendered = renderForBudget({ template: "{{duration}}\n\n{{reply}}", values, limits: { maxBytes: 100 } });
  assert.ok(Buffer.byteLength(rendered.text, "utf8") <= 100, `got ${Buffer.byteLength(rendered.text, "utf8")}`);
  assert.equal(rendered.truncatedReply, true);
  assert.equal(rendered.truncated, false, "the message itself still fits");
  // The fixed part is what must survive; without the budget it would be the reply that
  // survives and the status line that disappears.
  assert.match(rendered.text, /^2m/);
});

test("a template with no reply is rendered once and cut to fit", () => {
  const rendered = renderForBudget({ template: "{{duration}} {{status}}", values: { duration: "d".repeat(200), status: "done" }, limits: { maxBytes: 40 } });
  assert.equal(rendered.truncatedReply, false);
  assert.equal(rendered.truncated, true);
  assert.ok(Buffer.byteLength(rendered.text, "utf8") <= 40);
});

test("a template that already overflows leaves the reply nothing", () => {
  const rendered = renderForBudget({
    template: "{{duration}}\n\n{{reply}}",
    values: { duration: "d".repeat(200), reply: "should be gone" },
    limits: { maxBytes: 40 },
  });
  assert.ok(Buffer.byteLength(rendered.text, "utf8") <= 40);
  assert.ok(!rendered.text.includes("should be gone"));
});

test("a character ceiling is respected alongside the byte one", () => {
  // The reply budget has to account for both, since platforms differ on the unit.
  const rendered = renderForBudget({
    template: "{{reply}}",
    values: { reply: "a".repeat(100) },
    limits: { maxBytes: 10_000, maxChars: 20 },
  });
  assert.ok(rendered.text.length <= 20, `got ${rendered.text.length}`);
});

test("the default template needs no translation", () => {
  // It is only variables and blank lines, which is what lets the host assemble it
  // with no window open and no copy table.
  assert.equal(templateVariables(DEFAULT_NOTIFICATION_TEMPLATE).every((name) => name.length > 0), true);
  assert.ok(!/[A-Za-z]{2,}\s[A-Za-z]{2,}/.test(DEFAULT_NOTIFICATION_TEMPLATE.replace(/\{\{[a-z]+\}\}/g, "")));
  assert.equal(validateTemplate(DEFAULT_NOTIFICATION_TEMPLATE), undefined);
});

test("the status words cover every run status in both languages", () => {
  const statuses = ["queued", "running", "waiting", "completed", "failed", "cancelled", "configuration-error", "interrupted"] as const;
  for (const status of statuses) {
    const zh = notificationStatusWord("zh-CN", status);
    const en = notificationStatusWord("en-US", status);
    assert.ok(zh.trim().length > 0, status);
    assert.ok(en.trim().length > 0, status);
    assert.notEqual(zh, en, `${status} must actually be translated`);
  }
  // An unknown locale must fall back rather than produce undefined.
  assert.equal(notificationStatusWord("fr-FR" as never, "completed"), "Completed");
});

test("the copy tables have identical shapes", () => {
  const zh = NOTIFICATION_COPY["zh-CN"];
  const en = NOTIFICATION_COPY["en-US"];
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(zh.status).sort(), Object.keys(en.status).sort());
  assert.equal(zh.endpointMissing.length > 0, true);
  assert.equal(en.endpointMissing.length > 0, true);
});

test("the interrupted summary and dropped suffix carry their placeholders", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    assert.match(NOTIFICATION_COPY[locale].interruptedSummary, /\{count\}/);
    assert.match(NOTIFICATION_COPY[locale].droppedSuffix, /\{count\}/);
  }
});
