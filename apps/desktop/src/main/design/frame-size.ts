import { FALLBACK_FRAME_SIZE, type FrameSize } from "./manifest.ts";
import type { ParsedFrameMeta } from "./frame-meta.ts";

/**
 * 每个帧最终用哪个尺寸。
 *
 * 优先级从具体到笼统:
 *
 * ```
 * 帧自己声明的 > 整份设计的多数派 > 创建时声明的品类 > 全局兜底
 * ```
 *
 * **多数派排在品类前面是有意的** —— 一份设计中途改了品类(海报改成手机屏)时,已经在
 * 画布上的那些帧才是真相。
 *
 * 为什么用多数派而不是"抄前一帧":按文件名顺序抄有**断链**问题 —— 排在最前面那个漏了
 * 声明,它自己没有参考、也就进不了参考池,后面每一帧跟着一起断,最后整份设计一个画板
 * 都剩不下(参考实现记录了这次"全军覆没")。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface FrameSizeInput {
  id: string;
  /** 从帧文件解析出来的声明;尺寸可能为 null。 */
  parsed: ParsedFrameMeta;
}

/** 这一帧自己说了算的尺寸。 */
function declaredSize(entry: FrameSizeInput): FrameSize | null {
  const { width, height } = entry.parsed;
  return width !== null && height !== null ? { width, height } : null;
}

/** 整份设计里出现最多的那个尺寸。 */
function dominantSize(entries: readonly FrameSizeInput[]): FrameSize | null {
  const counts = new Map<string, { size: FrameSize; count: number }>();
  for (const entry of entries) {
    const size = declaredSize(entry);
    if (size === null) continue;
    const key = `${size.width}x${size.height}`;
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { size, count: 1 });
  }
  let best: { key: string; size: FrameSize; count: number } | null = null;
  for (const [key, candidate] of counts) {
    // 并列时按尺寸键取最小 —— 于是结果**与输入顺序无关**。早先的写法是"保留先遇到的",
    // 那要求调用方先把 entries 按文件名排序,是一个容易忘的前提;忘掉的表现是同一份设计
    // 每次打开可能给出不同尺寸,画布会跳。
    if (
      best === null ||
      candidate.count > best.count ||
      (candidate.count === best.count && key < best.key)
    ) {
      best = { key, size: candidate.size, count: candidate.count };
    }
  }
  return best?.size ?? null;
}

/**
 * 解析每一帧最终的尺寸。
 *
 * 返回的 Map **一定覆盖全部输入** —— 没有帧会因为漏声明而掉出画布。这是刻意的
 * fail-open:漏声明的代价若是"画布上什么都没有",用户盯着空白、agent 拿不到任何信号,
 * 于是开始盲猜;而尺寸猜错了是**看得见**的,一眼就能发现、改一行就好。
 *
 * 缺失本身照常由 issue 报出去 —— 渲染和报错是两件事,可以都要。
 */
export function resolveFrameSizes(
  entries: readonly FrameSizeInput[],
  designDefault?: FrameSize | null,
): Map<string, FrameSize> {
  const dominant = dominantSize(entries);
  const resolved = new Map<string, FrameSize>();
  for (const entry of entries) {
    resolved.set(entry.id, declaredSize(entry) ?? dominant ?? designDefault ?? FALLBACK_FRAME_SIZE);
  }
  return resolved;
}
