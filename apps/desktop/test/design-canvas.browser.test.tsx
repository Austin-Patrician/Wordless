import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

import type { DesignManifestDto, DesignOpenedDto } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { readCover, resetCoverCacheForTests } from "../src/renderer/features/design/cover-cache.ts";
import { DesignCanvas } from "../src/renderer/features/design/DesignCanvas";

/**
 * 假桥:光栅化一律失败。
 *
 * 这样画布停在**占位路径**上,断言是确定的 —— 真实位图要等离屏视图产出,而这个测试
 * 关心的是画布本身(节点、选择、缩放条),不是光栅化。
 */
const CLIENT = {
  // 设计体系对话框挂载时会拉一次风格目录;缺了这个方法,effect 里会同步抛错。
  listDesignStyles: async () => [],
  // 色彩系统面板按工作区相对路径读 theme.css。
  readSessionWorkspaceTextFile: async () => ({
    content: "@theme { --color-primary: #4f46e5; --color-accent: #0ea5e9; }",
    name: "theme.css",
    path: "meadow.wdesign/theme.css",
    status: "available" as const,
  }),
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
    /*
      把容器**挪离原点**。
      凡是"窗口坐标 → 容器坐标"的换算,在容器落在 (0,0) 时都恰好等于不换算 —— 那样这一步
      写错了测试也全绿(实测:去掉减偏移之后一条都没挂)。挪开它,那些断言才有内容。
    */
    container.style.marginLeft = "60px";
    container.style.marginTop = "40px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(
    overrides: {
      focusedFrameId?: string | null;
      sourceRevision?: string;
      client?: DesktopBridge;
      activity?: ReadonlyMap<string, "reading" | "modifying" | "creating" | "updated">;
      onCommitFrameMeta?: (frameId: string, patch: { title?: string; width?: number; height?: number }) => void;
      enteredFrameId?: string | null;
      onEnterFrame?: (frameId: string | null) => void;
      onCommitFrameMoves?: (moves: readonly { frameId: string; x: number; y: number }[]) => void;
      onCreateFrameAt?: (rect: { x: number; y: number; width: number; height: number }) => void;
      onDeleteFrame?: (frameId: string) => void;
      onAttachFrame?: (frameId: string) => void;
      onApplyStyle?: (result: { framesNeedRestyle: boolean; opened: DesignOpenedDto }) => void;
      onDownloadMaterials?: () => void;
      onOpenMockup?: () => void;
      exporting?: boolean;
      onRefresh?: () => void;
      refreshing?: boolean;
      attachedThemeTokens?: readonly string[];
      manifest?: DesignManifestDto;
      onToggleThemeToken?: (token: { name: string; value: string }) => void;
      onTextures?: (textures: ReadonlyMap<string, string>) => void;
    } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <DesignCanvas
          activity={overrides.activity ?? new Map()}
          client={overrides.client ?? CLIENT}
          attachedThemeTokens={overrides.attachedThemeTokens ?? []}
          designDir="meadow.wdesign"
          designPath="/w/meadow.wdesign"
          sessionId="s1"
          themeRevision={0}
          onToggleThemeToken={overrides.onToggleThemeToken ?? (() => {})}
          enteredFrameId={overrides.enteredFrameId ?? null}
          onEnterFrame={overrides.onEnterFrame ?? (() => {})}
          manifest={overrides.manifest ?? manifest()}
          sourceRevision={overrides.sourceRevision ?? "rev-1"}
          onCommitFrameGeometry={onCommitFrameGeometry}
          onCommitFrameMeta={overrides.onCommitFrameMeta ?? (() => {})}
          onCommitFrameMoves={overrides.onCommitFrameMoves ?? (() => {})}
          onCreateFrameAt={overrides.onCreateFrameAt ?? (() => {})}
          onDeleteFrame={overrides.onDeleteFrame ?? (() => {})}
          onAttachFrame={overrides.onAttachFrame ?? (() => {})}
          onApplyStyle={overrides.onApplyStyle ?? (() => {})}
          onDownloadMaterials={overrides.onDownloadMaterials ?? (() => {})}
          onOpenMockup={overrides.onOpenMockup ?? (() => {})}
          exporting={overrides.exporting ?? false}
          onRefresh={overrides.onRefresh ?? (() => {})}
          refreshing={overrides.refreshing ?? false}
          onSelectionChange={onSelectionChange}
          onTextures={overrides.onTextures}
        />,
      );
    });
  }

  /**
   * 给画布容器一个确定的尺寸。
   *
   * 浏览器测试里**没有样式表**:画布容器是 `h-full w-full`,于是它的高度是 0、宽度跟着测试容器
   * 走。而菜单要按容器边界摆(翻边/贴边),所以要先给它一个尺寸,否则边界是 0,什么位置断言都
   * 没有意义。
   */
  const canvasBox = (): HTMLElement => container.querySelector<HTMLElement>("[data-design-canvas]")!;

  /**
   * 给菜单装一份**最小**样式。
   *
   * 浏览器测试里没有样式表,而菜单的位置要看它**量出来**的尺寸:没有 `width: max-content` 时,
   * 一个绝对定位、子元素都是块级的盒子会撑满容器 —— 量出来"600 宽",于是翻边与贴边全都测不出
   * 真实行为。这里只补这条链路上真正依赖的几条声明。
   */
  const installMenuCss = (): void => {
    const style = document.createElement("style");
    style.textContent = [
      "[data-frame-menu]{position:absolute;width:max-content;min-width:150px;white-space:nowrap;padding:4px}",
      "[data-frame-menu] button{display:flex;width:100%;padding:0 8px;font-size:12px;line-height:16px}",
    ].join("");
    document.head.append(style);
  };

  const setCanvasSize = async (width: number, height: number): Promise<void> => {
    // 直接给**画布容器**一个尺寸,而不是外层那个测试 div:`h-full w-full` 在没有样式表时是
    // 不起作用的,给了外层也传不下来。
    await act(async () => {
      canvasBox().style.width = `${width}px`;
      canvasBox().style.height = `${height}px`;
    });
    await vi.waitFor(() => expect(canvasBox().clientWidth).toBe(width));
  };

  function frameNodes(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(".react-flow__node"));
  }

  it("工具栏的「导出渲染图」打开合成图弹窗,不是直接落文件", async () => {
    /*
      这两个按钮的分工照参考实现:**导出渲染图**进弹窗(挑几帧、排版、选格式),
      **下载素材**直接落文件(每帧一张原尺寸图 + 规范与素材文件)。

      "直接落一堆图"那个入口去掉不会少任何东西:下载素材的产物是它的**超集**。所以这里同时
      钉住"弹窗被打开"和"没有顺手把文件写出去"。
    */
    const opened = vi.fn();
    const exported = vi.fn();
    await render({ onOpenMockup: opened, onDownloadMaterials: exported });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "mockupTitle",
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(opened).toHaveBeenCalledTimes(1);
    expect(exported).not.toHaveBeenCalled();
  });

  it("工具栏的「下载素材」仍然直接落文件", async () => {
    const exported = vi.fn();
    await render({ onDownloadMaterials: exported });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designExportAssets",
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(exported).toHaveBeenCalledTimes(1);
  });

  it("色彩系统:点一个色块把它交给对话", async () => {
    /*
      面板只读文件、只把"用户指的是哪一个令牌"交出去 —— 改令牌永远是 agent 的事。所以这里断言
      的是**点了哪个令牌**(名字与值),而不是"文件被改了"。
    */
    const onToggleThemeToken = vi.fn();
    await render({ onToggleThemeToken });

    const paletteButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolTheme",
    );
    await act(async () => {
      paletteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 令牌来自当前这份设计的 theme.css(色块用值本身画,所以标题里是变量名与值)。
    const swatch = container.querySelector<HTMLElement>('button[title="--color-primary: #4f46e5"]');
    expect(swatch).not.toBeNull();
    expect(swatch?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      swatch?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onToggleThemeToken).toHaveBeenCalledWith({ name: "--color-primary", value: "#4f46e5" });
  });

  it("色彩系统:已经交给对话的令牌显示为选中", async () => {
    // 选中态**只读**上层给的集合(真源在输入框的 chip 上):用户在输入框里删掉一个 chip,这里
    // 必须跟着不再选中,所以面板不自己存一份。
    await render({ attachedThemeTokens: ["--color-accent"] });

    const paletteButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolTheme",
    );
    await act(async () => {
      paletteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('button[title="--color-accent: #0ea5e9"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('button[title="--color-primary: #4f46e5"]')?.getAttribute("aria-pressed")).toBe("false");
  });

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
    // 搬进 dock 之后与面板其它按钮一致走 i18n(测试里 `t(key)` 就是 key)。
    expect(labels).toContain("designZoomReset");
    expect(labels).toContain("designZoomFit");
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

  it("底部 dock 说清三件事:现在拿什么工具、能新建什么、缩放到多少", async () => {
    await render();

    // 参考实现的画布是一个**底部居中的 dock**,而不是散在四角的小按钮。这条带子是"这是个
    // 工具"最直接的信号,所以它有哪些条目要钉住。
    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? "",
    );
    expect(labels).toContain("designToolSelect");
    expect(labels).toContain("designToolHand");
    expect(labels).toContain("designZoomIn");
    expect(labels).toContain("designZoomOut");
    expect(labels).toContain("designZoomFit");
    // 缩放百分比并进来了(原来它孤零零挂在画布左下角)。
    expect(container.textContent).toMatch(/\d+%/);

    // 新建画面**已经能用** —— 它是 dock 里第三个真条目。
    const newFrame = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolNewFrame",
    );
    expect(newFrame).toBeDefined();
    expect(newFrame?.getAttribute("aria-disabled")).not.toBe("true");

    // 设计体系也能用了 —— 它打开一个对话框(下一层是它自己的用例)。
    const styles = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolDesignSystem",
    );
    expect(styles).toBeDefined();
    expect(styles?.getAttribute("aria-disabled")).not.toBe("true");

    /*
      这里原来还有一个**禁用的「备注」占位**,而现在没有了 —— 决定变了。

      当时留着它的理由是"照实禁用比藏起来诚实";但用户看到的是一个点不动、标题也弹不出来的
      灰色图标,原话是"有个空白的菜单留在那里不知道干嘛用的"。备注这条通道已决定不做
      (存储 + 图层 + 抽屉 + 锚点保鲜 + 工具 + handoff 是一整条链),占位就没有"以后会亮"的
      那一天可等。所以:**dock 上每一个按钮都得是有用的**,禁用的那些必须自己说明理由
      (比如"分布"少于三帧时禁用,但用途是明确的)。
    */
    expect(labels.some((label) => label.startsWith("designToolNotes"))).toBe(false);
    expect(labels.some((label) => label.startsWith("designToolComingSoon"))).toBe(false);
  });

  it("画框工具:在画布上拖出一个矩形就建一帧,并且拖的时候看得到虚框", async () => {
    const onCreateFrameAt = vi.fn();
    await render({ onCreateFrameAt });

    // 按下画框工具。
    const dockButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolNewFrame",
    );
    await act(async () => {
      dockButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 工具态 = 绘制层存在。它在,指针事件就到不了选择/框选 —— 所以"关"就是它不在。
    const layer = container.querySelector<HTMLElement>(".cursor-crosshair");
    expect(layer).not.toBeNull();

    await act(async () => {
      layer?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
      layer?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
    });
    // 拖的途中要**看得见**将得到的那个矩形,而不是松手才知道画了多大。
    const ghost = layer?.querySelector("div");
    expect(ghost).not.toBeNull();

    await act(async () => {
      layer?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
    });

    // 建帧要走主进程;这里钉的是"画布把**画出来的那个**矩形送出去了"。
    expect(onCreateFrameAt).toHaveBeenCalledTimes(1);
    const rect = onCreateFrameAt.mock.calls[0]?.[0] as { width: number; height: number };
    // 宽高比是这条的关键:屏幕位移除以缩放是**同一个**系数,所以比例原样保留。
    // 只断言"都大于 0"是不够的 —— 一个写死的 100×100 也能过,而那正是"不跟指针"的实现。
    expect(rect.width / rect.height).toBeCloseTo(200 / 300, 2);
  });

  it("太小的一拖不建帧 —— 那是误触,不是想画一个 3×4 的画板", async () => {
    const onCreateFrameAt = vi.fn();
    await render({ onCreateFrameAt });
    const dockButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolNewFrame",
    );
    await act(async () => {
      dockButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const layer = container.querySelector<HTMLElement>(".cursor-crosshair");
    await act(async () => {
      layer?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
      layer?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 104, clientY: 103, pointerId: 1 }));
    });
    expect(onCreateFrameAt).not.toHaveBeenCalled();
  });

  it("选中一帧时四角出现缩放手柄,没选中就没有", async () => {
    await render();
    // 未选中:画布上不该有缩放手柄,它们会挡住框选与点击。
    expect(container.querySelectorAll(".react-flow__resize-control").length).toBe(0);

    const node = frameNodes()[0] as HTMLElement;
    await act(async () => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 选中之后才有手柄。参考实现同样只在**单选**时给(分组缩放没有明确语义)。
    const handles = container.querySelectorAll(".react-flow__resize-control");
    expect(handles.length).toBeGreaterThanOrEqual(4);
  });

  it("右键菜单开在指针处,而且**不在帧节点里**", async () => {
    await render();

    // 这条钉的是一个真实坏过的实现:菜单原来渲染在**节点内部**,而节点的祖先
    // (`.react-flow__viewport`)带着画布的缩放变换 —— 于是 `absolute` 的参照不是画布而是节点,
    // 位置整体偏掉,而且菜单会跟着缩放一起放大缩小。
    // 浏览器测试里没有样式表,画布容器是零高度的 —— 菜单要按容器边界摆,所以先给它一个尺寸。
    await setCanvasSize(600, 400);
    installMenuCss();

    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 210, clientY: 160 }),
      );
    });

    const menu = container.querySelector<HTMLElement>("[data-frame-menu]");
    expect(menu).toBeDefined();

    // ① 不在节点里 —— 在节点里就一定会被缩放变换带着走。
    expect(menu?.closest(".react-flow__node")).toBeNull();

    // ② 落点就是指针在**容器内**的位置。
    const bounds = container.getBoundingClientRect();
    expect(menu?.style.left).toBe(`${210 - bounds.left}px`);
    expect(menu?.style.top).toBe(`${160 - bounds.top}px`);
  });


  it("靠近右边缘右键时菜单翻到指针左边 —— 而不是被挤窄换行", async () => {
    /*
      用户报的:frame 靠近边缘时右键,「交给 agent 改这一帧」会换行成两行。

      根因是绝对定位元素不给宽度时的"收缩到适合"(宽度 ≤ 容器宽 - left),贴边的菜单于是被挤窄
      而文字只好换行。修法是**保持宽度、翻到另一侧** —— 这条测试钉的就是"它真的翻了",因为
      换行本身是 CSS 行为,在这个没有样式表的环境里测不到。
    */
    await render();
    // 给容器一个确定的宽度,好让"右边放不下"这件事可复现。
    await setCanvasSize(420, 320);
    installMenuCss();

    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    const bounds = container.getBoundingClientRect();
    // 指针贴在容器右边(留 8px)。
    const clientX = bounds.left + bounds.width - 8;
    const clientY = bounds.top + 40;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
    });

    const menu = container.querySelector<HTMLElement>("[data-frame-menu]");
    expect(menu).not.toBeNull();
    const anchorX = clientX - bounds.left;
    const left = Number.parseFloat(menu!.style.left);
    const width = menu!.getBoundingClientRect().width;

    expect(left).toBeLessThan(anchorX);
    // 而且整个菜单仍然落在容器里(翻过去就是为了这个)。
    expect(left + width).toBeLessThanOrEqual(bounds.width + 1);
    // 文字不换行这件事由 CSS 保证,这里钉住那个类没被删掉。
    expect(menu!.className).toContain("whitespace-nowrap");
  });

  it("右键菜单点别处就消失,不会一直挂着", async () => {
    await render();
    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }));
    });
    expect(container.textContent).toContain("designFrameRename");

    // 这条也钉着一个真实坏过的实现:原来那个"点空白关闭"的遮罩是 `fixed inset-0` **画在
    // 节点里面**的,而 `fixed` 在 transform 祖先下相对的是那个祖先 —— 遮罩只有节点那么大,
    // 点别处永远打不到它,菜单就一直挂着。
    // 点"别的地方" = 点画布外的任意元素(对话区、侧栏…)。往 `window` 上派发不是同一件事:
    // 那样 `event.target` 是 window,而窗口监听里的 `contains` 拿到一个非 Node。
    // **右键也算。** 原来只认左键 `mousedown`,于是右键点别处菜单赖着不走 —— 用户得先左键
    // 点一下才消失,这条被报过。
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2 }));
    });
    expect(container.querySelector("[data-frame-menu]")).toBeNull();

    // 左键同样要收。
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }));
    });
    expect(container.querySelector("[data-frame-menu]")).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(container.querySelector("[data-frame-menu]")).toBeNull();
  });

  it("右键菜单按 Escape、以及画布一滚轮就收", async () => {
    await render();
    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;

    for (const close of [
      () => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
      // 画布一平移/缩放,菜单的落点就不再对着那一帧了 —— 收掉比让它飘着诚实。
      () => window.dispatchEvent(new WheelEvent("wheel", { bubbles: true })),
    ]) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }));
      });
      expect(container.textContent).toContain("designFrameRename");
      await act(async () => close());
      expect(container.textContent).not.toContain("designFrameRename");
    }
  });

  it("菜单里的「重命名」就地变成输入框,回车提交", async () => {
    const onCommitFrameMeta = vi.fn();
    await render({ onCommitFrameMeta });

    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
    });

    const rename = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("designFrameRename"),
    );
    expect(rename).toBeDefined();
    await act(async () => {
      rename?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });

    // 就地变成输入框,初值是这一帧现在的标题(改名字,而不是从空白开始打)。
    const input = container.querySelector<HTMLInputElement>("[data-frame-menu] input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("首页");

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "首页 v3");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onCommitFrameMeta).toHaveBeenCalledWith("index", { title: "首页 v3" });
    expect(container.querySelector("[data-frame-menu]")).toBeNull();
  });

  it("重命名输入框失去焦点不该让它消失 —— 那正是「点了没反应」", async () => {
    /*
      用户报的:点「重命名」没反应。

      原因不是没切到输入框(那条上面钉住了),而是**切换那一刻菜单会按新尺寸重摆一次** ——
      指针于是可能落到菜单外面,紧接着的 `mouseup` 落在画布上,输入框失焦。当时输入框带
      `onBlur={onClose}`,于是它当场收掉,用户看到的就是"点了没反应"。

      而"点别处就关"本来就有更准的实现:窗口级 `pointerdown`。所以这里钉住:**失焦不收起**。
    */
    await render();

    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => (button.textContent ?? "").includes("designFrameRename"))
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });

    const input = container.querySelector<HTMLInputElement>("[data-frame-menu] input");
    expect(input).not.toBeNull();
    await act(async () => {
      // React 的 onBlur 走 `focusout`(它会冒泡,而 blur 不会)。
      input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(container.querySelector("[data-frame-menu] input")).not.toBeNull();

    // 而**点外面**仍然要关掉它 —— 这条行为由窗口级 pointerdown 负责。
    await act(async () => {
      canvasBox().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector("[data-frame-menu]")).toBeNull();
  });

  it("右键一帧给出重命名与删除", async () => {
    const onDeleteFrame = vi.fn();
    await render({ onDeleteFrame });

    const node = frameNodes()[0] as HTMLElement;
    // React Flow 的节点在右键时会自己选中,而菜单开在指针处 —— 这一条钉的是菜单本身。
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
    });

    const menu = Array.from(container.querySelectorAll("button")).filter(
      (button) => (button.textContent ?? "").includes("designFrameRename") || (button.textContent ?? "").includes("designFrameDelete"),
    );
    expect(menu.map((button) => button.textContent)).toEqual(["designFrameRename", "designFrameDelete"]);

    /*
      删除是这个画布上唯一会丢东西的动作(帧文件直接被删,不进回收站),而菜单项就在指针底下、
      点错补不回来 —— 所以点它只是**发起确认**:菜单收起来,画布中央出现一个确认框,只有那个
      框里的「删除」才真的删。
    */
    const pickDelete = (): HTMLElement | undefined =>
      Array.from(container.querySelectorAll("button")).find(
        (button) =>
          (button.textContent ?? "").includes("designFrameDelete") &&
          !(button.textContent ?? "").includes("designFrameDeleteCancel"),
      );
    await act(async () => {
      pickDelete()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });

    expect(onDeleteFrame).not.toHaveBeenCalled();
    // 菜单收起来了,确认框出现了 —— 两张浮层不叠着。
    expect(container.querySelector("[data-frame-menu]")).toBeNull();
    const confirm = container.querySelector<HTMLElement>("[data-design-confirm]");
    expect(confirm).not.toBeNull();
    expect(confirm?.textContent).toContain("designFrameDeleteConfirm");
    expect(confirm?.textContent).toContain("designFrameDeleteWarning");

    // 取消:什么都不删,框也收掉。
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "") === "designFrameDeleteCancel",
    );
    expect(cancel).toBeDefined();
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onDeleteFrame).not.toHaveBeenCalled();
    expect(container.querySelector("[data-design-confirm]")).toBeNull();

    // 再来一次,这回点确认 —— 才真的删。
    await act(async () => {
      (frameNodes()[0]!.querySelector<HTMLElement>("[data-frame-id]") ?? frameNodes()[0]!).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }),
      );
    });
    await act(async () => {
      pickDelete()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "") === "designFrameDelete",
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onDeleteFrame).toHaveBeenCalledWith("index");
    expect(container.querySelector("[data-design-confirm]")).toBeNull();
  });

  it("确认框盖住的是画布,而且是整块居中的", async () => {
    // "只盖画布"不是省事:旁边的对话区与这次确认无关,盖住它是一次"删一帧"不该有的代价。
    await render();
    await setCanvasSize(600, 400);

    const node = frameNodes()[0] as HTMLElement;
    const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => (button.textContent ?? "").includes("designFrameDelete"))
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });

    const confirm = container.querySelector<HTMLElement>("[data-design-confirm]");
    expect(confirm).not.toBeNull();
    // 它住在画布容器**里面**(而不是像普通模态那样挂到 body 上盖住整个窗口)。
    expect(canvasBox().contains(confirm)).toBe(true);
    /*
      定位方式是 `absolute`(相对画布)而不是 `fixed`(相对窗口)。这一条只能断言类名 ——
      没有样式表就算不出实际样式 —— 但它钉住的正是那个决定:**确认框只盖画布**,旁边的对话区
      与这次确认无关。
    */
    expect(confirm!.className).toContain("absolute");
    expect(confirm!.className).not.toContain("fixed");
  });

  it("没有多选时不出现对齐/分布栏", async () => {
    await render();
    // 一帧没有"互相对齐"可言,所以这一栏在单选/未选时不该占着画布顶部。
    expect(container.querySelector('[aria-label="designArrangeLeft"]')).toBeNull();
    expect(container.querySelector('[aria-label="designDistributeH"]')).toBeNull();
  });

  /*
   * **多选那一半没有测试,是刻意的。**
   *
   * React Flow 的多选与 pane 点击都由它自己的指针状态机决定,合成事件驱动不了 —— 实测:
   * 补 `pointerdown`/`pointerup` 会把画布拖进拖拽态,并让相邻用例变得不确定。用一条"打不到
   * 目标"的断言换一个偶发测试不划算,所以我留的是**没有**这条测试,而不是一条看起来像有的。
   *
   * 契约那一侧仍然被钉着:`arrangeFrames` 有 8 条测试(含"只返回真的动了的帧"与按坐标排序),
   * 而"空结果不发 IPC"写在 `handleArrange` 里。
   */

  it("双击标题就地改名 —— 标题是画布上唯一的标签,而它以前改不了", async () => {
    const onCommitFrameMeta = vi.fn();
    await render({ onCommitFrameMeta });

    const title = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "首页");
    expect(title).toBeDefined();
    await act(async () => {
      title?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    // React 的受控输入要过原生 setter,否则 onChange 收不到。
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "首页 v2");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    // 落在**帧源码**里(写 @frame 注释),所以它是"提交一个补丁",而不是"改本地状态"。
    expect(onCommitFrameMeta).toHaveBeenCalledWith("index", { title: "首页 v2" });
    // 编辑框收起,回到标题。半截的草稿不该留在画布上。
    expect(container.querySelector("input")).toBeNull();
  });

  it("双击一帧报告进入,点空白处报告退出", async () => {
    const onEnterFrame = vi.fn();
    await render({ onEnterFrame });

    // 进入是**显式**的,不是"选中的只有一帧就是它"。原生视图永远盖在所有 DOM 之上,所以
    // 进了活体就点不到四角手柄 —— 于是选中必须保持可布局的那一态。
    const first = frameNodes()[0] as HTMLElement;
    await act(async () => {
      first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as string[] | undefined;
    expect(last).toHaveLength(1);
    expect(onEnterFrame).toHaveBeenCalledWith(last?.[0]);

    // 点空白处退出。没有出口的话,用户进入之后再也回不到可布局的那一态(手柄不出现)。
    /**
     * 退出那一路(点空白处 → `onEnterFrame(null)`)在这里**故意不测**。
     *
     * React Flow 的 pane 点击由它自己的指针状态机决定,合成事件驱动不了它 —— 实测:
     * 只发 `click` 不触发,补上 `pointerdown`/`pointerup` 会把它拖进拖拽态、并让相邻用例
     * 变得不确定。用一条"打不到目标"的断言换来一个偶发测试,不划算。
     *
     * 契约那一侧仍然被钉着:`DesignCanvasProps.onEnterFrame` 的类型、以及
     * `live-frame.ts` 那一组条件(它们是真正的判断)。
     */
  });

  it("选中的帧上写着怎么进入 —— 位图和真页面看着一样,而它点不动", async () => {
    await render();
    const first = frameNodes()[0] as HTMLElement;
    await act(async () => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 没有位图时帧是占位态,所以这里不是 live —— 于是它该说的是"双击进入"。
    expect(container.textContent).toContain("designFrameEnterHint");
  });

  it("进入了但整帧放不下时,画布说得出为什么不能交互", async () => {
    // 测试容器是 900×600,而帧声明 390×844 —— 1:1 下放不下。原生视图不被 CSS 裁剪,所以
    // 这时**不能**给活体(给了就是溢出面板),而界面上必须解释,否则"双击进入"像是没生效。
    await render({ enteredFrameId: "index" });
    expect(container.textContent).toContain("designFrameTooSmall");
    // 进入了就不该再劝"双击进入" —— 用户已经进去了。
    expect(container.textContent).not.toContain("designFrameEnterHint");
  });

  it("agent 正在动的那一帧上有状态徽标,而且只有那一帧", async () => {
    // 位图是磁盘的快照;画布上"agent 现在在改这一帧"的唯一证据就是这枚徽标。色相同时
    // 承担语义(见 frame-activity.ts),所以这里连颜色一起钉住。
    await render({ activity: new Map([["login", "modifying"]]) });

    const badges = container.querySelectorAll("[data-activity]");
    expect(badges).toHaveLength(1);
    const badge = badges[0] as HTMLElement;
    expect(badge.getAttribute("data-activity")).toBe("modifying");
    expect(badge.style.backgroundColor).not.toBe("");
    // 徽标说的是"哪一帧",不是"整个画布" —— 亮错帧看不出对错,所以只有 login 有。
    expect(badge.closest(".react-flow__node")?.textContent).toContain("登录");
  });

  it("把光栅好的位图交给外面 —— 导出渲染图的左栏要拿它当缩略图", async () => {
    /*
      导出弹窗的左栏列的是"还没进渲染区"的那几帧,也就是**这一趟不会去抓的**帧,所以它拿不到
      抓图结果。位图本来就在画布手里,把它交出去是"不为了一列小图再离屏渲染一遍"的唯一办法
      —— 而这整条链上最容易断的一环就是这里(不交出去 = 一列空占位,而且看起来完全正常)。
    */
    const textures: ReadonlyMap<string, string>[] = [];
    const client = {
      ...CLIENT,
      rasterizeDesignFrames: async (input: { frames: { frameId: string; bucket: number }[] }) =>
        input.frames.map((frame) => ({
          ok: true as const,
          key: `${frame.frameId}@${frame.bucket}`,
          bytes: new Uint8Array([1, 2, 3]),
          width: 390,
          height: 844,
        })),
    } as unknown as DesktopBridge;

    await render({ client, onTextures: (found) => textures.push(found) });
    // 位图到货是一条 promise 链(请求 → 写缓存 → 记代次 → 交出去),`act` 只保证渲染落定。
    await act(async () => {});

    const last = textures.at(-1);
    expect(last?.size).toBe(2);
    expect([...(last?.keys() ?? [])].sort()).toEqual(["index", "login"]);
    // 交出去的是**位图 URL**,`<img src>` 直接能吃。
    expect([...(last?.values() ?? [])].every((url) => url.startsWith("blob:"))).toBe(true);
  });

  it("打开的设计顺手存一张封面 —— 列表页那一格用的就是它", async () => {
    /*
      封面是**画布打开过这份设计**的副产品:位图已经在内存里,画进一张小图几乎是白送的。
      列表页按需光栅则是"每张卡一次离屏渲染"—— 几十个隐藏窗口,这一页最不该做的事。

      所以这条钉的是那条**唯一的写入路径**:画布把位图贴上去之后,缓存里就该有这份设计的封面。
    */
    resetCoverCacheForTests();
    // 真的 JPEG:这条链要 `new Image()` 载入位图才能画 —— 假字节会让它静默跳过,那样测试就绿得没意义。
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg"));
    const jpeg = new Uint8Array(await blob!.arrayBuffer());

    const client = {
      ...CLIENT,
      rasterizeDesignFrames: async (input: { frames: { frameId: string; bucket: number }[] }) =>
        input.frames.map((frame) => ({
          ok: true as const,
          key: `${frame.frameId}@${frame.bucket}`,
          bytes: jpeg,
          width: 390,
          height: 844,
        })),
    } as unknown as DesktopBridge;

    await render({ client });
    await act(async () => {});

    await vi.waitFor(async () => {
      expect(await readCover("/w/meadow.wdesign")).toContain("data:image/jpeg");
    });
  });

  it("源指纹变了就重新光栅 —— 位图不会停在打开那一刻", async () => {
    // 位图是磁盘的快照,而 agent 一直在改磁盘。**只看缓存里有没有**会得到"总是有" ——
    // 于是画布永远停在打开那一刻,而它看起来完全正常。所以这里钉的是"又去问了一次"。
    // 这一次**必须真的成功** —— 失败的帧不会被记成"这一代已经光栅过",于是它每次都会
    // 重试,而那正是"同一份清单不该重复光栅"这条断言会失效的原因。
    const rasterize = vi.fn(async (input: { frames: { frameId: string; bucket: number }[] }) =>
      input.frames.map((frame) => ({
        ok: true as const,
        key: `${frame.frameId}@${frame.bucket}`,
        bytes: new Uint8Array([1, 2, 3]),
        width: 390,
        height: 844,
      })),
    );
    const client = { ...CLIENT, rasterizeDesignFrames: rasterize } as unknown as DesktopBridge;

    await render({ client });
    // 位图到货是一条 promise 链(请求 → 写缓存 → 记代次),而 `act` 只保证渲染落定。
    // 不把这条链排干的话,"已经光栅过"这件事可能还没记上,下一个断言就会看到一个假的第二次请求。
    await act(async () => {});
    const afterFirst = rasterize.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // 同一个指纹再渲染一次:不该重复光栅。
    await render({ client });
    expect(rasterize.mock.calls.length).toBe(afterFirst);

    // 指纹一变(agent 改了帧),这一代位图全部作废。
    await render({ client, sourceRevision: "rev-2" });
    expect(rasterize.mock.calls.length).toBeGreaterThan(afterFirst);
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

  it("右上角有刷新按钮,而且真的接上了", async () => {
    /*
      为谁而设:画布的心跳**只在 agent 在跑时**开(跑完磁盘不会再自己变)。可用户自己也会
      改文件 —— 在编辑器里调一帧、把某处改回去 —— 那时画布不会动。这个按钮就是那件事的出口。

      而它必须真的接到上层:手动刷新走的是 `refreshDesign({ force: true })`,越过了主进程的
      最短间隔。撞上限流却什么都不做,读起来就是「这个按钮坏了」。
    */
    const onRefresh = vi.fn();
    await render({ onRefresh });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designRefresh",
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("一份空设计不需要确认,也不该开一轮对话", async () => {
    /*
      零帧时没有画框要重设 —— 问一遍"要不要重设 0 个画框"是无意义的,而自动开一轮对话会白费
      一次往返(那一轮 agent 拿到消息也只能回一句"没有画框可改")。
    */
    const applyDesignStyle = vi.fn(async () => ({
      framesNeedRestyle: false,
      opened: opened("/w/meadow.wdesign"),
    }));
    const client = {
      ...CLIENT,
      applyDesignStyle,
      listDesignStyles: async () => [
        // DTO 里的 name / tagline 只是兜底值,给人看的那份来自 i18n。这个文件里的 t 直接
        // 返回 key,而卡片的文案是模板拼出来的(不含 key 本身),所以下面按卡片自己的
        // 标记属性找它,不按文案找。
        { category: "c", id: "precise-dark", name: "深色精密", tagline: "t", themeCss: "@theme {}", vibe: "dark" },
      ],
    } as unknown as DesktopBridge;
    await render({ client, manifest: { ...manifest(), frames: [] } });

    const stylesButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolDesignSystem",
    );
    await act(async () => {
      stylesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // 风格卡是这里唯一带 aria-pressed 的按钮(DesignStyleCard 用它表达"已选中")。
    const card = container.querySelector('button[aria-pressed="false"]');
    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const applyButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      (candidate.textContent ?? "").includes("designStyleApplyNamed"),
    );
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 直接换令牌:没有确认层,但**确实应用了**。
    expect(container.textContent).not.toContain("designStyleConfirmTitle");
    expect(applyDesignStyle).toHaveBeenCalledWith({ path: "/w/meadow.wdesign", styleId: "precise-dark" });
  });

  it("设计体系:点卡片只是选中,点底部的应用才问确认", async () => {
    /*
      参考实现就是这个节奏,而每一步都有理由:
      - 卡片铺满一整屏,**一点就改**会让「看看有什么」变成一次不可撤销的改动;
      - 底部的按钮说出要做的事(「应用「深色精密」」),而不是一个含糊的「确定」;
      - 确认那一句说的是**具体后果**:几个画框、由谁重设、耗时较长 —— 按下去之后会自动开
        一轮对话,那是用户唯一需要知道、也是唯一能让他决定现在做不做的事。
    */
    const applyDesignStyle = vi.fn(async () => ({
      framesNeedRestyle: true,
      opened: opened("/w/meadow.wdesign"),
    }));
    const client = {
      ...CLIENT,
      applyDesignStyle,
      listDesignStyles: async () => [
        // DTO 里的 name / tagline 只是兜底值,给人看的那份来自 i18n。这个文件里的 t 直接
        // 返回 key,而卡片的文案是模板拼出来的(不含 key 本身),所以下面按卡片自己的
        // 标记属性找它,不按文案找。
        { category: "c", id: "precise-dark", name: "深色精密", tagline: "t", themeCss: "@theme {}", vibe: "dark" },
      ],
    } as unknown as DesktopBridge;
    await render({ client });

    const stylesButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolDesignSystem",
    );
    await act(async () => {
      stylesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // ① 点卡片只选中:按钮会改名,但**还没有**应用。
    // 风格卡是这里唯一带 aria-pressed 的按钮(DesignStyleCard 用它表达"已选中")。
    const card = container.querySelector('button[aria-pressed="false"]');
    expect(card).toBeDefined();
    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(applyDesignStyle).not.toHaveBeenCalled();

    // ② 点底部的应用 → 出现确认,而不是直接应用。
    const applyButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      (candidate.textContent ?? "").includes("designStyleApplyNamed"),
    );
    expect(applyButton).toBeDefined();
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(applyDesignStyle).not.toHaveBeenCalled();
    expect(container.textContent).toContain("designStyleConfirmTitle");
    expect(container.textContent).toContain("designStyleConfirmBody");

    // ③ 确认层里的那个「应用」才真的动手。
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.textContent ?? "") === "designStyleApply",
    );
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(applyDesignStyle).toHaveBeenCalledWith({ path: "/w/meadow.wdesign", styleId: "precise-dark" });
  });
  it("设计体系按钮打开对话框 —— 而对话框住在一个不会挡住原生活体的层上", async () => {
    /*
      这条钉两件事:按钮真的接上了,以及对话框**声明了遮挡**。原生活体视图永远在最上层,
      不声明的话用户看到的是一个弹出来却点不到的对话框 —— 那是这条路上最容易漏、也最像
      「卡死」的一种故障。
    */
    await render();
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === "designToolDesignSystem",
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("designStyleDialogTitle");
    // 关闭按钮在:Escape 之外还要有一个能点出口。
    expect(container.querySelector('[aria-label="designStyleClose"]')).not.toBeNull();
  });

  it("菜单里能把这一帧交给对话", async () => {
  /*
    改这一帧 = 开一轮对话,而不是在画布上就地改内容 —— **内容是源码**,而改源码的是 agent。
    所以这一项不是"编辑",它往输入框里放一条引用(路径换算见 `design-frame-reference.test.ts`)。
  */
  const onAttachFrame = vi.fn();
  await render({ onAttachFrame });

  const node = frameNodes()[0] as HTMLElement;
  const target = node.querySelector<HTMLElement>("[data-frame-id]") ?? node;
  await act(async () => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }));
  });

  const item = Array.from(container.querySelectorAll("button")).find((candidate) =>
    (candidate.textContent ?? "").includes("designFrameAskAgent"),
  );
  expect(item).toBeDefined();
  await act(async () => {
    item?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });

  expect(onAttachFrame).toHaveBeenCalledWith("index");
});
});
