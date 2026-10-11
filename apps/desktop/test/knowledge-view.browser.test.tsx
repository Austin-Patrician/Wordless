import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 知识库视图。
 *
 * 三条**产品决定**钉在这里(不是布局细节):
 *   1. 「立即整理」**开一个会话**,而不是在视图里自己跑加工 —— 它必须是 `knowledge` 工作类型;
 *   2. 导入把 `File[]` 交给桥,并且**说明是复制还是移动**(移动是破坏性的,不能悄悄替用户选);
 *   3. **坏页要显示出来** —— frontmatter 坏掉的页进不了目录,界面再不说,它的源文件会永远
 *      显示"未加工",而用户找不到原因。
 */

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  root: "/Users/someone/Documents/Wordless Knowledge/知识库",
  rawFiles: [
    { path: "合同/2024.pdf", processed: true, bytes: 100 },
    { path: "新资料.docx", processed: false, bytes: 2_000_000 },
  ],
  pages: [
    { path: "sources/2024合同.md", kind: "Source", title: "2024 合同", description: "采购框架。", tags: ["合同"], orphaned: false, verified: false, reviewStale: false },
    { path: "concepts/发票流程.md", kind: "Concept", title: "发票流程", description: "开票到抵扣。", tags: ["税务"], orphaned: false, verified: true, reviewStale: true },
  ],
  damaged: [],
  ...overrides,
});

const getKnowledgeSnapshot = vi.fn(async () => snapshot() as never);
const importKnowledgeFiles = vi.fn(async () => ({ imported: 2, skipped: [] }));
const revealKnowledgeRoot = vi.fn(async () => undefined);
const subscribeKnowledgeChanged = vi.fn(() => () => undefined);
const createAndPrompt = vi.fn(async () => ({ id: "session-1" }));
/** 宿主的整理结果。默认"起了会话"。 */
let organizeResult: { sessionId?: string; skipped?: string } = { sessionId: "session-1" };
const organizeKnowledge = vi.fn(async () => organizeResult);
let processingListener: ((processing: boolean) => void) | undefined;
const setKnowledgeVerification = vi.fn(async () => undefined);
const setKnowledge = vi.fn(async () => undefined) as ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } };
const getKnowledgeUsage = vi.fn(async () => ({ rounds: 3, totalTokens: 123_456, totalCost: 1.23, totalRounds: 3 }));
const importKnowledgeBundle = vi.fn(async () => null as unknown);
const getKnowledgeLibraries = vi.fn(async () => ({ active: "知识库", names: ["知识库"] }));
const mutateKnowledgeLibrary = vi.fn(async () => ({}));
const restoreKnowledgePage = vi.fn(async () => undefined);
const deleteKnowledgePage = vi.fn(async () => undefined);
const clearKnowledgePages = vi.fn(async () => ({ pages: 3, withoutRaw: 1, verified: 0 }));
const readKnowledgePage = vi.fn(async (path: string) => ({ path, body: "# 正文标题\n\n这一页写了这些。" }));
const deleteSession = vi.fn(async () => undefined);
const subscribeKnowledgeProcessing = vi.fn((listener: (processing: boolean) => void) => {
  processingListener = listener;
  return () => undefined;
});

let sessions: Array<{ id: string; title: string; workbenchId: string; updatedAt: number }> = [];
const client = { getKnowledgeSnapshot, importKnowledgeFiles, revealKnowledgeRoot, subscribeKnowledgeChanged, organizeKnowledge, setKnowledgeVerification, getKnowledgeUsage, importKnowledgeBundle, getKnowledgeLibraries, mutateKnowledgeLibrary, subscribeKnowledgeProcessing, readKnowledgePage, restoreKnowledgePage, deleteKnowledgePage, clearKnowledgePages, deleteSession };

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: { sessions } }),
  useRuntimeClient: () => client,
}));

const { messages } = await import("../src/renderer/shared/i18n.ts");
type LibrarySettings = {
  processingModel: { connectionId: string; modelId: string } | null;
  autoProcessMinutes: number;
  maxFilesPerRound: number;
};
type Prefs = { enabled: boolean; activeKnowledgeBase: string | null; libraries: Record<string, LibrarySettings> };

const librarySettings = (patch: Partial<LibrarySettings> = {}): LibrarySettings => ({
  processingModel: null,
  autoProcessMinutes: 0,
  maxFilesPerRound: 0,
  ...patch,
});
const prefs = (patch: Partial<Prefs> = {}): Prefs => ({ enabled: true, activeKnowledgeBase: "知识库", libraries: {}, ...patch });

let knowledge: Prefs = prefs();

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    knowledge,
    // 改偏好要真的改到那个对象上 —— 视图读的就是它(开启知识库那条路要立刻看到内容)。
    setKnowledge: async (next: typeof knowledge) => {
      knowledge = next;
      setKnowledge.mock.calls.push([next]);
    },
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
  }),
}));

const { KnowledgeView } = await import("../src/renderer/features/knowledge/KnowledgeView.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  getKnowledgeSnapshot.mockClear();
  importKnowledgeFiles.mockClear();
  organizeKnowledge.mockClear();
  knowledge = prefs();
  sessions = [];
  getKnowledgeSnapshot.mockImplementation(async () => snapshot() as never);
  importKnowledgeFiles.mockImplementation(async () => ({ imported: 2, skipped: [] }));
  organizeResult = { sessionId: "session-1" };
  organizeKnowledge.mockImplementation(async () => organizeResult);
  // 库列表也要复位:漏掉它,上一个用例设过的库名会漏到下一个用例里。
  getKnowledgeLibraries.mockImplementation(async () => ({ active: "知识库", names: ["知识库"] }));
  setKnowledge.mockClear();
  readKnowledgePage.mockClear();
  restoreKnowledgePage.mockClear();
  deleteKnowledgePage.mockClear();
  clearKnowledgePages.mockClear();
  deleteSession.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

async function render(options: { onOpenSettings?: () => void } = {}): Promise<{
  opened: string[];
  /** 再渲染一次。真实应用里偏好改了会广播、视图跟着重渲染;测试里用这个代替那次广播。 */
  rerender: () => Promise<void>;
}> {
  const opened: string[] = [];
  const root = createRoot(document.querySelector("#root")!);
  roots.push(root);
  const paint = async () => {
    await act(async () => {
      root.render(
        <KnowledgeView
          onOpenSession={(sessionId) => opened.push(sessionId)}
          {...(options.onOpenSettings === undefined ? {} : { onOpenSettings: options.onOpenSettings })}
        />,
      );
    });
  };
  await paint();
  return { opened, rerender: paint };
}


/**
 * 打开「导入」弹层。
 *
 * 三种导入方式现在收在一颗按钮的弹层里(以前是三颗并排的按钮),所以任何碰到导入的测试
 * 都得先把它打开。
 */
async function openImportMenu(): Promise<void> {
  await act(async () => {
    byText("导入")!.click();
  });
}

const byText = (text: string): HTMLElement | null =>
  [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(text)) ?? null;

describe("知识库视图", () => {
  it("把待加工与已加工分开显示", async () => {
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("新资料.docx");
    expect(text).toContain("待整理");
    expect(text).toContain("合同/2024.pdf");
    expect(text).toContain("已整理");
    expect(text).toContain("2 个文件,1 个待整理");
  });

  it("页面按类型分组,标题与描述都看得见", async () => {
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("来源");
    expect(text).toContain("概念");
    expect(text).toContain("2024 合同");
    expect(text).toContain("采购框架。");
  });

  it("「立即整理」把整轮交给宿主,而且**不跳转** —— 整理是后台批处理,不是一次对话", async () => {
    const { opened } = await render();
    const button = byText("立即整理");
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    // **一次调用**:算待办、起会话、收尾全在宿主 —— 手动与定时走同一条路,
    // 所以界面不该自己拼 prompt 或建会话(那样就有两条路会漂)。
    expect(organizeKnowledge).toHaveBeenCalledTimes(1);
    // 把用户丢进聊天窗口,他看到的只是 agent 在干活;他要的是"整理完了没有"。
    expect(opened).toEqual([]);
    expect(document.body.textContent).toContain("最近整理");
  });

  it("跑过的轮次在知识库页有入口 —— 它们不在会话列表里,这里就是唯一的家", async () => {
    sessions = [
      { id: "r1", title: "知识库整理", workbenchId: "knowledge", updatedAt: 300 },
      { id: "r2", title: "知识库整理", workbenchId: "knowledge", updatedAt: 200 },
      // 普通对话不该出现在「最近整理」里。
      { id: "c1", title: "聊点别的", workbenchId: "conversation", updatedAt: 400 },
    ];
    const { opened } = await render();
    expect(document.body.textContent).toContain("最近整理");
    const openButtons = [...document.querySelectorAll("button")].filter((node) => node.textContent === "打开这一轮");
    expect(openButtons).toHaveLength(2);

    await act(async () => {
      openButtons[0]!.click();
    });
    // 点进去看的是**最近的那一轮**。
    expect(opened).toEqual(["r1"]);
  });

  it("一轮都没有时不摆空列表(空标题只是噪音)", async () => {
    await render();
    expect(document.body.textContent).not.toContain("最近整理");
  });

  it("还没有原始文件时不给整理(没有可加工的东西)", async () => {
    getKnowledgeSnapshot.mockImplementation(async () => snapshot({ rawFiles: [] }) as never);
    await render();
    expect(byText("立即整理")?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("把资料拖到这里");
  });

  it("导入把文件交给桥,并说明导入了几个", async () => {
    await render();
    await openImportMenu();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const files = [new File(["a"], "a.pdf"), new File(["b"], "b.docx")];

    await act(async () => {
      Object.defineProperty(input, "files", { value: files, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(importKnowledgeFiles).toHaveBeenCalledTimes(1);
    const [passedFiles, mode] = importKnowledgeFiles.mock.calls[0] as unknown as [File[], string];
    expect(passedFiles.map((file) => file.name)).toEqual(["a.pdf", "b.docx"]);
    // 拖放与「导入」都走复制:移动是破坏性的,不该是默认后果。
    expect(mode).toBe("copy");
    expect(document.body.textContent).toContain("已导入 2 个文件");
  });

  it("被跳过的文件要说出来(静默少几个最难查)", async () => {
    importKnowledgeFiles.mockImplementation(async () => ({ imported: 1, skipped: ["/gone.pdf"] }) as never);
    await render();
    await openImportMenu();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, "files", { value: [new File(["a"], "a.pdf")], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("1 个被跳过");
  });

  it("坏页显示出来并带上原因 —— 否则它们的源文件会永远显示未加工", async () => {
    getKnowledgeSnapshot.mockImplementation(async () => snapshot({ damaged: [{ path: "concepts/坏页.md", issue: "缺少 frontmatter" }] }) as never);
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("1 个页面读不出来");
    expect(text).toContain("concepts/坏页.md");
    expect(text).toContain("缺少 frontmatter");
  });

  it("订阅库变更:agent 在会话里写了页,视图跟着动", async () => {
    await render();
    expect(subscribeKnowledgeChanged).toHaveBeenCalled();
  });
});

describe("知识库视图与设置的关系", () => {
  it("停用时是**一整页**「尚未开启」,三个出口都在 —— 而不是一条横幅压在内容上", async () => {
    knowledge = prefs({ enabled: false });
    const opened: string[] = [];
    await render({ onOpenSettings: () => opened.push("settings") });

    // 一整页:标题、说明、开启、去配置、了解它如何工作。
    expect(document.body.textContent).toContain("知识库尚未开启");
    expect(byText("开启知识库")).not.toBeNull();
    expect(byText("前往知识库设置")).not.toBeNull();
    expect(byText("了解它如何工作")).not.toBeNull();
    // **不展示条目** —— 开关要花 Token,而"要不要开"是看到内容之前该做的决定。
    expect(document.body.textContent).not.toContain("2024 合同");
    expect(byText("立即整理")).toBeNull();
    expect(byText("体检")).toBeNull();

    await act(async () => {
      byText("前往知识库设置")!.click();
    });
    expect(opened).toEqual(["settings"]);
  });

  it("点「开启知识库」当场就展示条目(不用等重启)", async () => {
    knowledge = prefs({ enabled: false });
    const { rerender } = await render();
    expect(document.body.textContent).not.toContain("2024 合同");
    await act(async () => {
      byText("开启知识库")!.click();
    });
    // 开启 = 改一个偏好;界面拿到新偏好就把内容交出来(这里用一次重渲染代替那次广播)。
    expect(setKnowledge).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    await rerender();
    expect(document.body.textContent).toContain("2024 合同");
    expect(document.body.textContent).not.toContain("知识库尚未开启");
  });

  it("「了解它如何工作」说清三件事与代价 —— 开启之前先知道它是什么", async () => {
    knowledge = prefs({ enabled: false });
    await render();
    await act(async () => {
      byText("了解它如何工作")!.click();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("放入资料");
    expect(dialog.textContent).toContain("整理成页面");
    expect(dialog.textContent).toContain("会话里查得到");
    // 代价也要说 —— 这一页之所以存在,就是因为这个开关要花 Token。
    expect(dialog.textContent).toContain("Token");
    // 而且要说清"关掉不影响你自己的东西"。
    expect(dialog.textContent).toContain("不受影响");
  });

  it("模型不由界面决定 —— 宿主才知道该用哪个(手动跟随会话、定时要求显式选)", async () => {
    knowledge = prefs({ libraries: { 知识库: librarySettings({ processingModel: { connectionId: "openai", modelId: "gpt-5-mini" } }) } });
    await render();
    await act(async () => {
      byText("立即整理")!.click();
    });
    // 界面一次调用把整轮交给宿主,自己不传模型、也不拼 prompt。
    // 界面把"这一轮是什么"告诉宿主,但**不传模型** —— 模型是宿主的判断。
    expect(organizeKnowledge).toHaveBeenCalledWith("process");
  });
});

describe("一轮加工:宿主说为什么没起会话", () => {
  it("没活时不起会话,并说清楚", async () => {
    organizeResult = { skipped: "nothing-to-do" };
    await render();
    await act(async () => {
      byText("立即整理")!.click();
    });
    expect(document.body.textContent).toContain("没有要整理的东西");
  });

  it("四种「没起」的理由各有各的说法 —— 不能都只说「失败了」", async () => {
    await render();
    for (const [reason, expected] of [
      ["disabled", "知识库已停用"],
      ["no-model", "没选加工模型"],
      ["busy", "已经有一轮"],
      ["manual-only", "只手动"],
    ] as const) {
      organizeResult = { skipped: reason };
      await act(async () => {
        byText("立即整理")!.click();
      });
      expect(document.body.textContent, reason).toContain(expected);
    }
  });
});

describe("加工状态徽标", () => {
  it("宿主说在整理时就亮起来 —— 定时那一轮用户没点任何东西也要看得见", async () => {
    await render();
    expect(document.body.textContent).not.toContain("正在整理");
    await act(async () => {
      processingListener?.(true);
    });
    expect(document.body.textContent).toContain("正在整理");
    // 加工中不给重复点。
    expect(byText("立即整理")?.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      processingListener?.(false);
    });
    expect(document.body.textContent).not.toContain("正在整理");
  });
});

describe("人工复核", () => {
  it("每页一个复核开关,已复核的显示状态,过期显示提醒", async () => {
    await render();
    const text = document.body.textContent ?? "";
    // 概念页在 mock 里是"已复核 + 来源已变更"。
    expect(text).toContain("已复核");
    expect(text).toContain("来源已变更");
    // 未复核的源页给的是"标记已复核"。
    expect(text).toContain("标记已复核");
  });

  it("点复核开关会落盘 —— 这是「我的改动不会被 agent 覆盖」的唯一开关", async () => {
    await render();
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "标记已复核");
    expect(button).not.toBeUndefined();
    await act(async () => {
      button!.click();
    });
    expect(setKnowledgeVerification).toHaveBeenCalledWith("sources/2024合同.md", true);
  });
});

describe("体检", () => {
  it("体检按钮把 lint 交给宿主 —— 同一套调度,不同的准备", async () => {
    await render();
    const button = byText("体检");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(organizeKnowledge).toHaveBeenCalledWith("lint");
  });

  it("体检干净时说「干净」而不是「没什么可做的」", async () => {
    organizeResult = { skipped: "nothing-to-do" };
    await render();
    await act(async () => {
      byText("体检")!.click();
    });
    expect(document.body.textContent).toContain("体检干净");
  });

  it("库里一页都没有时不给体检(没什么可查的)", async () => {
    getKnowledgeSnapshot.mockImplementation(async () => snapshot({ pages: [] }) as never);
    await render();
    expect(byText("体检")?.hasAttribute("disabled")).toBe(true);
  });
});

describe("成本与预算", () => {
  it("把待整理的规模说清楚 —— 文件数与体积是事实,不是估算", async () => {
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("1 个待整理");
    expect(text).toContain("1.9 MB");
  });

  it("设了每轮上限时,界面上说明本轮最多几个", async () => {
    knowledge = prefs({ libraries: { 知识库: librarySettings({ maxFilesPerRound: 5 }) } });
    await render();
    expect(document.body.textContent).toContain("本轮最多 5 个");
  });

  it("累计用量标明是**估算**,并给出每文件均价(那是经验的,不是猜的)", async () => {
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("累计 3/3 轮");
    expect(text).toContain("123.5k token");
    expect(text).toContain("约 ¥1.23(估算)");
    // 源页 1 个 → 均价 = 1.23 / 1。
    expect(text).toContain("约 ¥1.23/文件(估算)");
  });
});

describe("导入别人的库:先看再导", () => {
  const plan = {
    directory: "/Users/someone/别人的库",
    added: 12,
    conflicts: [{ path: "concepts/流程.md", title: "流程" }],
    damaged: [{ path: "concepts/坏.md", issue: "缺少 frontmatter" }],
    raws: 3,
    sourceFilesMissing: false,
    droppedFields: { resource: 5 },
    mappedTypes: { Metric: 2 },
    truncatedTags: 0,
  };

  it("选了目录先给计划,什么都不写", async () => {
    importKnowledgeBundle.mockImplementation(async () => plan);
    await render();
    await openImportMenu();
    const button = byText("导入别人的库");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    // 只有一次调用,而且不带参数 —— 那就是"选目录 + 看计划"。
    expect(importKnowledgeBundle).toHaveBeenCalledWith();
    const text = document.body.textContent ?? "";
    expect(text).toContain("会新建 12 页");
    expect(text).toContain("1 页路径撞车");
    expect(text).toContain("1 个文件读不出来");
    // **读不懂的字段要报出来** —— 静默丢掉是最坏的选项。
    expect(text).toContain("resource(5)");
    expect(text).toContain("Metric→Concept(2)");
  });

  it("取消目录选择时什么都不显示", async () => {
    importKnowledgeBundle.mockImplementation(async () => null);
    await render();
    await openImportMenu();
    await act(async () => {
      byText("导入别人的库")!.click();
    });
    expect(document.body.textContent).not.toContain("导入计划");
  });

  it("确认后才写,并且撞车改名而不是覆盖", async () => {
    importKnowledgeBundle.mockImplementation(async (request?: unknown) => (request === undefined ? plan : plan));
    await render();
    await openImportMenu();
    await act(async () => {
      byText("导入别人的库")!.click();
    });
    await act(async () => {
      byText("确认导入")!.click();
    });
    expect(importKnowledgeBundle).toHaveBeenLastCalledWith({ directory: "/Users/someone/别人的库", onConflict: "rename" });
  });

  it("来源没有 raws 时提前警告(那些页下一轮会被回收)", async () => {
    importKnowledgeBundle.mockImplementation(async () => ({ ...plan, raws: 0, sourceFilesMissing: true }));
    await render();
    await openImportMenu();
    await act(async () => {
      byText("导入别人的库")!.click();
    });
    expect(document.body.textContent).toContain("没有 raws/");
  });
});

describe("多库", () => {
  it("**单库也给下拉提示** —— 它不只是切换器,还是库的入口(新建库在这儿)", async () => {
    await render();
    expect(document.body.textContent).toContain("知识库");
    expect(document.querySelector("[data-knowledge-switcher]")).not.toBeNull();
    // 箭头常驻……
    expect(document.querySelector("[data-knowledge-switcher-affordance]")).not.toBeNull();
    // ……而"有几个库"那个计数只在真的多于一个时才有意义。
    expect(document.querySelector("[data-knowledge-switcher-count]")).toBeNull();

    // 而且点开就有「新建库」—— 这才是它被看不见时丢掉的那个功能。
    await act(async () => {
      (document.querySelector("[data-knowledge-switcher]") as HTMLElement).click();
    });
    expect(byText("新建库")).not.toBeNull();
  });

  it("有多个库时标题带下拉提示,展开就能切,并标出当前那个", async () => {
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "乙库", names: ["甲库", "乙库"] }));
    await render();
    const trigger = document.querySelector("[data-knowledge-switcher]") as HTMLElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain("乙库");
    expect(document.querySelector("[data-knowledge-switcher-affordance]")).not.toBeNull();
    // 多于一个时才有计数。
    expect(document.querySelector("[data-knowledge-switcher-count]")?.textContent).toBe("2");

    // 库管理收在标题下面(切换 / 新建 / 删除 / 打开文件夹),所以标题点开必须真列出这些库。
    await act(async () => {
      trigger!.click();
    });
    expect(byText("甲库")).not.toBeNull();
    expect(byText("乙库")).not.toBeNull();
  });

  it("单库时不给删除 —— 删掉唯一的库等于把功能删了", async () => {
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "知识库", names: ["知识库"] }));
  setKnowledge.mockClear();
  readKnowledgePage.mockClear();
  restoreKnowledgePage.mockClear();
  deleteKnowledgePage.mockClear();
  clearKnowledgePages.mockClear();
  deleteSession.mockClear();
    await render();
    await act(async () => {
      (document.querySelector("[data-knowledge-switcher]") as HTMLElement).click();
    });
    expect(byText("删除这个库")).toBeNull();
  });

  it("多库时才有删除,而且确认框里报出要删掉多少东西", async () => {
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "甲库", names: ["甲库", "乙库"] }));
    await render();
    await act(async () => {
      (document.querySelector("[data-knowledge-switcher]") as HTMLElement).click();
    });
    const remove = byText("删除这个库");
    expect(remove).not.toBeNull();
    await act(async () => {
      remove!.click();
    });
    // **不报数字的确认等于没确认**:用户要知道自己正要删掉什么。
    //
    // 而这条确认是**自绘的**弹窗,不是 `window.confirm`:后者在 Electron 里是原生模态,
    // 带的是 Electron 自己的图标(用户实测指出过),样式与暗色主题也对不上。
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("2 页");
    expect(dialog!.textContent).toContain("2 个原始文件");
  });

  it("新建库用**自绘**输入弹窗 —— `window.prompt` 在 Electron 里根本不支持", async () => {
    await render();
    await act(async () => {
      (document.querySelector("[data-knowledge-switcher]") as HTMLElement).click();
    });
    await act(async () => {
      byText("新建库")!.click();
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    const input = dialog!.querySelector("input");
    expect(input).not.toBeNull();
    // 有默认名字,而空名字不给提交。
    expect((input as HTMLInputElement).value).not.toBe("");
  });
});

describe("版式:动作按重量分开", () => {
  /** 某个容器里有没有一颗按钮带这段文字。 */
  const hasButton = (root: Element, text: string): boolean =>
    [...root.querySelectorAll("button")].some((button) => button.textContent?.includes(text));

  it("顶栏只放常用的四件事,库管理收进标题", async () => {
    // 这一页原来顶栏挂着八颗同样重的按钮,于是每一颗都不显眼,还挤掉了真正常用的那几颗。
    getKnowledgeLibraries.mockImplementation(async () => ({ active: "甲库", names: ["甲库", "乙库"] }));
    await render();
    const header = document.querySelector("header")!;

    expect(hasButton(header, "立即整理")).toBe(true);
    expect(hasButton(header, "体检")).toBe(true);
    // 刷新退成图标按钮:常用,但不需要占一个词。
    expect(header.querySelector('button[aria-label="刷新"]')).not.toBeNull();

    // 这四件事一年点不了几次,而且都属于"库本身" —— 不该和主按钮并排。
    for (const text of ["新建库", "删除这个库", "打开文件夹", "导入别人的库", "移动进来"]) {
      expect(hasButton(header, text), text).toBe(false);
    }
  });

  it("导入是**一颗**按钮,三种做法收在它的弹层里", async () => {
    // 三颗并排("复制进来 / 移动进来 / 导入别人的库")是一堵同等重量的按钮墙,
    // 而它们本来是一件事的三种做法。
    await render();
    expect(byText("导入别人的库")).toBeNull();
    await act(async () => {
      byText("导入")!.click();
    });
    expect(byText("复制进来")).not.toBeNull();
    expect(byText("移动进来")).not.toBeNull();
    expect(byText("导入别人的库")).not.toBeNull();
  });

  it("**页面在前、投递在后**:最该读的东西不该被压在下面", async () => {
    // 这是重设计的那条判断:以前是 最近整理 → 投递箱 → 页面,于是每次进来都得先滚过
    // 两张不常动的卡才看得见自己的知识。
    await render();
    // 只数**可见的**面板:折叠区里的东西虽然在 DOM 里,但它收着,不占首屏。
    const details = document.querySelector("details")!;
    const cards = [...document.querySelectorAll("section")].filter(
      (section) => section.className.includes("bg-card") && !details.contains(section),
    );
    // 待整理那条状态带也是 section,但它不是"卡"(没有标题)。
    const titled = cards.filter((card) => card.querySelector("h2") !== null);
    expect(titled.map((card) => card.querySelector("h2")?.textContent)).toEqual(["页面"]);
    // 而折叠区(管理与记录)在页面**之后**。
    expect(titled[0]!.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const card of titled) {
      expect(card.className).toContain("rounded-2xl");
      expect(card.className).toContain("border-border");
    }
  });

  it("历史与维护收在一个折叠区里(默认收起)", async () => {
    sessions = [{ id: "r1", title: "知识库整理", workbenchId: "knowledge", updatedAt: 300 }];
    await render();
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(details!.querySelector("summary")!.textContent).toContain("管理与记录");
    // 三样都在里面:最近整理 / 原始文件 / 用量。
    expect(details!.textContent).toContain("最近整理");
    expect(details!.textContent).toContain("原始文件");

    // **折叠区自己就是那张卡**:展开之后是小节 + 分隔线,不再套三张卡。
    // 套卡会让"一张卡里长出三张卡",而它们本来是同一件事的三段。
    expect(details!.className).toContain("rounded-2xl");
    expect(details!.className).toContain("bg-card");
    const nestedCards = [...details!.querySelectorAll("section")].filter((section) =>
      section.className.includes("bg-card"),
    );
    expect(nestedCards).toHaveLength(0);
  });

  it("空库时投递箱当首屏 —— 那时投递是唯一该做的事", async () => {
    getKnowledgeSnapshot.mockImplementation(async () => snapshot({ rawFiles: [], pages: [] }) as never);
    await render();
    expect(document.body.textContent).toContain("投递箱");
    expect(byText("复制进来")).not.toBeNull();
  });

  it("计数与列表说同一件事(活页 1 + 待回收 1,不混在一起数)", async () => {
    // 实测被问到过:「页面 2」而下面只列出 1 页 —— 因为列表按"排除已标孤儿"筛,而计数没筛。
    getKnowledgeSnapshot.mockImplementation(
      async () =>
        snapshot({
          pages: [
            { path: "sources/a.md", kind: "Source", title: "活页", description: "在。", tags: [], orphaned: false, verified: false, reviewStale: false },
            // 这一页已被 agent 退役(重复页)或原文已删 —— 下一轮会被回收。
            { path: "sources/b.md", kind: "Source", title: "待回收", description: "重复页。", tags: [], orphaned: true, verified: false, reviewStale: false },
          ],
        }) as never,
    );
    await render();
    // 认卡片本身(`bg-card`),不是包着它的那层 —— 视图根也是个 section,它什么都包含。
    const panel = [...document.querySelectorAll("section")].find(
      (section) => section.className.includes("bg-card") && section.querySelector("h2")?.textContent?.includes("页面"),
    )!;
    // 计数 = 列出来的那一页(meta 是标题旁边那一段,不是 h2 里面)。
    const head = panel.querySelector("header")!.textContent!;
    expect(head).toContain("1 页");
    // 而待回收的那一页要说一声,否则用户会以为页丢了。
    expect(head).toContain("1 个待回收");
    // 活页在正常分组里,待回收的在**它自己那一组**里 —— 两者分开数,不混。
    expect(byText("活页")).not.toBeNull();
    expect(byText("待回收")).not.toBeNull();
    expect(document.body.textContent).toContain("待回收");
  });

  it("待回收的页**列出来**,而且说得出为什么 + 能保留", async () => {
    // 设计给孤儿留了一轮宽限期,而看不见的东西救不回来 —— 这一组就是那条后路的入口。
    getKnowledgeSnapshot.mockImplementation(
      async () =>
        snapshot({
          pages: [
            { path: "sources/a.md", kind: "Source", title: "活页", description: "在。", tags: [], orphaned: false, verified: false, reviewStale: false },
            { path: "sources/dup.md", kind: "Source", title: "重复页", description: "退役了。", tags: [], orphaned: true, status: "deprecated", verified: false, reviewStale: false },
            { path: "sources/gone.md", kind: "Source", title: "原文没了", description: "原文删了。", tags: [], orphaned: true, verified: false, reviewStale: false },
          ],
        }) as never,
    );
    await render();
    // 两组都在:活页在正常分组里,待回收单独一组。
    expect(document.body.textContent).toContain("待回收");
    expect(byText("重复页")).not.toBeNull();
    expect(byText("原文没了")).not.toBeNull();
    // 两种原因的下一步不同,所以不能只说"待回收"。
    expect(document.body.textContent).toContain("已被退役");
    expect(document.body.textContent).toContain("原文已删除");

    const keep = [...document.querySelectorAll("button")].filter((button) => button.textContent === "保留");
    expect(keep).toHaveLength(2);
    await act(async () => {
      keep[0]!.click();
    });
    expect(restoreKnowledgePage).toHaveBeenCalledWith("sources/dup.md");
  });

  it("待回收的两个出口:保留 / 立即删除(而且删除要确认)", async () => {
    // 只有"保留"的话,用户会问"那我不想留呢" —— 答案是"什么都不做,下一轮就删了",
    // 而那要靠读文案才知道。把另一个出口也摆出来,这件事才是明摆着的两选一。
    getKnowledgeSnapshot.mockImplementation(
      async () =>
        snapshot({
          pages: [
            { path: "sources/dup.md", kind: "Source", title: "重复页", description: "退役了。", tags: [], orphaned: true, status: "deprecated", verified: false, reviewStale: false },
          ],
        }) as never,
    );
    await render();
    const remove = byText("立即删除");
    expect(remove).not.toBeNull();
    await act(async () => {
      remove!.click();
    });
    // 先确认,再删 —— 它不可撤销。
    expect(deleteKnowledgePage).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("不能撤销");
    await act(async () => {
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === "立即删除")!.click();
    });
    expect(deleteKnowledgePage).toHaveBeenCalledWith("sources/dup.md");
  });

  it("**复核过**的待回收页不算待回收 —— 回收会跳过它,说它「下一轮会被删除」是假话", async () => {
    getKnowledgeSnapshot.mockImplementation(
      async () =>
        snapshot({
          pages: [
            { path: "sources/kept.md", kind: "Source", title: "我留着的", description: "复核过。", tags: [], orphaned: true, verified: true, reviewStale: false },
          ],
        }) as never,
    );
    await render();
    // 它是活页:列在正常分组里,不在「待回收」里。
    expect(byText("我留着的")).not.toBeNull();
    expect(document.body.textContent).not.toContain("下一轮会被删除");
    expect(byText("保留")).toBeNull();
  });

  it("有活时摆一条**待整理状态带**(数字与体积都是事实)", async () => {
    await render();
    const strip = [...document.querySelectorAll("section")].find((section) => section.textContent?.includes("待整理"));
    expect(strip).not.toBeUndefined();
    expect(strip!.textContent).toContain("1 个文件待整理");
  });

  it("标题是 h1 且能点开库管理 —— 标题语义与点击都留着", async () => {
    await render();
    const heading = document.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toContain("知识库");
    expect(heading!.querySelector("button")).not.toBeNull();
  });
});

describe("目录里搜索", () => {
  /** React 的受控输入:必须走原型上的 setter,否则 React 的 value tracker 会把这次改动吞掉。 */
  const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("按标题筛页面,计数跟着筛后的结果走", async () => {
    await render();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    expect(document.body.textContent).toContain("2024 合同");

    await typeInto(search!, "发票");

    const text = document.body.textContent ?? "";
    expect(text).toContain("发票流程");
    expect(text).not.toContain("2024 合同");
    // 计数说的是**筛后**的页数,不是全库 —— 否则"筛出 1 页"和"共 2 页"会同时出现。
    expect(text).toContain("1 页");
  });

  it("也筛投递箱里的文件 —— 目录与投递箱是一个搜索框", async () => {
    await render();
    await typeInto(document.querySelector<HTMLInputElement>('input[type="search"]')!, "合同");
    const text = document.body.textContent ?? "";
    expect(text).toContain("合同/2024.pdf");
    expect(text).not.toContain("新资料.docx");
  });

  it("筛不到时说清是搜索没命中,而不是说库里是空的", async () => {
    await render();
    await typeInto(document.querySelector<HTMLInputElement>('input[type="search"]')!, "zzz");
    const text = document.body.textContent ?? "";
    expect(text).toContain("没有匹配的页面");
    // 空库那句话不能被借用:它会让用户以为东西丢了。
    expect(text).not.toContain("还没有页面");
  });

  it("清空搜索后全部回来", async () => {
    await render();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await typeInto(search, "发票");
    expect(document.body.textContent).not.toContain("2024 合同");

    await typeInto(search, "");
    expect(document.body.textContent).toContain("2024 合同");
    expect(document.body.textContent).toContain("新资料.docx");
  });
});

describe("界面上的四个动作(来自一次真实反馈)", () => {
  /**
   * 这四条各自对应一个被指出来的问题。共同点是**错了也不会报错**:
   * 原生弹窗照样弹(只是图标不对)、提示照样显示(只是会自己消失)、
   * 页面照样列出来(只是点不开)、加工轮照样堆着(只是删不掉)。
   */
  it("「移动进来」用自绘确认弹窗,不是原生 confirm(原生那个带 Electron 图标)", async () => {
    await render();
    await openImportMenu();
    await act(async () => {
      byText("移动进来")!.click();
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    // 它会删掉原文件,所以确认必须说清这件事(而不是只说"确定吗")。
    expect(dialog!.textContent).toContain("会把文件从原位置删掉");
    // 点确认之后才去开文件选择器(这里只验证弹窗这一步)。
  });

  it("每一轮整理都能删 —— 它们不在会话列表里,侧边栏那套删除够不着", async () => {
    sessions = [{ id: "r1", title: "知识库整理", workbenchId: "knowledge", updatedAt: 300 }];
    await render();
    const remove = document.querySelector('[aria-label="删除这一轮"]') as HTMLButtonElement | null;
    expect(remove).not.toBeNull();
    await act(async () => {
      remove!.click();
    });
    // 先确认,再删。
    expect(deleteSession).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      [...dialog!.querySelectorAll("button")].find((button) => button.textContent === "删除")!.click();
    });
    expect(deleteSession).toHaveBeenCalledWith("r1");
  });

  it("预览的长页**能滚**,而且不顶出窗口高度", async () => {
    // 这是用户实测报过的:一页长文把弹窗顶出桌面高度,而且滚不动。
    // 根因是结构 —— 弹窗要有"最大高度 + 不溢出",里面分成"固定头部 + 可滚动正文"。
    //
    // **量不了像素**:浏览器测试里没有加载 Tailwind,几何全是 0。所以这里钉的是那个结构,
    // 它正是修好这件事的东西(见 KnowledgeDialogs 的注释)。
    await render();
    await act(async () => {
      byText("2024 合同")!.click();
    });
    const content = document.querySelector('[role="dialog"]')!;
    // ① 弹窗自己封顶,并且不溢出。
    expect(content.className).toContain("max-h-[calc(100vh-var(--wordless-chrome-height)-2rem)]");
    expect(content.className).toContain("overflow-hidden");
    // ② 头是固定的,正文才是滚的那一段。
    const header = content.querySelector("header")!;
    expect(header.className).toContain("shrink-0");
    const scroller = [...content.querySelectorAll("div")].find((node) => node.className.includes("overflow-y-auto"));
    expect(scroller).not.toBeUndefined();
    expect(scroller!.className).toContain("min-h-0");
    expect(scroller!.className).toContain("flex-1");
  });

  it("点一页就预览正文 —— 列表里唯一看不出来的就是「这一页写了什么」", async () => {
    await render();
    await act(async () => {
      byText("2024 合同")!.click();
    });
    expect(readKnowledgePage).toHaveBeenCalledWith("sources/2024合同.md");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // 正文渲染出来(不是把 markdown 当纯文本印出来)。
    expect(dialog!.querySelector("h1")?.textContent).toContain("正文标题");
  });

  it("提示**不会自己消失**,但可以手动关掉", async () => {
    // 体检干净是一条要读的信息,不是一闪而过的反馈。
    organizeResult = { skipped: "nothing-to-do" };
    await render();
    await act(async () => {
      byText("体检")!.click();
    });
    const notice = document.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    // 时间过去它还在(这条断言是"没有定时器"的直接表达)。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    // 手动关掉。
    await act(async () => {
      (document.querySelector('[role="status"] button') as HTMLButtonElement).click();
    });
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
