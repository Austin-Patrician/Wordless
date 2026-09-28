/**
 * 内置风格目录。
 *
 * 一套风格 = `theme.css`(**令牌的单一真源**)+ `DESIGN.md`(**给 agent 的规范**)。
 * 这个形状来自 `DESIGN.md` 那个概念的原始约定:纯 markdown、没有 schema、没有工具 ——
 * 模型读得最好,而"该怎么写"这件事本来就不该被压成结构化字段。
 *
 * 这些是**内置**的,不是远程清单:
 *
 * - 新建设计不该依赖网络。参考实现的数据只来自远端仓库,于是"一套都没有"是个真实状态,
 *   而它的注册表不得不为此多出一个 status 来区分"还在拉"和"拉失败了"。
 * - 内置的是**风格方向**,不是任何具体产品:名字说的是它长什么样,不是它像谁。
 *
 * ## 为什么在主进程侧而不是能力包里
 *
 * 眼下的消费者只有主进程(画廊的 IPC、建包时落盘)。放进能力包会让**主进程的 store 反向
 * import 能力实现**,而能力包的 `index.ts` 用 NodeNext 的 `.js` 说明符,`node --test`
 * 加载不了它 —— 表现是 store 的测试整体起不来。
 *
 * 等 P7 的 `design_style_*` 工具也要用它时,它应当上移到一个双方都能加载的共享包(不是
 * 内联到某一侧)。现在上移只会把一个问题换成另一个。
 *
 * 本文件不 import React、不 import Electron,也不 import 任何东西。
 */

export type DesignStyleVibe = "light" | "dark";

export interface DesignStyle {
  /** 稳定 id,写进 `design.json` 的 `style`。 */
  id: string;
  /** 显示名。 */
  name: string;
  category: string;
  vibe: DesignStyleVibe;
  /** 一句话说明它长什么样,卡片上显示。 */
  tagline: string;
  /** 完整的 `theme.css`(含 `@theme` 块)。 */
  themeCss: string;
  /** 完整的 `DESIGN.md`。 */
  designMd: string;
}

const PRECISE_DARK_CSS = `@theme {
	--color-primary: #6366f1;
	--color-primary-foreground: #ffffff;
	--color-surface: #0b0c0e;
	--color-surface-raised: #15171a;
	--color-surface-foreground: #e7e9ea;
	--color-muted: #8b929b;
	--color-border: #24272b;
	--color-accent: #22d3ee;
	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-xl: 10px;
}
`;

const PRECISE_DARK_MD = `# Precise Dark

## Visual theme

A dark instrument panel. Information density is the point: rows are tight, labels are small,
and almost nothing is decorative. Colour is used to signal state, never to fill space.

## Colour

- \`surface\` is the page. \`surface-raised\` is any panel, card or menu that sits on it.
- \`border\` is the only separator. Do not use shadows to separate surfaces in dark mode —
  they read as smudges.
- \`primary\` is for the one action a screen is about. \`accent\` marks live or changing values.
- \`muted\` is for labels, metadata and anything secondary. It is already low contrast; do not
  lower it further with opacity.

## Typography

One family throughout. Sizes cluster tightly: 11–12px for metadata, 13–14px for body, 16–20px
for a screen title. Numerals that line up in columns must use tabular figures.

## Layout

Rows are 32–40px. Gaps are 4, 8 or 12px — never 6 or 10. Content is left-aligned and starts at
a consistent inset; nothing is centred except empty states.

## Components

- Buttons: \`radius-md\`, no shadow, one-line label. The primary button is the only filled one.
- Inputs: \`surface-raised\` fill with a \`border\` outline. Focus is a 2px \`primary\` ring.
- Lists: no row separators unless rows are multi-line; use spacing instead.

## Don'ts

- No gradients, no glassmorphism, no large empty headers.
- No more than two type sizes in a single component.
- Do not put a border and a shadow on the same element.
`;

const CALM_LIGHT_CSS = `@theme {
	--color-primary: #4f46e5;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-raised: #f8fafc;
	--color-surface-foreground: #0f172a;
	--color-muted: #64748b;
	--color-border: #e2e8f0;
	--color-accent: #0ea5e9;
	--radius-sm: 6px;
	--radius-md: 10px;
	--radius-xl: 16px;
}
`;

const CALM_LIGHT_MD = `# Calm Light

## Visual theme

A bright, quiet product surface. Whitespace carries the hierarchy, so almost nothing needs a
border or a heavier weight. It should read as calm, not as empty.

## Colour

- \`surface\` is the page, \`surface-raised\` is anything that sits on it.
- \`border\` is hairline-only: 1px, and only where whitespace cannot do the job.
- \`primary\` is the single most important action per screen. Everything else is text.
- \`accent\` is for links and for the one number a screen is about.

## Typography

One family. Body 14–15px with generous line height (1.6). Titles step up in weight before they
step up in size — 600 at 18px reads calmer than 400 at 24px.

## Layout

Spacing scale is 4, 8, 16, 24, 32, 48. Sections are separated by 48px, not by rules. Content
maxes out around 1100px and is centred; anything wider loses the calm.

## Components

- Buttons: \`radius-md\`, filled for primary, outlined for secondary, plain text for tertiary.
- Cards: a 1px \`border\` at \`radius-xl\`, no shadow, 24px inner padding.
- Inputs: outlined, 40px tall, label above rather than placeholder-only.

## Don'ts

- No dark panels inside a light page.
- No more than one filled button per screen.
- Do not use \`primary\` for decoration or for section headings.
`;

const EDITORIAL_CSS = `@theme {
	--color-primary: #1f2937;
	--color-primary-foreground: #ffffff;
	--color-surface: #fdfcf9;
	--color-surface-raised: #f5f3ee;
	--color-surface-foreground: #1c1b19;
	--color-muted: #6b6862;
	--color-border: #e3ded4;
	--color-accent: #b45309;
	--radius-sm: 2px;
	--radius-md: 3px;
	--radius-xl: 4px;
}
`;

const EDITORIAL_MD = `# Editorial

## Visual theme

A reading surface, not a dashboard. Long-form structure: a strong measure, a clear type
hierarchy, and rules instead of boxes. Corners are nearly square.

## Colour

- \`surface\` is warm off-white. \`surface-raised\` is a slightly deeper tint of the same warm
  family — never grey.
- \`border\` is used as a *rule*: full-width horizontal lines between sections.
- \`primary\` is near-black text and the rare filled button. \`accent\` marks footnotes and the
  active item in a table of contents.

## Typography

Two families: a serif for headings and body, one sans for UI labels and data. Body 17–18px with
line height 1.7 and a measure of 60–75 characters. Headings are the same serif, larger and
heavier — do not switch family to create hierarchy.

## Layout

Content is a single column of at most 720px. Asides and data move *below* the paragraph, not
beside it. Vertical rhythm is generous: 32px between paragraphs, 64px between sections.

## Components

- Links are underlined, always, not only on hover.
- Tables: horizontal rules only, no vertical lines, no zebra striping.
- Buttons are rare; most actions are links.

## Don'ts

- No cards floating on a background.
- No icons standing in for words.
- Do not centre body text.
`;

const PLAYFUL_CSS = `@theme {
	--color-primary: #7c3aed;
	--color-primary-foreground: #ffffff;
	--color-surface: #fef9ff;
	--color-surface-raised: #ffffff;
	--color-surface-foreground: #2e1065;
	--color-muted: #7e6b9a;
	--color-border: #e9d8fd;
	--color-accent: #f472b6;
	--radius-sm: 10px;
	--radius-md: 14px;
	--radius-xl: 24px;
}
`;

const PLAYFUL_MD = `# Playful

## Visual theme

Friendly and rounded. Shapes are soft, colour is warm, and the layout has more air than it
strictly needs. It should feel like something you are allowed to touch.

## Colour

- \`surface\` is a very light tint of \`primary\` rather than white — that is what makes the
  whole page feel related.
- \`primary\` is the filled button and the active state. \`accent\` is for highlights,
  illustrations and celebratory moments.
- \`border\` is a light tint of \`primary\`; it is decorative here, so it may be used freely.

## Typography

One family with generous rounded terminals. Body 15–16px, line height 1.6. Headings are bold
and slightly larger than strictly necessary — that is part of the tone.

## Layout

Spacing scale is 8, 16, 24, 40. Nothing is cramped. Cards sit on \`surface-raised\` with a
corner radius of \`xl\` and a soft shadow to lift them off the tinted page.

## Components

- Buttons: pill-shaped, bold label, a slight lift on hover.
- Cards: \`radius-xl\`, soft shadow, 20px padding, an icon or illustration at the top.
- Empty states get an illustration — this is the style where that is expected.

## Don'ts

- Do not mix in sharp corners; inconsistency here reads as a mistake, not as contrast.
- Do not use \`muted\` for anything the user has to read carefully.
- No dense tables.
`;

/**
 * 目录。顺序就是画廊里的顺序 —— 从最克制到最活泼,那种排列本身就在说明"风格是连续谱"。
 */
export const DESIGN_STYLES: readonly DesignStyle[] = [
  {
    id: "precise-dark",
    name: "深色精密",
    category: "产品界面",
    vibe: "dark",
    tagline: "密集、克制,颜色只用来表达状态",
    themeCss: PRECISE_DARK_CSS,
    designMd: PRECISE_DARK_MD,
  },
  {
    id: "calm-light",
    name: "明亮克制",
    category: "产品界面",
    vibe: "light",
    tagline: "留白承担层级,几乎不需要边框",
    themeCss: CALM_LIGHT_CSS,
    designMd: CALM_LIGHT_MD,
  },
  {
    id: "editorial",
    name: "编辑排版",
    category: "内容页面",
    vibe: "light",
    tagline: "长文优先:宽行距、细横线、近直角",
    themeCss: EDITORIAL_CSS,
    designMd: EDITORIAL_MD,
  },
  {
    id: "playful",
    name: "圆角活泼",
    category: "营销页面",
    vibe: "light",
    tagline: "柔和圆角与暖色,布局比需要的更宽松",
    themeCss: PLAYFUL_CSS,
    designMd: PLAYFUL_MD,
  },
];

export function designStyleById(id: string): DesignStyle | undefined {
  return DESIGN_STYLES.find((style) => style.id === id);
}

/** 画廊卡片需要的字段。不带上 `themeCss` / `designMd` —— 那两个是几 KB 的文本。 */
export function designStyleSummary(style: DesignStyle): {
  id: string;
  name: string;
  category: string;
  vibe: DesignStyleVibe;
  tagline: string;
  /** 供卡片画缩略图用:从 `theme.css` 里抽出来的令牌。 */
  themeCss: string;
} {
  return {
    id: style.id,
    name: style.name,
    category: style.category,
    vibe: style.vibe,
    tagline: style.tagline,
    themeCss: style.themeCss,
  };
}
