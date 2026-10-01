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
const client = { getHostEnvironmentFacts, openExternalUrl };

let updateSnapshot: unknown = null;

vi.mock("../src/renderer/platform/desktop-update", () => ({
  useOptionalUpdateSnapshot: () => updateSnapshot,
}));
vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
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
  // Radix 的 Popover 需要指针事件,单纯 click 不展开。
  for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
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
    updateSnapshot = null;
    getHostEnvironmentFacts.mockReset();
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
    expect(document.body.textContent).toContain(zh("noticeEmpty"));
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

  it("有新版本:信息类提醒,通往「关于与更新」", async () => {
    getHostEnvironmentFacts.mockResolvedValue(FACTS as never);
    updateSnapshot = { state: "available", currentVersion: "0.1.0", availableVersion: "0.2.0" };
    await render();

    expect(badge()).toBe("1");
    await act(async () => {
      await press(container.querySelector("button")!);
    });
    expect(document.body.textContent).toContain("0.2.0");

    const action = Array.from(document.querySelectorAll("button")).find((button) => (button.textContent ?? "").includes(zh("noticeOpenUpdate")));
    await act(async () => {
      await press(action!);
    });
    expect(onOpenSettings).toHaveBeenCalledWith("about");
  });

  it("两件事都有时角标是 2", async () => {
    getHostEnvironmentFacts.mockResolvedValue({ ...FACTS, node: { found: false, source: "none" } } as never);
    updateSnapshot = { state: "available", currentVersion: "0.1.0", availableVersion: "0.2.0" };
    await render();
    expect(badge()).toBe("2");
  });
});
