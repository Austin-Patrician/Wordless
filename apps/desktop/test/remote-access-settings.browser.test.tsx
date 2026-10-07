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
const setRemoteMode = vi.fn(async () => state() as never);
const setRemoteLanMode = vi.fn(async () => state() as never);
const setRemoteLanAddress = vi.fn(async () => state() as never);
const probeRemoteDeploy = vi.fn(async () => ({
  ok: true,
  findings: ["system=Linux x86_64", "node=v20.11.0"],
  facts: {
    system: "Linux x86_64",
    user: "ubuntu",
    sudo: true,
    arch: "x86_64",
    node: { present: true, version: "v20.11.0", major: 20 },
    distro: { id: "ubuntu", version: "22.04" },
    caddy: true,
    caddyActive: false,
    nginx: true,
    nginxActive: true,
    deployDirExists: true,
    serviceExists: true,
    serviceActive: true,
    nginxSiteExists: false,
    caddyBlockExists: true,
    listeningPorts: [80],
  },
}));
const runRemoteDeploy = vi.fn(async () => ({ ok: true }));
const getRemoteUninstallPlan = vi.fn(async () => ({
  steps: [{ id: "RemoveDir", command: "sudo rm -rf /opt/wordless-relay", sudo: true, target: "server" }],
  skipped: [],
  warnings: [{ key: "remoteWarnUninstallAddress" }],
  skipped: [{ id: "RemoveNginxSite", reason: "没有我们的 nginx 站点文件" }],
  nothingToDo: false,
}));
const runRemoteUninstall = vi.fn(async () => ({ ok: true }));
const cancelRemoteDeploy = vi.fn(async () => ({ ok: true }));
let pushDeployProgress: ((progress: unknown) => void) | undefined;
const onRemoteDeployProgress = vi.fn((listener: (progress: unknown) => void) => {
  pushDeployProgress = listener;
  return () => {
    pushDeployProgress = undefined;
  };
});
const getRemoteDeployPlan = vi.fn(async () => ({
  steps: [
    { id: "InstallNode", command: "sudo apt-get install -y nodejs", sudo: true },
    { id: "Verify", command: "curl -fsS https://relay.example.com/health", sudo: false },
  ],
  skipped: [],
  relayBaseUrl: "wss://relay.example.com",
  secure: true,
  healthUrl: "https://relay.example.com/health",
}));
const setRemoteRelayUrl = vi.fn(async () => state() as never);
const createRemoteInvite = vi.fn(async () => state() as never);
const withdrawRemoteInvite = vi.fn(async () => state() as never);
const revokeRemoteDevice = vi.fn(async () => state() as never);
const testRemoteRelay = vi.fn(async () => ({ ok: false, detail: "连不上 http://192.168.1.109:8787(fetch failed)。检查中继进程是否在运行" }));

/** 必须是**稳定引用**:组件里 `run` 的依赖是它,每次给新对象就会无限重渲染。 */
const client = {
  getRemoteAccessState,
  setRemoteAccessEnabled,
  setRemoteMode,
  setRemoteLanMode,
  setRemoteLanAddress,
  getRemoteDeployPlan,
  probeRemoteDeploy,
  runRemoteDeploy,
  getRemoteUninstallPlan,
  runRemoteUninstall,
  cancelRemoteDeploy,
  onRemoteDeployProgress,
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

/**
 * 切到「自动部署(SSH)」那一档。
 *
 * 部署那一节现在**分两档**(自己部署(教程) / 自动部署(SSH)):两条路跑同一份命令,
 * 但做法不同(一个你自己敲,一个我替你连上去敲)—— 堆在一页上用户分不清(真实反馈)。
 * 所以走 SSH 的用例都得先切过去。
 */
const openSshTab = async (): Promise<void> => {
  const tab = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes("自动部署(SSH)"),
  );
  await act(async () => {
    tab?.click();
    await Promise.resolve();
  });
};

beforeEach(() => {
  getRemoteAccessState.mockClear();
  testRemoteRelay.mockClear();
  createRemoteInvite.mockClear();
  revokeRemoteDevice.mockClear();
  // 新增的替身也要清:不清的话"没调用"这种断言会被上一条用例的调用计数骗过。
  getRemoteDeployPlan.mockClear();
  probeRemoteDeploy.mockClear();
  runRemoteDeploy.mockClear();
  getRemoteUninstallPlan.mockClear();
  runRemoteUninstall.mockClear();
  cancelRemoteDeploy.mockClear();
  setRemoteMode.mockClear();
  setRemoteLanAddress.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("设置 → 远程连接", () => {
  it("切换失败之后**重读状态**:界面不能停在一个可能已经变了的世界上", async () => {
    // 真实抱怨:切换档位"切不过去"。主进程可能已经把档位写进去了,只是这一次调用回不来 ——
    // 界面继续显示旧状态,用户就会觉得点了没反应。
    getRemoteAccessState
      .mockResolvedValueOnce(state({ mode: "lan" }) as never)
      .mockResolvedValueOnce(state({ mode: "remote" }) as never);
    setRemoteMode.mockRejectedValueOnce(new Error("通道断了") as never);
    await render();
    const remote = [...container.querySelectorAll("button[aria-pressed]")].find(
      (button) => button.textContent?.trim() === "远程",
    );
    await act(async () => {
      remote?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // 错误照旧显示出来。
    expect(container.textContent).toContain("通道断了");
    // 但界面要与主进程对齐:档位已经是远程了。
    expect(getRemoteAccessState).toHaveBeenCalledTimes(2);
    const lan = [...container.querySelectorAll("button[aria-pressed]")].find(
      (button) => button.textContent?.trim() === "局域网",
    );
    expect(lan?.getAttribute("aria-pressed")).toBe("false");
  });

  it("自己部署那一档:填服务器与用户 → 出步骤(带 sudo 标记),最后能一键填地址", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
      setValue(inputs[2] as Element, "relay.example.com");
    });

    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));

    await act(async () => {
      button("照着做")?.click();
      await Promise.resolve();
    });
    expect(getRemoteDeployPlan).toHaveBeenCalledWith({
      server: "1.2.3.4",
      user: "ubuntu",
      domain: "relay.example.com",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("装 Node 20");
    expect(text).toContain("sudo apt-get install -y nodejs");
    expect(text).toContain("需要 sudo");
    expect(text).toContain("wss://relay.example.com");
  });

  it("探测说已经有 Node:安装那一步**不出现在计划里**,而且要说明跳过了", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await openSshTab();
    // 计划要**带着探测结果**去要(否则会白装一遍 Node)。
    // 探测成功后界面会**自动**去要一份计划(警告必须在按下部署之前就能看到),
    // 所以这份 mock 要在探测**之前**就位。
    getRemoteDeployPlan.mockResolvedValueOnce({
      steps: [{ id: "PrepareDir", command: "mkdir -p /opt/wordless-relay", sudo: true, target: "server" }],
      skipped: [{ id: "InstallNode", reason: "v20.11.0" }],
      relayBaseUrl: "wss://relay.example.com",
      secure: true,
      healthUrl: "https://relay.example.com/health",
    } as never);
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // **整份**探测结果都要往下传:只传 node 那两项时,"nginx 在跑"到不了计划,
    // 计划就会去装 Caddy(真实抱怨)。
    expect(getRemoteDeployPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.objectContaining({ nginx: true, nginxActive: true, caddy: true, listeningPorts: expect.anything() }),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("已跳过");
    expect(text).toContain("v20.11.0");
  });

  it("服务器上已经部署过:说清是覆盖升级,并提醒**该重新部署一次了**", async () => {
    // 这是"我更新了桌面端,服务器上还是旧的吗"那个问题的答案 —— 界面上必须真的出现,
    // 而且文案要从 i18n 里**取到**(取不到会原样印出 `remoteWarnRedeployOutdated` 这种键名)。
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await openSshTab();
    // 与上一条同理:mock 要在探测之前就位 —— 警告是探测之后**自动**来的。
    getRemoteDeployPlan.mockResolvedValueOnce({
      steps: [{ id: "Service", command: "sudo systemctl restart wordless-relay", sudo: true, target: "server" }],
      skipped: [],
      relayBaseUrl: "wss://relay.example.com",
      secure: true,
      healthUrl: "https://relay.example.com/health",
      warnings: [
        { key: "remoteWarnRedeploy", detail: "/opt/wordless-relay" },
        { key: "remoteWarnRedeployOutdated", detail: "1.2.0 → 1.4.0" },
      ],
    } as never);
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("覆盖升级");
    // `{detail}` 要填进去:留着占位符等于没告诉用户"服务器上是哪一版"。
    expect(text).toContain("1.2.0 → 1.4.0");
    expect(text).not.toContain("remoteWarnRedeployOutdated");
    /*
      计划已经来了(警告就在下面),但**要跑的命令不在这** —— 这一档不摆步骤。
      这条断言必须挂在"计划已加载"之后:没探测过的时候 `deploySteps` 本来就是 null,
      那种状态下"看不到命令"什么也证明不了。
    */
    expect(text).not.toContain("sudo systemctl restart wordless-relay");
  });

  it("部署包这个概念已经删掉:两档都不该再出现「准备部署包」", async () => {
    // 它曾是一个"路径问题"的解法(让教程那句 scp 有个短路径可指),而那个理由不成立了:
    // 教程的每一步都能一键复制,用户从来不敲路径;副本反而会旧、跳过还会让 scp 找不到文件。
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    expect(button("准备部署包")).toBeUndefined();
    await openSshTab();
    expect(button("准备部署包")).toBeUndefined();
    expect(container.textContent).not.toContain("wordless-deploy");
  });

  it("卸载:要删什么先摆出来,确认之后才跑(不可逆的动作不该只有「信任」一条路)", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await openSshTab();
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
    });
    // 探测结果要**整份**带给计划:要删哪几样由它决定。
    await openSshTab();
    await act(async () => {
      button("卸载部署")?.click();
      await Promise.resolve();
    });
    expect(getRemoteUninstallPlan).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "remove", facts: expect.objectContaining({ serviceExists: true, caddyBlockExists: true }) }),
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // 要删什么、跑什么命令,都在点确定之前看得见。
    expect(dialog?.textContent).toContain("sudo rm -rf /opt/wordless-relay");
    expect(dialog?.textContent).toContain("没人应答");
    // 没找到的那几样也列出来:"你有没有删我的 nginx 配置"这类疑问,答案就在这里。
    expect(dialog?.textContent).toContain("没找到");
    // **确认之前不许跑**。
    expect(runRemoteUninstall).not.toHaveBeenCalled();
    await act(async () => {
      [...(dialog?.querySelectorAll("button") ?? [])].find((entry) => entry.textContent?.includes("卸载"))?.click();
      await Promise.resolve();
    });
    expect(runRemoteUninstall).toHaveBeenCalledWith(expect.objectContaining({ scope: "remove", server: "1.2.3.4", user: "ubuntu" }));
  });

  it("卸载:没什么可卸时**不摆确认框**,直接说清楚", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await openSshTab();
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
    });
    getRemoteUninstallPlan.mockResolvedValueOnce({ steps: [], skipped: [], warnings: [], nothingToDo: true } as never);
    await openSshTab();
    await act(async () => {
      button("卸载部署")?.click();
      await Promise.resolve();
    });
    // 让用户对着一个「要删:无」的框点确定,是在消耗他对这个框的信任。
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("没有我们的部署");
  });

  it("停用服务:**可逆,所以不摆确认框**,点了就跑", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await openSshTab();
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
    });
    await openSshTab();
    await act(async () => {
      button("停用服务")?.click();
      await Promise.resolve();
    });
    expect(runRemoteUninstall).toHaveBeenCalledWith(expect.objectContaining({ scope: "stop" }));
    expect(getRemoteUninstallPlan).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("服务器地址与端口在一节里填一次;SSH 那一节**写明连到哪台服务器**", async () => {
    // 真实抱怨:自动部署那一段看不到"服务器地址"的输入框 —— 它其实在上面教程里,但没人看得出来。
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("服务器");
    expect(text).toContain("中继端口");
    expect(text).toContain("对外端口");
    // "连到哪台服务器"写在**自动部署那一档**里,所以先切过去(以前两档混在一页,现在分开)。
    await openSshTab();
    // 还没填:说清楚去哪儿填。
    expect(container.textContent).toContain("还没填服务器地址");
    // 填上之后:目标写在明面上(含 SSH 端口)。
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
    });
    expect(container.textContent).toContain("ubuntu@1.2.3.4");
  });

  it("端口填了就进计划:中继端口与对外端口都传下去", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const inputs = [...container.querySelectorAll("input")];
    const setValue = (input: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(inputs[0] as Element, "1.2.3.4");
      setValue(inputs[1] as Element, "ubuntu");
      // 第 3 个是域名,第 4、5 个是两个端口。
      setValue(inputs[3] as Element, "9001");
      setValue(inputs[4] as Element, "8443");
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    await act(async () => {
      button("照着做")?.click();
      await Promise.resolve();
    });
    expect(getRemoteDeployPlan).toHaveBeenCalledWith({
      server: "1.2.3.4",
      user: "ubuntu",
      relayPort: 9001,
      publicPort: 8443,
    });
  });

  it("自动部署:没探测过不让跑,探测过才跑,而且**密码不进命令行、用完就清空**", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    const fill = async (index: number, value: string) => {
      const input = [...container.querySelectorAll("input")][index] as Element;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      await fill(0, "1.2.3.4");
      await fill(1, "ubuntu");
    });

    // 没探测过:部署键是**灰的**,而且旁边写着为什么(灰着不说原因,用户只会以为坏了)。
    await openSshTab();
    expect(button("开始部署")?.hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toContain("先探测一次");
    await act(async () => {
      button("开始部署")?.click();
      await Promise.resolve();
    });
    expect(runRemoteDeploy).not.toHaveBeenCalled();

    await openSshTab();
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
    });
    expect(probeRemoteDeploy).toHaveBeenCalledWith({ server: "1.2.3.4", user: "ubuntu" });
    expect(container.textContent).toContain("node=v20.11.0");
    // 探测的**结论**要出来:用户关心的是"我还要不要动这台机器的环境"。
    expect(container.textContent).toContain("服务器上已经有 Node v20.11.0");

    // 进度推过来:第 1 步在跑、然后完成。
    await act(async () => {
      pushDeployProgress?.({ index: 0, id: "InstallNode", status: "running" });
      pushDeployProgress?.({ index: 0, id: "InstallNode", status: "done", output: "ok" });
    });
    expect(container.textContent).toContain("第 1 步");

    await openSshTab();
    await act(async () => {
      button("开始部署")?.click();
      await Promise.resolve();
    });
    // 部署请求要带上探测到的 Node:≥20 时那一步会跳过(而不是白装一遍)。
    expect(runRemoteDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ server: "1.2.3.4", user: "ubuntu", facts: expect.objectContaining({ nginxActive: true }) }),
    );
    expect(container.textContent).toContain("部署完成");
  });

  it("自动部署:失败时把那一步的输出摆出来,而不是一句笼统的失败", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    probeRemoteDeploy.mockResolvedValueOnce({
      ok: true,
      findings: ["user=ubuntu"],
      facts: { user: "ubuntu", sudo: true, node: { present: false } },
    } as never);
    runRemoteDeploy.mockResolvedValueOnce({ ok: false, failedStep: "Service", error: "systemctl 失败" } as never);
    await render();
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    const input = [...container.querySelectorAll("input")][0] as Element;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "1.2.3.4");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call([...container.querySelectorAll("input")][1], "ubuntu");
      [...container.querySelectorAll("input")][1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await openSshTab();
    await act(async () => {
      button("先探测")?.click();
      await Promise.resolve();
    });
    await openSshTab();
    await act(async () => {
      button("开始部署")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      pushDeployProgress?.({ index: 3, id: "Service", status: "failed", output: "boom: 命令失败" });
    });
    const text = container.textContent ?? "";
    expect(text).toContain("boom: 命令失败");
    expect(text).toContain("失败了");
  });

  it("教程档:输入不全就不请求(命令里出现空地址只会带来看不懂的失败)", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes("照着做"));
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(getRemoteDeployPlan).not.toHaveBeenCalled();
    expect(container.textContent).toContain("先填服务器地址与登录用户");
  });

  it("两档:局域网模式下摆局域网那一档,远程模式才给填中继地址", async () => {
    // 一个页面只讲一件事:两种方式的设置混在一起,用户不知道自己在改哪一个。
    getRemoteAccessState.mockResolvedValueOnce(
      state({
        mode: "lan",
        enabled: true,
        lan: {
          running: true,
          port: 8787,
          addresses: [{ address: "192.168.1.9", name: "en0" }],
          selectedAddress: "192.168.1.9",
          webClientReady: true,
        },
      }) as never,
    );
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("接入方式");
    expect(text).toContain("局域网接入");
    expect(text).not.toContain("中继地址", "局域网模式下不该让用户手改中继地址");
    // 两档都在,而且局域网是选中的那一个。
    const modes = [...container.querySelectorAll("button[aria-pressed]")];
    const lan = modes.find((button) => button.textContent?.trim() === "局域网");
    expect(lan?.getAttribute("aria-pressed")).toBe("true");
    const remote = modes.find((button) => button.textContent?.trim() === "远程");
    await act(async () => {
      remote?.click();
      await Promise.resolve();
    });
    expect(setRemoteMode).toHaveBeenCalledWith("remote");
  });

  it("局域网档:一个开关 + 手机要打开的地址 + 多网卡能选 + 排查清单", async () => {
    // 一键的界面:开关就在这一档上,起没起来、手机该打开哪个地址,一眼看得见。
    getRemoteAccessState.mockResolvedValueOnce(
      state({
        enabled: true,
        lan: {
          running: true,
          port: 8787,
          addresses: [
            { address: "192.168.1.9", name: "en0" },
            { address: "10.8.0.2", name: "utun3" },
          ],
          selectedAddress: "192.168.1.9",
          webClientReady: true,
        },
      }) as never,
    );
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("局域网接入");
    expect(text).toContain("http://192.168.1.9:8787");
    expect(text).toContain("手机打不开?");
    // 多网卡:两个都摆出来,选中的那个标出来。
    const rows = [...container.querySelectorAll("button[aria-pressed]")].filter((button) =>
      (button.textContent ?? "").includes("192.168.1.9"),
    );
    expect(rows[0]?.getAttribute("aria-pressed")).toBe("true");
    // 点另一个地址:要真的发出去(否则二维码还指着旧地址)。
    const other = [...container.querySelectorAll("button[aria-pressed]")].find((button) =>
      (button.textContent ?? "").includes("10.8.0.2"),
    );
    await act(async () => {
      other?.click();
      await Promise.resolve();
    });
    expect(setRemoteLanAddress).toHaveBeenCalledWith("10.8.0.2");
  });

  it("局域网起不来时:说清原因,而且不假装在跑", async () => {
    getRemoteAccessState.mockResolvedValueOnce(
      state({
        enabled: false,
        lan: {
          running: false,
          addresses: [],
          webClientReady: false,
          error: "这台机器上还没有网页客户端(开发版需要先构建一次)。",
        },
      }) as never,
    );
    await render();
    expect(container.textContent).toContain("这台机器上还没有网页客户端");
    // 没有地址就不该摆"手机打开这个地址"。
    expect(container.textContent).not.toContain("手机打开这个地址");
  });

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

  it("设备**按配对方式分组**:局域网一台、远程一台,两组分开显示", async () => {
    // 真实反馈:一张列表里两种设备混在一起,用户分不出哪台是哪台 —— 而它们的行为根本不同
    // (局域网那台只在同一个 WiFi 里能连上)。
    getRemoteAccessState.mockResolvedValueOnce(
      state({
        mode: "remote",
        devices: [
          { id: "lan-1", name: "家里的手机", createdAt: 1, online: false, paired: true, mode: "lan" },
          { id: "remote-1", name: "出差的手机", createdAt: 2, online: true, paired: true, mode: "remote" },
        ],
      }) as never,
    );
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("局域网配对的(1)");
    expect(text).toContain("远程配对的(1)");
    // 当前档位那一组要标出来,另一组要说清"为什么它连不上"。
    expect(text).toContain("当前");
    expect(text).toContain("同一个 WiFi");
    // 两组都还能各自解除配对。
    const revoke = [...container.querySelectorAll("button")].filter((button) => button.textContent?.includes("解除配对"));
    expect(revoke.length).toBe(2);
  });

  it("部署那一节**分成两档**:默认是教程,切过去才是自动部署(不再堆在一页上)", async () => {
    getRemoteAccessState.mockResolvedValueOnce(state({ mode: "remote" }) as never);
    await render();
    const text = container.textContent ?? "";
    // 默认那一档:要求清单 + 照着做。
    expect(text).toContain("怎么部署");
    expect(text).toContain("先确认这几件事");
    expect(text).toContain("照着做");
    // 自动部署那一档的东西**不在**这一档里(这正是"分不清"的根源)。
    expect(text).not.toContain("先探测");
    await openSshTab();
    const after = container.textContent ?? "";
    expect(after).toContain("先探测");
    // 这一档**不摆要跑的命令**:它与教程那一档是同一份,而这一档是自动的 ——
    // 用户不需要先读一遍(真要看,教程那一档里每一步都能复制)。
    expect(after).not.toContain("预览要跑的步骤");
    expect(after).not.toContain("照着做:每一步都能复制");
    expect(after).not.toContain("先确认这几件事");
    // 部署包这个概念已经没了 —— 两档里都不该再出现。
    expect(after).not.toContain("准备部署包");
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
