import type { DesignFrameDto } from "@wordless/protocol";
import { unionRects, type Rect } from "./camera.ts";

/**
 * 对齐与分布。
 *
 * 这是这一层里**唯一不需要新 IPC** 的编辑动作:它只改画布上的 `x`/`y`,而那条路已经存在
 * (`moveDesignFrames`)。所以它是"画布从只能看变成能做版面"里最便宜的一步。
 *
 * 纯函数,不 import React:对齐算错的表现是"帧跑到了一个说不通的位置",而那既不像崩溃也
 * 不像空 —— 只能靠断言。
 */

export type ArrangeMode =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute-h"
  | "distribute-v";

/** 动一格需要几帧:`对齐`要两帧,`分布`至少要三帧(两帧之间没有"间距"可言)。 */
export function arrangeRequires(mode: ArrangeMode): number {
  return mode.startsWith("distribute") ? 3 : 2;
}

export interface FramePlacement {
  frameId: string;
  x: number;
  y: number;
}

/**
 * 算出要移动的帧。
 *
 * 三条纪律:
 *
 * 1. **只返回真的变了的帧** —— 调用方会把结果整批提交,而"提交一帧没变的位置"会让清单白写
 *    一次、画布白刷新一次(§7 的拖拽提交同一条理由)。
 * 2. **基准是被选中的那批帧的包围盒**,不是整个画布 —— 对齐的语义是"它们互相对齐"。
 * 3. **四舍五入到整数**:居中/居中条会算出 `.5`,而清单里的坐标是布局数据,不是测量值。
 */
export function arrangeFrames(input: {
  frames: readonly DesignFrameDto[];
  selectedFrameIds: readonly string[];
  mode: ArrangeMode;
}): FramePlacement[] {
  const ids = new Set(input.selectedFrameIds);
  const selected = input.frames.filter((frame) => ids.has(frame.id));
  if (selected.length < arrangeRequires(input.mode)) return [];

  const bbox = unionRects(selected.map(toRect));
  if (bbox === null) return [];

  switch (input.mode) {
    case "left":
      return move(selected, (frame) => ({ x: bbox.x }));
    case "right":
      return move(selected, (frame) => ({ x: bbox.x + bbox.width - frame.width }));
    case "center-h":
      return move(selected, (frame) => ({ x: bbox.x + (bbox.width - frame.width) / 2 }));
    case "top":
      return move(selected, (frame) => ({ y: bbox.y }));
    case "bottom":
      return move(selected, (frame) => ({ y: bbox.y + bbox.height - frame.height }));
    case "middle":
      return move(selected, (frame) => ({ y: bbox.y + (bbox.height - frame.height) / 2 }));
    case "distribute-h":
      return distribute(selected, "h", bbox);
    case "distribute-v":
      return distribute(selected, "v", bbox);
  }
}

function move(
  frames: readonly DesignFrameDto[],
  place: (frame: DesignFrameDto) => { x?: number; y?: number },
): FramePlacement[] {
  const placements: FramePlacement[] = [];
  for (const frame of frames) {
    const next = place(frame);
    const x = Math.round(next.x ?? frame.x);
    const y = Math.round(next.y ?? frame.y);
    if (x === frame.x && y === frame.y) continue;
    placements.push({ frameId: frame.id, x, y });
  }
  return placements;
}

/**
 * 等间距分布。
 *
 * "间距相等"指的是**帧与帧之间的空隙**相等,而不是"帧的起点等距" —— 尺寸不同的帧用后者会
 * 得到看起来不均匀的结果,而那正是这一功能存在的理由(Figma 与参考实现都是空隙等距)。
 *
 * 首尾两帧不动:它们的落点是用户已经摆好的边界。
 */
function distribute(frames: readonly DesignFrameDto[], axis: "h" | "v", bbox: Rect): FramePlacement[] {
  const size = (frame: DesignFrameDto): number => (axis === "h" ? frame.width : frame.height);
  const start = (frame: DesignFrameDto): number => (axis === "h" ? frame.x : frame.y);

  const sorted = [...frames].sort((left, right) => start(left) - start(right));
  const total = axis === "h" ? bbox.width : bbox.height;
  const occupied = sorted.reduce((sum, frame) => sum + size(frame), 0);
  const gap = (total - occupied) / (sorted.length - 1);

  const placements: FramePlacement[] = [];
  let cursor = axis === "h" ? bbox.x : bbox.y;
  for (const frame of sorted) {
    const x = axis === "h" ? Math.round(cursor) : frame.x;
    const y = axis === "h" ? frame.y : Math.round(cursor);
    if (x !== frame.x || y !== frame.y) placements.push({ frameId: frame.id, x, y });
    cursor += size(frame) + gap;
  }
  return placements;
}

function toRect(frame: DesignFrameDto): Rect {
  return { height: frame.height, width: frame.width, x: frame.x, y: frame.y };
}
