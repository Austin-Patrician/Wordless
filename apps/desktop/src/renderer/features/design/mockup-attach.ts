/**
 * 「已加入渲染区的画框」这个列表的运算。
 *
 * **顺序就是导出顺序**,而左侧缩略图列表是它的**补集** —— 两者由同一份数据推导,不各自
 * 维护一份,否则「加入后缩略图要消失」这条规则会立刻分叉。
 *
 * 本文件不 import React、不 import Electron。
 */

export function attachMockupFrame(attached: readonly string[], frameId: string, atIndex?: number): string[] {
  if (attached.includes(frameId)) return [...attached];
  const next = [...attached];
  const index = atIndex === undefined ? next.length : Math.min(Math.max(0, Math.floor(atIndex)), next.length);
  next.splice(index, 0, frameId);
  return next;
}

export function detachMockupFrame(attached: readonly string[], frameId: string): string[] {
  return attached.filter((id) => id !== frameId);
}

/** Figma 式:把 A 拖到 B 上就是**两者互换**,不是插队。 */
export function swapMockupFrames(attached: readonly string[], from: number, to: number): string[] {
  if (from === to) return [...attached];
  if (from < 0 || to < 0 || from >= attached.length || to >= attached.length) return [...attached];
  const next = [...attached];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 左侧缩略图列表:还没被加入渲染区的画框,保持传入的画布顺序。 */
export function mockupRailFrames<T extends { id: string }>(all: readonly T[], attached: readonly string[]): T[] {
  const taken = new Set(attached);
  return all.filter((frame) => !taken.has(frame.id));
}

/** 把「已加入的 id」映射成实际的帧,并丢掉清单里已经不存在的那些。 */
export function mockupShotsFor<T extends { id: string }>(all: readonly T[], attached: readonly string[]): T[] {
  const byId = new Map(all.map((frame) => [frame.id, frame]));
  const shots: T[] = [];
  for (const id of attached) {
    const frame = byId.get(id);
    if (frame !== undefined) shots.push(frame);
  }
  return shots;
}
