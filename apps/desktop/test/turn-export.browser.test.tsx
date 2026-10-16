import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@wordless/ui-kit";

/**
 * 导出这一轮的回复。
 *
 * 锁的是四件"错了没有别处能发现"的事:
 *
 * 1. **预览与导出是同一份** —— 预览里的折叠状态决定导出物;「全部折叠/展开」是批量开关;
 * 2. **默认态全折叠** —— 长图先给人一个干净的正文,要更多再自己展开;
 * 3. **取消不是错误** —— 保存对话框被取消,界面上不该报红;
 * 4. **截图失败要说出来** —— 外链图没能嵌入是"图少了",不说出来用户会以为全都在。
 */

const { messages } = await import("../src/renderer/shared/i18n.ts");
const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    knowledge: { enabled: false, processingModel: null, autoProcessMinutes: 0, maxFilesPerRound: 0 },
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
  }),
}));

const saveExportFile = vi.fn(async () => ({ ok: true as const, path: "C:/out/x.png" }));
const copyExportImage = vi.fn(async () => true);
vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => ({ saveExportFile, copyExportImage }),
}));

import type { ConversationMessage } from "@wordless/domain";
import { TurnExportButton } from "../src/renderer/features/thread/TurnExportDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function message(id: string, blocks: ConversationMessage["blocks"]): ConversationMessage {
  return {
    id,
    role: "assistant",
    timestamp: 1_700_000_000_000,
    blocks,
    model: null,
  } as ConversationMessage;
}

function toolBlock(name: string, state: "complete" | "error" = "complete", input?: Record<string, unknown>): ConversationMessage["blocks"][number] {
  return { type: "tool", callId: `call-${name}`, name, state, ...(input ? { input } : {}) } as ConversationMessage["blocks"][number];
}

const turnMessages = [
  message("m1", [toolBlock("read", "complete", { path: "src/a.ts" }), toolBlock("grep", "complete", { pattern: "TODO" })]),
  message("m2", [{ type: "text", text: "回答正文。" } as ConversationMessage["blocks"][number]]),
];

describe("导出这一轮的回复", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    saveExportFile.mockClear();
    copyExportImage.mockClear();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderButton = async (props: Partial<Parameters<typeof TurnExportButton>[0]> = {}): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnExportButton
            messages={turnMessages}
            timestamp={1_700_000_000_000}
            {...props}
          />
        </TooltipProvider>,
      );
    });
  };

  const openDialog = async (): Promise<void> => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="导出本轮回复"]')!.click();
    });
  };

  it("默认预览:正文在,工具组收着(全折叠)", async () => {
    await renderButton();
    await openDialog();
    const preview = document.querySelector('[data-turn-export-preview]')!;
    expect(preview.textContent).toContain("回答正文。");
    expect(preview.textContent).toContain("已处理 · 读取 2");
    // 折叠的组不摆工具清单 —— 展开才有。
    expect(document.querySelector('[data-turn-export-tools]')).toBeNull();
  });

  it("全部展开 → 工具清单用**页面上的工具行**渲染;再点一次收起", async () => {
    await renderButton();
    await openDialog();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="toggle-groups"]')!.click();
    });
    const tools = document.querySelector<HTMLElement>('[data-turn-export-tools]');
    expect(tools).not.toBeNull();
    // 逐行都是线程里那个行组件(而不是导出自己画的一套) —— 样式一致是**构造上**的。
    expect(tools!.querySelectorAll("[data-tool-activity-row]")).toHaveLength(2);
    expect(tools!.textContent).toContain("read");
    expect(tools!.textContent).toContain("src/a.ts");
    expect(tools!.textContent).toContain("TODO");
    // 同一个按钮再点一次 = 收起(不是两颗按钮各管一个方向)。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="toggle-groups"]')!.click();
    });
    expect(document.querySelector('[data-turn-export-tools]')).toBeNull();
  });

  it("只有被按的那颗按钮在转:保存时不显示「正在生成…」在复制上", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderButton({
      capture: async () => {
        await pending;
        return { bytes: new Uint8Array([1, 2, 3]), blockedImages: 0 };
      },
    });
    await openDialog();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="save"]')!.click();
    });
    const save = document.querySelector<HTMLElement>('[data-turn-export-action="save"]')!;
    const copy = document.querySelector<HTMLElement>('[data-turn-export-action="copy"]')!;
    // 保存那颗:标签换成"正在生成…"。
    expect(save.getAttribute("aria-label")).toBe(zh("threadExportSaving"));
    // 复制那颗:标签还是它自己的说法,只是被禁用(防并发抓图,不是"它也在跑")。
    expect(copy.getAttribute("aria-label")).toBe(zh("threadExportCopyImage"));
    expect(copy.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      release?.();
      await pending;
    });
  });

  it("保存长图:走保存对话框,base64 载荷与建议文件名都来自数据侧", async () => {
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10]);
    await renderButton({ capture: async () => ({ bytes: fakePng, blockedImages: 1 }) });
    await openDialog();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="save"]')!.click();
    });
    expect(saveExportFile).toHaveBeenCalledTimes(1);
    const input = saveExportFile.mock.calls[0][0] as { extension: string; data: string; fileName: string };
    expect(input.extension).toBe("png");
    expect(input.fileName.startsWith("wordless-")).toBe(true);
    expect(input.fileName.endsWith(".png")).toBe(true);
    // 截图报告了 1 张外链图没能嵌入 —— 必须说出来,不能静默。
    expect(document.querySelector('[role="status"]')!.textContent).toContain("1 张外链图片未能嵌入");
  });

  it("保存被取消不是错误:没有报红,也没有成功提示", async () => {
    saveExportFile.mockImplementation(async () => ({ ok: false as const, reason: "cancelled" as const }));
    await renderButton({ capture: async () => ({ bytes: new Uint8Array(4), blockedImages: 0 }) });
    await openDialog();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="save"]')!.click();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("所有动作都在 header 的工具条里,没有左右分栏", async () => {
    await renderButton({ capture: async () => ({ bytes: new Uint8Array(4), blockedImages: 0 }) });
    await openDialog();
    const header = document.querySelector("header")!;
    for (const action of ["format-image", "format-markdown", "toggle-groups", "save", "copy", "close"]) {
      expect(header.querySelector(`[data-turn-export-action="${action}"]`)).not.toBeNull();
    }
    // 关闭按钮也在同一行 —— 绝对定位那颗与这一行各算各的对齐,垂直方向永远差几像素。
    expect(document.querySelector('[aria-label="Close dialog"]')).toBeNull();
    // 分栏没了 —— 那一栏的宽度是从预览区借的,弹层越窄纸越窄。
    expect(document.querySelector("aside")).toBeNull();
  });

  it("预览不出现横向滚动:纸宽跟着预览区走,而不是写死", async () => {
    /*
     * 用户报过的问题:弹层里左侧出现横向滚动条。成因是纸宽写死 820px,而预览区
     * (弹层上限 64rem 减掉右侧选项栏)永远比它窄。
     *
     * 这个 harness 里 Tailwind 工具类是惰性的(见 design-layout-probe 的注释),所以这里
     * 守住的是**内联写死宽度**这一类回归:`max-width` 一旦被换成固定 `width`,纸就会比
     * 预览区宽,下面两条断言立刻失败。夹具里特意放了宽表格、长代码块与长到不可断的 token。
     */
    const hostile = [
      message("m1", [
        {
          type: "text",
          text: [
            "| a | b | c | d | e | f | g | h | i | j | k | l |",
            "| - | - | - | - | - | - | - | - | - | - | - | - |",
            "| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |",
            "",
            "```ts",
            "const aVeryLongLineThatWouldScrollForever = " + "x".repeat(400) + ";",
            "```",
            "",
            "`PreprocessState`/`LandscapeFacts`/`EvidencePack`/`CategoryVerification`/`AlternateSource`",
          ].join("\n"),
        } as ConversationMessage["blocks"][number],
      ]),
    ];
    await renderButton({ messages: hostile });
    await openDialog();
    const pane = document.querySelector<HTMLElement>('[data-turn-export-pane]')!;
    const page = document.querySelector<HTMLElement>('[data-turn-export-preview]')!;
    expect(page.getBoundingClientRect().width).toBeLessThanOrEqual(pane.clientWidth + 1);
    expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
  });
  it("图标不共用字形:入口 / 两种格式 / 保存 各自不同", async () => {
    /*
     * "两个不同的意思不该共用一个字形" —— 这是仓库里既有的规矩(见 renderer-registry.tsx 里
     * "two different meanings should not share a glyph")。这条断言很便宜,守的是复制粘贴时
     * 忘了换图标(那时两个按钮会长得一模一样)。
     */
    await renderButton({ capture: async () => ({ bytes: new Uint8Array(4), blockedImages: 0 }) });
    await openDialog();
    const glyph = (selector: string): string => {
      const svg = document.querySelector(`${selector} svg`)!;
      return svg.getAttribute("class")!.match(/lucide-[a-z0-9-]+/)![0];
    };
    const entry = glyph('[aria-label="导出本轮回复"]');
    const image = glyph('[data-turn-export-action="format-image"]');
    const markdown = glyph('[data-turn-export-action="format-markdown"]');
    const save = glyph('[data-turn-export-action="save"]');
    expect(entry).not.toBe(save);
    expect(image).not.toBe(markdown);
    // 两种格式是一对"图 / 文件":同一个动作形状,不同的物件。
    expect(image.endsWith("-image-down")).toBe(true);
    expect(markdown.endsWith("-file-down")).toBe(true);
  });

  it("长图卡片头带品牌标与加粗的名字;Markdown 预览没有卡片头", async () => {
    await renderButton({ capture: async () => ({ bytes: new Uint8Array(4), blockedImages: 0 }) });
    await openDialog();
    const preview = document.querySelector<HTMLElement>('[data-turn-export-preview]')!;
    const brand = preview.querySelector<HTMLImageElement>("[data-turn-export-brand]");
    expect(brand).not.toBeNull();
    // 图**真的加载出来了**:src 写错时元素也在,只有等 load 完才知道能不能画出来。
    await act(async () => {
      await brand!.decode?.().catch(() => undefined);
    });
    expect(brand!.complete && brand!.naturalWidth > 0).toBe(true);
    const name = [...preview.querySelectorAll("span")].find((node) => node.textContent === "Wordless")!;
    expect(name.className).toContain("font-bold");
    // 卡片头(品牌标 + 名字 + 时间)是长图专属的。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="format-markdown"]')!.click();
    });
    const source = document.querySelector<HTMLElement>('[data-turn-export-source]')!;
    expect(source.querySelector("[data-turn-export-brand]")).toBeNull();
    expect(source.textContent).not.toContain("Wordless");
  });

  it("Markdown:预览是渲染后的 md(与长图同构),控件是图标按钮", async () => {
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await renderButton({ capture: async () => ({ bytes: new Uint8Array(4), blockedImages: 0 }) });
    await openDialog();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="format-markdown"]')!.click();
    });
    // 工具条上的按钮一律 icon-only:没有文字,说法在 aria-label 里(键盘与读屏唯一的说明)。
    for (const action of ["format-image", "format-markdown", "include-tools", "save", "copy"]) {
      const button = document.querySelector<HTMLElement>(`[data-turn-export-action="${action}"]`)!;
      expect(button.textContent?.trim()).toBe("");
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
    const source = document.querySelector<HTMLElement>('[data-turn-export-source]')!;
    expect(source.textContent).toContain("回答正文。");
    expect(source.textContent).toContain("已处理 · 读取 2");
    // 原始 HTML 不进导出物:我们自己的渲染器默认不渲染它,预览里只会是字面文本。
    expect(source.textContent).not.toContain("<details>");
    // 卡片头(时间戳那排)是长图专属的。
    expect(source.textContent).not.toContain("Wordless");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="copy"]')!.click();
    });
    const md = clipboard.mock.calls[0][0] as string;
    expect(md).toContain("回答正文。");
    expect(md).toContain("🛠 **已处理 · 读取 2**");
    expect(md).not.toContain("<details>");
    // Markdown 模式下的保存落的是 .md —— 同一个按钮,两个格式,扩展名要跟着走。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="save"]')!.click();
    });
    const saved = saveExportFile.mock.calls.at(-1)![0] as { extension: string };
    expect(saved.extension).toBe("md");
    // 关掉「包含工具调用」:预览与剪贴板里的工具组一起消失。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="include-tools"]')!.click();
    });
    expect(
      document.querySelector<HTMLElement>('[data-turn-export-action="include-tools"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(document.querySelector('[data-turn-export-source]')!.textContent).not.toContain("已处理");
    // 切回长图,渲染后的预览(带卡片头与可折叠的工具组行)回来。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-turn-export-action="format-image"]')!.click();
    });
    expect(document.querySelector('[data-turn-export-source]')).toBeNull();
    expect(document.querySelector('[data-turn-export-preview]')!.textContent).toContain("Wordless");
    expect(document.querySelector('[data-turn-export-preview]')!.textContent).toContain("回答正文。");
  });
});
