import type { MessageKey } from "../../shared/i18n";

/**
 * 风格展示文案:`id` / 分类 key → i18n key。
 *
 * 目录(`main/design/style-catalog.ts`)里的 `name`、`tagline` 是**兜底值**,`category` 是分类
 * key —— 都不是给人看的最终文案。一份风格在中文界面和英文界面各叫什么,是界面的事,所以它
 * 跟别的界面文案一起放在 `i18n.ts`(与 `WORKBENCH_LABEL_KEYS` 同一取舍)。
 *
 * 三张表用 `Record<string, MessageKey>` 而不是把 id 收紧成联合类型:风格 id 是从主进程
 * DTO 来的(协议里就是 `string`),渲染层 import 主进程目录会给"卡片能画"和"目录里有什么"
 * 之间加一条构建期依赖。**缺口由测试焊住** —— `test/design-style-copy.test.ts` 断言目录里
 * 每一套、每一个分类都能在这里查到,且两个 locale 都有非空文案。
 *
 * 查到 key 却查不到译文时 `translate` 会返回 `undefined`;这里一律回落到 DTO 里那份兜底值,
 * 因为把 `designStyleTaglineXxx` 这种裸键露到界面上比一句中文更糟。
 */

/** 每套风格的名字。 */
export const DESIGN_STYLE_NAME_KEYS: Record<string, MessageKey> = {
  "precise-dark":     "designStyleNamePreciseDark",
  "calm-light":       "designStyleNameCalmLight",
  "editorial":        "designStyleNameEditorial",
  "playful":          "designStyleNamePlayful",
  "linear":           "designStyleNameLinear",
  "doodle-pop":       "designStyleNameDoodlePop",
  "stripe":           "designStyleNameStripe",
  "spotify":          "designStyleNameSpotify",
  "meadow-buddies":   "designStyleNameMeadowBuddies",
  "notion":           "designStyleNameNotion",
  "vercel":           "designStyleNameVercel",
  "headspace":        "designStyleNameHeadspace",
  "github":           "designStyleNameGithub",
  "geometric-bold":   "designStyleNameGeometricBold",
  "apple":            "designStyleNameApple",
  "discord":          "designStyleNameDiscord",
  "claymorphism":     "designStyleNameClaymorphism",
  "anthropic":        "designStyleNameAnthropic",
  "netflix":          "designStyleNameNetflix",
  "airbnb":           "designStyleNameAirbnb",
  "duolingo":         "designStyleNameDuolingo",
  "figma":            "designStyleNameFigma",
  "glassmorphism":    "designStyleNameGlassmorphism",
  "openai":           "designStyleNameOpenai",
  "slack":            "designStyleNameSlack",
  "coinbase":         "designStyleNameCoinbase",
  "shopify":          "designStyleNameShopify",
  "medium":           "designStyleNameMedium",
  "retro-95":         "designStyleNameRetro95",
};

/** 每套风格的一句话说明。 */
export const DESIGN_STYLE_TAGLINE_KEYS: Record<string, MessageKey> = {
  "precise-dark":     "designStyleTaglinePreciseDark",
  "calm-light":       "designStyleTaglineCalmLight",
  "editorial":        "designStyleTaglineEditorial",
  "playful":          "designStyleTaglinePlayful",
  "linear":           "designStyleTaglineLinear",
  "doodle-pop":       "designStyleTaglineDoodlePop",
  "stripe":           "designStyleTaglineStripe",
  "spotify":          "designStyleTaglineSpotify",
  "meadow-buddies":   "designStyleTaglineMeadowBuddies",
  "notion":           "designStyleTaglineNotion",
  "vercel":           "designStyleTaglineVercel",
  "headspace":        "designStyleTaglineHeadspace",
  "github":           "designStyleTaglineGithub",
  "geometric-bold":   "designStyleTaglineGeometricBold",
  "apple":            "designStyleTaglineApple",
  "discord":          "designStyleTaglineDiscord",
  "claymorphism":     "designStyleTaglineClaymorphism",
  "anthropic":        "designStyleTaglineAnthropic",
  "netflix":          "designStyleTaglineNetflix",
  "airbnb":           "designStyleTaglineAirbnb",
  "duolingo":         "designStyleTaglineDuolingo",
  "figma":            "designStyleTaglineFigma",
  "glassmorphism":    "designStyleTaglineGlassmorphism",
  "openai":           "designStyleTaglineOpenai",
  "slack":            "designStyleTaglineSlack",
  "coinbase":         "designStyleTaglineCoinbase",
  "shopify":          "designStyleTaglineShopify",
  "medium":           "designStyleTaglineMedium",
  "retro-95":         "designStyleTaglineRetro95",
};

/** 分类 key。上游 12 个 + 自撰那 4 套用的 3 个。 */
export const DESIGN_STYLE_CATEGORY_KEYS: Record<string, MessageKey> = {
  "product":        "designStyleCategoryProduct",
  "content":        "designStyleCategoryContent",
  "marketing":      "designStyleCategoryMarketing",
  "dev":            "designStyleCategoryDev",
  "fintech":        "designStyleCategoryFintech",
  "media":          "designStyleCategoryMedia",
  "productivity":   "designStyleCategoryProductivity",
  "playful":        "designStyleCategoryPlayful",
  "consumer":       "designStyleCategoryConsumer",
  "ai":             "designStyleCategoryAi",
  "creative":       "designStyleCategoryCreative",
  "commerce":       "designStyleCategoryCommerce",
  "editorial":      "designStyleCategoryEditorial",
  "retro":          "designStyleCategoryRetro",
  "premium":        "designStyleCategoryPremium",
};

export interface DesignStyleCopy {
  name: string;
  tagline: string;
  category: string;
}

/** 卡片要用到的三个字段就是 DTO 里那三个;写成结构类型,纯函数才好测。 */
export interface DesignStyleTextSource {
  id: string;
  name: string;
  tagline: string;
  category: string;
}

function lookup(keys: Record<string, MessageKey>, id: string, t: (key: MessageKey) => string): string | null {
  const key = keys[id];
  if (key === undefined) return null;
  const value = t(key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 分类 key → 当前语言下的分类名。查不到就用 key 本身(裸 key 总好过一片空白)。 */
export function designStyleCategoryLabel(category: string, t: (key: MessageKey) => string): string {
  return lookup(DESIGN_STYLE_CATEGORY_KEYS, category, t) ?? category;
}

/** 一份风格在当前语言下的名字、一句话与分类,查不到就用目录里的兜底值。 */
export function designStyleCopy(style: DesignStyleTextSource, t: (key: MessageKey) => string): DesignStyleCopy {
  return {
    name: lookup(DESIGN_STYLE_NAME_KEYS, style.id, t) ?? style.name,
    tagline: lookup(DESIGN_STYLE_TAGLINE_KEYS, style.id, t) ?? style.tagline,
    category: designStyleCategoryLabel(style.category, t),
  };
}

/** 卡片的无障碍名字:两种动作各有模板 —— 中英文的引号位置本来就不一样。 */
export function designStyleActionLabel(
  copy: DesignStyleCopy,
  actionLabel: string | undefined,
  t: (key: MessageKey) => string,
): string {
  return fill(actionLabel === undefined ? t("designStyleUseForNew") : t("designStyleCardAction"), {
    action: actionLabel ?? "",
    name: copy.name,
  });
}

/** 占位替换。抽出来是为了它可断言:漏一个占位符就会在界面上留下一对花括号。 */
export function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}
