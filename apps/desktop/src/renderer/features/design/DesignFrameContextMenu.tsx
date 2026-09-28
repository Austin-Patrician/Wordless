import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useBrowserOcclusion } from "../browser/use-occlusion";

/**
 * 帧的右键菜单。
 *
 * ## 为什么它住在画布层,而不是帧节点里
 *
 * 节点的祖先 `.react-flow__viewport` 带着**画布的缩放变换**。菜单如果渲染在节点里面:
 *
 * - `absolute left/top` 相对的是**节点**而不是画布 —— 位置会整体偏掉(实测就是这么坏的);
 * - 而且它会跟着缩放一起放大缩小,缩到 50% 时字看不清;
 * - 连关闭用的 `fixed inset-0` 遮罩也只覆盖节点那么大(`fixed` 在 transform 祖先下相对的是
 *   那个祖先),于是**点别处永远关不掉**。
 *
 * 三条症状同一个原因:**它必须住在不受变换影响的那一层**。所以这里收的是容器内的屏幕坐标,
 * 由画布算好传进来。
 *
 * ## 关闭
 *
 * 窗口级的 `pointerdown`(菜单外的任何地方:对话区、侧栏、画布;**左右键都算**)、`wheel`
 * (画布在动,菜单的锚点就失效了)、`Escape`。
 *
 * 用 `pointerdown` 而不是 `mousedown` 是有意的:只用左键时,右键点别处、或右键另一帧,菜单
 * 都赖着不走,用户得先左键点一下才消失 —— 那条被报过。改到 `pointerdown` 之后,右键同一帧
 * 会先收、再在新位置开一个(净效果是位置更新),右键别处就直接收掉。
 */

export interface FrameMenuAnchor {
  /** 容器内的屏幕坐标。 */
  x: number;
  y: number;
}

export function DesignFrameContextMenu({
  anchor,
  frameTitle,
  onAttach,
  onClose,
  onDelete,
  onRename,
}: {
  anchor: FrameMenuAnchor;
  /** 重命名时的初值 —— 用户改的是名字,不是从空白开始打。 */
  frameTitle: string;
  /** 把这一帧作为引用放进对话输入框。 */
  onAttach: () => void;
  onClose: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const { t } = usePreferences();
  /**
   * 菜单的三种状态。
   *
   * 删除**要多一步确认**:它是这个画布上唯一会丢东西的动作,而菜单项就在指针底下,点错的
   * 代价不可能补回来(帧文件直接被删)。确认不弹窗、也不换层 —— 就地变成一句「删掉这一帧?」,
   * 少一次注意力转移。
   */
  const [mode, setMode] = useState<"menu" | "rename" | "confirm-delete">("menu");
  const [draft, setDraft] = useState(frameTitle);
  const box = useRef<HTMLDivElement>(null);

  // 原生活体视图永远盖在所有 DOM 之上:不声明的话菜单会被它压住,而那是结构性故障。
  useBrowserOcclusion(true, "menu");

  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      // 菜单内部不算"别的地方";那一层由菜单项自己收场(`contains` 会跳过它)。
      if (box.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    // 画布一平移/缩放,菜单的落点就不再对着那一帧了 —— 收掉比让它飘着诚实。
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="absolute z-50 min-w-[150px] rounded-[8px] border border-[#e2e4e6] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:border-border dark:bg-card"
      data-frame-menu=""
      ref={box}
      style={{ left: anchor.x, top: anchor.y }}
    >
      {mode === "rename" ? (
        <input
          autoFocus
          className="h-8 w-full rounded-[6px] border border-[#4f7df3] px-2 text-[12px] text-[#3e3e39] outline-none dark:bg-[#202225] dark:text-foreground"
          onBlur={() => onClose()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRename(draft);
              onClose();
            }
            if (event.key === "Escape") onClose();
          }}
          value={draft}
        />
      ) : mode === "confirm-delete" ? (
        <>
          <p className="px-2 py-1 text-[11px] text-[#8a8f94]">{t("designFrameDeleteConfirm")}</p>
          <MenuItem label={t("designFrameDelete")} onSelect={onDelete} tone="danger" />
          <MenuItem label={t("designFrameDeleteCancel")} onSelect={() => setMode("menu")} />
        </>
      ) : (
        <>
          {/*
            改这一帧 = 开一轮对话,而不是在画布上就地改内容 —— **内容是源码**,而改源码的
            是 agent。这一项把帧作为引用放进输入框,用户还能补一句话(见 `onAttach`)。
          */}
          <MenuItem label={t("designFrameAskAgent")} onSelect={onAttach} />
          <MenuItem label={t("designFrameRename")} onSelect={() => setMode("rename")} />
          <MenuItem label={t("designFrameDelete")} onSelect={() => setMode("confirm-delete")} tone="danger" />
        </>
      )}
    </div>
  );
}

/**
 * 一项。
 *
 * **只用 `mousedown`,不给 `onClick`。** 关闭用的窗口监听在 `pointerdown` —— 它先跑,但因为
 * 菜单项在菜单**里**,`contains` 会跳过它,所以这一项仍然收得到事件。两个都给则是更糟的一种:
 * 菜单项会被执行两次。
 */
function MenuItem({ label, onSelect, tone }: { label: string; onSelect: () => void; tone?: "danger" }) {
  return (
    <button
      className={`flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[12px] ${
        tone === "danger"
          ? "text-[#b4372f] hover:bg-[#fbeeed] dark:text-[#e08a84] dark:hover:bg-[#2d1f1e]"
          : "text-[#3e3e39] hover:bg-[#f2f3f2] dark:text-foreground dark:hover:bg-muted"
      }`}
      onMouseDown={() => onSelect()}
      type="button"
    >
      {label}
    </button>
  );
}
