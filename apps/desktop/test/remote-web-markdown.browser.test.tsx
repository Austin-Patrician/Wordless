import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageMarkdown } from "../../web-client/src/markdown";

/**
 * 网页端的 markdown:公式、图表、代码。
 *
 * 这几样**只能在真浏览器里验**:KaTeX 要靠自己的样式表排版(纯文本断言看不出它对不对),
 * mermaid 是**懒加载**的真渲染(还要走一遍 SVG 清洗)。假环境里测出来的只是"我以为它会这样"。
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const render = async (text: string) => {
	await act(async () => {
		root.render(<MessageMarkdown text={text} />);
	});
};

describe("网页端 markdown", () => {
	it("公式:渲染成 KaTeX 的结构(不是把 $$ 原样显示)", async () => {
		await render("质能方程是 $E = mc^2$。");
		expect(container.querySelector(".katex")).not.toBeNull();
		expect(container.textContent).not.toContain("$E = mc^2$");
	});

	it("块级公式也能渲染", async () => {
		await render("$$\n\\int_0^1 x^2 dx\n$$");
		expect(container.querySelector(".katex-display")).not.toBeNull();
	});

	it("代码块照旧高亮(公式插件不该把代码块吃掉)", async () => {
		await render("```ts\nconst a: number = 1;\n```");
		expect(container.querySelector("code.hljs")).not.toBeNull();
		expect(container.textContent).toContain("TypeScript");
	});

	it("图表:懒加载真渲染出 SVG,并且**清洗过**(没有脚本、没有事件属性)", async () => {
		// 标签用**有辨识度的词**:这样"图里真的有内容"是可验证的,而不是靠数 svg 元素
		// (页面上本来就有 lucide 图标 —— 第一版断言就是这么假通过的)。
		await render("```mermaid\ngraph TD;\n  AlphaNode-->BetaNode;\n```");
		// 渲染是异步的(先取 mermaid 本体,再渲染):给它时间落地。
		// **不能用 `querySelector("svg")` 判断** —— 页面上本来就有 lucide 图标,那是假通过。
		// 认的是"渲染中"那句提示消失、并且图表里的文字出现。
		for (let attempt = 0; attempt < 60 && container.textContent?.includes("正在渲染图表") !== false; attempt += 1) {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
			});
		}
		expect(container.textContent).not.toContain("正在渲染图表");
		// mermaid 11 默认把标签画成 HTML(foreignObject),不是 `<text>` —— 认**文字**最稳。
		expect(container.textContent).toContain("AlphaNode");
		expect(container.textContent).toContain("BetaNode");
		expect(container.querySelector("svg")).not.toBeNull();
		expect(container.querySelector("script")).toBeNull();
		const withHandlers = [...container.querySelectorAll("*")].filter((element) =>
			[...element.attributes].some((attribute) => attribute.name.toLowerCase().startsWith("on")),
		);
		expect(withHandlers).toHaveLength(0);
	});

	it("图表:源码视图能看到原文(渲染失败或不想看图时有用)", async () => {
		await render("```mermaid\ngraph TD;\n  A-->B;\n```");
		const source = [...container.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "源码",
		);
		expect(source).toBeDefined();
		await act(async () => source?.click());
		expect(container.textContent).toContain("graph TD");
	});
});
