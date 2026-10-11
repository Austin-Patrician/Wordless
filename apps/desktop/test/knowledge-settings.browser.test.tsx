import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 知识库设置分区。
 *
 * 这一页唯一的原则是**每个控件都真的管用**。所以测试问的不是"控件在不在",而是
 * "动它会不会真的改变行为":开关要落盘、模型要落盘、位置只读(改它属于多库那件事,见 §13)。
 *
 * 多库之后这一页分两层:**开关是全局的**,模型 / 间隔 / 预算**属于当前那个库**。所以测试
 * 除了"动它真的落盘",还要钉住**改的是哪个库** —— 看着甲库的设置、心里想的是乙库,
 * 是这一页唯一会真出错的用法。
 *
 * 还有一条:**这一页的样子必须和「环境」「通用」是同一套**(卡片底色 / 圆角、开关是共用的
 * Switch 而不是裸 checkbox)。所以下面既钉行为,也钉那几处样式,免得哪天又各自长回去。
 */

const setKnowledge = vi.fn(async () => undefined);
const revealKnowledgeRoot = vi.fn(async () => undefined);
const getKnowledgeLibraries = vi.fn(async () => ({ active: "知识库", names: ["知识库"] }));
const client = { revealKnowledgeRoot, getKnowledgeLibraries };

type LibrarySettings = {
  processingModel: { connectionId: string; modelId: string } | null;
  autoProcessMinutes: number;
  maxFilesPerRound: number;
};
type Prefs = { enabled: boolean; activeKnowledgeBase: string | null; libraries: Record<string, LibrarySettings> };

const librarySettings = (patch: Partial<LibrarySettings> = {}): LibrarySettings => ({
  processingModel: null,
  autoProcessMinutes: 0,
  maxFilesPerRound: 0,
  ...patch,
});

let knowledge: Prefs = { enabled: true, activeKnowledgeBase: "知识库", libraries: {} };

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({
    snapshot: {
      modelConfiguration: {
        models: [
          { providerId: "openai", modelId: "gpt-5", displayName: "GPT-5", kind: "chat", enabled: true },
          { providerId: "openai", modelId: "embed", displayName: "Embed", kind: "embedding", enabled: true },
        ],
      },
    },
  }),
  // **稳定对象**:组件在 effect 里依赖它,每次新建一个会让 effect 反复触发。
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    knowledge,
    setKnowledge: async (next: typeof knowledge) => {
      knowledge = next;
      await setKnowledge(next);
    },
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
  }),
}));

const { KnowledgeSettings } = await import("../src/renderer/features/settings/KnowledgeSettings.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  knowledge = { enabled: true, activeKnowledgeBase: "知识库", libraries: {} };
  getKnowledgeLibraries.mockImplementation(async () => ({ active: "知识库", names: ["知识库"] }));
  setKnowledge.mockClear();
  revealKnowledgeRoot.mockClear();
  getKnowledgeLibraries.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

async function render(): Promise<void> {
  const root = createRoot(document.querySelector("#root")!);
  roots.push(root);
  await act(async () => {
    root.render(<KnowledgeSettings />);
  });
}

/** 断言某次写入落在某个库上,而且别的库没被碰。 */
function assertWritten(next: Prefs, name: string, patch: Partial<LibrarySettings>): void {
  expect(next.libraries[name]).toEqual(librarySettings(patch));
  for (const [other, value] of Object.entries(next.libraries)) {
    if (other !== name) expect(value).toEqual(librarySettings());
  }
}

describe("知识库设置", () => {
  it("开关真的落盘", async () => {
    await render();
    const toggle = document.querySelector("#knowledge-enabled") as HTMLElement;
    // 用的是设置页共用的 Switch(不是裸 checkbox):开关的样子只该有一处定义。
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      toggle.click();
    });

    expect(setKnowledge).toHaveBeenCalledTimes(1);
    expect(setKnowledge.mock.calls[0]![0]).toMatchObject({ enabled: false });
  });

  it("默认跟随会话模型,并且说明为什么值得单独配", async () => {
    await render();
    expect(document.body.textContent).toContain("跟随会话模型");
    expect(document.body.textContent).toContain("长上下文");
  });

  it("只列出可用的对话模型(嵌入模型不该出现在这里)", async () => {
    await render();
    const trigger = document.querySelector("#knowledge-model") as HTMLElement;
    await act(async () => {
      trigger.click();
    });
    const options = [...document.querySelectorAll("[role=option]")].map((option) => option.textContent ?? "");
    expect(options.some((text) => text.includes("GPT-5"))).toBe(true);
    expect(options.some((text) => text.includes("Embed"))).toBe(false);
  });

  it("位置是只读的,只能打开文件夹 —— 换位置属于多知识库那件事", async () => {
    await render();
    // 页面上没有任何可编辑的路径输入框。
    expect(document.querySelector('input[type="text"]')).toBeNull();
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("打开文件夹"));
    expect(button).not.toBeUndefined();
    await act(async () => {
      button!.click();
    });
    expect(revealKnowledgeRoot).toHaveBeenCalledTimes(1);
  });

  it("开关是全局的:改它不碰任何库的设置", async () => {
    knowledge = { enabled: true, activeKnowledgeBase: "甲", libraries: { 甲: librarySettings({ autoProcessMinutes: 5 }) } };
    await render();
    await act(async () => {
      (document.querySelector("#knowledge-enabled") as HTMLElement).click();
    });
    expect(setKnowledge.mock.calls[0]![0]).toEqual({
      enabled: false,
      activeKnowledgeBase: "甲",
      libraries: { 甲: librarySettings({ autoProcessMinutes: 5 }) },
    });
  });

  it("模型 / 间隔 / 预算都写进**当前那个库**,别的库原样不动", async () => {
    knowledge = {
      enabled: true,
      activeKnowledgeBase: "乙",
      libraries: { 甲: librarySettings({ autoProcessMinutes: 5 }), 乙: librarySettings() },
    };
    // 宿主解析出来的就是偏好里那个(正常情况:两边一致)。
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "乙", names: ["甲", "乙"] }));
    await render();
    await act(async () => {
      (document.querySelector("#knowledge-interval") as HTMLElement).click();
    });
    const option = [...document.querySelectorAll("[role=option]")].find((candidate) => candidate.textContent?.includes("10 分钟"))!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const next = setKnowledge.mock.calls.at(-1)![0] as Prefs;
    expect(next.libraries["乙"]!.autoProcessMinutes).toBe(10);
    expect(next.libraries["甲"]).toEqual(librarySettings({ autoProcessMinutes: 5 }));
  });

  it("偏好里还没记当前库(null)时,改动照样落到**宿主解析出来的那个库**上", async () => {
    // 现场:用户从没切过库,偏好里 `activeKnowledgeBase` 是 null,而库其实已经存在。
    // 拿偏好里那个 null 当写目标 = 往**空名字**上写 —— 归一直接把空名丢掉,于是三个控件
    // 怎么切都不生效,而且切完还弹回默认值(读的是同一个空名)。
    knowledge = { enabled: true, activeKnowledgeBase: null, libraries: {} };
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "知识库", names: ["知识库"] }));
    await render();

    await act(async () => {
      (document.querySelector("#knowledge-budget") as HTMLElement).click();
    });
    const option = [...document.querySelectorAll("[role=option]")].find((candidate) => candidate.textContent?.includes("20 个"))!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const next = setKnowledge.mock.calls.at(-1)![0] as Prefs;
    assertWritten(next, "知识库", { maxFilesPerRound: 20 });
  });

  it("禁用只按各自的理由:没有可用模型不该把间隔与预算也变灰", async () => {
    // 原来只有"用哪个模型"因为没有模型而不可选;间隔与预算跟有没有模型无关。
    await render();
    expect((document.querySelector("#knowledge-model") as HTMLElement).hasAttribute("disabled")).toBe(false);
    expect((document.querySelector("#knowledge-interval") as HTMLElement).hasAttribute("disabled")).toBe(false);
    expect((document.querySelector("#knowledge-budget") as HTMLElement).hasAttribute("disabled")).toBe(false);
  });

  it("库名还不知道时三项都不给写 —— 写了也是落到空名字上被丢掉", async () => {
    knowledge = { enabled: true, activeKnowledgeBase: null, libraries: {} };
    getKnowledgeLibraries.mockImplementation(async () => {
      throw new Error("宿主没答");
    });
    await render();
    for (const id of ["knowledge-interval", "knowledge-budget"]) {
      expect((document.querySelector(`#${id}`) as HTMLElement).hasAttribute("disabled")).toBe(true);
    }
  });

  it("三项设置**在同一组里**,每行名称与解释在左、控件在右", async () => {
    // 五个独立卡片又高又散;这三项同属当前库,该在一组里,一行一项。
    //
    // **量不了像素**:浏览器测试里没有加载 Tailwind,所有元素的几何都是 0。所以这里钉的是
    // 结构与意图(DOM 顺序 + 那一行的 flex 声明),像素要靠人看一眼。
    await render();
    const rows = ["knowledge-model", "knowledge-interval", "knowledge-budget"].map((id) => {
      const control = document.querySelector(`#${id}`)!;
      const label = document.querySelector(`label[for="${id}"]`)!;
      return { id, control, label, row: label.parentElement! };
    });
    for (const { id, control, label, row } of rows) {
      // 同一行:控件就在这一行的容器里,而且**名称与解释在控件之前**(= 左边)。
      expect(row.contains(control)).toBe(true);
      expect(label.contains(control)).toBe(false);
      expect(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // 名称与解释都在 label 里(不是只有名称)。
      expect(label.textContent!.length).toBeGreaterThan(8);
      // 这一行是"两端对齐的一行",不是上下堆叠 —— 与「环境」页的动作行同款:
      // 常规宽度两端对齐,窄屏(低于 sm)才上下堆叠。
      expect(row.className).toContain("flex");
      expect(row.className).toContain("justify-between");
      expect(row.className).toContain("sm:flex-row");
      expect(id).toBeTruthy();
    }
    // 同一组:三项的祖先 section 是同一个。
    expect(new Set(rows.map(({ row }) => row.closest("section"))).size).toBe(1);
    // 整页四张卡:开关 / 当前库 / 当前库的三项 / 位置。
    expect(document.querySelectorAll("section").length).toBe(4);
  });

  it("卡片用的是设置页统一的那一种(22px 圆角、浅底、无描边)", async () => {
    // 这一页原来自己一套(rounded-lg + 描边 + 透明底),和「环境」「通用」并排切换时明显不是
    // 同一个产品。样式在这里钉一次,免得再各自长回去。
    await render();
    const cards = [...document.querySelectorAll("section")];
    expect(cards.length).toBe(4);
    for (const card of cards) {
      expect(card.className).toContain("rounded-2xl");
      expect(card.className).toContain("bg-[#f7f7f5]");
      expect(card.className).toContain("dark:bg-[#22241c]");
      expect(card.className).not.toContain("border");
    }
  });

  it("摆出「当前库」,并且说清这几项只作用于它、按库名记", async () => {
    knowledge = { enabled: true, activeKnowledgeBase: "乙", libraries: { 甲: librarySettings(), 乙: librarySettings() } };
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "乙", names: ["甲", "乙"] }));
    await render();
    expect(document.body.textContent).toContain("当前库");
    // 在 Finder 里改名 = 换了一个库 —— 这条代价必须说出来。
    expect(document.body.textContent).toContain("按库名记");
    expect((document.querySelector("#knowledge-library") as HTMLElement).textContent).toContain("乙");
  });

  it("只有一个库时不摆切换器(一个选项的下拉框是噪音)", async () => {
    await render();
    expect(document.querySelector("#knowledge-library")).toBeNull();
    expect(document.body.textContent).toContain("知识库");
  });

  it("定时加工要显式选模型这条提醒,看的是**当前库**的模型", async () => {
    knowledge = {
      enabled: true,
      activeKnowledgeBase: "乙",
      // 甲库配好了模型,乙库没配 —— 提醒只该按乙库来判。
      libraries: { 甲: librarySettings({ processingModel: { connectionId: "a", modelId: "b" }, autoProcessMinutes: 5 }), 乙: librarySettings({ autoProcessMinutes: 5 }) },
    };
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "乙", names: ["甲", "乙"] }));
    await render();
    expect(document.body.textContent).toContain("不会**自动整理");
  });
});
