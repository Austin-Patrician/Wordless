import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

import type { DesignManifestDto } from "@wordless/protocol";
import { MOCKUP_RAIL_FRAME_MIME } from "../src/renderer/features/design/mockup-attach.ts";
// 令牌表本身:`?raw` 读进来解析,于是"有哪些令牌"这件事只有一份真源。
import TOKENS_CSS from "../../../packages/ui-kit/src/styles/tokens.css?raw";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { layoutMockup } from "../src/renderer/features/design/mockup-layout.ts";
import { defaultMockupOptions } from "../src/renderer/features/design/mockup-options.ts";
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

  async function render(thumbnails: ReadonlyMap<string, string> = new Map()): Promise<void> {
    await act(async () => {
      root.render(
        <MockupExportDialog
          bridge={BRIDGE}
          designDir="designs/x.wdesign"
          designPath="/w/designs/x.wdesign"
          manifest={MANIFEST}
          onClose={() => {}}
          sessionId="s1"
          thumbnails={thumbnails}
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
  const stage = (): HTMLElement => document.body.querySelector("[data-mockup-stage]")!;
  const world = (): HTMLElement => document.body.querySelector("[data-mockup-world]")!;
  /** 世界层的平移量。**按数值读**,不按字符串比 —— 初值取决于适配结果,不是常量。 */
  const worldOffset = (): { x: number; y: number } => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(world().style.transform);
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
  };
  const zoomReadout = (): string => document.body.textContent?.match(/\d+%/)?.[0] ?? "";
  const worldSize = (): { height: number; width: number } => ({
    height: Number.parseFloat(world().style.height),
    width: Number.parseFloat(world().style.width),
  });
  const worldScale = (): number =>
    Number.parseFloat(/scale\(([\d.]+)\)/.exec(world().style.transform)?.[1] ?? "1");
  /**
   * 给预览台一个尺寸。
   *
   * 浏览器测试里**没有样式表**,预览台自己是零高度的(唯一的内容是世界层,而它是绝对定位的)。
   * 适应、居中这些都要有视口尺寸才谈得上,所以这里直接给一个,然后等适应落地。
   */
  const setStageSize = async (width: number, height: number): Promise<void> => {
    const before = world().style.transform;
    await act(async () => {
      stage().style.width = `${width}px`;
      stage().style.height = `${height}px`;
    });
    /**
     * 等的是**镜头因为新尺寸动过**,而不是"某个条件成立"。
     *
     * 一开始写的是 `waitFor(scale < 1)` —— 而那个条件在打开那一刻就已经成立(预览台在无样式
     * 表的环境里也有一个初始高度),于是它立刻返回,断言读到的是**换尺寸之前**的画面。这个
     * bug 只在整份文件一起跑时复现:单独跑那一条时序恰好反过来,它是绿的。
     */
    await vi.waitFor(() => expect(world().style.transform).not.toBe(before));
  };
  const byLabel = (label: string): HTMLButtonElement | undefined =>
    buttons().find((button) => (button.getAttribute("aria-label") ?? "") === label);
  const pointer = (type: string, init: PointerEventInit): void => {
    stage().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, ...init }));
  };
  /** 拖放:自己造一个 `DataTransfer`,与浏览器里那条路一致(包括自定义的 MIME)。 */
  const dropOnStage = async (frameId: string): Promise<void> => {
    const transfer = new DataTransfer();
    transfer.setData(MOCKUP_RAIL_FRAME_MIME, frameId);
    await act(async () => {
      stage().dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });
  };
  /** 从左侧画框加入两帧:默认每页 2 张,于是只有一页。 */
  const attachBoth = async (): Promise<void> => {
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await act(async () => {
      buttonContaining("我的")!.click();
    });
    await waitReady();
  };

  it("says what to do when nothing is attached yet", async () => {
    await render();

    expect(text()).toContain("mockupEmptyTitle");
    expect(canvases()).toHaveLength(0);
  });

  it("左栏的缩略图用的是画布已经光栅过的位图,而不是为了一列小图再抓一遍", async () => {
    /*
      左栏列的是**还没进渲染区**的那几帧 —— 也就是说,这一趟本来就**不会**去抓它们。所以
      缩略图只能来自画布手里那些位图,或者来自一次专门为缩略图做的离屏渲染。后者是每帧一个
      隐藏窗口渲染一遍的真实成本,而这个测试守的就是"没有发生那件事"。
    */
    const thumbnails = new Map([
      ["index", "blob:canvas-index"],
      ["mine", "blob:canvas-mine"],
    ]);
    await render(thumbnails);

    const sources = [...document.body.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toContain("blob:canvas-index");
    expect(sources).toContain("blob:canvas-mine");
    // 一块像素都没抓:进渲染区之前没有任何帧需要导出倍率的位图。
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("拿不到缩略图时出占位,而不是留一张猜的图", async () => {
    await render();

    expect(text()).toContain("mockupRailNoPreview");
    expect(document.body.querySelectorAll("img")).toHaveLength(0);
  });

  it("标题栏只有一个关闭按钮 —— ui-kit 自带的那个不再叠上来", async () => {
    /*
      两个 ✕ 叠在右上角看起来像渲染坏了,而它其实是两个真实存在的控件:弹窗自己的那个在标题
      行里,ui-kit 的 `DialogContent` 默认还会在右上角**绝对定位**再放一个(字面量
      "Close dialog")。

      所以数的是**弹窗里全部带关闭语义的按钮**,而不是我们自己那个 —— 只数自己的话,
      叠上去第二个时这个测试照样通过,那它就什么都没守住。
    */
    await render();

    const closers = [...document.body.querySelectorAll("button[aria-label]")].filter((button) =>
      /close|dialog/i.test(button.getAttribute("aria-label") ?? ""),
    );
    expect(closers).toHaveLength(1);
  });

  it("属性配置栏的底色用的是令牌表里真实存在的令牌", async () => {
    /*
      用户报的是"预览的内容颜色溢出到右侧属性栏",而根因不是配色:面板当时写的是
      `bg-popover/95`,而 Wordless 的令牌表里**没有** `--popover` —— Tailwind 于是生成一条
      无效声明,面板完全透明,底下那张默认 `#1C1C1E` 的预览图就透上来了。

      这个测试不去断言颜色值(算出来的值随主题变),而是断言**名字**:面板的底色令牌必须出现在
      `tokens.css` 的 `@theme` 里。令牌表是唯一的真源(`?raw` 读进来现场解析),所以这不是一份
      会过期的白名单 —— 加令牌不用改这里,而写一个不存在的令牌会立刻失败。
    */
    await render();

    const panel = document.body.querySelector("[data-mockup-overlay]")?.firstElementChild as HTMLElement | null;
    expect(panel).toBeTruthy();

    const defined = new Set([...TOKENS_CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
    expect(defined.size).toBeGreaterThan(10);

    const surface = panel!.className
      .split(/\s+/)
      .map((name) => name.replace(/^.*:/, ""))
      .find((name) => name.startsWith("bg-"));
    expect(surface).toBeDefined();

    // 名字里带 `[]` 的任意值是 CSS 字面量,不受令牌表约束。
    const token = surface!.slice(3).split("/")[0]!;
    if (!token.startsWith("[")) expect(defined).toContain(token);
  });

  it("一页一张画布 —— 逐帧各画一整页会让整批画框在预览里重复出现", async () => {
    /*
      用户看到的是"左右对称的两个重复画框"。根因不是多画了一帧,而是**一帧一张画布、每张都画
      整页**:两帧一页时画两遍整页,于是每一帧都出现两次。守的是画布数 = 页数。
    */
    await render();
    await attachBoth();

    expect(canvases()).toHaveLength(1);
    // 每一帧仍然各有一块可点、可拖的命中区(它们按**同一份版面**定位)。
    expect(stage().querySelectorAll("[data-mockup-shot]")).toHaveLength(2);
  });

  it("在预览里拖背景就能平移 —— 页面里的边距、水印那些地方也算背景", async () => {
    /*
      用户报的是"拖中间的背景框拖不动"。当时的判据是**整个页面区域**都不算背景,而页面里除了
      截图还有边距、水印和画框之间的空隙 —— 在那些地方拖不动就像拖拽坏了。判据收窄到画框本身。
    */
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();

    const page = stage().querySelector<HTMLElement>("[data-mockup-page]")!;
    const before = worldOffset();

    await act(async () => {
      page.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 200, pointerId: 9 }),
      );
    });
    await act(async () => {
      stage().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 230, clientY: 260, pointerId: 9 }));
    });

    expect(worldOffset()).toEqual({ x: before.x + 30, y: before.y + 60 });
  });

  it("落点在画框上时不拖背景 —— 那里是选中和换位", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();

    const shot = stage().querySelector<HTMLElement>("[data-mockup-shot]")!;
    const before = worldOffset();

    await act(async () => {
      shot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 200, pointerId: 11 }),
      );
    });
    await act(async () => {
      stage().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 260, clientY: 260, pointerId: 11 }));
    });

    expect(worldOffset()).toEqual(before);
  });

  it("弹窗会去载入品牌标 —— 水印左边那个方块不是空的", async () => {
    /*
      "左边那个标没显示出来"是一条很容易再犯的错:版面留着位置、绘制里却没有图,而**两处都不报错**。
      所以这里钉住弹窗确实去取了那张图(用应用自己的品牌资源),而它取不到时水印只画字。
    */
    const sources: string[] = [];
    const RealImage = globalThis.Image;
    class SpyImage extends RealImage {
      override set src(value: string) {
        sources.push(value);
        super.src = value;
      }
      override get src(): string {
        return super.src;
      }
    }
    vi.stubGlobal("Image", SpyImage);
    try {
      await render();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(sources).toHaveLength(1);
    // 资源小,构建会把它内联成 data URL —— 认内容,不认文件名。
    expect(sources[0]!.startsWith("data:image/svg+xml")).toBe(true);
    expect(sources[0]).toContain("monogramBg");
  });

  it("水印左边的标真的落在预览上,不是只取到了图", async () => {
    /*
      这一条走到底:载入 → 交给预览 → 在预览画布的对应位置**采样到那个颜色**。
      理由是这个 bug 的形状:版面留着位置、绘制里没有图,而**两处都不报错** —— 只断言"取到了
      资源"是拦不住它的。
    */
    const patch = document.createElement("canvas");
    patch.width = 8;
    patch.height = 8;
    const patchContext = patch.getContext("2d")!;
    patchContext.fillStyle = "#ff00ff";
    patchContext.fillRect(0, 0, 8, 8);
    const magenta = patch.toDataURL("image/png");

    const RealImage = globalThis.Image;
    class StubImage extends RealImage {
      // 不管是哪个资源一律换成一块洋红:断言于是不依赖品牌图自己的颜色。
      override set src(_value: string) {
        super.src = magenta;
      }
      override get src(): string {
        return magenta;
      }
    }
    vi.stubGlobal("Image", StubImage);
    try {
      await render();
      await act(async () => {
        buttonContaining("首页")!.click();
      });
      await waitReady();

      // 版面是纯函数,测试这边算出同一个方块的位置。
      const layout = layoutMockup(
        [{ cssHeight: 844, cssWidth: 390, frameId: "index", image: null, title: "首页" }],
        defaultMockupOptions(844),
        1,
      );
      const brand = layout.brand!;
      const canvas = canvases()[0]!;
      const read = (): number[] =>
        [
          ...canvas
            .getContext("2d")!
            .getImageData(Math.round(brand.x + brand.logo / 2), Math.round(brand.y + brand.logo / 2), 1, 1).data,
        ].slice(0, 3);

      await vi.waitFor(() => expect(read()).toEqual([255, 0, 255]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("拖一帧的时候不画系统拖影 —— 它不受窗口裁剪,会飘到 app 外面", async () => {
    /*
      用户看到的是"拖一帧时它的图片溢出了 app 的区域"。那是**操作系统画的拖影**,不是 DOM:
      它跟着光标走,不会被我们的窗口裁掉。

      去掉它不等于丢掉反馈:落点自己会说(预览台变成虚线框)。
    */
    await render();

    const transfer = new DataTransfer();
    const setDragImage = vi.fn();
    // 自己造的数据传输对象,所以可以盯着它有没有被要求换拖影。
    Object.defineProperty(transfer, "setDragImage", { value: setDragImage });
    await act(async () => {
      buttonContaining("首页")!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    });

    expect(setDragImage).toHaveBeenCalledTimes(1);
    // 拖影是一个 1×1 的透明元素 —— 也就是"什么都不画"。
    const ghost = setDragImage.mock.calls[0]?.[0] as HTMLElement;
    expect(ghost.style.opacity).toBe("0");
    expect(ghost.style.width).toBe("1px");
  });

  it("拖着一帧悬在预览台上时,预览台自己高亮成落点", async () => {
    await render();
    expect(document.body.querySelector("[data-mockup-drop-hint]")).toBeNull();

    const transfer = new DataTransfer();
    transfer.setData(MOCKUP_RAIL_FRAME_MIME, "index");
    await act(async () => {
      stage().dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });

    const hint = document.body.querySelector("[data-mockup-drop-hint]");
    expect(hint).not.toBeNull();
    // 提示自己不能成为落点,否则 `dragleave` 会在它和预览台之间来回触发,框一闪一闪。
    expect(hint!.className).toContain("pointer-events-none");
    expect(text()).toContain("mockupDropHint");

    // 别的窗口拖进来的东西不该点亮它。
    const foreign = new DataTransfer();
    foreign.setData("text/plain", "x");
    await act(async () => {
      stage().dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: foreign }));
    });
    // 已经在拖框状态里了 —— 松手之后应该收掉。
    await act(async () => {
      stage().dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });
    expect(document.body.querySelector("[data-mockup-drop-hint]")).toBeNull();
    expect(canvases()).toHaveLength(1);
  });

  it("从左侧画框列表直接拖进预览台就能加入它 —— 包括第一帧", async () => {
    await render();
    // 一帧都没进来时预览台**照样在**:它就是落点,不然第一帧只能点不能拖。
    expect(canvases()).toHaveLength(0);
    expect(text()).toContain("mockupEmptyTitle");

    await act(async () => {
      const transfer = new DataTransfer();
      buttonContaining("首页")!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
      // 携带的是自己的 MIME,不是 text/plain。
      expect(transfer.getData(MOCKUP_RAIL_FRAME_MIME)).toBe("index");
    });
    await dropOnStage("index");

    expect(canvases()).toHaveLength(1);
    expect(stage().querySelectorAll("[data-mockup-shot]")).toHaveLength(1);
    // 加进去了就不再留在左栏(列表是"已加入"的补集)。
    expect(buttonContaining("首页")).toBeUndefined();
    expect(text()).not.toContain("mockupEmptyTitle");
  });

  it("别的窗口拖进来的文字不会变成一个画框", async () => {
    await render();

    const transfer = new DataTransfer();
    transfer.setData("text/plain", "index");
    await act(async () => {
      stage().dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });

    expect(canvases()).toHaveLength(0);
  });

  it("打开就把整页适应进视口 —— 不放大、不越界、水平居中", async () => {
    /*
      "打开先适应一下":内容比视口高时要缩到装得下,而且要**跟着尺寸走** —— 弹窗刚打开时
      预览台的尺寸往往还要落定一次,只适应一次会停在错的比例上。
    */
    await render();
    await attachBoth();
    await setStageSize(800, 600);

    const content = worldSize();
    const zoom = worldScale();
    const offset = worldOffset();

    expect(zoom).toBeLessThan(1);
    // 整块内容落在视口里(上下都不越界,也没被顶到边上)。
    expect(offset.y).toBeGreaterThan(0);
    expect(offset.y + content.height * zoom).toBeLessThanOrEqual(600);
    // 水平居中 —— 适应不是"贴左上角"。
    expect(offset.x).toBeCloseTo((800 - content.width * zoom) / 2, 3);
  });

  it("点「适应」与打开时得到的是同一个画面,点「实际大小」不是", async () => {
    await render();
    await attachBoth();
    await setStageSize(800, 600);

    const atOpen = world().style.transform;
    await act(async () => {
      byLabel("mockupViewActual")!.click();
    });
    expect(world().style.transform).not.toBe(atOpen);
    expect(worldScale()).toBe(1);

    await act(async () => {
      byLabel("mockupViewFit")!.click();
    });
    expect(world().style.transform).toBe(atOpen);
  });

  it("缩放条浮在预览台里面,而不是在它下面占一行", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();

    const zoomIn = byLabel("mockupViewZoomIn");
    expect(zoomIn).toBeDefined();
    // 浮层:在预览台**内部**(所以不占高度),且被声明为不把指针事件漏给画布。
    expect(stage().contains(zoomIn!)).toBe(true);
    expect(zoomIn!.closest("[data-mockup-overlay]")).not.toBeNull();
    expect(zoomIn!.closest("[data-mockup-overlay]")!.parentElement).toBe(stage());
    // 左下角:预览的主体在中间,缩放在左边不挡它。
    const dockClasses = zoomIn!.closest("[data-mockup-overlay]")!.className;
    expect(dockClasses).toContain("bottom-3");
    expect(dockClasses).toContain("left-3");
    // 它连着同一个相机:点一下数字就要跟着动,而且落在固定档位上。
    await act(async () => {
      byLabel("mockupViewActual")!.click();
    });
    expect(zoomReadout()).toBe("100%");
    await act(async () => {
      zoomIn!.click();
    });
    expect(zoomReadout()).toBe("125%");
    await act(async () => {
      byLabel("mockupViewZoomOut")!.click();
    });
    expect(zoomReadout()).toBe("100%");
  });

  it("拖背景就是平移预览台", async () => {
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();

    const before = worldOffset();

    await act(async () => {
      pointer("pointerdown", { button: 0, clientX: 100, clientY: 100 });
    });
    await act(async () => {
      pointer("pointermove", { clientX: 130, clientY: 80 });
    });

    // 世界层的位移 = 指针的位移,一比一。
    expect(worldOffset()).toEqual({ x: before.x + 30, y: before.y - 20 });

    // 松开之后不再跟着走 —— 否则"拖完手一抬,图还在跑"。
    await act(async () => {
      pointer("pointerup", { clientX: 130, clientY: 80 });
    });
    await act(async () => {
      pointer("pointermove", { clientX: 400, clientY: 400 });
    });
    expect(worldOffset()).toEqual({ x: before.x + 30, y: before.y - 20 });
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

  it("交给桥的是 base64 字符串,而且能解回一张 PNG", async () => {
    /*
      这一条是这次"点保存就失败"的根:载荷要过 `contextBridge`,而**类型化数组在那儿不可靠**
      (`Uint8Array` 曾经是独立实参,于是主进程的守卫认不出它)。

      所以断言的是**过桥之后的形状**:字符串、能 base64 解码、解码出来是 PNG 的魔数。
    */
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupSave")!.click();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    const payload = save.mock.calls[0]![0] as { data: unknown; extension: string; fileName: string };
    expect(typeof payload.data).toBe("string");
    expect(payload.data).not.toContain("data:");
    // 解回字节:必须是 PNG 的魔数 —— 编码错了这里就露馅。
    const binary = atob(payload.data as string);
    const magic = [...binary.slice(0, 4)].map((character) => character.charCodeAt(0));
    expect(magic).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("保存失败时把原因说出来,而不是只写一句「保存失败」", async () => {
    // 一句光秃秃的"保存失败"既没法修也没法报 —— 这条就是用户报的那个现象。
    save.mockResolvedValue({ ok: false, reason: "failed", detail: "saving is unavailable" });
    await render();
    await act(async () => {
      buttonContaining("首页")!.click();
    });
    await waitReady();
    await act(async () => {
      byText("mockupSave")!.click();
    });

    await vi.waitFor(() => expect(text()).toContain("mockupSaveFailed"));
    expect(text()).toContain("saving is unavailable");
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
    const payload = save.mock.calls[0]![0] as { data: string; extension: string; fileName: string };
    expect({ extension: payload.extension, fileName: payload.fileName }).toEqual({ fileName: "x", extension: "png" });
    expect(payload.data.length).toBeGreaterThan(0);
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

    const payload = save.mock.calls[0]![0] as { data: string; extension: string };
    expect(payload.extension).toBe("pdf");
    // 真的是一份 PDF,而不是把 PNG 换个扩展名 —— 解回来第一个字节要是 `%PDF-`。
    expect(atob(payload.data).slice(0, 5)).toBe("%PDF-");
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
