/**
 * Mermaid 图表渲染。
 *
 * **懒加载**:mermaid 本体是几百 KB,而大多数回答里根本没有图表。所以它是 `import()` 进来的 ——
 * 页面首屏不为"可能会用到的功能"付钱,只有真出现图表时才去取。
 *
 * 其余部分**照抄桌面端**(`MessageMarkdown.tsx` 里的 `renderMermaid`):
 * 串行队列、带上限的缓存、严格安全级别、渲染完再洗一遍 SVG。这些都不是可有可无的 ——
 * mermaid 的输出是**SVG 字符串**,而它会被塞进 DOM。
 */

export type MermaidTheme = "default" | "dark";

let mermaidModule: Promise<typeof import("mermaid").default> | undefined;

function loadMermaid(): Promise<typeof import("mermaid").default> {
	mermaidModule ??= import("mermaid").then((module) => module.default ?? (module as unknown as typeof import("mermaid").default));
	return mermaidModule;
}

let renderSequence = 0;
/** mermaid 自己会往 DOM 里插临时节点:并发渲染会互相踩,所以串行。 */
let renderQueue: Promise<void> = Promise.resolve();
const RENDER_CACHE_LIMIT = 24;
const renderCache = new Map<string, Promise<string>>();

/** 与桌面端同一阈值:超过就不渲染,只给源码(手机上尤其不该为一张巨大的图卡住)。 */
export function isOversizedMermaid(source: string): boolean {
	return source.length > 20_000 || source.split(/\r?\n/).length > 300;
}

export function renderMermaid(source: string, theme: MermaidTheme): Promise<string> {
	const cacheKey = `${theme}\u0000${source}`;
	const cached = renderCache.get(cacheKey);
	if (cached) {
		// 命中的挪到队尾:缓存按最近使用淘汰。
		renderCache.delete(cacheKey);
		renderCache.set(cacheKey, cached);
		return cached;
	}
	const id = `wordless-mermaid-${++renderSequence}`;
	const task = renderQueue
		.catch(() => undefined)
		.then(async () => {
			const mermaid = await loadMermaid();
			mermaid.initialize({
				startOnLoad: false,
				// **严格**:图表源码来自模型输出,不该有任何执行能力。
				securityLevel: "strict",
				secure: ["securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "themeCSS", "themeVariables", "fontFamily"],
				suppressErrorRendering: true,
				maxTextSize: 20_000,
				theme,
				fontFamily: '"Segoe UI", system-ui, sans-serif',
			});
			const rendered = await mermaid.render(id, source);
			return sanitizeMermaidSvg(rendered.svg);
		});
	renderQueue = task.then(
		() => undefined,
		() => undefined,
	);
	const result = task.catch((error: unknown) => {
		if (renderCache.get(cacheKey) === result) renderCache.delete(cacheKey);
		throw error;
	});
	renderCache.set(cacheKey, result);
	while (renderCache.size > RENDER_CACHE_LIMIT) {
		const oldest = renderCache.keys().next().value;
		if (oldest === undefined) break;
		renderCache.delete(oldest);
	}
	return result;
}

/**
 * 洗一遍 mermaid 出来的 SVG。
 *
 * `securityLevel: "strict"` 已经拦掉大部分,但这里是**最后一道**:脚本、内嵌文档、事件属性、
 * 外链一律删掉。一个来自模型输出的字符串要被塞进 DOM,值得多洗一遍。
 */
export function sanitizeMermaidSvg(svg: string): string {
	const documentValue = new DOMParser().parseFromString(svg, "image/svg+xml");
	if (documentValue.querySelector("parsererror")) throw new Error("Mermaid 返回的 SVG 不合法");
	for (const element of documentValue.querySelectorAll("script, iframe, object, embed")) element.remove();
	for (const element of documentValue.querySelectorAll("*")) {
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "target") {
				element.removeAttribute(attribute.name);
			}
		}
	}
	return new XMLSerializer().serializeToString(documentValue.documentElement);
}
