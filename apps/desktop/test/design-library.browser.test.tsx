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

/**
 * 共享夹具状态。
 *
 * `vi.mock` 的工厂是**提升**的,所以它读不到这个文件里后声明的变量 —— 想要可变夹具就得走
 * `vi.hoisted`。里面的两个字段就是被 mock 掉的那份运行时快照:哪些根里有设计、有哪些会话。
 */
const state = vi.hoisted(() => ({
  designsByRoot: new Map<string, unknown[]>(),
  sessions: [] as unknown[],
}));
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
 * 客户端必须是**稳定引用**:`DesignLibraryView` 用 `client` 当扫描回调的依赖(另一半是那一串根的
 * key),而那个回调是它「进入即扫描」effect 的依赖 —— 每次渲染换一个新对象,effect 就会每次渲染都
 * 重跑一遍扫描。真实实现在 context 里是稳的,这里也得稳。
 */
vi.mock("../src/renderer/shared/runtime", () => {
  const client = {
    getDesignStyleDetail: async ({ id }: { id: string }) => styleDetail(id),
    // 按根返回:`DesignLibraryView` 现在会同时扫工作区与会话两种根,拿一个写死的 `[]` 就分不出
    // "这个根里没有设计"和"根本没问到这个根"。
    listDesigns: async ({ root }: { root: string }) => state.designsByRoot.get(root) ?? [],
    listDesignStyles: async () => STYLES,
  };
  /**
   * 夹具的根:一个工作区 + 一个**没有工作区**的设计会话。
   *
   * 后者的根是会话私有的那种(`session-workspaces/<id>`),它正是这次要覆盖的来源 —— 从前这页
   * 只扫工作区,那种设计在画布上看得到、在这里不存在。
   */
  const runtime = {
    snapshot: {
      workspaces: [{ availability: "available", canonicalRootPath: "/w", id: "w1", name: "My project", rootPath: "/w" }],
      // getter,**不是**抄下 `state.sessions` 的引用:工厂只在导入时跑一次,抄下来的话后面
      // 每个用例改的 `state.sessions` 它都看不见。
      get sessions() {
        return state.sessions;
      },
    },
  };
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

describe("设计页", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 夹具状态跨用例共享,每个用例自己声明"哪个根里有哪份设计"。
    state.designsByRoot.clear();
    state.sessions = [];
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

  async function render(props: { onOpenSession?: (sessionId: string) => void } = {}): Promise<void> {
    await act(async () => {
      root.render(<DesignLibraryView {...props} />);
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

  it("没有工作区的设计会话,它的设计也进「我的设计」,点开是回到那个会话", async () => {
    /*
      这条覆盖的就是那个 bug:没选工作区的设计会话把包落在**自己的私有根**里
      (`session-workspaces/<id>`),而这一页从前只扫第一个可用工作区 —— 于是画布看得到、
      列表里不存在。
    */
    const sessionId = "5deacdf1-94d6-4533-8cb3-100ee1f50c25";
    const rootPath = `/secrets/session-workspaces/${sessionId}`;
    state.sessions = [{ id: sessionId, title: "垃圾分类", workbenchId: "ui-preview", runtimeRootPath: rootPath, updatedAt: 2 }];
    state.designsByRoot.set(rootPath, [
      {
        id: "d1",
        path: `${rootPath}/community-waste-sorting.wdesign`,
        name: "community-waste-sorting",
        mode: "built",
        style: null,
        frameCount: 2,
      },
    ]);
    const opened: string[] = [];

    await render({ onOpenSession: (id) => opened.push(id) });

    // 名字、画面数,以及**来源** —— 不标出来,用户不知道这份设计是哪个会话里的。
    expect(container.textContent).toContain("community-waste-sorting");
    expect(container.textContent).toContain(`${zh("designSourceSession")} · 垃圾分类`);
    expect(container.textContent).toContain(zh("designFrameCount").replace("{count}", "2"));

    // 打开 = 切回那个会话:会话来源的设计没有别的入口,它住在会话根里,没有文件夹可给用户点。
    await click(cardFor(container, "community-waste-sorting"));
    expect(opened).toEqual([sessionId]);
  });

  it("工作区的设计标成工作区来源,而且不给出打开动作 —— 没有会话可回", async () => {
    state.designsByRoot.set("/w", [
      { id: "d2", path: "/w/landing.wdesign", name: "landing", mode: "static", style: null, frameCount: 1 },
    ]);

    await render({ onOpenSession: () => { throw new Error("工作区来源的设计不该有打开会话的动作"); } });

    expect(container.textContent).toContain(`${zh("designSourceWorkspace")} · My project`);
    const card = cardFor(container, "landing");
    expect(card).not.toBeNull();
    // 列出来,但**不是**按钮:只有会话来源的那条有点开这个动作(工作区来源没有会话可回)。
    expect(card?.tagName).toBe("DIV");
  });
});

/** 「我的设计」里那张卡。按名字找:它可能是按钮(会话来源,能打开)或纯容器(工作区来源)。 */
function cardFor(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-design-card="${name}"]`);
}
