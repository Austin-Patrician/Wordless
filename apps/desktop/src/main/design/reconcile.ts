import type { ParsedFrameMeta } from "./frame-meta.ts";
import { resolveFrameSizes } from "./frame-size.ts";
import type { DesignFrameEntry, FrameSize } from "./manifest.ts";

/**
 * 把磁盘上的帧与清单里的帧对上。
 *
 * **单向**:磁盘决定「有哪些帧」与「帧的标题/尺寸」,清单决定「帧在画布上的位置」。
 * 没有"最后写入者胜"那种双向对账,因此也没有对账窗口里的中间态 —— 参考实现的两个
 * 真相源(manifest 与 tsx)是那套复杂度的来源。
 *
 * 具体到字段:
 *
 * | 字段 | 归谁 | 为什么 |
 * | --- | --- | --- |
 * | 有哪些帧 | 磁盘(`frames/*.html`) | 文件系统是内容的真相 |
 * | `title` / `width` / `height` | 帧文件里的 `@frame` 声明 | 跟着内容走,文件搬走不会丢 |
 * | `x` / `y` | 清单 | 纯布局,与内容无关,用户拖拽**不被覆盖** |
 *
 * 帧文件里声明的 `width`/`height` 与清单里的那份是**声明与缓存**的关系:画布需要不读
 * 文件就能画,所以清单缓存一份;但对账时声明永远赢(所以用户在画布上改尺寸应当写回声明,
 * 与改标题同一路径)。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 自动布局时相邻帧的间距。 */
export const FRAME_GAP = 80;

export interface DiskFrame {
  id: string;
  /** 相对设计包根目录,例如 `frames/login.html`。 */
  file: string;
  parsed: ParsedFrameMeta;
}

export interface ReconcileInput {
  /** 磁盘上发现的帧(调用方按文件名排序,保证结果稳定)。 */
  onDisk: readonly DiskFrame[];
  /** 清单里已有的帧。 */
  inManifest: readonly DesignFrameEntry[];
  /** 用户刚拖拽新建的落点,优先于自动布局。 */
  pendingPlacements?: ReadonlyMap<string, { x: number; y: number }>;
  /** 品类兜底尺寸。 */
  defaultFrameSize?: FrameSize | null;
}

export interface ReconcileResult {
  frames: DesignFrameEntry[];
  /** 与传入的清单是否有差异 —— 调用方据此决定是否回写。 */
  changed: boolean;
}

export function reconcileFrames(input: ReconcileInput): ReconcileResult {
  const known = new Map(input.inManifest.map((frame) => [frame.id, frame]));
  const sizes = resolveFrameSizes(
    input.onDisk.map((frame) => ({ id: frame.id, parsed: frame.parsed })),
    input.defaultFrameSize ?? null,
  );

  const frames: DesignFrameEntry[] = [];
  let changed = false;

  for (const disk of input.onDisk) {
    const size = sizes.get(disk.id);
    const width = size?.width ?? disk.parsed.width ?? 0;
    const height = size?.height ?? disk.parsed.height ?? 0;
    const title = disk.parsed.title;
    const existing = known.get(disk.id);

    if (existing === undefined) {
      // 新帧:用户拖拽新建的落点优先,否则自动放到最右帧的右边。
      const placement = input.pendingPlacements?.get(disk.id) ?? autoPlacement(frames);
      frames.push({ id: disk.id, file: disk.file, x: placement.x, y: placement.y, width, height, title });
      changed = true;
      continue;
    }

    known.delete(disk.id);
    // x/y 保留清单的(用户拖拽不被覆盖);其余跟随声明。
    if (
      existing.file !== disk.file ||
      existing.title !== title ||
      existing.width !== width ||
      existing.height !== height
    ) {
      frames.push({ ...existing, file: disk.file, width, height, title });
      changed = true;
    } else {
      frames.push(existing);
    }
  }

  // 清单里有、磁盘上没有 → 被删掉的帧。
  if (known.size > 0) changed = true;

  return { frames, changed };
}

/**
 * 新帧放哪:最右帧的右边,与最上帧对齐。
 *
 * 不放在原点 —— 那样新帧会叠在已有内容上,看起来像"没反应"。空画布时落在原点。
 */
export function autoPlacement(placed: readonly DesignFrameEntry[]): { x: number; y: number } {
  if (placed.length === 0) return { x: 0, y: 0 };
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (const frame of placed) {
    right = Math.max(right, frame.x + frame.width);
    top = Math.min(top, frame.y);
  }
  return { x: right + FRAME_GAP, y: top };
}
