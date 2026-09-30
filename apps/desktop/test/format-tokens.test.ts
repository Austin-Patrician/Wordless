import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenCount } from "../src/renderer/shared/format-tokens.ts";

test("token 数字:千位以下给精确值,千位以上给 K,百万以上给 M", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_000), "1K");
  assert.equal(formatTokenCount(1_500), "1.5K");
  assert.equal(formatTokenCount(18_200), "18.2K");
  assert.equal(formatTokenCount(999_000), "999K");
  // 大数不能一直挤在 K 里 —— 用户要的就是这一档。
  assert.equal(formatTokenCount(1_000_000), "1M");
  assert.equal(formatTokenCount(2_400_000), "2.4M");
});

test("四舍五入到一位小数后不出现四位数字(K 溢出到 M)", () => {
  // 999_949 保留一位小数是 999.9K,还是三位数,留在 K。
  assert.equal(formatTokenCount(999_949), "999.9K");
  // 999_950 会变成 1000.0K —— 改报 1M。
  assert.equal(formatTokenCount(999_950), "1M");
  assert.equal(formatTokenCount(1_000_400), "1M");
});

test("异常输入不产生 NaN 之类的文案", () => {
  assert.equal(formatTokenCount(Number.NaN), "0");
  assert.equal(formatTokenCount(Number.POSITIVE_INFINITY), "0");
});
