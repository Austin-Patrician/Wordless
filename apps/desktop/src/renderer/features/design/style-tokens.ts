/**
 * 从 `theme.css` 里读令牌,供风格卡片画缩略图。
 *
 * 为什么解析而不是让风格目录自己声明一份颜色表:**单一真源**。`theme.css` 是实际会被写进
 * 设计包、被帧引用的那份文件;卡片再从它抽一次,就不可能和它漂开。参考实现的注释里也是
 * 这个理由 —— 所以卡片上所有颜色/圆角都取自 `theme.css`,Tailwind 只负责布局。
 *
 * 容错优先:手写的 `theme.css` 什么都可能有(缺 `@theme` 块、多行、注释、`.5rem` 这种
 * 无前导零的值),而**一张卡片画不出来不该让整个画廊空掉**。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface StyleTokens {
  /** 键去掉 `--color-` 前缀。 */
  colors: Record<string, string>;
  /** 键去掉 `--radius-` 前缀。 */
  radius: Record<string, string>;
}

/**
 * 块匹配要同时认 `@theme {` 与 `@theme static {`。
 *
 * `static` 是我们自己要求的写法(见 `scaffold.ts`:不 static 的话 Tailwind 只发出被用到的
 * 变量,帧里手写 `var()` 会取不到值)。漏认它不会报错 —— 解析器会退到"扫全文",结果照样
 * 能读出令牌,于是这个 bug 会一直藏着。所以下面单独钉了一条测试。
 */
const THEME_BLOCK = /@theme(?:\s+static)?\s*\{([\s\S]*?)\}/;
const DECLARATION = /--(color|radius)-([a-z0-9-]+)\s*:\s*([^;]+)/gi;

export function parseThemeTokens(css: string): StyleTokens {
  // 没有 `@theme` 块时退而扫全文:手写的令牌文件未必按 Tailwind 的写法组织。
  const scope = THEME_BLOCK.exec(css)?.[1] ?? css;
  const colors: Record<string, string> = {};
  const radius: Record<string, string> = {};

  for (const match of scope.matchAll(DECLARATION)) {
    const [, kind, name, rawValue] = match;
    if (kind === undefined || name === undefined || rawValue === undefined) continue;
    const value = rawValue.trim();
    if (value === "") continue;
    if (kind.toLowerCase() === "color") colors[name] = value;
    else radius[name] = value;
  }

  return { colors, radius };
}

/**
 * 令牌的兜底取值。
 *
 * 与 `frame-size` 的兜底链同一个道理:缺一个令牌时给一个**中性的**替代,让卡片照常画出来,
 * 而不是留一块空白。缺什么由谁负责是另一件事(风格作者该补),不该由卡片承担。
 */
export const FALLBACK_TOKENS = {
  surface: "#ffffff",
  surfaceRaised: "#f8fafc",
  surfaceForeground: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  primary: "#4f46e5",
  accent: "#0ea5e9",
} as const;

export interface ResolvedTokens {
  surface: string;
  surfaceRaised: string;
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  accent: string;
  radius: (name: string, fallback: string) => string;
}

/**
 * 把原始令牌收敛成卡片真正会用的那几个。
 *
 * `radius` 返回一个函数而不是一堆值:缩略图只有一两百像素宽,`--radius-xl: 24px` 直接按
 * 原值画会失真地圆,所以这里按比例缩小后再给卡片用(参考实现也是这么做的)。
 */
export function resolveTokens(tokens: StyleTokens): ResolvedTokens {
  const colors = tokens.colors;
  const pick = (name: string, fallback: string): string => colors[name]?.trim() || fallback;

  return {
    surface: pick("surface", FALLBACK_TOKENS.surface),
    // 没声明 raised 就用 surface 的同族浅一档 —— 用 color-mix 现算,不必解析颜色格式。
    surfaceRaised: pick("surface-raised", `color-mix(in srgb, ${pick("surface", FALLBACK_TOKENS.surface)} 92%, ${pick("surface-foreground", FALLBACK_TOKENS.surfaceForeground)} 8%)`),
    foreground: pick("surface-foreground", FALLBACK_TOKENS.surfaceForeground),
    muted: pick("muted", FALLBACK_TOKENS.muted),
    border: pick("border", `color-mix(in srgb, ${pick("muted", FALLBACK_TOKENS.muted)} 32%, transparent)`),
    primary: pick("primary", FALLBACK_TOKENS.primary),
    accent: pick("accent", FALLBACK_TOKENS.accent),
    radius: (name: string, fallback: string) => scaleRadius(tokens.radius[name], fallback),
  };
}

/**
 * 缩略图里的圆角要按比例缩小。
 *
 * 一张 240px 宽的缩略图上按原值画 24px 圆角,看起来像个药丸;风格之间的"圆角差异"这件事
 * 就失真了。缩到一半仍然能看出"这套比那套更圆"。
 */
function scaleRadius(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  // 数字与单位分开取,而不是看后缀 —— `rem` 也以 `em` 结尾,按后缀判会把 `0.5rem`
  // 减半成 `0.25em`(小了 16 倍)。
  const match = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(raw.trim());
  if (match === null) return fallback;
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) return fallback;
  const unit = match[2] ?? "";
  const scaled = unit === "px" ? Math.round(value / 2) : value / 2;
  return `${scaled}${unit}`;
}

/** 一个令牌色的半透明版本。用 `color-mix` 现算,不必解析十六进制。 */
export function withAlpha(color: string, percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `color-mix(in srgb, ${color} ${clamped}%, transparent)`;
}
