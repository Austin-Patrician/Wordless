/**
 * 分页:一张导出图放几个画框由用户在工作台里选,放不下的排到下一页。
 *
 * 单独成文件,是因为**预览、导出、页码文案三处必须看到同一份分页结果** —— 各自算一遍的
 * 版本会在某个边界(末页刚好排满)上分叉。
 *
 * 本文件不 import React、不 import Electron。
 */
export function paginateMockup<T>(items: readonly T[], perPage: number): T[][] {
  /**
   * **`Math.max(1, Math.floor(NaN))` 是 `NaN`** —— 那种"夹紧"在 NaN 面前一点用都没有,
   * 结果是分页循环一次就退出、返回**一个空页**:所有画框被静默丢掉。
   *
   * 参考实现这里正是 `Math.max(1, Math.floor(perPage))`。`perPage` 的类型虽然被限制在
   * 1..4,但它是从用户设置里读出来的数字 —— 一条 `NaN` 就足以让导出变成一张白图,而界面
   * 上没有任何提示。所以先验有限性,再夹紧。
   */
  const floored = Math.floor(perPage);
  const size = Number.isFinite(floored) && floored >= 1 ? floored : 1;
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}
