/**
 * 那条拖拽分隔线的几何 —— **两种方向**。
 *
 * 固定布局下面板自己定宽,手柄拖的是**面板**;铺满布局(设计画布)下面板吃掉剩余宽度,手柄
 * 拖的是**相邻的对话列**。边界是**同一条**,而"从哪一侧量"正好相反 —— 这正是会写错、而且
 * 写错了以后看起来只是"拖动有点怪"的那种地方,所以抽成纯函数。
 *
 * 本文件不 import React。
 */

/** 面板自己定宽时(默认布局):宽度 = 窗口右边到指针的距离。 */
export function panelWidthFromPointer(input: {
  clientX: number;
  viewportWidth: number;
  min: number;
  max: number;
}): number {
  return clamp(input.viewportWidth - input.clientX, input.min, input.max);
}

/**
 * 铺满布局下拖拽改的是**对话列**:宽度 = 指针到左栏右边的距离。
 *
 * 不减左栏的话,拖到窗口最左边会得到"对话列宽度 = 0",而画布把左栏的位置也吃掉 —— 看起来
 * 像手柄失灵。左栏折叠时它的宽度是折叠宽度,所以这一步仍然成立。
 */
export function mainWidthFromPointer(input: {
  clientX: number;
  leftSidebarWidth: number;
  min: number;
  max: number;
}): number {
  return clamp(input.clientX - input.leftSidebarWidth, input.min, input.max);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
