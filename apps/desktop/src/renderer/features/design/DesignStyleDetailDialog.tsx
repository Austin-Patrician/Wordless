import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { DesignStyleSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { useBrowserOcclusion } from "../browser/use-occlusion";
import { designStyleCopy } from "./style-copy.ts";
import { StyleDemo, useDesignStyleDetail } from "./StyleDemo.tsx";
import { parseThemeTokens } from "./style-tokens.ts";

/**
 * 一套风格的详情:示例页 + 色板 + 规范目录,右下角一条主按钮。
 *
 * ## 为什么详情是必需的一步
 *
 * 一张卡只能铺一张图,而"选哪套"要回答的是三个问题:长什么样(示例)、**色板是哪些**(色彩系统)、
 * 规范说了什么(规范目录)。卡片回答不了后两个。
 *
 * ## 三块内容的来源,不新造真相
 *
 * - **示例**:`demoHtml`,自包含整页,进 `sandbox` 的 iframe,常开自动滚动 —— 详情页是唯一
 *   值得让示例一直"活着"的地方(卡片上悬停才换、且不滚动)。
 * - **色板**:直接解析这套自己的 `theme.css`(`themeCss` 早就在列表 DTO 里,卡片画缩略图用的
 *   就是它)。**不另存一份颜色表** —— 那是第二份真相,而它一定会漂开。
 * - **规范目录**:`DESIGN.md` 里的 `## ` 标题。只列目录不贴全文:规范是给 agent 读的,用户要
 *   知道的是"这套有没有把间距、层级、组件讲清楚"。
 *
 * ## 色板上的名字用 token 名,不翻译
 *
 * `primary` / `surface-raised` 这些是**写进 `theme.css` 的标识符**,agent 与用户用它对话;把它
 * 译成"主色"反而对不上文件。值(十六进制)照原样给出,点一下能看全。
 */
export function DesignStyleDetailDialog({
  bridge,
  onClose,
  onUse,
  style,
}: {
  bridge: DesktopBridge;
  onClose: () => void;
  /** 「用这套」:由调用方接管后续(问名字 → 建包 / 应用)。 */
  onUse: (style: DesignStyleSummaryDto) => void;
  style: DesignStyleSummaryDto;
}) {
  const { t } = usePreferences();
  const copy = designStyleCopy(style, t);
  // 详情一打开就取:示例与规范目录都要它。
  const { detail } = useDesignStyleDetail(bridge, style.id, true);
  const [busy, setBusy] = useState(false);

  useBrowserOcclusion(true, "dialog");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  /** 色板顺序固定:先说主色,再说表面,最后是状态色 —— 与规范里 Color roles 一节的讲法一致。 */
  const palette = useMemo(() => {
    const { colors } = parseThemeTokens(style.themeCss);
    return ["primary", "primary-foreground", "accent", "surface", "surface-raised", "surface-foreground", "muted", "border"]
      .filter((name) => colors[name] !== undefined)
      .map((name) => ({ name, value: colors[name] }));
  }, [style.themeCss]);

  const sections = useMemo(() => {
    const source = detail?.designMd ?? "";
    return source
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
  }, [detail?.designMd]);

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onMouseDown={() => !busy && onClose()}
    >
      {/* 里层吃掉 mousedown:点对话框本身不该关掉它。 */}
      <div
        aria-label={copy.name}
        className="flex max-h-full w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-[#e2e4e6] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.20)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 dark:border-border">
          <span
            aria-hidden="true"
            className={`size-2.5 shrink-0 rounded-full border ${
              style.vibe === "dark" ? "border-[#6b7075] bg-[#181912]" : "border-[#d8dad6] bg-white"
            }`}
          />
          <span className="min-w-0 truncate text-[13px] font-semibold text-[#20201f] dark:text-foreground">{copy.name}</span>
          <span className="shrink-0 rounded-full bg-[#f2f3f2] px-2 py-px text-[10px] text-[#6b7075] dark:bg-[#292b2e] dark:text-[#a5abb0]">
            {copy.category}
          </span>
          <span className="flex-1" />
          <button
            aria-label={t("designStyleClose")}
            className="grid h-7 w-7 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="px-0.5 text-[12px] leading-5 text-[#55575b] dark:text-muted-foreground">{copy.tagline}</p>

          {/*
            示例区:还没取到时留一块灰底并说明,而不是让它塌成 0 高 —— 那块空白会被读成"这套没有
            示例"(§14.17:不留没有说明的空白)。
          */}
          {detail === null ? (
            <div className="mt-3 grid h-[220px] place-items-center rounded-lg border border-dashed border-[#e4e4df] text-[11px] text-[#8a8f94] dark:border-border">
              {t("designStyleDetailLoading")}
            </div>
          ) : (
            <StyleDemo active className="mt-3 h-[320px] rounded-lg border border-[#e4e4df] dark:border-border" html={detail.demoHtml} />
          )}

          {/*
            只给颜色。这一排回答的是"这套的色板长什么样" —— 名字(`primary`、`surface-raised`)是给
            写代码和跟 agent 对话用的标识符,想知道的人把鼠标停上去就有(`title`),而把它印在每个
            色块旁边会把一行色板变成一张表。
          */}
          <div className="mt-4">
            <h3 className="text-[11px] font-medium text-[#8a8f94] dark:text-muted-foreground">{t("designStyleDetailPalette")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {palette.map((entry) => (
                <span
                  className="size-7 shrink-0 rounded-lg border border-black/10 dark:border-white/10"
                  key={entry.name}
                  style={{ background: entry.value }}
                  title={`--color-${entry.name}: ${entry.value}`}
                />
              ))}
            </div>
          </div>

          {sections.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-[11px] font-medium text-[#8a8f94] dark:text-muted-foreground">{t("designStyleDetailSpec")}</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {sections.map((section) => (
                  <li
                    className="rounded-full bg-[#f2f3f2] px-2 py-px text-[10px] text-[#55575b] dark:bg-[#292b2e] dark:text-[#a5abb0]"
                    key={section}
                  >
                    {section}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[#e4e4df] px-3 py-2.5 dark:border-border">
          {/*
            说清"选它会发生什么":令牌与规范会被写进你的设计,第一帧就按它来 —— 而这一步在风格墙
            上只是建一份新设计,不是改建好的(那件事在画布里的体系对话框里做)。
          */}
          <p className="min-w-0 flex-1 truncate text-[11px] text-[#8a8f94] dark:text-muted-foreground">
            {t("designStyleDetailHint")}
          </p>
          <button
            className="h-8 rounded-[6px] px-3 text-[12px] text-[#55575b] hover:bg-[#f2f3f2] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            {t("designStyleClose")}
          </button>
          <button
            className="h-8 rounded-[6px] bg-[#3f6bd6] px-3 text-[12px] font-medium text-white disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onUse(style);
            }}
            type="button"
          >
            {t("designStyleDetailUse")}
          </button>
        </footer>
      </div>
    </div>
  );
}
