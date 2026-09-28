import { memo } from "react";
import { CircleAlert, LoaderCircle, Frame as FrameIcon } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import type { DesignFrameDto } from "@wordless/protocol";
import { resolveFrameSurface, type FrameFailureReason } from "./frame-surface.ts";
import { useDesignViewport } from "./design-viewport-context.tsx";

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
  const { zoom, focusedFrameId, chromeScale } = useDesignViewport();

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

  const border = selected
    ? "border-[#4f7df3]"
    : "border-[#d8dad6] dark:border-[#3b3e41]";

  return (
    <div className={`relative h-full w-full overflow-visible rounded-[4px] border bg-white dark:bg-[#1b1c19] ${border}`}>
      <div className="h-full w-full overflow-hidden rounded-[3px]">
        {surface.kind === "texture" ? (
          <img alt="" className="h-full w-full object-cover" draggable={false} src={surface.textureKey} />
        ) : surface.kind === "failed" ? (
          <FrameMessage
            icon={<CircleAlert className="size-4 text-[#a46a42]" />}
            label={failureLabel(surface.reason)}
            tone="text-[#a46a42]"
          />
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
        className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-[11px] font-medium text-[#6b7075] dark:text-[#a5abb0]"
        style={{ transform: `translateY(-100%) scale(${chromeScale})`, transformOrigin: "0 100%" }}
      >
        {frame.title}
        {surface.kind === "placeholder" && surface.reason === "rasterizing" ? (
          <LoaderCircle className="ml-1 inline size-3 animate-spin motion-reduce:animate-none" />
        ) : null}
      </div>
    </div>
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
