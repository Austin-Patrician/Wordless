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
  ChevronRight,
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
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@wordless/ui-kit";
import { KnowledgeConfirmDialog, KnowledgePreviewDialog, KnowledgePromptDialog } from "./KnowledgeDialogs";
import { KnowledgeHowItWorks } from "./KnowledgeHowItWorks";
import { knowledgeSettingsFor } from "@wordless/domain";
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
/** 分组顺序固定:来源 → 概念 → 实体(事实、提炼、对象)。 */
const PAGE_KINDS = ["Source", "Concept", "Entity"] as const;

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
   * 最近几轮加工。**按 `workbenchId` 认**(不是 `entryId`):它就是这个会话"是不是对话"的
   * 判据,与侧边栏的过滤用的是同一个 —— 两处用两个判据迟早会不一致。
   */
  const rounds = (runtimeSnapshot?.sessions ?? [])
    .filter((session) => session.workbenchId === "knowledge")
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_ROUNDS);
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

  // 用量与快照分开取:它是"历史",不需要跟着每次写入重算。
  useEffect(() => {
    void client
      .getKnowledgeUsage()
      .then(setUsage)
      .catch(() => setUsage(undefined));
  }, [client]);

  // agent 在会话里写页、或别处导入了文件时,这里跟着更新 —— 否则视图停在打开那一刻的状态。
  // 走桥的专用订阅(功能级推送的既有做法,同 `subscribeBrowserViewState`),不掺进 runtime 事件。
  useEffect(() => client.subscribeKnowledgeChanged(() => void refresh()), [client, refresh]);

  // 加工中:订阅宿主的状态。它同时覆盖定时那一轮 —— 用户没点任何东西时也会亮起来。
  useEffect(() => client.subscribeKnowledgeProcessing(setProcessing), [client]);

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
      void setKnowledge({ ...knowledge, activeKnowledgeBase: name }).then(() => refresh());
      void client.getKnowledgeLibraries().then(setLibraries).catch(() => undefined);
    },
    [client, knowledge, refresh, setKnowledge],
  );

  const createLibrary = useCallback(async (name: string) => {
    setBusy("library");
    try {
      const { active } = await client.mutateKnowledgeLibrary({ action: "create", name });
      // 新建完就切过去 —— 用户刚建一个库,下一步一定是在里面做事。
      if (active !== undefined) await setKnowledge({ ...knowledge, activeKnowledgeBase: active });
      setLibraries(await client.getKnowledgeLibraries());
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [client, knowledge, refresh, setKnowledge]);

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
      } finally {
        setBusy(undefined);
      }
    },
    [client, knowledge, libraries, refresh, setKnowledge, t],
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
   * **列出来的**页数(排除已标孤儿、等着回收的那些)。
   *
   * 列表本来就按这个判据筛,所以计数必须用同一个 —— 否则同一个面板里两个数字对不上:
   * 「页面 2」而下面只列出 1 页(实测被问到过)。
   */
  const listedPages = snapshot.pages.filter(isLivePage).length;
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
  const grouped = PAGE_KINDS.map((kind) => ({
    kind,
    pages: snapshot.pages.filter((page) => page.kind === kind && isLivePage(page)),
  }));

  // 搜索**在本地筛**:宿主那份快照已经是全量,而且目录是"看得见才找得到"的东西,
  // 每敲一个字问一次宿主只会让输入变卡。筛的字段就是页面上显示的字段 ——
  // 看得见的都能搜到,搜到的都看得见。
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const matches = (values: readonly string[]) => values.some((value) => value.toLowerCase().includes(needle));
  const visibleRaws = searching ? snapshot.rawFiles.filter((file) => matches([file.path])) : snapshot.rawFiles;
  const visibleGroups = grouped.map(({ kind, pages }) => ({
    kind,
    pages: searching ? pages.filter((page) => matches([page.title, page.description, page.path, ...page.tags])) : pages,
  }));
  const visiblePageCount = visibleGroups.reduce((total, group) => total + group.pages.length, 0);
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
        <div className="mx-auto w-full max-w-[1040px] px-5 pb-14 pt-7 sm:px-8 lg:px-10">
          {/*
            标题那一行:**左边是"这是哪个库",右边是"我现在能对它做什么"**。
            以前标题本身是一个下拉框、右边挂着八颗同样重的按钮,于是既看不出这是哪一页,
            也看不出哪一颗才是主要的。
          */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <KnowledgeLibraryTitle
                active={libraries?.active ?? knowledge.activeKnowledgeBase ?? t("knowledgeCurrentLibraryUnknown")}
                busy={busy !== undefined}
                names={libraries?.names ?? []}
                onCreate={() => setDialog({ kind: "new-library" })}
                onRemove={() => setDialog({ kind: "remove-library" })}
                onReveal={() => void client.revealKnowledgeRoot()}
                onSelect={pickLibrary}
              />
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="max-w-[46ch] truncate font-mono" title={snapshot.root}>
                  {snapshot.root}
                </span>
                {/* 加工中:定时那一轮用户没点任何东西,所以这个徽标必须在,而且要在标题旁。 */}
                {processing && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/30 px-2 py-0.5 font-medium text-accent-foreground">
                    <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                    {t("knowledgeProcessing")}
                  </span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                **导入只有一颗按钮。** 三颗并排("复制进来 / 移动进来 / 导入别人的库")是一堵
                同等重量的按钮墙,而它们本来是一件事的三种做法。投递箱那张卡因此也不必常驻 ——
                它只在**空库**时当首屏(那时投递就是唯一该做的事)。
              */}
              <Popover>
                <PopoverTrigger asChild>
                  {/*
                    **裸 button,不是 ui-kit 的 `Button`。** `Button` 没有 `forwardRef`,
                    而 Radix 的 `asChild` 要靠 ref 把 trigger 接上去 —— 用 Button 的话弹层
                    永远打不开(静默失败:点了没反应)。仓库里其它 `PopoverTrigger asChild`
                    也都是裸 button,原因就在这里。
                  */}
                  <button
                    className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-[0.7rem] font-medium shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    disabled={busy !== undefined}
                    title={t("knowledgeImportHint")}
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t("knowledgeImport")}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[260px] p-1.5">
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
                  <button
                    className={POPOVER_ITEM}
                    disabled={busy !== undefined}
                    onClick={() => {
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
                    onClick={() => setDialog({ kind: "move" })}
                    type="button"
                  >
                    <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("knowledgeImportMove")}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button
                    className={POPOVER_ITEM}
                    disabled={busy !== undefined || processing}
                    onClick={() => void importBundle()}
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
                disabled={busy !== undefined || processing || snapshot.pages.length === 0 || !enabled}
                onClick={() => void organize("lint")}
                size="sm"
                title={t("knowledgeLintHelp")}
                type="button"
                variant="outline"
              >
                {busy === "lint" ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Stethoscope className="h-3.5 w-3.5" />
                )}
                {t("knowledgeLint")}
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
            </div>
          </header>

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
              **加工会话的家。** 它们不进侧边栏会话列表(那是"不是对话的东西不进"的同一条:与媒体画布
              一样),所以得有地方能找到 —— 而且必须能找到,否则"agent 到底干了什么"就没有入口了。
            */}
          {/*
            **空库时投递箱当首屏。** 一个刚建出来的库,唯一该做的事就是把文件放进来 ——
            那时页面列表是空的,把投递箱摆在最上面才是对的。库里有东西之后它就让位给页面,
            只留一颗「导入」按钮(上面那行)。
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

            {snapshot.damaged.length > 0 && (
              <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
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
            **待整理 = 一条状态带,不是一张常驻的卡。** 它是"现在有活"的信号,没活的时候
            什么都不该占位置。数字与体积都是事实(能算准),所以照实写。
          */}
          {!isEmptyLibrary && pending.length > 0 && (
            <section className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-card px-4 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--wordless-accent)]" />
                {t("knowledgePendingStrip").replace("{count}", String(pending.length))}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatBytes(pending.reduce((total, file) => total + file.bytes, 0))}
                {settings.maxFilesPerRound > 0 &&
                  ` · ${t("knowledgeBudgetApplies").replace("{files}", String(settings.maxFilesPerRound))}`}
              </span>
            </section>
          )}

            <Panel
              meta={
                <>
                  {t("knowledgePageCount").replace("{count}", String(searching ? visiblePageCount : listedPages))}
                  {/* 待回收的页在下面单独一组里列着,这里只是把数目先说出来。 */}
                  {reapingPages.length > 0 && !searching && (
                    <span className="text-muted-foreground/70">
                      {" · "}
                      {t("knowledgeReapingPages").replace("{count}", String(reapingPages.length))}
                    </span>
                  )}
                </>
              }
              title={t("knowledgePages")}
            >
              {listedPages === 0 && reapingPages.length === 0 ? (
                <EmptyState description={t("knowledgeEmptyPages")} icon={FileText} />
              ) : searching && visiblePageCount === 0 ? (
                <EmptyState description={t("knowledgeSearchEmptyHelp")} icon={Search} title={t("knowledgeSearchEmpty")} />
              ) : (
                <div className="space-y-3">
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
                              onOpen={() => {
                                setPreview(undefined);
                                setDialog({ kind: "preview", path: page.path });
                                void client
                                  .readKnowledgePage(page.path)
                                  .then((result) => setPreview(result?.body ?? ""))
                                  .catch((error: unknown) => setPreview(error instanceof Error ? error.message : String(error)));
                              }}
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
                </div>
              )}
            </Panel>

          {/*
            **历史与维护收进一个折叠区。** 这三样(最近整理、原始文件清单、累计用量)都是
            "偶尔要看"的东西,而它们以前各占一张常驻的卡 —— 于是真正要读的页面被压在最下面,
            每次进来都得先滚过两张不常动的卡。折叠默认收起,要看时一键展开。
          */}
          {/*
            折叠区**自己就是那张卡**:展开之后里面是小节 + 分隔线,不再套三张卡。
            套卡会让"一张卡里长出三张卡",而它们本来是同一件事(库的维护与历史)的三段。
          */}
          <details className="group mt-3.5 rounded-2xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
              {t("knowledgeManagement")}
              {rounds.length > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">{rounds.length}</span>
              )}
            </summary>
            <div className="space-y-3 border-t border-border px-4 py-3">
              {rounds.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[12px] font-semibold">{t("knowledgeRecentRounds")}</h3>
                  <ul className="-mx-1.5 space-y-0.5">
                    {rounds.map((round) => (
                      <li
                        className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                        key={round.id}
                      >
                        <span className="w-[124px] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {new Date(round.updatedAt).toLocaleString()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px]">{round.title}</span>
                        <Button className="shrink-0" onClick={() => onOpenSession(round.id)} size="sm" type="button" variant="ghost">
                          {t("knowledgeOpenRound")}
                        </Button>
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

              <section className="border-t border-border pt-3">
                <h3 className="mb-1.5 text-[12px] font-semibold">
                  {t("knowledgeRawFiles")}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t("knowledgeRawCount")
                      .replace("{total}", String(snapshot.rawFiles.length))
                      .replace("{pending}", String(pending.length))}
                  </span>
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
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
                        <span className="w-[62px] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                          {formatBytes(file.bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {usage !== undefined && usage.rounds > 0 && (
                <p className="border-t border-border px-1 pt-3 text-[11px] leading-5 text-muted-foreground">
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
            </div>
          </details>
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
}: {
  active: string;
  busy: boolean;
  names: readonly string[];
  onCreate: () => void;
  onRemove: () => void;
  onReveal: () => void;
  onSelect: (name: string) => void;
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
