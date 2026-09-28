import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DesignOpenedDto, DesignStyleSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { useBrowserOcclusion } from "../browser/use-occlusion";
import { DesignStyleCard } from "./DesignStyleCard.tsx";

/**
 * 设计体系:把一套内置风格应用到**当前这份设计**上。
 *
 * ## 三步,而不是一步
 *
 * 点卡片 → 点底部的「应用「X」」→ 确认。参考实现就是这个节奏,而它每一步都有理由:
 *
 * - **点卡片只是选中。** 卡片铺满一整屏,一点就改会让"看看有什么"变成一次不可撤销的改动。
 * - **底部的应用按钮说出要做的事**("应用「深色精密」"),而不是一个含糊的「确定」。
 * - **确认弹一句具体的后果**:"现有 4 个画框将由 Wordless 按新体系全量重设,耗时较长。" ——
 *   这一步之后会**自动开一轮对话**,那是几十秒到几分钟的事,而"耗时较长"是用户唯一需要知道
 *   的、也是唯一能让他决定现在做不做的事。
 *
 * **必须声明遮挡**:对话框盖在画布上,而原生活体视图永远在最上层 —— 不声明的话,用户看到
 * 一个弹出来却点不到的对话框。这是这条路上最容易漏、也最像"卡死"的一种故障。
 */
export function DesignStyleDialog({
  bridge,
  designPath,
  frameCount,
  onApplied,
  onClose,
}: {
  bridge: DesktopBridge;
  designPath: string;
  /** 画框数量:决定确认弹窗里那句话,也决定要不要重设(零帧没什么可重设的)。 */
  frameCount: number;
  /**
   * 已换好令牌与规范。
   *
   * `reskin: true` 表示**请上层开一轮对话让 agent 全量重设** —— 零帧时为 false,那时没有任何
   * 画框要重设,开一轮对话只会浪费一次往返。
   */
  onApplied: (result: { framesNeedRestyle: boolean; opened: DesignOpenedDto; styleName: string }) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [styles, setStyles] = useState<DesignStyleSummaryDto[] | null>(null);
  const [picked, setPicked] = useState<DesignStyleSummaryDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useBrowserOcclusion(true, "dialog");

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || busy) return;
      // Escape 先收掉确认弹窗,再收对话框 —— 一层一层退。
      if (confirming) setConfirming(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, confirming, onClose]);

  const apply = (style: DesignStyleSummaryDto): void => {
    setBusy(true);
    void bridge
      .applyDesignStyle({ path: designPath, styleId: style.id })
      .then((result) => {
        if (result === null) return;
        onApplied({ framesNeedRestyle: result.framesNeedRestyle, opened: result.opened, styleName: style.name });
        onClose();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  /** 零帧:没有画框要重设,直接换令牌,不问也不开对话。 */
  const confirm = (): void => {
    if (picked === null) return;
    if (frameCount === 0) {
      apply(picked);
      return;
    }
    setConfirming(true);
  };

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={() => !busy && onClose()}>
      {/* 里层吃掉 mousedown:点对话框本身不该关掉它。 */}
      <div
        className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-[#e2e4e6] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.20)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#e4e4df] px-3 dark:border-border">
          <span className="text-[13px] font-semibold text-[#20201f] dark:text-foreground">{t("designStyleDialogTitle")}</span>
          <button
            aria-label={t("designStyleClose")}
            className="grid h-7 w-7 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <p className="shrink-0 border-b border-[#e4e4df] px-3 py-2 text-[11px] leading-5 text-[#8a8f94] dark:border-border">
          {t("designStyleDialogHint")}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {styles === null ? null : (
            <div className="grid grid-cols-2 gap-3">
              {styles.map((style) => (
                <DesignStyleCard
                  actionLabel={t("designStylePick")}
                  key={style.id}
                  onPick={() => (!busy ? setPicked(style) : undefined)}
                  picked={picked?.id === style.id}
                  style={style}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#e4e4df] px-3 py-2.5 dark:border-border">
          <button
            className="h-8 rounded-[6px] px-3 text-[12px] text-[#55575b] hover:bg-[#f2f3f2] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            {t("designStyleCancel")}
          </button>
          <button
            className="h-8 rounded-[6px] bg-[#3f6bd6] px-3 text-[12px] font-medium text-white disabled:opacity-40"
            disabled={picked === null || busy}
            onClick={confirm}
            type="button"
          >
            {picked === null ? t("designStyleApply") : t("designStyleApplyNamed").replace("{name}", picked.name)}
          </button>
        </footer>
      </div>

      {confirming && picked !== null ? (
        /**
         * 确认层。它说清两件事:**会发生什么**(整份设计稿被全量重设)与**代价**(耗时较长)。
         * 后者尤其要紧 —— 按下去之后会自动开一轮对话,那是几十秒到几分钟。
         */
        <div
          className="absolute inset-0 z-60 grid place-items-center bg-black/25 p-4"
          onMouseDown={() => !busy && setConfirming(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-xl border border-[#e2e4e6] bg-white p-4 shadow-[0_16px_48px_rgba(0,0,0,0.24)] dark:border-border dark:bg-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="text-[13px] font-semibold text-[#20201f] dark:text-foreground">
              {t("designStyleConfirmTitle").replace("{name}", picked.name)}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[#6b7075] dark:text-muted-foreground">
              {t("designStyleConfirmBody").replace("{count}", String(frameCount))}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 rounded-[6px] px-3 text-[12px] text-[#55575b] hover:bg-[#f2f3f2] dark:text-muted-foreground dark:hover:bg-muted"
                onClick={() => setConfirming(false)}
                type="button"
              >
                {t("designStyleCancel")}
              </button>
              <button
                className="h-8 rounded-[6px] bg-[#3f6bd6] px-3 text-[12px] font-medium text-white disabled:opacity-40"
                disabled={busy}
                onClick={() => apply(picked)}
                type="button"
              >
                {t("designStyleApply")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
