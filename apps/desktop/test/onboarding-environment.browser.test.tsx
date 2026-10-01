import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 首次导览里的**环境一页**。
 *
 * 这一层验三件事:**能跳过**、**只在真缺东西时才让人做事**(全好时只有一句"已经准备好了")、
 * 以及**装不装由用户定**(页面只给一颗按钮,点了才联网)。
 */

const facts = (overrides: Record<string, unknown> = {}) => ({
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: true, version: "3.12.14", executable: "python3", source: "wordless", packages: { openpyxl: true, pyarrow: true, pandas: true } },
  probedAt: 1,
  ...overrides,
});

const getHostEnvironmentFacts = vi.fn(async () => facts() as never);
const installHostPythonPackages = vi.fn(async () => ({ ok: true, installed: ["pandas", "numpy", "pyarrow", "openpyxl"] }));

/** 稳定引用:组件里 `load` 的依赖是它。 */
const client = { getHostEnvironmentFacts, installHostPythonPackages };

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

const { OnboardingEnvironment } = await import("../src/renderer/features/onboarding/OnboardingEnvironment.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

async function click(target: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const buttonWith = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));

describe("导览 → 环境", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onBack: ReturnType<typeof vi.fn>;
  let onContinue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getHostEnvironmentFacts.mockReset();
    getHostEnvironmentFacts.mockImplementation(async () => facts() as never);
    installHostPythonPackages.mockClear();
    onBack = vi.fn();
    onContinue = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(<OnboardingEnvironment onBack={onBack} onContinue={onContinue} />);
    });
  };

  it("全都准备好了就只说一句话,不摆清单让人焦虑", async () => {
    await render();
    expect(container.textContent).toContain(zh("onboardingEnvironmentReady"));
    // 没有可做的事,就不给"安装"按钮。
    expect(buttonWith(container, zh("environmentPythonInstall"))).toBeUndefined();
  });

  it("永远能跳过:不做事也能往下走", async () => {
    await render();
    await click(buttonWith(container, zh("onboardingEnvironmentLater")));
    expect(onContinue).toHaveBeenCalledTimes(1);
    // 跳过不等于偷偷安装:没点安装按钮就绝不联网。
    expect(installHostPythonPackages).not.toHaveBeenCalled();
  });

  it("缺数据组件时给一颗按钮,点了才装", async () => {
    getHostEnvironmentFacts.mockImplementation(async () =>
      facts({
        python: { found: true, version: "3.12.14", executable: "python3", source: "wordless", packages: { openpyxl: true, pyarrow: false, pandas: false } },
      }) as never,
    );
    await render();

    const install = buttonWith(container, zh("environmentPythonInstall"));
    expect(install).toBeTruthy();
    // 点之前要知道"装到哪、多大、要不要网"。
    expect(container.textContent).toContain("56MB");

    await click(install);
    expect(installHostPythonPackages).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(zh("environmentPythonInstalled"));
  });

  it("命令行/Node 缺失时不会说\"已经准备好了\"", async () => {
    getHostEnvironmentFacts.mockImplementation(async () => facts({ shell: null }) as never);
    await render();
    expect(container.textContent).not.toContain(zh("onboardingEnvironmentReady"));
  });

  it("探测读不到时仍然能往下走(这一页不是必经之路)", async () => {
    getHostEnvironmentFacts.mockImplementation(async () => {
      throw new Error("bridge unavailable");
    });
    await render();
    expect(container.textContent).toContain(zh("environmentProbing"));
    await click(buttonWith(container, zh("onboardingEnvironmentStart")));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

// 两条界面上的要求,都是评审提的:这一页不该是"浮在背景上的卡片",而且多步流程要有回退的路。
it("这一页和背景融为一体:没有卡片外壳(边框/白底/投影)", async () => {
  await render();
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  const className = dialog?.className ?? "";
  expect(className).not.toContain("border");
  expect(className).not.toContain("bg-white");
  expect(className).not.toContain("shadow");
});

it("有上一步:能回到欢迎页", async () => {
  await render();
  await click(buttonWith(container, zh("onboardingBack")));
  expect(onBack).toHaveBeenCalledTimes(1);
  // 上一步不该顺手把用户送进导览。
  expect(onContinue).not.toHaveBeenCalled();
});
});
