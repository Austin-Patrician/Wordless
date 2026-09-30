/**
 * 紧凑的 token 数字:`1.5K` / `2.4M`。
 *
 * 阈值取在 999_950 而不是 1_000_000:保留一位小数之后不该出现 `1000K` 这种四位数字 ——
 * 它不是错,但一眼看上去像另一个数量级。
 *
 * 只用来**显示**。求和与比值一律用精确值,不要先格式化再相加。
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const magnitude = Math.abs(value);
  if (magnitude < 1_000) return Math.round(value).toLocaleString();
  if (magnitude >= 999_950) return `${trim(value / 1_000_000)}M`;
  return `${trim(value / 1_000)}K`;
}

function trim(scaled: number): string {
  return scaled.toFixed(1).replace(/\.0$/, "");
}
