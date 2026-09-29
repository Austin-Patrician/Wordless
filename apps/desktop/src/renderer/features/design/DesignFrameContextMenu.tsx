import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useBrowserOcclusion } from "../browser/use-occlusion";
import { placeFrameMenu } from "./design-view.ts";

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
  containerRef,
  frameTitle,
  onAttach,
  onClose,
  onDelete,
  onRename,
}: {
  anchor: FrameMenuAnchor;
  /**
   * 画布容器。菜单按**它的**边界决定翻边还是贴边。
   *
   * 拿元素本身而不是上层算好的尺寸,有两个理由:
   * - `offsetParent` 在这里不能用:菜单的祖先里没有定位元素(画布容器是 `h-full w-full`,不是
   *   `relative`),它会一路找到 `body`,于是边界变成窗口的 —— 菜单就跑到画布外面压对话区了;
   * - 元素的尺寸在**打开菜单的那一刻**读,比"上层 state 里的尺寸"少一次滞后 —— 后者要等
   *   `ResizeObserver` 回调 + 一次渲染才更新,而那一刻菜单已经按旧边界摆好了。
   */
  containerRef: { readonly current: HTMLElement | null };
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
   * 菜单的两种状态。
   *
   * 删除**不在这里确认**:它要一个画布中央的确认框(见 `DesignConfirmDialog`)—— 因为它是这个
   * 画布上唯一会丢东西的动作,而菜单项就在指针底下、点错的代价补不回来(帧文件直接被删)。
   * 确认框由画布那一层持有:菜单是"指针旁边的浮层",而确认框是"整块画布的模态",两者不该
   * 挤在同一处。
   */
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState(frameTitle);
  const box = useRef<HTMLDivElement>(null);

  /**
   * 摆好的位置(容器内坐标)。`null` = 还没量过。
   *
   * 为什么不在上层算:菜单的宽度得先**量出来**才知道够不够地方,而上层在渲染它之前拿不到这个
   * 尺寸。所以这里量一次、再摆一次 —— 用 `useLayoutEffect`,这一次修正发生在**绘制之前**,
   * 用户看不到中间那一帧。
   *
   * 量出来之前先用指针位置兜底,于是即使 `offsetParent` 取不到,菜单也开在指针处(只是可能
   * 越界),而不是不出现。
   */
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    const container = containerRef.current;
    if (element === null || container === null) return;
    const rect = element.getBoundingClientRect();
    // `mode` 也进依赖:换到重命名 / 确认删除时尺寸会变,得按新的尺寸重新摆。
    setPlaced(
      placeFrameMenu({
        anchor,
        // `clientWidth/Height`:与 `anchor` 同一套坐标(容器内),不受任何变换影响。
        bounds: { height: container.clientHeight, width: container.clientWidth },
        menu: { height: rect.height, width: rect.width },
      }),
    );
  }, [anchor, containerRef, mode]);

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
      /**
       * `w-max` + `whitespace-nowrap`:菜单**按内容定宽,而且永不换行**。
       *
       * 宽度不够是"该翻到另一侧"的信号(见 `placeFrameMenu`),不是该拆词的信号 ——
       * 「交给 agent 改这一帧」被拆成两行,读起来像坏了。
       */
      className="absolute z-50 w-max min-w-[150px] whitespace-nowrap rounded-[8px] border border-[#e2e4e6] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:border-border dark:bg-card"
      data-frame-menu=""
      ref={box}
      style={{ left: placed?.left ?? anchor.x, top: placed?.top ?? anchor.y }}
    >
      {mode === "rename" ? (
        <input
          autoFocus
          className="h-8 w-full rounded-[6px] border border-[#4f7df3] px-2 text-[12px] text-[#3e3e39] outline-none dark:bg-[#202225] dark:text-foreground"
          /**
           * **这里没有 `onBlur`。** 曾经有:失去焦点就收起输入框。它看着方便,实际是"点了没
           * 反应"的来源 —— 切换成输入框时菜单会按新尺寸重摆一次,指针于是可能落到菜单**外面**,
           * 紧接着的 `mouseup` 落在画布上,输入框失焦,菜单当场收掉。
           *
           * 而"点别处就关"本来就有更准的实现:下面那个窗口级 `pointerdown` 监听。收起草稿(而不是
           * 就地重命名)仍然是对的 —— 半截的草稿不该改到帧源码上。
           */
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
      ) : (
        <>
          {/*
            改这一帧 = 开一轮对话,而不是在画布上就地改内容 —— **内容是源码**,而改源码的
            是 agent。这一项把帧作为引用放进输入框,用户还能补一句话(见 `onAttach`)。
          */}
          <MenuItem label={t("designFrameAskAgent")} onSelect={onAttach} />
          <MenuItem label={t("designFrameRename")} onSelect={() => setMode("rename")} />
          {/* 删除只是**发起**确认;真正删掉的按钮在那个确认框里。 */}
          <MenuItem label={t("designFrameDelete")} onSelect={onDelete} tone="danger" />
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
