import { memo, useState } from "react";
import { CircleAlert, LoaderCircle, Frame as FrameIcon } from "lucide-react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { DesignFrameDto } from "@wordless/protocol";
import { resolveFrameSurface, type FrameFailureReason } from "./frame-surface.ts";
import { useDesignViewport } from "./design-viewport-context.tsx";
import { FRAME_ACTIVITY_VISUALS } from "./frame-activity.ts";
import { usePreferences } from "../../shared/preferences";
import { DESIGN_CANVAS_BUDGETS } from "./budgets.ts";
import { useDesignEditor } from "./design-editor-context.tsx";
import { frameFitsInViewport } from "./live-frame.ts";

/**
 * 画布上的一帧。
 *
 * 节点只负责**画**;呈现方式是 `resolveFrameSurface` 的判定结果 —— 同一份规则同时被
 * `design-view.ts`(批量投影)和这里使用,所以"什么时候贴位图、什么时候给活体、什么时候
 * 是占位/失败"只有一处定义。
 *
 * **注意扩展名**:这个仓库开了 `allowImportingTsExtensions` 且用 bundler 解析,于是
 * 写错的 `.ts` 会被 tsc 重新解析到 `.tsx` 而**不报错**,只有 Vite 才报 —— 改动导入时
 * 别信 tsc 的绿灯。
 *
 * P2 阶段没有光栅化,所以 `textureKey` 恒为 null,呈现必然是占位或失败。这正是 P0 把
 * 状态判定抽成纯函数的价值:P3 接上光栅池时,这个组件**一行都不用改**。
 */

export interface DesignFrameNodeData extends Record<string, unknown> {
  frame: DesignFrameDto;
  /** 位图 URL;还没有位图时为 null(呈现占位)。 */
  textureKey: string | null;
}

export const DesignFrameNode = memo(function DesignFrameNode({ data, selected }: NodeProps) {
  const { frame, textureKey } = data as unknown as DesignFrameNodeData;
  const { zoom, focusedFrameId, chromeScale, activity, container } = useDesignViewport();
  /** 用户"进入"了这一帧吗(`focusedFrameId` 现在是进入帧,不是选中帧)。 */
  const entered = focusedFrameId === frame.id;
  const editor = useDesignEditor();
  const { t } = usePreferences();
  /** agent 此刻在动这一帧吗。见 `frame-activity.ts` —— 它是画布上"agent 在干什么"的唯一证据。 */
  const active = activity.get(frame.id);
  /**
   * 就地重命名。
   *
   * 画布上唯一的标签就是帧标题,而它以前**改不了** —— 只能靠 agent 改源码,或者干脆没有
   * 名字。双击标题进入编辑,与"双击画面进入 1:1"分开:标题是标签,画面是页面。
   */
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  // 菜单不在这里画:节点的祖先带着画布的缩放变换,菜单放进去位置与尺寸都会错(见
  // `DesignFrameContextMenu` 的说明)。这里只把"在哪右击了"上报给画布。

  /**
   * 呈现方式全由 `resolveFrameSurface` 判定 —— 这个组件只负责画。
   *
   * `textureKey` 现在是真的(P3 的光栅池供图)。**这个组件在 P3 里一行都没改**:
   * 当初把判定抽成纯函数,换来的就是这一点。
   *
   * `artifactPresent: true` 仍然成立:打开设计时已同步过渲染根,产物必然在。
   * `failure` 暂时恒为 null —— 失败态目前由"没有位图"这条路径覆盖(占位卡),把每帧的
   * 失败原因接进来是后续的事。
   *
   * 视口裁剪不在这里:走到这个组件的帧一定是要渲染的(React Flow 已经只挂可见节点)。
   */
  const surface = resolveFrameSurface({
    visible: true,
    zoom,
    focused: focusedFrameId === frame.id,
    textureKey,
    rasterizing: false,
    artifactPresent: true,
    failure: null,
  });

  const border = selected ? "border-[#4f7df3]" : "border-[#d8dad6] dark:border-[#3b3e41]";
  const visual = active === undefined ? null : FRAME_ACTIVITY_VISUALS[active];

  return (
    <>
      {/**
       * 缩放手柄只在**单独选中一帧**、而且不是活体态时出现。
       *
       * 活体态不给:原生视图不能被 CSS 缩放,它的矩形由相机派生 —— 拖它的边只会让画面与
       * 手柄错位。这是与参考实现同一处取舍(它也只给单选的手柄:分组缩放没有明确语义)。
       */}
      <NodeResizer
        color="#4f7df3"
        handleStyle={{ borderRadius: 2, height: 7, width: 7 }}
        isVisible={selected && surface.kind !== "live" && draftTitle === null}
        minHeight={DESIGN_CANVAS_BUDGETS.frameMinHeight}
        minWidth={DESIGN_CANVAS_BUDGETS.frameMinWidth}
        onResizeEnd={(_event, params) =>
          editor.commitMeta(frame.id, { height: params.height, width: params.width })
        }
      />
    <div
      className={`relative h-full w-full overflow-visible rounded-[4px] border bg-white dark:bg-[#1b1c19] ${border}`}
      /*
        活动态的画法是**外圈一道呼吸描边**:它不遮内容(帧的内容正是要看的),而且只动
        border-color 与 box-shadow 两个属性 —— 帧底下可能就是原生视图,动别的属性会让它
        逐帧重新合成。`animate-pulse` 是 Tailwind 自带的,只为让"还在动"看得出来。
      */
      style={
        visual === null
          ? undefined
          : { borderColor: visual.color, boxShadow: `0 0 0 1px ${visual.color}` }
      }
    >
      <div
        className="h-full w-full overflow-hidden rounded-[3px]"
        // 稳定的身份钩子:右键与"这一帧的内容区"在测试里都靠它定位 —— 工具类名(带方括号
        // 的那种)既难转义,又一改样式就断。
        data-frame-id={frame.id}
        onContextMenu={(event) => {
          /*
            只 `preventDefault`(盖掉浏览器菜单),**不 stopPropagation**:选中是画布的事,
            由 React Flow 的 `onNodeContextMenu` 做。这里只负责上报指针位置 —— 换算成容器
            坐标是画布的事,因为只有它知道容器在哪。
          */
          event.preventDefault();
          editor.openFrameMenu(frame.id, { clientX: event.clientX, clientY: event.clientY });
        }}
      >
        {/*
          位图在**任何有底图的情况下**都要贴 —— 包括 `live`。

          `live` 的契约是"原生视图接管,位图留作底"(见 `frame-surface.ts`),而原生视图在
          attach 之前、被浮层遮挡时、以及加载失败时都不在。那时底下的位图就是用户看到的
          唯一内容;把它换掉,选中一帧会让内容变成一句"390 × 844"。
        */}
        {surface.kind === "failed" ? (
          <FrameMessage
            icon={<CircleAlert className="size-4 text-[#a46a42]" />}
            label={failureLabel(surface.reason)}
            tone="text-[#a46a42]"
          />
        ) : surface.kind === "texture" || surface.kind === "live" ? (
          <img alt="" className="h-full w-full object-cover" draggable={false} src={surface.textureKey} />
        ) : (
          <FrameMessage
            icon={<FrameIcon className="size-4 text-[#b3b8bd]" />}
            label={`${Math.round(frame.width)} × ${Math.round(frame.height)}`}
            tone="text-[#8a8f94]"
          />
        )}
      </div>

      {/* 标题按反向缩放,于是在任何缩放下都是屏幕上的固定尺寸 —— 与 Figma 一致。 */}
      <div
        className="pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#6b7075] dark:text-[#a5abb0]"
        style={{ transform: `translateY(-100%) scale(${chromeScale})`, transformOrigin: "0 100%" }}
      >
        {/* 状态徽标按**缩放**反向缩放而不是按 chromeScale:chromeScale 会被钳在 8,
            缩到很小时它会比帧还大 —— 那种时候状态本来也看不清,交给描边去说。 */}
        {visual === null ? null : (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-normal leading-[14px] text-white"
            data-activity={active}
            style={{ backgroundColor: visual.color }}
          >
            {t(visual.labelKey)}
          </span>
        )}
        {draftTitle === null ? (
          <span
            className="pointer-events-auto cursor-text"
            onDoubleClick={(event) => {
              // 不让它冒到节点上:节点上的双击是"进入这一帧",而这里是"改它的名字"。
              event.stopPropagation();
              setDraftTitle(frame.title);
            }}
            title={t("designFrameRenameHint")}
          >
            {frame.title}
          </span>
        ) : (
          <input
            autoFocus
            className="pointer-events-auto w-24 rounded-[3px] border border-[#4f7df3] bg-white px-1 text-[11px] text-[#3e3e39] outline-none dark:bg-[#202225] dark:text-[#d2d5d8]"
            onBlur={() => {
              editor.commitMeta(frame.id, { title: draftTitle });
              setDraftTitle(null);
            }}
            onChange={(event) => setDraftTitle(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                editor.commitMeta(frame.id, { title: draftTitle });
                setDraftTitle(null);
              }
              // Escape 是取消:把草稿丢掉,而不是把半截标题写进源码。
              if (event.key === "Escape") setDraftTitle(null);
            }}
            value={draftTitle}
          />
        )}
        {/*
          "能不能点"必须说出来。
          位图看着和真页面一样,而它点不动 —— 用户没有任何办法知道区别,除非画布告诉他。
          反过来,1:1 的聚焦帧交给了原生视图,它是**真的能点**的,那也是一件要说出来的事。
        */}
        {surface.kind === "live" ? (
          <span className="rounded-full bg-[#e8f5ec] px-1.5 py-px text-[10px] font-normal text-[#1f7a44] dark:bg-[#1d2b22] dark:text-[#6fbf90]">
            {t("designFrameInteractive")}
          </span>
        ) : entered ? (
          /**
           * 进入了但它还是位图 —— 只有一种原因用户看不出来:整帧放不下,而原生视图不被裁剪,
           * 所以放不下就不能给。**必须说出来**,否则"双击进入"像是没生效。
           *
           * 只按尺寸判(位置在进入时已被 `setCenter` 居中),所以不需要相机的 x/y。
           */
          !frameFitsInViewport({
            frame: { height: frame.height, width: frame.width, x: 0, y: 0 },
            camera: { x: 0, y: 0, zoom },
            container,
          }) ? (
            <span className="rounded-full bg-[#fdf3e7] px-1.5 py-px text-[10px] font-normal text-[#8a5a24] dark:bg-[#2b2419] dark:text-[#d8b483]">
              {t("designFrameTooSmall")}
            </span>
          ) : null
        ) : selected ? (
          <span className="rounded-full bg-[#eef1f6] px-1.5 py-px text-[10px] font-normal text-[#5b6472] dark:bg-[#24262a] dark:text-[#9aa3ae]">
            {t("designFrameEnterHint")}
          </span>
        ) : null}
        {surface.kind === "placeholder" && surface.reason === "rasterizing" ? (
          <LoaderCircle className="ml-1 inline size-3 animate-spin motion-reduce:animate-none" />
        ) : null}
      </div>

    </div>
    </>
  );
});



function FrameMessage({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: string }) {
  return (
    <div className="grid h-full w-full place-items-center bg-[#fbfbfa] dark:bg-[#202225]">
      <div className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
        {icon}
        <span className="tabular-nums">{label}</span>
      </div>
    </div>
  );
}

const FAILURE_LABELS: Record<FrameFailureReason, string> = {
  "raster-timeout": "渲染超时",
  "load-failed": "加载失败",
  "dist-missing": "产物缺失",
  "build-failed": "构建失败",
};

function failureLabel(reason: FrameFailureReason): string {
  return FAILURE_LABELS[reason];
}
