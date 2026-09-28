/**
 * 从上游设计模板清单重新生成 `src/main/design/style-catalog-upstream.ts`。
 *
 * 上游清单来自 open-vetta 的 `vetta-design-templates` 资源仓库(.vetta/design-templates.json),
 * 我们的 4 套自撰风格之外的 25 套内置风格就是它的 `kind: "design-system"` 条目。跑这个脚本
 * 等于一次**受审查的依赖更新**,不是无人值守的同步 —— 与 `update-officecli-lock.mjs` 同一取舍。
 *
 *   npm run sync:design-styles --workspace @wordless/desktop
 *   node scripts/sync-design-styles.mjs <本地清单.json>   ← 离线重放:直接读一份存下来的清单
 *
 * ## 三份资源全取,含 demo.html
 *
 * 上游每套带 3 份:`theme.css`(令牌)、`DESIGN.md`(规范)、`demo.html`(整页成品)。三份都进包:
 * **示例页是"这套长什么样"的唯一答案** —— 只给令牌缩略图时,用户分不清二十几套里该选哪个。
 *
 * 它也是安全的:实测 25 份**自包含**(0 个 `<script>`、0 个外链、0 个字体、0 个 iframe),令牌以
 * `:root` 自定义属性内联在同一份文件里("Mirrors theme.css … so this file opens standalone"),
 * 所以渲染它不需要网络,也就不会破"新建设计不依赖网络"那条。
 *
 * 三道检查在下面(`assertSafeDemo` / `assertTokensMirror`),任何一条不过就**拒绝写文件** ——
 * 我们把它塞进 iframe 且禁用脚本,但"上游明天加了一段脚本"不该靠运气发现。
 *
 * ## 对上游正文的三处改动(除此之外逐字保留)
 *
 * 1. 删除指向 `demo.html` 的句子;整段都指向它时整段删掉。
 * 2. H1 去掉 `— Vetta Edition` 后缀:这份 DESIGN.md 会被拷进用户的设计包,那不是产品版本名。
 * 3. `@theme {` → **`@theme static {`**(见下),其余一字不动 —— 出处与许可靠 `theme.css`
 *    的头注释和 third-party-notices 保留。
 *
 * ## 为什么把 `@theme` 改成 `@theme static`
 *
 * Tailwind 4 默认**只发出被用到的**主题变量:声明了 7 个 `--color-*`、帧里的类只用上 3 个时,
 * 产物里就只有那 3 个 —— 于是帧里**手写 `var(--color-primary)` 会静默取不到值**。
 * `static` 让全部声明都发出来。实测(真编译器,候选只有 `bg-surface`):
 *
 *     @theme         → 发出的 color 变量: --color-surface
 *     @theme static  → 发出的 color 变量: --color-primary, --color-surface, --color-danger
 *
 * 按 CSS 工具类写法的帧不受影响(用到的令牌一定会发出),所以这个改动只会**多**产出样式,
 * 不会少。它同时要落在脚手架与本地的 4 套风格上,别只改这里。
 */

import { createHash } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { readFile, writeFile } from "node:fs/promises";

/**
 * 优先 IPv4。
 *
 * 与 `prepare-officecli-assets.mjs` 里给 curl 加 `--http1.1` 同一取舍:实测有网络环境
 * (IPv6 走不通)下 `fetch` 会先撞 IPv6 然后连接超时,而这个脚本是维护时手跑的,报一个
 * "fetch failed" 比报清原因更糟。
 */
setDefaultResultOrder("ipv4first");

const CATALOG_URL =
  "https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json";
const REPOSITORY = "https://github.com/openvetta/vetta-design-templates";
const ADAPTED_FROM = "https://github.com/VoltAgent/awesome-design-md";
const OUTPUT = new URL("../src/main/design/style-catalog-upstream.ts", import.meta.url);

/** 指向成品 demo 的句子。删掉它们,以及只描述 demo 的那一句(见文件头第 1 条)。 */
const DEMO_SENTENCE = /demo\.html|It is a static, offline reference/i;
/** 上游导语用了统一模板:整段都在讲那份 demo,于是整段删掉。 */
const WORKED_EXAMPLE = /^A complete worked example/;
/** 上游 H1 的产品版本后缀。 */
const EDITION_SUFFIX = /\s+[—-]\s+Vetta Edition\s*$/;
/** 每份 theme.css 恰好一个 `@theme` 块;数量不对说明上游换了写法,该来看一眼。 */
const THEME_AT_RULE = /@theme\s*\{/g;
/** 单片示例的字节上限与总量上限:超了说明上游换了形态(比如塞进了位图),该来看一眼。 */
const MAX_DEMO_BYTES = 96 * 1024;
const MAX_DEMO_TOTAL_BYTES = 2 * 1024 * 1024;

/** `--name: value;` 声明。三份资源里都用这个形状。 */
const DECLARATION = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;

function declarationsIn(css) {
	const out = new Map();
	for (const match of css.matchAll(DECLARATION)) out.set(match[1], match[2].trim());
	return out;
}

function blockBody(css, pattern) {
	const match = pattern.exec(css);
	return match ? match[1] : null;
}

/**
 * 示例页必须自包含。
 *
 * 我们把它放进 `sandbox` 的 iframe,但**这里才是能把话说清楚的地方**:沙箱是兜底,而"这份 HTML
 * 里没有任何可执行/可联网的东西"是一条可断言的静态事实。上游那两份 inline SVG 的
 * `xmlns="http://www.w3.org/2000/svg"` 是命名空间声明,不是请求 —— 所以先摘掉再查外链。
 */
function assertSafeDemo(slug, html) {
	if (html.length > MAX_DEMO_BYTES) throw new Error(`${slug}: demo is ${html.length} bytes`);
	const withoutNamespaces = html.replaceAll("http://www.w3.org/", "");
	/*
		内联的 data: URI 要**先摘掉再查相对 url()**。
		glassmorphism 的示例把一小段 SVG 用百分号编码塞进了 `background-image: url("data:…")`,
		而那段编码里有一句 `filter='url(%23n)'` —— 不摘的话,那句编码文本会被当成"引用了相对资源"。
		(摘的时候要按引号配对:`data:` 里可能带单引号,而外面那层引号才是它的结束。)
	*/
	const withoutDataUris = html
		.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/gi, "url(data:)")
		.replace(/url\(\s*data:[^)]*\)/gi, "url(data:)");
	for (const [label, pattern] of [
		["<script", /<script/i],
		["<iframe", /<iframe/i],
		["<link", /<link/i],
		["<object", /<object/i],
		["内联事件处理器", /\son[a-z]+\s*=/i],
		["@import", /@import/i],
		["@font-face", /@font-face/i],
		["外链", /https?:\/\//i],
		["相对资源 url()", /url\(\s*(?!["']?(?:data:|#))/i],
	]) {
		const subject =
			label === "外链" ? withoutNamespaces : label === "相对资源 url()" ? withoutDataUris : html;
		if (pattern.test(subject)) throw new Error(`${slug}: demo has ${label}`);
	}
}

/**
 * 示例页里的令牌必须与 theme.css 一致。
 *
 * 同一套色的两份拷贝就有漂开的一天(上游改了 theme.css 没改 demo,或反过来),而症状是"示例
 * 长这样、写进你设计里的却是另一套色" —— 那正是这张卡要回答的问题被答错。只比**两边都声明
 * 过**的键:geometric-bold 的示例按设计省略了零值圆角(它用字面量 0),那不算漂移。
 */
function assertTokensMirror(slug, themeCss, demoHtml) {
	const theme = declarationsIn(blockBody(themeCss, /@theme\s*\{([\s\S]*?)\}/) ?? themeCss);
	const demo = declarationsIn(blockBody(demoHtml, /:root\s*\{([\s\S]*?)\}/) ?? demoHtml);
	const drifted = [...theme]
		.filter(([name, value]) => demo.has(name) && demo.get(name) !== value)
		.map(([name, value]) => `${name}: theme=${value} demo=${demo.get(name)}`);
	if (drifted.length > 0) throw new Error(`${slug}: demo tokens drifted from theme.css — ${drifted.join("; ")}`);
}

/**
 * `@theme {` → `@theme static {`。
 *
 * 不 `static` 的话 Tailwind 只发出**被用到**的主题变量,帧里手写 `var(--color-*)` 会静默
 * 取不到值(见文件头)。计数是刻意的:上游哪天写成两个 `@theme` 块,这里该炸掉,而不是
 * 静默改一半。
 */
function forceStaticTheme(themeCss) {
  const count = themeCss.match(THEME_AT_RULE)?.length ?? 0;
  if (count !== 1) throw new Error(`Expected exactly one @theme block, found ${count}`);
  return themeCss.replace(THEME_AT_RULE, "@theme static {");
}

/**
 * 清单原文。给了参数就当本地快照读,否则联网取。
 *
 * 两条路都要:联网那条是常态(清单随时在更新),而**离线重放**在两个场景里是必须的 —— 网络不通
 * 时的一次重新生成,以及"这份生成物到底出自哪份清单"的复核(生成物头里记着 sha256,拿同一份
 * 文件重放应当逐字节一致)。
 */
const localCatalogPath = process.argv[2];
const raw = localCatalogPath
	? await readFile(localCatalogPath, "utf8")
	: await (async () => {
			const response = await fetch(CATALOG_URL);
			if (!response.ok) throw new Error(`Unable to download the design template catalog (${response.status})`);
			return await response.text();
		})();
const catalog = JSON.parse(raw);

if (catalog.schemaVersion !== 1) throw new Error(`Unsupported catalog schemaVersion ${catalog.schemaVersion}`);
if (!Array.isArray(catalog.templates)) throw new Error("Catalog has no templates array");

function resourceOf(entry, role) {
  const hit = entry.resources?.find((resource) => resource?.role === role);
  return hit && typeof hit.content === "string" ? hit.content : null;
}

/**
 * 处理 H1 之后那段导语,返回替换文本:`null` = 原样保留,`""` = 整段删掉。
 *
 * 25 套里 24 套用的是统一模板("A complete worked example … as `demo.html`"),整段都在讲
 * 那份成品,所以整段删。剩下那套(meadow-buddies)的导语是风格自述开头、中间夹一句 demo
 * 说明,于是只删指着 demo 的句子。
 */
function stripDemoParagraph(paragraph) {
  if (!DEMO_SENTENCE.test(paragraph)) return null;
  if (WORKED_EXAMPLE.test(paragraph)) return "";
  return paragraph
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !DEMO_SENTENCE.test(sentence))
    .join(" ")
    .trim();
}

function transformSpec(spec) {
  const lines = spec.replaceAll("\r\n", "\n").split("\n");
  if (!lines[0].startsWith("# ")) throw new Error("Spec does not start with an H1");
  lines[0] = lines[0].replace(EDITION_SUFFIX, "");

  // 导语是 H1 之后的第一段("A complete worked example … as `demo.html`" 或同类自述)。
  const start = lines.findIndex((line, index) => index > 0 && line.trim() !== "");
  if (start > 0) {
    const end = lines.findIndex((line, index) => index > start && line.trim() === "");
    const body = lines.slice(start, end === -1 ? lines.length : end).join(" ");
    const kept = stripDemoParagraph(body);
    if (kept === "") {
      lines.splice(start, (end === -1 ? lines.length : end + 1) - start);
    } else if (kept !== null) {
      lines.splice(start, (end === -1 ? lines.length : end) - start, kept);
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** 模板字面量里的反引号与 `${` 必须转义,否则生成的 TS 会当场语法错误。 */
function asTemplate(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}

const entries = [];
const rejected = [];
for (const entry of catalog.templates) {
  if (entry?.kind !== "design-system") continue;
  const slug = entry.slug;
  const rawThemeCss = resourceOf(entry, "theme");
  const spec = resourceOf(entry, "spec");
  const demoHtml = resourceOf(entry, "demo");
  const name = entry.name;
  const category = entry.category;
  const vibe = entry.vibe;
  if (
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof category !== "string" ||
    (vibe !== "light" && vibe !== "dark") ||
    rawThemeCss === null ||
    spec === null ||
    demoHtml === null
  ) {
    rejected.push(String(slug ?? entry));
    continue;
  }
  const themeCss = forceStaticTheme(rawThemeCss);
  const designMd = transformSpec(spec);
  assertSafeDemo(slug, demoHtml);
  assertTokensMirror(slug, themeCss, demoHtml);
  // `tagline` 是中文兜底;展示文案在 i18n(designStyleTagline*),这里只保证字段非空。
  const tagline = entry.tagline?.zh ?? entry.blurb;
  if (typeof tagline !== "string" || tagline.trim() === "") {
    rejected.push(slug);
    continue;
  }
  if (demoStillReferenced(designMd)) rejected.push(`${slug}(demo)`);
  entries.push({
    slug,
    order: typeof entry.order === "number" ? entry.order : 999,
    name,
    category,
    vibe,
    tagline: tagline.trim(),
    themeCss,
    designMd,
    demoHtml,
  });
}

function demoStillReferenced(text) {
  return /demo\.html/.test(text);
}

if (rejected.length > 0) throw new Error(`Refusing to write a catalog with rejected entries: ${rejected.join(", ")}`);
entries.sort((left, right) => left.order - right.order || left.slug.localeCompare(right.slug));

const constantName = (slug) =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

const blocks = entries.map((entry) => {
  const id = constantName(entry.slug);
  return [
    `const ${id}_THEME = \`${asTemplate(entry.themeCss)}\`;`,
    "",
    `const ${id}_SPEC = \`${asTemplate(entry.designMd)}\`;`,
    "",
    `const ${id}_DEMO = \`${asTemplate(entry.demoHtml)}\`;`,
    "",
  ].join("\n");
});

const list = entries
  .map((entry) =>
    [
      "\t{",
      `\t\tid: "${entry.slug}",`,
      `\t\tname: ${JSON.stringify(entry.name)},`,
      `\t\tcategory: "${entry.category}",`,
      `\t\tvibe: "${entry.vibe}",`,
      `\t\ttagline: ${JSON.stringify(entry.tagline)},`,
      `\t\tthemeCss: ${constantName(entry.slug)}_THEME,`,
      `\t\tdesignMd: ${constantName(entry.slug)}_SPEC,`,
      `\t\tdemoHtml: ${constantName(entry.slug)}_DEMO,`,
      "\t},",
    ].join("\n"),
  )
  .join("\n");

const sourceBytes = createHash("sha256").update(raw).digest("hex");
const header = `/**
 * 内置风格目录的上游部分 —— **本文件由脚本生成,不要手改**。
 *
 *     npm run sync:design-styles --workspace @wordless/desktop
 *
 * 生成器在 \`apps/desktop/scripts/sync-design-styles.mjs\`,那里写了取值范围、对正文的三处
 * 改动,以及为什么不要 \`demo.html\`。这里只记事实:
 *
 * | 字段 | 值 |
 * |---|---|
 * | 来源 | \`${REPOSITORY}\` |
 * | 清单 | \`.vetta/design-templates.json\` |
 * | catalogVersion | \`${catalog.catalogVersion}\` |
 * | 清单 sha256 | \`${sourceBytes}\` |
 * | 改编自 | \`${ADAPTED_FROM}\`(MIT) |
 * | 条目数 | ${entries.length} |
 * | 示例页 | 每套一份 \`demo.html\`,合计约 ${Math.round(entries.reduce((sum, entry) => sum + entry.demoHtml.length, 0) / 1024)} KB |
 *
 * 许可与署名见 \`THIRD_PARTY_NOTICES.md\` 与 \`resources/third-party-notices/\`。
 */

import type { DesignStyle } from "./style-catalog.ts";

`;

const footer = `\n/** 上游 25 套,顺序即清单的 \`order\`(按风格差异交错排,便于横看时相邻两张差别明显)。 */\nexport const UPSTREAM_DESIGN_STYLES: readonly DesignStyle[] = [\n${list}\n];\n`;

await writeFile(OUTPUT, `${header}${blocks.join("\n")}${footer}`, "utf8");

const specBytes = entries.reduce((sum, entry) => sum + entry.themeCss.length + entry.designMd.length, 0);
const demoBytes = entries.reduce((sum, entry) => sum + entry.demoHtml.length, 0);
if (demoBytes > MAX_DEMO_TOTAL_BYTES) throw new Error(`Demos total ${demoBytes} bytes`);
console.log(`Wrote ${entries.length} upstream design styles from catalogVersion ${catalog.catalogVersion}.`);
console.log(`Payload: ${Math.round(specBytes / 1024)} KB of theme.css + DESIGN.md, ${Math.round(demoBytes / 1024)} KB of demo.html.`);
