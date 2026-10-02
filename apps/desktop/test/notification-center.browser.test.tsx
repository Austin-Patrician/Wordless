import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 侧边栏那颗铃铛(通知中心)。
 *
 * 之前它是个**死按钮**;现在它是"应用对你说的话"的入口。这一层验三件事:
 * **角标是数字**(状态不能只靠颜色)、**内容按规则来**(只放应用级的事)、**动作真的接得上**(点进去
 * 就是设置里对应的那一页)。
 */

const getHostEnvironmentFacts = vi.fn();
const openExternalUrl = vi.fn(async () => {});
let cloudSyncSnapshot: unknown = null;
const getCloudSyncSnapshot = vi.fn(async () => cloudSyncSnapshot);
const subscribeHost = vi.fn(() => () => {});
const client = { getHostEnvironmentFacts, getCloudSyncSnapshot, openExternalUrl, subscribeHost };

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
const dismissNotice = vi.fn(async () => {});
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
    dismissedNotices: {},
    dismissNotice,
  }),
}));

const { NotificationCenter } = await import("../src/renderer/features/workbench/NotificationCenter.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

const FACTS = {
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: true, version: "3.12.4", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } },
  ocr: { available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." },
  probedAt: 1,
};

async function press(element: HTMLElement): Promise<void> {
  for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

/** 面板是 Dialog:点触发器就挂载到 body 上。 */
function panel(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

describe("通知中心", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenSettings = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onOpenSettings.mockClear();
    dismissNotice.mockClear();
    getHostEnvironmentFacts.mockReset();
    cloudSyncSnapshot = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<NotificationCenter onOpenSettings={onOpenSettings} />);
    });
  }

  function badge(): string | null {
    return container.querySelector("[aria-label] span")?.textContent ?? null;
  }

  it("一切正常时没有角标,点开只说一句「没有需要你处理的事」", async () => {
    getHostEnvironmentFacts.mockResolvedValue(FACTS as never);
    await render();

    expect(badge()).toBeNull();
    await act(async () => {
      await press(container.querySelector("button")!);
    });
    expect(panel()).not.toBeNull();
    expect(document.body.textContent).toContain(zh("noticeEmpty"));
  });

  it("面板固定在右上角,而且列表自己滚动(条数再多也不把面板撑出屏幕)", async () => {
    getHostEnvironmentFacts.mockResolvedValue({ ...FACTS, shell: null } as never);
    await render();
    await act(async () => {
      await press(container.querySelector("button")!);
    });

    const dialog = panel()!;
    // 位置:右上角固定,而不是"挂在触发图标上的浮层"。
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("right-3");
    expect(dialog.className).toContain("top-12");
    expect(dialog.className).toContain("max-h-[min(460px,calc(100vh-5rem))]");
    // 面板必须有**存在**的背景令牌:`bg-popover` 在 Wordless 的令牌表里不存在,用了等于透明,
    // 面板与背景糊在一起(这一条就是这么被发现的)。
    expect(dialog.className).toContain("bg-card");
    expect(dialog.className).not.toContain("bg-popover");
    // 卡片与面板要能分开:面板 card(白),卡片 muted(浅灰)。
    expect(dialog.querySelector("li")?.className).toContain("bg-muted");
    // 滚动落在列表上,不是整个面板。
    expect(dialog.querySelector("ul")?.className).toContain("overflow-y-auto");
  });

  it("命令行缺失:角标是数字,点开是警告 + 通往设置", async () => {
    getHostEnvironmentFacts.mockResolvedValue({ ...FACTS, shell: null } as never);
    await render();

    // 数字角标(不是只有一个红点):"有几件事"比"有事"更有用,也不靠颜色传达状态。
    expect(badge()).toBe("1");

    await act(async () => {
      await press(container.querySelector("button")!);
    });
    expect(document.body.textContent).toContain(zh("noticeEnvironmentTitle"));
    expect(document.body.textContent).toContain(zh("noticeOpenEnvironment"));

    const action = Array.from(document.querySelectorAll("button")).find((button) => (button.textContent ?? "").includes(zh("noticeOpenEnvironment")));
    await act(async () => {
      await press(action!);
    });
    // 点进去就是设置里对应的那一页 —— 否则这条提醒只是个死胡同。
    expect(onOpenSettings).toHaveBeenCalledWith("environment");
  });

  it("环境 + 云同步都有时角标是 2(更新不进这里 —— 它有自己的横幅)", async () => {
    getHostEnvironmentFacts.mockResolvedValue({ ...FACTS, node: { found: false, source: "none" } } as never);
    cloudSyncSnapshot = { enabled: true, status: "error", lastSyncAt: null, lastError: "boom", pendingCount: 0, conflicts: [], accountEmail: null };
    await render();
    expect(badge()).toBe("2");
  });
});

describe("已读(知道了)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    dismissNotice.mockClear();
    getHostEnvironmentFacts.mockReset();
    cloudSyncSnapshot = null;
    getHostEnvironmentFacts.mockResolvedValue({ ...FACTS, shell: null } as never);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("每条通知有 icon-only 的「知道了」,点了就把 id + 内容指纹记下来", async () => {
    await act(async () => {
      root.render(<NotificationCenter onOpenSettings={vi.fn()} />);
    });
    await act(async () => {
      await press(container.querySelector("button")!);
    });

    const dismiss = document.querySelector(`[aria-label="${zh("noticeDismiss")}"]`);
    expect(dismiss).not.toBeNull();
    // 内容是空的(icon-only)才是 icon-only 按钮。
    expect(dismiss?.textContent?.trim() ?? "").toBe("");

    await act(async () => {
      await press(dismiss as HTMLElement);
    });
    // 记的是"这一条 + 它的内容":内容变了下次会重新出现(判定见 app-notices 的 visibleNotices)。
    expect(dismissNotice).toHaveBeenCalledTimes(1);
    expect(dismissNotice.mock.calls[0]?.[0]).toBe("environment:incomplete");
    expect(typeof dismissNotice.mock.calls[0]?.[1]).toBe("string");
  });

  it("头部有关闭按钮,而且**不是**那个会压住内容的默认绝对定位按钮", async () => {
    await act(async () => {
      root.render(<NotificationCenter onOpenSettings={vi.fn()} />);
    });
    await act(async () => {
      await press(container.querySelector("button")!);
    });
    const close = document.querySelector(`[aria-label="${zh("noticeClose")}"]`);
    expect(close).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]')!;
    // 头部那一行里就有关闭按钮:位置由布局决定,不会和内容重叠。
    expect(dialog.firstElementChild?.contains(close)).toBe(true);
  });
});
