import assert from "node:assert/strict";
import test from "node:test";
import { designAccent } from "../src/renderer/features/design/design-accent.ts";
import { filterDesigns, relativeTimeParts, sortDesigns } from "../src/renderer/features/design/design-recency.ts";

/**
 * 「我的设计」列表的两件事:**最近改动的在前**,以及每张卡上那句人话的时间。
 *
 * 两个都是"算错也看不出来"的那种:顺序错了用户只会以为自己记错了,时间档位错了则是一句读起来
 * 没毛病、实际差一档的话。所以它们住在纯函数里,被这些边界钉着。
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

test("相对时间在每一档的边界上跳到该跳的那一档", () => {
  assert.deepEqual(relativeTimeParts(NOW, NOW - 30 * 1000), { unit: "now" });
  // 59 分钟还是"59 分钟前";61 分钟就该是"1 小时前" —— 差一分钟和差一小时不是同一件事。
  assert.deepEqual(relativeTimeParts(NOW, NOW - 59 * MINUTE), { unit: "minutes", value: 59 });
  assert.deepEqual(relativeTimeParts(NOW, NOW - 61 * MINUTE), { unit: "hours", value: 1 });
  assert.deepEqual(relativeTimeParts(NOW, NOW - 23 * HOUR), { unit: "hours", value: 23 });
  assert.deepEqual(relativeTimeParts(NOW, NOW - 25 * HOUR), { unit: "days", value: 1 });
  assert.deepEqual(relativeTimeParts(NOW, NOW - 7 * DAY), { unit: "days", value: 7 });
});

test("超过一周换成日期 —— 「37 天前」只是让用户再做一次换算", () => {
  const parts = relativeTimeParts(NOW, NOW - 8 * DAY);
  assert.deepEqual(parts, { unit: "date", at: NOW - 8 * DAY });
});

test("未来时间与「不知道」都不会算出负数天", () => {
  // 时钟回拨、或者磁盘上有个未来时间戳:当成"刚刚"。
  assert.deepEqual(relativeTimeParts(NOW, NOW + 5 * MINUTE), { unit: "now" });
  // 0 = 算不出来(见 `latestModified`)。它不当"刚改过",也不该是"很久以前"。
  assert.deepEqual(relativeTimeParts(NOW, 0), { unit: "date", at: 0 });
  assert.deepEqual(relativeTimeParts(NOW, Number.NaN), { unit: "date", at: 0 });
});

test("三种排序:最近改动 / 名字 / 画面数", () => {
  /*
    默认是最近改动(回到这一页最常要的就是"我刚弄过的那份"),另外两种是"我知道它叫什么"和
    "我记得它挺大"。
  */
  const fields = (name: string, updatedAt: number, frameCount: number, source = "w") => ({
    name,
    updatedAt,
    frameCount,
    source,
  });
  const items = [fields("beta", 300, 2), fields("alpha", 100, 9), fields("gamma", 200, 5)];
  const names = (mode: "recent" | "name" | "frames"): string[] =>
    sortDesigns(items, mode, (item) => item).map((item) => item.name);

  assert.deepEqual(names("recent"), ["beta", "gamma", "alpha"]);
  assert.deepEqual(names("name"), ["alpha", "beta", "gamma"]);
  assert.deepEqual(names("frames"), ["alpha", "gamma", "beta"]);
});

test("筛:名字与来源都算,大小写不敏感", () => {
  const fields = (name: string, source: string) => ({ name, updatedAt: 1, frameCount: 1, source });
  const items = [fields("Meadow", "My project"), fields("landing", "垃圾分类"), fields("other", "w")];

  // 名字(大小写不敏感)。
  assert.deepEqual(
    filterDesigns(items, "mead", (item) => item).map((item) => item.name),
    ["Meadow"],
  );
  // 来源也算:用户说的是"那个会话里的设计"。
  assert.deepEqual(
    filterDesigns(items, "垃圾", (item) => item).map((item) => item.name),
    ["landing"],
  );
  // 空查询(或只有空白)是"没在搜",不是"搜不到"。
  assert.deepEqual(filterDesigns(items, "  ", (item) => item).length, 3);
  // 不匹配就是空 —— 而且不改原数组。
  assert.deepEqual(filterDesigns(items, "zzz", (item) => item), []);
  assert.equal(items.length, 3);
});

test("列表按最近改动倒序,不知道时间的排在最后", () => {
  const listFieldsOf = (entry: { design: { name: string; updatedAt: number } }) => ({
    ...entry.design,
    frameCount: 0,
    source: "",
  });
  const entries = [
    { design: { name: "b", updatedAt: NOW - 2 * DAY } },
    { design: { name: "a", updatedAt: NOW } },
    { design: { name: "c", updatedAt: NOW - 2 * HOUR } },
    // 读不出来的包:`updatedAt` 是 0。它不该占着第一屏。
    { design: { name: "broken", updatedAt: 0 } },
  ];

  assert.deepEqual(
    sortDesigns(entries, "recent", listFieldsOf).map((entry) => entry.design.name),
    ["a", "c", "b", "broken"],
  );
});

test("同一时间里按名字,于是顺序是确定的", () => {
  // 不确定的排序会让同样的磁盘状态排出不同顺序 —— 那是测试偶发,也是用户眼里"它自己乱换位"。
  const same = [
    { name: "zeta", updatedAt: NOW },
    { name: "alpha", updatedAt: NOW },
    { name: "mid", updatedAt: NOW },
  ];
  assert.deepEqual(
    sortDesigns(same, "recent", (item) => ({ ...item, frameCount: 0, source: "" })).map((item) => item.name),
    ["alpha", "mid", "zeta"],
  );
  // 而且不改原数组(调用方可能还拿着它)。
  assert.deepEqual(same.map((item) => item.name), ["zeta", "alpha", "mid"]);
});

test("卡片底色取这份设计自己的主色", () => {
  const style = (themeCss: string) => ({ themeCss }) as never as Parameters<typeof designAccent>[0];

  // 主色优先。
  assert.equal(designAccent(style("@theme { --color-primary: #4f46e5; --color-accent: #0ea5e9; }")), "#4f46e5");
  // 没有 primary 就用 accent。
  assert.equal(designAccent(style("@theme { --color-accent: #0ea5e9; }")), "#0ea5e9");
  // 名字带前缀也认(`--color-brand-primary` 这类写法)。
  assert.equal(designAccent(style("@theme { --color-brand-primary: #16a34a; }")), "#16a34a");
  // 一个颜色都没有:交给卡片兜底,而不是编一个。
  assert.equal(designAccent(style("@theme { --radius: 8px; }")), null);
  assert.equal(designAccent(null), null);
  // 透明不能当底色:封面区会变成一块看不出边界的空白。
  assert.equal(designAccent(style("@theme { --color-primary: transparent; }")), null);
});
