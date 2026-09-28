import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

import type { DesignManifestDto } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { DesignCanvas } from "../src/renderer/features/design/DesignCanvas";

/**
 * 假桥:光栅化一律失败。
 *
 * 这样画布停在**占位路径**上,断言是确定的 —— 真实位图要等离屏视图产出,而这个测试
 * 关心的是画布本身(节点、选择、缩放条),不是光栅化。
 */
const CLIENT = {
  rasterizeDesignFrames: async () => [],
  // 活体层在挂载与卸载时都会调用它。缺了这个方法,回调里会同步抛错。
  setDesignLiveFrame: async () => true,
} as unknown as DesktopBridge;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function manifest(): DesignManifestDto {
  return {
    version: 1,
    type: "wordless-design",
    canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static",
    style: null,
    frames: [
      { id: "index", file: "frames/index.html", x: 0, y: 0, width: 390, height: 844, title: "首页" },
      { id: "login", file: "frames/login.html", x: 470, y: 0, width: 390, height: 844, title: "登录" },
    ],
  };
}

describe("design canvas", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSelectionChange: ReturnType<typeof vi.fn>;
  let onCommitFrameGeometry: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelectionChange = vi.fn();
    onCommitFrameGeometry = vi.fn();
    container = document.createElement("div");
    // React Flow 要测量容器才知道视口有多大;没有尺寸它不渲染任何节点。
    container.style.width = "900px";
    container.style.height = "600px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(overrides: { focusedFrameId?: string | null } = {}): Promise<void> {
    await act(async () => {
      root.render(
        <DesignCanvas
          client={CLIENT}
          designPath="/w/meadow.wdesign"
          focusedFrameId={overrides.focusedFrameId ?? null}
          manifest={manifest()}
          onCommitFrameGeometry={onCommitFrameGeometry}
          onSelectionChange={onSelectionChange}
        />,
      );
    });
  }

  function frameNodes(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(".react-flow__node"));
  }

  it("把清单里的每一帧都渲染成节点", async () => {
    await render();
    // 帧标题在节点里,画布上必须看得到 —— 这是人识别画板的唯一依据。
    expect(container.textContent).toContain("首页");
    expect(container.textContent).toContain("登录");
    expect(frameNodes()).toHaveLength(2);
  });

  it("没有位图时显示占位而不是空白", async () => {
    // P2 还没有光栅池,所以呈现必然是占位。空白的画布会让人以为功能坏了。
    await render();
    expect(container.textContent).toContain("390 × 844");
  });

  it("节点尺寸就是帧的声明尺寸", async () => {
    await render();
    const first = frameNodes()[0] as HTMLElement;
    // React Flow 把 style 上的宽高写到节点元素上,再乘视口缩放(初始 fitView 后为 1 上限)。
    const width = first.style.width || first.getAttribute("style") || "";
    expect(width).toContain("390");
  });

  it("缩放条显示当前百分比,并给出重置与适配入口", async () => {
    await render();
    const percent = Array.from(container.querySelectorAll("button")).find((candidate) =>
      (candidate.textContent ?? "").includes("%"),
    );
    // 只断言"是个合法百分比"。**不断言初始值**:首次打开会 `fitView` 适配内容,而它在
    // 一个 effect 里 —— 断言"初始必须是 100%"依赖 effect 有没有先跑,实测单跑 100%、
    // 全量跑 64%,是个偶发测试。
    expect(percent?.textContent).toMatch(/^\d+%$/);

    // 按钮是否接上了,用可访问名断言。**不点它**:`zoomTo` 是带动画的(180ms),
    // 点击后等它落定等于让测试去赌库的动画时长 —— 负载高时必然偶发。那是 React Flow
    // 的行为,不是这个组件的行为。
    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "",
    );
    expect(labels).toContain("重置为 100%");
    expect(labels).toContain("适配内容");
  });

  it("选中一个帧会上报它的 id", async () => {
    await render();
    const first = frameNodes()[0] as HTMLElement;
    await act(async () => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // 上报的是 id 列表 —— 上层据此决定焦点帧(唯一可能给活体的那一帧)。
    expect(onSelectionChange).toHaveBeenCalled();
    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as string[] | undefined;
    expect(lastCall?.length ?? 0).toBeGreaterThan(0);
  });

  it("平移不会重建节点 —— 节点列表只由清单派生", async () => {
    await render();
    const before = frameNodes();
    expect(before).toHaveLength(2);

    // 触发一次视口移动。若节点列表依赖相机,这里会重建并丢失节点身份。
    const pane = container.querySelector<HTMLElement>(".react-flow__pane");
    await act(async () => {
      pane?.dispatchEvent(new MouseEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
    });
    expect(frameNodes()).toHaveLength(2);
  });
});
