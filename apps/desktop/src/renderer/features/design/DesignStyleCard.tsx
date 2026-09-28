import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DesignStyleSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { designStyleActionLabel, designStyleCopy } from "./style-copy.ts";
import { StyleDemo, useDesignStyleDetail } from "./StyleDemo.tsx";
import { parseThemeTokens, resolveTokens, withAlpha } from "./style-tokens.ts";

/**
 * 一张风格卡。
 *
 * 缩略图是**用该风格自己的令牌画出来的一张通用产品界面** —— 顶栏、侧栏、统计卡、主按钮、
 * 列表行。所有颜色与圆角都取自它的 `theme.css`(单一真源),Tailwind 只负责布局,动态值
 * 走 inline style(运行期拼出来的类名 Tailwind 扫不到)。
 *
 * 卡上是**真示例页**:缩略图只是它到货之前的占位。
 *
 * 缩略图是"**同一张**界面换令牌",差异全部来自风格本身 —— 它能分辨"哪套更圆、更亮、更密",却
 * 回答不了这套到底长什么样,而后者才是用户选不选得出来的依据。所以这一轮把示例页放了上来。
 *
 * 代价由窗口化兜住:整面墙只有**可见的那几张**真的挂了 iframe,而不是 29 张(参考实现不窗口化,
 * 所以它只能"悬停到哪张才换那一张")。
 *
 * `memo` 是使用前提:这是几十个带 inline style 的节点,挂在画廊墙上,外层任何一次状态变化
 * (悬停哪张、尺寸变化)都会把它们全部重建。props 只有稳定引用的 `style` 与常量 `className`,
 * 浅比较足够。
 */

/**
 * 卡片的入参就是主进程送来的 DTO —— 渲染层不 import 能力实现,只认序列化契约。
 * 那也意味着"卡片能画"与"目录里有什么"之间没有隐式的包依赖。
 */
export type DesignStyleCardData = DesignStyleSummaryDto;

export const DesignStyleCard = memo(function DesignStyleCard({
  actionLabel,
  bridge,
  style,
  picked,
  onPick,
}: {
  /** 动作名。画廊是"用这套新建设计",设计体系对话框是"应用这套" —— 同一张卡片,两种意图。 */
  actionLabel?: string;
  /** 取示例页用。不给就只画缩略图(测试与不关心预览的地方不必提供)。 */
  bridge?: DesktopBridge;
  style: DesignStyleCardData;
  picked: boolean;
  onPick: (style: DesignStyleCardData) => void;
}) {
  const tokens = useMemo(() => resolveTokens(parseThemeTokens(style.themeCss)), [style.themeCss]);
  const { t } = usePreferences();
  // 名字/一句话/分类在 DTO 里是兜底值与 key,给人看的那份按当前语言从 i18n 取。
  const copy = designStyleCopy(style, t);
  /*
    一挂上来就取示例,不等悬停:"哪套更圆、更亮、更密"缩略图能答,"这套长什么样"只有示例能答,
    要用户在二十几张卡之间挨个悬停一遍才算看过,等于没给。

    但**进视口才取**:墙是窗口化的所以无所谓,而横向胶片里 29 张卡是同时挂着的 —— 一次取 29 份
    示例(每份 20–30KB)纯属浪费,而且会同时建起 29 个文档。
  */
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = cardRef.current;
    if (node === null || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  const { detail } = useDesignStyleDetail(bridge, style.id, inView && style.hasDemo);
  const demoHtml = detail?.demoHtml ?? null;

  return (
    <button
      aria-label={designStyleActionLabel(copy, actionLabel, t)}
      ref={cardRef}
      aria-pressed={picked}
      className={`flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-xl border p-2.5 text-left outline-none transition-colors ${
        picked
          ? "border-[#4f7df3] bg-[#f6faff] dark:border-[#4f7df3] dark:bg-[#293441]"
          : "border-[#e2e4e6] bg-white hover:border-[#c9ccc8] dark:border-[#3b3e41] dark:bg-[#202225] dark:hover:border-[#4a4e52]"
      }`}
      onClick={() => onPick(style)}
      title={copy.tagline}
      type="button"
    >
      {demoHtml === null ? <Miniature tokens={tokens} /> : <StyleDemo className="min-h-0 flex-1 rounded-md" html={demoHtml} />}
      <div className="flex min-w-0 items-center gap-1.5 px-0.5">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full border ${
            style.vibe === "dark" ? "border-[#6b7075] bg-[#181912]" : "border-[#d8dad6] bg-white"
          }`}
        />
        <span className="min-w-0 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">
          {copy.name}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 rounded-full bg-[#f2f3f2] px-1.5 py-px text-[10px] text-[#6b7075] dark:bg-[#292b2e] dark:text-[#a5abb0]">
          {copy.category}
        </span>
      </div>
      <div className="min-w-0 truncate px-0.5 text-[11px] leading-tight text-[#8a8f94] dark:text-[#9fa5ab]">
        {copy.tagline}
      </div>
    </button>
  );
});

type Tokens = ReturnType<typeof resolveTokens>;

/**
 * 缩略图:一张通用产品界面,**示例页到货之前的占位**。
 *
 * 画的是**同一张**界面,只是换令牌 —— 所以它能分辨"哪套更圆、更亮、更密",却回答不了"这套长
 * 什么样"(那是 `demoHtml` 的活)。留着它是因为取示例要一次 IPC:到货之前那块位置得有东西,
 * 而"先闪一张再换一张"比一直显示它更糟。没有示例的风格也靠它撑住(夹具与未来可能的缺例条目)。
 */
const Miniature = memo(function Miniature({ tokens }: { tokens: Tokens }) {
  const { radius } = tokens;
  const border = tokens.border;
  const raised = tokens.surfaceRaised;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex min-h-0 w-full flex-1 select-none flex-col overflow-hidden border"
      style={{ background: tokens.surface, borderColor: border, borderRadius: radius("xl", "8px") }}
    >
      <div
        className="flex h-6 shrink-0 items-center gap-1.5 border-b px-2"
        style={{ background: raised, borderColor: border }}
      >
        <span className="size-1.5 rounded-full" style={{ background: withAlpha(tokens.muted, 45) }} />
        <span className="size-1.5 rounded-full" style={{ background: withAlpha(tokens.muted, 45) }} />
        <div
          className="ml-1 h-3 flex-1 border"
          style={{ background: tokens.surface, borderColor: border, borderRadius: radius("sm", "3px") }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex w-9 shrink-0 flex-col gap-1 border-r p-1.5"
          style={{ background: raised, borderColor: border }}
        >
          <div
            className="h-2.5"
            style={{ background: withAlpha(tokens.primary, 22), borderRadius: radius("sm", "2px") }}
          />
          <div className="h-2.5" style={{ background: withAlpha(tokens.muted, 16), borderRadius: radius("sm", "2px") }} />
          <div className="h-2.5" style={{ background: withAlpha(tokens.muted, 16), borderRadius: radius("sm", "2px") }} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((card) => (
              <div
                className="flex h-7 flex-1 flex-col justify-center gap-1 border px-1.5"
                key={card}
                style={{ background: raised, borderColor: border, borderRadius: radius("md", "4px") }}
              >
                <div
                  className="h-1.5 w-5"
                  style={{ background: withAlpha(tokens.muted, 40), borderRadius: radius("sm", "2px") }}
                />
                <div
                  className="h-2 w-8"
                  style={{ background: tokens.foreground, borderRadius: radius("sm", "2px") }}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-1.5">
            <div
              className="h-4 w-12"
              style={{ background: tokens.primary, borderRadius: radius("md", "4px") }}
            />
            <div
              className="h-4 w-9 border"
              style={{ borderColor: border, borderRadius: radius("md", "4px") }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            {[0, 1, 2].map((row) => (
              <div className="flex items-center gap-1.5" key={row}>
                <div
                  className="h-2 flex-1"
                  style={{ background: withAlpha(tokens.muted, 24), borderRadius: radius("sm", "2px") }}
                />
                <div
                  className="h-2 w-4"
                  style={{ background: withAlpha(tokens.accent, 60), borderRadius: radius("sm", "2px") }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
