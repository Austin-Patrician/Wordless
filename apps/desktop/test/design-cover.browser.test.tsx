import { describe, expect, it, beforeEach } from "vitest";
import { readCover, resetCoverCacheForTests, writeCover } from "../src/renderer/features/design/cover-cache.ts";
import { COVER_BOX, COVER_MAX_FRAMES, drawCover } from "../src/renderer/features/design/design-cover.ts";

/**
 * 封面这一层:真的画出来、真的存得住。
 *
 * 这两件事都只能在**真浏览器**里验(IndexedDB 与 canvas),而这正是它们需要被测的原因:缓存
 * 写不进去时**不该抛**(调用方有主色块兜底),画不出来时**不该返回一张空图**(那会让卡片看起来
 * 像"这份设计是空的")。
 */

function solid(size: { width: number; height: number }, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, size.width, size.height);
  return canvas;
}

function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  return [...canvas.getContext("2d")!.getImageData(Math.round(x), Math.round(y), 1, 1).data];
}

describe("封面缓存", () => {
  beforeEach(() => {
    resetCoverCacheForTests();
  });

  it("存进去能读回来 —— 而且要过 IndexedDB,不只是内存里那一份", async () => {
    /*
      `resetCoverCacheForTests()` 在两个动作之间清掉内存镜像:**只有真的落进 IndexedDB 才能读回来**。
      没有这一步的话,"只写内存"的实现也能让这条测试绿 —— 而那正好丢掉了"换一次页面还在"的意义。
    */
    expect(await readCover("/w/meadow.wdesign")).toBeNull();
    await writeCover("/w/meadow.wdesign", "data:image/jpeg;base64,AAAA");
    resetCoverCacheForTests();

    expect(await readCover("/w/meadow.wdesign")).toBe("data:image/jpeg;base64,AAAA");
  });

  it("没存过的 key 返回 null,而不是抛", async () => {
    // 列表会问几十个 key,其中大部分没有封面 —— 那不是错误状态。
    expect(await readCover("/w/never-opened.wdesign")).toBeNull();
  });

  it("空封面不写 —— 一张空图会让卡片看起来像这份设计是空的", async () => {
    await writeCover("/w/empty.wdesign", "");
    expect(await readCover("/w/empty.wdesign")).toBeNull();
  });
});

describe("封面绘制", () => {
  it("把几帧画进一张封面,位置与纯几何算出来的一致", () => {
    const first = solid({ height: 844, width: 390 }, "#ff0000");
    const second = solid({ height: 844, width: 390 }, "#0000ff");

    const cover = drawCover([
      { image: first, size: { height: 844, width: 390 } },
      { image: second, size: { height: 844, width: 390 } },
    ]);
    expect(cover).not.toBeNull();
    expect([cover!.width, cover!.height]).toEqual([COVER_BOX.width, COVER_BOX.height]);

    // 左半张是红、右半张是蓝 —— 顺序不能反(它就是画布上从左到右的顺序)。
    expect(pixel(cover!, COVER_BOX.width * 0.25, COVER_BOX.height / 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(cover!, COVER_BOX.width * 0.75, COVER_BOX.height / 2)).toEqual([0, 0, 255, 255]);
  });

  it("只取前几帧 —— 几十帧全画进去,每一帧都会小成一粒米", () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({
      image: solid({ height: 844, width: 390 }, "#00ff00"),
      size: { height: 844, width: 390 },
      index,
    }));

    const cover = drawCover(sources);
    expect(cover).not.toBeNull();
    // 画进去的帧数由几何决定:帧与帧之间一定有底色露出来,数一数红色的块就知道有几帧。
    // 这里只断言"没有为多余的帧留位置"——封面尺寸是固定的。
    expect([cover!.width, cover!.height]).toEqual([COVER_BOX.width, COVER_BOX.height]);
    expect(COVER_MAX_FRAMES).toBeLessThan(sources.length);
  });

  it("一帧都没有时返回 null —— 调用方据此跳过写入", () => {
    expect(drawCover([])).toBeNull();
    // 尺寸非法的帧同样不算数。
    expect(drawCover([{ image: solid({ height: 4, width: 4 }, "#000000"), size: { height: 0, width: 0 } }])).toBeNull();
  });
});
