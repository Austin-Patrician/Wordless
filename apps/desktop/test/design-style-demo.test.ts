import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_STYLES } from "../src/main/design/style-catalog.ts";
import { parseThemeTokens } from "../src/renderer/features/design/style-tokens.ts";

/**
 * 示例页(`demo.html`)那几条约定的守卫。
 *
 * 同一份约定对两种来源都成立:**上游 25 套**由 `scripts/sync-design-styles.mjs` 检查后写入,
 * **自撰那 4 套**是手写的 —— 手写的那一半没有生成器兜着,所以约定必须在这里也钉一遍。
 * 生成器那侧的检查管"这次同步进来的对不对",这里管"进包的这份对不对"。
 */

/** 一份示例页里允许出现的唯一外链:内联 SVG 的 XML 命名空间,它不是请求。 */
function withoutNamespaces(html: string): string {
  return html.replaceAll("http://www.w3.org/", "");
}

/** 内联 data: URI 要先摘掉再查相对 url():编码过的 SVG 里可能出现 `url(%23n)` 这种文本。 */
function withoutDataUris(html: string): string {
  return html
    .replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/gi, "url(data:)")
    .replace(/url\(\s*data:[^)]*\)/gi, "url(data:)");
}

function declarations(css: string): Map<string, string> {
  return new Map([...css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

test("每一套风格都带一份够大的示例页", () => {
  for (const style of DESIGN_STYLES) {
    assert.ok(style.demoHtml.startsWith("<!doctype html>"), `${style.id} 的示例页不是完整文档`);
    assert.ok(style.demoHtml.length > 5_000, `${style.id} 的示例页只有 ${style.demoHtml.length} 字节`);
    assert.ok(style.demoHtml.length < 96 * 1024, `${style.id} 的示例页有 ${style.demoHtml.length} 字节`);
  }
});

test("示例页自包含:没有可执行、可联网、可引用外部资源的东西", () => {
  /*
    它会被放进 `sandbox` 的 iframe,而沙箱是**兜底** —— 这条断言说的是更硬的事实:这份 HTML
    里根本没有可执行或可联网的东西。上游明天在 demo 里加一段脚本,或者我们自己手写时顺手引一
    个字体,都该在这里停下来,而不是靠"反正沙箱挡着"。
  */
  for (const style of DESIGN_STYLES) {
    const html = style.demoHtml;
    for (const [label, hit] of [
      ["<script>", /<script/i.test(html)],
      ["<link>", /<link/i.test(html)],
      ["<iframe>", /<iframe/i.test(html)],
      ["<object>", /<object/i.test(html)],
      ["内联事件处理器", /\son[a-z]+\s*=/i.test(html)],
      ["@import", /@import/i.test(html)],
      ["@font-face", /@font-face/i.test(html)],
      ["外链", /https?:\/\//i.test(withoutNamespaces(html))],
      ["相对 url()", /url\(\s*(?!["']?(?:data:|#))/i.test(withoutDataUris(html))],
    ] as const) {
      assert.equal(hit, false, `${style.id} 的示例页里有 ${label}`);
    }
  }
});

test("示例页里的令牌与 theme.css 逐值一致", () => {
  /*
    同一套色的两份拷贝就有漂开的一天,而症状是"示例长这样、写进你设计里的却是另一套" —— 那正是
    这张卡要回答的问题被答错。

    只比**两边都声明过**的键:有的示例按设计省掉了零值圆角(用字面量 0),那不算漂移。
  */
  for (const style of DESIGN_STYLES) {
    const theme = declarations(/@theme[^{]*\{([\s\S]*?)\}/.exec(style.themeCss)?.[1] ?? style.themeCss);
    const demo = declarations(/:root\s*\{([\s\S]*?)\}/.exec(style.demoHtml)?.[1] ?? "");
    assert.ok(demo.size > 0, `${style.id} 的示例页没有 :root 令牌块`);
    for (const [name, value] of theme) {
      if (!demo.has(name)) continue;
      assert.equal(demo.get(name), value, `${style.id} 的 ${name} 与 theme.css 不一致`);
    }
  }
});

test("示例页能被缩略图同一套解析器读出令牌", () => {
  // 详情页的色板走 `parseThemeTokens(themeCss)`,而示例页自己内联了一份 `:root` —— 两者都得
  // 落在同一个解析器能读的形状里,否则会出现"详情有色板、示例里没颜色"。
  const style = DESIGN_STYLES[0]!;
  const tokens = parseThemeTokens(style.demoHtml);
  assert.ok(tokens.colors.surface, "示例页的 :root 没被解析器读出来");
  assert.ok(tokens.colors.primary);
});
