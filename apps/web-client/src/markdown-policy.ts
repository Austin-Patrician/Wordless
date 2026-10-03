/**
 * Markdown 的判定规则 —— **照抄桌面端的 `message-markdown-policy.ts`**。
 *
 * 单独一份 `.ts` 而不是留在 `markdown.tsx` 里,有两个理由:
 * 1. 它是纯函数,`node --test` 能直接测(`.tsx` 加载不了);
 * 2. 与桌面端同构 —— 那边也是 policy 与组件分开的。
 */

/** 注册过的语言(与组件里 `hljs.registerLanguage` 的那张表一致)。 */
export const HIGHLIGHT_LANGUAGE_NAMES: readonly string[] = [
	"bash", "c", "cpp", "csharp", "css", "diff", "go", "java", "javascript", "json",
	"markdown", "powershell", "python", "rust", "sql", "typescript", "xml", "yaml",
];

/**
 * 语言别名与显示名:**照抄桌面端的 `message-markdown-policy.ts`**。
 *
 * 这张表决定了"```sh 能不能高亮"、"代码块角上写的是 Bash 还是 BASH" ——
 * 两端不一样的话,同一段回答在两边看起来就是两个产品。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
	cxx: "cpp",
	cs: "csharp",
	csharp: "csharp",
	html: "html",
	js: "javascript",
	jsx: "javascript",
	md: "markdown",
	mermaid: "mermaid",
	ps1: "powershell",
	py: "python",
	rs: "rust",
	sh: "bash",
	shell: "bash",
	ts: "typescript",
	tsx: "typescript",
	svg: "svg",
	xml: "xml",
	yml: "yaml",
};

const LANGUAGE_LABELS: Record<string, string> = {
	bash: "Bash",
	c: "C",
	cpp: "C++",
	csharp: "C#",
	css: "CSS",
	diff: "Diff",
	html: "HTML",
	go: "Go",
	java: "Java",
	javascript: "JavaScript",
	json: "JSON",
	markdown: "Markdown",
	mermaid: "Mermaid",
	plaintext: "Plain text",
	powershell: "PowerShell",
	python: "Python",
	rust: "Rust",
	sql: "SQL",
	svg: "SVG",
	typescript: "TypeScript",
	xml: "XML",
	yaml: "YAML",
};

/** 归一后仍要是**注册过**的语言,否则不高亮(与桌面端同一套判断)。 */
export function normalizeLanguage(raw: string | undefined): string {
	const normalized = (raw ?? "").trim().toLowerCase().replace(/^language-/, "");
	if (normalized.length === 0) return "";
	const mapped = LANGUAGE_ALIASES[normalized] ?? normalized;
	return HIGHLIGHT_LANGUAGE_NAMES.includes(mapped) ? mapped : "";
}

export function codeLanguageLabel(language: string): string {
	if (language.length === 0) return "Plain text";
	return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}

/**
 * 流式过程中**代码围栏还没闭合**时,不要当代码块渲染。
 *
 * 否则每来一个字都要重新解析一次"围栏里的语言",代码块会不停变形;
 * 桌面端因此先把它当普通代码显示,闭合之后才按语言高亮。
 */
export function hasClosedCodeFence(text: string): boolean {
	let fences = 0;
	for (const line of text.split("\n")) if (line.trimStart().startsWith("```")) fences += 1;
	return fences % 2 === 0;
}

/** 外链只放行 http/https/mailto —— 与桌面端同一条安全规则(`javascript:` 之类一律拒)。 */
export function safeExternalUrl(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

