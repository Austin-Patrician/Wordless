import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, LoaderCircle, PenTool, Plus } from "lucide-react";
import type { DesignStyleSummaryDto, DesignSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { DesignStyleCard, type DesignStyleCardData } from "./DesignStyleCard.tsx";
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

        <MyDesigns entries={entries} onOpenSession={onOpenSession} />
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

/** 一份设计 + 它住的那个根。**来源要跟着走**:列表要标出来,打开方式也由它决定。 */
interface DesignLibraryEntry {
  design: DesignSummaryDto;
  source: DesignLibrarySource;
}

function MyDesigns({
  entries,
  onOpenSession,
}: {
  entries: DesignLibraryEntry[] | null;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = usePreferences();
  return (
    <div className="mt-8">
      <h2 className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{t("designMineTitle")}</h2>
      {entries === null ? (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[#8a8f94]">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("designLibraryLoading")}
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[#e2e4e6] px-5 py-8 text-center dark:border-[#3b3e41]">
          <FrameIcon className="mx-auto size-4 text-[#b3b8bd]" />
          <p className="mt-2 text-[12px] text-[#8a8f94]">{t("designMineEmpty")}</p>
          <p className="mt-1 text-[11px] text-[#a8adb2]">{t("designMineEmptyHelp")}</p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {entries.map(({ design, source }) => {
            // 会话来源的设计住在那个会话的私有根里 —— **打开它就是打开那个会话**,没有别的入口
            // (设计包里没有"路径"这个概念给用户用)。工作区来源的没有会话可切,所以今天只列不点。
            const openable = source.kind === "session" && onOpenSession !== undefined;
            const body = (
              <>
                <PenTool className="size-3.5 shrink-0 text-[#8a8f94]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[#3e3e39] dark:text-foreground">
                    {design.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#a8adb2]">
                    {source.kind === "workspace" ? t("designSourceWorkspace") : t("designSourceSession")} ·{" "}
                    {source.name}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-[#a8adb2]">
                  {t("designFrameCount").replace("{count}", String(design.frameCount))}
                </span>
              </>
            );
            const shell =
              "flex items-center gap-2 rounded-xl border border-[#e2e4e6] bg-white px-3 py-2.5 dark:border-[#3b3e41] dark:bg-[#202225]";
            return openable ? (
              <button
                className={`${shell} text-left transition-colors hover:border-[#c9ccc8] hover:bg-[#f7f7f4] dark:hover:border-[#4a4e52] dark:hover:bg-[#26282b]`}
                data-design-card={design.name}
                key={`${source.key}:${design.id}`}
                onClick={() => onOpenSession(source.sessionId)}
                title={t("designOpenSession")}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div className={shell} data-design-card={design.name} key={`${source.key}:${design.id}`}>
                {body}
              </div>
            );
          })}
        </div>
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
