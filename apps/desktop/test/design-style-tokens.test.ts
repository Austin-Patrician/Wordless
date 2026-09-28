import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_STYLES } from "../src/main/design/style-catalog.ts";
import {
  FALLBACK_TOKENS,
  parseThemeTokens,
  resolveTokens,
  withAlpha,
} from "../src/renderer/features/design/style-tokens.ts";

test("从 @theme 块里读出颜色与圆角", () => {
  const tokens = parseThemeTokens(`@theme {
	--color-surface: #0b0c0e;
	--color-primary: #6366f1;
	--radius-xl: 10px;
}`);
  assert.deepEqual(tokens.colors, { surface: "#0b0c0e", primary: "#6366f1" });
  assert.deepEqual(tokens.radius, { xl: "10px" });
});

test("没有 @theme 块时退而扫全文", () => {
  // 手写的令牌文件未必按 Tailwind 的写法组织,而一张卡片画不出来不该让整个画廊空掉。
  const tokens = parseThemeTokens(`:root {
	--color-surface: #ffffff;
	--radius-md: 8px;
}`);
  assert.equal(tokens.colors.surface, "#ffffff");
  assert.equal(tokens.radius.md, "8px");
});

test("忽略注释与非法声明,而不是把它们当成令牌", () => {
  const tokens = parseThemeTokens(`@theme {
	/* --color-surface: #000000; */
	--color-primary: #4f46e5;
	--color-broken: ;
}`);
  assert.equal(tokens.colors.primary, "#4f46e5");
  assert.equal(tokens.colors.broken, undefined);
});

test("多行与无前导零的值都能读", () => {
  const tokens = parseThemeTokens(`@theme {
	--color-surface:
		#fdfcf9;
	--radius-sm: .25rem;
}`);
  assert.equal(tokens.colors.surface, "#fdfcf9");
  assert.equal(tokens.radius.sm, ".25rem");
});

test("缺令牌时给中性的兜底,卡片照常画出来", () => {
  const resolved = resolveTokens({ colors: {}, radius: {} });
  assert.equal(resolved.surface, FALLBACK_TOKENS.surface);
  assert.equal(resolved.primary, FALLBACK_TOKENS.primary);
  // 缺 raised 与 border 时现算一个同族值,而不是留空。
  assert.ok(resolved.surfaceRaised.includes("color-mix"));
  assert.ok(resolved.border.includes("color-mix"));
});

test("缩略图里的圆角按比例缩小", () => {
  // 240px 宽的缩略图上按原值画 24px 圆角会像药丸,风格之间的圆角差异就失真了。
  const resolved = resolveTokens(parseThemeTokens(`@theme { --radius-xl: 24px; --radius-md: 8px; }`));
  assert.equal(resolved.radius("xl", "10px"), "12px");
  assert.equal(resolved.radius("md", "6px"), "4px");
});

test("圆角单位跟着原值走", () => {
  const resolved = resolveTokens(parseThemeTokens(`@theme { --radius-sm: 0.5rem; }`));
  assert.equal(resolved.radius("sm", "4px"), "0.25rem");
});

test("圆角非法或缺失时用兜底值", () => {
  const resolved = resolveTokens(parseThemeTokens(`@theme { --radius-lg: auto; }`));
  assert.equal(resolved.radius("lg", "8px"), "8px");
  assert.equal(resolved.radius("none", "8px"), "8px");
});

test("半透明用 color-mix 现算,不解析颜色格式", () => {
  assert.equal(withAlpha("#6366f1", 30), "color-mix(in srgb, #6366f1 30%, transparent)");
  // 越界被夹住。
  assert.equal(withAlpha("red", 500), "color-mix(in srgb, red 100%, transparent)");
  assert.equal(withAlpha("red", -5), "color-mix(in srgb, red 0%, transparent)");
});

test("每一套内置风格都真的声明了令牌,而不是靠兜底", () => {
  // 这一条是"目录写了但卡片画不出来"的防线:漏写令牌时卡片会静默退成中性色,画廊里就
  // 会出现好几张看起来一样的卡。
  //
  // 断言**原始解析结果**而不是解析后的值:兜底值本身可能就是 `#ffffff`,拿它比不出
  // "声明了白色"与"什么都没声明"的区别。
  for (const style of DESIGN_STYLES) {
    const tokens = parseThemeTokens(style.themeCss);
    assert.ok(tokens.colors.surface, `${style.id} 没声明 --color-surface`);
    assert.ok(tokens.colors.primary, `${style.id} 没声明 --color-primary`);
    assert.ok(style.designMd.trim().length > 0, `${style.id} 的 DESIGN.md 是空的`);
    assert.ok(style.tagline.trim().length > 0, `${style.id} 没有一句话说明`);
  }
});

test("每一套内置风格都带齐最小令牌集", () => {
  const required = ["surface", "surface-foreground", "primary", "muted"] as const;
  for (const style of DESIGN_STYLES) {
    const tokens = parseThemeTokens(style.themeCss);
    for (const name of required) {
      assert.ok(tokens.colors[name], `${style.id} 缺 --color-${name}`);
    }
  }
});

test("风格 id 唯一", () => {
  const ids = DESIGN_STYLES.map((style) => style.id);
  assert.equal(new Set(ids).size, ids.length);
});
