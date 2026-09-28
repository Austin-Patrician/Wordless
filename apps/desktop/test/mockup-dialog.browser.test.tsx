import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

import type { DesignManifestDto } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { MockupExportDialog } from "../src/renderer/features/design/mockup-export-dialog";

/**
 * 导出合成图弹窗。
 *
 * 这里守着的是**弹窗自己的判断**:空态、加入即进渲染区、**还缺位图就不许导出**这条闸门、
 * 以及三条动作真的把正确的载荷交给了桥。合成几何与绘制各有自己的测试(纯核心 + 渲染),
 * 不在这里重复。
 *
 * 假光栅返回的是**真的 JPEG 字节**:弹窗要用 `createImageBitmap` 解它 —— 递一段假字节的话
 * 每一帧都会被标成"没渲染出来",那是测试在骗自己。
 */

const MANIFEST: DesignManifestDto = {
  version: 1,
  type: "wordless-design",
  canvas: { x: 0, y: 0, zoom: 1 },
  mode: "built",
  style: null,
  frames: [
    { id: "index", file: "frames/index.html", x: 0, y: 0, width: 390, height: 844, title: "首页" },
    { id: "mine", file: "frames/mine.html", x: 470, y: 0, width: 390, height: 844, title: "我的" },
  ],
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let jpeg: Uint8Array;
let rasterize: ReturnType<typeof vi.fn>;
let save: ReturnType<typeof vi.fn>;
let copy: ReturnType<typeof vi.fn>;

const BRIDGE = {
  readSessionWorkspaceTextFile: async () => ({ status: "available", content: "@theme { --color-primary: #4f46e5; }" }),
  rasterizeDesignFrames: (...args: unknown[]) => rasterize(...args),
  saveDesignImage: (...args: unknown[]) => save(...args),
  copyDesignImage: (...args: unknown[]) => copy(...args),
} as unknown as DesktopBridge;

describe("mockup export dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // 一张真的 1×1 JPEG —— 走 canvas 编码,所以 `createImageBitmap` 一定认得。
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0f7a4f";
    context.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg"));
    jpeg = new Uint8Array(await blob!.arrayBuffer());

    rasterize = vi.fn(async ({ frames }: { frames: { frameId: string; bucket: number }[] }) =>
      frames.map((frame) => ({ ok: true as const, key: `${frame.frameId}@${frame.bucket}`, bytes: jpeg, width: 390, height: 844 })),
    );
    save = vi.fn(async () => ({ ok: true as const, path: "/out/x.png" }));
    copy = vi.fn(async () => true);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <MockupExportDialog
          bridge={BRIDGE}
          designDir="designs/x.wdesign"
          designPath="/w/designs/x.wdesign"
          manifest={MANIFEST}
          onClose={() => {}}
          sessionId="s1"
        />,
      );
    });
  }

  const text = (): string => document.body.textContent ?? "";
  /**
   * 等抓图落地。
   *
   * `createImageBitmap` 在 act 的微任务刷新之后才 resolve,所以"点一下然后立刻断言"必然
   * 读到还没更新的那一帧 —— 这类异步 UI 只能等,不能猜时序。
   */
  const waitReady = async (): Promise<void> => {
    await vi.waitFor(() => {
      expect(byText("mockupSave")?.disabled).toBe(false);
    });
  };
  const buttons = (): HTMLButtonElement[] => [...document.body.querySelectorAll("button")];
  /** 精确匹配:格式切换、保存/复制这些按钮的文案就是键本身。 */
  const byText = (needle: string): HTMLButtonElement | undefined =>
    buttons().find((button) => (button.textContent ?? "").trim() === needle);
  /**
   * 左栏的画框按钮里除了标题还有一块缩览占位,所以 `textContent` 不等于标题 ——
   * 用包含查找。(它同时也会命中预览里的那一帧,所以只在左栏还没清空时用。)
   */
  const buttonContaining = (needle: string): HTMLButtonElement | undefined =>
    buttons().find((button) => (button.textContent ?? "").includes(needle));
  const canvases = (): HTMLCanvasElement[] => [...document.body.querySelectorAll("canvas")];

  it("says what to do when nothing is attached yet", async () => {
    await render();

    expect(text()).toContain("mockupEmptyTitle");
    expect(canvases()).toHaveLength(0);
  });

  it("moves a frame from the rail into the render on click", async () => {
    await render();
    expect(text()).toContain("首页");

    await act(async () => {
      buttonContaining("首页")!.click();
    });

    // 加入之后它不再出现在左栏(列表是"已加入"的补集),而且渲染区里多了一页画布。
    expect(text()).not.toContain("mockupRailAllAdded");
    expect(canvases().length).toBeGreaterThan(0);
  });

  it("blocks export while a capture has not arrived", async () => {
    // 抓图挂住不返回:这时候**什么都不该能导出** —— 否则导出的是一行灰色占位块。
    let release: (() => void) | null = null;
    rasterize.mockImplementation(
      async ({ frames }: { frames: { frameId: string; bucket: number }[] }) =>
        await new Promise((resolve) => {
          release = () =>
            resolve(
              frames.map((frame) => ({ ok: true as const, key: `${frame.frameId}@${frame.bucket}`, bytes: jpeg, width: 390, height: 844 })),
            );
        }),
    );

    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });

    expect(byText("mockupSave")?.disabled).toBe(true);
    expect(byText("mockupCopy")?.disabled).toBe(true);

    await act(async () => {
      release?.();
    });
    await waitReady();
  });

  it("captures at the export scale, because the bitmap has to land on those exact pixels", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();

    // 默认 2x:抓图倍率与"这一帧要占多少像素"必须同源 —— 抓 1 倍再放大就糊,
    // 抓 2 倍而按 1 倍画就会丢一半细节。
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect((rasterize.mock.calls[0]![0] as { frames: { bucket: number }[] }).frames[0]!.bucket).toBe(2);

    // 改成 1x 之后要按新倍率重新抓,而不是拿旧位图凑。
    await act(async () => {
      byText("1x")!.click();
    });
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(2));
    expect((rasterize.mock.calls[1]![0] as { frames: { bucket: number }[] }).frames[0]!.bucket).toBe(1);
  });

  it("saves a PNG under the design's own name", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupSave")!.click();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    expect(save).toHaveBeenCalledTimes(1);
    const [metadata, bytes] = save.mock.calls[0] as [{ fileName: string; extension: string }, Uint8Array];
    expect(metadata).toEqual({ fileName: "x", extension: "png" });
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(text()).toContain("mockupSaveDone");
  });

  it("saves a PDF when PDF is the chosen format", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupFormatPdf")!.click();
    });
    await act(async () => {
      byText("mockupSave")!.click();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    const [metadata, bytes] = save.mock.calls[0] as [{ extension: string }, Uint8Array];
    expect(metadata.extension).toBe("pdf");
    // 真的是一份 PDF,而不是把 PNG 换个扩展名。
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("treats a cancelled save as nothing to report", async () => {
    save.mockResolvedValue({ ok: false, reason: "cancelled" });
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupSave")!.click();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    // 取消不是错误:不该报红,也不该说成"保存失败"。
    expect(text()).not.toContain("mockupSaveFailed");
    expect(text()).not.toContain("mockupSaveDone");
  });

  it("copies the composed image to the clipboard", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupCopy")!.click();
    });
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(text()).toContain("mockupCopyDone"));
  });

  it("shows a failing frame instead of pretending it rendered", async () => {
    rasterize.mockResolvedValue([{ ok: false, key: "index@2", code: "capture-failed" }]);

    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });

    await vi.waitFor(() => expect(text()).toContain("mockupStatusFailed"));
    expect(byText("mockupSave")?.disabled).toBe(true);
  });
});
