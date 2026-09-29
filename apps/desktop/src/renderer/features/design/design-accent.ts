import type { DesignStyleSummaryDto } from "@wordless/protocol";
import { parseThemeTokens } from "./style-tokens.ts";

/**
 * 一张设计卡片的底色 —— **用这份设计自己的主色**。
 *
 * 为什么不是随机/哈希配色:画廊里那一格代表的是"这份设计长什么样",而它自己那套风格的
 * `theme.css` 就在手边(风格目录本来就在这一页加载)。用设计自己的主色,于是卡片底色与画布里
 * 的画面是同一个来源,而不是又一个"看起来还行"的装饰色。
 *
 * 取色优先级:主色(`primary`)→ 强调色(`accent`)→ 令牌表里第一个颜色。都取不到就返回 `null`,
 * 由卡片用一个中性底兜底 —— **没有风格的设计是正常状态**(它可以是 agent 手写的),不该因此
 * 变成一块空白。
 *
 * 纯函数:只读入风格摘要,不做网络、不碰 DOM。
 */
export function designAccent(style: DesignStyleSummaryDto | null | undefined): string | null {
  if (style === null || style === undefined) return null;
  let colors: Record<string, string>;
  try {
    colors = parseThemeTokens(style.themeCss).colors;
  } catch {
    // 令牌文件读得出来但解析不出来:不值得让整张卡失败,退回兜底。
    return null;
  }

  const preferred = ["primary", "accent", "brand", "foreground"];
  for (const name of preferred) {
    const exact = colors[name];
    if (isUsableColor(exact)) return exact;
    // 令牌名通常带前缀(`--color-primary` → `primary`),但写法不唯一 —— 这里容忍前缀差异。
    const suffixed = Object.entries(colors).find(([key]) => key.endsWith(`-${name}`));
    if (suffixed !== undefined && isUsableColor(suffixed[1])) return suffixed[1];
  }

  const first = Object.values(colors).find(isUsableColor);
  return first ?? null;
}

/**
 * 能不能当底色用。
 *
 * 只要**看起来是个颜色**就行:十六进制、`rgb(...)`、命名色都放行。透明色与空值不行 —— 那会
 * 让封面区变成一块看不出边界的空白。
 */
function isUsableColor(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "transparent") return false;
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) || /^[a-z]+$/i.test(trimmed) || trimmed.startsWith("rgb");
}
