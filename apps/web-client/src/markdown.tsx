import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Check, Code2, Copy } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
// KaTeX 的样式必须显式引入:token 级别的排版规则都在它里面(公式里的字号、上下标、间距)。
import "katex/dist/katex.min.css";
import { Eye, LoaderCircle, Maximize2 } from "lucide-react";
import { isOversizedMermaid, renderMermaid, type MermaidTheme } from "./mermaid";
import { codeLanguageLabel, hasClosedCodeFence, normalizeLanguage, safeExternalUrl } from "./markdown-policy";
import "./markdown/message-markdown.css";

/**
 * 消息正文的渲染。
 *
 * 与桌面端**同一条管线**:`react-markdown` + `remark-gfm`,代码用 `highlight.js` 显式注册同一批语言。
 * 样式也用的是同一份 CSS(`markdown/message-markdown.css`,从桌面端复制的)——
 * 所以"渲染结果一致"不是靠对齐参数,而是靠同一份资源。
 *
 * 这里**不做** mermaid 与 KaTeX:远端主要用于"看进展、接着对话",而两者体积都不小。
 * 等真的有人在手机上看图表再加(见 docs/architecture/remote-web-client.md §4)。
 */

const HIGHLIGHT_LANGUAGES = { bash, c, cpp, csharp, css, diff, go, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml };
for (const [name, definition] of Object.entries(HIGHLIGHT_LANGUAGES)) hljs.registerLanguage(name, definition);

export function MessageMarkdown({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }) {
	const components = useMemo<Components>(
		() => ({
			// 标题必须**显式给字号字重**:Tailwind 的 preflight 把 h1-h6 重置成"继承",
			// 不给的话 `##` 看起来和正文一模一样(用户报的就是这个)。
			h1: ({ children }) => (
				<h1 className="mt-6 mb-2 text-[18px] leading-7 font-bold text-[#30302d] first:mt-0 dark:text-foreground">
					{children}
				</h1>
			),
			h2: ({ children }) => (
				<h2 className="mt-6 mb-2 text-[16px] leading-6 font-bold text-[#343431] first:mt-0 dark:text-foreground">
					{children}
				</h2>
			),
			h3: ({ children }) => (
				<h3 className="mt-5 mb-1.5 text-[15px] leading-6 font-semibold text-[#383834] first:mt-0 dark:text-foreground">
					{children}
				</h3>
			),
			h4: ({ children }) => (
				<h4 className="mt-4 mb-1.5 text-[14px] leading-6 font-semibold text-[#41413d] first:mt-0 dark:text-foreground">
					{children}
				</h4>
			),
			h5: ({ children }) => (
				<h5 className="mt-4 mb-1 text-[13px] leading-5 font-semibold text-[#484843] first:mt-0 dark:text-foreground">
					{children}
				</h5>
			),
			h6: ({ children }) => (
				<h6 className="mt-4 mb-1 text-[12px] leading-5 font-semibold text-[#555550] first:mt-0 dark:text-foreground">
					{children}
				</h6>
			),
			p: ({ children }) => (
				<p className="my-3 text-[14px] leading-6 break-words text-[#51514d] first:mt-0 last:mb-0 dark:text-muted-foreground">
					{children}
				</p>
			),
			ul: ({ children }) => <ul className="my-3 list-disc space-y-0.5 pl-6">{children}</ul>,
			ol: ({ children }) => <ol className="my-3 list-decimal space-y-0.5 pl-6">{children}</ol>,
			li: ({ children }) => (
				<li className="my-1 pl-0.5 text-[14px] leading-6 text-[#51514d] marker:text-[#8a9a7a] dark:text-muted-foreground dark:marker:text-[#84946f]">
					{children}
				</li>
			),
			blockquote: ({ children }) => (
				<blockquote className="my-4 border-l-2 border-[#b9c7a8] py-1 pr-2 pl-3.5 text-[#62685b] dark:border-[#647253] dark:text-[#c6cdbb]">
					{children}
				</blockquote>
			),
			hr: () => <hr className="my-5 border-0 border-t border-[#dfdfda] dark:border-border" />,
			table: ({ children }) => (
				<div className="message-markdown-table my-4 overflow-x-auto rounded-[6px] border border-[#e0e0db] dark:border-border">
					<table className="w-full min-w-max border-collapse text-left text-[12px]">{children}</table>
				</div>
			),
			code({ className, children, ...rest }) {
				const content = String(children ?? "");
				const match = /language-([\w+#-]+)/.exec(className ?? "");
				// mermaid 不在 highlight 的语言表里(它不是代码,是图表):要**在归一之前**拦下来。
				if (match?.[1]?.toLowerCase() === "mermaid") {
					return <MermaidBlock closed={!streaming || hasClosedCodeFence(text)} source={content.replace(/\n$/, "")} />;
				}
				// 行内代码没有 language-*,也不该被包成代码块。
				if (!match && !content.includes("\n")) {
					return (
						<code
							className="rounded-[4px] bg-[#eeeeea] px-1 py-0.5 font-mono text-[12px] text-[#43433f] dark:bg-[#2c2e29] dark:text-[#d9ddd3]"
							{...rest}
						>
							{content}
						</code>
					);
				}
				return (
					<CodeBlock
						code={content.replace(/\n$/, "")}
						language={normalizeLanguage(match?.[1])}
						// 流式过程中围栏还没闭合时不高亮:否则每来一个字都要重算一次语言,代码块会不停变形。
						highlight={!streaming || hasClosedCodeFence(text)}
					/>
				);
			},
			// 外链一律新窗口打开(远端是网页,导航走了就丢了会话),而且**只放行安全的协议**。
			a({ href, children }) {
				const safe = safeExternalUrl(href);
				if (safe === undefined) return <span>{children}</span>;
				return (
					<a
						href={safe}
						rel="noreferrer noopener"
						target="_blank"
						className="font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f6230] dark:text-[#c3df8a] dark:decoration-[#667b46] dark:hover:text-[#d8efa8]"
					>
						{children}
					</a>
				);
			},
		}),
		[streaming, text],
	);

	return (
		<div className="message-markdown">
			<ReactMarkdown
				components={components}
				remarkPlugins={[remarkGfm, remarkMath]}
				rehypePlugins={[rehypeKatex]}
				skipHtml
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/**
 * 图表块。
 *
 * 与桌面端同一套:预览 / 源码两个视图、复制源码、渲染中与失败都有明确说法。
 * 渲染是**懒加载**的(`./mermaid`),所以没图表的会话不会为它付钱。
 */
function MermaidBlock({ closed, source }: { readonly closed: boolean; readonly source: string }) {
	const theme = useResolvedTheme();
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [svg, setSvg] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [fullscreen, setFullscreen] = useState(false);
	const oversized = isOversizedMermaid(source);
	useEffect(() => {
		// 流式过程中围栏还没闭合、或者源码过大:都不渲染(每来一个字重排一次图表没有意义)。
		if (!closed || oversized) {
			setSvg(undefined);
			setError(undefined);
			return;
		}
		let cancelled = false;
		setSvg(undefined);
		setError(undefined);
		void renderMermaid(source, theme)
			.then((value) => {
				if (!cancelled) setSvg(value);
			})
			.catch((failure: unknown) => {
				if (!cancelled) setError(failure instanceof Error ? failure.message : "渲染失败");
			});
		return () => {
			cancelled = true;
		};
	}, [closed, oversized, source, theme]);
	if (!closed) return <CodeBlock code={source} highlight={false} language="" />;
	return (
		<section className="my-4 overflow-hidden rounded-[7px] border border-[#deded9] dark:border-border">
			<header className="flex h-8 items-center gap-0.5 border-b border-[#e5e5e0] pr-1 pl-1.5 dark:border-border">
				<button
					type="button"
					aria-label="图表预览"
					aria-pressed={mode === "preview"}
					onClick={() => setMode("preview")}
					className={`grid h-6 w-6 place-items-center rounded-[5px] ${mode === "preview" ? "bg-[#e8ebe2] text-[#4e6238] dark:bg-[#3b422e] dark:text-[#d1e79b]" : "text-[#74746d] hover:bg-[#efefeb] dark:hover:bg-muted"}`}
				>
					<Eye className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					aria-label="源码"
					aria-pressed={mode === "source"}
					onClick={() => setMode("source")}
					className={`grid h-6 w-6 place-items-center rounded-[5px] ${mode === "source" ? "bg-[#e8ebe2] text-[#4e6238] dark:bg-[#3b422e] dark:text-[#d1e79b]" : "text-[#74746d] hover:bg-[#efefeb] dark:hover:bg-muted"}`}
				>
					<Code2 className="h-3.5 w-3.5" />
				</button>
				<span className="ml-1 min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-[#696963] dark:text-muted-foreground">
					Mermaid
				</span>
				{svg === undefined ? null : (
					<button
						type="button"
						aria-label="全屏查看"
						onClick={() => setFullscreen(true)}
						className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#efefeb] dark:hover:bg-muted"
					>
						<Maximize2 className="h-3.5 w-3.5" />
					</button>
				)}
			</header>
			{mode === "source" ? (
				<pre className="message-code-scroll m-0 max-h-96 overflow-auto px-3 py-3 font-mono text-[12px] leading-5 whitespace-pre text-[#42423e] dark:text-[#d8dbd2]">
					<code>{source}</code>
				</pre>
			) : oversized ? (
				<p className="px-4 py-5 text-[11px] text-[#8d5e4e] dark:text-[#e4a694]">
					Mermaid 源码过长,已停止渲染。请查看源码。
				</p>
			) : error === undefined ? (
				svg === undefined ? (
					<p className="flex min-h-32 items-center justify-center gap-2 text-[10px] text-muted-foreground">
						<LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
						正在渲染图表
					</p>
				) : (
					<div
						className="min-h-32 overflow-auto p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
						// 洗过一遍的 SVG(见 `./mermaid` 的 sanitize):脚本、事件属性、外链都已删掉。
						dangerouslySetInnerHTML={{ __html: svg }}
					/>
				)
			) : (
				<div className="px-4 py-4 text-[11px] leading-5 text-[#8d5e4e] dark:text-[#e4a694]">
					<p className="font-semibold">图表渲染失败</p>
					<p className="mt-1 font-mono text-[9px] opacity-80">{error}</p>
				</div>
			)}
			{fullscreen && svg !== undefined ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					role="presentation"
					onClick={() => setFullscreen(false)}
				>
					<div
						className="max-h-full w-full max-w-[720px] overflow-auto rounded-[10px] bg-card p-4"
						onClick={(event) => event.stopPropagation()}
						dangerouslySetInnerHTML={{ __html: svg }}
					/>
				</div>
			) : null}
		</section>
	);
}

/** 当前主题:图表配色跟着明暗走(不然深色页面上会出现一张白底图)。 */
function useResolvedTheme(): MermaidTheme {
	const [theme, setTheme] = useState<MermaidTheme>(() =>
		document.documentElement.dataset.theme === "dark" ? "dark" : "default",
	);
	useEffect(() => {
		const root = document.documentElement;
		const update = () => setTheme(root.dataset.theme === "dark" ? "dark" : "default");
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
		update();
		return () => observer.disconnect();
	}, []);
	return theme;
}

/** 代码块:语言标签 + 复制 + 等宽正文。类名与桌面端一致,所以配色直接来自同一份 CSS。 */
const CodeBlock = memo(function CodeBlock({
	code,
	language,
	highlight = true,
}: {
	readonly code: string;
	readonly language: string;
	readonly highlight?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	/** 长代码默认收起:手机上一条 200 行的输出会把对话整个刷走(与桌面端同一个阈值)。 */
	const long = code.length > 1_600 || code.split(/\r?\n/).length > 16;
	const [expanded, setExpanded] = useState(false);
	const highlighted = useMemo(
		() => (language.length === 0 || !highlight ? null : hljs.highlight(code, { language, ignoreIllegals: true }).value),
		[code, highlight, language],
	);
	const copy = useCallback(async () => {
		// 兜底见 `writeClipboard`:局域网(非安全上下文)下 `navigator.clipboard` 是 undefined。
		if (!(await writeClipboard(code))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1_500);
	}, [code]);

	return (
		<section className="message-code-block my-4 overflow-hidden rounded-[7px] border border-[#deded9] dark:border-border">
			<header className="flex h-8 items-center border-b border-[#e5e5e0] pr-1 pl-3 dark:border-border">
				<Code2 className="mr-1.5 h-3.5 w-3.5 text-[#78836d] dark:text-[#aebf91]" />
				<span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-[#696963] dark:text-muted-foreground">
					{codeLanguageLabel(language)}
				</span>
				<button
					type="button"
					onClick={() => void copy()}
					aria-label={copied ? "已复制" : "复制代码"}
					className="grid h-6 w-6 place-items-center rounded-[5px] text-[#898981] hover:bg-[#efefeb] hover:text-[#454540] dark:hover:bg-muted dark:hover:text-foreground"
				>
					{copied ? <Check className="h-3.5 w-3.5 text-[#66833d]" /> : <Copy className="h-3.5 w-3.5" />}
				</button>
			</header>
			<pre
				className={`message-code-scroll m-0 overflow-auto px-3 py-3 font-mono text-[12px] leading-5 whitespace-pre text-[#42423e] dark:text-[#d8dbd2] ${
					long && !expanded ? "max-h-96" : ""
				}`}
			>
				<code
					className="hljs"
					{...(highlighted === null ? {} : { dangerouslySetInnerHTML: { __html: highlighted } })}
				>
					{highlighted === null ? code : undefined}
				</code>
			</pre>
			{long ? (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="flex h-7 w-full items-center justify-center border-t border-[#e5e5e0] text-[11px] text-muted-foreground hover:text-foreground dark:border-border"
				>
					{expanded ? "收起代码" : "展开代码"}
				</button>
			) : null}
		</section>
	);
});

/**
 * 写剪贴板 —— **带兜底**。
 *
 * 局域网模式下手机打开的是 `http://192.168.x.x`,而 `navigator.clipboard` 只在**安全上下文**里可用,
 * 所以在那里它是 `undefined`:不兜底的话,"复制"按钮点了没反应(而且不报错,因为异常被吞了)。
 * 兜底用老办法(临时 textarea + `execCommand`),它不需要安全上下文;两条都不行时返回 false,
 * 由调用方给出"长按选择"的提示 —— 而不是假装复制成功。
 */
export async function writeClipboard(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// 落到下面的兜底
	}
	try {
		if (typeof document === "undefined") return false;
		const node = document.createElement("textarea");
		node.value = text;
		// 不能 display:none(那样选不中),挪到屏幕外即可。
		node.setAttribute("readonly", "");
		node.style.position = "fixed";
		node.style.top = "-1000px";
		node.style.opacity = "0";
		document.body.appendChild(node);
		node.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(node);
		return ok;
	} catch {
		return false;
	}
}

/** 助手消息底部的动作行:复制整条回答(与桌面端同位置、同尺寸)。 */
export function MessageActions({ text }: { readonly text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = useCallback(async () => {
		if (!(await writeClipboard(text))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1_500);
	}, [text]);

	// 只给按钮本身:尺寸与底部其他图标一致(28px),外层排布交给调用方。
	return (
		<button
			type="button"
			onClick={() => void copy()}
			aria-label={copied ? "已复制" : "复制回答"}
			className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"
		>
			{copied ? <Check className="h-3.5 w-3.5 text-[#66833d]" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	);
}

export type { ReactNode };
