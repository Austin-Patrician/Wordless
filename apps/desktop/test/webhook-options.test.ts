import assert from "node:assert/strict";
import test from "node:test";
import { getProvider, listProviderDescriptors } from "../src/main/notifications/webhook/providers/registry.ts";
import { messages } from "../src/renderer/shared/i18n.ts";
import {
  formatListOption,
  listOptionTextIsCurrent,
  parseListOption,
  readListOption,
  readOption,
  readTextOption,
  webhookOptionFields,
  webhookOptionKeys,
  withListOption,
  withOption,
  withTextOption,
} from "../src/renderer/features/settings/webhook-options.ts";

/**
 * The options form is split across two processes: the main process owns the shape
 * (`optionsSchema`, enforced on save) and the renderer owns the controls and their
 * wording. Nothing but these tests holds the two together, so they are the point of
 * this file rather than an afterthought.
 */

const KINDS = listProviderDescriptors().map((descriptor) => descriptor.kind);

function declaredKeys(kind: (typeof KINDS)[number]): string[] {
  const schema = getProvider(kind).optionsSchema as { properties: Record<string, unknown> };
  return Object.keys(schema.properties);
}

test("every registered channel has options declared on both sides, and they agree", () => {
  assert.deepEqual([...KINDS].sort(), ["dingtalk", "feishu", "wecom"]);
  for (const kind of KINDS) {
    assert.deepEqual(
      [...webhookOptionKeys(kind)].sort(),
      [...declaredKeys(kind)].sort(),
      `${kind}: the form and the provider schema disagree about available options`,
    );
  }
});

test("WeCom offers only its message format, and that option is not capability-gated", () => {
  assert.deepEqual(webhookOptionKeys("wecom"), ["useMarkdownV2"]);
  // Shown even with no capabilities to consult: it is a property of the channel
  // itself rather than of a flag, exactly like DingTalk's keyword.
  assert.deepEqual(webhookOptionFields("wecom").map((field) => field.key), ["useMarkdownV2"]);
  // The option that cannot work here stays absent: this platform's markdown body
  // cannot mention anyone.
  assert.ok(!webhookOptionKeys("wecom").includes("mentionAll"));
  assert.ok(!webhookOptionKeys("wecom").includes("atMobiles"));
});

test("no channel declares the same key twice", () => {
  for (const kind of KINDS) {
    const keys = webhookOptionKeys(kind);
    assert.equal(new Set(keys).size, keys.length, `${kind} declares a duplicate key`);
  }
});

test("capability flags hide the options they gate, and only those", () => {
  const dingtalk = getProvider("dingtalk");
  const all = webhookOptionFields("dingtalk", dingtalk.capabilities).map((field) => field.key);
  assert.deepEqual(all, ["keyword", "atMobiles", "mentionAll"]);

  // Keyword is not capability-gated: it is a property of DingTalk itself, and
  // inventing a flag for it would be motion without meaning.
  const withoutMentions = webhookOptionFields("dingtalk", {
    ...dingtalk.capabilities,
    supportsMentionAll: false,
    supportsMentionByMobile: false,
  }).map((field) => field.key);
  assert.deepEqual(withoutMentions, ["keyword"]);

  // A channel we cannot describe falls back to the ungated fields rather than
  // throwing or rendering a switch that may not work.
  assert.deepEqual(webhookOptionFields("dingtalk").map((field) => field.key), ["keyword"]);

  // Feishu gained no options it does not have: no keyword, no phone mentions.
  const feishu = webhookOptionFields("feishu", getProvider("feishu").capabilities).map((field) => field.key);
  assert.deepEqual(feishu, ["mentionAll"]);
});

test("every label, hint and placeholder resolves in every locale", () => {
  const tables = Object.values(messages);
  for (const kind of KINDS) {
    for (const field of webhookOptionFields(kind, getProvider(kind).capabilities)) {
      const keys = [field.labelKey, field.helpKey, field.control === "toggle" ? null : field.placeholderKey];
      for (const key of keys) {
        if (key === null) continue;
        for (const table of tables) assert.ok(key in table, `${kind}.${field.key} is missing "${key}"`);
      }
    }
  }
});

test("an untouched or cleared option is absent, never stored empty", () => {
  assert.deepEqual(withTextOption({}, "keyword", "   "), {});
  assert.deepEqual(withListOption({}, "atMobiles", []), {});
  assert.deepEqual(withOption({}, "mentionAll", false), {});
  // "Absent" stays the single representation of off, so toggling a switch on and
  // back off leaves nothing behind and the form does not report itself dirty.
  assert.deepEqual(withTextOption({ keyword: "a", mentionAll: true as const }, "keyword", ""), { mentionAll: true });
  assert.deepEqual(withListOption({ atMobiles: ["138"], mentionAll: true as const }, "atMobiles", []), {
    mentionAll: true,
  });
});

test("a boolean option is on when present, off when absent, never stored as false", () => {
  assert.equal(readOption({}, "mentionAll"), false);
  assert.equal(readOption({ mentionAll: true }, "mentionAll"), true);
  // An explicit stored `false` reads as off, and is what a naive truthiness check
  // would confuse with "on".
  assert.equal(readOption({ mentionAll: false }, "mentionAll"), false);

  // Toggling on then off must return to the same object shape it started from, or the
  // form would stay permanently dirty with nothing left to save.
  const on = withOption({}, "mentionAll", true);
  assert.deepEqual(on, { mentionAll: true });
  assert.deepEqual(withOption(on, "mentionAll", false), {});
  assert.equal(Object.hasOwn(withOption({}, "mentionAll", false), "mentionAll"), false);
});

test("a value is trimmed on the way in", () => {
  assert.deepEqual(withTextOption({}, "keyword", "  报警  "), { keyword: "报警" });
});

test("a value of the wrong type reads as empty rather than being shown", () => {
  // The config file is editable by hand: `[object Object]` in a text box is a worse
  // answer than an empty one, and a crash is worse still.
  assert.equal(readTextOption({ keyword: 5 }, "keyword"), "");
  assert.equal(readTextOption({ keyword: null }, "keyword"), "");
  assert.equal(readTextOption({}, "keyword"), "");
  assert.deepEqual(readListOption({ atMobiles: "13800000000" }, "atMobiles"), []);
  assert.deepEqual(readListOption({ atMobiles: ["138", 139] }, "atMobiles"), ["138"]);
  assert.deepEqual(readListOption({}, "atMobiles"), []);
  assert.equal(readOption({ mentionAll: "yes" }, "mentionAll"), false);
});

test("a list survives every separator a Chinese keyboard produces", () => {
  const expected = ["13800000000", "13900000000"];
  assert.deepEqual(parseListOption("13800000000, 13900000000"), expected);
  assert.deepEqual(parseListOption("13800000000，13900000000"), expected);
  assert.deepEqual(parseListOption("13800000000、13900000000"), expected);
  assert.deepEqual(parseListOption("13800000000;13900000000"), expected);
  assert.deepEqual(parseListOption("13800000000 13900000000"), expected);
  assert.deepEqual(parseListOption("13800000000\n13900000000"), expected);
  // The same number twice would make the platform mention it twice.
  assert.deepEqual(parseListOption("13800000000, 13800000000"), ["13800000000"]);
  assert.deepEqual(parseListOption(""), []);
  assert.deepEqual(parseListOption("  , ； "), []);
  assert.equal(formatListOption(expected), "13800000000, 13900000000");
});

test("the list box does not fight the user mid-typing", () => {
  // Typing "138, " parses to one number, so the control's own echo comes back as
  // "138". Recognising that echo is what keeps the trailing separator on screen —
  // re-deriving the text from the parsed list would delete the comma as it is typed
  // and the second number could never be entered.
  assert.equal(listOptionTextIsCurrent("138, ", "138"), true);
  assert.equal(listOptionTextIsCurrent("138, 139", "138, 139"), true);
  assert.equal(listOptionTextIsCurrent("", ""), true);
  // Clearing the options — which a channel switch does — is not an echo, so it wins.
  assert.equal(listOptionTextIsCurrent("138, ", ""), false);
  assert.equal(listOptionTextIsCurrent("138, 139", ""), false);
});
