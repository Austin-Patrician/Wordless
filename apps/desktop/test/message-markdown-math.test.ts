import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { remarkWordlessMath } from "../src/renderer/features/thread/message-markdown-math.ts";

function renderMath(markdown: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    children: markdown,
    rehypePlugins: [[rehypeKatex, { errorColor: "#a85a4f", throwOnError: false, trust: false, strict: false }]],
    remarkPlugins: [remarkMath, remarkWordlessMath],
    skipHtml: true,
  }));
}

test("renders inline and display LaTeX with KaTeX", () => {
  const html = renderMath("Inline $I = U/R$.\n\n$$I_{总} = \\frac{U}{R1 \\parallel r}$$");

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /mfrac/);
  assert.match(html, /总/);
});

test("preserves CJK text inside a formula", () => {
  const html = renderMath("$$I_{总} \\approx \\frac{U}{r} \\quad (\\text{巨大！})$$");

  assert.match(html, /巨大！/);
  assert.match(html, /class="katex-display"/);
});

test("renders TeX inline and display delimiters", () => {
  const html = renderMath("求电流：\\( I = \\frac{V}{R} \\)\n\n\\[\nR = \\frac{V}{I}\n\\]");

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /mfrac/);
  assert.doesNotMatch(html, /<p>求电流：\\\(/);
});

test("renders same-line double-dollar math as display math", () => {
  const html = renderMath("Before.\n\n$$R = \\frac{V}{I}$$\n\nAfter.");

  assert.match(html, /class="katex-display"/);
  assert.match(html, /mfrac/);
});

test("keeps incomplete and ordinary dollar text readable", () => {
  const incomplete = renderMath("Streaming $$I = U/R");
  const incompleteTex = renderMath("Streaming \\(I = U/R");
  const currency = renderMath("The plans cost $5 and $10 respectively.");
  const nestedCurrency = renderMath("The **plans cost $5 and $10** respectively.");
  const numericFormula = renderMath("The estimate is $5 + x$.");

  assert.doesNotMatch(incomplete, /class="katex-display"/);
  assert.match(incomplete, /\$\$I = U\/R/);
  assert.doesNotMatch(incompleteTex, /class="katex"/);
  assert.match(incompleteTex, /\\\(I = U\/R/);
  assert.doesNotMatch(currency, /class="katex"/);
  assert.match(currency, /\$5 and \$10/);
  assert.doesNotMatch(nestedCurrency, /class="katex"/);
  assert.match(nestedCurrency, /\$5 and \$10/);
  assert.match(numericFormula, /class="katex"/);
});

test("keeps escaped TeX delimiters literal", () => {
  const html = renderMath("Literal \\\\(I = U/R\\\\) and \\\\[R = V/I\\\\].");

  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /\\\(I = U\/R\\\)/);
  assert.match(html, /\\\[R = V\/I\\\]/);
});

test("renders invalid LaTeX as a non-fatal KaTeX error", () => {
  const html = renderMath("$$\\notARealCommand{x}$$");

  assert.match(html, /class="katex-display"/);
  assert.match(html, /notARealCommand/);
});

test("does not parse math-like text inside code", () => {
  const source = "```markdown\n$$I = U/R$$\nThe plans cost $5 and $10.\n```";
  const fenced = renderMath(source);
  const inline = renderMath("`\\(I = U/R\\)`");

  assert.doesNotMatch(fenced, /class="katex"/);
  assert.match(fenced, /\$\$I = U\/R\$\$/);
  assert.doesNotMatch(inline, /class="katex"/);
  assert.match(inline, /\\\(I = U\/R\\\)/);
});
