import assert from "node:assert/strict";
import test from "node:test";
import { codeLanguageLabel, hasClosedCodeFence, isOversizedMermaid, markdownUrlTransform, normalizeCodeLanguage, safeExternalUrl, safeRemoteImageUrl } from "../src/renderer/features/thread/message-markdown-policy.ts";

test("normalizes common fenced-code language aliases", () => {
  assert.equal(normalizeCodeLanguage("language-tsx"), "typescript");
  assert.equal(normalizeCodeLanguage("PS1"), "powershell");
  assert.equal(normalizeCodeLanguage(undefined), "plaintext");
  assert.equal(codeLanguageLabel("cpp"), "C++");
});

test("allows only browser-safe external URL protocols", () => {
  assert.equal(safeExternalUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(safeExternalUrl("mailto:team@example.com"), "mailto:team@example.com");
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("file:///C:/secrets.txt"), null);
  assert.equal(markdownUrlTransform("https://example.com", "href"), "https://example.com/");
});

test("requires an explicit action before loading HTTPS-only remote images", () => {
  assert.equal(safeRemoteImageUrl("https://images.example.com/chart.png"), "https://images.example.com/chart.png");
  assert.equal(safeRemoteImageUrl("http://images.example.com/chart.png"), null);
  assert.equal(safeRemoteImageUrl("data:image/png;base64,AAAA"), null);
  assert.equal(markdownUrlTransform("https://images.example.com/chart.png", "src"), "https://images.example.com/chart.png");
});

test("distinguishes closed and streaming fenced code blocks", () => {
  const closed = "```mermaid\ngraph TD\nA-->B\n```";
  const streaming = "```mermaid\ngraph TD\nA-->B";
  assert.equal(hasClosedCodeFence(closed, 0, closed.length), true);
  assert.equal(hasClosedCodeFence(streaming, 0, streaming.length), false);
  assert.equal(hasClosedCodeFence("~~~js\nalert(1)\n~~~~", 0, 21), true);
});

test("rejects Mermaid sources that exceed rendering limits", () => {
  assert.equal(isOversizedMermaid("graph TD\nA-->B"), false);
  assert.equal(isOversizedMermaid("x".repeat(20_001)), true);
  assert.equal(isOversizedMermaid(Array.from({ length: 301 }, () => "A-->B").join("\n")), true);
});
