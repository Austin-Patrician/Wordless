import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeLanguageLabel, hasClosedCodeFence, normalizeLanguage, safeExternalUrl } from "../src/markdown-policy.ts";
import { isOversizedMermaid } from "../src/mermaid.ts";

/**
 * Markdown 策略 —— **照抄桌面端的 `message-markdown-policy.ts`**。
 *
 * 这张表决定了"```sh 能不能高亮"、"角上写的是 Bash 还是 BASH"、"这个链接能不能点"。
 * 两端不一样的话,同一段回答在两边看起来就是两个产品。
 */

describe("代码语言", () => {
	it("别名按桌面端那张表归一", () => {
		assert.equal(normalizeLanguage("sh"), "bash");
		assert.equal(normalizeLanguage("shell"), "bash");
		assert.equal(normalizeLanguage("rs"), "rust");
		assert.equal(normalizeLanguage("cxx"), "cpp");
		assert.equal(normalizeLanguage("language-ts"), "typescript");
	});

	it("没注册过的语言不高亮(而不是瞎猜)", () => {
		assert.equal(normalizeLanguage("brainfuck"), "");
		assert.equal(normalizeLanguage(undefined), "");
	});

	it("显示名与桌面端一致", () => {
		assert.equal(codeLanguageLabel("bash"), "Bash");
		assert.equal(codeLanguageLabel("cpp"), "C++");
		assert.equal(codeLanguageLabel("json"), "JSON");
		assert.equal(codeLanguageLabel(""), "Plain text");
		assert.equal(codeLanguageLabel("brainfuck"), "BRAINFUCK");
	});
});

describe("流式中的代码围栏", () => {
	it("围栏没闭合时不当代码块渲染(否则每来一个字都在变形)", () => {
		assert.equal(hasClosedCodeFence("```ts\nconst a = 1"), false);
		assert.equal(hasClosedCodeFence("```ts\nconst a = 1\n```"), true);
	});

	it("没有围栏算闭合", () => {
		assert.equal(hasClosedCodeFence("就是一句话"), true);
	});
});

describe("链接安全", () => {
	it("只放行 http/https/mailto", () => {
		assert.equal(safeExternalUrl("https://example.com/a"), "https://example.com/a");
		assert.equal(safeExternalUrl("mailto:me@example.com"), "mailto:me@example.com");
	});

	it("javascript: 之类一律拒(与桌面端同一条规则)", () => {
		assert.equal(safeExternalUrl("javascript:alert(1)"), undefined);
		assert.equal(safeExternalUrl("data:text/html,<script>"), undefined);
		assert.equal(safeExternalUrl("不是地址"), undefined);
		assert.equal(safeExternalUrl(undefined), undefined);
	});
});

describe("图表源码的上限", () => {
	it("太长或行数太多就不渲染(与桌面端同一阈值)", () => {
		assert.equal(isOversizedMermaid("graph TD;\n A-->B;"), false);
		assert.equal(isOversizedMermaid("x".repeat(20_001)), true);
		assert.equal(isOversizedMermaid(Array.from({ length: 301 }, () => "A").join("\n")), true);
	});
});
