import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 内联浮层**必须声明遮挡**。
 *
 * 为什么:内嵌浏览器那张页面是原生的 `WebContentsView`,**永远画在所有 DOM 之上**,
 * 和 `z-index` 无关。一个不声明自己的内联弹窗(不是 portal 的那种)会被它压住 ——
 * 用户看到的是"弹出来了,却点不到",而且只有**被压住的那一条**点不到(设置弹窗里就是右上角
 * 那个关闭按钮)。
 *
 * 协调器(`browserOcclusion`)另外还有两条兜底:portal 检测与几何采样。采样是**概率性的**
 * (网格点落在被压住的那一小块之外就发现不了),所以"盖住一大片"的弹窗不能指望它 ——
 * 这一组用例钉的就是"它们自己说了"。
 */

const mocks = vi.hoisted(() => ({
  client: {
    getProxySnapshot: vi.fn(async () => ({
      active: { invalid: false, source: "direct" },
      config: { enabled: false, host: "", passwordConfigured: false, port: 0, protocol: "http", username: "" },
    })),
    setPreferences: vi.fn(async () => {}),
  },
  snapshot: {
    extensions: { configurations: {}, descriptors: [] },
    modelConfiguration: { models: [] },
    preferences: {
      appearance: { background: { blurPx: 0, fit: "cover", intensity: 40, position: { x: 50, y: 50 }, source: { kind: "none" } } },
      defaultModel: null,
      defaultWorkspaceRoot: "/workspace",
      entryModels: {},
      fontScale: 1,
      locale: "zh-CN",
      notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
      reduceMotion: false,
      security: { customCommandRules: [], customFileRules: [] },
      theme: "system",
      translation: { bubbleMaxChars: 600, model: null, targetLanguage: null },
    },
    sessions: [],
    workspaces: [],
  },
}));

vi.mock("../src/renderer/platform/desktop-update", () => ({
  DesktopUpdateProvider: ({ children }: { children: React.ReactNode }) => children,
  useDesktopUpdate: () => ({ appInfo: { name: "Wordless", version: "0.0.0" } }),
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ client: mocks.client, error: null, refresh: async () => {}, snapshot: mocks.snapshot, status: "ready" }),
  useRuntimeClient: () => mocks.client,
}));

import { PreferencesProvider } from "../src/renderer/shared/preferences";
import { browserOcclusion } from "../src/renderer/features/browser/occlusion";
import { SettingsDialog } from "../src/renderer/features/settings/SettingsDialog";
import { CreateWorkspaceDialog } from "../src/renderer/features/workbench/CreateWorkspaceDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

const renderUi = async (node: React.ReactNode): Promise<HTMLElement> => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<StrictMode><PreferencesProvider><div>{node}</div></PreferencesProvider></StrictMode>);
  });
  return container;
};

describe("内联浮层声明遮挡", () => {
  it("设置弹窗打开时声明,关闭时释放", async () => {
    // 真实反馈:设置右上角的关闭按钮"点不了" —— 因为它落在被原生视图压住的那一条里。
    await renderUi(<SettingsDialog initialPage="general" onOpenChange={() => {}} open />);
    expect(browserOcclusion.occluded).toBe(true);
    expect(browserOcclusion.reasons).toContain("dialog");

    // 卸载即释放(协调器用 token,重叠的浮层不会互相提前放行)。
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    expect(browserOcclusion.occluded).toBe(false);
  });

  it("新建工作区弹窗(内联的 fixed 浮层,不是 portal)也声明", async () => {
    await renderUi(<CreateWorkspaceDialog onCreate={async () => {}} onOpenChange={() => {}} open />);
    expect(browserOcclusion.occluded).toBe(true);
  });
});
