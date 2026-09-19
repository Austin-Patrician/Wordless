import type { Locale } from "./models";

/** Coarse, locale-aware "3 days ago" style label used for session timestamps. */
export function relativeTimeFrom(timestamp: number, locale: Locale): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < 60_000) return formatter.format(0, "second");
  if (elapsed < 3_600_000) return formatter.format(-Math.floor(elapsed / 60_000), "minute");
  if (elapsed < 86_400_000) return formatter.format(-Math.floor(elapsed / 3_600_000), "hour");
  return formatter.format(-Math.floor(elapsed / 86_400_000), "day");
}
