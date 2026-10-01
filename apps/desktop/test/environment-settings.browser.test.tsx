import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 设置 → 环境(§ host-environment.md)。
 *
 * 这一层只验三件事:**先显示"检测中"再出结果**(探测要起子进程,面板不该空着)、**Python 缺失时给的是
 * 出口而不是替用户装**(只有官方下载页的入口)、以及"重新探测"真的调了显式重探那条路(不受节流限制)。
 *
 * 判定逻辑("什么算可用")在 `environment-rows.test.ts` 里单测,这里只看渲染与动作。
 */

const facts = (overrides: Record<string, unknown> = {}) => ({
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: false, source: "none", packages: { openpyxl: false, pyarrow: false, pandas: false } },
  probedAt: 1,
  ...overrides,
});

const getHostEnvironmentFacts = vi.fn(async () => facts() as never);
const redetectHostEnvironment = vi.fn(async () =>
  facts({ python: { found: true, version: "3.12.4", executable: "python3", source: "wordless", packages: { openpyxl: true, pyarrow: true, pandas: true } } }) as never,
);
const openExternalUrl = vi.fn(async () => {});
const installHostPythonPackages = vi.fn(async () => ({ ok: true, installed: ["pandas", "numpy", "pyarrow", "openpyxl"] }));

/** 必须是**稳定引用**:组件里 `load` 的依赖是它,每次给新对象就会无限重渲染。 */
const client = { getHostEnvironmentFacts, redetectHostEnvironment, openExternalUrl, installHostPythonPackages };

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

const { EnvironmentSettings } = await import("../src/renderer/features/settings/EnvironmentSettings.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

async function click(target: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("设置 → 环境", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getHostEnvironmentFacts.mockReset();
    getHostEnvironmentFacts.mockImplementation(async () => facts() as never);
    redetectHostEnvironment.mockReset();
    redetectHostEnvironment.mockImplementation(async () =>
      facts({ python: { found: true, version: "3.12.4", executable: "python3", source: "wordless", packages: { openpyxl: true, pyarrow: true, pandas: true } } }) as never,
    );
    openExternalUrl.mockClear();
    installHostPythonPackages.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("总述放在顶部:说清提供什么与缺什么会写在这,而不是压在页脚", async () => {
    await act(async () => {
      root.render(<EnvironmentSettings />);
    });
    expect(container.textContent).toContain(zh("environmentLead"));
    // 页脚那句已经并进导语,不该再出现一次。
    expect(container.textContent?.match(new RegExp(zh("environmentLead").slice(0, 8), "g"))?.length).toBe(1);
  });

  it("先显示检测中,再出结果 —— 探测要起子进程,面板不该空着", async () => {
    let resolve!: (value: unknown) => void;
    getHostEnvironmentFacts.mockImplementationOnce(async () => await new Promise((done) => { resolve = done; }) as never);

    await act(async () => {
      root.render(<EnvironmentSettings />);
    });
    expect(container.textContent).toContain(zh("environmentProbing"));

    await act(async () => {
      resolve(facts());
    });
    expect(container.textContent).not.toContain(zh("environmentProbing"));
    expect(container.textContent).toContain(zh("environmentShell"));
  });

  it("三行都渲染,并且说清 Node 是自带那份(没有 npm)", async () => {
    await act(async () => {
      root.render(<EnvironmentSettings />);
    });

    const text = container.textContent ?? "";
    expect(text).toContain(zh("environmentShell"));
    expect(text).toContain(zh("environmentNode"));
    expect(text).toContain(zh("environmentPython"));
    expect(text).toContain(zh("environmentNodeWordless"));
    // 命令行是通用的:界面里不出现实现细节(bash / 路径),只给状态。
    expect(text).not.toContain("bash");
    expect(text).not.toContain("/bin/bash");
  });

  it("缺第三方包时给的是「一键装」,而不是让用户自己去装", async () => {
    getHostEnvironmentFacts.mockImplementation(async () =>
      facts({
        python: {
          found: true,
          version: "3.12.14",
          executable: "/runtimes/python/3.12.14/bin/python3",
          source: "wordless",
          packages: { openpyxl: true, pyarrow: false, pandas: false },
        },
      }) as never,
    );

    await act(async () => {
      root.render(<EnvironmentSettings />);
    });

    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(zh("environmentPythonInstall")));
    expect(button).toBeTruthy();
    // 这一条要说明"装到哪、多大、要不要网" —— 用户点之前应当知道。
    expect(container.textContent).toContain("56MB");

    await click(button);
    expect(installHostPythonPackages).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(zh("environmentPythonInstalled"));
    // 绝不碰系统 Python:面板里没有任何"下载页/安装器"的入口能走到系统环境。
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("Python 缺失时给的是出口,不是替用户装", async () => {
    await act(async () => {
      root.render(<EnvironmentSettings />);
    });

    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(zh("environmentPythonDownload")));
    expect(button).toBeTruthy();

    await click(button);
    expect(openExternalUrl).toHaveBeenCalledWith("https://www.python.org/downloads/");
    // 面板绝不代跑安装器:除了打开下载页,没有任何写操作。
    expect(redetectHostEnvironment).not.toHaveBeenCalled();
  });

  it("重新探测走显式那条路,并用新结果替换旧结论", async () => {
    await act(async () => {
      root.render(<EnvironmentSettings />);
    });
    expect(container.textContent).toContain(zh("environmentMissing"));

    const recheck = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(zh("environmentRecheck")));
    await click(recheck);

    expect(redetectHostEnvironment).toHaveBeenCalledTimes(1);
    // 新事实里 Python 已可用:那一行不再说"未安装"。
    expect(container.textContent).toContain("Python 3.12.4");
  });
});
