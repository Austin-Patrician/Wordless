import { memo, useMemo } from "react";
import type { DesignStyleSummaryDto } from "@wordless/protocol";
import { parseThemeTokens, resolveTokens, withAlpha } from "./style-tokens.ts";

/**
 * 一张风格卡。
 *
 * 缩略图是**用该风格自己的令牌画出来的一张通用产品界面** —— 顶栏、侧栏、统计卡、主按钮、
 * 列表行。所有颜色与圆角都取自它的 `theme.css`(单一真源),Tailwind 只负责布局,动态值
 * 走 inline style(运行期拼出来的类名 Tailwind 扫不到)。
 *
 * 为什么不用真实渲染的 demo:一份 demo 是一个 iframe 加一份完整文档,一屏几十张连排光解析
 * 就能把滚动拖住。参考实现的做法是"静态只铺色板,悬停到哪张才换真 demo"—— 这里先只做前半
 * 步,色板已经足以让人分辨"哪套更圆、更亮、更密",而**分辨率这件事本来就不该靠一屏缩略图
 * 来决定**。
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
  style,
  picked,
  onPick,
}: {
  style: DesignStyleCardData;
  picked: boolean;
  onPick: (style: DesignStyleCardData) => void;
}) {
  const tokens = useMemo(() => resolveTokens(parseThemeTokens(style.themeCss)), [style.themeCss]);

  return (
    <button
      aria-label={`用「${style.name}」新建设计`}
      aria-pressed={picked}
      className={`flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-xl border p-2.5 text-left outline-none transition-colors ${
        picked
          ? "border-[#4f7df3] bg-[#f6faff] dark:border-[#4f7df3] dark:bg-[#293441]"
          : "border-[#e2e4e6] bg-white hover:border-[#c9ccc8] dark:border-[#3b3e41] dark:bg-[#202225] dark:hover:border-[#4a4e52]"
      }`}
      onClick={() => onPick(style)}
      title={style.tagline}
      type="button"
    >
      <Miniature tokens={tokens} />
      <div className="flex min-w-0 items-center gap-1.5 px-0.5">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full border ${
            style.vibe === "dark" ? "border-[#6b7075] bg-[#181912]" : "border-[#d8dad6] bg-white"
          }`}
        />
        <span className="min-w-0 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">
          {style.name}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 rounded-full bg-[#f2f3f2] px-1.5 py-px text-[10px] text-[#6b7075] dark:bg-[#292b2e] dark:text-[#a5abb0]">
          {style.category}
        </span>
      </div>
      <div className="min-w-0 truncate px-0.5 text-[11px] leading-tight text-[#8a8f94] dark:text-[#9fa5ab]">
        {style.tagline}
      </div>
    </button>
  );
});

type Tokens = ReturnType<typeof resolveTokens>;

/**
 * 缩略图:一张通用产品界面。
 *
 * 画的是**同一张**界面,只是换令牌 —— 于是差异全部来自风格本身,而不是来自我给它配了不同的
 * 内容。这也是为什么它叫"缩略图"而不是"示例页"。
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
