import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_STYLES } from "../src/main/design/style-catalog.ts";
import { messages, type MessageKey } from "../src/renderer/shared/i18n.ts";
import {
  DESIGN_STYLE_CATEGORY_KEYS,
  DESIGN_STYLE_NAME_KEYS,
  DESIGN_STYLE_TAGLINE_KEYS,
  designStyleActionLabel,
  designStyleCopy,
} from "../src/renderer/features/design/style-copy.ts";

/**
 * 目录(主进程)与展示文案(渲染层 i18n)之间那道缝。
 *
 * 这两侧刻意不互相 import:目录是主进程的数据,渲染层只认 IPC 契约(`DesignStyleSummaryDto`),
 * 一张卡片能不能画不该依赖"目录里有什么"。代价是**没有编译期把两侧焊在一起**,于是焊接点
 * 落在这里 —— 加一套风格只写目录、忘了写文案,这一组断言会红。
 *
 * 与 `session-history.test.ts` 里 `WORKBENCH_LABEL_KEYS` 那条同一形状。
 */

const LOCALES = ["zh-CN", "en-US"] as const;

function copyFor(locale: (typeof LOCALES)[number], key: MessageKey): string {
  const value = (messages[locale] as Record<string, string>)[key];
  assert.ok(typeof value === "string" && value.trim() !== "", `${locale}.${key} is missing or empty`);
  return value;
}

test("每一套风格都有名字与一句话,且两个 locale 都非空", () => {
  for (const style of DESIGN_STYLES) {
    const nameKey = DESIGN_STYLE_NAME_KEYS[style.id];
    const taglineKey = DESIGN_STYLE_TAGLINE_KEYS[style.id];
    assert.ok(nameKey, `${style.id} 没有名字的文案 key`);
    assert.ok(taglineKey, `${style.id} 没有一句话的文案 key`);
    for (const locale of LOCALES) {
      copyFor(locale, nameKey);
      copyFor(locale, taglineKey);
    }
  }
});

test("每一个分类都有译文", () => {
  // 分类是用户扫视的入口:漏一个就会在卡片上露出 `dev` 这样的裸 key。
  const categories = new Set(DESIGN_STYLES.map((style) => style.category));
  for (const category of categories) {
    const key = DESIGN_STYLE_CATEGORY_KEYS[category];
    assert.ok(key, `分类 ${category} 没有译文 key`);
    for (const locale of LOCALES) copyFor(locale, key);
  }
});

test("文案表里没有多余的、也没有重复的键", () => {
  const ids = new Set(DESIGN_STYLES.map((style) => style.id));
  for (const id of Object.keys(DESIGN_STYLE_NAME_KEYS)) {
    assert.ok(ids.has(id), `名字表里的 ${id} 不在目录里`);
  }
  for (const id of Object.keys(DESIGN_STYLE_TAGLINE_KEYS)) {
    assert.ok(ids.has(id), `一句话表里的 ${id} 不在目录里`);
  }
  // 两套风格共用一个 key 会静默显示同一句话 —— 单看非空是查不出来的。
  const nameKeys = Object.values(DESIGN_STYLE_NAME_KEYS);
  assert.equal(new Set(nameKeys).size, nameKeys.length, "有风格共用了名字 key");
  const taglineKeys = Object.values(DESIGN_STYLE_TAGLINE_KEYS);
  assert.equal(new Set(taglineKeys).size, taglineKeys.length, "有风格共用了一句话 key");

  const categories = new Set(DESIGN_STYLES.map((style) => style.category));
  for (const category of Object.keys(DESIGN_STYLE_CATEGORY_KEYS)) {
    assert.ok(categories.has(category), `分类表里的 ${category} 不在目录里`);
  }
});

test("查得到就给译文,查不到就回落到目录里那份兜底值", () => {
  const known = DESIGN_STYLES[0]!;
  const t = (key: MessageKey): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

  const resolved = designStyleCopy(known, t);
  assert.equal(resolved.name, (messages["zh-CN"] as Record<string, string>)[DESIGN_STYLE_NAME_KEYS[known.id]!]);
  assert.notEqual(resolved.category, known.category, "分类该显示成译文,而不是 key 本身");

  // 目录里没有的 id(DTO 是 `string`,将来接了远端条目就会走到这里)。
  const unknown = { id: "not-a-style", name: "Projected", tagline: "fallback tagline", category: "whatever" };
  assert.deepEqual(designStyleCopy(unknown, t), {
    name: "Projected",
    tagline: "fallback tagline",
    category: "whatever",
  });

  // 有 key 但没有译文:`translate` 会返回 undefined,这里必须挡住,不能把裸 key 露到界面上。
  const key = DESIGN_STYLE_NAME_KEYS[known.id]!;
  const undefinedT = (incoming: MessageKey): string =>
    incoming === key ? (undefined as unknown as string) : t(incoming);
  assert.equal(designStyleCopy(known, undefinedT).name, known.name);
});

test("卡片的无障碍名字把占位符填干净", () => {
  const t = (key: MessageKey): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;
  const copy = { name: "Linear", tagline: "t", category: "c" };

  for (const label of [designStyleActionLabel(copy, undefined, t), designStyleActionLabel(copy, "选中", t)]) {
    assert.ok(label.includes("Linear"), label);
    assert.ok(!label.includes("{"), `占位符没填干净:${label}`);
  }
});
