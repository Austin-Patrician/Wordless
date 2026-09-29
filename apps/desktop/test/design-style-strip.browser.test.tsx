import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 新建页那一栏风格胶片(§14.21 / §14.22)。
 *
 * 这一层只验一件事:**选风格不再需要任何前置条件**。
 *
 * 从前的门是"有没有工作区" —— 资料要先落进工作区的 `design-resources/<id>/`,再由 agent 抄进
 * 设计包,所以没有工作区时卡片点了没反应。现在选中只产生一条 `design-style` 标记(落盘由
 * `design_create(styleId)` 做),那道门连**入参**都不存在了 —— 这个文件根本没法传它。
 *
 * 示例页那半边(`StyleDemo` 的窗口化、详情对话框)有自己的用例,这里只保证"点得动、选得中"。
 */

const IDS = ["precise-dark", "linear", "playful"] as const;
const STYLES = IDS.map((id) => ({
  id,
  name: id,
  category: "product",
  tagline: "t",
  themeCss: "@theme static { --color-surface: #101010; --color-primary: #4f46e5; --color-accent: #0ea5e9; }",
  vibe: "dark" as const,
  hasDemo: true,
}));

vi.mock("../src/renderer/shared/runtime", () => {
  return { useRuntime: () => ({ snapshot: null }), useRuntimeClient: () => null };
});

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

const { DesignStyleLaunchStrip } = await import("../src/renderer/features/design/DesignStyleLaunchStrip.tsx");
const { DESIGN_STYLE_TAGLINE_KEYS } = await import("../src/renderer/features/design/style-copy.ts");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;
/** 卡片上显示的是 i18n 那份标语 —— 夹具里的 `tagline` 只是查不到译文时的兜底。 */
const taglineOf = (id: string): string => zh(DESIGN_STYLE_TAGLINE_KEYS[id] ?? id);

/** 卡片按 `title`(标语)找:那是它在两种状态下都一样的东西。 */
const cardFor = (container: HTMLElement, id: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`button[aria-pressed][title="${taglineOf(id)}"]`);

async function click(target: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("新建页风格胶片", () => {
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

  async function render(selected: string | null = null): Promise<string[]> {
    const picked: string[] = [];
    await act(async () => {
      root.render(
        <DesignStyleLaunchStrip
          bridge={{
            listDesignStyles: async () => STYLES,
            getDesignStyleDetail: async ({ id }: { id: string }) => ({
              demoHtml: `<!doctype html><html><body><h1>${id}</h1></body></html>`,
              designMd: `# ${id}\n`,
            }),
          } as never}
          onSelect={(styleId) => picked.push(styleId ?? "__any__")}
          selected={selected}
        />,
      );
    });
    return picked;
  }

  it("点一套风格就选中它 —— 不需要工作区,也不需要别的前置", async () => {
    const picked = await render();
    await click(cardFor(container, "linear"));
    expect(picked).toEqual(["linear"]);
  });

  it("头一张「由 agent 自己定」是一个显式选项,不是「什么都没选」", async () => {
    const picked = await render();
    await click(
      container.querySelector<HTMLElement>(`button[aria-pressed][title="${zh("designStyleLaunchAnyHint")}"]`),
    );
    // `null` 就是"不指定风格" —— 它会被送成一条什么都没说的消息,agent 用默认审美。
    expect(picked).toEqual(["__any__"]);
  });

  it("已选中的那套是按下态,回显也写出来", async () => {
    await render("playful");
    expect(cardFor(container, "playful")?.getAttribute("aria-pressed")).toBe("true");
    expect(cardFor(container, "linear")?.getAttribute("aria-pressed")).toBe("false");
    // 卡片上的缩略图小,而这一栏滚过之后看不到标题 —— 选中了哪套要说出来。
    expect(container.textContent).toContain(zh("designStyleLaunchSelected").replace("{name}", zh("designStyleNamePlayful")));
  });
});
