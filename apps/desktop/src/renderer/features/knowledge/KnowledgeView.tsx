import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  ArchiveX,
  BookOpen,
  ExternalLink,
  BadgeCheck,
  Link,
  MoveRight,
  Lightbulb,
  LoaderCircle,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Stethoscope,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KnowledgeImportPlan, KnowledgeLibraries, KnowledgeSnapshot, KnowledgeUsageSummary } from "@wordless/protocol";
import { Button, Popover, PopoverContent, PopoverTrigger, TabButton, cn } from "@wordless/ui-kit";
import { KnowledgeConfirmDialog, KnowledgePreviewDialog, KnowledgePromptDialog } from "./KnowledgeDialogs";
import { KnowledgeHowItWorks } from "./KnowledgeHowItWorks";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { knowledgeRoundSessionsForLibrary, knowledgeSettingsFor } from "@wordless/domain";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";

/**
 * 知识库视图。
 *
 * **一页三块,顺序有讲究**:
 *
 * 1. **最近整理**在最上面(有才显示)—— 它是"我刚才点的那一下现在怎么样了",属于最新发生的事。
 * 2. **投递箱**在中间 —— 用户的下一步动作几乎总是"往里放东西"或"看看还有什么没整理"。
 * 3. **页面**在下面,按类型分组 —— 目录是给人看的,所以标题与一句话描述要显眼,路径次要。
 *
 * 版式跟着应用里其余的主视图走(同「Skills 与 MCP」那一页):居中、`px-5 sm:px-8 lg:px-10`、
 * 卡片分区。**动作按重量分开**,这是这一版最大的改动:
 *
 * - **库本身收进标题** —— 切换 / 新建 / 删除 / 打开文件夹都在标题下面。它们一年点不了几次,
 *   却曾经和「立即整理」并排站着,于是每一颗都不显眼,还挤掉了真正常用的那几颗。
 * - **顶栏只留一行**:搜索、刷新(图标)、体检(描边)、立即整理(实心)。一屏一个主按钮。
 * - **导入留在投递箱那张卡里** —— 它就是投递箱的动作。摆到顶栏等于把它从"往里放东西"里摘出来。
 *
 * 三处刻意的取舍:
 * - **"立即整理"不是在这里干活,而是开一个会话。** 加工需要模型、需要多轮、需要能回看,
 *   而那正是会话已经有的东西。在视图里另造一套进度与日志,等于把会话生命周期复制一份。
 * - **导入要问复制还是移动。** 复制保留原件(存储翻倍),移动消除重复(原件没了)。两者都
 *   合理,所以不能替用户选 —— 一个不透明的默认值会让"我的文件去哪了"变成惊吓。
 * - **坏页要显示出来。** frontmatter 坏掉的页进不了目录,如果界面也不提,它的源文件会
 *   永远显示"未加工",而用户找不到原因。
 */

export interface KnowledgeViewProps {
  /** 打开一个会话(由 shell 提供)。「立即整理」用它。 */
  onOpenSession: (sessionId: string) => void;
  /** 打开「设置 → 知识库」。停用时的横幅用它给一个去启用的入口。 */
  onOpenSettings?: () => void;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: KnowledgeSnapshot }
  | { kind: "error"; message: string };

const KIND_LABELS: Record<string, MessageKey> = { Source: "knowledgeKindSource", Concept: "knowledgeKindConcept", Entity: "knowledgeKindEntity" };
/** 每类页面一个图标:同一组里的行不必再读文字,就知道是同一类东西。 */
const KIND_ICONS: Record<string, LucideIcon> = { Source: FileText, Concept: Lightbulb, Entity: Boxes };

/** 未知类型直接显示原样 —— 它是宿主给的,编不出译名也别把它藏起来。 */
function kindLabel(kind: string, t: (key: MessageKey) => string): string {
  const key = KIND_LABELS[kind];
  return key === undefined ? kind : t(key);
}

/** 最近几轮加工显示多少行 —— 这是一个"找得回去"的入口,不是历史页面。 */
const RECENT_ROUNDS = 5;

/** 页面图标的底色 —— 与「通用」里那个通知图标同色,是应用里"文档"这一类的既定色。 */
const PAGE_ICON_TONE = "bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]";

/** 弹层里的一行 —— 与设置页的行同一套尺寸。 */
const POPOVER_ITEM = "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] transition-colors hover:bg-muted disabled:opacity-50";

export function KnowledgeView({ onOpenSession, onOpenSettings }: KnowledgeViewProps) {
  const { snapshot: runtimeSnapshot } = useRuntime();
  const client = useRuntimeClient();
  const { knowledge, setKnowledge, t } = usePreferences();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /**
   * 现在开着哪个弹窗。
   *
   * **不用 `window.confirm` / `window.prompt`**:前者是原生模态(带的是应用图标,而未打包
   * 运行时那是 Electron 自己的),后者在 Electron 里根本不支持 —— 新建库那颗按钮点了什么都
   * 不会发生。两者也都与这一页的样式与暗色主题不一致。
   */
  /** 「了解它如何工作」弹窗 —— 停用那一页的第三个出口。 */
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  /**
   * 「导入」那颗按钮下面的选项弹层,**开关自己拿着**。
   *
   * 以前它是非受控的:选中一项之后弹层不关。其中两项会接着开一个弹窗(移动确认、选文件),
   * 于是弹窗关掉之后弹层还留在原地 —— 看起来像"我刚选的那一下没生效"(实测被问到过)。
   * 受控之后,选中即关:弹层是"选一件事"的菜单,选完就该走。
   */
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "new-library" } | { kind: "remove-library" } | { kind: "move" } | { kind: "remove-round"; sessionId: string }
    | { kind: "preview"; path: string }
    | { kind: "delete-page"; path: string }
    | undefined
  >(undefined);
  /** 预览的那一页正文(打开弹窗时取一次)。 */
  const [preview, setPreview] = useState<string | undefined>(undefined);
  /** 宿主在跑一轮加工(定时或手动)—— 标题旁显示徽标。 */
  const [processing, setProcessing] = useState(false);
  /** 累计用量(最近若干轮)。 */
  const [usage, setUsage] = useState<KnowledgeUsageSummary | undefined>(undefined);
  /** 别人那份库的导入计划 —— **先看再导**。 */
  const [importPlan, setImportPlan] = useState<KnowledgeImportPlan | undefined>(undefined);
  /** 有哪些库、当前用哪个。 */
  const [libraries, setLibraries] = useState<KnowledgeLibraries | undefined>(undefined);
  /** 目录里的搜索词。**只筛不查**:宿主那份快照就是全量,再问一次是多余的一跳。 */
  const [query, setQuery] = useState("");
  /**
   * 页内 tab:**页面**(日常主角)与**资料与加工**(输入与审计)。
   *
   * 切这一刀的依据是"互斥、不同时看":页面是每天要看的东西;导入、待整理、原始文件、
   * 最近整理、用量是"偶尔看"的输入与审计。它们以前堆在同一列里,最后三样还挤在一个折叠区
   * 里 —— 而折叠的语义是"次要",轮次与原始文件并不次要(轮次是"agent 到底干了什么"的
   * 唯一入口)。
   *
   * 上面那条(库名 + 切库 + 加工中 + 搜索 + 刷新)不属于任何 tab:它是**作用域** ——
   * 底下每一块都绑在这个库上。
   */
  const [tab, setTab] = useState<"pages" | "material">("pages");
  /**
   * 切 tab 时**清空搜索**。
   *
   * 搜索框只有一个(在顶上那条里),而它的作用域跟着 tab 走:页面 tab 筛页面、资料 tab 筛
   * 原始文件。不清空的话,上一个 tab 的关键词会去筛另一份列表 —— 用户看到的是"结果莫名其妙
   * 少了",而输入框里那个词看起来毫无关系。
   */
  const switchTab = useCallback((next: "pages" | "material") => {
    setTab(next);
    setQuery("");
  }, []);

  /**
   * 打开一页的预览。**两处共用**:页面 tab 的行,与原始文件行上的"打开来源页" ——
   * 预览只有一种打开方式,才不会出现两种行为不一致的入口。
   *
   * 路径归一:库内链接是 bundle 形状(带前导 `/`),而快照里的页面路径不带 —— 收进来就归一,
   * 调用方不用关心自己手里是哪一种。
   */
  const openPage = useCallback(
    (pagePath: string) => {
      const path = pagePath.replace(/^\/+/, "");
      setPreview(undefined);
      setDialog({ kind: "preview", path });
      void client
        .readKnowledgePage(path)
        .then((result) => setPreview(result?.body ?? ""))
        .catch((error: unknown) => setPreview(error instanceof Error ? error.message : String(error)));
    },
    [client],
  );
  /**
   * 按**宿主解析出来的那个库**读设置。
   *
   * 偏好里那个可能是 `null`(用户从没切过库),拿它读会一律读到默认值 —— 于是界面显示的
   * 每轮上限与宿主真正用的那个对不上。与设置页同一条:以宿主解析的为准。
   */
  const settings = knowledgeSettingsFor(knowledge, libraries?.active ?? knowledge.activeKnowledgeBase);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 这一次"选择文件"是复制还是移动。用 ref 而不是 input 的 dataset:后者在点击前就被清了。 */
  const pickMode = useRef<"copy" | "move">("copy");

  const refresh = useCallback(async () => {
    try {
      setStatus({ kind: "ready", snapshot: await client.getKnowledgeSnapshot() });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void client
      .getKnowledgeLibraries()
      .then(setLibraries)
      .catch(() => setLibraries(undefined));
  }, [client]);

  // 用量与快照分开取:它是"历史",不需要跟着每次写入重算 —— 但**切库要重取**(它是按库的),
  // 加工跑完也要重取(那一轮刚花掉的钱还没算进来)。
  const loadUsage = useCallback(async () => {
    try {
      setUsage(await client.getKnowledgeUsage());
    } catch {
      setUsage(undefined);
    }
  }, [client]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  // agent 在会话里写页、或别处导入了文件时,这里跟着更新 —— 否则视图停在打开那一刻的状态。
  // 走桥的专用订阅(功能级推送的既有做法,同 `subscribeBrowserViewState`),不掺进 runtime 事件。
  useEffect(() => client.subscribeKnowledgeChanged(() => void refresh()), [client, refresh]);

  // 加工中:订阅宿主的状态。它同时覆盖定时那一轮 —— 用户没点任何东西时也会亮起来。
  // **跑完要重取用量**:那一轮的花费只在 journal 里,不重取就会一直显示上一轮之前的数字。
  useEffect(
    () =>
      client.subscribeKnowledgeProcessing((active) => {
        setProcessing(active);
        if (!active) void loadUsage();
      }),
    [client, loadUsage],
  );

  const importFiles = useCallback(
    async (files: File[], mode: "copy" | "move") => {
      if (files.length === 0) return;
      setBusy("import");
      setNotice(undefined);
      try {
        const result = await client.importKnowledgeFiles(files, mode);
        // 跳过的文件要说出来:静默少几个是最难查的一类问题。
        setNotice(
          result.skipped.length === 0
            ? t("knowledgeImported").replace("{count}", String(result.imported))
            : t("knowledgeImportSkipped")
                .replace("{count}", String(result.imported))
                .replace("{skipped}", String(result.skipped.length)),
        );
        await refresh();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(undefined);
      }
    },
    [client, refresh, t],
  );

  const organize = useCallback(
    async (kind: "process" | "lint" = "process") => {
      setBusy(kind);
      setNotice(undefined);
      try {
        // **一次调用**:算待办、起会话、收尾全在宿主 —— 手动与定时走同一条路,所以这里不该
        // 自己拼 prompt 或建会话(那样就有两条路会漂)。
        const result = await client.organizeKnowledge(kind);
        if (result.sessionId !== undefined) {
          // **不跳转。** 一轮整理是后台批处理,不是一次对话:把用户丢进聊天窗口,他看到的
          // 是 agent 在干活,而他要的是"整理完了没有"。所以留在这一页看徽标,跑完的轮次
          // 出现在「最近整理」里,想看过程再点进去。
          setNotice(t("knowledgeRoundStarted"));
          return;
        }
        // 没起会话:说清为什么。四种原因各有各的下一步。
        setNotice(
          {
            disabled: t("knowledgeSkippedDisabled"),
            "no-model": t("knowledgeSkippedNoModel"),
            busy: t("knowledgeSkippedBusy"),
            "manual-only": t("knowledgeSkippedManualOnly"),
            "nothing-to-do": kind === "lint" ? t("knowledgeLintClean") : t("knowledgeNothingToDo"),
          }[result.skipped ?? "nothing-to-do"] ?? t("knowledgeNothingToDo"),
        );
        await refresh();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(undefined);
      }
    },
    [client, refresh, t],
  );

  const pickLibrary = useCallback(
    (name: string) => {
      // 切换 = 改一个偏好。宿主那边每次调用现解析,所以这里不用通知谁。
      // **用量与快照都要重取**:两者都是按库的(用量按轮次的会话根筛)。
      void setKnowledge({ ...knowledge, activeKnowledgeBase: name }).then(() =>
        Promise.all([refresh(), loadUsage()]),
      );
      void client.getKnowledgeLibraries().then(setLibraries).catch(() => undefined);
    },
    [client, knowledge, loadUsage, refresh, setKnowledge],
  );

  const createLibrary = useCallback(async (name: string) => {
    setBusy("library");
    try {
      const { active } = await client.mutateKnowledgeLibrary({ action: "create", name });
      // 新建完就切过去 —— 用户刚建一个库,下一步一定是在里面做事。
      if (active !== undefined) await setKnowledge({ ...knowledge, activeKnowledgeBase: active });
      setLibraries(await client.getKnowledgeLibraries());
      await refresh();
      // 刚建出来的库还没有轮次,但**必须重取**:否则会留着上一个库的用量数字。
      await loadUsage();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [client, knowledge, loadUsage, refresh, setKnowledge]);

  const removeLibrary = useCallback(
    async () => {
      const name = libraries?.active ?? knowledge.activeKnowledgeBase ?? "";
      setBusy("library");
      try {
        await client.mutateKnowledgeLibrary({ action: "delete", name });
        const next = await client.getKnowledgeLibraries();
        setLibraries(next);
        // 删掉的正是当前这个 → 切到还在的那个(偏好里那个名字已经不存在了)。
        await setKnowledge({ ...knowledge, activeKnowledgeBase: next.active });
        await refresh();
        await loadUsage();
      } finally {
        setBusy(undefined);
      }
    },
    [client, knowledge, libraries, loadUsage, refresh, setKnowledge, t],
  );

  const importBundle = useCallback(async () => {
    setBusy("import-bundle");
    setNotice(undefined);
    setImportPlan(undefined);
    try {
      const plan = await client.importKnowledgeBundle();
      // null = 用户取消了目录选择,什么都不做、也不提示。
      if (plan !== null) setImportPlan(plan);
    } finally {
      setBusy(undefined);
    }
  }, [client]);

  const confirmBundle = useCallback(
    async (directory: string, added: number) => {
      setBusy("import-bundle");
      try {
        await client.importKnowledgeBundle({ directory, onConflict: "rename" });
        setImportPlan(undefined);
        setNotice(t("knowledgeImportDone").replace("{count}", String(added)));
        await refresh();
      } finally {
        setBusy(undefined);
      }
    },
    [client, refresh, t],
  );

  if (status.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-[var(--wordless-shell-workspace)] text-[12px] text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {t("knowledgeLoading")}
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--wordless-shell-workspace)] p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <p className="max-w-[46ch] text-[12px] leading-5 text-muted-foreground">{status.message}</p>
        <Button onClick={() => void refresh()} size="sm" type="button" variant="outline">
          <RefreshCw className="h-3.5 w-3.5" />
          {t("knowledgeRefresh")}
        </Button>
      </div>
    );
  }

  /**
   * **停用时不展示条目,而是一整页"尚未开启"。**
   *
   * 与 loading / error 同级早退,所以它是一条**完整的一页**,而不是顶部一条横幅压在内容上。
   * 这一页要回答三个问题(开启 / 去配置 / 它是什么),回答完才把知识库交出来 ——
   * 因为这个开关要花 Token,而"要不要开"是用户该在**看到内容之前**做的决定。
   */
  if (!knowledge.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--wordless-shell-workspace)] p-8">
        <div className="flex w-full max-w-[440px] flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
            <BookOpen className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-[20px] font-bold tracking-tight">{t("knowledgeOffTitle")}</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{t("knowledgeOffHelp")}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button
              onClick={() => void setKnowledge({ ...knowledge, enabled: true })}
              size="sm"
              type="button"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("knowledgeOffEnable")}
            </Button>
            {onOpenSettings !== undefined && (
              <Button onClick={onOpenSettings} size="sm" type="button" variant="outline">
                {t("knowledgeOffSettings")}
              </Button>
            )}
          </div>
          <button
            className="mt-4 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setHowItWorksOpen(true)}
            type="button"
          >
            {t("knowledgeOffLearnHow")}
          </button>
        </div>
        <KnowledgeHowItWorks onClose={() => setHowItWorksOpen(false)} open={howItWorksOpen} />
      </div>
    );
  }

  const { snapshot } = status;
  const pending = snapshot.rawFiles.filter((file) => !file.processed);
  /**
   * 活页 = 没标孤儿 **或** 人工复核过(回收会跳过复核页,所以它是活的)。
   *
   * **计数与列表必须用同一个判据** —— 两处各写一遍,就会出现"说 2 页、只列出 1 页"。
   */
  const isLivePage = (page: (typeof snapshot.pages)[number]) => !page.orphaned || page.verified;

  /** 已加工的源页数 —— 算"每个文件平均花了多少"的分母。 */
  const sourcePages = snapshot.pages.filter((page) => page.kind === "Source" && !page.orphaned).length;
  /**
   * 已标孤儿、**下一轮真会被回收**的页。
   *
   * **要列出来,不能只报个数**:设计里那条"宽限期"就是给用户留的后路(宽限一轮再删),
   * 而如果界面上看不见它,那条后路就走不通 —— 用户救不了一个看不见的东西。
   *
   * `!verified` 那一半是必须的:回收会**跳过复核页**(`reapPage`),所以一个"复核过又标着
   * 孤儿"的页不会消失 —— 把它列在"待回收"里等于说"下一轮会被删除",而那是假话。
   * 那种页算活页(`listedPages` 那一半),它的「已复核」标记本来就写着"不会再自动改写"。
   */
  const reapingPages = snapshot.pages.filter((page) => page.orphaned && !page.verified);
  /**
   * **复核过、但原始文件已经没了**的来源页。回收会跳过它们(所以不进"待回收"),而来源页
   * 又不住在这一屏的任何分组里 —— 不给它们一个位置,这些被用户亲手留下的页就从界面上
   * 消失了。放在这里:每行一枚「已复核」芯片,和一颗"取消复核"的开关(取消之后它会回到
   * 待回收,由下一轮处理 —— 这是既有的语义,不是新造的)。
   */
  const keptSourcePages = snapshot.pages.filter(
    (page) => page.kind === "Source" && page.orphaned && page.verified,
  );
  /**
   * 最近几轮加工 —— **只列当前这个库的**。
   *
   * 判据是 `source` 标记(见 `isKnowledgeRound`),再加上**库**:加工会话的会话根就是它加工的
   * 那个库,所以 `runtimeRootPath` 是轮次与库之间唯一的连接。少了这一半,多库时这一页会把
   * 别的库的轮次列出来 —— 而它出现在"这个库"的页面上,看不出来是别人的。
   *
   * 这里只列轮次,不列用户自己从新建页起的知识库会话:那些会出现在侧边栏里(它们就是用户的
   * 对话),再在这里冒充一轮加工只会把真正的轮次挤出去。
   */
  const rounds = knowledgeRoundSessionsForLibrary(runtimeSnapshot?.sessions ?? [], snapshot.root)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_ROUNDS);
  /**
   * 页面 tab 分**三类,但这一屏只放"知识"那两类**(Concept/Entity)。
   *
   * **来源页不在这里**:它与原始文件是 1:1 的(`sources[].resource` 指回去),所以它跟着
   * 原始文件住在「资料与加工」tab —— 在原始文件那行上就能打开它。混在一起会让用户把
   * "证据"当成另一堆要读的东西(实测:用户分不清 sources 与 concepts 的区别,而它们
   * 本来就该住在不同的地方)。
   *
   * 分组顺序固定:概念 → 实体。
   */
  const grouped = (["Concept", "Entity"] as const).map((kind) => ({
    kind,
    pages: snapshot.pages.filter((page) => page.kind === kind && isLivePage(page)),
  }));
  /**
   * 页面 tab 上**这一屏**列出的页数(概念 + 实体,排除待回收)。
   *
   * 计数与列表必须同一个判据 —— 否则"说 2 页、只列出 1 页"(实测被问到过)。
   * 来源页不算:它们不住在这一屏(见上面的说明)。
   */
  const listedPages = grouped.reduce((total, group) => total + group.pages.length, 0);

  // 搜索**在本地筛**:宿主那份快照已经是全量,而且目录是"看得见才找得到"的东西,
  // 每敲一个字问一次宿主只会让输入变卡。筛的字段就是页面上显示的字段 ——
  // 看得见的都能搜到,搜到的都看得见。
  //
  // **作用域跟着 tab 走**(切 tab 时会清空):页面 tab 筛页面,资料 tab 筛原始文件。
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const matches = (values: readonly string[]) => values.some((value) => value.toLowerCase().includes(needle));
  const visibleRaws = searching && tab === "material" ? snapshot.rawFiles.filter((file) => matches([file.path])) : snapshot.rawFiles;
  const visibleGroups = grouped.map(({ kind, pages }) => ({
    kind,
    pages: searching ? pages.filter((page) => matches([page.title, page.description, page.path, ...page.tags])) : pages,
  }));
  const visiblePageCount = visibleGroups.reduce((total, group) => total + group.pages.length, 0);
  /**
   * 原始文件 → 它的**来源页**。**宿主直接给**(`rawFiles[].pagePath`,协议里的新字段):
   * 1:1 的配对只有宿主算得出来(它握着全部页面),渲染层不该自己去拼路径 —— 以前想从
   * 页面摘要反推,但摘要是给"读"的,不带 `sources`。
   */
  const claimedPagePaths = new Set(
    snapshot.rawFiles.flatMap((file) => (file.pagePath === undefined ? [] : [file.pagePath])),
  );
  /**
   * **没有对应原始文件**的来源页(`sources[].resource` 是 URL —— `KnowledgeSourceRef` 允许
   * 绝对 URL)。它们在「原始文件」清单里没有行可挂,单独列出来:不列的话,这类页在界面上
   * 就真的无处可去了。判据用**排除法**(来源页而没有任何原始文件指向它),因为页面摘要
   * 不带 `sources`。
   */
  const urlSourcePages = snapshot.pages.filter(
    (page) => page.kind === "Source" && isLivePage(page) && !claimedPagePaths.has(page.path),
  );
  /**
   * 空库 = 既没有原始文件、也没有页面。
   *
   * 这一档决定**首屏给谁**:刚建出来的库唯一该做的事是投递,所以那时投递箱当主内容;
   * 库里有东西之后,主角是页面,投递退成一颗「导入」按钮。
   */
  const isEmptyLibrary = snapshot.rawFiles.length === 0 && snapshot.pages.length === 0;
  const enabled = knowledge.enabled;

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]"
      onDragLeave={() => setDropping(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        // 拖放默认按**复制**进来:移动是破坏性的,不该是拖一下的默认后果。
        void importFiles([...event.dataTransfer.files], "copy");
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1040px] px-5 pb-14 sm:px-8 lg:px-10">
          {/*
            **顶上这一条是"作用域",不是"这一页的标题"。**
            左边回答"我在哪个库"(底下的页面、原始文件、轮次、用量**全都是这个库的**),
            右边回答"我能对它做什么",再下面一行是 tab 条。它 sticky:滚到原始文件那一屏时
            仍然看得见自己在哪个库、哪个 tab —— 否则底下的数字属于谁就无从判断了。
            (负外边距是为了让底色铺满容器的左右留白,内容不会从旁边透出来。)
          */}
          <div className="sticky top-0 z-20 -mx-5 bg-[var(--wordless-shell-workspace)] px-5 pt-7 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          {/*
            标题那一行:**左边是"这是哪个库",右边是"我现在能对它做什么"**。
            以前标题本身是一个下拉框、右边挂着八颗同样重的按钮,于是既看不出这是哪一页,
            也看不出哪一颗才是主要的。
          */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <KnowledgeLibraryTitle
                active={libraries?.active ?? knowledge.activeKnowledgeBase ?? t("knowledgeCurrentLibraryUnknown")}
                busy={busy !== undefined}
                names={libraries?.names ?? []}
                onCreate={() => setDialog({ kind: "new-library" })}
                onRemove={() => setDialog({ kind: "remove-library" })}
                onReveal={() => void client.revealKnowledgeRoot()}
                onSelect={pickLibrary}
                root={snapshot.root}
              />
              {/*
                加工中:定时那一轮用户没点任何东西,所以这个徽标必须在,而且要在标题旁。
              */}
              {processing && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/30 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                  <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                  {t("knowledgeProcessing")}
                </span>
              )}
            </div>
            {/*
              **库在磁盘上的路径不占正文。** 以前它作为一行 mono 小字挂在标题下面,而它:
                - 不可操作 —— 同一件事的可操作形式是「打开文件夹」(标题菜单里、设置页里都有);
                - 前缀是产品定的(`<文档>/Wordless Knowledge/`),**每个库都一样**,唯一有区分度的
                  是最后一段(库名)—— 而它被 `truncate` 从尾部裁掉了。于是长路径下显示的是
                  "所有库都相同"的那一截:**看起来是信息,实际区分不了任何东西**。
                - 库名本来就在标题上(还能点开切换),设置页也有一行"当前库"。
              所以它退成标题的悬停提示(见 KnowledgeLibraryTitle 的 `root`),要看随时看得到,
              但不占版面、也不跟"加工中"抢那一行。
            */}

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* 空库时搜索框没有意义(底下只有投递箱),留着它只会让人以为"这里能搜什么"。 */}
              {!isEmptyLibrary && (
              <label className="relative w-[190px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label={t("knowledgeSearch")}
                  className="h-8 w-full rounded-lg border border-border bg-card py-0 pl-8 pr-7 text-[12px] outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("knowledgeSearch")}
                  type="search"
                  value={query}
                />
                {searching && (
                  <button
                    aria-label={t("knowledgeClearSearch")}
                    className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </label>
              )}
              <Button
                aria-label={t("knowledgeRefresh")}
                disabled={busy !== undefined}
                onClick={() => void refresh()}
                size="icon"
                title={t("knowledgeRefresh")}
                type="button"
                variant="outline"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              {/*
                **动作只在它有用的那个 tab 上。** 导入 / 检查 / 立即整理都是对"资料"做的事
                (投递、体检、按待办起一轮),所以它们属于资料 tab —— 页面 tab 上留一个刷新就够。
                待整理的数目挂在资料 tab 的标签上,停在页面 tab 也看得见"有活"。
              */}
              {!isEmptyLibrary && tab === "material" && (
                <>
              {/*
                **导入只有一颗按钮。** 三颗并排("复制进来 / 移动进来 / 导入别人的库")是一堵
                同等重量的按钮墙,而它们本来是一件事的三种做法。投递箱那张卡因此也不必常驻 ——
                它只在**空库**时当首屏(那时投递就是唯一该做的事)。
              */}
              <Popover onOpenChange={setImportMenuOpen} open={importMenuOpen}>
                <PopoverTrigger asChild>
                  {/*
                    **裸 button,不是 ui-kit 的 `Button`。** `Button` 没有 `forwardRef`,
                    而 Radix 的 `asChild` 要靠 ref 把 trigger 接上去 —— 用 Button 的话弹层
                    永远打不开(静默失败:点了没反应)。仓库里其它 `PopoverTrigger asChild`
                    也都是裸 button,原因就在这里。
                    **所以类名必须和 `variant="outline" size="icon"` 那一套逐字对齐** ——
                    尤其是不要自己加 `text-muted-foreground`:旁边两颗图标按钮用的是前景色,
                    只有这一颗灰着,看起来就像被停用了(实测被问到过)。
                  */}
                  <button
                    aria-label={t("knowledgeImport")}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
                    disabled={busy !== undefined}
                    title={t("knowledgeImportHint")}
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[260px] p-1.5">
                  {/* 隐藏的文件输入在**页面顶层**常驻(见那里的注释):它被三处点,放在弹层里
                      会随弹层卸载,另外两处就成了空点。 */}
                  <button
                    className={POPOVER_ITEM}
                    disabled={busy !== undefined}
                    onClick={() => {
                      setImportMenuOpen(false);
                      pickMode.current = "copy";
                      inputRef.current?.click();
                    }}
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("knowledgeImportCopy")}
                  </button>
                  <button
                    className={POPOVER_ITEM}
                    disabled={busy !== undefined}
                    onClick={() => {
                      setImportMenuOpen(false);
                      setDialog({ kind: "move" });
                    }}
                    type="button"
                  >
                    <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("knowledgeImportMove")}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button
                    className={POPOVER_ITEM}
                    disabled={busy !== undefined || processing}
                    onClick={() => {
                      setImportMenuOpen(false);
                      void importBundle();
                    }}
                    title={t("knowledgeImportBundleHelp")}
                    type="button"
                  >
                    <PackagePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("knowledgeImportBundle")}
                  </button>
                </PopoverContent>
              </Popover>
              <Button
                // **停用也一样不给点**:体检也要起一个知识会话,而那一轮的画像没有知识库工具
                // (与「立即整理」同一条理由 —— 以前这里漏了,点了会得到一个莫名其妙的失败)。
                aria-label={t("knowledgeLint")}
                disabled={busy !== undefined || processing || snapshot.pages.length === 0 || !enabled}
                onClick={() => void organize("lint")}
                size="icon"
                title={t("knowledgeLintHelp")}
                type="button"
                variant="outline"
              >
                {busy === "lint" ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Stethoscope className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                // 停用时不给点:那个会话跑起来会没有知识库工具,点下去只会得到一个莫名其妙的失败。
                disabled={busy !== undefined || processing || snapshot.rawFiles.length === 0 || !enabled}
                onClick={() => void organize()}
                size="sm"
                title={enabled ? undefined : t("knowledgeDisabledHint")}
                type="button"
              >
                {busy === "organize" ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                  {t("knowledgeOrganize")}
                </Button>
                </>
              )}
            </div>
          </header>

          {/*
            tab 条。**空库时没有 tab**:一个刚建出来的库只有一件事可做(把文件放进来),
            分成两个 tab 只会让"没有页面"和"该投递"分散在两处,用户还得来回切。
          */}
          {!isEmptyLibrary && (
            <nav aria-label="Knowledge views" className="mt-3 flex items-center gap-1 border-b border-border">
              <TabButton active={tab === "pages"} onClick={() => switchTab("pages")}>
                {t("knowledgePages")}
              </TabButton>
              <TabButton active={tab === "material"} onClick={() => switchTab("material")}>
                {t("knowledgeTabMaterial")}
                {/*
                  待整理的数目挂在 tab 上:它是"现在有活"的信号,而干活那颗按钮在资料 tab 里。
                  不挂的话,停在页面 tab 的人看不出库里还有东西等着整理(以前那条状态带就是这个作用)。
                */}
                {pending.length > 0 && (
                  <span
                    className="ml-1.5 rounded-full bg-accent/30 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-accent-foreground"
                    title={t("knowledgePendingStrip").replace("{count}", String(pending.length))}
                  >
                    {pending.length}
                  </span>
                )}
              </TabButton>
            </nav>
          )}
          </div>

          {/*
            **文件输入必须常驻,不能放在导入弹层里。** Radix 的弹层关闭时会卸载内容,而这个
            input 被三处点:`导入`弹层里的两项、投递箱的「复制进来」、以及「移动进来」确认框 ——
            后两处调用时弹层是关着的,于是 `inputRef.current` 是 null,点下去**什么都不发生**
            (静默失败)。放在这一层:任何 tab、任何时刻都在。
          */}
          <input
            className="hidden"
            multiple
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              const mode = pickMode.current;
              event.target.value = "";
              void importFiles(files, mode);
            }}
            ref={inputRef}
            type="file"
          />

          {/*
            提示**不会自己消失**:它要么被下一个动作替换,要么用户点掉。体检结果、"为什么没起会话"
            这类话是要读的,不是一闪而过的反馈 —— 而一闪而过的提示等于没说。
          */}
          {notice !== undefined && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-muted/60 px-3.5 py-2 text-[12px] leading-5" role="status">
              <span className="min-w-0 flex-1">{notice}</span>
              <button
                aria-label={t("noticeClose")}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setNotice(undefined)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          )}

          {/*
            导入计划:**先看再导**。一份别人的库可能有几百页,盲目导进去之后才发现"撞了 40 页"
            "少了原始文件",而那时已经在库里了。
          */}
          {importPlan !== undefined && (
            <section className="mt-4 rounded-2xl border border-border bg-card p-4">
              <h2 className="text-[13px] font-semibold">{t("knowledgeImportPlan").replace("{directory}", importPlan.directory)}</h2>
              <ul className="mt-2 space-y-1 text-[12px] leading-5 text-muted-foreground">
                <li>{t("knowledgeImportAdded").replace("{count}", String(importPlan.added))}</li>
                {importPlan.conflicts.length > 0 && (
                  <li>{t("knowledgeImportConflicts").replace("{count}", String(importPlan.conflicts.length))}</li>
                )}
                {importPlan.raws > 0 && <li>{t("knowledgeImportRaws").replace("{count}", String(importPlan.raws))}</li>}
                {importPlan.sourceFilesMissing && <li className="text-amber-700 dark:text-amber-500">{t("knowledgeImportNoRaws")}</li>}
                {importPlan.damaged.length > 0 && (
                  <li>{t("knowledgeImportDamaged").replace("{count}", String(importPlan.damaged.length))}</li>
                )}
                {Object.keys(importPlan.droppedFields).length > 0 && (
                  // **读不懂的字段要报出来** —— 静默丢掉是这里最坏的选项:用户会以为全导进来了。
                  <li>
                    {t("knowledgeImportDroppedFields").replace(
                      "{fields}",
                      Object.entries(importPlan.droppedFields)
                        .map(([field, count]) => `${field}(${count})`)
                        .join("、"),
                    )}
                  </li>
                )}
                {Object.keys(importPlan.mappedTypes).length > 0 && (
                  <li>
                    {t("knowledgeImportMappedTypes").replace(
                      "{types}",
                      Object.entries(importPlan.mappedTypes)
                        .map(([type, count]) => `${type}→Concept(${count})`)
                        .join("、"),
                    )}
                  </li>
                )}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  disabled={busy !== undefined || importPlan.added === 0}
                  onClick={() => void confirmBundle(importPlan.directory, importPlan.added)}
                  size="sm"
                  type="button"
                >
                  {t("knowledgeImportConfirm")}
                </Button>
                <Button onClick={() => setImportPlan(undefined)} size="sm" type="button" variant="ghost">
                  {t("knowledgeImportCancel")}
                </Button>
              </div>
            </section>
          )}

          <div className="mt-5 space-y-3.5">
          {/*
            **空库时投递箱当首屏。** 一个刚建出来的库,唯一该做的事就是把文件放进来 ——
            那时页面列表是空的,把投递箱摆在最上面才是对的。库里有东西之后它就让位给页面,
            只留一颗「导入」按钮(资料 tab 里那颗)。
          */}
          {isEmptyLibrary && (
            <Panel
              actions={
                <>
                  <Button
                    disabled={busy !== undefined}
                    onClick={() => {
                      pickMode.current = "copy";
                      inputRef.current?.click();
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t("knowledgeImportCopy")}
                  </Button>
                  <Button disabled={busy !== undefined} onClick={() => setDialog({ kind: "move" })} size="sm" type="button" variant="ghost">
                    {t("knowledgeImportMove")}
                  </Button>
                  <Button
                    disabled={busy !== undefined || processing}
                    onClick={() => void importBundle()}
                    size="sm"
                    title={t("knowledgeImportBundleHelp")}
                    type="button"
                    variant="ghost"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    {t("knowledgeImportBundle")}
                  </Button>
                </>
              }
              title={t("knowledgeDropBox")}
            >
              <EmptyState description={t("knowledgeEmptyDropBox")} icon={Upload} />
            </Panel>
          )}

            {/*
              损坏页归**资料 tab**:它是**输入侧**的问题(文件读不进来),不是页面本身的问题。
              压成一条左描边的警示,不再是圆角卡 —— 它是这一层最外的东西,不该再像一张"面板"。
            */}
            {!isEmptyLibrary && tab === "material" && snapshot.damaged.length > 0 && (
              <section className="mt-5 border-l-2 border-amber-500/60 bg-amber-500/10 py-2.5 pl-3.5 pr-4">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("knowledgeDamaged").replace("{count}", String(snapshot.damaged.length))}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {snapshot.damaged.map((entry) => (
                    <li className="text-[11px] leading-5 text-muted-foreground" key={entry.path}>
                      <span className="font-mono">{entry.path}</span> — {entry.issue}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          {/*
            **待整理不再单独占一行**:它的口径(几个文件、多大、本轮上限)就是原始文件清单的
            口径,并进了那一节的小节标题 —— 单独一张卡只会在 tab 底下多一层。
          */}

            {/*
              页面 tab = **知识**:概念与实体。来源页不在这里(它跟原始文件 1:1,住在资料 tab)。
              不套卡:tab 底下直接是分组与行,一层是一层 —— 再套一层 card 只会让页面看起来
              比实际复杂。
            */}
            {!isEmptyLibrary && tab === "pages" && (
              listedPages === 0 && reapingPages.length === 0 && keptSourcePages.length === 0 ? (
                <div className="mt-5">
                  <EmptyState description={t("knowledgeEmptyPages")} icon={FileText} />
                </div>
              ) : searching && visiblePageCount === 0 ? (
                <div className="mt-5">
                  <EmptyState description={t("knowledgeSearchEmptyHelp")} icon={Search} title={t("knowledgeSearchEmpty")} />
                </div>
              ) : (
                <div className="mt-5 space-y-6">
                  {visibleGroups.map(({ kind, pages }) =>
                    pages.length === 0 ? null : (
                      <div key={kind}>
                        {/* 分组标题压得很轻:它只回答"这一堆是什么",不跟页面标题抢注意力。 */}
                        <h3 className="mb-1 flex items-baseline gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {kindLabel(kind, t)}
                          <span className="font-mono tabular-nums text-muted-foreground/70">{pages.length}</span>
                        </h3>
                        <ul className="-mx-1.5 space-y-0.5">
                          {pages.map((page) => (
                            <PageRow
                              busy={busy !== undefined}
                              key={page.path}
                              onOpen={() => openPage(page.path)}
                              onToggle={() => {
                                // 复核 = "我的改动不会被 agent 覆盖"的唯一开关,所以它值得一颗显式的按钮。
                                setBusy(`verify:${page.path}`);
                                void client
                                  .setKnowledgeVerification(page.path, !page.verified)
                                  .then(() => refresh())
                                  .finally(() => setBusy(undefined));
                              }}
                              page={page}
                            />
                          ))}
                        </ul>
                      </div>
                    ),
                  )}

                  {/*
                    **待回收 = 一条后路,所以它必须看得见。**
                    设计里给孤儿留了一轮宽限期(下一轮才真删),而看不见的东西救不回来 ——
                    这一组就是那条后路的入口:列出每一页 + 一句"为什么它要被回收" + 一颗「保留」。
                    **来源页也会出现在这里**(原文被删 → 它的源页标孤儿),所以来源页搬走之后,
                    回收这条后路仍然兜得住它们。
                  */}
                  {reapingPages.length > 0 && (
                    <div>
                      <h3 className="mb-1 flex items-baseline gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t("knowledgeReapingGroup")}
                        <span className="font-mono tabular-nums text-muted-foreground/70">{reapingPages.length}</span>
                      </h3>
                      <ul className="-mx-1.5 space-y-0.5">
                        {reapingPages.map((page) => (
                          <li
                            className="flex items-start gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-muted/60"
                            key={page.path}
                          >
                            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
                              <ArchiveX className="h-3.5 w-3.5" />
                            </span>
                            {/*
                              **能预览**:这一组的每一个决定都是"留还是不留",而那个决定要看
                              里面写了什么。看不见内容就只剩猜。
                            */}
                            <button
                              className="min-w-0 flex-1 text-left"
                              onClick={() => {
                                setPreview(undefined);
                                setDialog({ kind: "preview", path: page.path });
                                void client
                                  .readKnowledgePage(page.path)
                                  .then((result) => setPreview(result?.body ?? ""))
                                  .catch((error: unknown) =>
                                    setPreview(error instanceof Error ? error.message : String(error)),
                                  );
                              }}
                              type="button"
                            >
                              <span className="block truncate text-[13px] font-semibold" title={page.title}>
                                {page.title}
                              </span>
                              {/* 为什么它要被回收 —— 两种原因的下一步不同,所以不能只说"待回收"。 */}
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {page.status === "deprecated"
                                  ? t("knowledgeReapingRetired")
                                  : t("knowledgeReapingSourceGone")}
                              </p>
                            </button>
                            {/*
                              **两个出口,一个决定。** 只有"保留"的话,用户会问"那我不想留呢"
                              —— 答案是"什么都不做,下一轮就删了",而那要靠读文案才知道。
                              把另一个出口也摆出来,这件事才是明摆着的两选一。
                            */}
                            <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                              <Button
                                disabled={busy !== undefined}
                                onClick={() => {
                                  setBusy(`restore:${page.path}`);
                                  void client
                                    .restoreKnowledgePage(page.path)
                                    .then(() => refresh())
                                    .catch((error: unknown) =>
                                      setNotice(error instanceof Error ? error.message : String(error)),
                                    )
                                    .finally(() => setBusy(undefined));
                                }}
                                size="sm"
                                title={t("knowledgeRestoreHelp")}
                                type="button"
                                variant="outline"
                              >
                                {t("knowledgeRestore")}
                              </Button>
                              <Button
                                className="text-destructive hover:text-destructive"
                                disabled={busy !== undefined}
                                onClick={() => setDialog({ kind: "delete-page", path: page.path })}
                                size="sm"
                                title={t("knowledgeDeletePageHelp")}
                                type="button"
                                variant="ghost"
                              >
                                {t("knowledgeDeletePage")}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/*
                    **被留下来的来源页**(复核过、原文没了)。回收跳过它们,而来源页又不住在
                    这一屏的分组里 —— 没有这个分组,用户亲手留下的页就从界面上消失了。
                    取消复核会把它们送回「待回收」,由下一轮处理(既有语义)。
                  */}
                  {keptSourcePages.length > 0 && !searching && (
                    <div>
                      <h3 className="mb-1 flex items-baseline gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t("knowledgeKeptGroup")}
                        <span className="font-mono tabular-nums text-muted-foreground/70">{keptSourcePages.length}</span>
                      </h3>
                      <ul className="-mx-1.5 space-y-0.5">
                        {keptSourcePages.map((page) => (
                          <li
                            className="flex items-start gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-muted/60"
                            key={page.path}
                          >
                            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#789347]/15 text-[#789347] dark:text-[#bad47a]">
                              <BadgeCheck className="h-3.5 w-3.5" />
                            </span>
                            <button className="min-w-0 flex-1 text-left" onClick={() => openPage(page.path)} type="button">
                              <span className="block truncate text-[13px] font-semibold" title={page.title}>
                                {page.title}
                              </span>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {t("knowledgeVerified")}
                                {page.reviewStale ? ` · ${t("knowledgeReviewStale")}` : ""}
                              </p>
                            </button>
                            <Button
                              // 这颗胶囊与 PageRow 的复核开关同一套语义:显示当前状态(已复核),
                              // 点一下就翻到另一面 —— 取消复核后它会回到「待回收」,由下一轮处理。
                              disabled={busy !== undefined}
                              onClick={() => {
                                setBusy(`verify:${page.path}`);
                                void client
                                  .setKnowledgeVerification(page.path, false)
                                  .then(() => refresh())
                                  .finally(() => setBusy(undefined));
                              }}
                              size="sm"
                              title={t("knowledgeVerifyHelp")}
                              type="button"
                              variant="outline"
                            >
                              {t("knowledgeVerified")}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            )}

          {/*
            **资料与加工 = 输入 + 审计。** 原始文件(哪些加工过)、最近整理(agent 干了什么)、
            累计用量(花了多少)是同一件事的三段:这个库进了什么、被怎么处理、代价是多少。
            以前它们挤在一个折叠区里,然后又挤进一张卡 —— 卡会把"这几段是并列的"说成
            "它们是一坨"。所以这三段平铺,用小节标题分开,不再嵌套。
          */}
          {!isEmptyLibrary && tab === "material" && (
            <>
          {/*
            **原始文件 = 输入侧的清单。** "待整理"那条状态带并进了小节标题 —— 它要说的
            (几个文件、多大、本轮上限)本来就是这份清单的口径,单独占一行卡只会多一层。
            **来源页跟着原始文件走**:每个已整理的文件,行上有一颗"打开来源页" ——
            一份原始文件对应恰好一页,这个 1:1 在这里看得见,不用去页面 tab 里找。
          */}
          <section className="mt-5">
            <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("knowledgeRawFiles")}
              <span className="font-mono tabular-nums text-muted-foreground/70">
                {t("knowledgeRawCount")
                  .replace("{total}", String(snapshot.rawFiles.length))
                  .replace("{pending}", String(pending.length))}
              </span>
              {pending.length > 0 && (
                <span className="font-mono tabular-nums text-muted-foreground/70">
                  {formatBytes(pending.reduce((total, file) => total + file.bytes, 0))}
                  {settings.maxFilesPerRound > 0 &&
                    ` · ${t("knowledgeBudgetApplies").replace("{files}", String(settings.maxFilesPerRound))}`}
                </span>
              )}
            </h3>
            {snapshot.rawFiles.length === 0 ? (
              <EmptyState description={t("knowledgeEmptyDropBox")} icon={Upload} />
            ) : visibleRaws.length === 0 ? (
              <EmptyState description={t("knowledgeSearchEmptyHelp")} icon={Search} title={t("knowledgeSearchEmpty")} />
            ) : (
              <ul className="-mx-1.5 space-y-0.5">
                {visibleRaws.map((file) => (
                  <li
                    className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                    key={file.path}
                  >
                    {/*
                      **按类型认文件**:docx 是 docx 的标、pdf 是 pdf 的标 —— 和对话里
                      `@` 文件、附件芯片用的是同一张表(`FileTypeIcon`),同一份资料在这两处
                      长得一样。不认识的扩展名给通用文件图标(它不猜)。
                    */}
                    <FileTypeIcon
                      className="h-3.5 w-3.5 shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5"
                      kind="file"
                      name={file.path}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]" title={file.path}>
                      {file.path}
                    </span>
                    {/* 状态不只用颜色:芯片上有字,灰度屏与读屏都分得出来。 */}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        file.processed ? "bg-muted text-muted-foreground" : "bg-accent/30 text-accent-foreground",
                      )}
                    >
                      {file.processed ? t("knowledgeProcessed") : t("knowledgePending")}
                    </span>
                    {(() => {
                      // 1:1 的另一半:这份文件被整理成了哪一页(宿主算好的配对)。
                      const pagePath = file.pagePath;
                      return pagePath === undefined ? null : (
                        <button
                          aria-label={t("knowledgeOpenSourcePage")}
                          className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => openPage(pagePath)}
                          title={t("knowledgeOpenSourcePage")}
                          type="button"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                        </button>
                      );
                    })()}
                    {(() => {
                      /*
                        **复核开关跟着原始文件走。** 它保护的正是"这个转写":复核过,加工轮就
                        不再自动改写这一页。来源页搬出页面 tab 之后,这个开关跟着它的页面
                        一起住到这里 —— 否则用户就再也无法说"这份我检查过了"。
                        状态不只用颜色:复核过与来源已变更是**不同的图标**(对着 title 也能读出)。
                      */
                      const page = snapshot.pages.find((candidate) => candidate.path === file.pagePath);
                      if (page === undefined) return null;
                      const label = page.reviewStale
                        ? t("knowledgeReviewStale")
                        : page.verified
                          ? t("knowledgeVerified")
                          : t("knowledgeVerify");
                      return (
                        <button
                          aria-label={label}
                          className={cn(
                            "shrink-0 rounded-lg p-1 transition-colors",
                            page.verified
                              ? "text-[#789347] dark:text-[#bad47a]"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          onClick={() => {
                            setBusy(`verify:${page.path}`);
                            void client
                              .setKnowledgeVerification(page.path, !page.verified)
                              .then(() => refresh())
                              .finally(() => setBusy(undefined));
                          }}
                          title={label}
                          type="button"
                        >
                          {page.reviewStale ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : (
                            <BadgeCheck className="h-3.5 w-3.5" />
                          )}
                        </button>
                      );
                    })()}
                    <span className="w-[62px] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatBytes(file.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {urlSourcePages.length > 0 && (
              <div className="mt-3">
                {/*
                  没有对应原始文件的来源页(`sources[].resource` 是 URL)。它们在原始文件清单里
                  没有行可挂 —— 不单独列出,这类页在界面上就无处可去了。
                */}
                <h3 className="mb-1 flex items-baseline gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {kindLabel("Source", t)}
                  <span className="font-mono tabular-nums text-muted-foreground/70">{urlSourcePages.length}</span>
                </h3>
                <ul className="-mx-1.5 space-y-0.5">
                  {urlSourcePages.map((page) => (
                    <li
                      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                      key={page.path}
                    >
                      <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <button
                        className="min-w-0 flex-1 truncate text-left text-[12px] hover:text-foreground"
                        onClick={() => openPage(page.path)}
                        title={page.path}
                        type="button"
                      >
                        {page.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {rounds.length > 0 && (
            <section className="mt-6">
              <h3 className="mb-1.5 flex items-baseline gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("knowledgeRecentRounds")}
                <span className="font-mono tabular-nums text-muted-foreground/70">{rounds.length}</span>
              </h3>
              <ul className="-mx-1.5 space-y-0.5">
                {rounds.map((round) => (
                  <li
                    className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                    key={round.id}
                  >
                    {/*
                      **一行放全,不许换行。** 以前钉死 124px:zh-CN 的时间串(`2026/10/14 11:27:34`,
                      19 字符)在 11px 的等宽字体里恰好放不下,于是折成两行 —— 而这一行右边
                      还有大片空。宽度如今交给字符串自己(所有行的格式一致,列依旧对得齐),
                      再加 `whitespace-nowrap` 兜底。
                    */}
                    <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                      {new Date(round.updatedAt).toLocaleString()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{round.title}</span>
                    {/*
                      icon-only:这是"看一眼那轮干了什么",标题就在它左边,不必再占一个词。
                      (文案退成 aria-label 与悬停提示。)
                    */}
                    <button
                      aria-label={t("knowledgeOpenRound")}
                      className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => onOpenSession(round.id)}
                      title={t("knowledgeOpenRound")}
                      type="button"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    {/*
                      **能删**。加工会话不在侧边栏的会话列表里(那里没有它们的位置,见文档 §13),
                      所以侧边栏那套"删除会话"够不着它们 —— 这里必须给一个入口,否则它们只会
                      一轮一轮地堆着。
                    */}
                    <button
                      aria-label={t("knowledgeRemoveRound")}
                      className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setDialog({ kind: "remove-round", sessionId: round.id })}
                      title={t("knowledgeRemoveRound")}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {usage !== undefined && usage.rounds > 0 && (
            <p className="mt-6 px-1.5 text-[11px] leading-5 text-muted-foreground">
              {t("knowledgeUsage")
                .replace("{rounds}", String(usage.rounds))
                .replace("{totalRounds}", String(usage.totalRounds))
                .replace("{tokens}", formatTokens(usage.totalTokens))
                .replace("{cost}", formatCost(usage.totalCost))}
              {sourcePages > 0 && usage.totalCost > 0 && (
                <>
                  {" · "}
                  {t("knowledgeUsagePerFile").replace("{cost}", formatCost(usage.totalCost / sourcePages))}
                </>
              )}
              {usage.rounds < usage.totalRounds && ` · ${t("knowledgeUsageSampled")}`}
            </p>
          )}
            </>
          )}
          </div>
        </div>
      </div>

      {/* 拖放提示:整页都是投放区,所以提示盖在整页上,而不是只在投递箱那一小块里。 */}
      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-ring bg-background/80">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Upload className="h-4 w-4" />
            {t("knowledgeDropHint")}
          </p>
        </div>
      )}

      {/*
        三个弹窗都在这里:**自绘而不是 `window.confirm` / `window.prompt`**。
        原生那两个在 Electron 里要么不支持(`prompt` 直接返回 null),要么带的是 Electron
        自己的图标(`confirm`),而且样式与暗色主题都对不上。
      */}
      <KnowledgePromptDialog
        confirmLabel={t("knowledgeNewLibrary")}
        description={t("knowledgeNewLibraryHelp")}
        initialValue={t("knowledgeNewLibraryDefault")}
        onCancel={() => setDialog(undefined)}
        onSubmit={(name) => {
          setDialog(undefined);
          void createLibrary(name);
        }}
        open={dialog?.kind === "new-library"}
        placeholder={t("knowledgeNewLibraryPrompt")}
        title={t("knowledgeNewLibrary")}
      />

      <KnowledgeConfirmDialog
        confirmLabel={t("knowledgeDeleteLibrary")}
        description={t("knowledgeDeleteLibraryConfirm")
          .replace("{name}", libraries?.active ?? knowledge.activeKnowledgeBase ?? "")
          .replace("{pages}", String(snapshot.pages.length))
          .replace("{raws}", String(snapshot.rawFiles.length))}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          setDialog(undefined);
          void removeLibrary();
        }}
        open={dialog?.kind === "remove-library"}
        title={t("knowledgeDeleteLibrary")}
        tone="danger"
      />

      <KnowledgeConfirmDialog
        confirmLabel={t("knowledgeImportMove")}
        description={t("knowledgeMoveConfirm")}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          setDialog(undefined);
          pickMode.current = "move";
          inputRef.current?.click();
        }}
        open={dialog?.kind === "move"}
        title={t("knowledgeImportMove")}
        tone="danger"
      />

      <KnowledgeConfirmDialog
        confirmLabel={t("delete")}
        description={t("knowledgeRemoveRoundConfirm")}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          const sessionId = dialog?.kind === "remove-round" ? dialog.sessionId : undefined;
          setDialog(undefined);
          if (sessionId === undefined) return;
          // 删的是会话记录(它不在侧边栏里,所以侧边栏那套删除够不着它)。
          void client
            .deleteSession(sessionId)
            .then(() => refresh())
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
        }}
        open={dialog?.kind === "remove-round"}
        title={t("knowledgeRemoveRound")}
        tone="danger"
      />

      <KnowledgeConfirmDialog
        confirmLabel={t("knowledgeDeletePage")}
        description={t("knowledgeDeletePageConfirm")}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          const path = dialog?.kind === "delete-page" ? dialog.path : undefined;
          setDialog(undefined);
          if (path === undefined) return;
          // 与定时回收走**同一个实现** —— 所以"摘掉别处对它的引用"不会漏。
          void client
            .deleteKnowledgePage(path)
            .then(() => refresh())
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
        }}
        open={dialog?.kind === "delete-page"}
        title={t("knowledgeDeletePage")}
        tone="danger"
      />

      <KnowledgePreviewDialog
        body={preview}
        onClose={() => setDialog(undefined)}
        onOpenPage={openPage}
        open={dialog?.kind === "preview"}
        page={dialog?.kind === "preview" ? snapshot.pages.find((candidate) => candidate.path === dialog.path) : undefined}
      />
    </section>
  );
}

/**
 * 标题 = 库的入口。
 *
 * 切换 / 新建 / 删除 / 打开文件夹都在标题下面:这四件事都属于"库本身",一年点不了几次。
 * 曾经它们和「立即整理」并排站在顶栏里,结果每一颗都不显眼,还挤掉了真正常用的那几颗。
 *
 * **单库时不给下拉提示**(一个选项的下拉框是噪音),但标题仍然可点 —— 否则就没有第二条路
 * 建出第二个库。
 */
function KnowledgeLibraryTitle({
  active,
  busy,
  names,
  onCreate,
  onRemove,
  onReveal,
  onSelect,
  root,
}: {
  active: string;
  busy: boolean;
  names: readonly string[];
  onCreate: () => void;
  onRemove: () => void;
  onReveal: () => void;
  onSelect: (name: string) => void;
  /** 库在磁盘上的位置。**只做悬停提示**,不做正文 —— 见调用点那段注释。 */
  root: string;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const multiple = names.length > 1;
  const close = () => setOpen(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {/* `h1` 包着按钮,而不是把 `h1` 塞进按钮里:标题语义留给读屏,点击留给鼠标 —— 两边都要。 */}
      <h1 className="flex min-w-0 items-center">
        <PopoverTrigger asChild>
          {/*
            **箭头一直都在。**
            曾经它只在"有多个库"时出现(理由:一个选项的下拉框是噪音)—— 但那个理由站不住:
            这个菜单不只是**切换器**,它还是**库的入口**(新建、打开文件夹、删除都在这儿),
            而"点标题能做什么"看不出来的话,新建库这个功能就等于没有。
            所以箭头常驻,而"有几个库"那个计数只在真的多于一个时才有意义。

            按钮上还加了 hover 底色:悬停时整块标题都在告诉你"这里可以点"。
          */}
          <button
            className="flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/70"
            data-knowledge-switcher=""
            // 库在磁盘哪儿:悬停才说。它不该占正文 —— 见调用点那段注释。
            title={root}
            type="button"
          >
            <span className="truncate text-[22px] font-bold tracking-tight">{active}</span>
            <span className="flex shrink-0 items-center gap-1.5" data-knowledge-switcher-affordance="">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
              {multiple && (
                <span
                  className="rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground"
                  data-knowledge-switcher-count=""
                >
                  {names.length}
                </span>
              )}
            </span>
          </button>
        </PopoverTrigger>
      </h1>
      <PopoverContent align="start" className="w-[300px] p-1.5">
        {multiple && (
          <>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("knowledgeSwitchLibrary")}
            </p>
            {names.map((name) => (
              <button
                className={cn(POPOVER_ITEM, name === active && "bg-muted/70")}
                key={name}
                onClick={() => {
                  close();
                  onSelect(name);
                }}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {name === active && <Check className="h-3.5 w-3.5 shrink-0 text-[#5c7a2a] dark:text-[#c8df89]" />}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
          </>
        )}

        <button
          className={POPOVER_ITEM}
          disabled={busy}
          onClick={() => {
            close();
            onCreate();
          }}
          type="button"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {t("knowledgeNewLibrary")}
        </button>
        {/* **单库时不给删除**:删掉唯一的库等于把功能删了,而那不该是一颗随手可点的按钮。 */}
        {multiple && (
          <button
            className={cn(POPOVER_ITEM, "text-[#b35e50] hover:bg-[#b35e50]/10 dark:text-[#efaaa0]")}
            disabled={busy}
            onClick={() => {
              close();
              onRemove();
            }}
            title={t("knowledgeDeleteLibraryHelp")}
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            {t("knowledgeDeleteLibrary")}
          </button>
        )}
        <button
          className={POPOVER_ITEM}
          onClick={() => {
            close();
            onReveal();
          }}
          type="button"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {t("knowledgeReveal")}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 一张分区卡:标题与计数在左、动作在右,内容在下面。
 *
 * 以前每一块都是通栏的 `border-b`,于是"哪几行是一件事"只能靠读文字判断;换成卡片之后
 * 边界是画出来的,滚动时也不会两块黏在一起。
 */
function Panel({
  actions,
  children,
  meta,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {meta !== undefined && <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{meta}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </section>
  );
}

/**
 * 空状态。
 *
 * 原来是虚线框里一句话 —— 虚线框读起来像"这里应该有东西但坏了",而空状态要说的恰恰相反:
 * "现在这样是正常的,下一步点这里"。所以改成图标 + 一句话(+ 必要时给标题),居中、安静。
 */
function EmptyState({ actions, description, icon: Icon, title }: { actions?: ReactNode; description: string; icon: LucideIcon; title?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-7 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      {title !== undefined && <p className="mt-3 text-[13px] font-semibold">{title}</p>}
      <p className={cn("max-w-[46ch] text-[12px] leading-5 text-muted-foreground", title !== undefined ? "mt-1" : "mt-3")}>
        {description}
      </p>
      {actions !== undefined && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** 一页:图标 + 标题 + 一句话描述 + 路径与标签,复核开关在最右。 */
function PageRow({ busy, onOpen, onToggle, page }: { busy: boolean; onOpen: () => void; onToggle: () => void; page: KnowledgeSnapshot["pages"][number] }) {
  const { t } = usePreferences();
  const Icon = KIND_ICONS[page.kind] ?? FileText;
  return (
    <li className="group flex items-start gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-muted/60">
      <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", PAGE_ICON_TONE)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      {/*
        标题/描述整块可点 → 预览正文。**只预览,不打开文件**:这一页是给人读的,
        而"这一页写了什么"是列表里唯一看不出来的东西(标题与一句话描述都在列表上了)。
      */}
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} type="button">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold" title={page.title}>
            {page.title}
          </span>
          {/* 复核过期:复核过,但来源变了 —— 该重新看一遍,而不是让它悄悄过期。 */}
          {page.reviewStale && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" />
              {t("knowledgeReviewStale")}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-5 text-muted-foreground" title={page.description}>
          {page.description}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-mono text-[10px] text-muted-foreground/80" title={page.path}>
            {page.path}
          </span>
          {page.tags.length > 0 && <span className="shrink-0 text-[10px] text-muted-foreground/80">{page.tags.join(" · ")}</span>}
        </div>
      </button>
      {/*
        **状态一直看得见,动作在悬停/聚焦时才出现。**
        "已复核"是这一页的事实,必须常驻;而"标记已复核"是一个动作 —— 一页一颗常驻按钮,
        五十页就是一堵按钮墙,真正要看的东西反而被淹掉。
      */}
      <button
        className={cn(
          "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:opacity-100",
          page.verified
            ? "border-[#dfe6cf] bg-[#eef4dc] text-[#4a5b22] dark:border-[#3d4a24] dark:bg-[#2a3320] dark:text-[#c8df89]"
            : "border-border text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground",
        )}
        disabled={busy}
        onClick={onToggle}
        title={t("knowledgeVerifyHelp")}
        type="button"
      >
        {page.verified ? t("knowledgeVerified") : t("knowledgeVerify")}
      </button>
    </li>
  );
}

/** 体积:给用户判断"要不要现在跑"用的,所以用 KB/MB 而不是字节。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** token 数:万/百万的量级用人能读的单位。 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/**
 * 成本。
 *
 * **标注"估算"**:它来自模型元数据里的价格 × 用量,与账单可能对不上(缓存折扣、阶梯价、
 * 供应商调价)。写成"花了 ¥X"是不诚实的。
 */
function formatCost(cost: number): string {
  if (cost <= 0) return "—";
  return cost < 1 ? `¥${cost.toFixed(3)}` : `¥${cost.toFixed(2)}`;
}
