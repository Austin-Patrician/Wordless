import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { DesignStyleSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { DesignStyleCard } from "./DesignStyleCard.tsx";
import { designStyleCopy } from "./style-copy.ts";

/**
 * 新建页「Create」那一栏的风格胶片:横着一条,每张卡是**该风格的真示例页**。
 *
 * ## 为什么不给下拉框
 *
 * 选风格是这条路上最容易被跳过的一步 —— 用户不知道有这个选项,于是每份设计都长成模型的默认
 * 审美。而下拉框还要求用户**先知道自己在找什么**。铺开(哪怕是横着一条)才看得见有什么。
 *
 * ## 横向,但**不能让人以为"就这几张"**
 *
 * 风格墙那边刻意做的是竖着无限延伸(§14.7),理由是横向翻页会让用户不知道右边还有。这里是
 * **启动栏**:下面是输入框,竖着铺 29 张会把输入框顶出屏幕。所以折中是:让右边**露半张**、
 * 标题旁写清总数、卡片可键盘遍历。一眼看得到"还有",也不占掉输入框的位置。
 *
 * ## 头一张是「由 agent 自己定」
 *
 * 不指定风格是一个**看得见的选项**,而不是"什么都没选"这种要靠猜的状态(参考实现里那张卡叫
 * 「不使用设计系统」)。它也是默认值:不动它就是现在的行为,一行都不变。
 */
export interface DesignStyleLaunchStripProps {
  bridge: DesktopBridge;
  /** 选中的风格 id;`null` = 由 agent 自己定。 */
  selected: string | null;
  onSelect: (styleId: string | null) => void;
  /**
   * 没有工作区时不给选。
   *
   * 资料要落进工作区(`design-resources/<id>/`),而设计包本身也住在工作区里 —— 没有工作区的
   * 会话根本落不下这些文件,与其静默失效,不如说清为什么。
   */
  workspaceReady: boolean;
}

export function DesignStyleLaunchStrip({
  bridge,
  selected,
  onSelect,
  workspaceReady,
}: DesignStyleLaunchStripProps) {
  const { t } = usePreferences();
  const [styles, setStyles] = useState<DesignStyleSummaryDto[] | null>(null);

  useEffect(() => {
    let active = true;
    void bridge
      .listDesignStyles()
      .then((found) => {
        if (active) setStyles(found);
      })
      .catch(() => {
        if (active) setStyles([]);
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  // 目录还没到货:不占位、不闪 —— 这一栏是加法,晚一帧出现不影响任何事。
  if (styles === null || styles.length === 0) return null;

  const anyCopy = { name: t("designStyleLaunchAny"), tagline: t("designStyleLaunchAnyHint") };

  return (
    <section className="mb-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 text-[11px] font-semibold text-[#464641] dark:text-foreground">
          {t("designStyleLaunchTitle")}
        </h2>
        <span className="shrink-0 tabular-nums text-[10px] text-[#8a8f94] dark:text-muted-foreground">
          {t("designStylesCountAll").replace("{count}", String(styles.length))}
        </span>
        {workspaceReady ? null : (
          <span className="min-w-0 truncate text-[10px] text-[#b06a3b] dark:text-[#d29a6a]">
            {t("designStyleLaunchNeedWorkspace")}
          </span>
        )}
      </div>

      {/*
        横向滚动 + 露半张:`pr-8` 让最后一张之后也留出余量,右侧那半张卡就是"还有"的信号。
        不用箭头按钮 —— 那会把一条本来很安静的东西变成一排控件。
      */}
      <div className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        <button
          aria-pressed={selected === null}
          className={`flex w-[132px] shrink-0 snap-start flex-col items-center justify-center gap-1.5 rounded-xl border px-3 text-center transition-colors ${
            selected === null
              ? "border-[#4f7df3] bg-[#f6faff] dark:border-[#4f7df3] dark:bg-[#293441]"
              : "border-[#e4e4e0] bg-white hover:border-[#c9ccc8] dark:border-border dark:bg-[#1c1d18] dark:hover:border-[#4a4e52]"
          }`}
          disabled={!workspaceReady}
          onClick={() => onSelect(null)}
          title={anyCopy.tagline}
          type="button"
        >
          <Sparkles aria-hidden className="size-4 text-[#8a8f94] dark:text-muted-foreground" />
          <span className="text-[11px] font-semibold text-[#3e3e39] dark:text-foreground">{anyCopy.name}</span>
        </button>

        {styles.map((style) => (
          <div className="w-[198px] shrink-0 snap-start" key={style.id}>
            <DesignStyleCard
              actionLabel={t("designStyleLaunchPick")}
              bridge={bridge}
              onPick={() => (!workspaceReady ? undefined : onSelect(style.id))}
              picked={selected === style.id}
              style={style}
            />
          </div>
        ))}

        <span aria-hidden className="w-6 shrink-0" />
      </div>

      {/* 选中了哪套要说出来:卡上的缩略图小,而这一栏滚过之后看不到标题。 */}
      {selected === null ? null : (
        <p className="mt-1.5 text-[11px] text-[#55575b] dark:text-muted-foreground">
          {t("designStyleLaunchSelected").replace(
            "{name}",
            designStyleCopy(styles.find((style) => style.id === selected) ?? styles[0]!, t).name,
          )}
        </p>
      )}
    </section>
  );
}
