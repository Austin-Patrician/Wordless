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

test("@theme static 也是块,块里的值胜过块外的同名声明", () => {
  // 这条钉的是块匹配本身。`@theme static {` 认不出来时解析器会**静默退到扫全文**,结果
  // 照样有值 —— 所以断言必须能区分这两条路:块外那句同名声明只在"没认出块"时才会赢。
  const tokens = parseThemeTokens(`@theme static {
	--color-primary: #4f46e5;
}

:root {
	--color-primary: #111111;
}`);
  assert.equal(tokens.colors.primary, "#4f46e5");
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

test("每一套内置风格都用 @theme static", () => {
  /*
    Tailwind 4 默认**只发出被用到的**主题变量:声明了 9 个 `--color-*`、帧里的类只用上 3 个
    时,产物里就只有那 3 个 —— 于是帧里手写 `var(--color-primary)` 会静默取不到值,而
    症状是"颜色没了",没人会想到是声明没发出来。实测(真编译器,候选只有 `bg-surface`):

        @theme         → 发出的 color 变量: --color-surface
        @theme static  → 发出的 color 变量: --color-primary, --color-surface, --color-danger

    所以这是**写下来的约定**,不是风格偏好:29 套 + 脚手架 + 上游生成器都必须是 static。
    上游那 25 套由 `scripts/sync-design-styles.mjs` 转换,漏了这一步会让它们全部退回去。
  */
  for (const style of DESIGN_STYLES) {
    assert.ok(style.themeCss.includes("@theme static {"), `${style.id} 的 theme.css 不是 @theme static`);
    assert.ok(!/@theme\s*\{/.test(style.themeCss), `${style.id} 的 theme.css 里还有不带 static 的 @theme`);
  }
});

test("分类是 key,不是展示串", () => {
  // 它过去是"产品界面"这样的中文展示串。29 套之后分类是用户扫视的入口,展示文案归 i18n ——
  // 中文串混进来的话,英文界面会显示中文,而这里是最便宜的拦截点。
  for (const style of DESIGN_STYLES) {
    assert.match(style.category, /^[a-z][a-z-]*$/, `${style.id} 的 category 不是 key:${style.category}`);
  }
});

test("DESIGN.md 不引用没随包发布的文件", () => {
  // 上游每套还带一份成品 `demo.html`,我们没有取它(缩略图用令牌现画)。正文里那句
  // "…ships alongside this spec as `demo.html`" 于是会指向一个不存在的文件,而 agent 会
  // 照着去读 —— 生成脚本删掉了它,这一条守住"别再溜回来"。
  for (const style of DESIGN_STYLES) {
    for (const missing of ["demo.html", "preview.html", "preview-dark.html"]) {
      assert.ok(!style.designMd.includes(missing), `${style.id} 的 DESIGN.md 引用了不存在的 ${missing}`);
    }
    assert.ok(/^# \S/.test(style.designMd), `${style.id} 的 DESIGN.md 没有 H1`);
    assert.ok(!style.designMd.includes("Vetta"), `${style.id} 的 DESIGN.md 里有上游产品名`);
  }
});
