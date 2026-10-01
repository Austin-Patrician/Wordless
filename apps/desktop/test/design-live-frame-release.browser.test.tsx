import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { DesignLiveFrameLayer } from "../src/renderer/features/design/DesignLiveFrameLayer";

/**
 * 活体视图的**交还**。
 *
 * 这里守着的是引用计数:卸载一个层不是"没人要活体了"。旧写法在卸载清理里无条件上报
 * `frameId: null`,于是同一份设计上还有另一层时,那一层的活体也会被交还 —— 而它不会重发
 * 自己的目标(键没变),于是活体白白消失到下一次相机移动。
 *
 * 另一半是**兜底**:那条释放资源的新 IPC 失败时,仍然要有一条 "frameId: null" 让视图从窗口
 * 上摘下来,否则原生视图会浮在界面上面(正是旧注释说要避免的症状)。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("design live frame release", () => {
  let container: HTMLDivElement;
  let root: Root;
  let setDesignLiveFrame: ReturnType<typeof vi.fn>;
  let disposeDesignResources: ReturnType<typeof vi.fn>;

  const bridge = (): DesktopBridge =>
    ({ setDesignLiveFrame, disposeDesignResources } as unknown as DesktopBridge);

  beforeEach(() => {
    setDesignLiveFrame = vi.fn(async () => true);
    disposeDesignResources = vi.fn(async () => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  /** 同一个容器上挂 `count` 层,用来模拟"同一份设计还剩下一层"。 */
  function renderLayers(count: number): void {
    const holder: { readonly current: HTMLElement | null } = { current: container };
    root.render(
      <ReactFlowProvider>
        <div style={{ height: 600, width: 800 }}>
          {Array.from({ length: count }, (_, index) => (
            <DesignLiveFrameLayer
              bridge={bridge()}
              containerRef={holder}
              designPath="design-a"
              dragging={false}
              enteredFrameId={null}
              frames={[]}
              hasTexture={false}
              key={index}
            />
          ))}
        </div>
      </ReactFlowProvider>,
    );
  }

  const nullReports = (): number =>
    setDesignLiveFrame.mock.calls.filter((call) => (call[0] as { frameId: string | null }).frameId === null).length;

  it("releases the native view when the last layer goes away", async () => {
    await act(async () => {
      renderLayers(1);
    });
    const reportsOnMount = nullReports();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    // 兜底那条:即使释放资源失败,视图也要被摘下来。
    expect(nullReports()).toBeGreaterThan(reportsOnMount);
    expect(disposeDesignResources).toHaveBeenCalledTimes(1);
  });

  it("keeps the view while another layer still wants it", async () => {
    await act(async () => {
      renderLayers(2);
    });
    const reportsBefore = nullReports();

    // 少一层,但还剩一层:既不该交还,也不该释放。
    await act(async () => {
      renderLayers(1);
      await Promise.resolve();
    });

    expect(nullReports()).toBeLessThanOrEqual(reportsBefore);
    expect(disposeDesignResources).not.toHaveBeenCalled();

    // 最后一层走了才释放。
    await act(async () => {
      renderLayers(0);
      await Promise.resolve();
    });

    expect(nullReports()).toBeGreaterThan(reportsBefore);
    expect(disposeDesignResources).toHaveBeenCalledTimes(1);
  });
});
