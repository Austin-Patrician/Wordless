import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, LoaderCircle, PenTool, Plus } from "lucide-react";
import type { DesignStyleSummaryDto, DesignSummaryDto } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { DesignStyleCard, type DesignStyleCardData } from "./DesignStyleCard.tsx";
import { STYLE_GRID_MAX_COLUMNS, styleGridMetrics, styleGridPadding, styleGridWindow } from "./style-grid.ts";

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
export function DesignLibraryView() {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const { t } = usePreferences();

  // 设计包住在工作区里,所以需要一个工作区根。取第一个可用的:画廊是"全部设计"的视图,
  // 不属于某一次会话。
  const root = useMemo(
    () => snapshot?.workspaces.find((workspace) => workspace.availability === "available")?.rootPath ?? null,
    [snapshot?.workspaces],
  );

  const [designs, setDesigns] = useState<DesignSummaryDto[] | null>(null);
  const [styles, setStyles] = useState<DesignStyleSummaryDto[] | null>(null);
  const [pendingStyle, setPendingStyle] = useState<DesignStyleCardData | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (root === null) {
      setDesigns([]);
      return;
    }
    setError(null);
    try {
      setDesigns(await client.listDesigns({ root }));
    } catch (reason) {
      setDesigns([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [client, root]);

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
    if (pendingStyle === null || root === null || creating) return;
    const trimmed = name.trim();
    if (trimmed === "") return;
    setCreating(true);
    setError(null);
    try {
      const created = await client.createDesign({ root, name: trimmed, styleId: pendingStyle.id });
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
  }, [client, creating, name, pendingStyle, reload, root, t]);

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

        <MyDesigns designs={designs} />
        <StyleWall
          onPick={(style) => {
            setPendingStyle(style);
            setName("");
          }}
          pendingStyle={pendingStyle}
          styles={styles}
        />
      </div>

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

function MyDesigns({ designs }: { designs: DesignSummaryDto[] | null }) {
  const { t } = usePreferences();
  return (
    <div className="mt-8">
      <h2 className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{t("designMineTitle")}</h2>
      {designs === null ? (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[#8a8f94]">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("designLibraryLoading")}
        </div>
      ) : designs.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[#e2e4e6] px-5 py-8 text-center dark:border-[#3b3e41]">
          <FrameIcon className="mx-auto size-4 text-[#b3b8bd]" />
          <p className="mt-2 text-[12px] text-[#8a8f94]">{t("designMineEmpty")}</p>
          <p className="mt-1 text-[11px] text-[#a8adb2]">{t("designMineEmptyHelp")}</p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {designs.map((design) => (
            <div
              className="flex items-center gap-2 rounded-xl border border-[#e2e4e6] bg-white px-3 py-2.5 dark:border-[#3b3e41] dark:bg-[#202225]"
              key={design.id}
            >
              <PenTool className="size-3.5 shrink-0 text-[#8a8f94]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#3e3e39] dark:text-foreground">
                {design.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#a8adb2]">
                {t("designFrameCount").replace("{count}", String(design.frameCount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 风格墙。窗口化的几何全在 `style-grid.ts`。 */
function StyleWall({
  onPick,
  pendingStyle,
  styles,
}: {
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

  // 还没量出行高时先整份铺上:这一帧算不出窗口,宁可多画也不能留白一屏。
  const windowed = metrics.rowHeight > 0;
  const start = windowed ? Math.min(range.start, Math.max(0, total - 1)) : 0;
  const end = windowed ? Math.max(range.end, Math.min(total, start + metrics.columns)) : total;
  const visible = (styles ?? []).slice(start, end);
  const padding = styleGridPadding({ window: { start, end }, metrics, total });

  return (
    <div className="mt-10" ref={wall} style={{ paddingTop: padding.top, paddingBottom: padding.bottom }}>
      <h2 className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{t("designStylesTitle")}</h2>
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
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/20 p-4" onClick={onCancel} role="presentation">
      <div
        className="w-[min(26rem,calc(100vw-2rem))] rounded-[10px] border border-[#e2e4e6] bg-white p-4 shadow-lg dark:border-[#3b3e41] dark:bg-[#202225]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">
          {t("designNameTitle").replace("{style}", style.name)}
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
