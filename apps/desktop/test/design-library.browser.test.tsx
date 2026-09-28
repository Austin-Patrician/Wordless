import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 设计页的风格墙。
 *
 * 这一层是接线的验:目录进来、窗口化宫格铺出卡片、计数写在标题上、点一张进命名流程。纯几何
 * 有自己的用例(`design-style-grid.test.ts`),这里只保证它们被正确接上。
 *
 * **这里的 `t` 走真的 zh-CN 词典**(别的用例习惯返回 key)。它断言的是用户看到的那句话:
 * 「5 套」「用「OpenAI」新建设计」—— 目录里的名字/标语只是兜底,i18n 有译文时以译文为准,
 * 用 key 当断言就把这条缝绕过去了。
 */

// 名字/标语字段必须非空(协议要求),但显示用的是 i18n 那份 —— 下面每个断言都走译文。
const TAGS = ["product", "dev", "dev", "ai", "ai"] as const;
const IDS = ["precise-dark", "linear", "github", "anthropic", "openai"] as const;
const STYLES = IDS.map((id, index) => ({
  id,
  name: id,
  category: TAGS[index],
  tagline: "t",
  themeCss: `@theme static { --color-surface: #${index}${index}${index}; --color-primary: #4f46e5; --color-accent: #0ea5e9; }`,
  vibe: index % 2 === 0 ? "light" : "dark",
  hasDemo: true,
}));

/** 详情正文:示例页 + 规范。规范里的 `## ` 标题就是详情页列的那几节。 */
function styleDetail(id: string) {
  return {
    demoHtml: `<!doctype html><html><body><h1>${id}</h1></body></html>`,
    designMd: `# ${id}\n\n## Atmosphere\n\n## Color roles\n\n## Components\n`,
  };
}

/**
 * 客户端必须是**稳定引用**:`DesignLibraryView` 用 `client` 当 `reload` 的依赖,而 `reload`
 * 又是它那个「进入即扫描」effect 的依赖 —— 每次渲染换一个新对象,那个 effect 就会每次渲染都
 * 重跑一次 `setDesigns`,变成无限重渲染(实测 300ms 内 346 次,`act` 因此永不收敛)。真实实现
 * 在 context 里是稳的,这里也得稳。
 */
vi.mock("../src/renderer/shared/runtime", () => {
  const client = {
    getDesignStyleDetail: async ({ id }: { id: string }) => styleDetail(id),
    listDesigns: async () => [],
    listDesignStyles: async () => STYLES,
  };
  const runtime = { snapshot: { workspaces: [{ availability: "available", rootPath: "/w" }] } };
  return { useRuntime: () => runtime, useRuntimeClient: () => client };
});

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

const { DesignLibraryView } = await import("../src/renderer/features/design/DesignLibraryView.tsx");
const { DESIGN_STYLE_TAGLINE_KEYS } = await import("../src/renderer/features/design/style-copy.ts");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;
/** 卡片上显示的是 i18n 里那份标语 —— 夹具里的 `tagline` 只是查不到译文时的兜底。 */
const taglineOf = (id: string): string => zh(DESIGN_STYLE_TAGLINE_KEYS[id] ?? id);
const nameOf = (id: string): string =>
  zh(`designStyleName${id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`);

/**
 * 卡片 = 带 `title` 的可按下按钮(`DesignStyleCard` 用 `aria-pressed` 表达"已选中",`title` 是标语)。
 * 不按 `aria-label` 找:那是模板拼出来的,同一张卡在筛选前后一模一样 —— 也正因为如此,它不适合
 * 当标识。
 */
/**
 * 详情里那条主按钮。
 *
 * 文案不再带风格名(名字在对话框标题上),所以按文案找它就是唯一的办法 —— 而它只在详情里出现
 * 一次,"点的是哪套"由**此刻开着哪张卡**决定,不靠按钮文案区分。
 */
function useButton(container: HTMLElement): HTMLElement | null {
  return (
    Array.from(detail(container)?.querySelectorAll("button") ?? []).find(
      (candidate) => (candidate.textContent ?? "").trim() === zh("designStyleDetailUse"),
    ) ?? null
  );
}

/** 详情对话框。卡上也挂着 iframe 了,所以按 `role="dialog"` 限定范围。 */
function detail(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="dialog"]');
}

async function click(target: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/**
 * 滚回顶部并等一次 flush。
 *
 * 风格墙是**窗口化**的:渲染哪几张卡取决于宫格顶边相对视口的位置。名字对话框的输入框带
 * `autoFocus`,一打开浏览器就会把它滚进视野 —— 页面一滚,墙渲染的就变成**末尾**那几张,于是
 * "按标题找某一张卡"会找不到。断言卡片前先回到顶部,这条不算多余。
 */
async function scrollWallToTop(): Promise<void> {
  // 先滚、再等一个真任务:滚动事件是异步派发的,而窗口要在事件回来之后才重算。只 flush 微任务
  // (空的 `act`)不够 —— 那会让断言跑在重算之前。
  await act(async () => {
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function cardTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button[aria-pressed][title]")).map(
    (button) => button.getAttribute("title") ?? "",
  );
}

describe("设计页风格墙", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    /*
      滚回顶部是有原因的,不是抄来的仪式:风格墙是**窗口化**的,而浏览器窗口的滚动位置跨用例
      保留。前面某个用例打开了名字对话框(`autoFocus` 的输入框),浏览器会把它滚进视野 —— 于是
      下一个用例一上来页面已经滚下去,墙渲染的是**末尾那几张卡**,`querySelector` 自然找不到开头
      的那张。这条踩过一次:单跑绿、整文件红。
    */
    window.scrollTo(0, 0);
    container = document.createElement("div");
    // 量得出宽度,窗口化才真的生效 —— 否则整面墙全铺,窗口那条断言就没有意义。
    container.style.width = "900px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<DesignLibraryView />);
    });
  }

  it("按目录顺序把风格铺出来,计数写在标题上", async () => {
    await render();

    // 顺序 = 目录顺序("从最克制到最活泼"那份排列本身在说明风格是连续谱)。
    expect(cardTitles(container)).toEqual(STYLES.map((style) => taglineOf(style.id)));
    // 「5 套」:先让用户知道货架有多大 —— 不按分类收窄,靠的就是"铺开看得完"。
    expect(container.textContent).toContain(zh("designStylesCountAll").replace("{count}", String(STYLES.length)));
  });

  it("点一套风格先进详情:示例、色板、规范目录都在那里", async () => {
    await render();

    await click(container.querySelector(`button[aria-pressed="false"][title="${taglineOf("openai")}"]`));

    // 三块内容:示例(iframe)、色板(按 token 名列)、规范目录(来自 DESIGN.md 的二级标题)。
    // 卡上现在也挂着 iframe(墙默认显示示例),所以要**限定在对话框里**找。
    expect(detail(container)?.querySelector("iframe")?.getAttribute("srcdoc")).toContain("<h1>openai</h1>");
    // 色板只给颜色:不复读令牌名,名字与值退到 `title` 里。夹具的 theme.css 声明了 3 个 color 令牌。
    const swatches = Array.from(detail(container)?.querySelectorAll("[title^='--color-']") ?? []);
    expect(swatches.map((swatch) => swatch.getAttribute("title"))).toEqual([
      "--color-primary: #4f46e5",
      "--color-accent: #0ea5e9",
      // 夹具里 surface 是按序号生成的(openai 是第 5 套,序号 4)。
      "--color-surface: #444",
    ]);
    // 规范目录来自 DESIGN.md 的二级标题。
    expect(container.textContent).toContain("Color roles");
    // 主按钮只说动作:名字已经写在标题上,不必再念一遍。
    expect(container.textContent).toContain(zh("designStyleDetailUse"));
  });

  it("从详情里「用这套」才进命名流程,名字取当前语言那份", async () => {
    await render();
    await click(container.querySelector(`button[aria-pressed="false"][title="${taglineOf("openai")}"]`));

    await click(useButton(container));

    expect(container.textContent).toContain(zh("designNameTitle").replace("{style}", nameOf("openai")));
  });

  it("详情可以关掉,回到墙上", async () => {
    await render();
    await click(container.querySelector(`button[aria-pressed="false"][title="${taglineOf("linear")}"]`));
    expect(detail(container)).not.toBeNull();

    await click(detail(container)?.querySelector('button[aria-label="' + zh("designStyleClose") + '"]') as HTMLElement);
    await scrollWallToTop();

    expect(detail(container)).toBeNull();
    expect(cardTitles(container)).toEqual(STYLES.map((style) => taglineOf(style.id)));
  });

  it("等名字的那一套,在墙上是选中态", async () => {
    // 点卡片进的是详情;从详情里「用这套」之后,墙上的那张才是"正在等名字"的那张 ——
    // 而名字对话框只是页面中间一小块,卡片上的选中环在它周围是看得见的。
    await render();
    await click(container.querySelector(`button[aria-pressed="false"][title="${taglineOf("linear")}"]`));
    await click(useButton(container));
    await scrollWallToTop();

    expect(
      container.querySelector(`button[title="${taglineOf("linear")}"]`)?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container.querySelector(`button[title="${taglineOf("github")}"]`)?.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
