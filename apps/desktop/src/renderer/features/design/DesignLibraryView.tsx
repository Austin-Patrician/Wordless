import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, LoaderCircle, PenTool, Plus } from "lucide-react";
import type { DesignStyleSummaryDto, DesignSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { DesignStyleCard, type DesignStyleCardData } from "./DesignStyleCard.tsx";
import { filterDesigns, sortDesigns, type DesignSortMode } from "./design-recency.ts";
import { DesignListToolbar } from "./DesignListToolbar.tsx";
import { useDesignCovers } from "./use-design-covers.ts";
import { DesignCardSkeleton } from "./DesignCardSkeleton.tsx";
import { DesignCard } from "./DesignCard.tsx";
import { DesignStyleDetailDialog } from "./DesignStyleDetailDialog.tsx";
import { designLibrarySources, type DesignLibrarySource } from "./design-library-sources.ts";
import { designStyleCopy } from "./style-copy.ts";
import {
  STYLE_GRID_MAX_COLUMNS,
  styleGridMetrics,
  styleGridPadding,
  styleGridRenderWindow,
  styleGridWindow,
} from "./style-grid.ts";

/**
 * 设计画廊。
 *
 * 两块,顺序有讲究:
 *
 * 1. **我的设计** —— 用户已有的设计。放在最上面,因为"继续昨天那份"比"从零开始"更常见。
 * 2. **内置风格** —— 挑一套风格直接开一份新的。
 *
 * 为什么风格要摆成一个铺开的墙、而不是一个下拉框:参考实现那段注释说得对 —— 选风格是这条路
 * 上最容易被省略的一步,多数人根本不知道有这一步,于是每份设计都长成模型的默认审美。下拉框
 * 要求用户先知道自己在找什么;**铺开才看得见全貌**。所以向下无限延伸,不做横向翻页。
 *
 * 两处为滚动做的取舍(与参考实现同构):
 * - **按行窗口化**,只渲染视口附近的几行;几何算在 `style-grid.ts` 里,因为那几处取整错了
 *   会让滚动时卡片错列,而在浏览器里极难复现。
 * - **缩略图只用令牌画**,不挂真实渲染的 demo —— 一屏几十张,每张一个文档光解析就能把滚动
 *   拖住。
 */
export function DesignLibraryView({
  onOpenSession,
}: {
  /**
   * 打开某个设计会话。会话来源的设计**只能**这么打开:它住在那个会话的私有根里,没有会话就
   * 没有那份设计(见 `design-library-sources.ts`)。
   *
   * 不给就只是列出来、点不动 —— 与工作区来源的条目一样。
   */
  onOpenSession?: (sessionId: string) => void;
}) {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  /** 正在跑的会话。会话来源的设计据此显示「正在改」—— agent 改的就是这些。 */
  // 快照里是数组(它要过 IPC),这里包成 Set —— `has` 在渲染里被问几十次。
  const runningSessionIds = useMemo<ReadonlySet<string>>(
    () => new Set(snapshot?.runningSessionIds ?? []),
    [snapshot?.runningSessionIds],
  );
  const { t } = usePreferences();

  /**
   * 该扫哪些根。**两种来源**:用户的工作区,以及没选工作区的设计会话(它们的包住在自己的
   * 私有根里)。从前这里只取第一个可用工作区,于是后者产出的设计在画布上看得到、在这页里
   * 却不存在。
   */
  const sources = useMemo(
    () => designLibrarySources({ sessions: snapshot?.sessions, workspaces: snapshot?.workspaces }),
    [snapshot?.sessions, snapshot?.workspaces],
  );
  /**
   * 重扫的**唯一**开关是这串 key,而不是 `sources` 这个数组。
   *
   * 快照每来一个事件(agent 一边输出就一直在来)都会换掉 `sessions` 的引用,于是 `sources` 每次
   * 都是新数组;拿它当 effect 依赖,这页会在每一条流式事件上重扫全部根。字符串比出来的才是
   * "根真的变了没有" —— 新建/删除会话、增删工作区。
   */
  const sourceKey = useMemo(() => sources.map((source) => source.key).join("|"), [sources]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  /** 新建设计要落在哪个工作区:第一个可用的 —— 与从前一致(没有工作区就没地方放,见 `create`)。 */
  const createRoot = sources.find((source) => source.kind === "workspace")?.rootPath ?? null;

  const [entries, setEntries] = useState<DesignLibraryEntry[] | null>(null);
  const [styles, setStyles] = useState<DesignStyleSummaryDto[] | null>(null);
  const [pendingStyle, setPendingStyle] = useState<DesignStyleCardData | null>(null);
  /** 正在看详情的风格。点卡片先进详情(示例 + 色板 + 规范目录),从详情里才进命名流程。 */
  const [detailStyle, setDetailStyle] = useState<DesignStyleCardData | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const current = sourcesRef.current;
    setError(null);
    const results = await Promise.all(
      current.map(async (source) => {
        try {
          const designs = await client.listDesigns({ root: source.rootPath });
          return designs.map((design): DesignLibraryEntry => ({ design, source }));
        } catch (reason) {
          // 一个根读不出来不该让整页看起来像坏了;但**全都**读不出来就值得说 —— 那才是真出了问题
          // (一个根都没有不算:那只是还没有工作区、也还没有设计会话,空态会说明)。
          return reason instanceof Error ? reason.message : String(reason);
        }
      }),
    );
    const next: DesignLibraryEntry[] = [];
    const failures: string[] = [];
    for (const result of results) {
      if (Array.isArray(result)) next.push(...result);
      else failures.push(result);
    }
    setEntries(next);
    if (failures.length > 0 && failures.length === current.length) setError(failures[0]!);
  }, [client, sourceKey]);

  useEffect(() => {
    void client
      .listDesignStyles()
      .then(setStyles)
      .catch(() => setStyles([]));
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(async () => {
    if (pendingStyle === null || creating) return;
    const trimmed = name.trim();
    if (trimmed === "") return;
    /**
     * 没有工作区就没地方放包,而这里从前是**静默返回** —— 名字对话框会照常弹出来,点了确认
     * 什么也不发生。说清为什么,比装作没这回事强。
     */
    if (createRoot === null) {
      setError(t("designCreateNeedsWorkspace"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await client.createDesign({ root: createRoot, name: trimmed, styleId: pendingStyle.id });
      setPendingStyle(null);
      setName("");
      await reload();
      if (created === null) {
        setError(t("designCreateFailed"));
      } else if (created.build !== null && !created.build.ok) {
        /**
         * 建包成功、但样式没编出来。
         *
         * **必须说出来**:那种情况下画布上每一帧都是"还没有产物"的占位卡,而用户刚刚看到
         * 的是一句"新建成功" —— 不说的话,他面对的是一个没有解释的空白画布。
         *
         * 后面直接接构建器给的原文,不做措辞润色:那是一句含具体原因的边界错误,改写只会
         * 让它更难查。
         */
        setError(`${t("designBuildFailed")} ${created.build.detail}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  }, [client, createRoot, creating, name, pendingStyle, reload, t]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[#fbfbfa] dark:bg-[#181912]">
      <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
        <header className="flex items-center gap-2">
          <span aria-hidden="true" className="h-4 w-[3px] shrink-0 rounded-full bg-[#afcb54]" />
          <h1 className="text-[15px] font-semibold leading-none tracking-tight text-[#3e3e39] dark:text-foreground">
            {t("designLibraryTitle")}
          </h1>
        </header>
        <p className="mt-1.5 text-[12px] leading-5 text-[#8a8f94] dark:text-[#9fa5ab]">{t("designLibraryHelp")}</p>

        {error !== null ? (
          <p className="mt-3 rounded-lg bg-[#fff6f6] px-3 py-2 text-[11px] text-[#a44] dark:bg-[#2a1d1d]">{error}</p>
        ) : null}

        <MyDesigns
          entries={entries}
          onOpenSession={onOpenSession}
          runningSessionIds={runningSessionIds}
          styles={styles}
        />
        <StyleWall
          bridge={client}
          onPick={setDetailStyle}
          pendingStyle={pendingStyle}
          styles={styles}
        />
      </div>

      {detailStyle !== null ? (
        <DesignStyleDetailDialog
          bridge={client}
          onClose={() => setDetailStyle(null)}
          onUse={(style) => {
            // 从详情进命名流程:详情收起,名字对话框出来。
            setDetailStyle(null);
            setPendingStyle(style);
            setName("");
          }}
          style={detailStyle}
        />
      ) : null}

      {pendingStyle !== null ? (
        <StyleNameDialog
          creating={creating}
          name={name}
          onCancel={() => setPendingStyle(null)}
          onChange={setName}
          onConfirm={() => void create()}
          style={pendingStyle}
        />
      ) : null}
    </section>
  );
}

/**
 * 筛与排读的字段。
 *
 * 来源那一行在界面上是「工作区 · My project」这种样子,而搜索要匹配的是**它的名字**(用户找的是
 * "那个会话里的设计")—— 所以这里给的是 `source.name`,不是拼好的那一行。
 */
function listFields(entry: DesignLibraryEntry): {
  frameCount: number;
  name: string;
  source: string;
  updatedAt: number;
} {
  return {
    frameCount: entry.design.frameCount,
    name: entry.design.name,
    source: entry.source.name,
    updatedAt: entry.design.updatedAt,
  };
}

/** 一份设计 + 它住的那个根。**来源要跟着走**:列表要标出来,打开方式也由它决定。 */
interface DesignLibraryEntry {
  design: DesignSummaryDto;
  source: DesignLibrarySource;
}

function MyDesigns({
  entries,
  onOpenSession,
  runningSessionIds,
  styles,
}: {
  entries: DesignLibraryEntry[] | null;
  onOpenSession?: (sessionId: string) => void;
  /** 正在跑的会话:会话来源的设计据此显示「正在改」。 */
  runningSessionIds: ReadonlySet<string>;
  /** 风格目录:只为取每份设计的底色(见 `designAccent`)。还没到货时是 null。 */
  styles: readonly DesignStyleSummaryDto[] | null;
}) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DesignSortMode>("recent");

  /**
   * 筛与排。默认"最近改动的在前" —— 回到这一页最常要的就是"我刚弄过的那份"。
   *
   * 搜索匹配**名字与来源**:「那个会话里的设计」和「叫什么名」是两个真实的问题,而它们在界面上
   * 就是同一句话。规则是子串匹配(见 `filterDesigns`),不做模糊 —— 用户猜不到为什么某一份没出来
   * 比"少命中一条"更糟。
   */
  const visible = useMemo(() => {
    if (entries === null) return null;
    return sortDesigns(filterDesigns(entries, query, listFields), sort, listFields);
  }, [entries, query, sort]);

  const styleById = useMemo(() => new Map((styles ?? []).map((style) => [style.id, style])), [styles]);
  /**
   * 封面:本机缓存里的那张图。
   *
   * 只有**在这台机器上打开过**的设计才有(画布打开它时顺手存的,见 `use-design-cover`)—— 没有
   * 就是没有,卡片用主色块兜底。这一页**不为封面做任何光栅**:那是几十个隐藏窗口。
   */
  const covers = useDesignCovers(entries);
  const grid = 'mt-3 grid gap-3';
  const gridStyle = { gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" } as const;

  return (
    <div className="mt-8">
      <h2 className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{t("designMineTitle")}</h2>
      {visible === null ? (
        // 骨架卡,而不是一行字:列表马上就是同样的格子,先用空壳占住位置,内容到货时不跳版。
        <div className={grid} style={gridStyle}>
          {[0, 1, 2, 3].map((index) => (
            <DesignCardSkeleton key={index} />
          ))}
        </div>
      ) : entries !== null && entries.length === 0 ? (
        // 一份都没有:这时不摆筛排条 —— 没有东西可搜,它只是噪声。
        <div className="mt-3 rounded-xl border border-dashed border-[#e2e4e6] px-5 py-8 text-center dark:border-[#3b3e41]">
          <FrameIcon className="mx-auto size-4 text-[#b3b8bd]" />
          <p className="mt-2 text-[12px] text-[#8a8f94]">{t("designMineEmpty")}</p>
          <p className="mt-1 text-[11px] text-[#a8adb2]">{t("designMineEmptyHelp")}</p>
        </div>
      ) : (
        <>
          <DesignListToolbar
            matched={visible.length}
            onQueryChange={setQuery}
            onSortChange={setSort}
            query={query}
            sort={sort}
            total={entries?.length ?? 0}
          />
          {visible.length === 0 ? (
            /*
              搜不到与"一份都没有"是两件事:前者要说清筛掉了多少(计数在筛排条上),并给一个
              **一键清掉关键词**的出口 —— 否则用户只能自己回到输入框里删。
            */
            <div className="mt-3 rounded-xl border border-dashed border-[#e2e4e6] px-5 py-8 text-center dark:border-[#3b3e41]">
              <p className="text-[12px] text-[#8a8f94]">{t("designSearchEmpty")}</p>
              <button
                className="mt-2 rounded-lg border border-[#e2e4e6] px-2 py-1 text-[11px] text-[#55575b] hover:bg-[#f2f3f2] dark:border-[#3b3e41] dark:text-muted-foreground dark:hover:bg-muted"
                onClick={() => setQuery("")}
                type="button"
              >
                {t("designSearchClear")}
              </button>
            </div>
          ) : (
            <div className={grid} style={gridStyle}>
              {visible.map(({ design, source }) => {
              /*
                会话来源的设计住在那个会话的私有根里 —— **打开它就是打开那个会话**,没有别的入口。
                工作区来源的还没有这条路:它需要"新建一个该工作区的会话,并让画布打开**这一份**",
                那是两处新机制(见下面的注释),所以它今天仍然是静态卡。
              */
              const openable = source.kind === "session" && onOpenSession !== undefined;
              return (
                <DesignCard
                  cover={covers.get(design.path) ?? null}
                  design={design}
                  key={`${source.key}:${design.id}`}
                  onOpen={openable ? () => onOpenSession(source.sessionId) : undefined}
                  running={source.kind === "session" && runningSessionIds.has(source.sessionId)}
                  sourceLabel={`${
                    source.kind === "workspace" ? t("designSourceWorkspace") : t("designSourceSession")
                  } · ${source.name}`}
                  style={design.style === null ? null : styleById.get(design.style)}
                />
              );
            })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 风格墙。窗口化的几何全在 `style-grid.ts`。
 *
 * **没有分类筛选**,这是有意的:风格墙是视觉选择器,缩略图本身就是索引 —— 哪套更圆、更亮、更密
 * 一眼可辨,而"某套属于哪一类"不是用户会问的问题。29 套铺开就是三四屏,一口气看得完(§14.17)。
 */
function StyleWall({
  bridge,
  onPick,
  pendingStyle,
  styles,
}: {
  bridge: DesktopBridge;
  onPick: (style: DesignStyleCardData) => void;
  pendingStyle: DesignStyleCardData | null;
  styles: DesignStyleSummaryDto[] | null;
}) {
  const { t } = usePreferences();
  const wall = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ start: 0, end: STYLE_GRID_MAX_COLUMNS * 3 });
  const rangeRef = useRef(range);
  const frameRef = useRef(0);

  const metrics = useMemo(() => styleGridMetrics(width), [width]);
  const total = styles?.length ?? 0;

  useLayoutEffect(() => {
    const node = wall.current;
    if (node === null) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 滚动的是外层那个容器,这里够不着它,所以在 window 上用捕获阶段收所有祖先的滚动事件,
  // 位置一律用 rect 相对视口重算。事件合到下一帧:滚动事件的密度远高于帧率。
  useEffect(() => {
    const sync = () => {
      const node = wall.current;
      if (node === null || metrics.rowHeight <= 0) return;
      const next = styleGridWindow({
        scrolledPast: -node.getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
        metrics,
        total,
      });
      const current = rangeRef.current;
      // 窗口没变就不进 React —— 否则每个滚动事件都要把整面墙重渲一次。
      if (next.start === current.start && next.end === current.end) return;
      rangeRef.current = next;
      setRange(next);
    };
    const onScroll = () => {
      if (frameRef.current !== 0) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        sync();
      });
    };
    sync();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [metrics, total]);

  /**
   * 渲染窗口。`range` 是滚动时算出来存下的,它可能已经过期(尺寸变了、列表变了),所以这里经过
   * `styleGridRenderWindow` 按当前总数收一次 —— 这两行 clamp 原来写在组件里,现在归纯函数管,
   * 因为"窗口落在哪"本来就是算术,而它错起来是"渲染出空的一位或半行"。
   */
  // 不要叫 window:上面那个滚动 effect 里用的是真的 `window`。
  const renderWindow = styleGridRenderWindow({ range, metrics, total });
  const visible = (styles ?? []).slice(renderWindow.start, renderWindow.end);
  const padding = styleGridPadding({ window: renderWindow, metrics, total });

  return (
    <div className="mt-10" ref={wall} style={{ paddingTop: padding.top, paddingBottom: padding.bottom }}>
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{t("designStylesTitle")}</h2>
        {total > 0 ? (
          // 计数进标题:29 套这件事得先说出来,否则用户以为墙上就这些。
          <span className="shrink-0 rounded-full bg-[#f2f3f2] px-2 py-px text-[10px] tabular-nums text-[#6b7075] dark:bg-[#292b2e] dark:text-[#a5abb0]">
            {t("designStylesCountAll").replace("{count}", String(total))}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-[#8a8f94] dark:text-[#9fa5ab]">{t("designStylesHelp")}</p>
      {styles === null ? (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[#8a8f94]">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("designLibraryLoading")}
        </div>
      ) : (
        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))` }}>
          {visible.map((style) => (
            <DesignStyleCard
              bridge={bridge}
              key={style.id}
              onPick={onPick}
              picked={pendingStyle?.id === style.id}
              style={style}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 选定风格后问一个名字。用对话框而不是直接落盘:没起名字的设计在列表里认不出来。 */
function StyleNameDialog({
  creating,
  name,
  onCancel,
  onChange,
  onConfirm,
  style,
}: {
  creating: boolean;
  name: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  style: DesignStyleCardData;
}) {
  const { t } = usePreferences();
  const copy = designStyleCopy(style, t);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/20 p-4" onClick={onCancel} role="presentation">
      <div
        className="w-[min(26rem,calc(100vw-2rem))] rounded-[10px] border border-[#e2e4e6] bg-white p-4 shadow-lg dark:border-[#3b3e41] dark:bg-[#202225]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">
          {t("designNameTitle").replace("{style}", copy.name)}
        </p>
        <input
          aria-label={t("designNameField")}
          autoFocus
          className="mt-3 h-9 w-full rounded-lg border border-[#e2e4e6] bg-white px-3 text-[12px] outline-none focus:border-[#c9ccc8] dark:border-[#3b3e41] dark:bg-[#1b1c19]"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
            if (event.key === "Escape") onCancel();
          }}
          placeholder={t("designNamePlaceholder")}
          value={name}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="h-8 rounded-lg border border-[#e2e4e6] px-3 text-[12px] hover:bg-[#f6f7f6] dark:border-[#3b3e41] dark:hover:bg-[#292b2e]"
            onClick={onCancel}
            type="button"
          >
            {t("webhookCancel")}
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-lg bg-[#afcb54] px-3 text-[12px] font-medium text-[#2b3308] disabled:opacity-45"
            disabled={creating || name.trim() === ""}
            onClick={onConfirm}
            type="button"
          >
            {creating ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Plus className="size-3.5" />}
            {t("designNameCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}


/** 空集合的稳定引用:没有快照时不要每次渲染都新建一个 Set。 */
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();