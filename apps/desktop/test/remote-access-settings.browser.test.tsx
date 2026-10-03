import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 设置 → 远程连接。
 *
 * 这一层验的是**页面自己必须负责的东西**:滚动容器与左右间距(对话框只给外框),
 * 以及"二维码只在真能用时出现、设备列表能解除配对"。
 *
 * 判定逻辑(什么时候显示二维码、状态怎么说)在 `remote-access-model.test.ts` 里单测,这里只看渲染与动作。
 */

const invite = (status: "ready" | "failed" = "ready") => ({
  pairingId: "p1",
  code: "K7Q29MXD",
  formattedCode: "K7Q2-9MXD",
  password: "123456",
  qrText: "https://relay.example/#/PAIR/K7Q29MXD/123456",
  expiresAt: Date.now() + 5 * 60_000,
  status,
});

const state = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  connection: "connecting",
  devices: [],
  relayBaseUrl: "wss://relay.example",
  defaultRelayBaseUrl: "wss://relay.example",
  ...overrides,
});

const getRemoteAccessState = vi.fn(async () => state() as never);
/** 主进程推过来的最新状态:测试用它模拟"手机刚连上"。 */
let pushRemoteAccessState: ((next: unknown) => void) | undefined;
const onRemoteAccessChanged = vi.fn((listener: (next: unknown) => void) => {
  pushRemoteAccessState = listener;
  return () => {
    pushRemoteAccessState = undefined;
  };
});
const setRemoteAccessEnabled = vi.fn(async () => state() as never);
const setRemoteRelayUrl = vi.fn(async () => state() as never);
const createRemoteInvite = vi.fn(async () => state() as never);
const withdrawRemoteInvite = vi.fn(async () => state() as never);
const revokeRemoteDevice = vi.fn(async () => state() as never);
const testRemoteRelay = vi.fn(async () => ({ ok: false, detail: "连不上 http://192.168.1.109:8787(fetch failed)。检查中继进程是否在运行" }));

/** 必须是**稳定引用**:组件里 `run` 的依赖是它,每次给新对象就会无限重渲染。 */
const client = {
  getRemoteAccessState,
  setRemoteAccessEnabled,
  setRemoteRelayUrl,
  createRemoteInvite,
  withdrawRemoteInvite,
  revokeRemoteDevice,
  testRemoteRelay,
  onRemoteAccessChanged,
};

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
  }),
}));

const { RemoteAccessSettings } = await import("../src/renderer/features/settings/RemoteAccessSettings.tsx");

let container: HTMLDivElement;
let root: Root;

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(<RemoteAccessSettings />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  getRemoteAccessState.mockClear();
  testRemoteRelay.mockClear();
  createRemoteInvite.mockClear();
  revokeRemoteDevice.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("设置 → 远程连接", () => {
  it("页面自己提供滚动容器与左右间距(对话框只给外框)", async () => {
    await render();
    const scroller = container.querySelector("div");
    // 这正是"页面不能滚动、且没有左右间距"那个缺陷的守卫。
    expect(scroller?.className).toContain("overflow-y-auto");
    expect(scroller?.className).toContain("min-h-0");
    expect(scroller?.className).toContain("flex-1");
    expect(scroller?.className).toContain("p-5");
    expect(scroller?.className).toContain("sm:p-8");
  });

  it("显示连接码与密码,并给出二维码", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ invite: invite() }) as never);
    await render();
    expect(container.textContent).toContain("K7Q2-9MXD");
    expect(container.textContent).toContain("123456");
    // 二维码是 SVG(qrcode.react 的 SVG 形态)。按 alt 文案精确定位 —— 页面上还有别的图标也是 SVG。
    expect(container.querySelector('[aria-label="远程配对二维码"]')).not.toBeNull();
  });

  it("邀请还没放上中继时不显示二维码,而是提示在准备", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ invite: invite("failed") }) as never);
    await render();
    expect(container.querySelector('[aria-label="远程配对二维码"]')).toBeNull();
  });

  it("列出已配对设备,并能解除配对", async () => {
    getRemoteAccessState.mockResolvedValueOnce(
      state({ devices: [{ id: "d1", name: "我的手机", createdAt: 1, online: true, paired: true }] }) as never,
    );
    await render();
    expect(container.textContent).toContain("我的手机");
    const revoke = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("解除配对"));
    expect(revoke).toBeDefined();
    await act(async () => {
      revoke?.click();
    });
    expect(revokeRemoteDevice).toHaveBeenCalledWith("d1");
  });

  it("能测中继连通性,并把地址与原因显示出来", async () => {
    await render();
    const probe = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("测试连接"));
    expect(probe).toBeDefined();
    await act(async () => {
      probe?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(testRemoteRelay).toHaveBeenCalled();
    // 结果里必须带**地址** —— 否则用户不知道该去查哪一个地址。
    expect(container.textContent).toContain("http://192.168.1.109:8787");
  });

  it("读取失败时给出错误提示,而不是空白页", async () => {
    getRemoteAccessState.mockRejectedValueOnce(new Error("连不上主进程"));
    await render();
    expect(container.textContent).toContain("连不上主进程");
  });

  it("手机连上之后界面自己更新:二维码收起、设备变在线", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ invite: invite() }) as never);
    await render();
    // 一开始:二维码在、设备列表空。
    expect(container.querySelector('[aria-label="远程配对二维码"]')).not.toBeNull();

    // 主进程推来"已被领取、手机在线"的新状态 —— 用户什么都不用做。
    await act(async () => {
      pushRemoteAccessState?.(
        state({
          connection: "online",
          devices: [{ id: "d1", name: "我的手机", createdAt: 1, online: true, paired: true }],
        }),
      );
    });
    expect(container.querySelector('[aria-label="远程配对二维码"]')).toBeNull();
    expect(container.textContent).toContain("我的手机");
    expect(container.textContent).toContain("在线");
  });

  it("还没被扫描的设备说等待手机扫描,而不是不在线", async () => {
    getRemoteAccessState.mockResolvedValueOnce(
      state({ devices: [{ id: "d1", name: "", createdAt: 1, online: false, paired: false }] }) as never,
    );
    await render();
    expect(container.textContent).toContain("等待手机扫描");
    expect(container.textContent).not.toContain("不在线");
  });

  it("有已配对设备时给出免二维码的地址", async () => {
    getRemoteAccessState.mockResolvedValueOnce(
      state({ devices: [{ id: "d1", name: "我的手机", createdAt: 1, online: false, paired: true }] }) as never,
    );
    await render();
    expect(container.textContent).toContain("手机上怎么打开");
    expect(container.textContent).toContain("https://relay.example");
  });
});
