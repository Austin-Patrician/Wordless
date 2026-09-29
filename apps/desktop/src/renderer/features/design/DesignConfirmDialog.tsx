import { useEffect } from "react";
import { useBrowserOcclusion } from "../browser/use-occlusion";

/**
 * 画布内的二次确认框。
 *
 * ## 只盖画布,不盖整个窗口
 *
 * 画布活在主栏里,而它旁边的对话区与侧栏跟这次确认无关 —— 盖住整窗口会把用户的会话一起挡掉,
 * 那是一次"删除一帧"根本不该有的代价。参考实现也是这个形状。
 *
 * ## 为什么必须声明遮挡
 *
 * 原生活体视图永远画在所有 DOM 之上:不声明的话,这个确认框会被活体压住 —— 用户看到一个弹出来
 * 却点不到的东西。所有画布上的浮层都走同一个协调器(`useBrowserOcclusion`)。
 *
 * ## 为什么删除要走这一步
 *
 * 它是这个画布上唯一会丢东西的动作,而且**帧文件直接被删**(不进回收站)。菜单项就在指针底下,
 * 点错的代价补不回来 —— 所以先确认,而且确认按钮是红的。
 */
export function DesignConfirmDialog({
  cancelLabel,
  confirmLabel,
  danger = false,
  description,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: string;
  confirmLabel: string;
  /** 危险动作用红色确认按钮。 */
  danger?: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  // 原生视图永远盖在 DOM 之上:不声明的话这个框会被它压住。
  useBrowserOcclusion(true, "dialog");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // 捕获阶段停掉:别让同一个 Escape 再被画布那一层收一遍(那会连带收起别的浮层)。
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/40 px-6"
      // 点遮罩 = 取消(而不是"什么都不发生"):这一个框里没有别的东西可点。
      onMouseDown={onCancel}
      data-design-confirm=""
    >
      <div
        className="w-full max-w-[380px] rounded-xl border border-[#e2e4e6] bg-white p-4 shadow-[0_16px_48px_rgba(0,0,0,0.24)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-[13px] font-semibold text-[#20201f] dark:text-foreground">{title}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-[#6b7075] dark:text-muted-foreground">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="h-8 rounded-[6px] px-3 text-[12px] text-[#55575b] hover:bg-[#f2f3f2] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`h-8 rounded-[6px] px-3 text-[12px] font-medium text-white ${
              danger ? "bg-[#c0392f] hover:bg-[#a93227]" : "bg-[#3f6bd6] hover:bg-[#3660c4]"
            }`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
