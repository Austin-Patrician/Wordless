import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 设置弹窗的**关闭按钮**必须点得到 —— 尤其是打开"远程连接"那一页时。
 *
 * 真实反馈:部署那一节分成两档(教程 / 自动部署)之后,右上角的关闭按钮"点不了、鼠标很难 focus 住"。
 * 这一条把它钉住:渲染设置弹窗 + 远程连接页,点关闭按钮,断言 `onOpenChange(false)` 被调用,
 * 而且**没有别的东西盖在上面**(用 `elementFromPoint` 查指针位置上的最上层元素 —— 没有 Tailwind
 * 也能测:盖住是因为有元素铺在上面,不是因为样式)。
 */

const mocks = vi.hoisted(() => ({
  client: {
    getRemoteAccessState: vi.fn(async () => ({
      connection: "off",
      devices: [],
      enabled: false,
      lan: undefined,
      mode: "remote",
      relayBaseUrl: "wss://relay.example.com",
    })),
    onRemoteAccessChanged: vi.fn(() => () => {}),
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
import { SettingsDialog } from "../src/renderer/features/settings/SettingsDialog";

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

const render = async (onOpenChange: (open: boolean) => void): Promise<HTMLElement> => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        <PreferencesProvider>
          <SettingsDialog initialPage="remoteAccess" onOpenChange={onOpenChange} onOpenSession={() => {}} open />
        </PreferencesProvider>
      </StrictMode>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
};

describe("设置弹窗的关闭按钮", () => {
  it("远程连接那一页打开时:按钮在,点得到,而且指针位置上没有别的东西盖着", async () => {
    const onOpenChange = vi.fn();
    const container = await render(onOpenChange);

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]');
    expect(close).not.toBeNull();
    expect(close?.disabled).toBe(false);

    // 指针落在按钮中心时,最上层的元素必须是按钮自己(或它的图标)。
    const rect = close!.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    expect(
      top === close || close!.contains(top),
      `指针位置上的最上层元素是 ${top?.tagName ?? "null"}.${top?.className ?? ""} —— 关闭按钮被它盖住了`,
    ).toBe(true);

    await act(async () => {
      close!.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Esc 也能关掉设置(鼠标点不到关闭按钮时的那条出路)", async () => {
    const onOpenChange = vi.fn();
    await render(onOpenChange);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("这一页里**没有**铺满视口的浮层(除了用户主动打开的那个确认框)", async () => {
    const container = await render(vi.fn());
    const overlays = [...container.querySelectorAll("div")].filter((element) => {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "absolute") return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth - 2 && rect.height >= window.innerHeight - 2;
    });
    expect(overlays.map((element) => element.className)).toEqual([]);
  });
});
