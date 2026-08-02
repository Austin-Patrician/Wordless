import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeMessageMath } from "../src/renderer/features/thread/message-markdown-math.ts";

function renderMath(markdown: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    children: normalizeMessageMath(markdown),
    rehypePlugins: [[rehypeKatex, { errorColor: "#a85a4f", throwOnError: false, trust: false, strict: false }]],
    remarkPlugins: [remarkMath],
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

test("keeps incomplete and ordinary dollar text readable", () => {
  const incomplete = renderMath("Streaming $$I = U/R");
  const currency = renderMath("The plans cost $5 and $10 respectively.");
  const numericFormula = renderMath("The estimate is $5 + x$.");

  assert.doesNotMatch(incomplete, /class="katex-display"/);
  assert.match(incomplete, /\$\$I = U\/R/);
  assert.doesNotMatch(currency, /class="katex"/);
  assert.match(currency, /\$5 and \$10/);
  assert.match(numericFormula, /class="katex"/);
});

test("renders invalid LaTeX as a non-fatal KaTeX error", () => {
  const html = renderMath("$$\\notARealCommand{x}$$");

  assert.match(html, /class="katex-display"/);
  assert.match(html, /notARealCommand/);
});

test("does not normalize math-like text inside fenced code", () => {
  const source = "```markdown\n$$I = U/R$$\nThe plans cost $5 and $10.\n```";

  assert.equal(normalizeMessageMath(source), source);
});
