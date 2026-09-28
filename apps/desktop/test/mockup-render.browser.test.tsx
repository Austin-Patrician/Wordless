import { describe, expect, it } from "vitest";
import { layoutMockup } from "../src/renderer/features/design/mockup-layout.ts";
import {
  mockupCanvasToJpegDataUrl,
  renderMockupToCanvas,
  stitchMockupPages,
} from "../src/renderer/features/design/mockup-render.ts";
import type { MockupOptions, MockupShot } from "../src/renderer/features/design/mockup-types.ts";

/**
 * 合成渲染必须跑在**真 Chromium**里 —— 采像素这件事 jsdom 做不到。
 *
 * 这里验的是"1:1 还原"里最容易被破坏的那几条**视觉规则**:外壳画在截图外面不遮界面、
 * 圆角是真的圆、空位是灰块、透明底真的透明、拼页时窄页居中。
 */

const PHONE = { cssWidth: 390, cssHeight: 844 };

/** 一张纯色的"截图",用它当位图来源。 */
function solidShot(id: string, color: string): MockupShot {
  const canvas = document.createElement("canvas");
  canvas.width = 39;
  canvas.height = 84;
  const g = canvas.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  return { frameId: id, title: id, ...PHONE, image: canvas };
}

function baseOptions(overrides: Partial<MockupOptions> = {}): MockupOptions {
  return {
    radius: 0,
    borderWidth: 20,
    borderColor: "#ff0000",
    background: "#0000ff",
    transparent: false,
    shadow: false,
    brand: false,
    scale: 1,
    perPage: 3,
    ...overrides,
  };
}

function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const g = canvas.getContext("2d")!;
  return [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
}

describe("mockup renderer", () => {
  it("draws the shell outside the screenshot, so no interface pixel is covered", () => {
    const options = baseOptions();
    const shots = [solidShot("a", "#00ff00")];
    const canvas = renderMockupToCanvas(shots, options);
    const rect = layoutMockup(shots, options).rects[0]!;

    // 截图里面是它自己的颜色。
    expect(pixel(canvas, rect.x + 10, rect.y + 100)).toEqual([0, 255, 0, 255]);
    // 边框在截图**外面**一圈。
    expect(pixel(canvas, rect.x - options.borderWidth / 2, rect.y + 100)).toEqual([255, 0, 0, 255]);
    expect(pixel(canvas, rect.x + rect.width + options.borderWidth / 2, rect.y + 100)).toEqual([
      255, 0, 0, 255,
    ]);
    // 而**左边那一列像素**（最容易被子像素偏移吃掉的一列）仍然是界面自己的颜色。
    expect(pixel(canvas, rect.x + 1, rect.y + 100)).toEqual([0, 255, 0, 255]);
    // 外面剩下的是背景色。
    expect(pixel(canvas, 4, 4)).toEqual([0, 0, 255, 255]);
  });

  it("actually rounds the corners instead of just clipping the paint", () => {
    const options = baseOptions({ radius: 60, borderWidth: 0, background: "#0000ff" });
    const shots = [solidShot("a", "#00ff00")];
    const canvas = renderMockupToCanvas(shots, options);
    const rect = layoutMockup(shots, options).rects[0]!;

    // 正中央是界面。
    expect(pixel(canvas, rect.x + rect.width / 2, rect.y + rect.height / 2)).toEqual([0, 255, 0, 255]);
    // 角落被切掉了 —— 露出的是背景,而不是界面像素。
    expect(pixel(canvas, rect.x + 2, rect.y + 2)).toEqual([0, 0, 255, 255]);
  });

  it("keeps the slot grey when a capture has not arrived, so nothing reflows later", () => {
    const options = baseOptions();
    const shots: MockupShot[] = [{ frameId: "a", title: "a", ...PHONE, image: null }];
    const canvas = renderMockupToCanvas(shots, options);
    const rect = layoutMockup(shots, options).rects[0]!;

    expect(pixel(canvas, rect.x + rect.width / 2, rect.y + rect.height / 2)).toEqual([138, 138, 143, 255]);
    // 而格子照样占着:整张图的尺寸与有位图时一模一样。
    const withImage = renderMockupToCanvas([solidShot("a", "#00ff00")], options);
    expect([canvas.width, canvas.height]).toEqual([withImage.width, withImage.height]);
  });

  it("honours the scale when sizing the canvas", () => {
    const shots = [solidShot("a", "#00ff00")];
    const one = renderMockupToCanvas(shots, baseOptions({ scale: 1 }));
    const two = renderMockupToCanvas(shots, baseOptions({ scale: 2 }));

    expect([two.width, two.height]).toEqual([one.width * 2, one.height * 2]);
    // 而且是真的更大,不是把 1 倍图放大（放大不会让边框变粗一倍）。
    const options = baseOptions({ borderWidth: 20 });
    const rect = layoutMockup(shots, options).rects[0]!;
    const twoRect = { x: rect.x * 2, y: rect.y * 2, width: rect.width * 2 };
    expect(pixel(two, twoRect.x + 20, twoRect.y + 200)).toEqual([0, 255, 0, 255]);
    expect(pixel(two, twoRect.x - 20, twoRect.y + 200)).toEqual([255, 0, 0, 255]);
  });

  it("leaves the background truly transparent when asked", () => {
    const options = baseOptions({ transparent: true });
    const canvas = renderMockupToCanvas([solidShot("a", "#00ff00")], options);

    expect(pixel(canvas, 4, 4)[3]).toBe(0);
  });

  it("centres narrower pages when stitching a long image", () => {
    const wide = renderMockupToCanvas([solidShot("a", "#00ff00")], baseOptions({ background: "#0000ff" }));
    const narrow = renderMockupToCanvas(
      [solidShot("a", "#00ff00")],
      baseOptions({ background: "#000000", borderWidth: 0 }),
    );

    const stitched = stitchMockupPages([wide, narrow], { background: "#0000ff", transparent: false });

    expect(stitched.width).toBe(wide.width);
    expect(stitched.height).toBe(wide.height + narrow.height);
    // 窄页两侧的空档补的是背景色。
    expect(pixel(stitched, 2, wide.height + narrow.height / 2)).toEqual([0, 0, 255, 255]);
    // 而它被摆在中间,不是靠左。
    const left = Math.round((wide.width - narrow.width) / 2);
    expect(pixel(stitched, left + narrow.width / 2, wide.height + narrow.height / 2)).toEqual([0, 255, 0, 255]);
  });

  it("flattens onto white before JPEG, because Chromium encodes transparency as black", () => {
    const canvas = renderMockupToCanvas([solidShot("a", "#00ff00")], baseOptions({ transparent: true }));
    const dataUrl = mockupCanvasToJpegDataUrl(canvas);

    expect(dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);

    // 解回来采一个角落:透明处必须是**白**,不是黑。
    const image = new Image();
    image.src = dataUrl;
    return new Promise<void>((resolve, reject) => {
      image.onload = () => {
        const probe = document.createElement("canvas");
        probe.width = image.width;
        probe.height = image.height;
        const g = probe.getContext("2d")!;
        g.drawImage(image, 0, 0);
        const corner = [...g.getImageData(3, 3, 1, 1).data];
        try {
          expect(corner[0]).toBeGreaterThan(240);
          expect(corner[1]).toBeGreaterThan(240);
          expect(corner[2]).toBeGreaterThan(240);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error("JPEG 解不开"));
    });
  });
});
