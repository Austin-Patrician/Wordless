/**
 * 内置风格目录的上游部分 —— **本文件由脚本生成,不要手改**。
 *
 *     npm run sync:design-styles --workspace @wordless/desktop
 *
 * 生成器在 `apps/desktop/scripts/sync-design-styles.mjs`,那里写了取值范围、对正文的三处
 * 改动,以及为什么不要 `demo.html`。这里只记事实:
 *
 * | 字段 | 值 |
 * |---|---|
 * | 来源 | `https://github.com/openvetta/vetta-design-templates` |
 * | 清单 | `.vetta/design-templates.json` |
 * | catalogVersion | `2026.08.31-4` |
 * | 清单 sha256 | `066b4a3f8fe0cc650bc68704bf5695ee0632f90839c54b362a0d78fba40c2a58` |
 * | 改编自 | `https://github.com/VoltAgent/awesome-design-md`(MIT) |
 * | 条目数 | 25 |
 * | 示例页 | 每套一份 `demo.html`,合计约 596 KB |
 *
 * 许可与署名见 `THIRD_PARTY_NOTICES.md` 与 `resources/third-party-notices/`。
 */

import type { DesignStyle } from "./style-catalog.ts";

const Linear_THEME = `/* Linear — dark, dense, engineered calm. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #5e6ad2;
	--color-primary-foreground: #ffffff;
	--color-surface: #08090a;
	--color-surface-foreground: #f7f8f8;
	--color-surface-raised: #131416;
	--color-muted: #8a8f98;
	--color-accent: #26b5ce;
	--color-danger: #eb5757;
	--color-border: #26282d;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);
	--shadow-md: 0 4px 16px rgb(0 0 0 / 0.5);
	--shadow-lg: 0 16px 48px rgb(0 0 0 / 0.6);
}
`;

const Linear_SPEC = `# Linear

## Atmosphere
Engineered calm. A near-black workspace where information is dense but never
noisy; everything feels fast, precise, and slightly luminous. The UI recedes,
the work glows.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is the page; \`surface-raised\` for cards, popovers, sidebars.
- \`primary\` (soft indigo) only on the main action and active states.
- \`accent\` (cyan) is rare: live indicators, links, one highlight per screen.
- Text is \`surface-foreground\`; secondary text and icons are \`muted\`.
- Hairline \`border\` separates zones; prefer borders over shadows for structure.

## Typography
System font stack only. Tight and technical:
- Headings: \`font-semibold tracking-tight\`, sizes 15–24px. Never oversized.
- Body 13–14px, \`text-muted\` for metadata at 12px.
- Monospace (\`font-mono\`) for ids, shortcuts, counts.

## Shape & depth
- Radius scale is small (\`rounded-md\`/\`rounded-lg\` ≈ 6–8px). No pills except tags.
- Depth comes from \`surface-raised\` + 1px \`border\`, not big shadows.
- \`shadow-lg\` reserved for popovers/dialogs floating above the canvas.

## Components
- Buttons: compact (h-8), \`rounded-md\`, subtle; primary is filled indigo, the
  rest are ghost with hover \`bg-surface-raised\`.
- Inputs: dark field with 1px border, focus ring in \`primary/40\`.
- Lists/tables are the heart: 36–40px rows, hairline dividers, right-aligned
  meta, tiny status dots in \`accent\`/\`danger\`.
- Keyboard hints everywhere: bordered \`font-mono\` keycaps.

## Layout
High density, strict alignment. Sidebar 220–240px, content in a single wide
column. Spacing rhythm 4/8/12/16; section gaps 24px max. No hero whitespace.

## Don'ts
- No pure white anywhere; the brightest text is \`#f7f8f8\`.
- No colorful gradients, no more than one accent per view.
- No large rounded cards or soft floating shadows — this is not a marketing page.
`;

const Linear_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Linear — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #5e6ad2;
		--color-primary-foreground: #ffffff;
		--color-surface: #08090a;
		--color-surface-foreground: #f7f8f8;
		--color-surface-raised: #131416;
		--color-muted: #8a8f98;
		--color-accent: #26b5ce;
		--color-danger: #eb5757;
		--color-border: #26282d;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);
		--shadow-md: 0 4px 16px rgb(0 0 0 / 0.5);
		--shadow-lg: 0 16px 48px rgb(0 0 0 / 0.6);

		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.55;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
	p { margin: 0; }
	::selection { background: rgb(94 106 210 / 0.4); }

	.wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 80px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 112px; } }

	/* ── Section scaffold: nothing is oversized, ever ─────────────── */
	.section { padding-top: 48px; }
	@media (min-width: 768px) { .section { padding-top: 72px; } }
	.section-label {
		font-family: var(--mono);
		font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
		color: var(--color-accent);
		margin-bottom: 10px;
	}
	.section h2 { font-size: 20px; }
	@media (min-width: 768px) { .section h2 { font-size: 24px; } }
	.lede { color: var(--color-muted); max-width: 62ch; margin-top: 8px; font-size: 13px; }
	.note { margin-top: 16px; font-size: 12px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

	/* ── The product surface: this IS the demo, not a hero banner ─── */
	.app {
		border-bottom: 1px solid var(--color-border);
		display: grid;
		grid-template-columns: 1fr;
	}
	@media (min-width: 900px) { .app { grid-template-columns: 232px 1fr; } }

	.side { display: none; border-right: 1px solid var(--color-border); background: var(--color-surface); padding: 12px 8px; }
	@media (min-width: 900px) { .side { display: block; } }
	.side-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 14px; }
	.logomark {
		width: 20px; height: 20px; border-radius: var(--radius-sm);
		background: linear-gradient(140deg, #5e6ad2, #26b5ce);
	}
	.side-head b { font-size: 13px; font-weight: 600; }
	.side-group { font-size: 11px; color: var(--color-muted); padding: 14px 8px 6px; letter-spacing: 0.04em; }
	.nav {
		display: flex; align-items: center; gap: 8px;
		padding: 6px 8px; border-radius: var(--radius-md);
		font-size: 13px; color: var(--color-muted);
	}
	.nav .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; }
	.nav .count { margin-left: auto; font-family: var(--mono); font-size: 11px; }
	.nav.is-active { background: var(--color-surface-raised); color: var(--color-surface-foreground); }

	.main { min-width: 0; }
	.toolbar {
		display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
		min-height: 44px; padding: 6px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	@media (min-width: 768px) { .toolbar { padding: 0 20px; } }
	.toolbar h1 { font-size: 14px; font-weight: 600; }
	.spacer { flex: 1; }

	/* Rows are the heart of the system: 38px, hairline dividers, no cards. */
	.issue {
		display: flex; align-items: center; gap: 10px;
		height: 38px; padding: 0 12px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}
	@media (min-width: 768px) { .issue { padding: 0 20px; } }
	.issue:hover { background: var(--color-surface-raised); }
	.pri { width: 12px; display: flex; align-items: flex-end; gap: 1px; height: 10px; flex: none; }
	.pri i { width: 3px; background: var(--color-muted); border-radius: 1px; display: block; }
	.pri i:nth-child(1) { height: 4px; } .pri i:nth-child(2) { height: 7px; } .pri i:nth-child(3) { height: 10px; }
	.pri.low i:nth-child(2), .pri.low i:nth-child(3) { opacity: 0.25; }
	.pri.mid i:nth-child(3) { opacity: 0.25; }
	.st { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--color-muted); flex: none; }
	.st.started { border-color: #f2c94c; background: conic-gradient(#f2c94c 50%, transparent 0); }
	.st.done { border-color: var(--color-primary); background: var(--color-primary); }
	.st.blocked { border-color: var(--color-danger); }
	.id { font-family: var(--mono); font-size: 12px; color: var(--color-muted); flex: none; width: 62px; }
	.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tag {
		flex: none; font-size: 11px; padding: 1px 8px; border-radius: 9999px;
		border: 1px solid var(--color-border); color: var(--color-muted);
	}
	.tag.live { color: var(--color-accent); border-color: rgb(38 181 206 / 0.4); }
	.when { flex: none; font-family: var(--mono); font-size: 11px; color: var(--color-muted); }
	.who {
		flex: none; width: 20px; height: 20px; border-radius: 50%;
		background: var(--color-surface-raised); border: 1px solid var(--color-border);
		font-size: 10px; display: grid; place-items: center; color: var(--color-muted);
	}
	@media (max-width: 640px) { .issue .tag, .issue .when { display: none; } }

	/* ── Controls ─────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 13px; font-weight: 500;
		height: 32px; padding: 0 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: transparent; color: var(--color-surface-foreground);
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease;
	}
	.btn:hover { background: var(--color-surface-raised); }
	.btn:focus-visible { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgb(94 106 210 / 0.35); }
	.btn-primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-primary-foreground); }
	.btn-primary:hover { background: #6b76d8; }
	.btn-ghost { border-color: transparent; color: var(--color-muted); }
	.btn-ghost:hover { color: var(--color-surface-foreground); }
	.btn-sm { height: 26px; padding: 0 9px; font-size: 12px; }
	.btn[disabled] { cursor: not-allowed; color: #4b4f57; border-color: #1c1e22; background: transparent; }

	kbd {
		font-family: var(--mono); font-size: 11px; line-height: 18px;
		min-width: 20px; height: 20px; padding: 0 5px; display: inline-block; text-align: center;
		border: 1px solid var(--color-border); border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-raised); color: var(--color-muted);
	}

	.input {
		font: inherit; font-size: 13px; width: 100%; max-width: 380px;
		height: 32px; padding: 0 10px;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #5c6068; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgb(94 106 210 / 0.3); }

	/* ── Panels: raised fill + hairline, never a soft floating card ─ */
	.panels { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 20px; }
	@media (min-width: 768px) { .panels { grid-template-columns: repeat(3, 1fr); } }
	.panel {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 14px 16px;
	}
	.panel h3 { font-size: 13px; }
	.panel p { margin-top: 6px; font-size: 12px; color: var(--color-muted); }
	.metric { font-family: var(--mono); font-size: 22px; letter-spacing: -0.02em; }

	/* Popover is the ONLY place a big shadow is allowed. */
	.canvas {
		margin-top: 20px; padding: 32px 16px;
		border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		background: repeating-linear-gradient(45deg, #0a0b0c 0 10px, #0c0d0f 10px 20px);
	}
	.popover {
		max-width: 420px; margin: 0 auto;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	.popover .q { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--color-border); color: var(--color-muted); font-size: 13px; }
	.opt { display: flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 13px; color: var(--color-muted); }
	.opt.is-active { background: rgb(94 106 210 / 0.16); color: var(--color-surface-foreground); }
	.opt .k { margin-left: auto; }

	/* ── Swatches ─────────────────────────────────────────────────── */
	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 20px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
	.sw .fill { height: 52px; }
	.sw .meta { padding: 8px 10px; background: var(--color-surface-raised); }
	.sw b { font-family: var(--mono); font-size: 11px; font-weight: 500; display: block; }
	.sw span { font-size: 11px; color: var(--color-muted); }

	/* ── Mobile: the same density, re-stacked ─────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 24px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 300px 1fr; gap: 40px; } }
	.phone {
		width: 300px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border);
		border-radius: 28px;
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	.phone-status {
		display: flex; align-items: center; justify-content: space-between;
		padding: 8px 16px 4px; font-family: var(--mono); font-size: 10px; color: var(--color-muted);
	}
	.phone-head { display: flex; align-items: center; gap: 8px; padding: 6px 14px 10px; border-bottom: 1px solid var(--color-border); }
	.phone-head b { font-size: 13px; font-weight: 600; }
	/* Rows keep their 38px desktop height but drop meta columns — density is
	   the brand, so it survives the breakpoint; only the extras leave. */
	.m-issue { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; border-bottom: 1px solid var(--color-border); font-size: 13px; }
	.m-issue .title { font-size: 13px; }
	.m-sub { font-family: var(--mono); font-size: 10px; color: var(--color-muted); }
	.tabbar { display: flex; border-top: 1px solid var(--color-border); background: var(--color-surface-raised); }
	.tabbar div { flex: 1; text-align: center; padding: 10px 0 14px; font-size: 10px; color: var(--color-muted); }
	.tabbar div.is-active { color: var(--color-surface-foreground); box-shadow: inset 0 1px 0 var(--color-primary); }
	.tabbar .glyph { display: block; width: 14px; height: 14px; margin: 0 auto 4px; border: 1.5px solid currentColor; border-radius: 3px; }
	.tabbar div.is-active .glyph { border-color: var(--color-primary); }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 10px 0; border-bottom: 1px solid var(--color-border); font-size: 13px; color: var(--color-muted); display: flex; gap: 12px; }
	.rules b { color: var(--color-surface-foreground); font-weight: 500; flex: none; width: 116px; font-size: 12px; font-family: var(--mono); }
	@media (max-width: 520px) { .rules li { display: block; } .rules b { width: auto; margin-bottom: 2px; } }

	/* ── Off-style comparison ─────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 20px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 24px; border-radius: 20px;
		background: linear-gradient(140deg, #2b2f6b, #6c3fa6);
		box-shadow: 0 18px 40px rgb(94 106 210 / 0.4);
		color: #fff; font-size: 20px; font-weight: 700;
	}
	.cmp-off small { display: block; font-size: 12px; font-weight: 400; opacity: 0.75; margin-top: 8px; }
	.cmp-on { padding: 14px 16px; border-radius: var(--radius-lg); background: var(--color-surface-raised); border: 1px solid var(--color-border); font-size: 13px; }
	.cmp-on small { display: block; font-size: 12px; color: var(--color-muted); margin-top: 6px; }
</style>
</head>
<body>

<!-- COVER — the hover preview lands on the product itself: sidebar, dense rows,
     one indigo action. No marketing hero exists in this system. -->
<div class="app">
	<aside class="side">
		<div class="side-head"><span class="logomark"></span><b>Vetta</b><span class="spacer"></span><kbd>⌘K</kbd></div>
		<div class="nav is-active"><span class="dot" style="background:var(--color-accent)"></span>Inbox<span class="count">12</span></div>
		<div class="nav"><span class="dot"></span>My issues<span class="count">7</span></div>
		<div class="nav"><span class="dot"></span>Views</div>
		<div class="side-group">Workspace</div>
		<div class="nav"><span class="dot"></span>Core<span class="count">48</span></div>
		<div class="nav"><span class="dot"></span>Platform<span class="count">31</span></div>
		<div class="nav"><span class="dot"></span>Design<span class="count">9</span></div>
		<div class="side-group">Cycle 24</div>
		<div class="nav"><span class="dot" style="background:#f2c94c"></span>In progress<span class="count">5</span></div>
		<div class="nav"><span class="dot" style="background:var(--color-danger)"></span>Blocked<span class="count">1</span></div>
	</aside>

	<main class="main">
		<div class="toolbar">
			<h1>Cycle 24</h1>
			<span class="tag live">Live</span>
			<span class="spacer"></span>
			<button class="btn btn-ghost btn-sm">Filter</button>
			<button class="btn btn-ghost btn-sm">Group</button>
			<button class="btn btn-primary btn-sm">New issue</button>
		</div>
		<div class="issue"><span class="pri"><i></i><i></i><i></i></span><span class="st started"></span><span class="id">VET-482</span><span class="title">Command palette should keep focus after a nested action</span><span class="tag">Core</span><span class="when">2h</span><span class="who">KM</span></div>
		<div class="issue"><span class="pri mid"><i></i><i></i><i></i></span><span class="st"></span><span class="id">VET-479</span><span class="title">Virtualize the issue list above 500 rows</span><span class="tag">Platform</span><span class="when">5h</span><span class="who">AR</span></div>
		<div class="issue"><span class="pri"><i></i><i></i><i></i></span><span class="st blocked"></span><span class="id">VET-476</span><span class="title">Sync conflict when two clients edit the same title</span><span class="tag">Core</span><span class="when">1d</span><span class="who">JS</span></div>
		<div class="issue"><span class="pri low"><i></i><i></i><i></i></span><span class="st done"></span><span class="id">VET-471</span><span class="title">Hairline dividers render at 0.5px on retina</span><span class="tag">Design</span><span class="when">2d</span><span class="who">MO</span></div>
		<div class="issue"><span class="pri mid"><i></i><i></i><i></i></span><span class="st started"></span><span class="id">VET-468</span><span class="title">Keyboard shortcut sheet is missing the cycle switcher</span><span class="tag">Design</span><span class="when">3d</span><span class="who">KM</span></div>
		<div class="issue"><span class="pri low"><i></i><i></i><i></i></span><span class="st"></span><span class="id">VET-465</span><span class="title">Reduce first paint of the inbox to under 200ms</span><span class="tag">Platform</span><span class="when">4d</span><span class="who">AR</span></div>
	</main>
</div>

<div class="wrap">

	<!-- 01 DENSITY -->
	<section class="section">
		<p class="section-label">01 — Density</p>
		<h2>The list is the interface</h2>
		<p class="lede">Rows are 38px with hairline dividers and no card around them. Every
			column has a fixed job: priority bars, status ring, mono id, title, team, age, assignee.
			Nothing floats, nothing is centered, and there is no hero whitespace anywhere.</p>
		<div class="panels">
			<div class="panel"><div class="metric">38px</div><p>Row height. Comfortable is 40px, compact is 32px — those are the only three.</p></div>
			<div class="panel"><div class="metric">4 / 8 / 12</div><p>The whole spacing rhythm. Section gaps stop at 24px.</p></div>
			<div class="panel"><div class="metric">1px</div><p>Border weight. Structure comes from borders, not shadows.</p></div>
		</div>
	</section>

	<!-- 02 COLOR -->
	<section class="section">
		<p class="section-label">02 — Color roles</p>
		<h2>One indigo, one cyan, everything else is gray</h2>
		<p class="lede">Indigo marks the single primary action and active state. Cyan appears at
			most once per view — a live indicator or a link. Red is reserved for a real failure.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><div class="meta"><b>primary</b><span>#5e6ad2 · one action</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><div class="meta"><b>accent</b><span>#26b5ce · live, links</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><div class="meta"><b>surface-raised</b><span>#131416 · panels</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><div class="meta"><b>danger</b><span>#eb5757 · blocked</span></div></div>
		</div>
		<p class="note">The brightest value in the system is #f7f8f8. Pure white never appears — not in text, not in a fill, not in an icon.</p>
	</section>

	<!-- 03 CONTROLS -->
	<section class="section">
		<p class="section-label">03 — Controls &amp; keys</p>
		<h2>32px tall, quiet until you need them</h2>
		<div class="row" style="margin-top: 20px;">
			<button class="btn btn-primary">Create issue</button>
			<button class="btn">Assign</button>
			<button class="btn btn-ghost">Cancel</button>
			<button class="btn" disabled>Merged</button>
		</div>
		<div class="row" style="margin-top: 16px;">
			<input class="input" placeholder="Filter issues…">
			<span style="font-size:12px;color:var(--color-muted)">or press <kbd>/</kbd></span>
		</div>
		<div class="row" style="margin-top: 20px; gap: 16px; font-size: 12px; color: var(--color-muted);">
			<span><kbd>C</kbd> new issue</span>
			<span><kbd>⌘</kbd><kbd>K</kbd> palette</span>
			<span><kbd>G</kbd><kbd>I</kbd> go to inbox</span>
			<span><kbd>⇧</kbd><kbd>?</kbd> shortcuts</span>
		</div>
		<p class="note">Keycaps are bordered mono with a 2px bottom edge. Every action shown in a menu carries its shortcut — the mouse is the fallback path, not the primary one.</p>
	</section>

	<!-- 04 OVERLAY -->
	<section class="section">
		<p class="section-label">04 — Overlay</p>
		<h2>Shadows exist for exactly one thing</h2>
		<p class="lede">Popovers, menus and dialogs float above the canvas with <code style="font-family:var(--mono);font-size:12px">shadow-lg</code>.
			Anything that lives inside the page uses a border instead.</p>
		<div class="canvas">
			<div class="popover">
				<div class="q">Change status…<span class="spacer"></span><kbd>esc</kbd></div>
				<div class="opt is-active"><span class="st started"></span>In progress<span class="k"><kbd>2</kbd></span></div>
				<div class="opt"><span class="st"></span>Todo<span class="k"><kbd>1</kbd></span></div>
				<div class="opt"><span class="st done"></span>Done<span class="k"><kbd>3</kbd></span></div>
				<div class="opt"><span class="st blocked"></span>Blocked<span class="k"><kbd>4</kbd></span></div>
			</div>
		</div>
	</section>

	<!-- 05 MOBILE -->
	<section class="section">
		<p class="section-label">05 — Mobile</p>
		<h2>Density survives the breakpoint</h2>
		<p class="lede">The phone build is not a softer version of the app. The row keeps its
			structure and only sheds columns; the sidebar becomes a tab bar; the keyboard layer
			becomes a long-press menu. Nothing grows rounder or more colorful on a small screen.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-head"><span class="logomark"></span><b>Cycle 24</b><span class="spacer"></span><span class="tag live">Live</span></div>
				<div class="m-issue"><span class="st started"></span><span class="title">Command palette focus<br><span class="m-sub">VET-482 · Core · 2h</span></span></div>
				<div class="m-issue"><span class="st"></span><span class="title">Virtualize issue list<br><span class="m-sub">VET-479 · Platform · 5h</span></span></div>
				<div class="m-issue"><span class="st blocked"></span><span class="title">Sync conflict on title<br><span class="m-sub">VET-476 · Core · 1d</span></span></div>
				<div class="m-issue"><span class="st done"></span><span class="title">Hairline at 0.5px<br><span class="m-sub">VET-471 · Design · 2d</span></span></div>
				<div class="m-issue"><span class="st started"></span><span class="title">Shortcut sheet gap<br><span class="m-sub">VET-468 · Design · 3d</span></span></div>
				<div class="tabbar">
					<div class="is-active"><span class="glyph"></span>Inbox</div>
					<div><span class="glyph"></span>Issues</div>
					<div><span class="glyph"></span>Cycles</div>
					<div><span class="glyph"></span>You</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>&lt; 900px</b><span>Sidebar collapses into a four-item bottom tab bar. The workspace switcher moves into the header.</span></li>
				<li><b>&lt; 640px</b><span>Team tag and age column drop out of the row; both move under the title as one mono metadata line.</span></li>
				<li><b>Row height</b><span>38px → 44px. The only concession to touch: the target grows, the type size does not.</span></li>
				<li><b>Gutters</b><span>20px page padding instead of 32px. Rows still run edge to edge — no inset cards on mobile.</span></li>
				<li><b>Actions</b><span>Hover affordances have no equivalent, so status and assignee move to a long-press sheet with the same option order as the desktop popover.</span></li>
				<li><b>Type floor</b><span>13px body, 10px mono metadata. Nothing scales up to "mobile friendly" sizes.</span></li>
			</ul>
		</div>
	</section>

	<!-- 06 DON'T -->
	<section class="section">
		<p class="section-label">06 — Off-style, for contrast</p>
		<h2>What breaks the calm</h2>
		<div class="compare">
			<div class="cmp-off">Big gradient card
				<small>20px radius · purple-to-indigo gradient · glowing colored shadow · 20px bold heading in a marketing voice. All four are out.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>8px radius, flat raised fill, 1px border, 13px text. If it groups content inside the page, it gets a border — never a glow.</small></div>
		</div>
		<p class="note">Also out: pure white, a second accent hue, pill-shaped buttons, and any animation longer than 150ms.</p>
	</section>

</div>
</body>
</html>
`;

const DoodlePop_THEME = `/* Doodle Pop — lime × black sticker energy: thick ink borders, hard offset shadows,
 * polka-dot textures, coral/lavender/sky pastel pops. Original Vetta preset. */
@theme static {
	--color-primary: #d6f437;
	--color-primary-foreground: #111111;
	--color-surface: #c8e93c;
	--color-surface-foreground: #111111;
	--color-surface-raised: #ffffff;
	--color-muted: #55584a;
	--color-accent: #f4794f;
	--color-danger: #ef3b5d;
	--color-border: #111111;
	--color-cream: #f2f0e6;
	--color-lavender: #b39df3;
	--color-sky: #8ed8e8;
	--color-ink: #111111;

	--radius-sm: 8px;
	--radius-md: 12px;
	--radius-lg: 16px;
	--radius-xl: 20px;
	--radius-2xl: 28px;

	--shadow-sm: 2px 2px 0 #111111;
	--shadow-md: 4px 4px 0 #111111;
	--shadow-lg: 7px 7px 0 #111111;
}
`;

const DoodlePop_SPEC = `# Doodle Pop

## Atmosphere
A sticker sheet come to life. Vivid lime stage, cream screens, cards outlined
in thick black ink, hard paper-cut shadows, polka-dot textures and pastel
pops. Playful game-shop energy — drops, collectibles, dashboards that grin.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is the loud lime stage — own it, don't hide it. Screen interiors
  (phone/panel content areas) sit on \`cream\`.
- \`surface-raised\` (white) for cards; \`ink\` (#111) for text, borders, shadows
  and the occasional BLACK hero card (white text + one lime element on it).
- \`primary\` (bright lime) fills CTAs — always with black text.
- \`accent\` (coral) is the second loud voice: hero banners, filter buttons,
  toggles, one coral moment per screen.
- \`lavender\` and \`sky\` are quieter pastels for icon tiles, illustration
  fills and rotating card art; \`danger\` (bubblegum red) for hearts/urgency.
- Icon tiles rotate through lime / coral / lavender / sky — never two
  neighbors in the same color.

## Signature texture: polka dots
The anti-monotony ingredient — use it, but as seasoning:
- Dot pattern via CSS, inline-style the two background props:
  \`backgroundImage: radial-gradient(<dot> 1.5px, transparent 1.5px)\`,
  \`backgroundSize: 10px 10px\` (dot = \`ink\` at 25–40% via color-mix, or lime
  on dark).
- Where: a dotted circle peeking from a hero card's corner (clipped by
  \`overflow-hidden\`), a dotted wash filling a colored banner, one big dotted
  pastel circle bleeding off the screen edge on sparse layouts.
- One or two dotted areas per screen — texture, not wallpaper.

## Typography
System font stack only. Comic confidence:
- Headings \`font-extrabold\` 22–36px, often ending with a coral period
  ("Images**.**"); tiny eyebrow labels 11px \`font-bold uppercase
  tracking-[0.2em] text-muted\`.
- Body 14–15px \`font-medium\`; labels 12px \`font-bold\`.
- Numbers (prices, counters, stats) \`font-extrabold tabular-nums\`; \`font-mono\`
  for tags/versions (\`:latest\`, subnets).

## Shape & depth
- THE signature: every card/button/chip gets \`border-2 border-border\`
  (thick black) + a HARD offset shadow (\`shadow-sm\`/\`shadow-md\`, zero blur).
- Generous radii (\`rounded-xl\`/\`rounded-2xl\`); icon tiles \`rounded-xl\`,
  stickers and dotted circles \`rounded-full\`.
- Press interaction: on hover/active, translate 1–2px toward the shadow and
  shrink the shadow one step — the paper-cut "press".

## Components
- Buttons: h-11 \`rounded-xl border-2\` black-outlined + \`shadow-sm\`; primary
  lime fill/black bold label; secondary white; coral variant for filters.
- Cards: white, \`border-2\`, \`shadow-md\`, 12–16px padding; list cards carry a
  colored icon tile (black-outlined) + name + \`font-mono\` meta + hairline-free
  black divider rows.
- Hero/stat banners: black or coral \`rounded-2xl\` cards with white/black bold
  numbers and a dotted circle detail.
- Toggles: black-outlined pills, ON = lime fill with black knob.
- Price/timer tags: black-bordered lime or white pills, \`font-extrabold\`.
- Sprinkle tiny ink doodles (stars ✦, hearts, squiggles) on the lime stage —
  never inside cards.

## Layout
Card-stack playfulness: slight rotations (\`rotate-1\`/\`-rotate-2\`) on stacked
promo cards, straight alignment for content grids and lists. Spacing
12/16/24; let lime or cream breathe between cards. Mobile-first compositions
welcome.

## Don'ts
- No thin/gray borders and no soft blurred shadows — ink lines and hard
  offsets only.
- Never put lime text on lime; long copy lives on white/cream, never on the
  raw lime stage.
- Dots are decoration: never behind body text, never more than two dotted
  areas per screen.
- No corporate minimalism: a screen with no dots, no doodle and no highlight
  anywhere is off-brand.
`;

const DoodlePop_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doodle Pop — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #d6f437;
		--color-primary-foreground: #111111;
		--color-surface: #c8e93c;
		--color-surface-foreground: #111111;
		--color-surface-raised: #ffffff;
		--color-muted: #55584a;
		--color-accent: #f4794f;
		--color-danger: #ef3b5d;
		--color-border: #111111;
		--color-cream: #f2f0e6;
		--color-lavender: #b39df3;
		--color-sky: #8ed8e8;
		--color-ink: #111111;

		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 16px;
		--radius-xl: 20px;
		--radius-2xl: 28px;

		--shadow-sm: 2px 2px 0 #111111;
		--shadow-md: 4px 4px 0 #111111;
		--shadow-lg: 7px 7px 0 #111111;

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Nunito, Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 15px;
		font-weight: 500;
		line-height: 1.55;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 800; line-height: 1.12; letter-spacing: -0.01em; }
	p { margin: 0; }
	::selection { background: var(--color-lavender); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }
	.mono { font-family: var(--mono); }
	/* The coral full stop that ends most headings. */
	.dot { color: var(--color-accent); }

	.wrap { max-width: 1060px; margin: 0 auto; padding: 0 18px; }
	@media (min-width: 768px) { .wrap { padding: 0 28px; } }

	/* ── Ink doodles scattered on the lime stage, never inside cards ── */
	.doodle { position: absolute; color: var(--color-ink); opacity: 0.85; pointer-events: none; font-size: 20px; }

	/* ── Top bar ──────────────────────────────────────────────────── */
	.top { display: flex; align-items: center; gap: 12px; padding: 20px 0; flex-wrap: wrap; }
	.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; }
	.brand .mk { width: 30px; height: 30px; border: 2px solid var(--color-ink); border-radius: var(--radius-sm); background: var(--color-surface-raised); box-shadow: var(--shadow-sm); }
	.navchip { border: 2px solid var(--color-ink); border-radius: 9999px; padding: 5px 14px; font-size: 13px; font-weight: 700; background: var(--color-surface-raised); box-shadow: var(--shadow-sm); }
	.navchip.is-active { background: var(--color-ink); color: var(--color-primary); }

	/* ── Hero: a black card and a coral card, slightly rotated ────── */
	.hero { display: grid; grid-template-columns: 1fr; gap: 20px; padding: 10px 0 34px; }
	@media (min-width: 820px) { .hero { grid-template-columns: 1.5fr 1fr; gap: 24px; } }
	.herocard {
		position: relative; overflow: hidden;
		border: 2px solid var(--color-ink); border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-lg);
		background: var(--color-ink); color: var(--color-cream);
		padding: 28px 26px;
	}
	@media (min-width: 768px) { .herocard { padding: 38px 34px; } }
	.herocard h1 { font-size: 34px; }
	@media (min-width: 768px) { .herocard h1 { font-size: 46px; } }
	.herocard p { margin-top: 14px; max-width: 40ch; color: #d9d7cb; }
	.herocard .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-primary); }
	/* Dotted circle peeking from the corner — clipped by overflow hidden. */
	.dotcircle {
		position: absolute; border-radius: 50%;
		background-image: radial-gradient(rgb(214 244 55 / 0.75) 1.5px, transparent 1.5px);
		background-size: 10px 10px;
	}
	.dotcircle.ink { background-image: radial-gradient(rgb(17 17 17 / 0.35) 1.5px, transparent 1.5px); }
	.herocard .dotcircle { width: 220px; height: 220px; right: -70px; bottom: -90px; }
	.herocard .actions { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }

	.sidestack { display: grid; gap: 16px; }
	.statcard {
		position: relative; overflow: hidden;
		border: 2px solid var(--color-ink); border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-md); padding: 20px 22px;
		background: var(--color-accent); color: var(--color-ink);
	}
	.statcard .k { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
	.statcard .v { font-size: 34px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 4px; }
	.statcard .dotcircle { width: 140px; height: 140px; right: -46px; top: -56px; }
	.statcard.white { background: var(--color-surface-raised); }
	.rot-1 { transform: rotate(1.2deg); }
	.rot-2 { transform: rotate(-1.6deg); }

	/* ── Drop list: white cards with rotating icon tiles ──────────── */
	.section { padding: 30px 0; }
	.section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
	.section-head h2 { font-size: 24px; }
	@media (min-width: 768px) { .section-head h2 { font-size: 30px; } }
	.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-muted); }

	.list {
		border: 2px solid var(--color-ink); border-radius: var(--radius-2xl);
		background: var(--color-surface-raised); box-shadow: var(--shadow-md); overflow: hidden;
	}
	.item { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 2px solid var(--color-ink); }
	.item:last-child { border-bottom: 0; }
	.tile {
		width: 44px; height: 44px; flex: none;
		border: 2px solid var(--color-ink); border-radius: var(--radius-md);
		display: grid; place-items: center; font-size: 19px;
	}
	.item .name { min-width: 0; }
	.item .name b { display: block; font-weight: 800; font-size: 15px; }
	.item .name span { font-size: 12px; color: var(--color-muted); }
	.tag {
		border: 2px solid var(--color-ink); border-radius: 9999px;
		padding: 2px 10px; font-size: 12px; font-weight: 800;
		background: var(--color-primary); white-space: nowrap;
	}
	.tag.white { background: var(--color-surface-raised); }
	.tag.coral { background: var(--color-accent); }
	.tag.red { background: var(--color-danger); color: #fff; }
	.price { margin-left: auto; font-weight: 800; font-variant-numeric: tabular-nums; flex: none; }
	@media (max-width: 560px) { .item .hide-sm { display: none; } }

	/* ── Buttons: black outline + hard shadow + press ─────────────── */
	.btn {
		font: inherit; font-size: 14px; font-weight: 800;
		height: 46px; padding: 0 22px;
		border: 2px solid var(--color-ink); border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		box-shadow: var(--shadow-sm); cursor: pointer;
		transition: transform 90ms ease, box-shadow 90ms ease;
	}
	/* Press moves the card toward its own shadow. */
	.btn:hover { transform: translate(1px, 1px); box-shadow: 1px 1px 0 var(--color-ink); }
	.btn:active { transform: translate(2px, 2px); box-shadow: none; }
	.btn:focus-visible { outline: none; box-shadow: var(--shadow-sm), 0 0 0 4px var(--color-lavender); }
	.btn-white { background: var(--color-surface-raised); }
	.btn-coral { background: var(--color-accent); }
	.btn-lav { background: var(--color-lavender); }
	.btn-ink { background: var(--color-ink); color: var(--color-primary); }
	.btn[disabled] { cursor: not-allowed; background: #dcdcd2; color: #8a8c80; box-shadow: var(--shadow-sm); transform: none; }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	.input {
		font: inherit; font-size: 15px; font-weight: 600; width: 100%; max-width: 320px; height: 46px; padding: 0 16px;
		border: 2px solid var(--color-ink); border-radius: var(--radius-md);
		background: var(--color-surface-raised); color: var(--color-ink);
		box-shadow: var(--shadow-sm);
	}
	.input::placeholder { color: #8a8c80; }
	.input:focus { outline: none; box-shadow: var(--shadow-sm), 0 0 0 4px var(--color-lavender); }

	/* Toggle: black-outlined pill, ON = lime with a black knob. */
	.toggle { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14px; }
	.track { width: 58px; height: 32px; border: 2px solid var(--color-ink); border-radius: 9999px; background: var(--color-primary); padding: 3px; display: flex; justify-content: flex-end; box-shadow: var(--shadow-sm); }
	.track.off { background: var(--color-surface-raised); justify-content: flex-start; }
	.knob { width: 22px; height: 22px; border-radius: 50%; background: var(--color-ink); }

	/* ── Panels for the reference sections ───────────────────────── */
	.panel {
		border: 2px solid var(--color-ink); border-radius: var(--radius-2xl);
		background: var(--color-cream); box-shadow: var(--shadow-md);
		padding: 24px; position: relative; overflow: hidden;
	}
	@media (min-width: 768px) { .panel { padding: 30px 32px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; }
	.note { margin-top: 18px; font-size: 13px; color: var(--color-muted); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 22px; }
	@media (min-width: 700px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 64px; border: 2px solid var(--color-ink); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
	.sw b { display: block; font-size: 13px; font-weight: 800; margin-top: 10px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 24px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 282px 1fr; gap: 42px; } }
	.phone {
		width: 282px; max-width: 100%; margin: 0 auto;
		border: 2px solid var(--color-ink); border-radius: 30px;
		overflow: hidden; background: var(--color-cream); box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 12px 18px 6px; font-size: 10px; font-weight: 700; }
	.phone-top { display: flex; align-items: center; gap: 8px; padding: 0 14px 12px; }
	.phone-top .mk { width: 22px; height: 22px; border: 2px solid var(--color-ink); border-radius: 6px; background: #fff; }
	.phone-body { padding: 0 14px 12px; }
	.m-hero { position: relative; overflow: hidden; border: 2px solid var(--color-ink); border-radius: var(--radius-xl); background: var(--color-ink); color: var(--color-cream); padding: 14px; box-shadow: var(--shadow-md); }
	.m-hero .eyebrow { font-size: 8px; color: var(--color-primary); }
	.m-hero b { display: block; font-size: 19px; font-weight: 800; line-height: 1.1; margin-top: 4px; }
	.m-hero .dotcircle { width: 110px; height: 110px; right: -36px; bottom: -46px; }
	.m-stats { display: flex; gap: 10px; margin-top: 12px; }
	.m-stat { flex: 1; position: relative; overflow: hidden; border: 2px solid var(--color-ink); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 10px 12px; }
	.m-stat .k { font-size: 8px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
	.m-stat .v { font-size: 20px; font-weight: 800; }
	.m-list { border: 2px solid var(--color-ink); border-radius: var(--radius-xl); background: #fff; box-shadow: var(--shadow-md); overflow: hidden; margin-top: 12px; }
	.m-item { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-bottom: 2px solid var(--color-ink); }
	.m-item:last-child { border-bottom: 0; }
	.m-item .tile { width: 32px; height: 32px; font-size: 14px; border-radius: 9px; }
	.m-item b { font-size: 12px; font-weight: 800; display: block; }
	.m-item .mono { font-size: 9px; color: var(--color-muted); }
	.m-tabs { display: flex; border-top: 2px solid var(--color-ink); background: #fff; }
	.m-tabs div { flex: 1; text-align: center; font-size: 9px; font-weight: 800; padding: 8px 0 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); }
	.m-tabs .is-active { color: var(--color-ink); }
	.m-tabs .g { display: block; width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 6px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 13px 0; border-bottom: 2px solid var(--color-ink); font-size: 14px; color: var(--color-muted); }
	.rules li:last-child { border-bottom: 0; }
	.rules b { display: block; color: var(--color-ink); font-size: 15px; font-weight: 800; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 22px; }
	@media (min-width: 700px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: var(--radius-lg); background: #fff; border: 1px solid #e2e2e2; box-shadow: 0 4px 18px rgb(0 0 0 / 0.08); font-size: 15px; font-weight: 600; color: #6b6b6b; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-lg); background: #fff; border: 2px solid var(--color-ink); box-shadow: var(--shadow-md); font-size: 15px; font-weight: 800; }
	.cmp-on small { display: block; font-weight: 500; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	footer { padding: 26px 0 52px; font-size: 12px; font-weight: 700; }
</style>
</head>
<body>

<!-- COVER — the drop shop. Lime stage, ink borders, hard paper-cut shadows,
     one coral moment and a couple of dotted areas. -->
<div class="wrap" style="position: relative;">
	<span class="doodle" style="left: -2px; top: 88px;">✦</span>
	<span class="doodle" style="right: 8px; top: 150px; font-size: 16px;">♥</span>
	<span class="doodle" style="left: 46%; top: 6px; font-size: 15px;">〰</span>

	<div class="top">
		<span class="brand"><span class="mk"></span>doodle pop</span>
		<span class="spacer"></span>
		<span class="navchip is-active">Drops</span>
		<span class="navchip">Vault</span>
		<span class="navchip">Trade</span>
	</div>

	<div class="hero">
		<div class="herocard rot-1">
			<span class="dotcircle"></span>
			<p class="eyebrow">Today's drop</p>
			<h1>Sticker season is open<span class="dot">.</span></h1>
			<p>Thick ink lines, zero-blur shadows, and one loud coral moment per screen.
				Everything you can press moves toward its own shadow.</p>
			<div class="actions">
				<button class="btn">Open pack</button>
				<button class="btn btn-white">See the odds</button>
			</div>
		</div>

		<div class="sidestack">
			<div class="statcard rot-2">
				<span class="dotcircle ink"></span>
				<div class="k">Packs opened</div>
				<div class="v">12,480</div>
			</div>
			<div class="statcard white">
				<div class="k">Your streak</div>
				<div class="v">7 days</div>
				<div class="row" style="margin-top:10px"><span class="tag">+3 today</span><span class="tag coral">rare×2</span></div>
			</div>
		</div>
	</div>

	<section class="section">
		<div class="section-head">
			<h2>Latest pulls<span class="dot">.</span></h2>
			<span class="eyebrow">Updated 2 min ago</span>
			<span class="spacer"></span>
			<button class="btn btn-coral" style="height:38px;font-size:12px">Filter</button>
		</div>
		<div class="list">
			<div class="item">
				<span class="tile" style="background: var(--color-primary)">★</span>
				<span class="name"><b>Holo Squiggle</b><span class="mono">:latest · edition 04</span></span>
				<span class="tag hide-sm">legendary</span>
				<span class="price">1,240 ⛁</span>
			</div>
			<div class="item">
				<span class="tile" style="background: var(--color-lavender)">◆</span>
				<span class="name"><b>Lavender Blob</b><span class="mono">:latest · edition 11</span></span>
				<span class="tag white hide-sm">rare</span>
				<span class="price">480 ⛁</span>
			</div>
			<div class="item">
				<span class="tile" style="background: var(--color-sky)">◉</span>
				<span class="name"><b>Sky Sticker</b><span class="mono">:v2 · edition 27</span></span>
				<span class="tag white hide-sm">common</span>
				<span class="price">96 ⛁</span>
			</div>
			<div class="item">
				<span class="tile" style="background: var(--color-accent)">✦</span>
				<span class="name"><b>Coral Star</b><span class="mono">:latest · edition 02</span></span>
				<span class="tag red hide-sm">2 left</span>
				<span class="price">2,100 ⛁</span>
			</div>
		</div>
	</section>

	<!-- 01 -->
	<section class="section">
		<div class="panel">
			<p class="eyebrow">01 — The signature</p>
			<h2>Ink border plus a hard offset<span class="dot">.</span></h2>
			<p class="lede">Every card, button, chip, tile and toggle carries a 2px black border and a
				zero-blur drop in the same black. There is no soft shadow anywhere in this system, and no
				gray border — an ink line or nothing.</p>
			<div class="row" style="margin-top: 22px;">
				<button class="btn">Lime primary</button>
				<button class="btn btn-white">White</button>
				<button class="btn btn-coral">Coral filter</button>
				<button class="btn btn-lav">Lavender</button>
				<button class="btn btn-ink">Ink</button>
				<button class="btn" disabled>Sold out</button>
			</div>
			<div class="row" style="margin-top: 18px; gap: 20px;">
				<input class="input" placeholder="Search the vault">
				<span class="toggle"><span class="track"><span class="knob"></span></span>Notify me</span>
				<span class="toggle"><span class="track off"><span class="knob"></span></span>Auto-open</span>
			</div>
			<div class="swatches">
				<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>lime · always black text</span></div>
				<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>coral · one per screen</span></div>
				<div class="sw"><div class="fill" style="background: var(--color-lavender)"></div><b>lavender</b><span>quiet pastel</span></div>
				<div class="sw"><div class="fill" style="background: var(--color-sky)"></div><b>sky</b><span>quiet pastel</span></div>
			</div>
			<p class="note">Icon tiles rotate through lime, coral, lavender and sky, and two neighbours never take the same color.</p>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<div class="panel">
			<span class="dotcircle ink" style="width:200px;height:200px;right:-70px;bottom:-80px"></span>
			<p class="eyebrow">02 — Dots</p>
			<h2>Seasoning, not wallpaper<span class="dot">.</span></h2>
			<p class="lede">The polka pattern is a 1.5px radial gradient on a 10px grid. It belongs in a
				corner circle clipped by a card, a wash inside a colored banner, or one big pastel circle
				bleeding off the edge of a sparse screen. Two dotted areas per screen is the ceiling, and
				dots never sit behind body text.</p>
		</div>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<div class="panel">
			<p class="eyebrow">03 — Mobile</p>
			<h2>Stickers were made for thumbs<span class="dot">.</span></h2>
			<p class="lede">The lime stage stays loud, the screen interior drops to cream, and the cards
				keep every bit of their ink and shadow. Nothing here thins out for a small screen — that
				would be the one change the style cannot survive.</p>
			<div class="mobile">
				<div class="phone">
					<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
					<div class="phone-top"><span class="mk"></span><b style="font-size:13px">doodle pop</b><span class="spacer"></span><span class="tag" style="font-size:10px">7 🔥</span></div>
					<div class="phone-body">
						<div class="m-hero">
							<span class="dotcircle"></span>
							<p class="eyebrow">Today's drop</p>
							<b>Sticker season<span class="dot">.</span></b>
							<button class="btn" style="height:34px;font-size:11px;margin-top:10px">Open pack</button>
						</div>
						<div class="m-stats">
							<div class="m-stat" style="background: var(--color-accent)"><span class="dotcircle ink" style="width:70px;height:70px;right:-24px;top:-28px"></span><div class="k">Opened</div><div class="v">12.4k</div></div>
							<div class="m-stat" style="background:#fff"><div class="k">Streak</div><div class="v">7</div></div>
						</div>
						<div class="m-list">
							<div class="m-item"><span class="tile" style="background:var(--color-primary)">★</span><span><b>Holo Squiggle</b><span class="mono">edition 04</span></span><span class="spacer"></span><b style="font-size:11px">1,240</b></div>
							<div class="m-item"><span class="tile" style="background:var(--color-lavender)">◆</span><span><b>Lavender Blob</b><span class="mono">edition 11</span></span><span class="spacer"></span><b style="font-size:11px">480</b></div>
							<div class="m-item"><span class="tile" style="background:var(--color-sky)">◉</span><span><b>Sky Sticker</b><span class="mono">edition 27</span></span><span class="spacer"></span><b style="font-size:11px">96</b></div>
						</div>
					</div>
					<div class="m-tabs">
						<div class="is-active"><span class="g"></span>Drops</div>
						<div><span class="g"></span>Vault</div>
						<div><span class="g"></span>Trade</div>
						<div><span class="g"></span>You</div>
					</div>
				</div>
				<ul class="rules">
					<li><b>Borders never thin</b>2px ink lines and the hard offset shadow stay at every width. Softening either one is the fastest way to lose the sticker-sheet feel.</li>
					<li><b>Shadow steps down</b><code class="mono">shadow-lg</code> (7px) → <code class="mono">shadow-md</code> (4px) → <code class="mono">shadow-sm</code> (2px) as cards get smaller, so the offset stays proportional to the card rather than swallowing it.</li>
					<li><b>Cream interior</b>The lime stage frames the phone; screen content sits on cream. Long copy never runs directly on raw lime at any size.</li>
					<li><b>Rotations</b>The ±1–2° tilt on stacked promo cards is dropped on mobile. A rotated card next to a screen edge reads as broken rather than playful.</li>
					<li><b>Dots</b>One dotted area per phone screen instead of two, usually the hero's corner circle. The dot grid stays 10px — scaling it down turns it into noise.</li>
					<li><b>List rows</b>Keep the black divider between rows, drop the rarity tag, and pull the price in tight. Rows stay 44px+ so the icon tile is comfortably tappable.</li>
					<li><b>Press</b>Hover has no touch equivalent, so the 1–2px translate lands entirely on <code class="mono">:active</code>. The press is the interaction; it must survive.</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<div class="panel">
			<p class="eyebrow">04 — Off-style, for contrast</p>
			<h2>What breaks the sticker sheet<span class="dot">.</span></h2>
			<div class="compare">
				<div class="cmp-off">Soft and gray
					<small>1px #e2e2e2 border · blurred drop shadow · gray text at weight 600. Corporate minimalism — no ink, no dots, no doodles, nothing to grin at.</small></div>
				<div class="cmp-on">Same content, on-style
					<small>2px black border, 4px hard offset shadow, weight 800. If a screen has no dots, no doodle and no highlight anywhere on it, it is off-brand.</small></div>
			</div>
			<p class="note">Also out: lime text on lime, long copy on the raw stage, dots behind body text, and more than two dotted areas per screen.</p>
		</div>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — doodle pop · ink lines, hard shadows, one coral moment.</div></footer>
</body>
</html>
`;

const Stripe_THEME = `/* Stripe — polished fintech, blurple on airy blue-gray. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #635bff;
	--color-primary-foreground: #ffffff;
	--color-surface: #f6f9fc;
	--color-surface-foreground: #0a2540;
	--color-surface-raised: #ffffff;
	--color-muted: #425466;
	--color-accent: #00d4ff;
	--color-danger: #df1b41;
	--color-border: #e6ebf1;

	--radius-sm: 6px;
	--radius-md: 8px;
	--radius-lg: 12px;
	--radius-xl: 16px;
	--radius-2xl: 24px;

	--shadow-sm: 0 2px 5px -1px rgb(50 50 93 / 0.12), 0 1px 3px -1px rgb(0 0 0 / 0.15);
	--shadow-md: 0 6px 12px -2px rgb(50 50 93 / 0.2), 0 3px 7px -3px rgb(0 0 0 / 0.15);
	--shadow-lg: 0 13px 27px -5px rgb(50 50 93 / 0.25), 0 8px 16px -8px rgb(0 0 0 / 0.3);
}
`;

const Stripe_SPEC = `# Stripe

## Atmosphere
Polished fintech craft. An airy blue-gray canvas with crisp white cards, one
confident blurple, and shadows so refined they read as paper. Serious money,
delightful surface.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is the cool blue-gray page; \`surface-raised\` (white) for all cards.
- \`primary\` (blurple #635bff) for CTAs, links, active nav, chart lines.
- \`accent\` (cyan) sparingly for gradients-of-two and highlights.
- Headings in \`surface-foreground\` (deep navy); body copy in \`muted\`.

## Typography
System font stack only:
- Headings \`font-semibold tracking-tight\`, navy, sizes 20–32px.
- Body 14–15px in \`muted\`; the navy/slate two-tone is the signature.
- Numbers in tables use \`tabular-nums\`; currency amounts get \`font-medium\`.

## Shape & depth
- Medium radii (\`rounded-lg\`/\`rounded-xl\` ≈ 12–16px).
- The layered shadow is the brand: cards float with \`shadow-sm\`→\`shadow-md\`
  on hover; modals use \`shadow-lg\`. Borders are secondary to shadows.

## Components
- Buttons: h-9 \`rounded-lg\`, filled blurple primary with subtle shadow;
  secondary is white with border + shadow-sm.
- Inputs: white, 1px border, focus ring \`primary/30\` + border primary.
- Stat cards: small \`muted\` label, large navy number, delta in green/\`danger\`.
- Tables: white card container, 48px rows, hover \`bg-surface\`.

## Layout
Dashboard grid on 8px rhythm; cards in 2–4 column grids with 16–24px gaps.
Left nav 240px on \`surface\`, content cards on white.

## Don'ts
- No dark backgrounds; no pure black text (navy is the black).
- Don't mix more than blurple + cyan; no rainbow charts.
- No flat borderless-and-shadowless cards — depth is part of the language.
`;

const Stripe_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stripe — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #635bff;
		--color-primary-foreground: #ffffff;
		--color-surface: #f6f9fc;
		--color-surface-foreground: #0a2540;
		--color-surface-raised: #ffffff;
		--color-muted: #425466;
		--color-accent: #00d4ff;
		--color-danger: #df1b41;
		--color-border: #e6ebf1;

		--radius-sm: 6px;
		--radius-md: 8px;
		--radius-lg: 12px;
		--radius-xl: 16px;
		--radius-2xl: 24px;

		--shadow-sm: 0 2px 5px -1px rgb(50 50 93 / 0.12), 0 1px 3px -1px rgb(0 0 0 / 0.15);
		--shadow-md: 0 6px 12px -2px rgb(50 50 93 / 0.2), 0 3px 7px -3px rgb(0 0 0 / 0.15);
		--shadow-lg: 0 13px 27px -5px rgb(50 50 93 / 0.25), 0 8px 16px -8px rgb(0 0 0 / 0.3);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-muted);
		font-family: var(--sans);
		font-size: 15px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	/* The two-tone is the signature: navy headings, slate body. */
	h1, h2, h3 { margin: 0; color: var(--color-surface-foreground); font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
	p { margin: 0; }
	::selection { background: rgb(99 91 255 / 0.2); }
	code { font-family: var(--mono); font-size: 0.86em; }

	.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }

	/* ── Gradient masthead: blurple→cyan, the only gradient allowed ── */
	.masthead {
		background: linear-gradient(115deg, #635bff 0%, #4b48d6 45%, #00d4ff 130%);
		color: #fff; padding-bottom: 96px;
	}
	.nav { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; padding: 20px 0; font-size: 14px; }
	.logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 19px; letter-spacing: -0.02em; }
	.logo .g { width: 22px; height: 22px; border-radius: var(--radius-sm); background: #fff; }
	.nav .links { display: none; gap: 22px; opacity: 0.9; }
	@media (min-width: 780px) { .nav .links { display: flex; } }
	.spacer { flex: 1; }

	.hero { padding-top: 48px; max-width: 640px; }
	.hero h1 { color: #fff; font-size: 40px; letter-spacing: -0.03em; }
	@media (min-width: 768px) { .hero h1 { font-size: 56px; } }
	.hero p { margin-top: 20px; font-size: 18px; color: rgb(255 255 255 / 0.86); }
	.hero .row { margin-top: 30px; }

	/* ── The dashboard card lifts out of the gradient — the signature move ── */
	.lift { margin-top: -80px; padding-bottom: 72px; }
	.dash {
		background: var(--color-surface-raised);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	.dash-head { display: flex; align-items: center; gap: 12px; padding: 18px 22px; border-bottom: 1px solid var(--color-border); }
	.dash-head h3 { font-size: 16px; }
	.dash-body { display: grid; grid-template-columns: 1fr; }
	@media (min-width: 820px) { .dash-body { grid-template-columns: 200px 1fr; } }
	.dash-side { display: none; border-right: 1px solid var(--color-border); padding: 14px 12px; background: var(--color-surface); }
	@media (min-width: 820px) { .dash-side { display: block; } }
	.s-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--radius-md); font-size: 14px; color: var(--color-muted); }
	.s-item.is-active { background: rgb(99 91 255 / 0.1); color: var(--color-primary); font-weight: 600; }
	.s-item .d { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.5; }
	.dash-main { padding: 22px; min-width: 0; }

	/* ── Stat cards: tiny label, big navy number, colored delta ────── */
	.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
	@media (min-width: 720px) { .stats { grid-template-columns: repeat(4, 1fr); } }
	.stat {
		background: var(--color-surface-raised); border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm); padding: 16px 18px;
	}
	.stat .k { font-size: 12px; color: var(--color-muted); }
	.stat .v { font-size: 26px; font-weight: 600; color: var(--color-surface-foreground); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-top: 4px; }
	.stat .delta { font-size: 12px; font-weight: 600; margin-top: 2px; color: #0e9f6e; }
	.stat .delta.down { color: var(--color-danger); }

	/* ── Chart: one blurple line, one cyan fill ───────────────────── */
	.chartcard { margin-top: 18px; background: var(--color-surface-raised); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 18px; }
	.chartcard svg { display: block; width: 100%; height: auto; }

	/* ── Payments table ───────────────────────────────────────────── */
	.tablecard { margin-top: 18px; background: var(--color-surface-raised); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th { text-align: left; font-size: 12px; font-weight: 600; color: var(--color-muted); padding: 12px 18px; border-bottom: 1px solid var(--color-border); }
	td { padding: 0 18px; height: 48px; border-bottom: 1px solid var(--color-border); }
	tr:last-child td { border-bottom: 0; }
	tbody tr:hover { background: var(--color-surface); }
	.amount { color: var(--color-surface-foreground); font-weight: 500; font-variant-numeric: tabular-nums; }
	.email { color: var(--color-muted); }
	.badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; border-radius: 9999px; padding: 2px 10px; }
	.badge.ok { background: #d7f7e9; color: #0e6245; }
	.badge.pend { background: #fdf1d7; color: #8a5b00; }
	.badge.fail { background: #fde8ee; color: #a8143a; }
	.badge .d { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
	@media (max-width: 680px) { .hide-sm { display: none; } }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding: 64px 0; }
	.section-label { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 12px; }
	.section h2 { font-size: 28px; }
	@media (min-width: 768px) { .section h2 { font-size: 32px; } }
	.lede { margin-top: 14px; max-width: 60ch; }
	.note { margin-top: 20px; font-size: 14px; }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Buttons: shadow is part of the button, not an effect ─────── */
	.btn {
		font: inherit; font-size: 14px; font-weight: 600;
		height: 40px; padding: 0 18px;
		border: 0; border-radius: var(--radius-lg);
		background: var(--color-primary); color: var(--color-primary-foreground);
		box-shadow: var(--shadow-sm); cursor: pointer;
		transition: transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
	}
	.btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); background: #7a73ff; }
	.btn:active { transform: translateY(0); box-shadow: var(--shadow-sm); }
	.btn:focus-visible { outline: none; box-shadow: var(--shadow-sm), 0 0 0 4px rgb(99 91 255 / 0.3); }
	.btn-white { background: #fff; color: var(--color-surface-foreground); }
	.btn-white:hover { background: #fff; }
	.btn-secondary { background: var(--color-surface-raised); color: var(--color-surface-foreground); border: 1px solid var(--color-border); }
	.btn-secondary:hover { background: #fff; }
	.btn-danger { background: var(--color-danger); }
	.btn-danger:hover { background: #f0325a; }
	.btn[disabled] { cursor: not-allowed; background: #c7cfda; box-shadow: none; transform: none; }
	.btn-sm { height: 32px; padding: 0 14px; font-size: 13px; }

	.field { max-width: 380px; }
	.label { display: block; font-size: 13px; font-weight: 600; color: var(--color-surface-foreground); margin-bottom: 6px; }
	.input {
		font: inherit; font-size: 15px; width: 100%; height: 40px; padding: 0 14px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
		box-shadow: var(--shadow-sm);
	}
	.input::placeholder { color: #8fa0b3; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: var(--shadow-sm), 0 0 0 4px rgb(99 91 255 / 0.25); }

	.cards { display: grid; grid-template-columns: 1fr; gap: 20px; margin-top: 28px; }
	@media (min-width: 720px) { .cards { grid-template-columns: repeat(3, 1fr); } }
	.card { background: var(--color-surface-raised); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); padding: 24px; transition: box-shadow 200ms ease, transform 200ms ease; }
	.card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
	.card h3 { font-size: 17px; }
	.card p { font-size: 14px; margin-top: 8px; }
	.card .ico { width: 34px; height: 34px; border-radius: var(--radius-md); background: rgb(99 91 255 / 0.12); margin-bottom: 14px; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 28px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(5, 1fr); } }
	.sw .fill { height: 64px; border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
	.sw b { display: block; font-size: 13px; color: var(--color-surface-foreground); margin-top: 10px; }
	.sw span { font-size: 12px; }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 32px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 292px 1fr; gap: 44px; } }
	.phone {
		width: 292px; max-width: 100%; margin: 0 auto;
		border-radius: 28px; overflow: hidden;
		background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-hd { background: linear-gradient(115deg, #635bff, #4b48d6 60%, #00d4ff 150%); color: #fff; padding: 12px 18px 34px; }
	.phone-status { display: flex; justify-content: space-between; font-size: 10px; opacity: 0.85; }
	.phone-hd h4 { color: #fff; font-size: 13px; font-weight: 600; margin: 12px 0 2px; opacity: 0.85; }
	.phone-hd .big { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.phone-body { padding: 0 14px 14px; margin-top: -22px; }
	.m-card { background: #fff; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); padding: 14px; }
	.m-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
	.m-stat { background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 10px 12px; }
	.m-stat .k { font-size: 10px; }
	.m-stat .v { font-size: 17px; font-weight: 600; color: var(--color-surface-foreground); font-variant-numeric: tabular-nums; }
	.m-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--color-border); font-size: 12px; }
	.m-row:last-child { border-bottom: 0; }
	.m-tab { display: flex; background: #fff; border-top: 1px solid var(--color-border); }
	.m-tab div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 9px 0 14px; }
	.m-tab .is-active { color: var(--color-primary); font-weight: 600; }
	.m-tab .g { display: block; width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid currentColor; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 14px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 28px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 24px; border-radius: var(--radius-lg); background: #0b0e14; color: #98a2b3; font-size: 16px; font-weight: 600; border: 1px solid #1e2530; }
	.cmp-off small { display: block; font-size: 13px; font-weight: 400; margin-top: 10px; line-height: 1.6; }
	.cmp-on { padding: 24px; border-radius: var(--radius-xl); background: var(--color-surface-raised); box-shadow: var(--shadow-md); font-size: 16px; font-weight: 600; color: var(--color-surface-foreground); }
	.cmp-on small { display: block; font-size: 13px; font-weight: 400; color: var(--color-muted); margin-top: 10px; line-height: 1.6; }

	footer { border-top: 1px solid var(--color-border); padding: 32px 0 56px; font-size: 13px; }
</style>
</head>
<body>

<!-- COVER — gradient masthead with the dashboard lifting out of it. The
     layered shadow is the brand; the two-tone navy/slate is the voice. -->
<header class="masthead">
	<div class="wrap">
		<div class="nav">
			<span class="logo"><span class="g"></span>Vetta</span>
			<span class="links"><span>Products</span><span>Solutions</span><span>Developers</span><span>Pricing</span></span>
			<span class="spacer"></span>
			<button class="btn btn-white btn-sm">Sign in</button>
		</div>
		<div class="hero">
			<h1>Financial infrastructure, politely presented</h1>
			<p>An airy blue-gray canvas, crisp white cards, one confident blurple, and shadows
				refined enough to read as paper rather than as effects.</p>
			<div class="row">
				<button class="btn btn-white">Start now</button>
				<button class="btn" style="background: rgb(255 255 255 / 0.16); box-shadow: none;">Contact sales →</button>
			</div>
		</div>
	</div>
</header>

<div class="wrap lift">
	<div class="dash">
		<div class="dash-head">
			<h3>Payments</h3>
			<span class="badge ok"><span class="d"></span>Live mode</span>
			<span class="spacer"></span>
			<button class="btn btn-secondary btn-sm">Export</button>
			<button class="btn btn-sm">New payment</button>
		</div>
		<div class="dash-body">
			<aside class="dash-side">
				<div class="s-item is-active"><span class="d"></span>Payments</div>
				<div class="s-item"><span class="d"></span>Balances</div>
				<div class="s-item"><span class="d"></span>Customers</div>
				<div class="s-item"><span class="d"></span>Products</div>
				<div class="s-item"><span class="d"></span>Reports</div>
				<div class="s-item"><span class="d"></span>Developers</div>
			</aside>
			<div class="dash-main">
				<div class="stats">
					<div class="stat"><div class="k">Gross volume</div><div class="v">$48,210</div><div class="delta">+12.4%</div></div>
					<div class="stat"><div class="k">Net revenue</div><div class="v">$41,882</div><div class="delta">+9.1%</div></div>
					<div class="stat"><div class="k">Successful</div><div class="v">99.2%</div><div class="delta">+0.3%</div></div>
					<div class="stat"><div class="k">Disputes</div><div class="v">4</div><div class="delta down">+2</div></div>
				</div>

				<div class="chartcard">
					<svg viewBox="0 0 720 180" role="img" aria-label="Gross volume trend">
						<defs>
							<linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="#635bff" stop-opacity="0.22"/>
								<stop offset="100%" stop-color="#00d4ff" stop-opacity="0.02"/>
							</linearGradient>
						</defs>
						<g stroke="#e6ebf1" stroke-width="1">
							<line x1="0" y1="40" x2="720" y2="40"/><line x1="0" y1="80" x2="720" y2="80"/>
							<line x1="0" y1="120" x2="720" y2="120"/><line x1="0" y1="160" x2="720" y2="160"/>
						</g>
						<path d="M0 140 C 90 130, 120 96, 180 104 S 280 62, 340 78 S 450 40, 520 54 S 640 20, 720 30 L720 180 L0 180 Z" fill="url(#fillg)"/>
						<path d="M0 140 C 90 130, 120 96, 180 104 S 280 62, 340 78 S 450 40, 520 54 S 640 20, 720 30" fill="none" stroke="#635bff" stroke-width="2.5" stroke-linecap="round"/>
						<circle cx="720" cy="30" r="4.5" fill="#635bff"/>
					</svg>
				</div>

				<div class="tablecard">
					<table>
						<thead><tr><th>Amount</th><th class="hide-sm">Status</th><th class="hide-sm">Customer</th><th>Date</th></tr></thead>
						<tbody>
							<tr><td class="amount">$1,240.00</td><td class="hide-sm"><span class="badge ok"><span class="d"></span>Succeeded</span></td><td class="hide-sm email">amara@northwind.co</td><td>Apr 12</td></tr>
							<tr><td class="amount">$89.00</td><td class="hide-sm"><span class="badge pend"><span class="d"></span>Pending</span></td><td class="hide-sm email">j.sun@lumen.io</td><td>Apr 12</td></tr>
							<tr><td class="amount">$4,500.00</td><td class="hide-sm"><span class="badge ok"><span class="d"></span>Succeeded</span></td><td class="hide-sm email">ops@harbor.dev</td><td>Apr 11</td></tr>
							<tr><td class="amount">$32.50</td><td class="hide-sm"><span class="badge fail"><span class="d"></span>Failed</span></td><td class="hide-sm email">mo@atlasgroup.com</td><td>Apr 11</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</div>

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Depth</p>
		<h2>The layered shadow is the brand</h2>
		<p class="lede">Every card carries two stacked shadows — a tight one for the edge and a wide,
			slightly blue one for the lift. On hover it steps up a level and rises one pixel. A card with
			neither border nor shadow does not exist in this system.</p>
		<div class="cards">
			<div class="card"><div class="ico"></div><h3>shadow-sm</h3><p>The resting state of every card, stat tile and input. Already visibly floating.</p></div>
			<div class="card"><div class="ico"></div><h3>shadow-md</h3><p>Hover, and the raised state of anything interactive. Paired with a −1px translate.</p></div>
			<div class="card"><div class="ico"></div><h3>shadow-lg</h3><p>Modals, and the dashboard lifting out of the gradient masthead.</p></div>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Color &amp; type</p>
		<h2>Navy is the black</h2>
		<p class="lede">Headings are deep navy, body copy is slate, and the two never swap. Blurple owns
			every CTA, link, active nav item and chart line. Cyan exists only as the far end of one gradient.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#635bff · CTA, links</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>foreground</b><span>#0a2540 · headings</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-muted)"></div><b>muted</b><span>#425466 · body copy</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#f6f9fc · page</span></div>
			<div class="sw"><div class="fill" style="background: linear-gradient(115deg,#635bff,#00d4ff)"></div><b>gradient</b><span>once per page</span></div>
		</div>
		<div class="row" style="margin-top: 28px;">
			<button class="btn">Primary</button>
			<button class="btn btn-secondary">Secondary</button>
			<button class="btn btn-danger">Refund</button>
			<button class="btn" disabled>Processing…</button>
		</div>
		<div class="field" style="margin-top: 22px;">
			<label class="label">Card email</label>
			<input class="input" placeholder="you@company.com">
		</div>
		<p class="note">Currency figures use <code>tabular-nums</code> and medium weight everywhere they appear — a column of amounts must align on the decimal without thinking about it.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Cards were always the responsive unit</h2>
		<p class="lede">Because the dashboard is a grid of independent cards, the phone build is a
			re-flow rather than a redesign: four stat tiles become two columns, the table becomes a list of
			amount-and-status rows, and the gradient header stays so the balance still floats out of it.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-hd">
					<div class="phone-status"><span>9:41</span><span>5G ▮</span></div>
					<h4>Gross volume · last 7 days</h4>
					<div class="big">$48,210.00</div>
				</div>
				<div class="phone-body">
					<div class="m-card">
						<svg viewBox="0 0 260 70" role="img" aria-label="Volume trend">
							<path d="M0 56 C 30 52, 44 34, 66 38 S 104 20, 128 28 S 176 12, 206 18 S 240 8, 260 10 L260 70 L0 70 Z" fill="rgb(99 91 255 / 0.12)"/>
							<path d="M0 56 C 30 52, 44 34, 66 38 S 104 20, 128 28 S 176 12, 206 18 S 240 8, 260 10" fill="none" stroke="#635bff" stroke-width="2" stroke-linecap="round"/>
						</svg>
					</div>
					<div class="m-stats">
						<div class="m-stat"><div class="k">Net</div><div class="v">$41,882</div></div>
						<div class="m-stat"><div class="k">Success</div><div class="v">99.2%</div></div>
					</div>
					<div class="m-card" style="margin-top:10px">
						<div class="m-row"><span class="amount">$1,240.00</span><span class="badge ok"><span class="d"></span>Succeeded</span></div>
						<div class="m-row"><span class="amount">$89.00</span><span class="badge pend"><span class="d"></span>Pending</span></div>
						<div class="m-row"><span class="amount">$32.50</span><span class="badge fail"><span class="d"></span>Failed</span></div>
					</div>
				</div>
				<div class="m-tab">
					<div class="is-active"><span class="g"></span>Home</div>
					<div><span class="g"></span>Payments</div>
					<div><span class="g"></span>Balance</div>
					<div><span class="g"></span>More</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Card grid</b>4 columns → 2 → 1, gaps 24px → 16px → 10px. Cards keep both shadows and their 12–16px radius; they never flatten into bordered strips.</li>
				<li><b>The lift</b>The dashboard still overlaps the gradient header by ~22px on mobile. That overlap is the identity of the layout — losing it makes the page generic.</li>
				<li><b>Tables → rows</b>Below 680px the table sheds customer and status columns; on the phone it becomes amount-left / badge-right rows inside a single card. Never a sideways scroll.</li>
				<li><b>Charts</b>Keep the blurple line and the fade-to-cyan fill, drop the gridlines and the axis labels. One series, always.</li>
				<li><b>Nav</b>The 200px side rail becomes a four-item bottom bar with the active item in blurple. The rail is not reproduced as a drawer.</li>
				<li><b>Targets</b>Buttons 40px → 44px; the primary action spans the card width. Hover lift maps to a press-down, so touch still gets the shadow language.</li>
				<li><b>Type</b>Hero 56px → 40px, section headings 32px → 28px, body stays 15px. Numbers never shrink below 17px — figures are the content here.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the polish</h2>
		<div class="compare">
			<div class="cmp-off">Flat dark panel
				<small>Near-black background · hairline border · no shadow · gray-on-gray text. Dark surfaces and flat cards both read as a different product entirely.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>White card on blue-gray, 16px radius, layered shadow, navy heading over slate body. Depth is part of the language, not an optional flourish.</small></div>
		</div>
		<p class="note">Also out: pure black text, a third hue anywhere near blurple and cyan, rainbow chart series, and borderless shadowless cards.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — stripe · blurple, navy, and paper-real shadows.</div></footer>
</body>
</html>
`;

const Spotify_THEME = `/* Spotify — near-black stage, one electric green, pill everything. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #1db954;
	--color-primary-foreground: #000000;
	--color-surface: #121212;
	--color-surface-foreground: #ffffff;
	--color-surface-raised: #1f1f1f;
	--color-muted: #a7a7a7;
	--color-accent: #1ed760;
	--color-danger: #f15e6c;
	--color-border: #2a2a2a;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 2px 4px rgb(0 0 0 / 0.4);
	--shadow-md: 0 8px 24px rgb(0 0 0 / 0.5);
	--shadow-lg: 0 16px 56px rgb(0 0 0 / 0.7);
}
`;

const Spotify_SPEC = `# Spotify

## Atmosphere
A dark stage where content is the light. Near-black layers, album-art color,
one electric green that means "play". Bold type, pill buttons, zero hesitation.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (#121212) base; \`surface-raised\` for cards/rows; hover lightens
  another step (use \`white/10\` overlays).
- \`primary\` green is SACRED: play/CTA only, with black text on it.
- \`accent\` (brighter green) for equalizer/live/active states.
- Text white; secondary \`muted\`; \`border\` rarely — layers do the separation.

## Typography
System font stack only. Loud and confident:
- Headings \`font-bold\` to \`font-black\`, tight (\`tracking-tight\`), 24–48px.
- Body 14px; metadata 12–13px \`muted\`.
- Title case never — sentence case everywhere.

## Shape & depth
- Cards \`rounded-lg\` (8px); buttons are full pills (\`rounded-full\`).
- Depth by lightness steps between layers, plus \`shadow-md\` on hover cards;
  album art gets \`shadow-lg\`.

## Components
- Primary button: green pill, black bold label, h-12, scales slightly on hover.
- Cards: \`surface-raised\` with cover image on top, title + \`muted\` line under;
  a floating green play circle appears on hover.
- Rows (tracks): 56px, index/cover/title/artist/duration, hover \`white/10\`.
- Nav: left rail with bold 14px items; active is pure white, rest \`muted\`.

## Layout
Content shelves: horizontal card rows with bold shelf titles + "Show all".
Grid gaps 16–24px; page padding 24–32px. Density medium; imagery carries it.

## Don'ts
- Green is never a text color or background wash — buttons/indicators only.
- No light theme, no thin gray hairline aesthetics, no small timid headings.
- Never place black text on dark layers; contrast is white/muted only.
`;

const Spotify_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spotify — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #1db954;
		--color-primary-foreground: #000000;
		--color-surface: #121212;
		--color-surface-foreground: #ffffff;
		--color-surface-raised: #1f1f1f;
		--color-muted: #a7a7a7;
		--color-accent: #1ed760;
		--color-danger: #f15e6c;
		--color-border: #2a2a2a;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 2px 4px rgb(0 0 0 / 0.4);
		--shadow-md: 0 8px 24px rgb(0 0 0 / 0.5);
		--shadow-lg: 0 16px 56px rgb(0 0 0 / 0.7);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: #000;
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	/* Loud and confident: black weights, tight tracking, sentence case. */
	h1, h2, h3 { margin: 0; font-weight: 800; letter-spacing: -0.03em; line-height: 1.12; }
	p { margin: 0; }
	::selection { background: rgb(29 185 84 / 0.4); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	/* ── App shell: black gutters, rounded panels floating on them ── */
	.app { display: grid; grid-template-columns: 1fr; gap: 8px; padding: 8px; }
	@media (min-width: 940px) { .app { grid-template-columns: 240px 1fr; height: 88vh; min-height: 660px; } }

	.rail { display: none; background: var(--color-surface); border-radius: var(--radius-lg); padding: 16px 12px; }
	@media (min-width: 940px) { .rail { display: block; } }
	.logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; letter-spacing: -0.02em; padding: 0 6px 18px; }
	.logo .mk { width: 26px; height: 26px; border-radius: 50%; background: var(--color-primary); }
	.r-item { display: flex; align-items: center; gap: 14px; height: 40px; padding: 0 8px; border-radius: var(--radius-md); color: var(--color-muted); font-weight: 700; font-size: 15px; }
	.r-item .g { width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 4px; flex: none; }
	.r-item.is-active { color: #fff; }
	.r-divider { height: 1px; background: var(--color-border); margin: 14px 6px; }
	.r-play { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: var(--radius-sm); color: var(--color-muted); font-size: 13px; }
	.r-play .art { width: 34px; height: 34px; border-radius: var(--radius-sm); flex: none; }
	.r-play b { display: block; color: #fff; font-size: 14px; font-weight: 500; }
	.r-play.is-playing b { color: var(--color-accent); }

	.main { background: var(--color-surface); border-radius: var(--radius-lg); overflow: hidden; min-width: 0; }
	.main-top { display: flex; align-items: center; gap: 12px; padding: 14px 20px; }
	.circle-btn { width: 32px; height: 32px; border-radius: 50%; background: rgb(0 0 0 / 0.7); display: grid; place-items: center; color: #fff; font-size: 12px; flex: none; }

	/* Header washes into the art color — the album is the light source. */
	.plhead {
		display: flex; align-items: flex-end; gap: 22px; padding: 8px 20px 24px; flex-wrap: wrap;
		background: linear-gradient(180deg, #2f6f47 0%, rgb(24 24 24 / 0.85) 100%);
	}
	@media (min-width: 768px) { .plhead { padding: 16px 32px 28px; } }
	.cover {
		width: 148px; height: 148px; flex: none; border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		background: linear-gradient(135deg, #1db954, #0d4d2a 70%, #08331c);
		display: grid; place-items: center; font-weight: 800; font-size: 30px; letter-spacing: -0.04em; color: rgb(255 255 255 / 0.92);
	}
	@media (min-width: 768px) { .cover { width: 192px; height: 192px; } }
	.plhead .k { font-size: 12px; font-weight: 700; }
	.plhead h1 { font-size: 40px; margin: 6px 0 12px; font-weight: 800; }
	@media (min-width: 768px) { .plhead h1 { font-size: 68px; letter-spacing: -0.045em; } }
	.plhead .meta { font-size: 13px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.plhead .meta b { font-weight: 700; }

	.actions { display: flex; align-items: center; gap: 22px; padding: 20px; }
	@media (min-width: 768px) { .actions { padding: 22px 32px; } }
	/* The green pill with black bold text — the single most protected element. */
	.play {
		width: 56px; height: 56px; border-radius: 50%; border: 0;
		background: var(--color-primary); color: var(--color-primary-foreground);
		font-size: 20px; cursor: pointer; flex: none;
		display: grid; place-items: center;
		transition: transform 140ms ease, background-color 140ms ease;
	}
	.play:hover { transform: scale(1.06); background: var(--color-accent); }
	.play:focus-visible { outline: none; box-shadow: 0 0 0 4px rgb(29 185 84 / 0.4); }
	.icon-btn { background: transparent; border: 0; color: var(--color-muted); font-size: 22px; cursor: pointer; }
	.icon-btn:hover { color: #fff; }

	/* ── Track rows: 56px, index / title / artist / duration ──────── */
	.tracks { padding: 0 8px 20px; }
	@media (min-width: 768px) { .tracks { padding: 0 20px 24px; } }
	.thead { display: flex; align-items: center; gap: 14px; padding: 6px 12px; border-bottom: 1px solid var(--color-border); font-size: 12px; color: var(--color-muted); letter-spacing: 0.04em; }
	.trow { display: flex; align-items: center; gap: 14px; height: 56px; padding: 0 12px; border-radius: var(--radius-sm); }
	.trow:hover { background: rgb(255 255 255 / 0.1); }
	.tindex { width: 18px; flex: none; text-align: right; color: var(--color-muted); font-size: 14px; font-variant-numeric: tabular-nums; }
	.tart { width: 40px; height: 40px; border-radius: 3px; flex: none; }
	.tname { min-width: 0; flex: 1; }
	.tname b { display: block; font-weight: 500; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tname span { font-size: 13px; color: var(--color-muted); }
	.trow.is-playing .tname b { color: var(--color-accent); }
	.talbum { flex: 1; min-width: 0; font-size: 13px; color: var(--color-muted); display: none; }
	@media (min-width: 820px) { .talbum { display: block; } }
	.tdur { flex: none; font-size: 13px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
	/* Equalizer bars: the accent's only other job. */
	.eq { display: flex; align-items: flex-end; gap: 2px; height: 14px; width: 16px; flex: none; }
	.eq i { width: 3px; background: var(--color-accent); display: block; }
	.eq i:nth-child(1) { height: 6px; } .eq i:nth-child(2) { height: 14px; } .eq i:nth-child(3) { height: 9px; }

	/* ── Shelves ──────────────────────────────────────────────────── */
	.shelf { padding: 8px 20px 28px; }
	@media (min-width: 768px) { .shelf { padding: 8px 32px 32px; } }
	.shelf-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
	.shelf-head h2 { font-size: 22px; }
	.shelf-head span { font-size: 12px; font-weight: 700; color: var(--color-muted); letter-spacing: 0.04em; }
	.cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
	@media (min-width: 620px) { .cards { grid-template-columns: repeat(4, 1fr); } }
	.card { background: var(--color-surface-raised); border-radius: var(--radius-lg); padding: 14px; position: relative; transition: background-color 200ms ease; }
	.card:hover { background: #2a2a2a; }
	.card .art { aspect-ratio: 1; border-radius: var(--radius-md); box-shadow: var(--shadow-md); }
	.card b { display: block; margin-top: 14px; font-size: 15px; font-weight: 700; }
	.card span { font-size: 13px; color: var(--color-muted); }
	.card .fab { position: absolute; right: 22px; top: 128px; width: 44px; height: 44px; border-radius: 50%; background: var(--color-primary); color: #000; display: grid; place-items: center; box-shadow: var(--shadow-md); opacity: 0; transform: translateY(6px); transition: opacity 180ms ease, transform 180ms ease; }
	.card:hover .fab { opacity: 1; transform: translateY(0); }
	@media (max-width: 620px) { .card .fab { display: none; } }

	/* ── Now-playing bar ──────────────────────────────────────────── */
	.nowbar { display: flex; align-items: center; gap: 14px; padding: 12px 16px; background: #000; }
	.nowbar .art { width: 46px; height: 46px; border-radius: var(--radius-sm); flex: none; }
	.nowbar .n b { display: block; font-size: 14px; font-weight: 500; }
	.nowbar .n span { font-size: 12px; color: var(--color-muted); }
	.bar { flex: 1; max-width: 420px; height: 4px; border-radius: 2px; background: #4d4d4d; display: none; }
	@media (min-width: 720px) { .bar { display: block; } }
	.bar .fill { display: block; height: 100%; width: 42%; border-radius: 2px; background: #fff; }

	/* ── Reference sections ───────────────────────────────────────── */
	.wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 90px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 112px; } }
	.section { padding-top: 56px; }
	.section-label { font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-accent); margin-bottom: 10px; }
	.section h2 { font-size: 28px; }
	@media (min-width: 768px) { .section h2 { font-size: 34px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; font-size: 15px; }
	.note { margin-top: 18px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Buttons: full pills, green means play ────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 700;
		height: 48px; padding: 0 32px;
		border: 0; border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: transform 140ms ease, background-color 140ms ease;
	}
	.btn:hover { transform: scale(1.04); background: var(--color-accent); }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgb(29 185 84 / 0.4); }
	.btn-outline { background: transparent; color: #fff; box-shadow: inset 0 0 0 1px #7c7c7c; }
	.btn-outline:hover { background: transparent; box-shadow: inset 0 0 0 1px #fff; }
	.btn-plain { background: transparent; color: var(--color-muted); padding: 0 12px; }
	.btn-plain:hover { color: #fff; transform: none; }
	.btn[disabled] { cursor: not-allowed; background: #363636; color: #7c7c7c; transform: none; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 62px; border-radius: var(--radius-lg); }
	.sw b { display: block; font-size: 13px; font-weight: 700; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 286px 1fr; gap: 44px; } }
	.phone {
		width: 286px; max-width: 100%; margin: 0 auto;
		border-radius: 28px; overflow: hidden;
		background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-hd { background: linear-gradient(180deg, #2f6f47, var(--color-surface) 92%); padding: 12px 16px 18px; }
	.phone-status { display: flex; justify-content: space-between; font-size: 10px; color: rgb(255 255 255 / 0.75); }
	.m-cover { width: 148px; height: 148px; margin: 16px auto 0; border-radius: var(--radius-sm); box-shadow: var(--shadow-lg); background: linear-gradient(135deg, #1db954, #0d4d2a 70%, #08331c); display: grid; place-items: center; font-weight: 800; font-size: 22px; }
	.phone-hd h4 { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; margin: 16px 0 4px; }
	.phone-hd .meta { font-size: 11px; color: var(--color-muted); }
	.m-actions { display: flex; align-items: center; gap: 16px; padding: 12px 16px 6px; }
	.m-actions .play { width: 46px; height: 46px; font-size: 17px; margin-left: auto; }
	.m-trow { display: flex; align-items: center; gap: 10px; padding: 8px 16px; }
	.m-trow .tart { width: 36px; height: 36px; }
	.m-trow b { display: block; font-size: 13px; font-weight: 500; }
	.m-trow span { font-size: 11px; color: var(--color-muted); }
	.m-now { display: flex; align-items: center; gap: 10px; margin: 10px 8px 6px; padding: 8px 10px; border-radius: var(--radius-md); background: #3a2f2a; }
	.m-now .art { width: 32px; height: 32px; border-radius: 3px; }
	.m-now b { font-size: 12px; display: block; }
	.m-now span { font-size: 10px; color: var(--color-muted); }
	.m-tabs { display: flex; background: #101010; }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 14px; font-weight: 700; }
	.m-tabs .is-active { color: #fff; }
	.m-tabs .g { display: block; width: 17px; height: 17px; border: 2px solid currentColor; border-radius: 4px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 3px; letter-spacing: -0.01em; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: var(--radius-lg); background: rgb(29 185 84 / 0.16); border: 1px solid rgb(29 185 84 / 0.4); color: var(--color-primary); font-size: 15px; font-weight: 700; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-lg); background: var(--color-surface-raised); font-size: 15px; font-weight: 700; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the playlist. Layers of near-black, cover art as the light source,
     and exactly one green circle that means play. -->
<div class="app">
	<aside class="rail">
		<div class="logo"><span class="mk"></span>Vetta</div>
		<div class="r-item is-active"><span class="g"></span>Home</div>
		<div class="r-item"><span class="g"></span>Search</div>
		<div class="r-item"><span class="g"></span>Your library</div>
		<div class="r-divider"></div>
		<div class="r-play is-playing"><span class="art" style="background:linear-gradient(135deg,#1db954,#0d4d2a)"></span><span><b>Deep focus</b>Playlist</span></div>
		<div class="r-play"><span class="art" style="background:linear-gradient(135deg,#c94b8c,#4a1237)"></span><span><b>Night drive</b>Playlist</span></div>
		<div class="r-play"><span class="art" style="background:linear-gradient(135deg,#e3a04c,#5a3510)"></span><span><b>Warm starts</b>Playlist</span></div>
		<div class="r-play"><span class="art" style="background:linear-gradient(135deg,#4c7de3,#122b5a)"></span><span><b>Long reads</b>Playlist</span></div>
	</aside>

	<main class="main">
		<div class="main-top">
			<span class="circle-btn">‹</span><span class="circle-btn">›</span>
			<span class="spacer"></span>
			<button class="btn btn-outline" style="height:36px;font-size:13px;padding:0 18px">Upgrade</button>
		</div>

		<div class="plhead">
			<div class="cover">DF</div>
			<div>
				<div class="k">Public playlist</div>
				<h1>Deep focus</h1>
				<div class="meta"><b>Vetta</b><span class="muted">· 48 songs, about 2 hr 40 min</span></div>
			</div>
		</div>

		<div class="actions">
			<button class="play">▶</button>
			<button class="icon-btn">＋</button>
			<button class="icon-btn">···</button>
		</div>

		<div class="tracks">
			<div class="thead"><span style="width:18px;text-align:right">#</span><span style="width:40px"></span><span class="spacer">Title</span><span style="width:60px;text-align:right">Time</span></div>
			<div class="trow is-playing">
				<span class="eq"><i></i><i></i><i></i></span>
				<span class="tart" style="background:linear-gradient(135deg,#1db954,#0a3a20)"></span>
				<span class="tname"><b>Hairline</b><span>Ana Rivera</span></span>
				<span class="talbum">Tokens</span><span class="tdur">3:42</span>
			</div>
			<div class="trow">
				<span class="tindex">2</span>
				<span class="tart" style="background:linear-gradient(135deg,#3f6fd8,#12224a)"></span>
				<span class="tname"><b>Raised surface</b><span>Jun Sun</span></span>
				<span class="talbum">Layers</span><span class="tdur">4:08</span>
			</div>
			<div class="trow">
				<span class="tindex">3</span>
				<span class="tart" style="background:linear-gradient(135deg,#c04f7a,#3d1024)"></span>
				<span class="tname"><b>Sentence case</b><span>Mo Okafor</span></span>
				<span class="talbum">Type</span><span class="tdur">2:55</span>
			</div>
			<div class="trow">
				<span class="tindex">4</span>
				<span class="tart" style="background:linear-gradient(135deg,#d99a3c,#4a2f0c)"></span>
				<span class="tname"><b>Pill shape</b><span>Kaori Mori</span></span>
				<span class="talbum">Controls</span><span class="tdur">3:20</span>
			</div>
		</div>

		<div class="shelf">
			<div class="shelf-head"><h2>Made for you</h2><span>Show all</span></div>
			<div class="cards">
				<div class="card"><div class="art" style="background:linear-gradient(135deg,#1db954,#0a3a20)"></div><span class="fab">▶</span><b>Daily mix 1</b><span>Ana Rivera, Jun Sun</span></div>
				<div class="card"><div class="art" style="background:linear-gradient(135deg,#3f6fd8,#12224a)"></div><span class="fab">▶</span><b>Daily mix 2</b><span>Mo Okafor, Kaori Mori</span></div>
				<div class="card"><div class="art" style="background:linear-gradient(135deg,#c04f7a,#3d1024)"></div><span class="fab">▶</span><b>Discover weekly</b><span>Your weekly mixtape</span></div>
				<div class="card"><div class="art" style="background:linear-gradient(135deg,#d99a3c,#4a2f0c)"></div><span class="fab">▶</span><b>Release radar</b><span>Catch all the latest</span></div>
			</div>
		</div>
	</main>
</div>

<div class="nowbar">
	<span class="art" style="background:linear-gradient(135deg,#1db954,#0a3a20)"></span>
	<span class="n"><b>Hairline</b><span>Ana Rivera</span></span>
	<span class="spacer"></span>
	<span class="bar"><span class="fill"></span></span>
	<span class="spacer"></span>
	<span class="muted" style="font-size:12px">1:34 / 3:42</span>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — The green rule</p>
		<h2>Green is a button, never a color</h2>
		<p class="lede">The electric green exists to mean play. It fills pills and circles with black
			bold labels on top, and it drives the equalizer bars on the row that is currently sounding.
			It is never a text color, never a background wash, and never a tinted panel.</p>
		<div class="row" style="margin-top: 24px;">
			<button class="btn">Play</button>
			<button class="btn btn-outline">Follow</button>
			<button class="btn btn-plain">···</button>
			<button class="btn" disabled>Unavailable</button>
		</div>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#1db954 · play only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#1ed760 · live, hover</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#121212 · base layer</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#1f1f1f · cards, rows</span></div>
		</div>
		<p class="note">Depth is a lightness step between layers, plus a white/10 wash on hover. There are almost no borders in this system — one shade lighter is the separator.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Type</p>
		<h2>Big, black, and in sentence case</h2>
		<p class="lede">A playlist title runs 68px at weight 800 with −0.045em tracking. Shelf titles are
			22px bold. There are no timid headings anywhere, and title case never appears — it is
			"Made for you", not "Made For You".</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>The stage gets smaller, not quieter</h2>
		<p class="lede">Phone layout keeps the art wash, the oversized title and the green circle. What
			goes is the album column, the side rail and the desktop now-playing bar — replaced by a floating
			mini-player that keeps the current track one tap away.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-hd">
					<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
					<div class="m-cover">DF</div>
					<h4>Deep focus</h4>
					<div class="meta">Vetta · 48 songs · 2 hr 40 min</div>
				</div>
				<div class="m-actions">
					<span class="icon-btn" style="font-size:18px">＋</span>
					<span class="icon-btn" style="font-size:18px">↓</span>
					<span class="icon-btn" style="font-size:18px">···</span>
					<button class="play">▶</button>
				</div>
				<div class="m-trow"><span class="tart" style="background:linear-gradient(135deg,#1db954,#0a3a20)"></span><span><b style="color:var(--color-accent)">Hairline</b><span>Ana Rivera</span></span><span class="spacer"></span><span class="eq"><i></i><i></i><i></i></span></div>
				<div class="m-trow"><span class="tart" style="background:linear-gradient(135deg,#3f6fd8,#12224a)"></span><span><b>Raised surface</b><span>Jun Sun</span></span></div>
				<div class="m-trow"><span class="tart" style="background:linear-gradient(135deg,#c04f7a,#3d1024)"></span><span><b>Sentence case</b><span>Mo Okafor</span></span></div>
				<div class="m-now"><span class="art" style="background:linear-gradient(135deg,#1db954,#0a3a20)"></span><span><b>Hairline</b><span>Ana Rivera</span></span><span class="spacer"></span><span style="font-size:14px">▶</span></div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Home</div>
					<div><span class="g"></span>Search</div>
					<div><span class="g"></span>Library</div>
					<div><span class="g"></span>Premium</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>The art wash</b>The gradient pulled from the cover stays at the top of the screen. It is the only source of color in the layout, so it survives every breakpoint.</li>
				<li><b>Title scale</b>68px → 24px, still weight 800 with tight tracking. It stays the largest thing on the screen relative to everything around it.</li>
				<li><b>Track rows</b>56px → 52px; the album column and the track index leave, cover art and artist stay. The equalizer bars stay on the sounding row — that is how you find your place.</li>
				<li><b>Shelves</b>Four-up card grids become a horizontally scrolling row with the same 8px radius and 16px gaps. Cards keep their raised fill; the hover play circle is dropped rather than made permanent.</li>
				<li><b>Mini player</b>The desktop bottom bar becomes a floating rounded strip above the tab bar, tinted from the current art. Tapping it expands to the full player.</li>
				<li><b>Green</b>Exactly one green element per screen: the play circle. On the mini player the control is a plain white glyph, so the rule is not diluted.</li>
				<li><b>Targets</b>The play circle is 56px on desktop and never smaller than 46px on touch. Icon buttons grow to 44px hit areas while keeping their 18–22px glyphs.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the stage</h2>
		<div class="compare">
			<div class="cmp-off">Green tinted panel
				<small>Green at 16% as a background · green text · a hairline border in the accent color. Every one of those spends the play color on something that is not play.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>#1f1f1f raised layer, white text, muted secondary, no border. If it needs to stand out, it gets one step lighter — not a hue.</small></div>
		</div>
		<p class="note">Also out: a light theme, thin gray hairline chrome, small timid headings, black text on dark layers, and title case anywhere.</p>
	</section>
</div>

</body>
</html>
`;

const MeadowBuddies_THEME = `/* Meadow Buddies — soft woodland fitness. Original implementation; reference image excluded. */
@theme static {
	--color-primary: #492724;
	--color-primary-foreground: #fffdf8;
	--color-surface: #f8f9f5;
	--color-surface-foreground: #2d2423;
	--color-surface-raised: #ffffff;
	--color-muted: #6f756a;
	--color-accent: #a5bf7d;
	--color-danger: #a45c40;
	--color-border: #e8ece5;
	--color-sage-light: #dce7bf;
	--color-sage-dark: #526b43;
	--color-apricot: #f9cc87;
	--color-apricot-light: #fff0d1;
	--color-honey: #da941b;
	--color-ochre: #856222;
	--color-mist: #f2f6f6;
	--color-stage-end: #cbd6cd;
	--color-stone: #89806d;
	--font-sans: "Avenir Next", "Trebuchet MS", Arial, sans-serif;
	--radius-sm: 8px;
	--radius-md: 16px;
	--radius-lg: 22px;
	--radius-xl: 34px;
	--radius-2xl: 44px;
	--shadow-sm: 0 3px 8px rgb(65 82 46 / 0.04);
	--shadow-md: 0 10px 24px rgb(65 82 46 / 0.06);
	--shadow-lg: 0 28px 44px -18px rgb(65 82 46 / 0.22);
}
`;

const MeadowBuddies_SPEC = `# Meadow Buddies

A woodland fitness companion for small daily wins.

## Atmosphere

Friendly, sunlit and quietly playful. A sage landscape surrounds soft white mobile screens; apricot activity cards and little woodland characters make progress feel approachable. The product is a habit-building companion rather than a performance dashboard. Flat illustrations, rounded silhouette masks and sparse, delicate icon strokes carry the personality. Depth comes from overlapping sheets and a diffuse screen shadow.

## Color roles

- \`surface\` is the quiet reference-page ground; \`surface-raised\` is the white app screen and bottom sheet.
- \`surface-foreground\` is warm, dark text. \`muted\` supports secondary explanations and inactive icons, with sufficient contrast for readable text.
- \`primary\` is cocoa for compact action pills and the selected navigation disc; \`primary-foreground\` is the text or icon on it.
- \`accent\` is the sage presentation stage, activity-card fill and landscape midground. \`sage-light\` supports profile scenery; \`sage-dark\` anchors woodland characters, progress arcs and the first-place podium.
- \`apricot\` fills warm activity cards and the leaderboard sky. \`apricot-light\` softens icon wells and sandy foregrounds. \`honey\` accents reward coins and the third-place podium; \`ochre\` is the darker, readable gold for links.
- \`danger\` is restrained terracotta for negative rank changes and the second-place podium. Rank changes include a signed number and direction marker, so color is not the only signal.
- \`mist\` separates the navigation tray and ranking rows. \`border\` is a fine divider, not a heavy outline. \`stage-end\` closes the presentation background with a pale gray-green gradient; \`stone\` carries the reward banner.
- Literal palette values live in \`theme.css\`. The standalone demo mirrors those tokens in its own \`:root\`.

## Typography

The local \`font-sans\` stack has a friendly, rounded humanist shape. No font download is required. Main screen headings are 30–34px, medium weight with slightly tight tracking; centered navigation titles are 15–16px. At the 320px specimen width, body labels are 11–13px and metadata 10–11px. Live narrow-screen examples use at least 12px labels. Large numbers use a tabular rhythm; section labels in the reference use small uppercase letterspacing. Dense blocks of uppercase text are absent from the product screens.

## Spacing & layout

The desktop presentation shows three 320 × 690px phones with 44px corners, 40px gutters and a 36px upward step between screens. Product padding is 22px; local spacing follows a 4/8/12/16/24px rhythm. Profile and leaderboard use an illustrated upper field with a white sheet overlapping below. Discover uses a white body, a small reward banner, four equal shortcuts, two tall illustrated exercise cards and a pale bottom navigation tray.

Below 1120px, the presentation becomes a single centered column in the same reading order. Individual phone widths shrink to the available viewport without cropping their text. Reference grids collapse below 700px. Nothing relies on a sideways document scroll. On a real mobile surface, the phone specimen becomes a full-width screen: outer shadows and presentation offsets disappear, touch targets reach 44px, explanatory text becomes 12px or larger, and cards preserve their illustrated lower half. Safe-area padding belongs to any fixed production navigation.

## Components

- **Profile:** a centered title; a circular frog avatar with an incomplete progress ring; a hexagonal level badge, points and friend count; four quiet preference rows; one selected cocoa navigation disc.
- **Reward banner:** a stone-colored rounded rectangle with a level badge at the left, two short encouragement lines and a honey progress ring with a visible percentage at the right.
- **Shortcuts:** four equal circle wells containing small line icons. Text labels remain outside the circles.
- **Exercise cards:** apricot strength training and sage running, paired side by side. The top carries a short title, description and cocoa action pill; animal art occupies the lower half and stays behind the text. The numbered corner ribbon is small and terracotta.
- **Leaderboard:** an apricot landscape above a 2–1–3 podium; a frog winner, two companion portraits and a small honey ribbon. The overlapping white sheet has five ranking rows with rank, colored animal avatar, name, reward points and signed direction. The current user has a fine cocoa outline.
- **Characters:** original inline SVG primitives produce expressive eyes, rounded cheeks, spotted frog faces, tall rabbit ears and a long crocodile muzzle. They are artwork, never substitutes for functional icons. Decorative art is hidden from assistive technology.
- **Controls:** short cocoa pills, subtle pale icon wells, visible keyboard focus and disabled styling. Demo navigation uses real document anchors; mock account rows and rank data are static specimens. The native disclosure in the component reference demonstrates a working, script-free expanded state.

## Motion

Feedback is limited to 140ms color, outline and shadow changes. Hover is a supplement to visible selection, not the only way to reveal controls. Touch and keyboard interaction preserve the same information. Reduced-motion preferences remove transitions. There are no entrance sequences, looping characters or moving progress values in the reference.

## Don't

- Neon green, cold black and heavy offset shadows break the soft woodland atmosphere.
- Glass blur, glossy 3D characters, gradients inside every control and oversized pill containers compete with the flat illustration language.
- A generic marketing hero cannot replace the actual Profile / Discover / Leader Board product screens.
- Tiny low-contrast action text, icon-only rank changes and hidden hover-only actions lose essential information.
- Artwork does not cover labels, crop faces accidentally or replace semantic controls.
- The original reference screenshot is not part of this entry. Source attribution is limited to what is known in \`meta.json\`; the implementation does not claim ownership or licensing of the supplied image.
`;

const MeadowBuddies_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Meadow Buddies — a little movement, a little joy</title>
<style>
/* Mirrors theme.css so the gallery's script-free srcdoc needs no external assets. */
:root {
  --color-primary: #492724;
  --color-primary-foreground: #fffdf8;
  --color-surface: #f8f9f5;
  --color-surface-foreground: #2d2423;
  --color-surface-raised: #ffffff;
  --color-muted: #6f756a;
  --color-accent: #a5bf7d;
  --color-danger: #a45c40;
  --color-border: #e8ece5;
  --color-sage-light: #dce7bf;
  --color-sage-dark: #526b43;
  --color-apricot: #f9cc87;
  --color-apricot-light: #fff0d1;
  --color-honey: #da941b;
  --color-ochre: #856222;
  --color-mist: #f2f6f6;
  --color-stage-end: #cbd6cd;
  --color-stone: #89806d;
  --font-sans: "Avenir Next", "Trebuchet MS", Arial, sans-serif;
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 22px;
  --radius-xl: 34px;
  --radius-2xl: 44px;
  --shadow-sm: 0 3px 8px rgb(65 82 46 / 0.04);
  --shadow-md: 0 10px 24px rgb(65 82 46 / 0.06);
  --shadow-lg: 0 28px 44px -18px rgb(65 82 46 / 0.22);
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--color-surface-foreground); background: var(--color-surface); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
h1,h2,h3,p { margin: 0; }
a { color: inherit; text-decoration: none; }
button,summary { font: inherit; }
button,a,summary { -webkit-tap-highlight-color: transparent; }
a:focus-visible,button:focus-visible,summary:focus-visible { outline: 3px solid var(--color-ochre); outline-offset: 4px; }
button:disabled { cursor: not-allowed; opacity: .45; }
svg { display: block; }
.svg-library { position: absolute; width: 0; height: 0; overflow: hidden; }
.icon { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.showcase { background: linear-gradient(171deg, var(--color-accent) 0%, #abc38e 38%, var(--color-stage-end) 100%); padding: 64px 40px 42px; }
.stage { display: grid; grid-template-columns: repeat(3,320px); gap: 40px; align-items: start; width: 1040px; margin: auto; }
.phone { width: 320px; height: 690px; position: relative; isolation: isolate; overflow: hidden; border-radius: var(--radius-2xl); background: var(--color-surface-raised); box-shadow: var(--shadow-lg); scroll-margin-top: 24px; }
.profile { margin-top: 72px; background: #bad092; }
.discover { margin-top: 36px; }
.screen-title { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; height: 32px; margin: 38px 18px 0; font-size: 16px; font-weight: 500; }
.back { position: absolute; left: -6px; display: grid; place-items: center; width: 44px; height: 44px; }
.back .icon { width: 18px; height: 18px; }
.profile-land { position: absolute; top: 34px; left: 0; width: 100%; height: 280px; }
.profile-avatar { width: 112px; height: 112px; position: absolute; top: 97px; left: calc(50% - 56px); }
.profile-stats { position: absolute; display: flex; align-items: center; justify-content: center; gap: 18px; top: 213px; left: 16px; right: 16px; height: 80px; }
.level { width: 64px; height: 64px; flex-shrink: 0; filter: drop-shadow(0 3px 5px rgb(168 126 44 / .14)); }
.stat { min-width: 66px; }
.stat strong { display: flex; align-items: center; gap: 4px; font-weight: 500; font-size: 17px; line-height: 1.6; }
.stat small { font-size: 10px; }
.stat + .stat { border-left: 1px solid rgb(96 119 67 / .15); padding-left: 16px; }
.coin { width: 14px; height: 14px; flex-shrink: 0; }
.profile-sheet { position: absolute; inset: 292px 0 0; background: var(--color-surface-raised); border-radius: var(--radius-xl) var(--radius-xl) 0 0; padding: 14px 22px 64px; }
.settings { list-style: none; margin: 0; padding: 0; }
.settings li { display: flex; align-items: center; gap: 12px; min-height: 72px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
.setting-icon { display: grid; place-items: center; width: 41px; height: 41px; border-radius: 50%; background: var(--color-apricot-light); color: var(--color-ochre); flex-shrink: 0; }
.setting-icon .icon { width: 19px; height: 19px; stroke-width: 1.1; }
.bottom-nav { position: absolute; inset: auto 0 0; display: flex; justify-content: space-evenly; align-items: center; background: var(--color-mist); border-radius: 28px 28px 0 0; height: 64px; padding: 0 14px; z-index: 3; }
.nav-link { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: #939f9d; transition: background 140ms, color 140ms; }
.nav-link .icon { width: 19px; height: 19px; stroke-width: 1.2; }
.nav-link.is-selected { background: var(--color-primary); color: var(--color-primary-foreground); }
.nav-link.is-selected .icon { width: 23px; height: 23px; }
.discover-content { padding: 31px 22px 80px; }
.discover h2 { font-size: 34px; font-weight: 500; letter-spacing: -1.2px; margin-bottom: 18px; }
.reward { display: flex; gap: 9px; align-items: center; height: 69px; padding: 8px 12px; background: var(--color-stone); border-radius: var(--radius-md); color: var(--color-primary-foreground); }
.reward .level { width: 43px; height: 47px; }
.reward p { font-size: 10px; line-height: 1.6; flex: 1; }
.reward-progress { position: relative; width: 44px; height: 44px; flex-shrink: 0; }
.reward-progress svg { width: 100%; height: 100%; }
.reward-progress span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 9px; }
.shortcuts { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-top: 21px; }
.shortcut { display: flex; align-items: center; flex-direction: column; gap: 9px; font-size: 10px; min-height: 84px; }
.shortcut-well { width: 56px; height: 56px; border: 1px solid var(--color-border); border-radius: 50%; display: grid; place-items: center; color: var(--color-ochre); box-shadow: inset 0 0 0 5px #fdfdfb; transition: background 140ms; }
.shortcut-well .icon { width: 23px; height: 23px; stroke-width: 1.2; }
.exercise-heading { display: flex; align-items: center; justify-content: space-between; margin: 21px 0 15px; }
.exercise-heading h3 { font-size: 22px; font-weight: 600; letter-spacing: -.5px; }
.see-more { font-size: 10px; color: var(--color-ochre); display: flex; align-items: center; gap: 5px; min-height: 32px; }
.see-more .icon { width: 17px; height: 17px; }
.exercise-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 12px; }
.exercise-card { position: relative; overflow: hidden; height: 240px; border-radius: var(--radius-lg); padding: 18px 14px; background: var(--color-apricot); }
.exercise-card.run { background: var(--color-accent); }
.exercise-card h4 { position: relative; z-index: 2; margin: 0 0 5px; font-size: 12px; font-weight: 600; }
.exercise-card p { position: relative; z-index: 2; font-size: 9px; line-height: 1.4; max-width: 112px; color: #545039; }
.pill { position: relative; z-index: 2; display: inline-flex; align-items: center; justify-content: center; min-height: 31px; padding: 8px 18px; border: 0; border-radius: 99px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 10px; line-height: 1.2; transition: background 140ms, box-shadow 140ms; cursor: pointer; }
.exercise-card .pill { margin-top: 10px; min-height: 29px; padding: 8px 17px; font-size: 9px; }
.exercise-art { position: absolute; bottom: 0; left: 0; width: 100%; height: 155px; }
.ribbon { position: absolute; z-index: 3; right: 12px; top: 0; width: 32px; height: 43px; background: #ac682e; color: var(--color-primary-foreground); font-size: 12px; padding-top: 11px; text-align: center; clip-path: polygon(0 0,100% 0,100% 81%,50% 100%,0 82%); box-shadow: inset 4px 0 rgb(73 39 36 / .15); }
.exercise-card:first-child h4 { padding-right: 14px; font-size: 11px; }
.leaderboard { background: var(--color-apricot); }
.leader-land { position: absolute; top: 15px; width: 100%; height: 285px; }
.podium { position: absolute; display: flex; align-items: end; justify-content: center; gap: 16px; top: 104px; left: 35px; right: 35px; height: 188px; }
.podium-place { width: 59px; text-align: center; position: relative; }
.podium-avatar { width: 53px; height: 53px; margin: 0 auto 8px; }
.podium-place.first .podium-avatar { width: 68px; height: 68px; margin-bottom: 20px; }
.podium-block { padding-top: 14px; height: 96px; border-radius: 19px 19px 0 0; background: var(--color-danger); font-size: 24px; color: var(--color-primary-foreground); }
.first .podium-block { height: 116px; background: #647555; }
.third .podium-block { height: 69px; background: var(--color-honey); }
.winner-ribbon { position: absolute; top: 57px; left: -1px; right: -1px; padding: 4px 0; font-size: 8px; background: var(--color-honey); color: var(--color-primary-foreground); clip-path: polygon(0 0,100% 0,92% 50%,100% 100%,0 100%,8% 50%); }
.leader-sheet { position: absolute; inset: 275px 0 0; border-radius: var(--radius-xl) var(--radius-xl) 0 0; padding: 21px 22px; background: var(--color-surface-raised); }
.ranking { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.ranking li { display: grid; grid-template-columns: 27px 1fr; align-items: center; gap: 10px; min-height: 65px; }
.rank-number { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rank-card { display: flex; align-items: center; gap: 10px; height: 65px; background: var(--color-mist); border: 1px solid transparent; border-radius: 18px; padding: 9px 11px; min-width: 0; }
.rank-card.current { border-color: var(--color-primary); }
.rank-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--color-apricot); flex-shrink: 0; }
.rank-avatar.green { background: var(--color-sage-light); }
.rank-avatar.stone { background: #c3b8a1; }
.rank-info { flex: 1; min-width: 0; }
.rank-info strong { font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px; }
.rank-info small { font-size: 10px; color: var(--color-muted); display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.rank-info .coin { width: 12px; height: 12px; }
.rank-change { display: flex; align-items: center; gap: 4px; font-size: 10px; white-space: nowrap; }
.triangle { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid var(--color-danger); }
.triangle.up { border-top: 0; border-bottom: 7px solid #7ba541; }
.stage-caption { max-width: 1040px; margin: 48px auto 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; color: #48603e; font-size: 11px; letter-spacing: 1.1px; text-transform: uppercase; }
.stage-caption span { display: flex; align-items: center; gap: 9px; }
.stage-caption i { width: 7px; height: 7px; border-radius: 50%; background: var(--color-sage-dark); }
.manual { width: min(1040px,calc(100% - 64px)); margin: 0 auto; padding: 76px 0 36px; }
.manual-header { display: flex; align-items: end; justify-content: space-between; gap: 40px; padding-bottom: 45px; border-bottom: 1px solid var(--color-border); }
.eyebrow { font-size: 11px; color: var(--color-sage-dark); letter-spacing: 2px; font-weight: 600; text-transform: uppercase; margin-bottom: 14px; }
h1 { font-size: clamp(32px,4.2vw,56px); line-height: 1.1; letter-spacing: -2px; font-weight: 500; }
.intro { color: var(--color-muted); font-size: 14px; line-height: 1.8; max-width: 340px; }
.reference-section { padding: 44px 0; border-bottom: 1px solid var(--color-border); scroll-margin-top: 32px; }
.reference-section > h2 { font-size: 24px; letter-spacing: -.6px; font-weight: 500; margin-bottom: 12px; }
.section-description { color: var(--color-muted); font-size: 14px; line-height: 1.7; max-width: 620px; margin-bottom: 26px; }
.swatches { display: grid; grid-template-columns: repeat(5,1fr); gap: 14px; }
.swatch { overflow: hidden; border-radius: var(--radius-md); background: var(--color-surface-raised); border: 1px solid var(--color-border); }
.swatch-color { height: 90px; background: var(--swatch-color); }
.swatch-label { padding: 14px; }
.swatch-label strong { font-size: 12px; display: block; font-weight: 600; }
.swatch-label small { color: var(--color-muted); font-size: 11px; line-height: 1.8; }
.reference-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px; }
.reference-card { min-width: 0; padding: 28px; border-radius: var(--radius-lg); background: var(--color-surface-raised); border: 1px solid var(--color-border); }
.reference-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.reference-card p { font-size: 13px; line-height: 1.8; color: var(--color-muted); }
.radius-samples { display: flex; align-items: end; gap: 20px; margin: 24px 0; }
.radius-samples span { display: grid; place-items: center; flex: 1; min-width: 0; max-width: 72px; height: 72px; background: var(--color-sage-light); color: var(--color-sage-dark); font-size: 12px; }
.type-large { font-size: 36px; font-weight: 500; letter-spacing: -1.2px; margin: 18px 0 6px; }
.type-small { margin: 8px 0 22px; font-size: 14px; }
.controls-row { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 23px 0; }
.controls-row .pill { min-height: 44px; font-size: 12px; }
.pill.secondary { background: var(--color-apricot-light); color: var(--color-primary); }
.pill.focus-example { outline: 3px solid var(--color-ochre); outline-offset: 4px; }
.activity-details { border-top: 1px solid var(--color-border); margin-top: 24px; padding-top: 20px; font-size: 13px; }
.activity-details summary { cursor: pointer; color: var(--color-sage-dark); min-height: 44px; padding: 12px 0; }
.activity-details p { padding: 10px 0; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.cmp-off,.cmp-on { border-radius: var(--radius-lg); padding: 25px; }
.cmp-off { background: #edeff3; }
.cmp-on { background: var(--color-sage-light); }
.comparison-label { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 22px; }
.bad-workout { min-height: 175px; padding: 24px; background: #aaff00; color: #111; border: 3px solid #111; box-shadow: 6px 6px 0 #111; }
.bad-workout strong { display: block; font: 900 25px Arial,sans-serif; letter-spacing: -1px; }
.bad-workout span { display: inline-block; background: #111; color: white; font-size: 11px; padding: 12px 20px; margin-top: 26px; }
.good-workout { position: relative; min-height: 175px; overflow: hidden; padding: 24px; background: var(--color-apricot); border-radius: var(--radius-lg); }
.good-workout strong { position: relative; z-index: 1; display: block; font-size: 18px; font-weight: 500; }
.good-workout p { position: relative; z-index: 1; font-size: 11px; margin: 7px 0 15px; }
.good-workout > svg { position: absolute; width: 110px; height: 145px; right: 0; bottom: -9px; }
.comparison-note { font-size: 12px; line-height: 1.8; margin-top: 22px; color: #52594d; }
.mobile-reference { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.mobile-stage { background: linear-gradient(150deg,var(--color-sage-light),var(--color-stage-end)); padding: 34px; border-radius: var(--radius-xl); }
.compact-phone { background: var(--color-surface-raised); border-radius: var(--radius-xl); max-width: 320px; margin: auto; overflow: hidden; box-shadow: var(--shadow-md); }
.compact-content { padding: 28px 22px; }
.compact-content h3 { font-size: 30px; font-weight: 500; letter-spacing: -.8px; margin-bottom: 20px; }
.mobile-greeting { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--color-sage-light); border-radius: var(--radius-md); }
.mobile-greeting svg { width: 52px; height: 52px; flex-shrink: 0; }
.mobile-greeting p { font-size: 12px; line-height: 1.7; }
.mobile-greeting strong { display: block; font-weight: 600; }
.mobile-workout { position: relative; margin-top: 20px; padding: 21px; background: var(--color-apricot); border-radius: var(--radius-lg); overflow: hidden; height: 218px; }
.mobile-workout h4 { margin: 0 0 7px; font-size: 17px; }
.mobile-workout p { position: relative; z-index: 1; font-size: 12px; max-width: 120px; line-height: 1.6; }
.mobile-workout .pill { margin-top: 15px; min-height: 44px; font-size: 12px; padding: 12px 20px; }
.mobile-workout > svg { position: absolute; right: -12px; bottom: -10px; width: 140px; height: 160px; }
.compact-nav { display: flex; justify-content: space-around; padding: 10px 12px 16px; background: var(--color-mist); border-radius: 22px 22px 0 0; }
.responsive-notes { list-style: none; padding: 0; margin: 0; counter-reset: note; }
.responsive-notes li { position: relative; counter-increment: note; padding: 0 0 25px 40px; color: var(--color-muted); font-size: 13px; line-height: 1.8; }
.responsive-notes li::before { content: "0" counter(note); position: absolute; left: 0; top: 1px; font-size: 11px; color: var(--color-sage-dark); }
.responsive-notes strong { display: block; font-size: 14px; color: var(--color-surface-foreground); font-weight: 600; margin-bottom: 4px; }
.footer { display: flex; justify-content: space-between; gap: 20px; font-size: 11px; color: var(--color-muted); padding: 28px 0 8px; line-height: 1.7; }
.footer a { text-decoration: underline; text-underline-offset: 4px; }
@media (hover:hover) {
  .nav-link:hover { background: var(--color-border); color: var(--color-primary); }
  .nav-link.is-selected:hover { background: #613b35; color: var(--color-primary-foreground); }
  .shortcut:hover .shortcut-well { background: var(--color-apricot-light); }
  .pill:hover:not(:disabled) { box-shadow: 0 4px 12px rgb(73 39 36 / .2); }
  .see-more:hover { text-decoration: underline; text-underline-offset: 3px; }
}
@media (max-width:1120px) {
  .stage { width: 100%; grid-template-columns: minmax(0,320px); justify-content: center; gap: 38px; }
  .phone { margin-top: 0; max-width: 100%; }
  .showcase { padding: 40px 24px 28px; }
  .stage-caption { max-width: 480px; margin-top: 32px; font-size: 9px; letter-spacing: .6px; }
}
@media (max-width:700px) {
  .manual { width: calc(100% - 40px); padding-top: 42px; }
  .manual-header { flex-direction: column; align-items: start; gap: 20px; }
  .reference-grid,.comparison,.mobile-reference { grid-template-columns: minmax(0,1fr); }
  .mobile-reference { gap: 30px; }
  .swatches { grid-template-columns: repeat(2,1fr); gap: 10px; }
  .swatch:last-child { grid-column: 1 / -1; }
  .swatch-color { height: 70px; }
  .reference-section { padding: 32px 0; }
  .reference-card { padding: 22px; }
  .footer { flex-direction: column; gap: 10px; }
}
@media (max-width:380px) {
  .showcase { padding-inline: 14px; }
  .phone { border-radius: 36px; }
  .discover-content { padding-inline: 16px; }
  .shortcut-well { width: 51px; height: 51px; }
  .shortcut { font-size: 9px; }
  .exercise-card { padding-inline: 10px; }
  .leader-sheet { padding-inline: 14px; }
  .rank-card { gap: 7px; padding-inline: 8px; }
  .profile-stats { gap: 9px; }
  .mobile-stage { padding: 20px 14px; }
  .stage-caption { flex-direction: column; align-items: center; gap: 8px; }
}
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { transition: none !important; } }
</style>
</head>
<body>
<svg class="svg-library" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
  <symbol id="i-back" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6"/></symbol>
  <symbol id="i-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></symbol>
  <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="7" r="3.5"/><path d="M5 20v-2a7 7 0 0 1 14 0v2Z"/></symbol>
  <symbol id="i-user-filled" viewBox="0 0 24 24"><circle cx="12" cy="7" r="3.3" fill="currentColor" stroke="none"/><path d="M5 20v-2a7 6 0 0 1 14 0v2Z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-home-filled" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-chart" viewBox="0 0 24 24"><path d="M10 3a9 9 0 1 0 11 11H10Zm4-1v8h8a9 9 0 0 0-8-8Z"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4Zm5 3h4"/></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 10h18M7 14h1m3 0h1m3 0h1m-9 3h1m3 0h1m3 0h1"/></symbol>
  <symbol id="i-podium" viewBox="0 0 24 24"><path d="M3 11h5v10H3Zm5-5h7v15H8Zm7 7h6v8h-6ZM11.5 2v1m-6 1 1 1m11-1-1 1"/></symbol>
  <symbol id="i-settings" viewBox="0 0 24 24"><path d="m10 3-1 3-3 1-2-1-2 4 2 2v3l-1 2 3 3 3-1 3 2 3-2 3 1 3-3-1-3 1-3-2-2-1-3-4-1-2-2Z" transform="translate(1 0) scale(.9)"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-edit" viewBox="0 0 24 24"><path d="m14 5 4 4m-9 6 11-11-3-3L6 12l-1 5Zm1-10H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></symbol>
  <symbol id="i-ticket" viewBox="0 0 24 24"><path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Zm9 0v3m0 2v2m0 2v3"/></symbol>
  <symbol id="i-exit" viewBox="0 0 24 24"><path d="M12 4H5v16h7m-2-8h11m-4-4 4 4-4 4"/></symbol>
  <symbol id="coin" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--color-honey)"/><circle cx="10" cy="10" r="6" fill="var(--color-apricot)"/><path d="M11 5 7 10h3l-1 5 5-6h-4Z" fill="var(--color-primary-foreground)"/></symbol>
  <symbol id="level" viewBox="0 0 80 80"><path d="m40 2 9 17 20 1-9 17 9 18-21 1-8 18-9-17-21-2 11-18-9-17 19-1Z" fill="var(--color-apricot-light)" opacity=".7"/><path d="m40 13 23 13v28L40 67 17 54V26Z" fill="var(--color-apricot)" stroke="white" stroke-width="4"/><path d="m40 20 17 10v20L40 60 23 50V30Z" fill="var(--color-honey)" opacity=".55"/><path d="M43 29 31 45h15m-4-16v24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="frog" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="45" fill="var(--color-sage-dark)"/>
    <path d="M13 59C9 32 22 17 47 17c25-1 43 13 41 39-2 23-18 32-39 31-22 0-34-10-36-28Z" fill="#718655"/>
    <ellipse cx="32" cy="38" rx="10" ry="11" fill="#91a16f"/><ellipse cx="67" cy="39" rx="10" ry="11" fill="#91a16f"/>
    <circle cx="33" cy="41" r="6.2" fill="var(--color-primary-foreground)"/><circle cx="68" cy="42" r="6.2" fill="var(--color-primary-foreground)"/>
    <circle cx="34" cy="42" r="4.3" fill="#2c3729"/><circle cx="68" cy="43" r="4.3" fill="#2c3729"/>
    <circle cx="35" cy="40" r="1.4" fill="white"/><circle cx="69" cy="41" r="1.4" fill="white"/>
    <path d="M44 60q6 7 12 0" fill="none" stroke="#344730" stroke-width="2.3" stroke-linecap="round"/>
    <g fill="#465e3d"><ellipse cx="23" cy="61" rx="3" ry="5" transform="rotate(-20 23 61)"/><ellipse cx="70" cy="68" rx="3.5" ry="5" transform="rotate(20 70 68)"/><circle cx="45" cy="78" r="3"/><circle cx="28" cy="73" r="2"/><circle cx="77" cy="53" r="2.5"/></g>
    <ellipse cx="29" cy="55" rx="5" ry="2.3" fill="#b9c591" opacity=".5"/><ellipse cx="73" cy="56" rx="5" ry="2.3" fill="#b9c591" opacity=".5"/>
  </symbol>
  <symbol id="fox" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="#b9d6ab"/><path d="m15 22 29 17 15-2 27-15-5 47-30 23-32-24Z" fill="#f5f7e9"/><path d="m15 22 29 17-20 15Zm71 0L59 37l21 17Z" fill="#6c8c60"/><ellipse cx="34" cy="58" rx="5" ry="7" fill="#324b35"/><ellipse cx="67" cy="58" rx="5" ry="7" fill="#324b35"/><path d="m43 70 8 7 8-7Z" fill="#324b35"/></symbol>
  <symbol id="tiger" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="var(--color-apricot)"/><circle cx="24" cy="29" r="13" fill="var(--color-honey)"/><circle cx="77" cy="29" r="13" fill="var(--color-honey)"/><ellipse cx="50" cy="55" rx="35" ry="34" fill="#eba631"/><path d="m41 24 7 15 4-16m-32 22 12 5-12 5m61-10-12 5 12 5" fill="#795337"/><ellipse cx="50" cy="72" rx="21" ry="14" fill="var(--color-apricot-light)"/><ellipse cx="36" cy="54" rx="5" ry="6" fill="#382b27"/><ellipse cx="65" cy="54" rx="5" ry="6" fill="#382b27"/><circle cx="37" cy="52" r="1.7" fill="white"/><circle cx="66" cy="52" r="1.7" fill="white"/><path d="m45 66 6 6 6-6Z" fill="#492724"/><path d="M41 76q10 11 20 0" fill="none" stroke="#492724" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="bear" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="#b2a78f"/><circle cx="24" cy="27" r="14" fill="#837d68"/><circle cx="76" cy="27" r="14" fill="#837d68"/><ellipse cx="50" cy="53" rx="35" ry="37" fill="#918974"/><ellipse cx="50" cy="69" rx="15" ry="14" fill="#b2a58b"/><circle cx="35" cy="47" r="4" fill="#332f28"/><circle cx="66" cy="47" r="4" fill="#332f28"/><ellipse cx="50" cy="63" rx="7" ry="5" fill="#443d30"/><path d="M50 68v7m-8 0q8 6 16 0" stroke="#443d30" stroke-width="2" fill="none"/></symbol>
  <symbol id="bunny" viewBox="0 0 140 185">
    <ellipse cx="71" cy="174" rx="55" ry="8" fill="#b07b39" opacity=".14"/>
    <path d="M46 66C30 27 32 1 43 1c10 0 16 33 17 60M71 60C66 17 73-2 84 2c10 5 4 36-3 63" fill="#d99324"/>
    <path d="M46 56c-6-19-8-37-4-40 5 0 10 25 10 41m24-4c-1-20 2-33 5-36 4 8-1 28-3 37" fill="#956329"/>
    <path d="M37 129c4-27 57-29 65 1l5 32c-10 20-69 22-78 1Z" fill="#e7a53a"/>
    <ellipse cx="67" cy="148" rx="22" ry="25" fill="#ffe7b7"/>
    <path d="M37 137 18 147m82-10 19 10" stroke="#d3912b" stroke-width="15" stroke-linecap="round"/>
    <ellipse cx="66" cy="91" rx="36" ry="34" fill="#e7a53a"/>
    <ellipse cx="49" cy="85" rx="8" ry="10" fill="#fff7df"/><ellipse cx="78" cy="85" rx="8" ry="10" fill="#fff7df"/>
    <ellipse cx="50" cy="87" rx="4.5" ry="6" fill="#352d26"/><ellipse cx="77" cy="87" rx="4.5" ry="6" fill="#352d26"/>
    <ellipse cx="63" cy="105" rx="21" ry="14" fill="#ffe7b7"/><path d="m58 99 6 5 6-5Z" fill="#573e2d"/><path d="M58 111q6 6 12 0" fill="none" stroke="#573e2d" stroke-width="2" stroke-linecap="round"/>
    <path d="M47 171 31 176m54-5 16 5" stroke="#c4862a" stroke-width="11" stroke-linecap="round"/>
    <g transform="rotate(24 25 143)"><path d="M9 143h38" stroke="#425e49" stroke-width="5"/><rect x="6" y="131" width="7" height="24" rx="2" fill="#425e49"/><rect x="15" y="135" width="5" height="16" rx="1" fill="#718d5e"/><rect x="39" y="131" width="7" height="24" rx="2" fill="#425e49"/></g>
  </symbol>
  <symbol id="croc" viewBox="0 0 170 180">
    <path d="M135 84c33 28 20 55 33 84h-58c-12-40-21-44-31-68Z" fill="#67844d"/>
    <path d="M114 103c31 17 24 49 34 72h-26c-4-30-16-45-29-61Z" fill="var(--color-apricot)"/>
    <path d="M96 107c-23 35-39 13-49-1 3 25 21 45 44 35l19-13Z" fill="#526b43"/>
    <path d="M31 73 23 58l20 9 10-14 13 17 13-11 11 12 15-10 8 14 11-8 7 17Z" fill="#e1e8b4"/>
    <path d="M28 70c17 15 51 14 79-2 14-9 24-6 30 4 19 25-20 47-59 39-30-6-48-15-50-41Z" fill="#67844d"/>
    <circle cx="116" cy="63" r="12" fill="#67844d"/><circle cx="143" cy="64" r="12" fill="#67844d"/>
    <circle cx="117" cy="62" r="7" fill="#fffdf0"/><circle cx="143" cy="63" r="7" fill="#fffdf0"/><circle cx="118" cy="62" r="4" fill="#263b2a"/><circle cx="144" cy="63" r="4" fill="#263b2a"/>
    <path d="M38 90q37 18 75 0" fill="none" stroke="#425e37" stroke-width="2"/>
    <path d="m44 93 4 8 5-6m17 5 4 8 5-7" fill="#fff8de"/><circle cx="39" cy="82" r="2" fill="#425e37"/>
  </symbol>
  <symbol id="tree" viewBox="0 0 42 90"><path d="M20 74C-2 76 0 50 10 43-1 27 15 22 14 14c1-19 21-16 19 4-1 8 13 17 5 28 13 17 0 31-15 28Z" fill="currentColor"/><path d="M22 88V20m0 29L12 38m10 25 10-12" fill="none" stroke="#6b833f" stroke-width="1.5"/></symbol>
  <symbol id="fir" viewBox="0 0 45 100"><path d="M23 86 4 75l12-5L2 55l13-2L8 35l12 2-2-23q2-14 9-6l1 23 11-5-3 23 10 8-13 10 9 17Z" fill="currentColor"/><path d="M24 100 23 22m0 29-9-10m10 30 10-10" fill="none" stroke="#987340" stroke-width="1.6"/></symbol>
  <symbol id="cloud" viewBox="0 0 90 35"><path d="M2 30c-1-8 9-10 17-10 0-21 30-24 34-5 15-4 20 2 20 8 19-2 21 5 15 8Z" fill="currentColor"/></symbol>
</defs>
</svg>
<main>
<section class="showcase" aria-label="Meadow Buddies fitness app, three-screen study">
<div class="stage">
  <article class="phone profile" id="profile" lang="id" aria-label="Profile screen">
    <svg class="profile-land" viewBox="0 0 320 280" preserveAspectRatio="none" aria-hidden="true">
      <use href="#cloud" x="57" y="21" width="57" height="23" color="#cbdea6"/><use href="#cloud" x="254" y="4" width="44" height="19" color="#cbdca4"/>
      <path d="M0 131 78 88l44 28L264 23l56 42v215H0Z" fill="#cdddac"/>
      <path d="m215 62 49-39 56 42-45-18 6 41-16-29-8 32-5-43-22 21 10-24Z" fill="#f4f5d7"/>
      <path d="M0 172c59-55 102-9 149-5 61 6 99-42 171-15v128H0Z" fill="#dce7bf"/>
      <path d="M0 204c67-24 100 10 161 0 70-12 94-1 159 18v58H0Z" fill="#e3e9c9"/>
      <path d="m48 280 30-65h31l-11 65m28 0 23-73h28l8 73m25 0-4-67 33 12 13 55" fill="#cfddad" opacity=".6"/>
      <use href="#tree" x="10" y="75" width="43" height="84" color="#8ab647"/><use href="#tree" x="275" y="121" width="34" height="69" color="#8ab647"/>
    </svg>
    <h2 class="screen-title"><a class="back" href="#discover" aria-label="Kembali ke Discover"><svg class="icon" aria-hidden="true"><use href="#i-back"/></svg></a>Profile</h2>
    <svg class="profile-avatar" viewBox="0 0 120 120" role="img" aria-label="Avatar katak, progres level 75 persen"><circle cx="60" cy="60" r="54" fill="none" stroke="#d7e3b7" stroke-width="4"/><circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-sage-dark)" stroke-width="4" stroke-dasharray="255 340" transform="rotate(-90 60 60)"/><use href="#frog" x="10" y="10" width="100" height="100"/></svg>
    <div class="profile-stats">
      <svg class="level" role="img" aria-label="Level 4"><use href="#level"/></svg>
      <div class="stat"><strong><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>4560</strong><small>Total Points</small></div>
      <div class="stat"><strong>300</strong><small>Teman</small></div>
    </div>
    <div class="profile-sheet"><ul class="settings" aria-label="Contoh menu profil">
      <li><span class="setting-icon"><svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg></span>Pengaturan Profil</li>
      <li><span class="setting-icon"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg></span>Ubah Email &amp; Password</li>
      <li><span class="setting-icon"><svg class="icon" aria-hidden="true"><use href="#i-ticket"/></svg></span>Subscription</li>
      <li><span class="setting-icon"><svg class="icon" aria-hidden="true"><use href="#i-exit"/></svg></span>Keluar</li>
    </ul></div>
    <nav class="bottom-nav" aria-label="Navigasi contoh profil">
      <a class="nav-link" href="#discover" aria-label="Discover"><svg class="icon" aria-hidden="true"><use href="#i-home"/></svg></a>
      <a class="nav-link" href="#leaderboard" aria-label="Leader Board"><svg class="icon" aria-hidden="true"><use href="#i-chart"/></svg></a>
      <a class="nav-link" href="#activity-detail" aria-label="Aktivitas"><svg class="icon" aria-hidden="true"><use href="#i-bell"/></svg></a>
      <a class="nav-link is-selected" href="#profile" aria-current="location" aria-label="Profile"><svg class="icon" aria-hidden="true"><use href="#i-user-filled"/></svg></a>
    </nav>
  </article>
  <article class="phone discover" id="discover" lang="id" aria-label="Discover screen">
    <div class="discover-content">
      <h2>Discover</h2>
      <div class="reward"><svg class="level" role="img" aria-label="Level 4"><use href="#level"/></svg><p>Haloo Adik adik, yukk<br>lanjutkan misimu!</p><div class="reward-progress" role="img" aria-label="Misi selesai 60 persen"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="none" stroke="#aaa18a" stroke-width="3"/><circle cx="24" cy="24" r="19" fill="none" stroke="var(--color-honey)" stroke-width="3" stroke-linecap="round" stroke-dasharray="72 120" transform="rotate(-90 24 24)"/></svg><span>60%</span></div></div>
      <nav class="shortcuts" aria-label="Pintasan Discover">
        <a class="shortcut" href="#exercise"><span class="shortcut-well"><svg class="icon" aria-hidden="true"><use href="#i-grid"/></svg></span>Kategori</a>
        <a class="shortcut" href="#activity-detail"><span class="shortcut-well"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg></span>Cari</a>
        <a class="shortcut" href="#activity-detail"><span class="shortcut-well"><svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg></span>Acara</a>
        <a class="shortcut" href="#leaderboard"><span class="shortcut-well"><svg class="icon" aria-hidden="true"><use href="#i-podium"/></svg></span>Leaderboard</a>
      </nav>
      <div class="exercise-heading" id="exercise"><h3>Exercise</h3><a class="see-more" href="#activity-detail">See More<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></a></div>
      <div class="exercise-grid">
        <section class="exercise-card"><span class="ribbon">01</span><h4>Angkat beban</h4><p>Latihan angkat beban,<br>untuk meningkatkan otot.</p><a class="pill" href="#activity-detail">Let's Go</a><svg class="exercise-art" viewBox="0 0 146 155" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M0 121c34-22 76 21 146-6v40H0Z" fill="#ffdda3"/><use href="#fir" x="17" y="52" width="23" height="61" color="#b88346"/><use href="#fir" x="50" y="58" width="17" height="43" color="#e4b273"/><path d="M0 132c27-11 43 6 64 0" stroke="#aa7b35" stroke-width="5" fill="none"/><path d="m5 133 4-7 7 7 6-5 7 5" fill="#aa7b35"/><use href="#bunny" x="62" y="0" width="97" height="158"/></svg></section>
        <section class="exercise-card run"><h4>Maraton</h4><p>Maraton cukup 10km<br>mengelilingi lapangan.</p><a class="pill" href="#activity-detail">Let's Go</a><svg class="exercise-art" viewBox="0 0 136 155" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M0 119c62-22 71 19 136 6v30H0Z" fill="#a8bf81"/><use href="#tree" x="4" y="43" width="32" height="87" color="#85ab44"/><use href="#croc" x="-8" y="10" width="139" height="157"/></svg></section>
      </div>
    </div>
    <nav class="bottom-nav" aria-label="Navigasi contoh Discover">
      <a class="nav-link is-selected" href="#discover" aria-current="location" aria-label="Discover"><svg class="icon" aria-hidden="true"><use href="#i-home-filled"/></svg></a>
      <a class="nav-link" href="#leaderboard" aria-label="Leader Board"><svg class="icon" aria-hidden="true"><use href="#i-chart"/></svg></a>
      <a class="nav-link" href="#activity-detail" aria-label="Aktivitas"><svg class="icon" aria-hidden="true"><use href="#i-bell"/></svg></a>
      <a class="nav-link" href="#profile" aria-label="Profile"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg></a>
    </nav>
  </article>
  <article class="phone leaderboard" id="leaderboard" aria-label="Leader Board screen">
    <svg class="leader-land" viewBox="0 0 320 285" preserveAspectRatio="none" aria-hidden="true"><use href="#cloud" x="243" y="18" width="58" height="24" color="#ffdaa1"/><use href="#cloud" x="63" y="57" width="47" height="20" color="#ffdaa1"/><path d="M0 145c81-15 161 13 320-2v142H0Z" fill="#ffdda6"/><path d="M0 188c102 18 223-26 320-12v109H0Z" fill="#ffe7bf"/><use href="#fir" x="13" y="78" width="31" height="72" color="#b68049"/><use href="#fir" x="204" y="67" width="45" height="121" color="#ebbb7d"/><use href="#fir" x="280" y="95" width="32" height="87" color="#aa7445"/></svg>
    <h2 class="screen-title"><a class="back" href="#discover" aria-label="Back to Discover"><svg class="icon" aria-hidden="true"><use href="#i-back"/></svg></a>Leader Board</h2>
    <div class="podium" aria-label="Top three: frog first, fox second, tiger third">
      <div class="podium-place second"><svg class="podium-avatar" aria-hidden="true"><use href="#fox"/></svg><div class="podium-block">2</div></div>
      <div class="podium-place first"><svg class="podium-avatar" aria-hidden="true"><use href="#frog"/></svg><span class="winner-ribbon">Winner</span><div class="podium-block">1</div></div>
      <div class="podium-place third"><svg class="podium-avatar" aria-hidden="true"><use href="#tiger"/></svg><div class="podium-block">3</div></div>
    </div>
    <div class="leader-sheet"><ol class="ranking" start="4" aria-label="Weekly rankings">
      <li><span class="rank-number" aria-hidden="true">04</span><div class="rank-card"><svg class="rank-avatar" aria-hidden="true"><use href="#tiger"/></svg><div class="rank-info"><strong>Jennifer</strong><small><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>780 pts</small></div><span class="rank-change" aria-label="Up 3 places">+3<i class="triangle up" aria-hidden="true"></i></span></div></li>
      <li><span class="rank-number" aria-hidden="true">05</span><div class="rank-card"><svg class="rank-avatar green" aria-hidden="true"><use href="#frog"/></svg><div class="rank-info"><strong>William</strong><small><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>756 pts</small></div><span class="rank-change" aria-label="Down 1 place">-1<i class="triangle" aria-hidden="true"></i></span></div></li>
      <li><span class="rank-number" aria-hidden="true">06</span><div class="rank-card current"><svg class="rank-avatar stone" aria-hidden="true"><use href="#bear"/></svg><div class="rank-info"><strong>Samantha<span class="sr-only">, current user</span></strong><small><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>698 pts</small></div><span class="rank-change" aria-label="Down 2 places">-2<i class="triangle" aria-hidden="true"></i></span></div></li>
      <li><span class="rank-number" aria-hidden="true">07</span><div class="rank-card"><svg class="rank-avatar" aria-hidden="true"><use href="#tiger"/></svg><div class="rank-info"><strong>Emery</strong><small><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>636 pts</small></div><span class="rank-change" aria-label="Down 1 place">-1<i class="triangle" aria-hidden="true"></i></span></div></li>
      <li><span class="rank-number" aria-hidden="true">08</span><div class="rank-card"><svg class="rank-avatar green" aria-hidden="true"><use href="#fox"/></svg><div class="rank-info"><strong>Lydia</strong><small><svg class="coin" aria-hidden="true"><use href="#coin"/></svg>580 pts</small></div><span class="rank-change" aria-label="Down 1 place">-1<i class="triangle" aria-hidden="true"></i></span></div></li>
    </ol></div>
  </article>
</div>
<div class="stage-caption"><span><i></i>Meadow Buddies</span><span>A little movement. A little joy.</span><a href="#design-reference">Explore the design ↓</a></div>
</section>
<div class="manual" id="design-reference">
  <header class="manual-header"><div><p class="eyebrow">A woodland fitness companion</p><h1>Small steps.<br>Happy little worlds.</h1></div><p class="intro">Warm colors, gentle shapes and a friend for every milestone. A mobile design language that makes showing up feel good.</p></header>
  <section class="reference-section" id="color-roles"><p class="eyebrow">01 — Color roles</p><h2>A walk through the palette.</h2><p class="section-description">Sage sets the scene. Apricot brings the sunshine. Cocoa gives every action a clear, grounded place to land.</p><div class="swatches">
    <div class="swatch"><div class="swatch-color" style="--swatch-color:var(--color-accent)"></div><div class="swatch-label"><strong>Meadow sage</strong><small>accent · landscapes</small></div></div>
    <div class="swatch"><div class="swatch-color" style="--swatch-color:var(--color-apricot)"></div><div class="swatch-label"><strong>Soft apricot</strong><small>apricot · activities</small></div></div>
    <div class="swatch"><div class="swatch-color" style="--swatch-color:var(--color-primary)"></div><div class="swatch-label"><strong>Warm cocoa</strong><small>primary · actions</small></div></div>
    <div class="swatch"><div class="swatch-color" style="--swatch-color:var(--color-surface-raised)"></div><div class="swatch-label"><strong>Cloud white</strong><small>surface-raised · sheets</small></div></div>
    <div class="swatch"><div class="swatch-color" style="--swatch-color:var(--color-honey)"></div><div class="swatch-label"><strong>Golden honey</strong><small>honey · rewards</small></div></div>
  </div></section>
  <section class="reference-section"><p class="eyebrow">02 — Shape &amp; typography</p><h2>Soft edges. A clear little hierarchy.</h2><p class="section-description">Generous outer curves hold smaller, quieter shapes. Rounded humanist type stays friendly without turning every label into a headline.</p><div class="reference-grid">
    <div class="reference-card"><h3>Roundness with a rhythm</h3><div class="radius-samples"><span style="border-radius:16px">16</span><span style="border-radius:22px">22</span><span style="border-radius:34px">34</span></div><p>16px banners, 22px activity cards, 34px sheets and 44px screen corners. Fine dividers and soft ambient shadows keep the surface light.</p></div>
    <div class="reference-card"><h3>Friendly, never fussy</h3><div class="type-large">Discover</div><div class="type-small">A little stronger, every day.</div><p>34px screen titles · 22px section headings · 12–14px readable labels. The local font stack keeps the preview fully offline.</p></div>
  </div></section>
  <section class="reference-section" id="activity-detail"><p class="eyebrow">03 — Controls &amp; activity</p><h2>One small invitation to get going.</h2><p class="section-description">Cocoa pills identify the next action. Pale secondary controls stay quiet. A visible focus ring and a 44px touch target make the same invitation available to everyone.</p><div class="reference-grid">
    <div class="reference-card"><h3>Button states</h3><div class="controls-row"><a class="pill" href="#mobile-reference">Let's Go</a><a class="pill secondary" href="#exercise">See activities</a><button class="pill" disabled>Completed</button></div><div class="controls-row"><a class="pill focus-example" href="#discover">Focus example</a></div><p>Short labels, a steady fill and gentle hover feedback. The selected navigation item repeats the same cocoa circle. Motion is removed when reduced motion is preferred.</p></div>
    <div class="reference-card"><h3>Your next little adventure</h3><p>Strength with the rabbit. A run with the crocodile. Each activity has a clear title, one short explanation and a character below the action, never behind the text.</p><details class="activity-details"><summary>Explore the sample activities</summary><p><strong>Angkat beban</strong> — a strength-training card with an apricot field, numbered ribbon and rabbit illustration.</p><p><strong>Maraton</strong> — a running card with a sage field, a tree and a crocodile illustration.</p><p>This disclosure is an interactive component specimen. No workout, account change or network request is started.</p></details></div>
  </div></section>
  <section class="reference-section"><p class="eyebrow">04 — On-style / off-style</p><h2>Encouragement, not a shouting match.</h2><p class="section-description">The same activity, two very different feelings. The woodland language comes from the whole composition, not just adding a green background.</p><div class="comparison">
    <div class="cmp-off"><div class="comparison-label"><span>Off-style</span><span>✕ Too loud</span></div><div class="bad-workout"><strong>BEAST MODE!</strong><span>CRUSH YOUR GOALS →</span></div><p class="comparison-note">Neon color, sharp corners, heavy outlines and urgent all-caps copy turn a gentle companion into a competitive sports brand.</p></div>
    <div class="cmp-on"><div class="comparison-label"><span>On-style</span><span>✓ Just right</span></div><div class="good-workout"><strong>A little stronger.</strong><p>Your buddy is ready.</p><a class="pill" href="#activity-detail">Let's Go</a><svg aria-hidden="true"><use href="#bunny"/></svg></div><p class="comparison-note">Apricot, cocoa, a small action and a friendly illustrated companion. Soft shapes leave the content room to breathe.</p></div>
  </div></section>
  <section class="reference-section" id="mobile-reference"><p class="eyebrow">05 — Made for small screens</p><h2>The same world, closer to hand.</h2><p class="section-description">The three-phone board is a presentation. A real mobile surface gives one screen the full width and keeps every action within reach.</p><div class="mobile-reference">
    <div class="mobile-stage"><article class="compact-phone" aria-label="Narrow-screen Discover example"><div class="compact-content"><h3>Discover</h3><div class="mobile-greeting"><svg aria-hidden="true"><use href="#frog"/></svg><p><strong>Hey, little explorer.</strong>Ready for a small win?</p></div><div class="mobile-workout"><h4>A little stronger.</h4><p>One activity.<br>One happy buddy.</p><a class="pill" href="#activity-detail">Let's Go</a><svg aria-hidden="true"><use href="#bunny"/></svg></div></div><nav class="compact-nav" aria-label="Mobile example navigation"><a class="nav-link is-selected" href="#discover" aria-label="Discover"><svg class="icon" aria-hidden="true"><use href="#i-home-filled"/></svg></a><a class="nav-link" href="#leaderboard" aria-label="Leader Board"><svg class="icon" aria-hidden="true"><use href="#i-chart"/></svg></a><a class="nav-link" href="#profile" aria-label="Profile"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg></a></nav></article></div>
    <ol class="responsive-notes"><li><strong>One screen at a time</strong>Below 1120px, the presentation stacks the three screens. The reference grids become one column below 700px. No sideways page scrolling.</li><li><strong>The card stays readable</strong>A narrow product layout features one activity card, preserving the description and the illustrated lower half rather than squeezing both cards into tiny columns.</li><li><strong>Room for real fingers</strong>The mobile example uses 44px actions and navigation targets, plus body labels of at least 12px. A production bottom bar also needs device safe-area padding.</li><li><strong>Nothing is hidden behind hover</strong>Labels and selection stay visible on touch devices. Keyboard focus adds a clear outline; reduced-motion preferences remove decorative transitions.</li></ol>
  </div></section>
  <footer class="footer"><span>Meadow Buddies · Original HTML, CSS &amp; SVG study<br>Static sample data. No scripts, remote assets or account actions.</span><a href="#profile">Back to the little world ↑</a></footer>
</div>
</main>
</body>
</html>
`;

const Notion_THEME = `/* Notion — quiet warm-gray writing surface, ink first. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #2383e2;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #37352f;
	--color-surface-raised: #f7f6f3;
	--color-muted: #787774;
	--color-accent: #d9730d;
	--color-danger: #eb5757;
	--color-border: #e9e9e7;

	--radius-sm: 3px;
	--radius-md: 4px;
	--radius-lg: 6px;
	--radius-xl: 8px;
	--radius-2xl: 12px;

	--shadow-sm: 0 1px 2px rgb(15 15 15 / 0.06);
	--shadow-md: 0 2px 6px rgb(15 15 15 / 0.08), 0 0 0 1px rgb(15 15 15 / 0.03);
	--shadow-lg: 0 8px 24px rgb(15 15 15 / 0.12), 0 0 0 1px rgb(15 15 15 / 0.04);
}
`;

const Notion_SPEC = `# Notion

## Atmosphere
A quiet page that gets out of the way. Warm gray ink on white, tiny radii,
almost no chrome — the document IS the interface. Calm, bookish, utilitarian.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (white) is the page; \`surface-raised\` (warm #f7f6f3) for sidebar,
  hover states, and code/callout blocks.
- \`surface-foreground\` is warm ink (#37352f) — never pure black.
- \`primary\` (blue) only on links and the rare primary button.
- \`accent\` (orange) for highlights/callouts, used like a highlighter pen.

## Typography
System font stack only. Editorial hierarchy:
- Page titles \`font-bold\` 28–32px; section headings 18–20px \`font-semibold\`.
- Body 14–16px with relaxed leading (\`leading-relaxed\`).
- Metadata/captions 12px \`text-muted\`; \`font-mono\` for inline code.

## Shape & depth
- Tiny radii (\`rounded-md\` ≈ 4–6px). Nothing bubbly.
- Practically flat: hover fills instead of shadows; \`shadow-md\` only for
  menus/popovers with their hairline ring.

## Components
- Buttons look like text until hover (ghost, \`hover:bg-surface-raised\`);
  filled blue is rare and small (h-8).
- Sidebar: 12–13px items, 24px row height, chevrons and tiny emoji-size icons.
- Blocks: checkbox lists, toggles, quote bars (2px left border), callouts on
  \`surface-raised\` with an icon.
- Tables: hairline grid, 32px rows, gray header text.

## Layout
Single reading column (~700px) with wide margins; sidebar 240px. Vertical
rhythm from text spacing (8/12/24), not boxes. Density comes from typography.

## Don'ts
- No saturated fills or colorful cards; color only via text/highlight accents.
- No big shadows, no rounded-2xl, no glassmorphism.
- Never pure black (#000) text — always the warm ink.
`;

const Notion_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notion — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #2383e2;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #37352f;
		--color-surface-raised: #f7f6f3;
		--color-muted: #787774;
		--color-accent: #d9730d;
		--color-danger: #eb5757;
		--color-border: #e9e9e7;

		--radius-sm: 3px;
		--radius-md: 4px;
		--radius-lg: 6px;
		--radius-xl: 8px;
		--radius-2xl: 12px;

		--shadow-sm: 0 1px 2px rgb(15 15 15 / 0.06);
		--shadow-md: 0 2px 6px rgb(15 15 15 / 0.08), 0 0 0 1px rgb(15 15 15 / 0.03);
		--shadow-lg: 0 8px 24px rgb(15 15 15 / 0.12), 0 0 0 1px rgb(15 15 15 / 0.04);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
		--mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.65;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; line-height: 1.3; }
	p { margin: 0; }
	::selection { background: rgb(35 131 226 / 0.2); }
	code { font-family: var(--mono); font-size: 0.88em; background: var(--color-surface-raised); color: #eb5757; padding: 1px 5px; border-radius: var(--radius-sm); }

	/* ── Workspace: 240px sidebar, then a 700px reading column ─────── */
	.app { display: grid; grid-template-columns: 1fr; min-height: 100vh; }
	@media (min-width: 900px) { .app { grid-template-columns: 240px 1fr; } }

	.side { display: none; background: var(--color-surface-raised); padding: 12px 8px; border-right: 1px solid var(--color-border); }
	@media (min-width: 900px) { .side { display: block; } }
	.side-user { display: flex; align-items: center; gap: 8px; padding: 6px 8px 14px; font-size: 14px; font-weight: 600; }
	.side-user .ws { width: 20px; height: 20px; border-radius: var(--radius-md); background: var(--color-surface-foreground); color: #fff; font-size: 11px; display: grid; place-items: center; font-weight: 500; }
	/* 24px rows, 12–13px text, chevrons — the sidebar is a list, not a nav bar. */
	.s-item { display: flex; align-items: center; gap: 6px; height: 27px; padding: 0 8px; border-radius: var(--radius-md); font-size: 14px; color: var(--color-muted); }
	.s-item .ico { width: 16px; text-align: center; font-size: 13px; opacity: 0.7; }
	.s-item.is-active { background: rgb(0 0 0 / 0.05); color: var(--color-surface-foreground); font-weight: 500; }
	.s-item.child { padding-left: 24px; }
	.s-group { font-size: 12px; color: var(--color-muted); padding: 16px 8px 4px; }

	.doc { min-width: 0; }
	.doc-bar { display: flex; align-items: center; gap: 10px; height: 45px; padding: 0 16px; font-size: 14px; color: var(--color-muted); border-bottom: 1px solid transparent; }
	@media (min-width: 768px) { .doc-bar { padding: 0 40px; } }
	.spacer { flex: 1; }
	.page { max-width: 708px; margin: 0 auto; padding: 8px 16px 64px; }
	@media (min-width: 768px) { .page { padding: 24px 24px 96px; } }

	.page-icon { font-size: 44px; line-height: 1; margin-bottom: 8px; }
	.page h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.01em; }
	@media (min-width: 768px) { .page h1 { font-size: 40px; } }
	.page-props { margin-top: 14px; font-size: 14px; }
	.prop { display: flex; gap: 8px; align-items: center; padding: 3px 0; color: var(--color-muted); }
	.prop .name { width: 120px; flex: none; display: flex; gap: 6px; align-items: center; }
	.prop .val { color: var(--color-surface-foreground); }

	/* ── Blocks: the whole vocabulary ─────────────────────────────── */
	.block { padding: 3px 2px; margin-top: 2px; }
	.h2 { font-size: 22px; font-weight: 600; margin-top: 28px; padding-bottom: 2px; }
	.h3 { font-size: 18px; font-weight: 600; margin-top: 20px; }
	.text { font-size: 16px; }
	.muted { color: var(--color-muted); }
	.hl { background: #fdecc8; border-radius: 2px; padding: 0 2px; }
	.hl-orange { color: var(--color-accent); font-weight: 500; }
	.link { color: var(--color-primary); border-bottom: 1px solid rgb(35 131 226 / 0.3); text-decoration: none; }

	.todo { display: flex; gap: 10px; align-items: flex-start; padding: 3px 2px; }
	.box { width: 16px; height: 16px; border: 1.5px solid #b1b0ad; border-radius: var(--radius-sm); flex: none; margin-top: 4px; }
	.box.on { background: var(--color-primary); border-color: var(--color-primary); position: relative; }
	.box.on::after { content: ""; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(42deg); }
	.todo.done span { color: var(--color-muted); text-decoration: line-through; }

	.toggle { display: flex; gap: 8px; align-items: flex-start; padding: 3px 2px; }
	.chev { flex: none; margin-top: 6px; width: 0; height: 0; border-left: 5px solid var(--color-muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent; }
	.chev.open { transform: rotate(90deg); }

	.quote { border-left: 3px solid var(--color-surface-foreground); padding: 2px 0 2px 14px; margin: 8px 0; font-size: 16px; }
	.callout {
		display: flex; gap: 10px; align-items: flex-start;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 16px; margin: 12px 0; font-size: 15px;
	}
	.callout .emoji { font-size: 18px; line-height: 1.3; }
	.callout.warn { background: #fdf3e6; border-color: #f3e0c4; }
	.codeblock {
		background: var(--color-surface-raised); border-radius: var(--radius-md);
		padding: 16px 18px; font-family: var(--mono); font-size: 13.5px; line-height: 1.6;
		color: var(--color-surface-foreground); overflow-x: auto; margin: 12px 0;
	}
	.codeblock .c { color: var(--color-muted); }
	.divider { border: 0; border-top: 1px solid var(--color-border); margin: 24px 0; }

	/* Database table: hairline grid, 33px rows, gray headers. */
	.db { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
	.db th { text-align: left; font-weight: 400; font-size: 12px; color: var(--color-muted); padding: 6px 8px; border-bottom: 1px solid var(--color-border); }
	.db td { padding: 7px 8px; border-bottom: 1px solid var(--color-border); height: 33px; }
	.db td:first-child, .db th:first-child { padding-left: 0; }
	.tag { display: inline-block; border-radius: var(--radius-sm); padding: 1px 7px; font-size: 12px; background: var(--color-surface-raised); color: var(--color-muted); }
	.tag.blue { background: #e7f3f8; color: #183347; }
	.tag.orange { background: #fbecdd; color: #5c3b23; }
	.tag.green { background: #edf3ec; color: #1c3829; }
	.tag.red { background: #fdebec; color: #5d1715; }
	@media (max-width: 620px) { .db .hide-sm { display: none; } }

	/* ── Buttons: text until hover ─────────────────────────────────── */
	.btn {
		font: inherit; font-size: 14px; font-weight: 500;
		height: 32px; padding: 0 10px;
		border: 0; border-radius: var(--radius-md);
		background: transparent; color: var(--color-muted);
		cursor: pointer; transition: background-color 20ms ease-in;
	}
	.btn:hover { background: rgb(55 53 47 / 0.08); color: var(--color-surface-foreground); }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(35 131 226 / 0.5); }
	.btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
	.btn-primary:hover { background: #0b6fca; color: #fff; }
	.btn-outline { border: 1px solid var(--color-border); color: var(--color-surface-foreground); }
	.btn-outline:hover { background: var(--color-surface-raised); }
	.btn[disabled] { cursor: not-allowed; color: #c5c4c1; background: transparent; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

	.input {
		font: inherit; font-size: 14px; width: 100%; max-width: 340px; height: 32px; padding: 0 10px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
	}
	.input:focus { outline: none; background: var(--color-surface); border-color: var(--color-primary); box-shadow: 0 0 0 2px rgb(35 131 226 / 0.2); }

	/* Popover: the one place a shadow appears, always with its hairline ring. */
	.menu {
		max-width: 300px; background: var(--color-surface);
		border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
		padding: 6px; margin-top: 12px;
	}
	.menu .g { font-size: 11px; color: var(--color-muted); padding: 6px 10px 4px; }
	.menu .i { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: var(--radius-md); font-size: 14px; }
	.menu .i:first-of-type { background: rgb(55 53 47 / 0.06); }
	.menu .i small { display: block; font-size: 12px; color: var(--color-muted); }
	.menu .i .g2 { width: 26px; height: 26px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); flex: none; display: grid; place-items: center; font-size: 13px; }

	/* ── Reference sections below the document ────────────────────── */
	.ref { max-width: 708px; margin: 0 auto; padding: 0 16px 96px; }
	@media (min-width: 768px) { .ref { padding: 0 24px 128px; } }
	.section { padding-top: 48px; }
	.section-label { font-size: 12px; color: var(--color-accent); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 6px; }
	.section h2 { font-size: 22px; font-weight: 600; }
	.lede { color: var(--color-muted); margin-top: 8px; font-size: 15px; }
	.note { margin-top: 14px; font-size: 13px; color: var(--color-muted); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 18px; }
	@media (min-width: 620px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 48px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 13px; font-weight: 500; margin-top: 6px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 22px; align-items: start; }
	@media (min-width: 820px) { .mobile { grid-template-columns: 272px 1fr; gap: 36px; } }
	.phone {
		width: 272px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 22px;
		background: var(--color-surface); box-shadow: var(--shadow-lg); overflow: hidden;
	}
	.phone-status { display: flex; justify-content: space-between; padding: 9px 16px 4px; font-size: 10px; color: var(--color-muted); }
	.phone-bar { display: flex; align-items: center; gap: 8px; padding: 6px 14px 10px; font-size: 12px; color: var(--color-muted); }
	.phone-page { padding: 4px 16px 14px; }
	.phone-page .pi { font-size: 26px; }
	.phone-page h4 { margin: 4px 0 10px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; }
	.phone-page .text { font-size: 14px; }
	.phone-page .todo { font-size: 14px; }
	.phone-page .callout { padding: 10px; font-size: 12.5px; margin: 10px 0; }
	/* The block toolbar replaces the slash menu on touch: same items, docked. */
	.blocktool { display: flex; gap: 4px; border-top: 1px solid var(--color-border); background: var(--color-surface-raised); padding: 8px 10px 14px; }
	.blocktool span { flex: 1; height: 30px; border-radius: var(--radius-md); background: var(--color-surface); border: 1px solid var(--color-border); display: grid; place-items: center; font-size: 13px; color: var(--color-muted); }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 11px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-weight: 600; font-size: 13px; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 18px; }
	@media (min-width: 620px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 22px; border-radius: 18px; color: #fff;
		background: linear-gradient(135deg, #6366f1, #a855f7);
		box-shadow: 0 14px 34px rgb(99 102 241 / 0.4);
		font-size: 15px; font-weight: 600;
	}
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; opacity: 0.9; margin-top: 8px; }
	.cmp-on { padding: 22px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-raised); font-size: 15px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; }
</style>
</head>
<body>

<!-- COVER — a page in a workspace. The document is the interface; there is no
     product chrome to speak of, and nothing on screen is a colored card. -->
<div class="app">
	<aside class="side">
		<div class="side-user"><span class="ws">V</span>Vetta Design<span class="spacer"></span><span style="color:var(--color-muted);font-weight:400">⌄</span></div>
		<div class="s-item"><span class="ico">⌕</span>Search</div>
		<div class="s-item"><span class="ico">⏱</span>Updates</div>
		<div class="s-item"><span class="ico">⚙</span>Settings</div>
		<div class="s-group">Workspace</div>
		<div class="s-item"><span class="ico">📘</span>Handbook</div>
		<div class="s-item is-active"><span class="ico">🎛</span>Design tokens</div>
		<div class="s-item child"><span class="ico">·</span>Color roles</div>
		<div class="s-item child"><span class="ico">·</span>Type scale</div>
		<div class="s-item"><span class="ico">🗂</span>Component audit</div>
		<div class="s-item"><span class="ico">📅</span>Release calendar</div>
		<div class="s-group">Private</div>
		<div class="s-item"><span class="ico">📝</span>Scratchpad</div>
		<div class="s-item"><span class="ico">＋</span>New page</div>
	</aside>

	<main class="doc">
		<div class="doc-bar">
			<span>Workspace</span><span>/</span><span style="color:var(--color-surface-foreground)">Design tokens</span>
			<span class="spacer"></span>
			<button class="btn">Share</button><button class="btn">···</button>
		</div>

		<article class="page">
			<div class="page-icon">🎛</div>
			<h1>Design tokens</h1>

			<div class="page-props">
				<div class="prop"><span class="name">📌 Status</span><span class="val"><span class="tag green">In review</span></span></div>
				<div class="prop"><span class="name">👤 Owner</span><span class="val">Kaori M.</span></div>
				<div class="prop"><span class="name">🏷 Tags</span><span class="val"><span class="tag blue">system</span> <span class="tag orange">v1.4</span></span></div>
				<div class="prop"><span class="name">🗓 Updated</span><span class="val">April 12</span></div>
			</div>

			<hr class="divider">

			<div class="block text">Everything visual in this workspace resolves to a token. If a value is worth
				repeating twice, it belongs here first and in a component second. <span class="hl">Highlight is the
				only fill a sentence ever gets</span> — the page never turns into a colored card.</div>

			<div class="h2">Working agreements</div>
			<div class="todo done"><span class="box on"></span><span>Freeze the seven base color roles</span></div>
			<div class="todo"><span class="box"></span><span>Audit radius usage across the component library</span></div>
			<div class="todo"><span class="box"></span><span>Write the <code>surface-raised</code> hover rule into the linter</span></div>

			<div class="toggle"><span class="chev open"></span><span><b>Why hover fills instead of shadows</b></span></div>
			<div class="block text muted" style="padding-left: 21px;">A shadow implies the element left the page. Nothing here
				leaves the page except a menu, so state is expressed by a 6% ink wash instead.</div>

			<blockquote class="quote">A page that needs decoration to feel finished is a page that hasn't found its
				hierarchy yet.</blockquote>

			<div class="callout"><span class="emoji">💡</span><span>Callouts sit on <code>surface-raised</code> with a hairline
				border and an icon. They are the loudest object allowed inside prose — and they still have no shadow.</span></div>

			<div class="callout warn"><span class="emoji">⚠️</span><span>Ink is <span class="hl-orange">#37352f</span>, never
				pure black. Pure black on white is the fastest way to make this system look like something else.</span></div>

			<div class="h3">Token snapshot</div>
			<div class="codeblock"><span class="c">/* the seven that never change name */</span>
--color-primary: #2383e2;
--color-surface: #ffffff;
--color-surface-foreground: #37352f;  <span class="c">/* warm ink */</span>
--color-muted: #787774;
--color-accent: #d9730d;              <span class="c">/* highlighter */</span></div>

			<div class="h2">Component audit</div>
			<table class="db">
				<thead><tr><th>Name</th><th>Status</th><th class="hide-sm">Owner</th><th class="hide-sm">Updated</th></tr></thead>
				<tbody>
					<tr><td>Sidebar item</td><td><span class="tag green">Shipped</span></td><td class="hide-sm">Kaori M.</td><td class="hide-sm muted">Apr 12</td></tr>
					<tr><td>Callout</td><td><span class="tag blue">In review</span></td><td class="hide-sm">Ana R.</td><td class="hide-sm muted">Apr 09</td></tr>
					<tr><td>Database table</td><td><span class="tag orange">Drafting</span></td><td class="hide-sm">Jun S.</td><td class="hide-sm muted">Apr 07</td></tr>
					<tr><td>Slash menu</td><td><span class="tag red">Blocked</span></td><td class="hide-sm">Mo O.</td><td class="hide-sm muted">Apr 02</td></tr>
				</tbody>
			</table>
		</article>
	</main>
</div>

<div class="ref">
	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Chrome</p>
		<h2>Buttons look like text until you hover</h2>
		<p class="lede">Every control starts as plain ink and gains a 6% wash on hover. A filled blue
			button is rare enough that one per page is usually one too many.</p>
		<div class="row" style="margin-top: 16px;">
			<button class="btn">Share</button>
			<button class="btn">Comment</button>
			<button class="btn btn-outline">Duplicate</button>
			<button class="btn btn-primary">New page</button>
			<button class="btn" disabled>Syncing…</button>
		</div>
		<div class="row" style="margin-top: 14px;"><input class="input" placeholder="Search pages…"></div>
		<div class="menu">
			<div class="g">Basic blocks</div>
			<div class="i"><span class="g2">T</span><span>Text<small>Just start writing</small></span></div>
			<div class="i"><span class="g2">H</span><span>Heading 2<small>Medium section heading</small></span></div>
			<div class="i"><span class="g2">☑</span><span>To-do list<small>Track tasks with a checkbox</small></span></div>
			<div class="i"><span class="g2">💡</span><span>Callout<small>Make writing stand out</small></span></div>
		</div>
		<p class="note">The slash menu is the only floating surface, and it carries <code>shadow-lg</code> plus a hairline ring so it still reads as paper.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Color</p>
		<h2>Color arrives as text and highlight, never as a fill</h2>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>surface-raised</b><span>#f7f6f3 · sidebar, hover, code</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>ink</b><span>#37352f · warm, never #000</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#2383e2 · links, rare button</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#d9730d · highlighter</span></div>
		</div>
		<p class="note">Tags are the one saturated object, and even those are pastel washes with dark matching text. Radii stop at 4–6px; nothing in this system is bubbly.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>The reading column was already the mobile layout</h2>
		<p class="lede">Because the page is a single 700px column of text blocks, the phone build barely
			changes: the sidebar becomes a drawer, the slash menu becomes a docked block toolbar, and the
			line length finally matches what the column was designed for.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-bar"><span>☰</span><span>Design tokens</span><span class="spacer"></span><span>···</span></div>
				<div class="phone-page">
					<div class="pi">🎛</div>
					<h4>Design tokens</h4>
					<div class="prop" style="font-size:12px"><span class="name" style="width:78px">📌 Status</span><span class="tag green">In review</span></div>
					<hr class="divider" style="margin:12px 0">
					<div class="text">Everything visual resolves to a token. <span class="hl">Highlight is the only fill a sentence gets.</span></div>
					<div class="todo done" style="margin-top:8px"><span class="box on"></span><span>Freeze the color roles</span></div>
					<div class="todo"><span class="box"></span><span>Audit radius usage</span></div>
					<div class="callout"><span class="emoji">💡</span><span>Ink is warm, never pure black.</span></div>
				</div>
				<div class="blocktool"><span>T</span><span>H</span><span>☑</span><span>💡</span><span>＋</span></div>
			</div>
			<ul class="rules">
				<li><b>&lt; 900px — sidebar</b>The 240px page tree slides out as a full-height drawer over a light scrim. It keeps its 27px rows and 14px labels; it does not turn into an icon rail.</li>
				<li><b>Reading column</b>708px max-width becomes the viewport with 16px gutters. Page padding drops from 24px to 16px; the text itself keeps 16px/1.65 leading at every width.</li>
				<li><b>Page title</b>40px → 32px → 21px inside the phone frame. Body text never scales down — long-form reading is the point of the system.</li>
				<li><b>Slash menu → toolbar</b>Typing <code>/</code> has no touch equivalent, so the same block list docks above the keyboard as a row of tappable glyphs in the same order.</li>
				<li><b>Hover states</b>The 6% ink wash maps to <code>:active</code>. Block handles and drag grips only appear after a long press, so prose stays clean.</li>
				<li><b>Databases</b>Below 620px the table sheds owner and date columns; the title and its status tag stay. Rows keep the 33px height and hairline grid — no card view.</li>
				<li><b>Targets</b>32px controls grow to 40px, but the visual weight stays ghost — a bigger tap area, not a heavier button.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the quiet</h2>
		<div class="compare">
			<div class="cmp-off">Saturated gradient card
				<small>18px radius · indigo→purple fill · colored shadow · white text. Colorful cards are the fastest way out of this system.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>4px radius, warm #f7f6f3 fill, hairline border, warm ink text, no shadow. Hierarchy comes from type size and spacing, not from boxes.</small></div>
		</div>
		<p class="note">Also out: pure black text, <code>rounded-2xl</code> anything, glassmorphism, and big drop shadows on elements that never left the page.</p>
	</section>
</div>

</body>
</html>
`;

const Vercel_THEME = `/* Vercel — stark black-on-white monochrome, one blue. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #000000;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #000000;
	--color-surface-raised: #fafafa;
	--color-muted: #666666;
	--color-accent: #0070f3;
	--color-danger: #ee0000;
	--color-border: #eaeaea;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
	--shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
	--shadow-lg: 0 12px 32px rgb(0 0 0 / 0.12);
}
`;

const Vercel_SPEC = `# Vercel

## Atmosphere
Stark, editorial, monochrome. Black text on white space with engineering
confidence; color is an event, not a decoration. Feels like a spec sheet that
became beautiful.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- The world is \`surface\` (white), \`surface-foreground\` (black), \`muted\` (gray).
- \`primary\` is BLACK: primary buttons are solid black with white text.
- \`accent\` (blue) only for links, focus, and live/deploy states.
- \`surface-raised\` for subtle card fills; \`border\` hairlines do the structure.

## Typography
System font stack only. Swiss precision:
- Headings: \`font-bold tracking-tight\`, strong size jumps (32/24/16).
- Body 14px; captions 12–13px \`text-muted\`.
- \`font-mono\` is a first-class citizen: URLs, CLI commands, env vars, badges.

## Shape & depth
- Small radii (\`rounded-md\` ≈ 6px); pills only for status badges.
- Mostly flat: 1px \`border\` everywhere, \`shadow-md\` only on menus/modals.
- Empty space is the main decoration — let it breathe.

## Components
- Buttons: h-9, solid black primary, bordered white secondary; on hover they
  invert (black↔white) — the signature interaction.
- Inputs: white with 1px border, black focus border, no glow.
- Cards: bordered white rectangles with a mono label + big metric.
- Tables: generous row height, gray-500 headers in 12px uppercase.

## Layout
Grid-strict, centered content column (max ~1024px), sweeping whitespace between
sections. Spacing 8/16/24/48. One idea per section.

## Don'ts
- Never more than one hue on screen (blue) — no greens/purples/gradients.
- No gray text on gray fills; contrast is the brand.
- No heavy shadows or big radii; nothing "bubbly".
`;

const Vercel_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vercel — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #000000;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #000000;
		--color-surface-raised: #fafafa;
		--color-muted: #666666;
		--color-accent: #0070f3;
		--color-danger: #ee0000;
		--color-border: #eaeaea;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
		--shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
		--shadow-lg: 0 12px 32px rgb(0 0 0 / 0.12);

		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: -0.04em; line-height: 1.1; }
	p { margin: 0; }
	::selection { background: #000; color: #fff; }
	code { font-family: var(--mono); font-size: 0.92em; }

	.wrap { max-width: 1024px; margin: 0 auto; padding: 0 24px; }
	@media (min-width: 768px) { .wrap { padding: 0 40px; } }

	/* ── Sweeping whitespace is the decoration. One idea per section. ── */
	.section { padding: 64px 0; border-top: 1px solid var(--color-border); }
	@media (min-width: 768px) { .section { padding: 96px 0; } }
	.section-label {
		font-family: var(--mono); font-size: 12px;
		text-transform: uppercase; letter-spacing: 0.1em;
		color: var(--color-muted); margin-bottom: 20px;
	}
	.section h2 { font-size: 28px; }
	@media (min-width: 768px) { .section h2 { font-size: 32px; } }
	.lede { color: var(--color-muted); max-width: 60ch; margin-top: 16px; }
	.note { margin-top: 24px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Cover: a triangle, a wordmark, and an enormous amount of air ── */
	.topbar {
		display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
		height: 64px; border-bottom: 1px solid var(--color-border);
	}
	.mark {
		width: 0; height: 0;
		border-left: 11px solid transparent; border-right: 11px solid transparent;
		border-bottom: 19px solid var(--color-primary);
	}
	.slash { color: var(--color-border); }
	.crumb { font-size: 14px; }
	.crumb .muted { color: var(--color-muted); }
	.spacer { flex: 1; }
	.avatar { width: 26px; height: 26px; border-radius: 50%; background: var(--color-primary); }

	.hero { padding: 88px 0 72px; }
	@media (min-width: 768px) { .hero { padding: 128px 0 104px; } }
	.hero h1 { font-size: 44px; max-width: 14ch; }
	@media (min-width: 768px) { .hero h1 { font-size: 76px; } }
	.hero p { margin-top: 24px; max-width: 46ch; font-size: 17px; color: var(--color-muted); }
	.hero .actions { margin-top: 40px; }
	.cli {
		margin-top: 48px; max-width: 520px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		font-family: var(--mono); font-size: 13px; padding: 14px 16px;
		display: flex; gap: 10px; align-items: center;
	}
	.cli .prompt { color: #888; }
	.cli .cursor { width: 7px; height: 15px; background: #fff; display: inline-block; vertical-align: -2px; }

	/* ── Buttons: the signature is the black↔white invert on hover ──── */
	.btn {
		font: inherit; font-size: 14px; font-weight: 500;
		height: 40px; padding: 0 16px;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-primary);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
	}
	.btn:hover { background: var(--color-surface); color: var(--color-surface-foreground); }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-accent); }
	.btn-secondary { background: var(--color-surface); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
	.btn-danger { background: var(--color-danger); border-color: var(--color-danger); color: #fff; }
	.btn-danger:hover { background: var(--color-surface); color: var(--color-danger); }
	.btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
	.btn[disabled] { cursor: not-allowed; background: var(--color-surface-raised); color: #999; border-color: var(--color-border); }

	.input {
		font: inherit; font-size: 14px; width: 100%; max-width: 360px;
		height: 40px; padding: 0 12px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #999; }
	.input:focus { outline: none; border-color: var(--color-primary); }

	/* ── Cards: bordered rectangle, mono label, one big metric ─────── */
	.grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 32px; }
	@media (min-width: 720px) { .grid { grid-template-columns: repeat(3, 1fr); } }
	.card {
		border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		padding: 20px 24px; background: var(--color-surface);
	}
	.card .k { font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); }
	.card .v { font-size: 36px; font-weight: 700; letter-spacing: -0.04em; margin-top: 8px; font-variant-numeric: tabular-nums; }
	.card .d { font-size: 13px; color: var(--color-muted); margin-top: 4px; }

	/* ── Deployments table: generous rows, uppercase mono headers ──── */
	.table { width: 100%; border-collapse: collapse; margin-top: 32px; }
	.table th {
		text-align: left; font-family: var(--mono); font-size: 12px; font-weight: 400;
		text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted);
		padding: 0 12px 12px; border-bottom: 1px solid var(--color-border);
	}
	.table td { padding: 18px 12px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
	.table td:first-child, .table th:first-child { padding-left: 0; }
	.table td:last-child, .table th:last-child { padding-right: 0; text-align: right; }
	.url { font-family: var(--mono); font-size: 13px; }
	.branch { font-family: var(--mono); font-size: 12px; color: var(--color-muted); }
	.ago { font-size: 13px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
	@media (max-width: 640px) { .hide-sm { display: none; } }

	.state { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
	.state .d { width: 8px; height: 8px; border-radius: 50%; background: var(--color-muted); }
	.state.ready .d { background: var(--color-primary); }
	.state.building .d { background: var(--color-accent); }
	.state.error .d { background: var(--color-danger); }
	.state.error { color: var(--color-danger); }

	.pill {
		display: inline-block; border-radius: 9999px; padding: 2px 10px;
		font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
		border: 1px solid var(--color-border); color: var(--color-muted);
	}
	.pill.prod { border-color: var(--color-primary); color: var(--color-primary); }

	/* ── Palette ───────────────────────────────────────────────────── */
	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 32px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(5, 1fr); } }
	.sw .fill { height: 72px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
	.sw b { display: block; font-family: var(--mono); font-size: 12px; font-weight: 400; margin-top: 10px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ────────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 40px; margin-top: 40px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 288px 1fr; gap: 56px; } }
	.phone {
		width: 288px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-primary); border-radius: 20px;
		overflow: hidden; background: var(--color-surface);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 10px 16px 6px; font-family: var(--mono); font-size: 10px; color: var(--color-muted); }
	.phone-head { display: flex; align-items: center; gap: 10px; padding: 8px 16px 14px; border-bottom: 1px solid var(--color-border); }
	.phone-head b { font-size: 14px; letter-spacing: -0.02em; }
	/* On mobile the table becomes a stack of bordered rows — never a
	   horizontally scrolling table, and never a rounded "card feed". */
	.m-row { padding: 14px 16px; border-bottom: 1px solid var(--color-border); }
	.m-row .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.m-row .url { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.m-row .meta { font-family: var(--mono); font-size: 11px; color: var(--color-muted); margin-top: 6px; }
	.m-cta { padding: 16px; border-top: 1px solid var(--color-border); }
	.m-cta .btn { width: 100%; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { display: flex; gap: 20px; padding: 14px 0; border-bottom: 1px solid var(--color-border); color: var(--color-muted); font-size: 14px; }
	.rules b { flex: none; width: 108px; color: var(--color-surface-foreground); font-family: var(--mono); font-size: 12px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 2px; }
	@media (max-width: 520px) { .rules li { display: block; } .rules b { width: auto; margin-bottom: 4px; } }

	/* ── Off-style ─────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 32px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 28px; border-radius: 24px; color: #fff;
		background: linear-gradient(135deg, #7c3aed, #ec4899 50%, #f59e0b);
		box-shadow: 0 20px 44px rgb(124 58 237 / 0.35);
		font-size: 18px; font-weight: 700;
	}
	.cmp-off small { display: block; font-size: 13px; font-weight: 400; opacity: 0.9; margin-top: 10px; }
	.cmp-on { padding: 28px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
	.cmp-on small { display: block; font-size: 13px; font-weight: 400; color: var(--color-muted); margin-top: 10px; }

	footer { border-top: 1px solid var(--color-border); padding: 40px 0 64px; font-family: var(--mono); font-size: 12px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — wordmark, one black button, and air. Color is an event here. -->
<div class="wrap">
	<div class="topbar">
		<span class="mark"></span>
		<span class="crumb"><b>vetta</b> <span class="slash">/</span> <span class="muted">design-templates</span></span>
		<span class="pill prod">Production</span>
		<span class="spacer"></span>
		<button class="btn btn-secondary btn-sm">Feedback</button>
		<span class="avatar"></span>
	</div>

	<div class="hero">
		<h1>Black on white, one blue.</h1>
		<p>Structure comes from hairlines and space. Type does the hierarchy, monospace
			carries every machine-readable value, and the only hue on screen is a link.</p>
		<div class="row actions">
			<button class="btn">Deploy</button>
			<button class="btn btn-secondary">Read the docs</button>
		</div>
		<div class="cli"><span class="prompt">▲ ~</span> vercel --prod <span class="cursor"></span></div>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Metrics</p>
		<h2>A card is a rectangle with one number in it</h2>
		<p class="lede">Mono label on top, an oversized tabular figure below, a gray delta underneath.
			No icon, no gradient, no shadow. If a card needs decoration, the number wasn't interesting enough.</p>
		<div class="grid">
			<div class="card"><div class="k">Edge requests</div><div class="v">48,210</div><div class="d">+12.4% vs last week</div></div>
			<div class="card"><div class="k">P95 latency</div><div class="v">86ms</div><div class="d">Global, all regions</div></div>
			<div class="card"><div class="k">Build time</div><div class="v">31s</div><div class="d">Median of last 20</div></div>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Deployments</p>
		<h2>Tables carry the product</h2>
		<table class="table">
			<thead>
				<tr><th>Deployment</th><th class="hide-sm">Status</th><th class="hide-sm">Branch</th><th>Age</th></tr>
			</thead>
			<tbody>
				<tr>
					<td><span class="url">vetta-a91f2c.vercel.app</span> <span class="pill prod">Prod</span></td>
					<td class="hide-sm"><span class="state ready"><span class="d"></span>Ready</span></td>
					<td class="hide-sm"><span class="branch">main</span></td>
					<td class="ago">2m</td>
				</tr>
				<tr>
					<td><span class="url">vetta-c74b81.vercel.app</span></td>
					<td class="hide-sm"><span class="state building"><span class="d"></span>Building</span></td>
					<td class="hide-sm"><span class="branch">feat/tokens</span></td>
					<td class="ago">4m</td>
				</tr>
				<tr>
					<td><span class="url">vetta-1de095.vercel.app</span></td>
					<td class="hide-sm"><span class="state error"><span class="d"></span>Error</span></td>
					<td class="hide-sm"><span class="branch">fix/table-head</span></td>
					<td class="ago">1h</td>
				</tr>
				<tr>
					<td><span class="url">vetta-5f30aa.vercel.app</span></td>
					<td class="hide-sm"><span class="state ready"><span class="d"></span>Ready</span></td>
					<td class="hide-sm"><span class="branch">docs/readme</span></td>
					<td class="ago">6h</td>
				</tr>
			</tbody>
		</table>
		<p class="note">Row height is generous — 18px of padding — because the whitespace is the only ornament a table gets. Headers are 12px uppercase mono in gray; values that a machine produced stay in mono forever.</p>
	</section>

	<!-- 03 -->
	<section class="section">
		<p class="section-label">03 — Controls</p>
		<h2>Hover inverts. That's the interaction.</h2>
		<div class="row" style="margin-top: 32px;">
			<button class="btn">Primary</button>
			<button class="btn btn-secondary">Secondary</button>
			<button class="btn btn-danger">Delete</button>
			<button class="btn" disabled>Deploying…</button>
		</div>
		<div class="row" style="margin-top: 24px;">
			<input class="input" placeholder="project-name">
			<button class="btn">Create</button>
		</div>
		<p class="note">Solid black fills, bordered white secondaries, and on hover they swap. Focus is a 2px blue ring — the accent's only structural job besides links. No glow, no lift, no scale.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#000 · buttons</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#0070f3 · links only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#fafafa</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-border)"></div><b>border</b><span>#eaeaea</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#ee0000</span></div>
		</div>
	</section>

	<!-- 04 MOBILE -->
	<section class="section">
		<p class="section-label">04 — Mobile</p>
		<h2>The table stacks, the air stays</h2>
		<p class="lede">Small screens lose columns, not whitespace. The deployment table becomes
			full-bleed bordered rows with the machine values still in mono, and the primary action
			goes full width at the bottom of the viewport.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>5G ▮</span></div>
				<div class="phone-head"><span class="mark"></span><b>design-templates</b><span class="spacer"></span><span class="pill prod">Prod</span></div>
				<div class="m-row">
					<div class="top"><span class="url">vetta-a91f2c…</span><span class="state ready"><span class="d"></span>Ready</span></div>
					<div class="meta">main · 2m ago · 31s build</div>
				</div>
				<div class="m-row">
					<div class="top"><span class="url">vetta-c74b81…</span><span class="state building"><span class="d"></span>Building</span></div>
					<div class="meta">feat/tokens · 4m ago</div>
				</div>
				<div class="m-row">
					<div class="top"><span class="url">vetta-1de095…</span><span class="state error"><span class="d"></span>Error</span></div>
					<div class="meta">fix/table-head · 1h ago</div>
				</div>
				<div class="m-cta"><button class="btn">Deploy</button></div>
			</div>
			<ul class="rules">
				<li><b>Column</b><span>The 1024px reading column becomes the full viewport with 24px gutters instead of 40px. Content never sits in an inset card.</span></li>
				<li><b>Tables</b><span>Below 640px the status and branch columns leave the table and reappear as one mono metadata line under the deployment URL. A table is never left to scroll sideways.</span></li>
				<li><b>Type</b><span>Hero drops 76px → 44px, section headings 32px → 28px. Body stays 14px and mono stays 12–13px at every width.</span></li>
				<li><b>Targets</b><span>Buttons grow 40px → 44px tall and the primary one spans the full width. The invert-on-hover signature has no touch equivalent, so pressed state inverts instead.</span></li>
				<li><b>Rhythm</b><span>Section padding halves from 96px to 64px — that is the only vertical compression allowed. Whitespace is the brand at every size.</span></li>
				<li><b>Chrome</b><span>Breadcrumb truncates from the left, keeping the project name. The avatar and secondary actions collapse into the header's right edge.</span></li>
			</ul>
		</div>
	</section>

	<!-- 05 DON'T -->
	<section class="section">
		<p class="section-label">05 — Off-style, for contrast</p>
		<h2>What breaks the spec sheet</h2>
		<div class="compare">
			<div class="cmp-off">Three-hue gradient panel
				<small>24px radius · purple→pink→amber · colored drop shadow · white text on a moving background. Every one of these is forbidden.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>8px radius, white fill, 1px #eaeaea border, black text, no shadow. Contrast is the brand — gray text on a gray fill is the one thing that always reads as wrong here.</small></div>
		</div>
		<p class="note">Also out: more than one hue on screen, bubbly radii, heavy shadows, and decorative icons next to headings.</p>
	</section>

</div>

<footer><div class="wrap">Vetta design reference — vercel · black, white, one blue.</div></footer>
</body>
</html>
`;

const Headspace_THEME = `/* Headspace — warm sunrise calm, rounded everything, friendly ink. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #f47d31;
	--color-primary-foreground: #ffffff;
	--color-surface: #fefaf3;
	--color-surface-foreground: #2d2c41;
	--color-surface-raised: #ffffff;
	--color-muted: #7a7889;
	--color-accent: #5a77d6;
	--color-danger: #e5484d;
	--color-border: #efe4d5;

	--radius-sm: 10px;
	--radius-md: 14px;
	--radius-lg: 18px;
	--radius-xl: 24px;
	--radius-2xl: 32px;

	--shadow-sm: 0 2px 6px rgb(45 44 65 / 0.06);
	--shadow-md: 0 8px 20px rgb(45 44 65 / 0.08);
	--shadow-lg: 0 20px 48px rgb(45 44 65 / 0.12);
}
`;

const Headspace_SPEC = `# Headspace

## Atmosphere
A warm exhale. Sunrise cream, one glowing orange, deep-ink navy text, and
shapes so round they feel inflatable. Calm but never clinical — a friendly
hand on the shoulder.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` warm cream; \`surface-raised\` (white) for cards.
- \`primary\` (sunrise orange) for CTAs, progress, and the daily hero moment.
- \`accent\` (periwinkle blue) for secondary sessions/sleep content.
- Ink is warm navy \`surface-foreground\`; supporting text \`muted\` (soft
  violet-gray); borders are cream-toned hairlines.
- Big soft blob shapes in \`primary/15\` and \`accent/15\` may decorate cards.

## Typography
System font stack only. Rounded warmth:
- Headings \`font-bold\` 22–34px with normal tracking (never tight/condensed).
- Body 15–16px \`leading-relaxed\`; card titles 16–18px \`font-semibold\`.
- Durations/labels 12–13px \`font-medium text-muted\`.

## Shape & depth
- Maximum roundness: cards \`rounded-2xl\`–\`rounded-[32px]\`, buttons
  \`rounded-full\`, images in circles or squircles.
- Depth is soft and diffuse: \`shadow-sm\` resting cards, \`shadow-md\` hover —
  never hard edges.

## Components
- Buttons: pill h-12; primary filled orange with white bold label; secondary
  white pill with navy text and hairline border.
- Session cards: white \`rounded-2xl\` with a colored blob illustration area,
  title, duration chip (\`surface\` pill), and a small play circle.
- Progress rings: thick rounded strokes in orange on cream track.
- Greeting header: big friendly "Good morning" with sun icon and streak chip.

## Layout
Mobile-first café pacing: single column, cards stacked with 16–20px gaps,
32–40px section spacing, generous page padding (20–24px). Never dense.

## Don'ts
- No sharp corners anywhere — if it has a corner radius under 10px, round it
  more.
- No cold grays or pure white page backgrounds; warmth is the point.
- Orange never used for errors (that's \`danger\`); no alarming reds at all
  unless destructive.
`;

const Headspace_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Headspace — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #f47d31;
		--color-primary-foreground: #ffffff;
		--color-surface: #fefaf3;
		--color-surface-foreground: #2d2c41;
		--color-surface-raised: #ffffff;
		--color-muted: #7a7889;
		--color-accent: #5a77d6;
		--color-danger: #e5484d;
		--color-border: #efe4d5;

		--radius-sm: 10px;
		--radius-md: 14px;
		--radius-lg: 18px;
		--radius-xl: 24px;
		--radius-2xl: 32px;

		--shadow-sm: 0 2px 6px rgb(45 44 65 / 0.06);
		--shadow-md: 0 8px 20px rgb(45 44 65 / 0.08);
		--shadow-lg: 0 20px 48px rgb(45 44 65 / 0.12);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Nunito, Quicksand, Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.65;
		-webkit-font-smoothing: antialiased;
	}
	/* Never tight, never condensed — warmth comes from normal tracking. */
	h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: 0; line-height: 1.2; }
	p { margin: 0; }
	::selection { background: rgb(244 125 49 / 0.28); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	.wrap { max-width: 940px; margin: 0 auto; padding: 0 20px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }

	/* ── Greeting header with a sun and a streak chip ─────────────── */
	.top { display: flex; align-items: center; gap: 12px; padding: 20px 0 4px; }
	.brandmark { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 19px; }
	.brandmark .dot { width: 28px; height: 28px; border-radius: 50%; background: var(--color-primary); }
	.streak {
		display: inline-flex; align-items: center; gap: 6px;
		background: var(--color-surface-raised); border: 1px solid var(--color-border);
		border-radius: 9999px; padding: 6px 14px; font-size: 13px; font-weight: 600;
		box-shadow: var(--shadow-sm);
	}
	.avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--color-accent); }

	.greeting { padding: 22px 0 8px; position: relative; }
	.greeting h1 { font-size: 30px; }
	@media (min-width: 768px) { .greeting h1 { font-size: 38px; } }
	.greeting p { color: var(--color-muted); margin-top: 8px; max-width: 44ch; }
	.sun { width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 34% 32%, #ffd08a, var(--color-primary)); flex: none; }

	/* ── Today card: the daily hero moment ───────────────────────── */
	.today {
		display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
		background: var(--color-surface-raised);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-md);
		padding: 24px; margin-top: 20px; position: relative; overflow: hidden;
	}
	@media (min-width: 768px) { .today { padding: 30px 34px; } }
	/* Blob decoration at 15% — the only "illustration" in the system. */
	.blob { position: absolute; border-radius: 58% 42% 52% 48% / 46% 54% 46% 54%; pointer-events: none; }
	.blob.a { width: 190px; height: 160px; background: rgb(244 125 49 / 0.15); right: -50px; top: -50px; }
	.blob.b { width: 130px; height: 120px; background: rgb(90 119 214 / 0.15); right: 80px; bottom: -60px; }
	.today .ring { position: relative; z-index: 1; flex: none; }
	.today .ring svg { display: block; }
	.today .ring .pct { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 700; font-size: 18px; }
	.today .body { position: relative; z-index: 1; min-width: 0; }
	.today .k { font-size: 13px; font-weight: 600; color: var(--color-primary); letter-spacing: 0.02em; }
	.today h2 { font-size: 24px; margin-top: 6px; }
	.today p { color: var(--color-muted); margin-top: 6px; font-size: 15px; }
	.today .cta { position: relative; z-index: 1; margin-left: auto; }

	/* ── Session cards ────────────────────────────────────────────── */
	.section { padding: 34px 0; }
	@media (min-width: 768px) { .section { padding: 44px 0; } }
	.section-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; }
	.section-head h2 { font-size: 22px; }
	.section-head span { font-size: 14px; color: var(--color-primary); font-weight: 600; }
	.cards { display: grid; grid-template-columns: 1fr; gap: 18px; }
	@media (min-width: 640px) { .cards { grid-template-columns: repeat(3, 1fr); } }
	.card {
		background: var(--color-surface-raised); border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-sm); overflow: hidden;
		transition: box-shadow 220ms ease, transform 220ms ease;
	}
	.card:hover { box-shadow: var(--shadow-md); transform: translateY(-3px); }
	.card .art { height: 132px; position: relative; overflow: hidden; display: grid; place-items: center; }
	.card .art .shape { width: 74px; height: 74px; border-radius: 56% 44% 48% 52% / 48% 52% 48% 52%; background: rgb(255 255 255 / 0.55); }
	.card .b { padding: 18px 20px 22px; }
	.card h3 { font-size: 17px; }
	.card .meta { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
	.chip {
		display: inline-flex; align-items: center; border-radius: 9999px;
		background: var(--color-surface); border: 1px solid var(--color-border);
		padding: 3px 12px; font-size: 12px; font-weight: 600; color: var(--color-muted);
	}
	.playcircle {
		margin-left: auto; width: 38px; height: 38px; border-radius: 50%;
		background: var(--color-primary); color: #fff; display: grid; place-items: center;
		font-size: 14px; box-shadow: var(--shadow-sm);
	}
	.playcircle.blue { background: var(--color-accent); }

	/* ── Progress ─────────────────────────────────────────────────── */
	.progress { height: 14px; border-radius: 9999px; background: var(--color-border); overflow: hidden; margin-top: 10px; }
	.progress .fill { display: block; height: 100%; border-radius: 9999px; background: var(--color-primary); width: 62%; }

	/* ── Controls ─────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 16px; font-weight: 700;
		height: 50px; padding: 0 30px;
		border: 1px solid transparent; border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 200ms ease, transform 200ms ease;
	}
	.btn:hover { background: #e06d22; transform: translateY(-1px); }
	.btn:active { transform: translateY(0); }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgb(244 125 49 / 0.35); }
	.btn-secondary { background: var(--color-surface-raised); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: #fff; }
	.btn-blue { background: var(--color-accent); }
	.btn-blue:hover { background: #4a67c6; }
	.btn-danger { background: var(--color-danger); }
	.btn[disabled] { cursor: not-allowed; background: #eee7dc; color: #b3aebd; transform: none; }
	.btn-sm { height: 40px; font-size: 14px; padding: 0 20px; }
	.row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }

	.input {
		font: inherit; font-size: 16px; width: 100%; max-width: 340px; height: 50px; padding: 0 20px;
		border: 1px solid var(--color-border); border-radius: 9999px;
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #b3aebd; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 4px rgb(244 125 49 / 0.18); }

	.section-label { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 8px; }
	.lede { color: var(--color-muted); margin-top: 10px; max-width: 60ch; }
	.note { margin-top: 18px; font-size: 14px; color: var(--color-muted); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 24px; }
	@media (min-width: 700px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 70px; border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
	.sw b { display: block; font-size: 14px; font-weight: 700; margin-top: 10px; }
	.sw span { font-size: 13px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 288px 1fr; gap: 44px; } }
	.phone {
		width: 288px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 34px;
		overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 13px 20px 4px; font-size: 10px; color: var(--color-muted); }
	.phone-body { padding: 6px 16px 14px; }
	.phone-body .hi { display: flex; align-items: center; gap: 10px; }
	.phone-body .hi .sun { width: 34px; height: 34px; }
	.phone-body h4 { font-size: 21px; font-weight: 700; }
	.phone-body .sub { font-size: 12px; color: var(--color-muted); }
	.m-today { background: #fff; border-radius: var(--radius-2xl); box-shadow: var(--shadow-md); padding: 16px; margin-top: 14px; position: relative; overflow: hidden; display: flex; align-items: center; gap: 14px; }
	.m-today .blob.a { width: 110px; height: 96px; right: -34px; top: -34px; }
	.m-today .t { position: relative; z-index: 1; }
	.m-today .k { font-size: 10px; font-weight: 700; color: var(--color-primary); }
	.m-today b { display: block; font-size: 15px; margin-top: 2px; }
	.m-today .d { font-size: 11px; color: var(--color-muted); }
	.m-cards { display: flex; gap: 10px; margin-top: 14px; }
	.m-card { flex: 1; background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); overflow: hidden; }
	.m-card .art { height: 62px; display: grid; place-items: center; }
	.m-card .art .shape { width: 34px; height: 34px; border-radius: 56% 44% 48% 52% / 48% 52% 48% 52%; background: rgb(255 255 255 / 0.55); }
	.m-card .b { padding: 8px 10px 12px; }
	.m-card b { font-size: 12px; }
	.m-card .chip { font-size: 9px; padding: 1px 8px; margin-top: 6px; }
	.m-cta { padding: 4px 16px 14px; }
	.m-cta .btn { width: 100%; height: 44px; font-size: 15px; }
	.m-tabs { display: flex; background: var(--color-surface-raised); border-top: 1px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 9px 0 14px; font-weight: 600; }
	.m-tabs .is-active { color: var(--color-primary); }
	.m-tabs .g { display: block; width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 50%; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 15px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 16px; font-weight: 700; margin-bottom: 3px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 24px; }
	@media (min-width: 700px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 4px; background: #f2f3f5; border: 1px solid #d5d8dd; color: #4a4f57; font-size: 16px; font-weight: 600; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: #7d838c; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 24px; border-radius: var(--radius-2xl); background: var(--color-surface-raised); box-shadow: var(--shadow-md); font-size: 16px; font-weight: 700; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	footer { padding: 26px 0 56px; font-size: 13px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — the daily home screen. Warm cream, one glowing orange, and shapes
     round enough to look inflatable. -->
<div class="wrap">
	<div class="top">
		<span class="brandmark"><span class="dot"></span>Vetta</span>
		<span class="spacer"></span>
		<span class="streak">🔥 12 day streak</span>
		<span class="avatar"></span>
	</div>

	<div class="greeting">
		<div class="row" style="gap:16px">
			<span class="sun"></span>
			<div>
				<h1>Good morning, Kaori</h1>
				<p>Three minutes is enough to change the shape of the day.</p>
			</div>
		</div>
	</div>

	<div class="today">
		<span class="blob a"></span><span class="blob b"></span>
		<div class="ring">
			<svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="62% of today's goal">
				<circle cx="48" cy="48" r="40" fill="none" stroke="#efe4d5" stroke-width="12"/>
				<circle cx="48" cy="48" r="40" fill="none" stroke="#f47d31" stroke-width="12" stroke-linecap="round"
					stroke-dasharray="251" stroke-dashoffset="95" transform="rotate(-90 48 48)"/>
			</svg>
			<span class="pct">62%</span>
		</div>
		<div class="body">
			<div class="k">TODAY'S MEDITATION</div>
			<h2>Letting go of the morning rush</h2>
			<p>10 min · Basics course · with Ana</p>
		</div>
		<div class="cta"><button class="btn">Play</button></div>
	</div>

	<section class="section">
		<div class="section-head"><h2>Because you meditated on Tuesday</h2><span>See all</span></div>
		<div class="cards">
			<div class="card">
				<div class="art" style="background:linear-gradient(150deg,#ffd7a8,#f47d31)"><span class="shape"></span></div>
				<div class="b">
					<h3>Sitting with a busy mind</h3>
					<div class="meta"><span class="chip">10 min</span><span class="chip">Basics</span><span class="playcircle">▶</span></div>
				</div>
			</div>
			<div class="card">
				<div class="art" style="background:linear-gradient(150deg,#b9c6f2,#5a77d6)"><span class="shape"></span></div>
				<div class="b">
					<h3>Wind down for sleep</h3>
					<div class="meta"><span class="chip">22 min</span><span class="chip">Sleep</span><span class="playcircle blue">▶</span></div>
				</div>
			</div>
			<div class="card">
				<div class="art" style="background:linear-gradient(150deg,#ffe2b3,#f2a65a)"><span class="shape"></span></div>
				<div class="b">
					<h3>A three-minute reset</h3>
					<div class="meta"><span class="chip">3 min</span><span class="chip">Quick</span><span class="playcircle">▶</span></div>
				</div>
			</div>
		</div>
	</section>

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Roundness</p>
		<h2 style="font-size:26px">If it has a corner, round it more</h2>
		<p class="lede">Cards sit at 32px, buttons and chips are full pills, illustration shapes are
			irregular blobs, and progress is a thick stroke with rounded caps. The smallest radius anywhere
			in this system is 10px.</p>
		<div class="progress" style="max-width:420px"><span class="fill"></span></div>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#fefaf3 · warm cream</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#f47d31 · sunrise</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#5a77d6 · sleep</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>ink</b><span>#2d2c41 · warm navy</span></div>
		</div>
		<p class="note">The page is never pure white and the ink is never pure black — the whole palette leans warm, and a cool gray anywhere in it reads as a mistake immediately.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Controls</p>
		<h2 style="font-size:26px">Big friendly pills</h2>
		<div class="row" style="margin-top: 20px;">
			<button class="btn">Start session</button>
			<button class="btn btn-secondary">Maybe later</button>
			<button class="btn btn-blue">Sleepcast</button>
			<button class="btn btn-sm">Small pill</button>
			<button class="btn" disabled>Downloading…</button>
		</div>
		<div class="row" style="margin-top: 18px;">
			<input class="input" placeholder="What do you need today?">
			<span class="chip">10 min</span><span class="chip">Sleep</span><span class="chip">Stress</span>
		</div>
		<p class="note">Orange is for encouragement — buttons, progress, the daily hero. It is never used for an error; that is what <code>danger</code> is for, and even that is used sparingly.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2 style="font-size:26px">This layout was born on a phone</h2>
		<p class="lede">Single column, café pacing, generous padding — the desktop version is the one
			that had to adapt. On a phone the system simply returns to its natural shape.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-body">
					<div class="hi">
						<span class="sun"></span>
						<div><h4>Good morning</h4><div class="sub">🔥 12 day streak</div></div>
					</div>
					<div class="m-today">
						<span class="blob a"></span>
						<div class="ring" style="position:relative">
							<svg width="54" height="54" viewBox="0 0 96 96" role="img" aria-label="62% of today's goal">
								<circle cx="48" cy="48" r="40" fill="none" stroke="#efe4d5" stroke-width="14"/>
								<circle cx="48" cy="48" r="40" fill="none" stroke="#f47d31" stroke-width="14" stroke-linecap="round" stroke-dasharray="251" stroke-dashoffset="95" transform="rotate(-90 48 48)"/>
							</svg>
						</div>
						<div class="t">
							<div class="k">TODAY</div>
							<b>Letting go of the rush</b>
							<div class="d">10 min · with Ana</div>
						</div>
					</div>
					<div class="m-cards">
						<div class="m-card">
							<div class="art" style="background:linear-gradient(150deg,#ffd7a8,#f47d31)"><span class="shape"></span></div>
							<div class="b"><b>Busy mind</b><div><span class="chip">10 min</span></div></div>
						</div>
						<div class="m-card">
							<div class="art" style="background:linear-gradient(150deg,#b9c6f2,#5a77d6)"><span class="shape"></span></div>
							<div class="b"><b>Wind down</b><div><span class="chip">22 min</span></div></div>
						</div>
					</div>
				</div>
				<div class="m-cta"><button class="btn">Play today's session</button></div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Today</div>
					<div><span class="g"></span>Meditate</div>
					<div><span class="g"></span>Sleep</div>
					<div><span class="g"></span>Move</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Single column</b>The three-up card row becomes two smaller cards side by side or one stacked column at 10–18px gaps. Cards never become a dense grid.</li>
				<li><b>Page padding</b>32px → 16–20px, and never lower. Cramping this layout is the fastest way to lose the calm it is built for.</li>
				<li><b>Radius</b>Cards ease 32px → 24px, inner art keeps its blob shapes. Corners get smaller in absolute terms but the card never looks squarer.</li>
				<li><b>The ring</b>Progress rings keep their thick rounded stroke, scaled from 96px to 54px. Stroke width grows proportionally so it still reads as soft rather than thin.</li>
				<li><b>The daily CTA</b>Pins above the tab bar as a full-width orange pill at 44px. That single orange button is the only saturated element on the screen.</li>
				<li><b>Headings</b>38px → 21px at weight 700, tracking still at zero. Nothing gets condensed or tightened to fit — a shorter line of text is preferred over tighter letters.</li>
				<li><b>Blobs</b>Decorative blobs shrink but stay at 15% opacity, bleeding off the card edge. They are what keeps a small screen from feeling like a form.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2 style="font-size:26px">What breaks the exhale</h2>
		<div class="compare">
			<div class="cmp-off">Cool gray, sharp corner
				<small>4px radius · cool #f2f3f5 fill · blue-gray border and text. Temperature is the whole identity here; a cool neutral undoes it before anyone reads a word.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>32px radius, white card on warm cream, soft diffuse shadow, warm navy ink at weight 700. Round, warm and unhurried.</small></div>
		</div>
		<p class="note">Also out: pure white page backgrounds, corners under 10px, condensed or tightly tracked headings, and alarming reds used for anything but a genuinely destructive action.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — headspace · warm cream, one sunrise orange.</div></footer>
</body>
</html>
`;

const Github_THEME = `/* GitHub — dark dimmed code habitat, green actions, blue links. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #238636;
	--color-primary-foreground: #ffffff;
	--color-surface: #0d1117;
	--color-surface-foreground: #e6edf3;
	--color-surface-raised: #161b22;
	--color-muted: #8b949e;
	--color-accent: #58a6ff;
	--color-danger: #f85149;
	--color-border: #30363d;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 6px;
	--radius-xl: 8px;
	--radius-2xl: 12px;

	--shadow-sm: 0 1px 0 rgb(1 4 9 / 0.6);
	--shadow-md: 0 3px 6px rgb(1 4 9 / 0.7);
	--shadow-lg: 0 8px 24px rgb(1 4 9 / 0.8);
}
`;

const Github_SPEC = `# GitHub

## Atmosphere
A developer's night desk. Dimmed navy-black panels, quiet borders, green for
"go" and blue for "link". Functional, information-first, zero glamour.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (#0d1117) page; \`surface-raised\` (#161b22) for headers, cards,
  code blocks.
- \`primary\` green means action/success: the merge/submit button, open state.
- \`accent\` blue for links, mentions, counters, focus.
- \`danger\` red for conflicts/deletions/diff minus; text \`surface-foreground\`,
  secondary \`muted\`; every box is closed by a 1px \`border\`.

## Typography
System font stack only:
- Headings small and matter-of-fact: \`font-semibold\` 16–24px.
- Body 14px; metadata 12px \`muted\`.
- \`font-mono\` is half the interface: code, diffs, hashes, branch names, in
  bordered \`surface-raised\` chips.

## Shape & depth
- Uniform \`rounded-md\` (6px) on nearly everything.
- Flat by default — borders carry the structure; \`shadow-md\`/\`shadow-lg\` only
  for menus and dialogs.

## Components
- Buttons: h-8, \`rounded-md\`, bordered; primary is filled green, everything
  else is \`surface-raised\` with border.
- Labels: colorful bordered pills at 12px (use \`accent\`/\`primary\`/\`danger\`
  at ~15% background opacity with matching text).
- Comment/issue boxes: bordered \`surface-raised\` header + \`surface\` body.
- Diff rows in \`font-mono\` 12px: added lines tinted \`primary/15\`, removed
  \`danger/15\`.

## Layout
Left-aligned utilitarian columns; container ~1216px, main+sidebar (~296px)
split. Spacing 8/16/24; boxes stack with 16px gaps. Dense but never cramped.

## Don'ts
- No pure black or pure white surfaces; stay in the dimmed palette.
- Green never decorates — only actions/success states.
- No borderless floating cards; if it groups content, it has a border.
`;

const Github_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitHub — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #238636;
		--color-primary-foreground: #ffffff;
		--color-surface: #0d1117;
		--color-surface-foreground: #e6edf3;
		--color-surface-raised: #161b22;
		--color-muted: #8b949e;
		--color-accent: #58a6ff;
		--color-danger: #f85149;
		--color-border: #30363d;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 6px;
		--radius-xl: 8px;
		--radius-2xl: 12px;

		--shadow-sm: 0 1px 0 rgb(1 4 9 / 0.6);
		--shadow-md: 0 3px 6px rgb(1 4 9 / 0.7);
		--shadow-lg: 0 8px 24px rgb(1 4 9 / 0.8);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; line-height: 1.25; }
	p { margin: 0; }
	a { color: var(--color-accent); text-decoration: none; }
	::selection { background: rgb(88 166 255 / 0.4); }

	.wrap { max-width: 1216px; margin: 0 auto; padding: 0 16px 80px; }
	@media (min-width: 768px) { .wrap { padding: 0 24px 96px; } }

	.section { padding-top: 40px; }
	@media (min-width: 768px) { .section { padding-top: 56px; } }
	.section-label { font-family: var(--mono); font-size: 12px; color: var(--color-muted); margin-bottom: 8px; }
	.section h2 { font-size: 20px; }
	@media (min-width: 768px) { .section h2 { font-size: 24px; } }
	.lede { color: var(--color-muted); max-width: 68ch; margin-top: 8px; }
	.note { margin-top: 16px; font-size: 12px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.spacer { flex: 1; }
	.mono { font-family: var(--mono); }

	/* ── Global chrome ─────────────────────────────────────────────── */
	.appbar {
		background: var(--color-surface-raised);
		border-bottom: 1px solid var(--color-border);
		padding: 12px 16px;
		display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
	}
	@media (min-width: 768px) { .appbar { padding: 12px 24px; } }
	.octo { width: 28px; height: 28px; border-radius: 50%; background: var(--color-surface-foreground); flex: none; }
	.repo { font-size: 14px; }
	.repo b { font-weight: 600; }
	.repo .sep { color: var(--color-muted); }
	.searchbox {
		display: none; height: 30px; min-width: 260px; align-items: center;
		padding: 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface); color: var(--color-muted); font-size: 13px;
	}
	@media (min-width: 900px) { .searchbox { display: flex; } }
	.slashkey { margin-left: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0 5px; font-family: var(--mono); font-size: 11px; }

	.tabs { display: flex; gap: 4px; overflow-x: auto; padding: 0 16px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-raised); }
	@media (min-width: 768px) { .tabs { padding: 0 24px; } }
	.tabs span { padding: 10px 12px 12px; font-size: 14px; color: var(--color-surface-foreground); white-space: nowrap; display: flex; align-items: center; gap: 6px; }
	.tabs .is-active { box-shadow: inset 0 -2px 0 #f78166; font-weight: 600; }
	.counter { background: rgb(110 118 129 / 0.4); border-radius: 9999px; padding: 0 6px; font-size: 12px; }

	/* ── PR header ─────────────────────────────────────────────────── */
	.prhead { padding: 20px 0 16px; border-bottom: 1px solid var(--color-border); }
	.prhead h1 { font-size: 24px; font-weight: 400; }
	@media (min-width: 768px) { .prhead h1 { font-size: 32px; } }
	.prhead h1 .num { color: var(--color-muted); }
	.prmeta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 14px; color: var(--color-muted); }

	.state-pill {
		display: inline-flex; align-items: center; gap: 6px;
		border-radius: 9999px; padding: 5px 12px; font-size: 14px; font-weight: 500;
		background: var(--color-primary); color: var(--color-primary-foreground);
	}
	.state-pill.merged { background: #8957e5; }
	.state-pill.closed { background: var(--color-danger); }
	.state-pill .g { width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; }

	/* ── Boxes: raised header + surface body, always closed by a border ─ */
	.layout { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 24px; }
	@media (min-width: 1000px) { .layout { grid-template-columns: 1fr 296px; gap: 32px; } }
	.box { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
	.box + .box { margin-top: 16px; }
	.box-head {
		background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border);
		padding: 10px 16px; font-size: 13px; color: var(--color-muted);
		display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
	}
	.box-head b { color: var(--color-surface-foreground); font-weight: 600; }
	.box-body { padding: 16px; font-size: 14px; }
	.box-body p + p { margin-top: 12px; }
	.avatar { width: 24px; height: 24px; border-radius: 50%; background: #30363d; flex: none; display: grid; place-items: center; font-size: 10px; color: var(--color-muted); }

	/* ── Diff: mono 12px, tinted add/remove rows ──────────────────── */
	.diff { font-family: var(--mono); font-size: 12px; line-height: 20px; overflow-x: auto; }
	.layout > div { min-width: 0; }
	.diff div { display: flex; white-space: pre; }
	.diff .ln { flex: none; width: 44px; text-align: right; padding-right: 10px; color: #6e7681; user-select: none; }
	.diff .code { flex: 1; padding-right: 16px; }
	.diff .hunk { background: rgb(88 166 255 / 0.12); color: var(--color-accent); }
	.diff .add { background: rgb(35 134 54 / 0.15); }
	.diff .add .code::before { content: "+ "; color: #3fb950; }
	.diff .del { background: rgb(248 81 73 / 0.15); }
	.diff .del .code::before { content: "- "; color: var(--color-danger); }
	.diff .ctx .code::before { content: "  "; }

	/* ── Labels: 15%-opacity fill, matching text, 1px border ───────── */
	.label { display: inline-block; border-radius: 9999px; padding: 1px 10px; font-size: 12px; font-weight: 500; border: 1px solid transparent; }
	.label.blue { background: rgb(88 166 255 / 0.15); color: var(--color-accent); border-color: rgb(88 166 255 / 0.35); }
	.label.green { background: rgb(35 134 54 / 0.18); color: #3fb950; border-color: rgb(63 185 80 / 0.35); }
	.label.red { background: rgb(248 81 73 / 0.15); color: var(--color-danger); border-color: rgb(248 81 73 / 0.35); }
	.label.gray { background: rgb(110 118 129 / 0.2); color: var(--color-muted); border-color: var(--color-border); }

	/* ── Buttons: 32px, bordered, green only for the action ────────── */
	.btn {
		font: inherit; font-size: 13px; font-weight: 500;
		height: 32px; padding: 0 12px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease;
	}
	.btn:hover { background: #21262d; border-color: #8b949e; }
	.btn:focus-visible { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgb(88 166 255 / 0.3); }
	.btn-primary { background: var(--color-primary); border-color: rgb(240 246 252 / 0.1); color: var(--color-primary-foreground); }
	.btn-primary:hover { background: #2ea043; border-color: rgb(240 246 252 / 0.1); }
	.btn-danger { color: var(--color-danger); }
	.btn-danger:hover { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
	.btn[disabled] { cursor: not-allowed; color: #484f58; background: var(--color-surface-raised); border-color: #21262d; }

	.input {
		font: inherit; font-size: 14px; width: 100%;
		padding: 8px 12px; min-height: 34px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #6e7681; }
	.input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgb(88 166 255 / 0.3); }

	/* ── Sidebar ───────────────────────────────────────────────────── */
	.side-block { padding: 16px 0; border-bottom: 1px solid var(--color-border); }
	.side-block:first-child { padding-top: 0; }
	.side-title { font-size: 12px; font-weight: 600; color: var(--color-muted); margin-bottom: 10px; display: flex; }
	.side-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }

	/* ── Checks list ──────────────────────────────────────────────── */
	.check { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--color-border); font-size: 13px; }
	.check:last-child { border-bottom: 0; }
	.check .g { width: 14px; height: 14px; border-radius: 50%; flex: none; }
	.check .g.ok { background: var(--color-primary); }
	.check .g.bad { background: var(--color-danger); }
	.check .g.run { background: #d29922; }
	.check .name { font-weight: 500; }
	.check .desc { color: var(--color-muted); }

	/* ── Swatches ─────────────────────────────────────────────────── */
	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 20px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
	.sw .fill { height: 56px; }
	.sw .meta { padding: 8px 10px; background: var(--color-surface-raised); font-size: 12px; }
	.sw b { display: block; font-family: var(--mono); font-weight: 400; }
	.sw span { color: var(--color-muted); }

	/* ── Mobile ────────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 24px; align-items: start; }
	@media (min-width: 900px) { .mobile { grid-template-columns: 300px 1fr; gap: 40px; } }
	.phone {
		width: 300px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 16px;
		overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 8px 14px 4px; font-family: var(--mono); font-size: 10px; color: var(--color-muted); }
	.phone-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border); font-size: 12px; }
	.phone-body { padding: 12px; }
	.phone-body .box-head { padding: 8px 10px; font-size: 12px; }
	.phone-body .box-body { padding: 10px; font-size: 13px; }
	.m-diff { font-family: var(--mono); font-size: 10px; line-height: 17px; }
	.m-diff div { display: flex; white-space: pre; }
	.m-diff .ln { width: 26px; text-align: right; padding-right: 6px; color: #6e7681; }
	.m-tabbar { display: flex; border-top: 1px solid var(--color-border); background: var(--color-surface-raised); }
	.m-tabbar div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 12px; }
	.m-tabbar .is-active { color: var(--color-surface-foreground); box-shadow: inset 0 2px 0 #f78166; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--color-border); font-size: 13px; color: var(--color-muted); }
	.rules b { flex: none; width: 100px; font-family: var(--mono); font-size: 12px; font-weight: 400; color: var(--color-surface-foreground); }
	@media (max-width: 520px) { .rules li { display: block; } .rules b { width: auto; margin-bottom: 2px; } }

	/* ── Off-style ─────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 20px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 24px; border-radius: 18px; border: 0;
		background: linear-gradient(160deg, #1b2a4a, #0a0a0a);
		box-shadow: 0 16px 40px rgb(0 0 0 / 0.6);
		color: #fff; font-size: 16px; font-weight: 600;
	}
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: #9fb3d1; margin-top: 8px; }
	.cmp-on { padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-raised); font-size: 16px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; }
</style>
</head>
<body>

<!-- COVER — a pull request. Dimmed panels, mono everywhere, green only on the merge. -->
<div class="appbar">
	<span class="octo"></span>
	<span class="repo"><a href="#">openvetta</a> <span class="sep">/</span> <b><a href="#">design-templates</a></b></span>
	<span class="label gray">Public</span>
	<span class="spacer"></span>
	<span class="searchbox">Type <span class="mono" style="margin:0 4px">/</span> to search<span class="slashkey">/</span></span>
	<button class="btn">Watch</button>
	<button class="btn">Fork</button>
</div>
<div class="tabs">
	<span>Code</span>
	<span class="is-active">Pull requests <span class="counter">4</span></span>
	<span>Actions</span>
	<span>Projects</span>
	<span>Insights</span>
	<span>Settings</span>
</div>

<div class="wrap">
	<div class="prhead">
		<h1>Tighten hairline borders on diff rows <span class="num">#482</span></h1>
		<div class="prmeta">
			<span class="state-pill"><span class="g"></span>Open</span>
			<span><b style="color:var(--color-surface-foreground)">kmori</b> wants to merge <b style="color:var(--color-surface-foreground)">3 commits</b> into
				<span class="label gray mono">main</span> from <span class="label gray mono">fix/diff-borders</span></span>
		</div>
	</div>

	<div class="layout">
		<div>
			<div class="box">
				<div class="box-head"><span class="avatar">KM</span><b>kmori</b> commented 4 hours ago<span class="spacer"></span><span class="label gray">Owner</span></div>
				<div class="box-body">
					<p>Diff rows were rendering a 2px separator on retina because the border collapsed onto a
						half-pixel boundary. This pins them to the token value.</p>
					<p><span class="label blue">design-system</span> <span class="label green">ready for review</span> <span class="label red">needs backport</span></p>
				</div>
			</div>

			<div class="box">
				<div class="box-head"><span class="mono">templates/github/theme.css</span><span class="spacer"></span><span class="mono" style="color:#3fb950">+4</span><span class="mono" style="color:var(--color-danger)">−2</span></div>
				<div class="diff">
					<div class="hunk"><span class="ln"></span><span class="code">@@ -12,6 +12,8 @@ @theme {</span></div>
					<div class="ctx"><span class="ln">12</span><span class="code">  --color-border: #30363d;</span></div>
					<div class="del"><span class="ln">13</span><span class="code">--border-width: 2px;</span></div>
					<div class="del"><span class="ln">14</span><span class="code">--divider: rgba(255,255,255,.08);</span></div>
					<div class="add"><span class="ln">13</span><span class="code">--border-width: 1px;</span></div>
					<div class="add"><span class="ln">14</span><span class="code">--divider: var(--color-border);</span></div>
					<div class="ctx"><span class="ln">15</span><span class="code">  --radius-md: 6px;</span></div>
					<div class="ctx"><span class="ln">16</span><span class="code">}</span></div>
				</div>
			</div>

			<div class="box">
				<div class="box-head"><b>All checks have passed</b><span class="spacer"></span><span class="mono">3 successful, 1 running</span></div>
				<div class="check"><span class="g ok"></span><span class="name">build</span><span class="desc">— Successful in 31s</span><span class="spacer"></span><a href="#">Details</a></div>
				<div class="check"><span class="g ok"></span><span class="name">catalog / check</span><span class="desc">— Successful in 12s</span><span class="spacer"></span><a href="#">Details</a></div>
				<div class="check"><span class="g run"></span><span class="name">visual-diff</span><span class="desc">— In progress</span><span class="spacer"></span><a href="#">Details</a></div>
				<div class="check"><span class="g bad"></span><span class="name">lint / css</span><span class="desc">— Failing after 8s</span><span class="spacer"></span><a href="#">Details</a></div>
			</div>

			<div class="box">
				<div class="box-head"><b>Merge pull request</b></div>
				<div class="box-body">
					<div class="row">
						<button class="btn btn-primary">Merge pull request</button>
						<button class="btn">Squash and merge</button>
						<button class="btn btn-danger">Close</button>
					</div>
					<div style="margin-top: 12px;"><input class="input" placeholder="Leave a comment"></div>
				</div>
			</div>
		</div>

		<aside>
			<div class="side-block">
				<div class="side-title">Reviewers</div>
				<div class="side-item"><span class="avatar">AR</span>arivera <span class="spacer"></span><span style="color:#3fb950">approved</span></div>
				<div class="side-item"><span class="avatar">JS</span>jsun <span class="spacer"></span><span class="mono" style="color:var(--color-muted)">pending</span></div>
			</div>
			<div class="side-block">
				<div class="side-title">Labels</div>
				<div class="row" style="gap:6px"><span class="label blue">design-system</span><span class="label green">ready for review</span><span class="label red">needs backport</span></div>
			</div>
			<div class="side-block">
				<div class="side-title">Milestone</div>
				<div class="side-item">v1.4 — token pass <span class="spacer"></span><span class="mono" style="color:var(--color-muted)">62%</span></div>
			</div>
			<div class="side-block" style="border-bottom:0">
				<div class="side-title">Participants</div>
				<div class="row" style="gap:4px"><span class="avatar">KM</span><span class="avatar">AR</span><span class="avatar">JS</span><span class="avatar">MO</span></div>
			</div>
		</aside>
	</div>

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Boxes</p>
		<h2>If it groups content, it has a border</h2>
		<p class="lede">Every unit is the same construction: a <code class="mono">surface-raised</code> header strip,
			a 1px border all the way around, a <code class="mono">surface</code> body, and a 6px radius. There are no
			borderless floating cards anywhere in this system, and nothing casts a shadow inside the page.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><div class="meta"><b>surface</b><span>#0d1117 · page, box body</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><div class="meta"><b>surface-raised</b><span>#161b22 · headers, code</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><div class="meta"><b>primary</b><span>#238636 · action only</span></div></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><div class="meta"><b>accent</b><span>#58a6ff · links</span></div></div>
		</div>
		<p class="note">Neither pure black nor pure white appears. The page floor is #0d1117 and the brightest text is #e6edf3 — the whole system lives inside the dimmed range.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Controls</p>
		<h2>Green never decorates</h2>
		<div class="row" style="margin-top: 20px;">
			<button class="btn btn-primary">Merge pull request</button>
			<button class="btn">Secondary</button>
			<button class="btn btn-danger">Delete branch</button>
			<button class="btn" disabled>Merging…</button>
		</div>
		<p class="note">One filled green button per view, and only on the action that actually commits something. Everything else is a raised bordered button. Labels get a 15%-opacity fill with matching text — the only place color is allowed to be decorative.</p>
		<div class="row" style="margin-top: 16px; gap: 6px;">
			<span class="label blue">enhancement</span><span class="label green">good first issue</span>
			<span class="label red">bug</span><span class="label gray">wontfix</span>
		</div>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Boxes stay boxed, the diff keeps its gutter</h2>
		<p class="lede">The main column and the 296px sidebar stack, but nothing loses its border.
			Mono holds its size while sans shrinks, because a diff that reflows stops being a diff.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-head"><span class="octo" style="width:16px;height:16px"></span><span class="mono">openvetta/design-templates</span></div>
				<div class="phone-body">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
						<span class="state-pill" style="font-size:12px;padding:3px 10px"><span class="g"></span>Open</span>
						<span style="font-size:12px;color:var(--color-muted)">#482 · 3 commits</span>
					</div>
					<div style="font-size:15px;font-weight:600;margin-bottom:12px;">Tighten hairline borders on diff rows</div>
					<div class="box">
						<div class="box-head"><span class="mono">theme.css</span><span class="spacer"></span><span class="mono" style="color:#3fb950">+4</span><span class="mono" style="color:var(--color-danger)">−2</span></div>
						<div class="m-diff">
							<div class="hunk" style="background:rgb(88 166 255 / 0.12);color:var(--color-accent)"><span class="ln"></span><span>@@ -12,6 +12,8 @@</span></div>
							<div class="del" style="background:rgb(248 81 73 / 0.15)"><span class="ln">13</span><span>- --border-width: 2px;</span></div>
							<div class="add" style="background:rgb(35 134 54 / 0.15)"><span class="ln">13</span><span>+ --border-width: 1px;</span></div>
							<div class="ctx"><span class="ln">15</span><span>  --radius-md: 6px;</span></div>
						</div>
					</div>
					<div style="margin-top:10px" class="row">
						<span class="label blue">design-system</span><span class="label green">ready</span>
					</div>
					<button class="btn btn-primary" style="width:100%;margin-top:12px;height:36px">Merge pull request</button>
				</div>
				<div class="m-tabbar"><div class="is-active">Code</div><div>Pulls</div><div>Issues</div><div>Actions</div></div>
			</div>
			<ul class="rules">
				<li><b>&lt; 1000px</b><span>The 296px sidebar moves above the conversation as a horizontal strip of labels, reviewers and checks — it never becomes a hamburger.</span></li>
				<li><b>Diff</b><span>Stays monospace at 10–12px and scrolls horizontally inside its own box. Wrapping a diff line is never acceptable; the line-number gutter stays pinned.</span></li>
				<li><b>Boxes</b><span>Full width with 12px page gutters, border and 6px radius intact. Box headers compress to 8px padding, body text to 13px.</span></li>
				<li><b>Repo tabs</b><span>Scroll horizontally with the orange active underline preserved; the four highest-traffic destinations also appear as a bottom bar.</span></li>
				<li><b>Targets</b><span>Buttons grow 32px → 36px and the committing action spans full width. Hover styles map to :active, since there is no hover.</span></li>
				<li><b>Search</b><span>The <code class="mono">/</code> field drops out of the app bar and becomes an icon; the keyboard hint is hidden rather than shown untappable.</span></li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the night desk</h2>
		<div class="compare">
			<div class="cmp-off">Floating gradient panel
				<small>18px radius · navy gradient · no border · deep drop shadow. A borderless card that groups content is the single most off-style thing you can build here.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>6px radius, flat #161b22 fill, 1px #30363d border, no shadow. Depth is a border and a one-step-lighter fill — nothing else.</small></div>
		</div>
		<p class="note">Also out: pure black or pure white surfaces, green used as decoration, sans-serif where a hash or branch name belongs, and any radius above 12px.</p>
	</section>

</div>
</body>
</html>
`;

const GeometricBold_THEME = `/* Geometric Bold — Bauhaus / constructivist poster. Pure primaries, no soft anything.
   Palette adapted from the StyleKit「几何大胆风」guide (see meta.json origin). */
@theme static {
	--color-primary: #000000;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #000000;
	--color-surface-raised: #ffffff;
	--color-muted: #6c3b00;
	--color-accent: #0000ff;
	--color-danger: #ff0000;
	--color-border: #000000;

	/* Shape palette — the four poster inks. Use as full blocks, never as tints. */
	--color-block-red: #ff0000;
	--color-block-blue: #0000ff;
	--color-block-yellow: #ffff00;
	--color-block-earth: #6c3b00;

	/* Foregrounds that stay legible on each block. */
	--color-block-red-foreground: #ffffff;
	--color-block-blue-foreground: #ffffff;
	--color-block-yellow-foreground: #000000;
	--color-block-earth-foreground: #ffffff;

	/* Two radii only: a shape is either a hard rectangle or a perfect circle. */
	--radius-sm: 0px;
	--radius-md: 0px;
	--radius-lg: 0px;
	--radius-xl: 0px;
	--radius-2xl: 0px;
	--radius-full: 9999px;

	/* Structure comes from 4px borders. Border widths, not elevation. */
	--border-width-hair: 2px;
	--border-width-base: 4px;
	--border-width-heavy: 8px;

	/* No blur, ever. Floating layers get a hard offset block so they still read
	   as "above" without introducing soft depth. */
	--shadow-sm: none;
	--shadow-md: none;
	--shadow-lg: 8px 8px 0 0 #000000;
}
`;

const GeometricBold_SPEC = `# Geometric Bold

## Atmosphere
A Bauhaus poster that happens to be an interface. Flat planes of pure ink on
white, cut by 4px black rules; circles, squares and triangles carry the meaning
before any word does. Nothing recedes, nothing glows, nothing is soft — the page
is loud on purpose and reads as artwork first, UI second.

Fits art exhibitions, design studios, portfolios, and products that want to look
declarative rather than friendly.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is white and stays white; \`surface-raised\` is also white, because
  panels are separated by \`border\` (4px black), never by fill or elevation.
- \`primary\` is pure black: body text, every border, and inverted hero blocks
  (black panel + \`primary-foreground\` text).
- \`muted\` (earth brown) is the only secondary text color. There are no grays in
  this system — a dimmed gray reads as a mistake here.
- \`accent\` (blue) is the general emphasis ink: links, selected state, one
  supporting block per screen.
- \`danger\` (red) is the loudest ink. It doubles as the hero color block, so
  spend it once per screen and let error states own it everywhere else.
- \`block-red\` / \`block-blue\` / \`block-yellow\` / \`block-earth\` are the four poster
  inks for decorative shapes, each with a matching \`-foreground\` token.
- Cap any one screen at three inks + black + white. Four is already too many.

## Typography
- Headings: \`font-black uppercase tracking-tight\`. Weight 900 is the floor, not
  a peak — there is no such thing as a light heading here.
- Hero type is deliberately oversized and allowed to crop or run off the edge:
  roughly 60px → 96px → 160px across sm/md/lg.
- Scale below the hero: H1 36/60, H2 30/36, H3 20/24, body 14/16, small 12/14.
- Body is \`font-sans font-medium\` — never \`font-light\` or \`font-normal\`.
- \`font-mono\` for numbers, labels, captions and metadata; uppercase with wide
  tracking makes it read as part of the poster grid.
- Button and label text is \`uppercase tracking-widest\`.

## Spacing & layout
- Asymmetry is the layout rule. Offset the grid, let one column outweigh the
  other, hang shapes off the margin. A centered, evenly balanced page kills the
  style.
- Section rhythm: 48px → 96px → 128px vertical. Container padding 16 → 32 → 48.
- Gaps come in three steps: 8/16, 16/32, 32/48 (small / medium / large).
- Cards pad 24 → 32.
- Blocks butt directly against each other with no gutter — shared 4px rules are
  a feature, and full-bleed color panels should touch the viewport edge.

## Components
- **Borders:** 4px \`border\` on essentially every container. 8px for a hero
  frame, 2px only for dense table rules.
- **Radius:** \`radius-*\` are all 0 — hard corners. The single exception is
  \`radius-full\` for true circles (avatars, dots, badges, round buttons). Nothing
  in between; a 12px rounded card is off-style.
- **Buttons:** solid ink fill (\`primary\`, \`danger\`, \`accent\`) or white with a
  4px black border. \`font-bold uppercase tracking-widest\`, square corners, no
  shadow. Hover swaps the fill and text colors outright rather than shading them.
- **Cards:** white, 4px black border, flat. Hierarchy is expressed by size and
  by which ink the header block uses, not by elevation.
- **Inputs:** white field, 4px black border, \`font-medium\`. Focus removes the
  default outline and fills the field with \`block-yellow\` — the loudest possible
  focus signal, and the reason yellow is reserved.
- **Overlays:** dialogs and popovers sit on white with a 4px border and
  \`shadow-lg\`, which is a hard 8px black offset with zero blur. That offset is
  the only depth cue this system permits.
- **Decorative shapes:** circles, squares and triangles in the block inks,
  placed to break the grid. They may overlap and crop; they never carry text
  that matters unless the contrast pair is a \`block-*\` / \`-foreground\` match.
- **States:** cover default, hover, keyboard focus, active, disabled, loading,
  empty, error and success. Express disabled with a hatched or outlined
  treatment rather than by lowering opacity.

## Motion
- Short and mechanical: \`transition-colors\` at 200ms. Color swaps, not fades.
- Hover scales up ~5%, active presses down to ~95%. Nothing else moves.
- No parallax, no easing flourishes, no fade-in-on-scroll. If a transition needs
  blur or opacity to look good, it doesn't belong here.
- Respect \`prefers-reduced-motion\` by dropping the scale steps and keeping the
  color change.

## Accessibility
- Black on white is 21:1; keep long-form reading on that pair.
- The block inks land between roughly 3.8:1 and 5.6:1 with their paired
  foregrounds — fine for large \`font-black\` display type, not for 12px captions.
  Small text on a colored block should move to black on white.
- \`muted\` brown on white is about 7.5:1 and is the safe secondary text pair.
- Focus must always be visible; the yellow focus fill is the mechanism, so never
  strip it without replacing it with an equally loud indicator.

## Don't
- No gradients, and no soft transitions between colors.
- No shadows with blur — \`shadow-sm\` and \`shadow-md\` are \`none\` by design.
- No rounded corners other than 0 or a full circle.
- No opacity-based dimming (\`opacity-50/60/70\`) to create hierarchy.
- No light or regular font weights.
- No gray palette (\`gray-100\`…\`gray-400\`) for fills or text.
- No symmetrical, evenly centered layouts.
- No more than three inks plus black and white on one screen.
- No decorative frills — texture, glow, inner shadow, glassmorphism.
`;

const GeometricBold_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Geometric Bold — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #000000;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #000000;
		--color-surface-raised: #ffffff;
		--color-muted: #6c3b00;
		--color-accent: #0000ff;
		--color-danger: #ff0000;
		--color-border: #000000;

		--color-block-red: #ff0000;
		--color-block-blue: #0000ff;
		--color-block-yellow: #ffff00;
		--color-block-earth: #6c3b00;

		--radius-full: 9999px;
		--border-width-base: 4px;
		--border-width-heavy: 8px;
		--shadow-lg: 8px 8px 0 0 #000000;

		--sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
		--mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-weight: 500;
		font-size: 16px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	/* Weight 900 is the floor, not the peak. There are no light headings here. */
	h1, h2, h3 { margin: 0; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; line-height: 1; }
	p { margin: 0; }
	::selection { background: var(--color-block-yellow); color: #000; }
	.spacer { flex: 1; }
	.mono { font-family: var(--mono); }
	.label {
		font-family: var(--mono); font-size: 12px;
		text-transform: uppercase; letter-spacing: 0.2em; color: var(--color-muted);
	}

	.wrap { max-width: 1180px; margin: 0 auto; padding: 0 16px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }
	@media (min-width: 1024px) { .wrap { padding: 0 48px; } }

	/* ── Masthead: a rule, not a bar ──────────────────────────────── */
	.masthead {
		display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
		padding: 16px 0; border-bottom: var(--border-width-base) solid var(--color-border);
	}
	.wordmark { font-weight: 900; text-transform: uppercase; letter-spacing: -0.03em; font-size: 22px; display: flex; align-items: center; gap: 10px; }
	.wordmark .sq { width: 20px; height: 20px; background: var(--color-block-red); }
	.masthead nav { display: none; gap: 26px; }
	@media (min-width: 780px) { .masthead nav { display: flex; } }

	/* ── The poster: asymmetric blocks butting with no gutter ─────── */
	.poster { display: grid; grid-template-columns: 1fr; border-bottom: var(--border-width-heavy) solid var(--color-border); }
	@media (min-width: 900px) { .poster { grid-template-columns: 7fr 3fr; } }
	.poster-main {
		background: var(--color-primary); color: var(--color-primary-foreground);
		padding: 28px 20px 32px; position: relative; overflow: hidden;
	}
	@media (min-width: 768px) { .poster-main { padding: 48px 40px 56px; } }
	.poster-main .kicker { font-family: var(--mono); font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
	/* Hero type is allowed to crop and run off the edge. */
	.poster-main h1 { font-size: 58px; line-height: 0.86; margin-top: 18px; }
	@media (min-width: 768px) { .poster-main h1 { font-size: 104px; } }
	@media (min-width: 1024px) { .poster-main h1 { font-size: 148px; margin-right: -30px; } }
	.poster-main .dates { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 28px; font-family: var(--mono); font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; }
	.poster-main .circle-crop { position: absolute; right: -70px; bottom: -70px; width: 220px; height: 220px; border-radius: var(--radius-full); background: var(--color-block-red); }

	.poster-side { display: grid; grid-template-rows: 1fr 1fr 1fr; }
	@media (min-width: 900px) { .poster-side { border-left: var(--border-width-base) solid var(--color-border); } }
	.poster-side > div { display: grid; place-items: center; padding: 28px; border-top: var(--border-width-base) solid var(--color-border); }
	@media (min-width: 900px) { .poster-side > div:first-child { border-top: 0; } }

	/* ── Shape vocabulary ─────────────────────────────────────────── */
	.shape-circle { width: 84px; height: 84px; border-radius: var(--radius-full); }
	.shape-square { width: 84px; height: 84px; }
	.shape-triangle {
		width: 0; height: 0;
		border-left: 42px solid transparent; border-right: 42px solid transparent;
		border-bottom: 84px solid var(--color-block-yellow);
	}
	.shapes { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-end; }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding: 48px 0; }
	@media (min-width: 768px) { .section { padding: 88px 0; } }
	.section-label {
		font-family: var(--mono); font-size: 12px;
		text-transform: uppercase; letter-spacing: 0.2em; color: var(--color-muted);
		border-bottom: var(--border-width-base) solid var(--color-border);
		padding-bottom: 8px; margin-bottom: 28px;
	}
	.section h2 { font-size: 32px; }
	@media (min-width: 768px) { .section h2 { font-size: 52px; } }
	.lede { margin-top: 18px; max-width: 58ch; font-size: 16px; }
	.note { margin-top: 22px; font-size: 14px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
	/* Asymmetry is the layout rule — one column always outweighs the other. */
	.split { display: grid; grid-template-columns: 1fr; gap: 0; border: var(--border-width-base) solid var(--color-border); margin-top: 32px; }
	@media (min-width: 820px) { .split { grid-template-columns: 5fr 3fr; } }
	.split > div { padding: 24px; }
	@media (min-width: 768px) { .split > div { padding: 32px; } }
	@media (min-width: 820px) { .split > div + div { border-left: var(--border-width-base) solid var(--color-border); } }
	@media (max-width: 819px) { .split > div + div { border-top: var(--border-width-base) solid var(--color-border); } }

	/* ── Buttons: solid ink or white with a 4px rule. Hover swaps. ── */
	.btn {
		font: inherit; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.15em; font-size: 13px;
		padding: 14px 26px;
		border: var(--border-width-base) solid var(--color-border);
		border-radius: 0; box-shadow: none;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer;
		transition: color 200ms, background-color 200ms, transform 200ms;
	}
	.btn:hover { background: var(--color-surface); color: var(--color-surface-foreground); transform: scale(1.05); }
	.btn:active { transform: scale(0.95); }
	.btn:focus-visible { outline: none; background: var(--color-block-yellow); color: var(--color-primary); }
	.btn-outline { background: var(--color-surface); color: var(--color-surface-foreground); }
	.btn-outline:hover { background: var(--color-primary); color: var(--color-primary-foreground); }
	.btn-accent { background: var(--color-accent); color: #fff; }
	.btn-accent:hover { background: var(--color-surface); color: var(--color-accent); }
	.btn-danger { background: var(--color-danger); color: #fff; }
	.btn-danger:hover { background: var(--color-surface); color: var(--color-danger); }
	.btn-round { border-radius: var(--radius-full); }
	/* Disabled is hatched, never faded — no opacity dimming in this system. */
	.btn[disabled] {
		cursor: not-allowed; transform: none; color: var(--color-primary);
		background: repeating-linear-gradient(45deg, #fff 0 12px, #000 12px 14px);
		text-decoration: line-through;
	}

	.field { max-width: 380px; }
	.input {
		font: inherit; font-weight: 500; font-size: 16px;
		width: 100%; padding: 13px 14px;
		border: var(--border-width-base) solid var(--color-border); border-radius: 0;
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: var(--color-muted); }
	/* Focus fills the field with yellow — the loudest possible signal. */
	.input:focus { outline: none; background: var(--color-block-yellow); }

	/* ── Cards: white, 4px rule, flat. Hierarchy from the header ink. ── */
	.cards { display: grid; grid-template-columns: 1fr; border: var(--border-width-base) solid var(--color-border); margin-top: 32px; }
	@media (min-width: 820px) { .cards { grid-template-columns: repeat(3, 1fr); } }
	.card { background: var(--color-surface-raised); }
	@media (min-width: 820px) { .card + .card { border-left: var(--border-width-base) solid var(--color-border); } }
	@media (max-width: 819px) { .card + .card { border-top: var(--border-width-base) solid var(--color-border); } }
	.card-head { padding: 14px 20px; border-bottom: var(--border-width-base) solid var(--color-border); font-family: var(--mono); font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
	.card-head.red { background: var(--color-block-red); color: #fff; }
	.card-head.blue { background: var(--color-block-blue); color: #fff; }
	.card-head.yellow { background: var(--color-block-yellow); color: #000; }
	.card-body { padding: 20px; }
	.card-body h3 { font-size: 22px; }
	.card-body p { margin-top: 10px; font-size: 15px; }

	/* ── Ink swatches ─────────────────────────────────────────────── */
	.inks { display: grid; grid-template-columns: repeat(2, 1fr); border: var(--border-width-base) solid var(--color-border); margin-top: 32px; }
	@media (min-width: 720px) { .inks { grid-template-columns: repeat(4, 1fr); } }
	.ink { padding: 0; }
	.ink .chip { height: 96px; display: grid; place-items: end start; padding: 12px; font-family: var(--mono); font-size: 12px; letter-spacing: 0.16em; }
	.ink .meta { padding: 12px; border-top: var(--border-width-base) solid var(--color-border); font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); }
	@media (min-width: 720px) { .ink + .ink { border-left: var(--border-width-base) solid var(--color-border); } }
	@media (max-width: 719px) { .ink:nth-child(2n) { border-left: var(--border-width-base) solid var(--color-border); } .ink:nth-child(n+3) { border-top: var(--border-width-base) solid var(--color-border); } }

	/* ── Table: 2px rules, the one place the border thins ─────────── */
	table { width: 100%; border-collapse: collapse; margin-top: 32px; }
	.tablewrap { overflow-x: auto; }
	th { text-align: left; font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-muted); padding: 10px 12px; border-bottom: var(--border-width-base) solid var(--color-border); }
	td { padding: 14px 12px; border-bottom: 2px solid var(--color-border); font-size: 15px; }
	td.num { font-family: var(--mono); text-align: right; }
	.dot { display: inline-block; width: 12px; height: 12px; border-radius: var(--radius-full); vertical-align: -1px; margin-right: 8px; }

	/* ── Overlay: the 8px offset is the only depth cue permitted ──── */
	.stage { margin-top: 32px; padding: 40px 20px; border: var(--border-width-base) solid var(--color-border); background: repeating-linear-gradient(45deg, #fff 0 14px, #f2f2f2 14px 28px); }
	.dialog { max-width: 440px; margin: 0 auto; background: var(--color-surface); border: var(--border-width-base) solid var(--color-border); box-shadow: var(--shadow-lg); }
	.dialog .bar { padding: 14px 20px; border-bottom: var(--border-width-base) solid var(--color-border); font-family: var(--mono); font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
	.dialog .body { padding: 20px; }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 32px; align-items: start; }
	@media (min-width: 900px) { .mobile { grid-template-columns: 292px 1fr; gap: 48px; } }
	/* No rounded phone shell — the frame obeys the system too. */
	.phone { width: 292px; max-width: 100%; margin: 0 auto; border: var(--border-width-heavy) solid var(--color-border); background: var(--color-surface); }
	.phone-status { display: flex; justify-content: space-between; padding: 8px 12px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.14em; border-bottom: var(--border-width-base) solid var(--color-border); }
	.m-poster { background: var(--color-primary); color: var(--color-primary-foreground); padding: 18px 14px 22px; position: relative; overflow: hidden; }
	.m-poster .kicker { font-family: var(--mono); font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; }
	.m-poster h4 { font-size: 44px; font-weight: 900; text-transform: uppercase; line-height: 0.86; letter-spacing: -0.03em; margin: 10px 0 0; }
	.m-poster .circle-crop { width: 120px; height: 120px; right: -46px; bottom: -50px; }
	.m-blocks { display: grid; grid-template-columns: 1fr 1fr; border-bottom: var(--border-width-base) solid var(--color-border); }
	.m-blocks > div { padding: 18px; display: grid; place-items: center; border-top: var(--border-width-base) solid var(--color-border); }
	.m-blocks > div + div { border-left: var(--border-width-base) solid var(--color-border); }
	.m-rows { padding: 0; }
	.m-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 2px solid var(--color-border); font-size: 13px; }
	.m-row .mono { margin-left: auto; font-size: 11px; }
	.m-cta { padding: 14px; }
	.m-cta .btn { width: 100%; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 2px solid var(--color-border); font-size: 15px; }
	.rules b { display: block; font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; }
	.rules span { color: var(--color-muted); }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 20px; margin-top: 32px; }
	@media (min-width: 760px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 26px; border-radius: 16px; border: 1px solid #e5e7eb;
		background: linear-gradient(140deg, #f9fafb, #eef2f7);
		box-shadow: 0 10px 30px rgb(15 23 42 / 0.1);
		color: #64748b; font-weight: 400; font-size: 16px;
	}
	.cmp-off small { display: block; font-size: 13px; margin-top: 10px; color: #94a3b8; }
	.cmp-on { padding: 26px; border: var(--border-width-base) solid var(--color-border); font-weight: 900; text-transform: uppercase; font-size: 20px; line-height: 1.1; }
	.cmp-on small { display: block; font-size: 13px; font-weight: 500; text-transform: none; color: var(--color-muted); margin-top: 12px; line-height: 1.5; }

	footer { border-top: var(--border-width-heavy) solid var(--color-border); padding: 28px 0 56px; font-family: var(--mono); font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-muted); }

	@media (prefers-reduced-motion: reduce) {
		.btn:hover, .btn:active { transform: none; }
	}
</style>
</head>
<body>

<!-- COVER — an exhibition poster that happens to be an interface. Asymmetric
     blocks, no gutters, one cropped circle, three inks and no more. -->
<div class="wrap">
	<div class="masthead">
		<span class="wordmark"><span class="sq"></span>Vetta</span>
		<nav class="label"><span>Programme</span><span>Studio</span><span>Archive</span></nav>
		<span class="spacer"></span>
		<button class="btn">Tickets</button>
	</div>
</div>

<div class="poster">
	<div class="poster-main">
		<p class="kicker">Vetta Kunsthalle — Hall 2</p>
		<h1>Form<br>Follows<br>Nothing</h1>
		<div class="dates">
			<span>12 Apr — 30 Jun</span><span>Daily 10:00—18:00</span><span>Free entry</span>
		</div>
		<span class="circle-crop"></span>
	</div>
	<div class="poster-side">
		<div style="background: var(--color-block-blue);"><span class="shape-circle" style="background: var(--color-surface);"></span></div>
		<div style="background: var(--color-block-yellow);"><span class="shape-square" style="background: var(--color-primary);"></span></div>
		<div><span class="shape-triangle"></span></div>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Shape carries the meaning</p>
		<h2>Circle, square, triangle</h2>
		<p class="lede">The three primitives do the work an icon set would do elsewhere. They may
			overlap, crop and hang off the margin — what they must never do is sit politely centred inside
			a padded box.</p>
		<div class="shapes" style="margin-top: 32px;">
			<span class="shape-circle" style="background: var(--color-block-red);"></span>
			<span class="shape-square" style="background: var(--color-block-blue);"></span>
			<span class="shape-triangle"></span>
			<span class="shape-circle" style="background: var(--color-block-earth);"></span>
			<span class="shape-square" style="background: var(--color-primary);"></span>
		</div>
		<div class="split">
			<div>
				<h3 style="font-size:24px">Asymmetry is the layout rule</h3>
				<p style="margin-top:12px">One column outweighs the other, blocks butt directly together, and the
					shared 4px rule between them is a feature rather than a seam. A symmetrical, evenly balanced
					page kills the style faster than any wrong color could.</p>
			</div>
			<div style="background: var(--color-block-yellow);">
				<p class="label" style="color: var(--color-primary)">Ratio</p>
				<p style="font-weight:900;font-size:44px;line-height:1;margin-top:10px">5:3</p>
			</div>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Inks</p>
		<h2>Three inks, plus black and white</h2>
		<p class="lede">Four is already too many. There are no grays anywhere in the system — the only
			secondary text color is earth brown, and a dimmed gray reads as a mistake on sight.</p>
		<div class="inks">
			<div class="ink">
				<div class="chip" style="background: var(--color-block-red); color: #fff;">FF0000</div>
				<div class="meta">block-red · hero, once</div>
			</div>
			<div class="ink">
				<div class="chip" style="background: var(--color-block-blue); color: #fff;">0000FF</div>
				<div class="meta">block-blue · links, selected</div>
			</div>
			<div class="ink">
				<div class="chip" style="background: var(--color-block-yellow); color: #000;">FFFF00</div>
				<div class="meta">block-yellow · focus only</div>
			</div>
			<div class="ink">
				<div class="chip" style="background: var(--color-block-earth); color: #fff;">6C3B00</div>
				<div class="meta">muted · secondary text</div>
			</div>
		</div>
		<div class="cards">
			<div class="card">
				<div class="card-head red">01 / Flat</div>
				<div class="card-body"><h3>No elevation</h3><p>Cards are white with a 4px rule. Hierarchy comes from size and from which ink the header block takes.</p></div>
			</div>
			<div class="card">
				<div class="card-head blue">02 / Hard</div>
				<div class="card-body"><h3>No radius</h3><p>Every corner is 0. The only exception is a true circle — nothing lives in between.</p></div>
			</div>
			<div class="card">
				<div class="card-head yellow">03 / Loud</div>
				<div class="card-body"><h3>No opacity</h3><p>Dimming with opacity is banned. Disabled states hatch; secondary text changes ink.</p></div>
			</div>
		</div>
	</section>

	<!-- 03 -->
	<section class="section">
		<p class="section-label">03 — Controls</p>
		<h2>Hover swaps, focus goes yellow</h2>
		<p class="lede">Buttons are a solid ink fill or white inside a 4px rule, uppercase with wide
			tracking. Hover inverts the fill and text outright — no shading, no fade. Focus fills the field
			with yellow, which is the reason yellow is reserved for nothing else.</p>
		<div class="row" style="margin-top: 32px;">
			<button class="btn">Book tickets</button>
			<button class="btn btn-outline">Programme</button>
			<button class="btn btn-accent">Members</button>
			<button class="btn btn-danger">Cancel</button>
			<button class="btn btn-round">Round</button>
			<button class="btn" disabled>Sold out</button>
		</div>
		<div class="field" style="margin-top: 26px;">
			<p class="label" style="margin-bottom: 8px;">Newsletter — click in</p>
			<input class="input" placeholder="you@studio.com">
		</div>

		<div class="tablewrap">
		<table>
			<thead><tr><th>Work</th><th>Room</th><th>Ink</th><th style="text-align:right">Year</th></tr></thead>
			<tbody>
				<tr><td><span class="dot" style="background: var(--color-block-red)"></span>Composition in rule</td><td>Hall 2</td><td class="mono">RED</td><td class="num">1923</td></tr>
				<tr><td><span class="dot" style="background: var(--color-block-blue)"></span>Study, three planes</td><td>Hall 2</td><td class="mono">BLUE</td><td class="num">1925</td></tr>
				<tr><td><span class="dot" style="background: var(--color-block-yellow)"></span>Untitled (focus)</td><td>Hall 3</td><td class="mono">YELLOW</td><td class="num">1927</td></tr>
				<tr><td><span class="dot" style="background: var(--color-block-earth)"></span>Earth, offset</td><td>Archive</td><td class="mono">EARTH</td><td class="num">1931</td></tr>
			</tbody>
		</table>
		</div>
		<p class="note">Table rules are the one place the border thins — 2px for dense rows, 4px under the header. Every number is monospace.</p>
	</section>

	<!-- 04 -->
	<section class="section">
		<p class="section-label">04 — Overlay</p>
		<h2>One depth cue, eight pixels</h2>
		<div class="stage">
			<div class="dialog">
				<div class="bar">Confirm — 2 tickets</div>
				<div class="body">
					<h3 style="font-size:22px">Hold these seats?</h3>
					<p style="margin-top:10px;font-size:15px">The hold lasts ten minutes. After that the seats go back to the room.</p>
					<div class="row" style="margin-top: 22px;">
						<button class="btn">Hold</button>
						<button class="btn btn-outline">Back</button>
					</div>
				</div>
			</div>
		</div>
		<p class="note">A hard 8px black offset with zero blur. Every other shadow token in this system is <code class="mono">none</code>, and blurred shadows are off-style at any size.</p>
	</section>

	<!-- 05 MOBILE -->
	<section class="section">
		<p class="section-label">05 — Mobile</p>
		<h2>The poster reflows, the rules do not</h2>
		<p class="lede">A 4px rule is 4px on a 320px screen too. Everything about the mobile build is a
			re-stacking of the same blocks — what changes is which edge carries the rule, never how heavy
			that rule is.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>09:41</span><span>LTE</span></div>
				<div class="m-poster">
					<p class="kicker">Vetta Kunsthalle</p>
					<h4>Form<br>Follows<br>Nothing</h4>
					<span class="circle-crop" style="position:absolute;border-radius:var(--radius-full);background:var(--color-block-red);"></span>
				</div>
				<div class="m-blocks">
					<div style="background: var(--color-block-blue);"><span class="shape-circle" style="width:44px;height:44px;background:#fff"></span></div>
					<div style="background: var(--color-block-yellow);"><span class="shape-square" style="width:44px;height:44px;background:#000"></span></div>
				</div>
				<div class="m-rows">
					<div class="m-row"><span class="dot" style="background: var(--color-block-red)"></span>Composition in rule<span class="mono">1923</span></div>
					<div class="m-row"><span class="dot" style="background: var(--color-block-blue)"></span>Study, three planes<span class="mono">1925</span></div>
					<div class="m-row"><span class="dot" style="background: var(--color-block-yellow)"></span>Untitled (focus)<span class="mono">1927</span></div>
				</div>
				<div class="m-cta"><button class="btn">Book tickets</button></div>
			</div>
			<ul class="rules">
				<li><b>Borders hold</b><span>4px base and 8px heavy stay exactly as they are. Thinning a rule to "breathe" on mobile is the single change that would dismantle this style.</span></li>
				<li><b>Vertical rules become horizontal</b><span>The 7:3 poster split stacks, and the rule that divided the columns moves to the top edge of the block below it. No gutter appears between them.</span></li>
				<li><b>Hero type</b><span>148px → 104px → 44px, still weight 900 uppercase at 0.86 line height. It stays the largest object on the screen and may still crop at the edge.</span></li>
				<li><b>Container padding</b><span>48px → 32px → 16px. Full-bleed color panels ignore it entirely and run to the viewport edge, which is what keeps the poster feeling printed.</span></li>
				<li><b>Shapes</b><span>Circles, squares and triangles halve in size but stay whole and stay in the block inks. A shape that shrinks below ~40px stops reading and is dropped instead.</span></li>
				<li><b>Focus and hover</b><span>There is no hover on touch, so the color swap moves entirely to <code class="mono">:active</code>. The yellow focus fill still fires for keyboard users on tablets with a keyboard attached.</span></li>
				<li><b>Cards and tables</b><span>Three-column card rows stack with a 4px rule between them. Table rows keep their 2px rules; the room column drops and the year stays monospace on the right.</span></li>
			</ul>
		</div>
	</section>

	<!-- 06 DON'T -->
	<section class="section">
		<p class="section-label">06 — Off-style, for contrast</p>
		<h2>What breaks the poster</h2>
		<div class="compare">
			<div class="cmp-off">Soft neutral card
				<small>16px radius · gray gradient · blurred shadow · 1px hairline · regular weight slate text. Six violations in one box, and each on its own would be enough.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>Square corners, 4px black rule, flat white, weight 900 uppercase, earth brown for the secondary line. Loud on purpose.</small></div>
		</div>
		<p class="note">Also out: gradients, blur, opacity-based dimming, gray palettes, light font weights, symmetrical centred layouts, and a fourth ink.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — geometric bold · three inks, black, white.</div></footer>
</body>
</html>
`;

const Apple_THEME = `/* Apple — airy premium neutrals, generous curves, one blue. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #0071e3;
	--color-primary-foreground: #ffffff;
	--color-surface: #f5f5f7;
	--color-surface-foreground: #1d1d1f;
	--color-surface-raised: #ffffff;
	--color-muted: #6e6e73;
	--color-accent: #34c759;
	--color-danger: #ff3b30;
	--color-border: #d2d2d7;

	--radius-sm: 8px;
	--radius-md: 12px;
	--radius-lg: 18px;
	--radius-xl: 24px;
	--radius-2xl: 32px;

	--shadow-sm: 0 2px 8px rgb(0 0 0 / 0.04);
	--shadow-md: 0 8px 24px rgb(0 0 0 / 0.08);
	--shadow-lg: 0 24px 64px rgb(0 0 0 / 0.12);
}
`;

const Apple_SPEC = `# Apple

## Atmosphere
Premium air. Soft neutral gray, white product cards, enormous typography and
enormous silence around it. Everything feels machined: perfect curves, perfect
spacing, one blue.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (#f5f5f7) is the stage; \`surface-raised\` (white) for cards/sheets.
- \`surface-foreground\` near-black ink; long copy in \`muted\`.
- \`primary\` (blue) only on links and the single CTA per view.
- \`accent\` (green) strictly for success/health; \`danger\` for destructive.

## Typography
System font stack only — it literally is the brand's stack:
- Display headings huge and heavy: \`font-semibold tracking-tight\` 32–56px.
- Section titles 21–28px; body 17px with \`leading-relaxed\`; captions 12px.
- Size contrast does the hierarchy — weights stay between 400 and 600.

## Shape & depth
- Generous radii: cards \`rounded-xl\`/\`rounded-2xl\` (18–32px); controls curve
  fully (pill buttons).
- Depth is diffuse and quiet: \`shadow-sm\` resting, \`shadow-md\` on hover;
  borders almost invisible (\`border\` only where surfaces touch).

## Components
- Buttons: pill (\`rounded-full\`), h-9–11; filled blue primary, and the
  signature quiet secondary — blue text link with a chevron.
- Cards: big white \`rounded-2xl\` blocks with 24–32px padding, image-led.
- Inputs: \`rounded-lg\`, hairline border, focus ring \`primary/30\`.
- Segmented controls over tabs; toggles over checkboxes.

## Layout
Centered, symmetric, spacious. Content max ~980px; sections separated by
64–96px; card grids 2–3 columns with 16–24px gaps. Nothing touches an edge.

## Don'ts
- No dense tables or cramped rows — this language is for showcase surfaces.
- Never more than one accent hue per view; no gradients except product art.
- No sharp corners, no heavy borders, no drop shadows with hard edges.
`;

const Apple_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apple — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #0071e3;
		--color-primary-foreground: #ffffff;
		--color-surface: #f5f5f7;
		--color-surface-foreground: #1d1d1f;
		--color-surface-raised: #ffffff;
		--color-muted: #6e6e73;
		--color-accent: #34c759;
		--color-danger: #ff3b30;
		--color-border: #d2d2d7;

		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 18px;
		--radius-xl: 24px;
		--radius-2xl: 32px;

		--shadow-sm: 0 2px 8px rgb(0 0 0 / 0.04);
		--shadow-md: 0 8px 24px rgb(0 0 0 / 0.08);
		--shadow-lg: 0 24px 64px rgb(0 0 0 / 0.12);

		--sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 17px;
		line-height: 1.62;
		-webkit-font-smoothing: antialiased;
	}
	/* Size contrast does the hierarchy — weight stays between 400 and 600. */
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.03em; line-height: 1.06; }
	p { margin: 0; }
	::selection { background: rgb(0 113 227 / 0.2); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }
	a { color: var(--color-primary); text-decoration: none; }

	.wrap { max-width: 980px; margin: 0 auto; padding: 0 22px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }

	/* ── Nav: 44px, hairline, nothing but words ──────────────────── */
	.nav { background: rgb(245 245 247 / 0.86); border-bottom: 1px solid var(--color-border); }
	.nav-inner { display: flex; align-items: center; gap: 30px; flex-wrap: wrap; min-height: 46px; font-size: 13px; color: var(--color-surface-foreground); }
	.nav .mk { width: 15px; height: 18px; border-radius: 50% 50% 46% 46% / 62% 62% 38% 38%; background: var(--color-surface-foreground); flex: none; }
	.nav .links { display: none; gap: 30px; }
	@media (min-width: 780px) { .nav .links { display: flex; } }

	/* ── Hero: enormous type, enormous silence ───────────────────── */
	.hero { text-align: center; padding: 72px 0 24px; }
	@media (min-width: 768px) { .hero { padding: 104px 0 40px; } }
	.hero .eyebrow { color: var(--color-primary); font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
	.hero h1 { font-size: 46px; margin-top: 8px; }
	@media (min-width: 768px) { .hero h1 { font-size: 80px; } }
	.hero .sub { font-size: 21px; margin-top: 18px; color: var(--color-surface-foreground); }
	@media (min-width: 768px) { .hero .sub { font-size: 28px; } }
	.hero .links { display: flex; justify-content: center; gap: 26px; margin-top: 26px; font-size: 19px; }
	/* The quiet secondary: a blue text link with a chevron. */
	.textlink { color: var(--color-primary); display: inline-flex; align-items: center; gap: 5px; }
	.textlink::after { content: "›"; font-size: 19px; line-height: 1; }

	/* The product stage: a big soft object floating on the gray. */
	.stage { padding: 32px 0 88px; display: grid; place-items: center; }
	.device {
		width: min(430px, 84vw); aspect-ratio: 3/2;
		border-radius: var(--radius-2xl);
		background: linear-gradient(150deg, #ffffff 0%, #e9e9ec 55%, #d8d8dd 100%);
		box-shadow: var(--shadow-lg);
		display: grid; place-items: center; position: relative; overflow: hidden;
	}
	.device .screen {
		width: 74%; aspect-ratio: 16/10; border-radius: var(--radius-lg);
		background: linear-gradient(140deg, #1d1d1f, #3a3a3f);
		box-shadow: inset 0 0 0 3px rgb(255 255 255 / 0.5);
		display: grid; place-items: center; color: #f5f5f7; font-size: 15px; letter-spacing: -0.01em;
	}

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding: 64px 0; }
	@media (min-width: 768px) { .section { padding: 88px 0; } }
	.section + .section { border-top: 1px solid var(--color-border); }
	.section-label { font-size: 15px; font-weight: 600; color: var(--color-primary); margin-bottom: 12px; }
	.section h2 { font-size: 32px; }
	@media (min-width: 768px) { .section h2 { font-size: 44px; } }
	.lede { color: var(--color-muted); margin-top: 18px; max-width: 58ch; font-size: 19px; }
	.note { margin-top: 22px; font-size: 14px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }

	/* ── Cards: white, huge radius, image-led, lots of padding ───── */
	.cards { display: grid; grid-template-columns: 1fr; gap: 20px; margin-top: 36px; }
	@media (min-width: 700px) { .cards { grid-template-columns: repeat(2, 1fr); } }
	.card {
		background: var(--color-surface-raised); border-radius: var(--radius-2xl);
		padding: 30px; box-shadow: var(--shadow-sm);
		transition: box-shadow 260ms ease, transform 260ms ease;
	}
	.card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
	@media (min-width: 768px) { .card { padding: 38px; } }
	.card .art { height: 128px; border-radius: var(--radius-lg); margin-bottom: 24px; }
	.card h3 { font-size: 24px; }
	.card p { font-size: 16px; color: var(--color-muted); margin-top: 10px; line-height: 1.55; }
	.card .more { margin-top: 16px; font-size: 16px; }

	/* ── Controls: pills, segmented, toggles ─────────────────────── */
	.btn {
		font: inherit; font-size: 16px; font-weight: 400;
		height: 44px; padding: 0 24px;
		border: 1px solid transparent; border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 180ms ease;
	}
	.btn:hover { background: #0077ed; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgb(0 113 227 / 0.3); }
	.btn-secondary { background: transparent; color: var(--color-primary); border-color: var(--color-primary); }
	.btn-secondary:hover { background: rgb(0 113 227 / 0.06); }
	.btn-neutral { background: var(--color-surface-raised); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-neutral:hover { background: #fbfbfd; }
	.btn-danger { background: var(--color-danger); }
	.btn[disabled] { cursor: not-allowed; background: #e8e8ed; color: #aeaeb2; }

	.segmented { display: inline-flex; background: rgb(120 120 128 / 0.12); border-radius: 10px; padding: 2px; }
	.segmented span { padding: 7px 20px; border-radius: 8px; font-size: 15px; color: var(--color-surface-foreground); }
	.segmented .is-active { background: var(--color-surface-raised); box-shadow: 0 1px 3px rgb(0 0 0 / 0.1); font-weight: 500; }
	@media (max-width: 400px) { .segmented span { padding: 7px 11px; font-size: 14px; } }

	.switch { display: inline-flex; align-items: center; gap: 12px; font-size: 16px; }
	.track { width: 52px; height: 32px; border-radius: 9999px; background: var(--color-accent); padding: 2px; display: flex; justify-content: flex-end; }
	.track.off { background: rgb(120 120 128 / 0.32); justify-content: flex-start; }
	.knob { width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgb(0 0 0 / 0.15); }

	.input {
		font: inherit; font-size: 17px; width: 100%; max-width: 380px; height: 48px; padding: 0 16px;
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #aeaeb2; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 4px rgb(0 113 227 / 0.25); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 30px; }
	@media (min-width: 700px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 78px; border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
	.sw b { display: block; font-size: 15px; font-weight: 500; margin-top: 12px; }
	.sw span { font-size: 13px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 36px; margin-top: 36px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 286px 1fr; gap: 48px; } }
	.phone {
		width: 286px; max-width: 100%; margin: 0 auto;
		border-radius: 40px; padding: 8px; overflow: hidden;
		background: linear-gradient(150deg, #e6e6ea, #cfcfd6);
		box-shadow: var(--shadow-lg);
	}
	.phone-inner { background: var(--color-surface); border-radius: 33px; overflow: hidden; min-width: 0; }
	.phone-status { display: flex; justify-content: space-between; padding: 12px 20px 6px; font-size: 11px; font-weight: 600; }
	.phone-nav { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 4px 16px 10px; border-bottom: 1px solid var(--color-border); font-size: 11px; color: var(--color-muted); }
	.phone-body { padding: 24px 20px 18px; text-align: center; }
	.phone-body .eyebrow { color: var(--color-primary); font-size: 12px; font-weight: 600; }
	.phone-body h4 { font-size: 30px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; margin: 4px 0 8px; }
	.phone-body .sub { font-size: 14px; }
	.phone-body .links { display: flex; justify-content: center; gap: 16px; margin-top: 12px; font-size: 13px; }
	.m-device { width: 78%; aspect-ratio: 3/2; margin: 20px auto 0; border-radius: var(--radius-xl); background: linear-gradient(150deg, #fff, #dedee3); box-shadow: var(--shadow-md); }
	.m-card { background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); padding: 16px; margin: 14px 16px 0; text-align: left; }
	.m-card .art { height: 52px; border-radius: var(--radius-md); margin-bottom: 10px; }
	.m-card b { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
	.m-card p { font-size: 12px; color: var(--color-muted); margin-top: 4px; line-height: 1.45; }
	.m-tabs { display: flex; border-top: 1px solid var(--color-border); background: rgb(255 255 255 / 0.8); margin-top: 16px; }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 14px; }
	.m-tabs .is-active { color: var(--color-primary); }
	.m-tabs .g { display: block; width: 17px; height: 17px; border: 1.6px solid currentColor; border-radius: 6px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 16px 0; border-bottom: 1px solid var(--color-border); font-size: 16px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 3px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 30px; }
	@media (min-width: 700px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 4px; background: var(--color-surface-raised); border: 2px solid var(--color-surface-foreground); box-shadow: 4px 4px 0 var(--color-surface-foreground); font-size: 17px; font-weight: 800; }
	.cmp-off small { display: block; font-weight: 400; font-size: 14px; color: var(--color-muted); margin-top: 10px; line-height: 1.55; }
	.cmp-on { padding: 30px; border-radius: var(--radius-2xl); background: var(--color-surface-raised); box-shadow: var(--shadow-sm); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
	.cmp-on small { display: block; font-weight: 400; font-size: 14px; color: var(--color-muted); margin-top: 10px; line-height: 1.55; }

	footer { border-top: 1px solid var(--color-border); padding: 26px 0 56px; font-size: 12px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — the showcase page. Enormous type, one blue link, and a machined
     white object floating in a great deal of quiet. -->
<nav class="nav">
	<div class="wrap nav-inner">
		<span class="mk"></span>
		<span class="links"><span>Store</span><span>Design</span><span>System</span><span>Tokens</span><span>Support</span></span>
		<span class="spacer"></span>
		<span>⌕</span><span>▤</span>
	</div>
</nav>

<div class="wrap">
	<header class="hero">
		<p class="eyebrow">Vetta Design System</p>
		<h1>Silence, machined.</h1>
		<p class="sub">Enormous type. One blue. Curves that never break.</p>
		<div class="links">
			<a class="textlink" href="#">Learn more</a>
			<a class="textlink" href="#">Browse components</a>
		</div>
	</header>

	<div class="stage">
		<div class="device">
			<div class="screen">32px corners · one accent</div>
		</div>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Scale</p>
		<h2>Size does the hierarchy</h2>
		<p class="lede">Display headings run 44–80px, section titles 24–32px, body 17px. Weight barely
			moves — everything sits between 400 and 600 — because contrast comes from size and space, not
			from bolding things until they shout.</p>
		<div class="cards">
			<div class="card">
				<div class="art" style="background: linear-gradient(140deg, #f5f5f7, #dfdfe4)"></div>
				<h3>Curves that never break</h3>
				<p>Cards take 32px corners, controls curve fully into pills, and nothing in the system has a
					corner sharper than 8px.</p>
				<div class="more"><a class="textlink" href="#">See the radius scale</a></div>
			</div>
			<div class="card">
				<div class="art" style="background: linear-gradient(140deg, #eaf3fd, #cfe4fb)"></div>
				<h3>Depth you can barely see</h3>
				<p>Shadows are wide, soft and almost transparent. Borders appear only where two surfaces
					genuinely touch.</p>
				<div class="more"><a class="textlink" href="#">See the elevation scale</a></div>
			</div>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Controls</p>
		<h2>Pills, segments, switches</h2>
		<p class="lede">A filled blue pill is the single call to action on a view. Everything else is a
			blue text link with a chevron — the quiet secondary that carries most of the navigation.</p>
		<div class="row" style="margin-top: 30px;">
			<button class="btn">Buy</button>
			<button class="btn btn-secondary">Compare</button>
			<button class="btn btn-neutral">Learn more</button>
			<button class="btn" disabled>Sold out</button>
			<a class="textlink" href="#">Or watch the film</a>
		</div>
		<div class="row" style="margin-top: 26px; gap: 32px;">
			<span class="segmented"><span class="is-active">Overview</span><span>Specs</span><span>Compare</span></span>
			<span class="switch"><span class="track"><span class="knob"></span></span>Auto sync</span>
			<span class="switch"><span class="track off"><span class="knob"></span></span>Beta features</span>
		</div>
		<div class="row" style="margin-top: 26px;">
			<input class="input" placeholder="Search the system">
		</div>
		<p class="note">Segmented controls replace tabs and switches replace checkboxes. Both keep the interface reading as a set of physical objects rather than a form.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#f5f5f7 · the stage</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#ffffff · cards</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#0071e3 · one CTA</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#34c759 · success only</span></div>
		</div>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>The same air, at a smaller radius</h2>
		<p class="lede">Nothing about the language changes on a phone. Type steps down, cards go to one
			column, and the radii ease slightly so a 32px corner does not swallow a 300px card — the
			proportion between the box and its corner is what has to stay constant.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-inner">
					<div class="phone-status"><span>9:41</span><span>▮▮ ▮</span></div>
					<div class="phone-nav"><span></span>Vetta<span class="spacer"></span><span>⌕ ▤</span></div>
					<div class="phone-body">
						<p class="eyebrow">Vetta Design System</p>
						<h4>Silence, machined.</h4>
						<p class="sub muted">One blue. Curves that never break.</p>
						<div class="links"><a class="textlink" href="#">Learn more</a><a class="textlink" href="#">Buy</a></div>
						<div class="m-device"></div>
					</div>
					<div class="m-card">
						<div class="art" style="background:linear-gradient(140deg,#f5f5f7,#dfdfe4)"></div>
						<b>Curves that never break</b>
						<p>32px corners on desktop, 24px here — the ratio is what stays fixed.</p>
					</div>
					<div class="m-tabs">
						<div class="is-active"><span class="g"></span>Store</div>
						<div><span class="g"></span>Design</div>
						<div><span class="g"></span>Search</div>
						<div><span class="g"></span>Bag</div>
					</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Type</b>Hero 80px → 46px → 30px, section titles 44px → 32px, body stays 17px with the same relaxed leading. Weight never rises above 600 to compensate.</li>
				<li><b>Radius</b>Cards ease 32px → 24px and inner art 18px → 12px. A corner has to stay proportional to its box; keeping 32px on a narrow card makes it look inflated.</li>
				<li><b>Grid</b>Two- and three-column card grids become one column at 20px gaps. Section spacing 88px → 64px — still the most generous thing on the screen.</li>
				<li><b>Edges</b>Nothing touches the edge. Page padding never drops below 20px, even at 320px wide.</li>
				<li><b>The quiet secondary</b>Blue text links with chevrons stay exactly as they are. They are already touch-friendly at 19px and they keep the screen free of button clutter.</li>
				<li><b>Segmented controls</b>Stay segmented rather than becoming a dropdown, as long as there are three options or fewer. Four or more moves to a sheet.</li>
				<li><b>Depth</b>Shadow tokens are unchanged. The diffuse, nearly invisible elevation is a signature, and hardening it for small screens is the most common way this language gets lost.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the machining</h2>
		<div class="compare">
			<div class="cmp-off">Hard edges, hard shadow
				<small>4px corners · 2px black border · an offset shadow with no blur · weight 800. Every one of those is a deliberate rejection of this system's softness.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>32px radius, white card, no border, a wide shadow at 4% opacity, weight 600. If you can point at the shadow's edge, it is wrong.</small></div>
		</div>
		<p class="note">Also out: dense tables, cramped rows, a second accent hue in one view, and gradients anywhere except product artwork.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — apple · one blue, and a great deal of quiet.</div></footer>
</body>
</html>
`;

const Discord_THEME = `/* Discord — cozy dark clubhouse, blurple energy. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #5865f2;
	--color-primary-foreground: #ffffff;
	--color-surface: #313338;
	--color-surface-foreground: #f2f3f5;
	--color-surface-raised: #2b2d31;
	--color-muted: #949ba4;
	--color-accent: #23a559;
	--color-danger: #f23f43;
	--color-border: #3f4147;

	--radius-sm: 4px;
	--radius-md: 8px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.3);
	--shadow-md: 0 4px 12px rgb(0 0 0 / 0.4);
	--shadow-lg: 0 12px 36px rgb(0 0 0 / 0.55);
}
`;

const Discord_SPEC = `# Discord

## Atmosphere
A cozy dark clubhouse. Soft charcoal layers (never pure black), blurple
energy, rounded friendly shapes. Gaming DNA: playful, badge-covered, alive.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- Three-layer depth: darkest rail (\`surface-raised\` darkened — use \`black/20\`
  overlays), \`surface-raised\` sidebar, \`surface\` content.
- \`primary\` blurple for CTAs, active items, mentions, brand moments.
- \`accent\` green strictly for online/voice-connected states.
- \`danger\` for pings and destructive; text \`surface-foreground\`, secondary
  \`muted\`.

## Typography
System font stack only:
- Headings \`font-bold\` 16–20px; channel names 15px \`font-medium\`.
- Messages 15px \`leading-relaxed\`; usernames \`font-medium\` and may take
  role colors (\`primary\`/\`accent\`).
- Tiny labels 11–12px \`font-semibold uppercase tracking-wide text-muted\`
  (category headers).

## Shape & depth
- Everything softly rounded: \`rounded-lg\` (8px) panels, \`rounded-full\`
  avatars, pill badges.
- Layer color does the depth; \`shadow-lg\` only for modals/popouts.

## Components
- Buttons: h-9–11 \`rounded-lg\`, filled blurple primary; secondary is a
  lighter charcoal fill (no borders).
- Message rows: hover \`black/10\` wash, floating reaction toolbar.
- Channel list: 32px rows in \`muted\`, active = white text on \`white/10\` pill.
- Badges: tiny \`rounded-full\` counters in \`danger\` with white 11px bold text;
  status dots (accent green / muted gray) on avatar corners.

## Layout
Rail (72px, circular server icons) + sidebar (240px) + chat + members (240px).
Compact rows, 8/12/16 spacing. The chat column is the hero.

## Don'ts
- Never pure black backgrounds or 1px gray hairline aesthetics — layers, not
  borders.
- Blurple never used for body text; green never decorative.
- No sharp corners anywhere; no thin/light font weights.
`;

const Discord_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #5865f2;
		--color-primary-foreground: #ffffff;
		--color-surface: #313338;
		--color-surface-foreground: #f2f3f5;
		--color-surface-raised: #2b2d31;
		--color-muted: #949ba4;
		--color-accent: #23a559;
		--color-danger: #f23f43;
		--color-border: #3f4147;

		--radius-sm: 4px;
		--radius-md: 8px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.3);
		--shadow-md: 0 4px 12px rgb(0 0 0 / 0.4);
		--shadow-lg: 0 12px 36px rgb(0 0 0 / 0.55);

		/* The third, darkest layer. Never pure black. */
		--layer-rail: #1e1f22;
		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 15px;
		line-height: 1.55;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 700; line-height: 1.25; }
	p { margin: 0; }
	::selection { background: rgb(88 101 242 / 0.45); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	/* ── Three layers of charcoal do all the structural work ──────── */
	.app { display: grid; grid-template-columns: 72px 1fr; }
	@media (min-width: 940px) { .app { grid-template-columns: 72px 240px 1fr 240px; } }

	.rail { background: var(--layer-rail); padding: 12px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
	.server {
		width: 48px; height: 48px; border-radius: 50%;
		display: grid; place-items: center; font-weight: 700; font-size: 15px;
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
		transition: border-radius 160ms ease, background-color 160ms ease;
		position: relative;
	}
	.server:hover { border-radius: var(--radius-xl); background: var(--color-primary); }
	.server.is-active { border-radius: var(--radius-xl); background: var(--color-primary); }
	/* The little white pill on the left edge marks where you are. */
	.server.is-active::before { content: ""; position: absolute; left: -12px; top: 12px; width: 4px; height: 24px; border-radius: 0 4px 4px 0; background: #fff; }
	.server .ping { position: absolute; right: -2px; bottom: -2px; background: var(--color-danger); color: #fff; font-size: 11px; font-weight: 700; border-radius: 9999px; padding: 0 5px; border: 3px solid var(--layer-rail); }
	.rail .sep { width: 32px; height: 2px; border-radius: 1px; background: var(--color-border); margin: 4px 0; }
	.server.add { color: var(--color-accent); font-size: 20px; }

	.chanlist { background: var(--color-surface-raised); display: none; flex-direction: column; }
	@media (min-width: 940px) { .chanlist { display: flex; } }
	.guild-head { display: flex; align-items: center; padding: 14px 16px; box-shadow: var(--shadow-sm); font-weight: 700; font-size: 16px; }
	.cat { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted); padding: 16px 10px 4px; }
	.chan { display: flex; align-items: center; gap: 6px; height: 32px; margin: 0 8px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--color-muted); font-size: 15px; }
	.chan .h { font-size: 17px; opacity: 0.65; }
	.chan:hover { background: rgb(255 255 255 / 0.04); color: #dbdee1; }
	.chan.is-active { background: rgb(255 255 255 / 0.1); color: #fff; font-weight: 500; }
	.chan.unread { color: #fff; font-weight: 500; }
	.chan .badge { margin-left: auto; background: var(--color-danger); color: #fff; font-size: 11px; font-weight: 700; border-radius: 9999px; padding: 0 6px; }
	.voice-user { display: flex; align-items: center; gap: 8px; margin: 2px 8px 0 26px; font-size: 14px; color: var(--color-muted); }
	.voice-user .av { width: 22px; height: 22px; border-radius: 50%; }
	.userbar { margin-top: auto; background: #232428; padding: 8px 10px; display: flex; align-items: center; gap: 8px; }
	.userbar .av { width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary); position: relative; flex: none; }
	.userbar .av::after { content: ""; position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; background: var(--color-accent); border: 3px solid #232428; }
	.userbar b { display: block; font-size: 14px; font-weight: 600; }
	.userbar span { font-size: 12px; color: var(--color-muted); }

	.chat { display: flex; flex-direction: column; min-width: 0; }
	.chat-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 13px 16px; box-shadow: var(--shadow-sm); font-size: 16px; font-weight: 700; }
	.chat-head .hash { color: var(--color-muted); font-weight: 400; font-size: 19px; }
	.chat-head .topic { font-size: 13px; color: var(--color-muted); font-weight: 400; border-left: 1px solid var(--color-border); padding-left: 10px; display: none; }
	@media (min-width: 700px) { .chat-head .topic { display: block; } }

	.msgs { padding: 16px 16px 8px; }
	.msg { display: flex; gap: 14px; padding: 4px 8px; margin: 0 -8px; border-radius: var(--radius-sm); position: relative; }
	.msg:hover { background: rgb(0 0 0 / 0.1); }
	.msg + .msg { margin-top: 14px; }
	.av { width: 40px; height: 40px; border-radius: 50%; flex: none; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; }
	.msg .head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
	.msg .who { font-size: 15px; font-weight: 500; }
	.msg .who.role-blurple { color: #949cf7; }
	.msg .who.role-green { color: #4ec27f; }
	.msg .when { font-size: 12px; color: var(--color-muted); }
	.tag { background: var(--color-primary); color: #fff; font-size: 10px; font-weight: 600; border-radius: var(--radius-sm); padding: 1px 4px; text-transform: uppercase; letter-spacing: 0.02em; }
	.msg .txt { font-size: 15px; }
	.mention { background: rgb(88 101 242 / 0.3); color: #dee0fc; border-radius: var(--radius-sm); padding: 0 2px; font-weight: 500; }
	.reacts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
	.react { display: inline-flex; align-items: center; gap: 5px; background: rgb(255 255 255 / 0.06); border-radius: var(--radius-md); padding: 2px 8px; font-size: 13px; font-weight: 600; color: var(--color-muted); }
	.react.is-mine { background: rgb(88 101 242 / 0.18); box-shadow: inset 0 0 0 1px var(--color-primary); color: #c9cdfb; }
	/* Floating toolbar on hover — the only shadowed thing in the chat column. */
	.msgtools { position: absolute; right: 12px; top: -14px; display: flex; gap: 2px; background: var(--color-surface-raised); border-radius: var(--radius-md); box-shadow: var(--shadow-md); padding: 3px; }
	.msgtools span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); font-size: 13px; color: var(--color-muted); }

	.embed { border-left: 4px solid var(--color-primary); background: var(--color-surface-raised); border-radius: var(--radius-sm); padding: 12px 14px; margin-top: 8px; max-width: 460px; }
	.embed b { display: block; font-size: 15px; color: #dee0fc; }
	.embed p { font-size: 14px; color: #dbdee1; margin-top: 4px; }

	.composer { margin: 8px 16px 20px; background: #383a40; border-radius: var(--radius-md); padding: 11px 14px; display: flex; align-items: center; gap: 12px; color: var(--color-muted); }
	.composer .plus { width: 22px; height: 22px; border-radius: 50%; background: var(--color-muted); color: #383a40; display: grid; place-items: center; font-size: 14px; font-weight: 700; flex: none; }

	.members { background: var(--color-surface-raised); padding: 16px 8px; display: none; }
	@media (min-width: 940px) { .members { display: block; } }
	.m-cat { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted); padding: 12px 8px 6px; }
	.member { display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 8px; border-radius: var(--radius-sm); font-size: 15px; }
	.member:hover { background: rgb(255 255 255 / 0.04); }
	.member .av { width: 32px; height: 32px; font-size: 12px; position: relative; }
	.member .av .st { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 50%; border: 3px solid var(--color-surface-raised); background: var(--color-muted); }
	.member .av .st.online { background: var(--color-accent); }
	.member .av .st.dnd { background: var(--color-danger); }
	.member.offline { opacity: 0.4; }

	/* ── Reference sections ───────────────────────────────────────── */
	.wrap { max-width: 1000px; margin: 0 auto; padding: 0 20px 90px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 112px; } }
	.section { padding-top: 52px; }
	.section-label { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #949cf7; margin-bottom: 8px; }
	.section h2 { font-size: 24px; }
	@media (min-width: 768px) { .section h2 { font-size: 30px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; }
	.note { margin-top: 18px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Buttons: filled charcoal or blurple, never bordered ─────── */
	.btn {
		font: inherit; font-size: 14px; font-weight: 600;
		height: 40px; padding: 0 18px;
		border: 0; border-radius: var(--radius-sm);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 140ms ease;
	}
	.btn:hover { background: #4752c4; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(88 101 242 / 0.45); }
	.btn-secondary { background: #4e5058; }
	.btn-secondary:hover { background: #6d6f78; }
	.btn-success { background: var(--color-accent); }
	.btn-success:hover { background: #1e8f4e; }
	.btn-danger { background: var(--color-danger); }
	.btn-danger:hover { background: #da373c; }
	.btn-link { background: transparent; color: #00a8fc; padding: 0 8px; }
	.btn-link:hover { background: transparent; text-decoration: underline; }
	.btn[disabled] { cursor: not-allowed; background: #4e5058; opacity: 0.5; }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 360px; height: 42px; padding: 0 12px;
		border: 1px solid #1e1f22; border-radius: var(--radius-sm);
		background: #1e1f22; color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #87898c; }
	.input:focus { outline: none; border-color: var(--color-primary); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 60px; border-radius: var(--radius-md); }
	.sw b { display: block; font-size: 13px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 26px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 288px 1fr; gap: 42px; } }
	.phone {
		width: 288px; max-width: 100%; margin: 0 auto;
		border-radius: 26px; overflow: hidden; background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 10px 16px 4px; font-size: 10px; color: var(--color-muted); background: var(--color-surface-raised); }
	.phone-head { display: flex; align-items: center; gap: 8px; background: var(--color-surface-raised); padding: 4px 12px 12px; font-size: 14px; font-weight: 700; }
	.phone-head .srv { width: 24px; height: 24px; border-radius: var(--radius-md); background: var(--color-primary); display: grid; place-items: center; font-size: 10px; }
	.phone-msgs { padding: 12px 12px 4px; }
	.phone-msgs .msg + .msg { margin-top: 10px; }
	.phone-msgs .av { width: 32px; height: 32px; font-size: 11px; }
	.phone-msgs .txt { font-size: 13px; }
	.phone-msgs .who { font-size: 13px; }
	.m-composer { margin: 6px 12px 10px; background: #383a40; border-radius: var(--radius-md); padding: 9px 12px; font-size: 12px; color: var(--color-muted); display: flex; gap: 10px; align-items: center; }
	.m-tabs { display: flex; background: var(--color-surface-raised); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 13px; position: relative; }
	.m-tabs .is-active { color: #fff; font-weight: 600; }
	.m-tabs .g { display: block; width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 50%; margin: 0 auto 4px; }
	.m-tabs .n { position: absolute; top: 4px; right: 20px; background: var(--color-danger); color: #fff; font-size: 9px; font-weight: 700; border-radius: 9999px; padding: 0 5px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 13px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 15px; font-weight: 700; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 22px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 0; background: #000; border: 1px solid #555; font-size: 15px; font-weight: 400; color: #cfcfcf; }
	.cmp-off small { display: block; font-size: 13px; color: #8a8a8a; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-md); background: var(--color-surface-raised); font-size: 15px; font-weight: 700; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the clubhouse. Three charcoal layers, round everything, blurple
     for energy and green strictly for "online". -->
<div class="app">
	<nav class="rail">
		<span class="server is-active">V</span>
		<span class="sep"></span>
		<span class="server" style="background:#c94f7a">DS</span>
		<span class="server" style="background:#3f6fd8">PL<span class="ping">3</span></span>
		<span class="server" style="background:#d99a3c">GM</span>
		<span class="server" style="background:#4e9e6b">RD</span>
		<span class="server add">＋</span>
	</nav>

	<aside class="chanlist">
		<div class="guild-head">Vetta Design <span class="spacer"></span><span class="muted" style="font-weight:400">⌄</span></div>
		<div class="cat">▾ Text channels</div>
		<div class="chan is-active"><span class="h">#</span>design-system</div>
		<div class="chan unread"><span class="h">#</span>releases<span class="badge">3</span></div>
		<div class="chan"><span class="h">#</span>screenshots</div>
		<div class="chan"><span class="h">#</span>off-topic</div>
		<div class="cat">▾ Voice channels</div>
		<div class="chan"><span class="h">◊</span>Design jam</div>
		<div class="voice-user"><span class="av" style="background:#c94f7a"></span>Ana</div>
		<div class="voice-user"><span class="av" style="background:#4e9e6b"></span>Jun</div>
		<div class="chan"><span class="h">◊</span>Focus room</div>
		<div class="userbar">
			<span class="av"></span>
			<span><b>kaori</b><span>#0421</span></span>
			<span class="spacer"></span>
			<span class="muted" style="font-size:13px">⚙</span>
		</div>
	</aside>

	<main class="chat">
		<div class="chat-head">
			<span class="hash">#</span>design-system
			<span class="topic">Tokens, components, and strong opinions about corner radius</span>
			<span class="spacer"></span>
			<span class="muted" style="font-size:14px">⌕ ⌸ ⓘ</span>
		</div>

		<div class="msgs">
			<div class="msg">
				<span class="av" style="background:#c94f7a">A</span>
				<div>
					<div class="head"><span class="who role-blurple">ana</span><span class="when">Today at 9:41</span></div>
					<div class="txt">Radius audit is done — every component pulls from the scale now.
						<span class="mention">@jun</span> the table was the last holdout.</div>
					<div class="reacts"><span class="react is-mine">✅ 4</span><span class="react">🎉 2</span></div>
				</div>
			</div>

			<div class="msg">
				<span class="av" style="background:#4e9e6b">J</span>
				<div>
					<div class="head"><span class="who role-green">jun</span><span class="tag">Bot</span><span class="when">Today at 9:52</span></div>
					<div class="txt">Nice. Reminder for anyone theming this server:</div>
					<div class="embed">
						<b>Layers, not borders</b>
						<p>Depth comes from three charcoal steps — rail #1e1f22, sidebar #2b2d31, content #313338.
							A 1px gray hairline anywhere in here reads as a different app.</p>
					</div>
					<div class="reacts"><span class="react">👀 1</span><span class="react">🔥 5</span></div>
				</div>
				<div class="msgtools"><span>😀</span><span>💬</span><span>⇪</span><span>⋯</span></div>
			</div>

			<div class="msg">
				<span class="av" style="background:#d99a3c">M</span>
				<div>
					<div class="head"><span class="who">mo</span><span class="when">Today at 10:04</span></div>
					<div class="txt">Ship it. I'll take the changelog.</div>
					<div class="reacts"><span class="react">🙌 3</span></div>
				</div>
			</div>
		</div>

		<div class="composer"><span class="plus">＋</span>Message #design-system<span class="spacer"></span><span>🎁 GIF 😀</span></div>
	</main>

	<aside class="members">
		<div class="m-cat">Online — 3</div>
		<div class="member"><span class="av" style="background:#c94f7a">A<span class="st online"></span></span><span class="role-blurple" style="color:#949cf7">ana</span></div>
		<div class="member"><span class="av" style="background:#4e9e6b">J<span class="st online"></span></span><span style="color:#4ec27f">jun</span></div>
		<div class="member"><span class="av" style="background:#d99a3c">M<span class="st dnd"></span></span>mo</div>
		<div class="m-cat">Offline — 2</div>
		<div class="member offline"><span class="av" style="background:#5865f2">K<span class="st"></span></span>kaori</div>
		<div class="member offline"><span class="av" style="background:#7a5ad9">R<span class="st"></span></span>rin</div>
	</aside>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Layers</p>
		<h2>Three charcoals, zero hairlines</h2>
		<p class="lede">The rail is the darkest, the sidebar sits one step up, and the chat column is the
			lightest. That ordering is the entire depth system — there are no 1px gray dividers anywhere,
			and there is no pure black.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--layer-rail)"></div><b>rail</b><span>#1e1f22 · deepest</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#2b2d31 · sidebars</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#313338 · the chat</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#5865f2 · blurple</span></div>
		</div>
		<p class="note">Hover is a black/10 wash, active is a white/10 pill. Both are overlays on the layer beneath — never a new fill color.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Shapes &amp; states</p>
		<h2>Nothing has a sharp corner</h2>
		<p class="lede">Avatars are circles, panels are 8px, badges are pills, and the server icon
			morphs from circle to squircle when it becomes active. Green appears only on a status dot or a
			voice-connected state; red is only a ping or a destructive action.</p>
		<div class="row" style="margin-top: 22px;">
			<button class="btn">Join voice</button>
			<button class="btn btn-secondary">Cancel</button>
			<button class="btn btn-success">Accept invite</button>
			<button class="btn btn-danger">Kick</button>
			<button class="btn btn-link">Learn more</button>
			<button class="btn" disabled>Connecting…</button>
		</div>
		<div class="row" style="margin-top: 16px;">
			<input class="input" placeholder="Search or jump to…">
			<span class="react is-mine">✅ 4</span><span class="react">🎉 2</span>
		</div>
		<p class="note">Secondary buttons are a lighter charcoal fill, never an outline. A bordered ghost button is the clearest sign someone brought a different design system into this one.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Four panes, one at a time</h2>
		<p class="lede">The rail, channel list, chat and member list each become their own screen. The
			layer order survives as a navigation order: swipe right for the darker panes, left for members.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-head"><span class="srv">V</span><span class="muted" style="font-weight:400">#</span>design-system<span class="spacer"></span><span class="muted" style="font-size:12px">⌕</span></div>
				<div class="phone-msgs">
					<div class="msg">
						<span class="av" style="background:#c94f7a">A</span>
						<div>
							<div class="head"><span class="who role-blurple">ana</span><span class="when">9:41</span></div>
							<div class="txt">Radius audit is done — everything pulls from the scale now.</div>
							<div class="reacts"><span class="react is-mine">✅ 4</span><span class="react">🎉 2</span></div>
						</div>
					</div>
					<div class="msg">
						<span class="av" style="background:#4e9e6b">J</span>
						<div>
							<div class="head"><span class="who role-green">jun</span><span class="tag">Bot</span></div>
							<div class="txt">Layers, not borders — three charcoal steps do all the work.</div>
						</div>
					</div>
				</div>
				<div class="m-composer"><span>＋</span>Message #design-system<span class="spacer"></span><span>😀</span></div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Servers</div>
					<div><span class="g"></span><span class="n">3</span>Messages</div>
					<div><span class="g"></span>Notifications</div>
					<div><span class="g"></span>You</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>&lt; 940px — panes</b>Channel list and member list slide away. A left swipe reveals the server rail plus channels on their darker layers; a right swipe reveals members. The chat column is always the destination.</li>
				<li><b>Layer order</b>Preserved as depth cues during the swipe: the pane sliding in is visibly darker, which is how the hierarchy stays legible without any borders.</li>
				<li><b>Message rows</b>Avatar 40px → 32px, text 15px → 13px, group spacing 14px → 10px. Messages stay left-aligned rows with the name above — they never become chat bubbles.</li>
				<li><b>Hover toolbar</b>Becomes a long-press sheet with the same four actions. Reaction chips stay tappable at 24px minimum height with their blurple selected ring intact.</li>
				<li><b>Composer</b>Docks above the keyboard, keeps the #383a40 fill and the circular plus button. Attachment, GIF and emoji shortcuts stay in the same order.</li>
				<li><b>Pings</b>Red counters move from the rail and channel rows onto the bottom tab bar, at the same 11px bold in a pill.</li>
				<li><b>Round everything</b>Nothing squares off for mobile. Server icons stay circular until active, avatars stay circular, panels stay at 8px.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the clubhouse</h2>
		<div class="compare">
			<div class="cmp-off">Pure black with hairlines
				<small>#000 fill · 1px gray border · square corners · light font weight. This is the exact opposite of the system: cold, flat and sharp instead of layered and soft.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>#2b2d31 fill one step up from the page, 8px radius, no border at all, weight 700. Layers make the depth; roundness makes the warmth.</small></div>
		</div>
		<p class="note">Also out: blurple as body text, green used decoratively, thin or light font weights, and any sharp corner.</p>
	</section>
</div>

</body>
</html>
`;

const Claymorphism_THEME = `/* Claymorphism — UI moulded out of soft modelling clay. Candy pastels on warm
   cream, oversized radii, and a zero-blur offset drop paired with an inset white
   top highlight: that pair is the whole material.
   Palette and shadow recipe adapted from the StyleKit「粘土拟态」guide and its
   showcase page (see meta.json origin). */
@theme static {
	--color-primary: #f8b4d9;
	/* Ink on clay is a dark neutral, never white — every pastel here is light
	   enough that white text lands under 2:1. */
	--color-primary-foreground: #1f2937;
	--color-surface: #fffbeb;
	--color-surface-foreground: #1f2937;
	--color-surface-raised: #ffffff;
	/* Warm gray. Cool, desaturated neutrals read as dirt against these pastels. */
	--color-muted: #78716c;
	--color-accent: #c4b5fd;
	--color-danger: #f9a8c0;
	/* Barely-there warm line. Structure comes from the shadow pair, not borders. */
	--color-border: #f5e6d8;

	/* The candy palette: five tints, each with the ink that stays legible on it.
	   Use them as whole surfaces — a card, a pill, a blob — never as text color. */
	--color-clay-pink: #f8b4d9;
	--color-clay-mint: #a7f3d0;
	--color-clay-lavender: #c4b5fd;
	--color-clay-yellow: #fcd34d;
	--color-clay-cream: #fef3c7;

	--color-clay-pink-foreground: #7c2d62;
	--color-clay-mint-foreground: #115e52;
	--color-clay-lavender-foreground: #4c3a8c;
	--color-clay-yellow-foreground: #92400e;
	--color-clay-cream-foreground: #92400e;

	/* Nothing under 16px. The scale starts where other systems stop. */
	--radius-sm: 16px;
	--radius-md: 20px;
	--radius-lg: 24px;
	--radius-xl: 28px;
	--radius-2xl: 32px;
	--radius-full: 9999px;

	/* Every shadow is a pair: a hard offset drop with ZERO blur for the extruded
	   clay edge, plus an inset white highlight along the top for the moulded
	   sheen. Drop either half and the material collapses into a flat rectangle. */
	--shadow-sm: 4px 4px 0 rgb(0 0 0 / 0.08), inset 0 1px 3px rgb(255 255 255 / 0.6);
	--shadow-md: 8px 8px 0 rgb(0 0 0 / 0.13), inset 0 2px 4px rgb(255 255 255 / 0.6);
	--shadow-lg: 12px 12px 0 rgb(0 0 0 / 0.18), inset 0 3px 6px rgb(255 255 255 / 0.7);
	/* Hover pushes the drop further out — the piece lifts off the page. */
	--shadow-hover: 12px 12px 0 rgb(0 0 0 / 0.15), inset 0 2px 4px rgb(255 255 255 / 0.6);
	/* Active pulls it back in, so the press reads as the piece being squashed. */
	--shadow-active: 4px 4px 0 rgb(0 0 0 / 0.1), inset 0 2px 4px rgb(255 255 255 / 0.5);
	/* The one blurred shadow: a colored bloom for hero pieces that should float. */
	--shadow-bloom: 0 16px 40px rgb(248 180 217 / 0.55), inset 0 2px 5px rgb(255 255 255 / 0.65);
	--shadow-focus-ring: 0 0 0 4px rgb(196 181 253 / 0.55);

	/* Gradients are part of the material: clay is never one flat fill. */
	--gradient-page: linear-gradient(135deg, #fef3c7 0%, #fce7f3 50%, #ede9fe 100%);
	--gradient-primary: linear-gradient(135deg, #fce7f3 0%, #f8b4d9 100%);
	--gradient-mint: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
	/* All five tints at once — hero surfaces only, once per screen. */
	--gradient-rainbow: linear-gradient(135deg, #f8b4d9 0%, #c4b5fd 40%, #a7f3d0 70%, #fcd34d 100%);

	/* Background blobs are lumps of clay, not circles: asymmetric radii. */
	--blob-radius: 60% 40% 55% 45% / 40% 60% 40% 60%;
	--blob-radius-alt: 45% 55% 40% 60% / 55% 45% 55% 45%;

	/* Squash and release. The overshoot past 1 is what reads as springy. */
	--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
	--duration-base: 200ms;
}
`;

const Claymorphism_SPEC = `# Claymorphism

## Atmosphere
Every surface looks moulded out of soft modelling clay: fat rounded corners, a
candy pastel fill, a white sheen along the top edge, and a hard offset drop
beneath that reads as extruded thickness rather than a cast shadow. The page
sits on warm cream with lumps of pastel clay drifting behind the content.
Nothing is sharp, nothing is gray, nothing is flat — and when pressed, pieces
squash and spring back.

Fits kids' products, learning apps, wellness and habit trackers, playful
onboarding, and consumer products that want to feel handmade and harmless. It is
a poor fit for dense dashboards, financial data, or anything that needs to look
authoritative.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is warm cream. Backgrounds stay warm: cream, pale amber, very light
  pastel. A white, gray, or dark page kills the style outright.
- \`surface-raised\` is white, usually set at partial opacity over the cream so
  the page warmth still shows through.
- \`primary\` is clay pink, the default action color.
- \`primary-foreground\` is a dark neutral ink. Every tint in this palette is
  light, so white text on clay lands near 2:1 — ink is always dark here.
- \`muted\` is a *warm* gray for secondary text. Cool, desaturated neutrals read
  as dirt against these pastels.
- \`accent\` is lavender: secondary actions, selected state, informational tags.
- \`danger\` is a soft rose, not an alarm red. It signals through its dark ink and
  its label, never through saturation.
- \`clay-pink\` / \`clay-mint\` / \`clay-lavender\` / \`clay-yellow\` / \`clay-cream\` are
  the five candy tints, each with a paired \`-foreground\` ink tuned to its hue —
  plum on pink, deep green on mint, indigo on lavender, amber-brown on yellow
  and cream. Pair them only as matched sets.
- \`gradient-page\` (cream → pink → lavender) and \`gradient-rainbow\` (all five
  tints) are for hero surfaces; spend the rainbow once per screen at most.
- \`border\` is a barely-there warm line. Depth is the shadow pair's job — a
  visible border competes with the highlight and flattens the piece.
- Two or three tints per screen. All five at once reads as a color test.

## Typography
- A geometric sans with open, rounded letterforms throughout, and it must carry
  a real 900 cut. There is no monospace and no condensed face in this system,
  not even for code labels or numerals.
- Display and headings are \`font-black\` (900); subheads \`font-bold\`; body
  \`font-medium\`. A light or regular weight looks brittle against fat shapes.
- Heading ink is the dark neutral, body one step lighter, captions \`muted\`.
  Colored headings appear only as a gradient-filled accent word in a hero.
- Scale: hero 48/72, H1 36/48, H2 30/36, H3 20/24, body 16, small 14, caption 12.
- Line height is generous — 1.6 for body — so text feels as soft as the
  containers holding it. Measure stays at 65–75 characters.
- No uppercase headlines and no tight negative tracking; letterforms stay wide
  and open.

## Spacing & layout
- Padding is deliberately generous: clay pieces need room or their offset drops
  collide and depth turns into mud. Card padding 24 → 32.
- Section rhythm 64 → 96 vertical; container padding 24 → 32.
- Gaps come in three steps: 16, 24, 32. Never below 16 — adjacent drops must not
  overlap, and the drop needs clearance on the right and bottom.
- Layouts are loose and centered; content sits in a container with wide margins,
  and nothing runs edge-to-edge.
- Background blobs are lumps, not circles: asymmetric radii (\`blob-radius\`),
  low-saturation tints, scattered behind content and never behind small text.
- Touch targets stay at 44px minimum, which the fat radii already encourage.

## Components
- **Radius:** the scale starts at 16px; \`radius-lg\` (24px) is the default clay
  corner, \`radius-2xl\` (32px) for large cards, \`radius-full\` for buttons, pills,
  avatars and icon holders. There is no small-radius option — a 4px corner is
  off-style, and 0 is forbidden.
- **Shadows:** each piece uses a pair — a zero-blur offset drop plus an inset
  white top highlight. \`shadow-sm\` for small pieces, \`shadow-md\` for buttons and
  controls, \`shadow-lg\` for cards and hero pieces. \`shadow-bloom\` is the only
  blurred option, a colored halo reserved for a floating hero element.
- **Buttons:** pastel fill (flat tint or \`gradient-primary\`), \`radius-full\`,
  bold dark ink, \`shadow-md\`. Hover swaps to \`shadow-hover\` and scales to 1.04;
  active drops to \`shadow-active\` and scales to 0.97 — the drop shrinking under
  the press is what sells the squash. Secondary buttons are the same shape in
  \`clay-mint\` or \`clay-lavender\`; a quiet button is \`clay-cream\` with
  \`shadow-sm\`. There is no bare text link button.
- **Cards:** white at partial opacity or a single clay tint, 24–32px radius,
  \`shadow-lg\`, no border. A thin white bar inset near the top edge reinforces
  the moulded sheen.
- **Inputs:** cream field, \`radius-xl\`, and a highlight-only inner shine so the
  field reads as pressed *into* the page while everything else sits on top of
  it. Focus adds \`shadow-focus-ring\` and never removes the outline without
  replacing it.
- **Overlays:** dialogs are clay cards on a warm blurred scrim; they keep
  \`shadow-lg\` and their radius rather than growing a border.
- **Badges, tags, tabs:** \`radius-full\` pills in a clay tint with \`shadow-sm\`;
  a tab group is one pill-shaped clay track with the active tab raised inside it.
- **Toggles, sliders, progress:** the track is a recessed clay groove, the thumb
  or fill a raised piece — the same in/out language as inputs.
- **States:** cover default, hover, keyboard focus, active, disabled, loading,
  empty, error and success. Disabled loses its offset drop and keeps a faint
  highlight, so it reads as pressed flat rather than merely faded.

## Motion
- Everything springs: \`duration-base\` (200ms) with \`ease-spring\`, whose
  overshoot past 1 is what makes movement read as elastic rather than mechanical.
- Hover scales to ~1.04 and pushes the drop out; active scales to ~0.97 and
  pulls it in. Squash on press, stretch on release — that deformation is the
  signature of the style.
- Entrances scale up from ~0.95 with the same spring. No fades from zero
  opacity, no cross-screen slides, no parallax.
- Under \`prefers-reduced-motion\` drop the scale steps and keep the shadow and
  color change, so state stays legible.

## Accessibility
- Every tint is light, so contrast lives entirely in the \`-foreground\` inks.
  Pair \`clay-mint\` with \`clay-mint-foreground\`, never with white.
- Dark neutral ink on cream is roughly 14:1 and is the reading pair for long
  text; \`muted\` on cream clears 4.5:1 for secondary text only.
- Never set small text on \`gradient-rainbow\` or across a gradient seam — move it
  onto a solid tint or \`surface-raised\`.
- Depth is decorative, so state must never be carried by shadow alone; pair it
  with a color, icon, or text change.
- The focus ring is the keyboard affordance; a component that suppresses it owes
  an equally visible substitute.

## Don't
- No sharp or small corners: nothing below 16px, and never 0.
- No \`shadow: none\` on an interactive piece — a flat clay button is not clay.
- No dark, moody, or high-contrast backgrounds, and no dark-mode inversion of
  this palette. The material only works in light and warm.
- No harsh drop shadows: the offset drop stays under ~0.2 alpha, and blurred
  shadows are limited to the colored bloom.
- No cool grays or desaturated neutrals anywhere, as fill or as text.
- No monospace or condensed typefaces, and no light or regular weights.
- No neon, electric, or fully saturated colors mixed into the pastels.
- No dense layouts where offset drops overlap, and no zero-gap grids.
- No pure black or white text on a clay tint.
- No linear or abrupt easing — motion without spring reads as broken here.
`;

const Claymorphism_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claymorphism — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #f8b4d9;
		--color-primary-foreground: #1f2937;
		--color-surface: #fffbeb;
		--color-surface-foreground: #1f2937;
		--color-surface-raised: #ffffff;
		--color-muted: #78716c;
		--color-accent: #c4b5fd;
		--color-danger: #f9a8c0;
		--color-border: #f5e6d8;

		--color-clay-pink: #f8b4d9;
		--color-clay-mint: #a7f3d0;
		--color-clay-lavender: #c4b5fd;
		--color-clay-yellow: #fcd34d;
		--color-clay-cream: #fef3c7;

		--color-clay-pink-foreground: #7c2d62;
		--color-clay-mint-foreground: #115e52;
		--color-clay-lavender-foreground: #4c3a8c;
		--color-clay-yellow-foreground: #92400e;
		--color-clay-cream-foreground: #92400e;

		--radius-sm: 16px;
		--radius-md: 20px;
		--radius-lg: 24px;
		--radius-xl: 28px;
		--radius-2xl: 32px;
		--radius-full: 9999px;

		--shadow-sm: 4px 4px 0 rgb(0 0 0 / 0.08), inset 0 1px 3px rgb(255 255 255 / 0.6);
		--shadow-md: 8px 8px 0 rgb(0 0 0 / 0.13), inset 0 2px 4px rgb(255 255 255 / 0.6);
		--shadow-lg: 12px 12px 0 rgb(0 0 0 / 0.18), inset 0 3px 6px rgb(255 255 255 / 0.7);
		--shadow-hover: 12px 12px 0 rgb(0 0 0 / 0.15), inset 0 2px 4px rgb(255 255 255 / 0.6);
		--shadow-active: 4px 4px 0 rgb(0 0 0 / 0.1), inset 0 2px 4px rgb(255 255 255 / 0.5);
		--shadow-bloom: 0 16px 40px rgb(248 180 217 / 0.55), inset 0 2px 5px rgb(255 255 255 / 0.65);
		--shadow-focus-ring: 0 0 0 4px rgb(196 181 253 / 0.55);

		--gradient-page: linear-gradient(135deg, #fef3c7 0%, #fce7f3 50%, #ede9fe 100%);
		--gradient-primary: linear-gradient(135deg, #fce7f3 0%, #f8b4d9 100%);
		--gradient-mint: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
		--gradient-rainbow: linear-gradient(135deg, #f8b4d9 0%, #c4b5fd 40%, #a7f3d0 70%, #fcd34d 100%);

		--blob-radius: 60% 40% 55% 45% / 40% 60% 40% 60%;
		--blob-radius-alt: 45% 55% 40% 60% / 55% 45% 55% 45%;

		--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
		--duration-base: 200ms;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		/* Geometric sans with open letterforms, carrying a real 900 for display.
		   No mono and no condensed face anywhere in this system. */
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display",
			"Segoe UI", Nunito, Quicksand, "Helvetica Neue", Arial, sans-serif;
		font-weight: 500;
		font-size: 16px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 900; letter-spacing: -0.01em; line-height: 1.15; }
	p { margin: 0; }
	::selection { background: var(--color-clay-lavender); color: var(--color-clay-lavender-foreground); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	.wrap { max-width: 1000px; margin: 0 auto; padding: 0 24px 96px; position: relative; z-index: 1; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 128px; } }

	/* ── Background blobs: lumps of clay, never circles ────────────── */
	.blob { position: absolute; pointer-events: none; z-index: 0; }
	.blob-a { width: 180px; height: 150px; border-radius: var(--blob-radius); background: var(--color-clay-pink); opacity: 0.55; }
	.blob-b { width: 130px; height: 130px; border-radius: var(--blob-radius-alt); background: var(--color-clay-mint); opacity: 0.5; }
	.blob-c { width: 96px; height: 96px; border-radius: var(--blob-radius); background: var(--color-clay-lavender); opacity: 0.5; }
	.blob-d { width: 150px; height: 120px; border-radius: var(--blob-radius-alt); background: var(--color-clay-yellow); opacity: 0.45; }

	/* ── COVER: a habit tracker, which is what this material is for ── */
	.app { position: relative; overflow: hidden; padding: 24px 24px 48px; }
	@media (min-width: 768px) { .app { padding: 32px 32px 64px; } }
	.app-inner { position: relative; z-index: 1; max-width: 1000px; margin: 0 auto; }

	.appbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
	.logo { display: flex; align-items: center; gap: 12px; font-weight: 900; font-size: 20px; }
	.logo .lump { width: 34px; height: 34px; border-radius: var(--blob-radius); background: var(--gradient-primary); box-shadow: var(--shadow-sm); }
	.avatar { width: 44px; height: 44px; border-radius: var(--radius-full); background: var(--color-clay-lavender); box-shadow: var(--shadow-sm); display: grid; place-items: center; font-weight: 800; color: var(--color-clay-lavender-foreground); }

	.hello { margin-top: 28px; }
	.hello h1 { font-size: 34px; }
	@media (min-width: 768px) { .hello h1 { font-size: 46px; } }
	/* The one place a heading takes color: a gradient-filled accent word. */
	.tint {
		background: linear-gradient(135deg, #f07fb8 0%, #a78bfa 55%, #4fd1b1 100%);
		-webkit-background-clip: text; background-clip: text; color: transparent;
	}
	.hello p { color: var(--color-muted); margin-top: 10px; max-width: 46ch; }

	.board { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 32px; }
	@media (min-width: 860px) { .board { grid-template-columns: 1.35fr 1fr; gap: 32px; } }

	/* Cards: fat radius, offset drop, inset sheen, no border. */
	.card {
		position: relative; overflow: hidden;
		padding: 24px; border-radius: var(--radius-2xl);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-lg);
	}
	@media (min-width: 768px) { .card { padding: 32px; } }
	/* The inset white bar near the top edge — the moulded sheen. */
	.card::before {
		content: ""; position: absolute; left: 24px; right: 24px; top: 12px; height: 4px;
		border-radius: var(--radius-full); background: rgb(255 255 255 / 0.65);
	}
	.card-pink { background: var(--color-clay-pink); color: var(--color-clay-pink-foreground); }
	.card-mint { background: var(--color-clay-mint); color: var(--color-clay-mint-foreground); }
	.card-lavender { background: var(--color-clay-lavender); color: var(--color-clay-lavender-foreground); }
	.card h3 { font-size: 20px; }
	.card p { font-size: 15px; opacity: 0.82; }

	.chip {
		display: inline-block; padding: 6px 16px; border-radius: var(--radius-full);
		background: rgb(255 255 255 / 0.6); box-shadow: var(--shadow-sm);
		font-size: 12px; font-weight: 800;
	}

	/* Habit rows: recessed groove track + raised fill, the in/out language. */
	.habit { display: flex; align-items: center; gap: 16px; }
	.habit + .habit { margin-top: 22px; }
	.habit .icon { width: 52px; height: 52px; flex: none; border-radius: var(--radius-full); display: grid; place-items: center; font-size: 21px; box-shadow: var(--shadow-sm); }
	.habit .body { flex: 1; min-width: 0; }
	.habit .body b { display: block; font-weight: 800; font-size: 16px; }
	.habit .body span { font-size: 13px; color: var(--color-muted); font-weight: 600; }
	.meter { display: block; height: 18px; border-radius: var(--radius-full); background: var(--color-clay-cream); box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.12); padding: 3px; margin-top: 8px; }
	.meter .fill { display: block; height: 12px; border-radius: var(--radius-full); }

	.ring { position: relative; flex: none; }
	.ring svg { display: block; }
	.ring .pct { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 900; font-size: 26px; }

	.streaks { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
	.day { width: 40px; height: 40px; border-radius: var(--radius-full); display: grid; place-items: center; font-size: 12px; font-weight: 800; box-shadow: var(--shadow-sm); }
	.day.todo { background: var(--color-clay-cream); color: #b6a99a; box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.07); }

	/* ── Buttons ───────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-weight: 800; font-size: 16px;
		padding: 14px 30px; min-height: 44px;
		border: 0; border-radius: var(--radius-full);
		background: var(--color-clay-pink); color: var(--color-clay-pink-foreground);
		box-shadow: var(--shadow-md);
		cursor: pointer;
		transition: box-shadow var(--duration-base) var(--ease-spring),
			transform var(--duration-base) var(--ease-spring);
	}
	.btn:hover { box-shadow: var(--shadow-hover); transform: scale(1.04); }
	.btn:active { box-shadow: var(--shadow-active); transform: scale(0.97); }
	.btn:focus-visible { outline: none; box-shadow: var(--shadow-md), var(--shadow-focus-ring); }
	.btn-mint { background: var(--color-clay-mint); color: var(--color-clay-mint-foreground); }
	.btn-lavender { background: var(--color-clay-lavender); color: var(--color-clay-lavender-foreground); }
	.btn-yellow { background: var(--color-clay-yellow); color: var(--color-clay-yellow-foreground); }
	.btn-cream { background: var(--color-clay-cream); color: var(--color-clay-cream-foreground); box-shadow: var(--shadow-sm); }
	.btn-sm { font-size: 14px; padding: 10px 20px; box-shadow: var(--shadow-sm); }
	.btn-lg { font-size: 20px; padding: 18px 40px; box-shadow: var(--shadow-lg); }
	/* Disabled loses its drop entirely: pressed flat, not faded out. */
	.btn[disabled] {
		cursor: not-allowed; background: var(--color-clay-cream); color: #a8a29e;
		box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.06);
		transform: none;
	}
	.row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }

	/* ── Section scaffold ──────────────────────────────────────────── */
	.section { padding-top: 64px; }
	@media (min-width: 768px) { .section { padding-top: 96px; } }
	.section-label {
		display: inline-block;
		padding: 8px 20px; margin-bottom: 24px;
		border-radius: var(--radius-full);
		background: var(--color-clay-cream); color: var(--color-clay-cream-foreground);
		box-shadow: var(--shadow-sm);
		font-size: 13px; font-weight: 800;
	}
	.section h2 { font-size: 30px; }
	@media (min-width: 768px) { .section h2 { font-size: 38px; } }
	.lede { color: var(--color-muted); max-width: 60ch; margin-top: 12px; }
	.note { margin-top: 20px; font-size: 14px; color: var(--color-muted); }

	/* ── Palette ───────────────────────────────────────────────────── */
	.palette { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-top: 32px; }
	@media (min-width: 720px) { .palette { grid-template-columns: repeat(3, 1fr); } }
	.swatch { border-radius: var(--radius-2xl); overflow: hidden; box-shadow: var(--shadow-md); background: var(--color-surface-raised); }
	.swatch-top { position: relative; height: 100px; }
	.swatch-top::before {
		content: ""; position: absolute; left: 16px; right: 16px; top: 10px; height: 3px;
		border-radius: var(--radius-full); background: rgb(255 255 255 / 0.7);
	}
	.swatch-meta { padding: 16px 20px 20px; }
	.swatch-meta b { display: block; font-weight: 800; font-size: 15px; }
	.swatch-meta span { font-size: 13px; color: var(--color-muted); }

	/* ── Depth scale ───────────────────────────────────────────────── */
	.depths { display: grid; grid-template-columns: 1fr; gap: 32px; margin-top: 32px; }
	@media (min-width: 720px) { .depths { grid-template-columns: repeat(3, 1fr); } }
	.depth { padding: 32px 24px; border-radius: var(--radius-lg); text-align: center; font-weight: 800; }
	.depth-sm { background: var(--color-clay-pink); color: var(--color-clay-pink-foreground); box-shadow: var(--shadow-sm); }
	.depth-md { background: var(--color-clay-mint); color: var(--color-clay-mint-foreground); box-shadow: var(--shadow-md); }
	.depth-lg { background: var(--color-clay-lavender); color: var(--color-clay-lavender-foreground); box-shadow: var(--shadow-lg); }
	.depth small { display: block; font-weight: 600; font-size: 12px; opacity: 0.8; margin-top: 8px; }

	/* ── Form ──────────────────────────────────────────────────────── */
	.field { display: block; max-width: 460px; }
	.field + .field { margin-top: 24px; }
	.flabel { display: block; margin-bottom: 10px; font-size: 14px; font-weight: 800; }
	.input {
		width: 100%; font: inherit; font-weight: 500; padding: 16px 20px; min-height: 44px;
		border: 0; border-radius: var(--radius-xl);
		background: var(--color-clay-cream); color: var(--color-surface-foreground);
		/* Recessed: highlight only, no drop — the field sits *in* the page. */
		box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.08), inset 0 -1px 2px rgb(255 255 255 / 0.9);
		transition: box-shadow var(--duration-base) var(--ease-spring);
	}
	.input::placeholder { color: #b6a99a; }
	.input:focus { outline: none; box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.08), var(--shadow-focus-ring); }
	.input-error { background: var(--color-danger); }
	.msg { margin-top: 10px; font-size: 14px; font-weight: 700; color: var(--color-clay-pink-foreground); }

	.toggle { display: inline-flex; align-items: center; gap: 12px; font-weight: 700; font-size: 14px; }
	.track {
		width: 64px; height: 36px; border-radius: var(--radius-full);
		background: var(--color-clay-mint); padding: 4px;
		box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.12);
		display: flex; justify-content: flex-end;
	}
	.track-off { background: var(--color-clay-cream); justify-content: flex-start; }
	.knob { width: 28px; height: 28px; border-radius: var(--radius-full); background: #fff; box-shadow: var(--shadow-sm); }

	/* Tabs: one pill track with the active tab raised inside it. */
	.tabs { display: inline-flex; gap: 4px; padding: 5px; border-radius: var(--radius-full); background: var(--color-clay-cream); box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.1); }
	.tabs span { padding: 8px 20px; border-radius: var(--radius-full); font-size: 14px; font-weight: 800; color: var(--color-clay-cream-foreground); }
	.tabs .is-active { background: var(--color-surface-raised); box-shadow: var(--shadow-sm); color: var(--color-surface-foreground); }

	/* ── Dialog ────────────────────────────────────────────────────── */
	.scrim { border-radius: var(--radius-2xl); padding: 40px 24px; background: var(--gradient-page); margin-top: 32px; }
	.dialog { max-width: 420px; margin: 0 auto; padding: 32px; border-radius: var(--radius-2xl); background: var(--color-surface-raised); box-shadow: var(--shadow-lg); }

	/* ── Mobile ────────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 36px; margin-top: 32px; align-items: start; }
	@media (min-width: 880px) { .mobile { grid-template-columns: 296px 1fr; gap: 48px; } }
	.phone {
		width: 296px; max-width: 100%; margin: 0 auto;
		border-radius: 44px; padding: 10px;
		background: var(--color-clay-cream);
		box-shadow: var(--shadow-lg);
		position: relative; overflow: hidden;
	}
	.phone-inner { position: relative; z-index: 1; border-radius: 36px; background: var(--color-surface); overflow: hidden; }
	.phone-status { display: flex; justify-content: space-between; padding: 12px 20px 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); }
	.phone-body { padding: 6px 16px 14px; position: relative; }
	.phone-body h4 { font-size: 24px; font-weight: 900; letter-spacing: -0.01em; }
	.phone-body .sub { font-size: 12px; color: var(--color-muted); font-weight: 600; }
	.m-card { border-radius: var(--radius-xl); padding: 16px; margin-top: 14px; position: relative; overflow: hidden; box-shadow: var(--shadow-md); background: var(--color-surface-raised); }
	.m-card::before { content: ""; position: absolute; left: 16px; right: 16px; top: 9px; height: 3px; border-radius: var(--radius-full); background: rgb(255 255 255 / 0.65); }
	.m-habit { display: flex; align-items: center; gap: 12px; }
	.m-habit + .m-habit { margin-top: 14px; }
	.m-habit .icon { width: 38px; height: 38px; border-radius: var(--radius-full); display: grid; place-items: center; font-size: 16px; box-shadow: var(--shadow-sm); flex: none; }
	.m-habit b { font-size: 13px; font-weight: 800; display: block; }
	.m-habit .meter { height: 14px; margin-top: 5px; }
	.m-habit .meter .fill { height: 8px; }
	/* Bottom bar is a floating clay pill, not a docked strip. */
	.m-bar { display: flex; gap: 6px; margin: 12px 14px 16px; padding: 6px; border-radius: var(--radius-full); background: var(--color-surface-raised); box-shadow: var(--shadow-md); }
	.m-bar div { flex: 1; text-align: center; padding: 8px 0; border-radius: var(--radius-full); font-size: 10px; font-weight: 800; color: var(--color-muted); }
	.m-bar .is-active { background: var(--color-clay-pink); color: var(--color-clay-pink-foreground); box-shadow: var(--shadow-sm); }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 16px 0; border-bottom: 2px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules li:last-child { border-bottom: 0; }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 16px; font-weight: 800; margin-bottom: 3px; }

	/* ── Off-style comparison ──────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 32px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 24px; border-radius: 4px; background: #e5e7eb; color: #6b7280; font-weight: 400; box-shadow: none; }
	.cmp-on { padding: 24px; border-radius: var(--radius-2xl); background: var(--color-clay-mint); color: var(--color-clay-mint-foreground); font-weight: 700; box-shadow: var(--shadow-lg); }

	@media (prefers-reduced-motion: reduce) {
		.btn:hover, .btn:active { transform: none; }
	}
</style>
</head>
<body>

<!-- COVER — a habit tracker, which is what this material is actually for.
     Cream page, clay lumps behind, every piece moulded and squishy. -->
<header class="app">
	<div class="blob blob-a" style="top: 20px; left: -70px;"></div>
	<div class="blob blob-b" style="top: 220px; right: -50px;"></div>
	<div class="blob blob-c" style="bottom: 40px; left: 8%;"></div>
	<div class="blob blob-d" style="bottom: -30px; right: 12%;"></div>

	<div class="app-inner">
		<div class="appbar">
			<span class="logo"><span class="lump"></span>Squish</span>
			<span class="spacer"></span>
			<span class="tabs"><span class="is-active">Today</span><span>Week</span><span>All</span></span>
			<span class="avatar">KM</span>
		</div>

		<div class="hello">
			<h1>Nice work today, <span class="tint">Kaori</span>.</h1>
			<p>Three of four habits done. The last one takes ten minutes.</p>
		</div>

		<div class="board">
			<div class="card">
				<span class="chip">Today's habits</span>
				<div style="margin-top: 22px;">
					<div class="habit">
						<span class="icon" style="background: var(--color-clay-mint); color: var(--color-clay-mint-foreground)">🌿</span>
						<span class="body">
							<b>Morning stretch</b><span>10 of 10 minutes</span>
							<span class="meter"><span class="fill" style="width:100%; background: var(--color-clay-mint)"></span></span>
						</span>
					</div>
					<div class="habit">
						<span class="icon" style="background: var(--color-clay-lavender); color: var(--color-clay-lavender-foreground)">📖</span>
						<span class="body">
							<b>Read something long</b><span>18 of 20 pages</span>
							<span class="meter"><span class="fill" style="width:90%; background: var(--color-clay-lavender)"></span></span>
						</span>
					</div>
					<div class="habit">
						<span class="icon" style="background: var(--color-clay-yellow); color: var(--color-clay-yellow-foreground)">💧</span>
						<span class="body">
							<b>Drink water</b><span>6 of 8 glasses</span>
							<span class="meter"><span class="fill" style="width:75%; background: var(--color-clay-yellow)"></span></span>
						</span>
					</div>
					<div class="habit">
						<span class="icon" style="background: var(--color-clay-pink); color: var(--color-clay-pink-foreground)">🎹</span>
						<span class="body">
							<b>Practise piano</b><span>Not started</span>
							<span class="meter"><span class="fill" style="width:6%; background: var(--color-clay-pink)"></span></span>
						</span>
					</div>
				</div>
				<div class="row" style="margin-top: 28px;">
					<button class="btn">Start piano</button>
					<button class="btn btn-cream">Skip today</button>
				</div>
			</div>

			<div style="display: grid; gap: 24px; align-content: start;">
				<div class="card card-mint" style="display: flex; align-items: center; gap: 20px;">
					<span class="ring">
						<svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="76 percent of today complete">
							<circle cx="48" cy="48" r="38" fill="none" stroke="rgb(255 255 255 / 0.55)" stroke-width="14"/>
							<circle cx="48" cy="48" r="38" fill="none" stroke="#115e52" stroke-width="14" stroke-linecap="round"
								stroke-dasharray="239" stroke-dashoffset="58" transform="rotate(-90 48 48)"/>
						</svg>
						<span class="pct">76%</span>
					</span>
					<span>
						<h3>Today</h3>
						<p>Three done, one to go.</p>
					</span>
				</div>

				<div class="card">
					<span class="chip" style="background: var(--color-clay-pink); color: var(--color-clay-pink-foreground)">12 day streak</span>
					<h3 style="margin-top: 16px;">This week</h3>
					<div class="streaks">
						<span class="day" style="background: var(--color-clay-mint); color: var(--color-clay-mint-foreground)">M</span>
						<span class="day" style="background: var(--color-clay-mint); color: var(--color-clay-mint-foreground)">T</span>
						<span class="day" style="background: var(--color-clay-mint); color: var(--color-clay-mint-foreground)">W</span>
						<span class="day" style="background: var(--color-clay-yellow); color: var(--color-clay-yellow-foreground)">T</span>
						<span class="day" style="background: var(--color-clay-pink); color: var(--color-clay-pink-foreground)">F</span>
						<span class="day todo">S</span>
						<span class="day todo">S</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</header>

<div class="wrap">

	<!-- 01 PALETTE -->
	<section class="section">
		<p class="section-label">01 — Candy palette</p>
		<h2>Five tints, five inks</h2>
		<p class="lede">Every tint is light, so contrast lives in the paired ink.
			White text on clay lands near 2:1 and is never used.</p>
		<div class="palette">
			<div class="swatch">
				<div class="swatch-top" style="background: var(--color-clay-pink);"></div>
				<div class="swatch-meta"><b>clay-pink</b><span>#f8b4d9 · primary action</span></div>
			</div>
			<div class="swatch">
				<div class="swatch-top" style="background: var(--color-clay-mint);"></div>
				<div class="swatch-meta"><b>clay-mint</b><span>#a7f3d0 · success, secondary</span></div>
			</div>
			<div class="swatch">
				<div class="swatch-top" style="background: var(--color-clay-lavender);"></div>
				<div class="swatch-meta"><b>clay-lavender</b><span>#c4b5fd · accent, selection</span></div>
			</div>
			<div class="swatch">
				<div class="swatch-top" style="background: var(--color-clay-yellow);"></div>
				<div class="swatch-meta"><b>clay-yellow</b><span>#fcd34d · highlight</span></div>
			</div>
			<div class="swatch">
				<div class="swatch-top" style="background: var(--color-clay-cream);"></div>
				<div class="swatch-meta"><b>clay-cream</b><span>#fef3c7 · quiet fills, inputs</span></div>
			</div>
			<div class="swatch">
				<div class="swatch-top" style="background: var(--gradient-rainbow);"></div>
				<div class="swatch-meta"><b>gradient-rainbow</b><span>all five · once per screen</span></div>
			</div>
		</div>
		<p class="note">The page itself stays warm cream. A white or gray background flattens every piece on it, and two or three tints per screen is the working limit.</p>
	</section>

	<!-- 02 DEPTH -->
	<section class="section">
		<p class="section-label">02 — Depth pair</p>
		<h2>Offset drop plus inner shine</h2>
		<p class="lede">The drop has zero blur, which is what reads as extruded
			thickness rather than a cast shadow. The inset white highlight along the
			top is the moulded sheen. Remove either half and the clay is gone.</p>
		<div class="depths">
			<div class="depth depth-sm">shadow-sm<small>4px offset · chips, pills</small></div>
			<div class="depth depth-md">shadow-md<small>8px offset · buttons, controls</small></div>
			<div class="depth depth-lg">shadow-lg<small>12px offset · cards, dialogs</small></div>
		</div>
		<p class="note">Gaps never drop below 16px: the drop needs clearance to the right and below, or the depth turns to mud.</p>
	</section>

	<!-- 03 BUTTONS -->
	<section class="section">
		<p class="section-label">03 — Buttons &amp; states</p>
		<h2>Press and it squashes</h2>
		<div class="row" style="margin-top: 32px;">
			<button class="btn">Pink clay</button>
			<button class="btn btn-mint">Mint</button>
			<button class="btn btn-lavender">Lavender</button>
			<button class="btn btn-yellow">Yellow</button>
			<button class="btn btn-cream">Cream</button>
		</div>
		<div class="row" style="margin-top: 24px;">
			<button class="btn btn-sm btn-lavender">Small pill</button>
			<button class="btn btn-mint">Medium slab</button>
			<button class="btn btn-lg">Large chunk</button>
			<button class="btn" disabled>Disabled</button>
		</div>
		<p class="note">Hover pushes the drop out to 12px and scales to 1.04; active pulls it back to 4px and scales to 0.97 — the
			shrinking drop is what sells the press. Tab to a button for the lavender focus ring. Disabled loses its drop entirely
			rather than fading.</p>
	</section>

	<!-- 04 FORM -->
	<section class="section">
		<p class="section-label">04 — Inputs &amp; controls</p>
		<h2>Recessed, not raised</h2>
		<p class="lede">Inputs are the one inverted case: no drop at all, so the field
			reads as pressed into the page while everything else sits on top of it.</p>
		<div style="margin-top: 32px;">
			<label class="field">
				<span class="flabel">Habit name</span>
				<input class="input" type="text" placeholder="Click or tab in →">
			</label>
			<label class="field">
				<span class="flabel">Reminder email</span>
				<input class="input input-error" type="email" value="not-an-email">
				<span class="msg">Enter a valid address</span>
			</label>
		</div>
		<div class="row" style="margin-top: 32px; gap: 32px;">
			<span class="toggle"><span class="track"><span class="knob"></span></span> Nudge me</span>
			<span class="toggle"><span class="track track-off"><span class="knob"></span></span> Weekend off</span>
			<span class="tabs"><span class="is-active">Today</span><span>Week</span><span>All</span></span>
		</div>
		<p class="note">Tracks, tabs and meters share one language: a recessed groove holding a raised piece.</p>
	</section>

	<!-- 05 OVERLAY -->
	<section class="section">
		<p class="section-label">05 — Overlay</p>
		<h2>Dialogs stay clay</h2>
		<div class="scrim">
			<div class="dialog">
				<h3 style="font-size: 22px;">Delete this habit?</h3>
				<p style="margin: 12px 0 24px; color: var(--color-muted); font-size: 15px;">
					Twelve days of streak go with it. Nothing is fired yet, so this is easy to undo.</p>
				<div class="row">
					<button class="btn" style="background: var(--color-danger);">Delete</button>
					<button class="btn btn-cream">Cancel</button>
				</div>
			</div>
		</div>
		<p class="note">The scrim is warm, not black: cream through pink to lavender. Dark scrims break the material.</p>
	</section>

	<!-- 06 MOBILE -->
	<section class="section">
		<p class="section-label">06 — Mobile</p>
		<h2>Fat shapes were built for thumbs</h2>
		<p class="lede">This material is at its best on a phone: the fat radii already put every target
			well past 44px, and the offset drop makes a small screen feel like a tray of objects rather than
			a list. The one thing to watch is clearance — drops need room to the right and below.</p>
		<div class="mobile">
			<div class="phone">
				<div class="blob blob-c" style="top: -20px; right: -20px; opacity: 0.35;"></div>
				<div class="phone-inner">
					<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
					<div class="phone-body">
						<div style="display:flex;align-items:center;gap:10px">
							<span class="logo" style="font-size:15px;gap:8px"><span class="lump" style="width:24px;height:24px"></span>Squish</span>
							<span class="spacer"></span>
							<span class="avatar" style="width:30px;height:30px;font-size:11px">KM</span>
						</div>
						<h4 style="margin-top:14px">Nice work, <span class="tint">Kaori</span>.</h4>
						<div class="sub">Three of four done today</div>

						<div class="m-card card-mint" style="display:flex;align-items:center;gap:14px">
							<span class="ring">
								<svg width="54" height="54" viewBox="0 0 96 96" role="img" aria-label="76 percent complete">
									<circle cx="48" cy="48" r="38" fill="none" stroke="rgb(255 255 255 / 0.55)" stroke-width="16"/>
									<circle cx="48" cy="48" r="38" fill="none" stroke="#115e52" stroke-width="16" stroke-linecap="round" stroke-dasharray="239" stroke-dashoffset="58" transform="rotate(-90 48 48)"/>
								</svg>
							</span>
							<span><b style="font-weight:900;font-size:15px">76% today</b><br><span style="font-size:11px;opacity:0.8">One habit to go</span></span>
						</div>

						<div class="m-card">
							<div class="m-habit">
								<span class="icon" style="background: var(--color-clay-mint); color: var(--color-clay-mint-foreground)">🌿</span>
								<span style="flex:1"><b>Morning stretch</b><span class="meter"><span class="fill" style="width:100%;background:var(--color-clay-mint)"></span></span></span>
							</div>
							<div class="m-habit">
								<span class="icon" style="background: var(--color-clay-yellow); color: var(--color-clay-yellow-foreground)">💧</span>
								<span style="flex:1"><b>Drink water</b><span class="meter"><span class="fill" style="width:75%;background:var(--color-clay-yellow)"></span></span></span>
							</div>
							<div class="m-habit">
								<span class="icon" style="background: var(--color-clay-pink); color: var(--color-clay-pink-foreground)">🎹</span>
								<span style="flex:1"><b>Practise piano</b><span class="meter"><span class="fill" style="width:6%;background:var(--color-clay-pink)"></span></span></span>
							</div>
						</div>
					</div>
					<div class="m-bar">
						<div class="is-active">Today</div><div>Habits</div><div>Streaks</div><div>You</div>
					</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Clearance before density</b>The offset drop needs room to its right and below, so the 16px gap floor holds at every width. When space runs short, a card is removed rather than tightened.</li>
				<li><b>Shadow steps down</b>Cards go <code>shadow-lg</code> → <code>shadow-md</code>, controls <code>shadow-md</code> → <code>shadow-sm</code>. The offset stays proportional to the piece so a small card does not look like it is floating away.</li>
				<li><b>Radius eases, never squares</b>32px cards become 28px, 44px phone shell corners stay generous. The 16px floor is absolute — nothing rounds down past it on a small screen.</li>
				<li><b>Targets are already there</b>Pills at 44px minimum, icon holders at 38–52px circles. The fat shapes mean no touch-specific resizing is needed, which is the material's biggest practical advantage.</li>
				<li><b>Bottom bar is a floating pill</b>Not a docked strip with a divider. It keeps the full radius and its own drop, with the active tab raised in clay pink — the same groove-and-raised-piece language as the tabs.</li>
				<li><b>Blobs move behind, and shrink</b>One or two lumps at reduced opacity, clipped by the screen edge. They never sit behind small text, at any width.</li>
				<li><b>Motion</b>The spring stays. Press-to-squash at 0.97 is the whole personality, and it is the one interaction touch gets for free — hover simply has no equivalent.</li>
			</ul>
		</div>
	</section>

	<!-- 07 DON'T -->
	<section class="section">
		<p class="section-label">07 — Off-style, for contrast</p>
		<h2>What breaks the spell</h2>
		<div class="compare">
			<div class="cmp-off">
				Sharp 4px corner · flat, no shadow · cool gray fill · desaturated neutral text · regular weight.
				Every one of these is forbidden here.
			</div>
			<div class="cmp-on">
				Same content, on-style: 32px corner, candy tint, offset drop plus inner shine, dark paired ink, weight 700.
			</div>
		</div>
		<p class="note">Also out: dark or moody backgrounds, monospace and condensed faces, neon accents, and any shadow harsh
			enough to read as a cast shadow instead of thickness.</p>
	</section>

</div>
</body>
</html>
`;

const Anthropic_THEME = `/* Anthropic — warm book-cloth cream, ink text, clay accent. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #191919;
	--color-primary-foreground: #ffffff;
	--color-surface: #f0eee6;
	--color-surface-foreground: #191919;
	--color-surface-raised: #ffffff;
	--color-muted: #6e6c64;
	--color-accent: #cc785c;
	--color-danger: #bf4d43;
	--color-border: #dcdad1;

	--radius-sm: 8px;
	--radius-md: 12px;
	--radius-lg: 16px;
	--radius-xl: 20px;
	--radius-2xl: 28px;

	--shadow-sm: 0 1px 3px rgb(25 25 25 / 0.06);
	--shadow-md: 0 6px 16px rgb(25 25 25 / 0.08);
	--shadow-lg: 0 16px 48px rgb(25 25 25 / 0.12);
}
`;

const Anthropic_SPEC = `# Anthropic

## Atmosphere
A well-bound book. Warm cream paper, dark ink, one clay accent — humanist,
literary, unhurried. Technology presented with the calm of print.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (book-cloth cream #f0eee6) is the page; \`surface-raised\` (white)
  for cards and figures.
- \`primary\` is INK (#191919): primary buttons are dark ink pills with white
  text.
- \`accent\` (clay #cc785c) for links, highlights, small illustrations, active
  states — the single warm voice.
- Body text ink; secondary \`muted\` (warm gray); \`border\` warm hairlines.

## Typography
System font stack; lean on the serif stack for voice:
- Display/section headings in \`font-serif\` \`font-medium\` 28–44px — the
  literary signature.
- Body 15–16px sans with \`leading-relaxed\`; UI labels 13–14px sans.
- Quotes/figure captions may italicize serif; \`font-mono\` for code on white
  cards.

## Shape & depth
- Generous soft radii: cards \`rounded-xl\`/\`rounded-2xl\` (16–28px), buttons
  \`rounded-full\` pills.
- Nearly flat: warm borders + white cards on cream; \`shadow-md\` only for
  overlays. Print doesn't cast shadows.

## Components
- Buttons: pill h-10; primary ink-filled; secondary bordered cream; links in
  clay with underline on hover.
- Cards: white \`rounded-2xl\` with 24–32px padding, small clay eyebrow label,
  serif title, sans body.
- Callouts: cream-on-cream with a clay left border and serif lead-in.
- Diagrams favor thin ink lines with clay highlights, hand-drawn warmth.

## Layout
Reading column ~720px centered, airy 56–80px section spacing; card grids 2–3
columns with 24px gaps. Margins are generous — the page must feel unhurried.

## Don'ts
- No cool grays or blue-tinted neutrals — every neutral is warm.
- Clay never fills buttons or large areas; it is an accent voice, not a brand
  shout.
- No dark mode, no glossy shadows, no tight dense grids.
`;

const Anthropic_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anthropic — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #191919;
		--color-primary-foreground: #ffffff;
		--color-surface: #f0eee6;
		--color-surface-foreground: #191919;
		--color-surface-raised: #ffffff;
		--color-muted: #6e6c64;
		--color-accent: #cc785c;
		--color-danger: #bf4d43;
		--color-border: #dcdad1;

		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 16px;
		--radius-xl: 20px;
		--radius-2xl: 28px;

		--shadow-sm: 0 1px 3px rgb(25 25 25 / 0.06);
		--shadow-md: 0 6px 16px rgb(25 25 25 / 0.08);
		--shadow-lg: 0 16px 48px rgb(25 25 25 / 0.12);

		--serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, Cambria, "Times New Roman", serif;
		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.75;
		-webkit-font-smoothing: antialiased;
	}
	/* The serif heading is the literary signature of the whole system. */
	h1, h2, h3 { margin: 0; font-family: var(--serif); font-weight: 500; letter-spacing: -0.01em; line-height: 1.2; }
	p { margin: 0; }
	::selection { background: rgb(204 120 92 / 0.28); }
	code { font-family: var(--mono); font-size: 0.86em; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1px 6px; }
	a { color: var(--color-accent); text-decoration: none; border-bottom: 1px solid rgb(204 120 92 / 0.4); }

	.col { max-width: 720px; margin: 0 auto; padding: 0 22px; }
	@media (min-width: 768px) { .col { padding: 0 32px; } }
	.wide { max-width: 980px; margin: 0 auto; padding: 0 22px; }
	@media (min-width: 768px) { .wide { padding: 0 32px; } }

	/* ── Masthead ──────────────────────────────────────────────────── */
	.top { display: flex; align-items: center; gap: 20px; padding: 22px 0; }
	.mark { display: flex; gap: 3px; align-items: flex-end; height: 20px; }
	.mark i { width: 3px; background: var(--color-surface-foreground); display: block; border-radius: 1px; }
	.mark i:nth-child(1) { height: 12px; } .mark i:nth-child(2) { height: 20px; }
	.mark i:nth-child(3) { height: 16px; } .mark i:nth-child(4) { height: 9px; }
	.top b { font-family: var(--serif); font-size: 19px; font-weight: 500; }
	.top nav { display: none; gap: 22px; font-size: 15px; color: var(--color-muted); }
	@media (min-width: 700px) { .top nav { display: flex; } }
	.spacer { flex: 1; }

	/* ── Opening spread ────────────────────────────────────────────── */
	.opening { padding: 40px 0 64px; }
	@media (min-width: 768px) { .opening { padding: 64px 0 88px; } }
	.eyebrow { font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent); }
	.opening h1 { font-size: 38px; margin-top: 18px; max-width: 16ch; }
	@media (min-width: 768px) { .opening h1 { font-size: 56px; } }
	/* A drop cap: print convention, and the reason the serif exists. */
	.lede-first { margin-top: 26px; font-size: 18px; }
	.lede-first::first-letter {
		float: left; font-family: var(--serif); font-size: 62px; line-height: 0.82;
		padding: 6px 10px 0 0; color: var(--color-accent);
	}
	.opening .actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 36px; }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding: 56px 0; border-top: 1px solid var(--color-border); }
	@media (min-width: 768px) { .section { padding: 80px 0; } }
	.section-label { font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent); margin-bottom: 14px; }
	.section h2 { font-size: 30px; }
	@media (min-width: 768px) { .section h2 { font-size: 38px; } }
	.lede { color: var(--color-muted); margin-top: 16px; max-width: 60ch; }
	.note { margin-top: 22px; font-size: 14px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }

	/* ── Buttons: ink pills. Clay never fills one. ────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 500;
		height: 46px; padding: 0 26px;
		border: 1px solid var(--color-primary); border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 200ms ease, color 200ms ease;
	}
	.btn:hover { background: #2f2f2c; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(204 120 92 / 0.45); }
	.btn-secondary { background: transparent; color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: var(--color-surface-raised); border-color: var(--color-muted); }
	.btn-quiet { background: transparent; border-color: transparent; color: var(--color-accent); }
	.btn-quiet:hover { background: rgb(204 120 92 / 0.1); }
	.btn[disabled] { cursor: not-allowed; background: transparent; color: #a8a69c; border-color: var(--color-border); }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 360px; height: 46px; padding: 0 18px;
		border: 1px solid var(--color-border); border-radius: 9999px;
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #a8a69c; }
	.input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgb(204 120 92 / 0.18); }

	/* ── Cards: white paper on cream, clay eyebrow, serif title ───── */
	.cards { display: grid; grid-template-columns: 1fr; gap: 22px; margin-top: 32px; }
	@media (min-width: 700px) { .cards { grid-template-columns: repeat(3, 1fr); } }
	.card {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-2xl);
		padding: 26px 28px;
	}
	.card .k { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent); }
	.card h3 { font-size: 21px; margin-top: 12px; }
	.card p { font-size: 15px; color: var(--color-muted); margin-top: 10px; line-height: 1.65; }

	/* ── Pull quote & callout ─────────────────────────────────────── */
	.pull {
		font-family: var(--serif); font-size: 24px; line-height: 1.4;
		border-left: 3px solid var(--color-accent);
		padding: 4px 0 4px 24px; margin: 32px 0; max-width: 34em;
	}
	@media (min-width: 768px) { .pull { font-size: 28px; } }
	.pull cite { display: block; font-family: var(--sans); font-size: 14px; font-style: normal; color: var(--color-muted); margin-top: 14px; }
	.callout {
		border-left: 3px solid var(--color-accent);
		background: rgb(204 120 92 / 0.07);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		padding: 20px 24px; margin-top: 28px;
	}
	.callout b { font-family: var(--serif); font-weight: 500; font-size: 18px; display: block; margin-bottom: 6px; }
	.callout p { font-size: 15px; color: var(--color-muted); }

	/* ── A thin-line figure, the way this system draws diagrams ───── */
	.figure { background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: 30px; margin-top: 32px; }
	.figure svg { display: block; width: 100%; height: auto; }
	.figcaption { font-family: var(--serif); font-style: italic; font-size: 15px; color: var(--color-muted); margin-top: 16px; text-align: center; }

	/* ── Palette ──────────────────────────────────────────────────── */
	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 30px; }
	@media (min-width: 700px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 78px; border-radius: var(--radius-lg); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 14px; font-weight: 600; margin-top: 10px; }
	.sw span { font-size: 13px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 34px; margin-top: 34px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 286px 1fr; gap: 48px; } }
	.phone {
		width: 286px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 30px;
		background: var(--color-surface); overflow: hidden; box-shadow: var(--shadow-md);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 12px 20px 4px; font-size: 10px; color: var(--color-muted); }
	.phone-top { display: flex; align-items: center; gap: 8px; padding: 6px 20px 14px; }
	.phone-top b { font-family: var(--serif); font-size: 15px; font-weight: 500; }
	.phone-body { padding: 0 20px 20px; }
	.phone-body .eyebrow { font-size: 10px; }
	.phone-body h4 { font-family: var(--serif); font-weight: 500; font-size: 25px; line-height: 1.15; margin: 8px 0 12px; }
	.phone-body p { font-size: 13px; line-height: 1.7; color: var(--color-muted); }
	.phone-body .drop::first-letter { float: left; font-family: var(--serif); font-size: 40px; line-height: 0.8; padding: 4px 7px 0 0; color: var(--color-accent); }
	.m-card { background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 14px 16px; margin-top: 14px; }
	.m-card .k { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent); }
	.m-card h5 { font-family: var(--serif); font-weight: 500; font-size: 16px; margin: 6px 0 0; }
	.m-cta { padding: 0 20px 22px; }
	.m-cta .btn { width: 100%; height: 42px; font-size: 14px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 15px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules b { display: block; font-family: var(--serif); font-size: 17px; font-weight: 500; color: var(--color-surface-foreground); margin-bottom: 3px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 30px; }
	@media (min-width: 700px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 26px; border-radius: 6px;
		background: #11131a; color: #cbd5e1;
		font-family: var(--sans); font-size: 15px; font-weight: 600;
		box-shadow: 0 14px 32px rgb(17 19 26 / 0.4);
	}
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: #7c8ba1; margin-top: 10px; line-height: 1.6; }
	.cmp-on { padding: 26px; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); }
	.cmp-on b { font-family: var(--serif); font-weight: 500; font-size: 19px; }
	.cmp-on small { display: block; font-size: 13px; color: var(--color-muted); margin-top: 10px; line-height: 1.6; }

	footer { border-top: 1px solid var(--color-border); padding: 34px 0 60px; font-size: 14px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — an opening spread. Cream paper, serif display, a clay drop cap,
     one ink pill. Print does not cast shadows, so nothing here does. -->
<div class="wide">
	<div class="top">
		<span class="mark"><i></i><i></i><i></i><i></i></span>
		<b>Vetta</b>
		<nav><span>Research</span><span>Handbook</span><span>Notes</span></nav>
		<span class="spacer"></span>
		<button class="btn btn-quiet">Sign in</button>
	</div>
</div>

<div class="col opening">
	<p class="eyebrow">Design notes — no. 04</p>
	<h1>A system set like a well-bound book</h1>
	<p class="lede-first">Warm cream paper, dark ink, and a single clay voice. The serif carries every
		heading; the sans carries every sentence you actually have to read at length. Nothing is cool-toned,
		nothing is glossy, and the page is allowed to be unhurried.</p>
	<div class="actions">
		<button class="btn">Read the handbook</button>
		<button class="btn btn-secondary">Browse components</button>
	</div>
</div>

<div class="col">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Voice</p>
		<h2>Two typefaces, one job each</h2>
		<p class="lede">Serif for display, sans for body, mono only where a machine wrote the value.
			Headings sit at weight 500 — a heavy serif reads as a newspaper, not a book.</p>
		<blockquote class="pull">Clay is an accent voice, not a brand shout. It underlines, it labels,
			it draws a line in a figure — it never fills a button.
			<cite>Working rule, page 12</cite></blockquote>
		<div class="callout">
			<b>On warmth</b>
			<p>Every neutral in this system leans warm. A blue-gray border or a cool #f5f5f5 fill will
				fight the cream page immediately, even at 1px.</p>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Cards</p>
		<h2>White paper laid on cream</h2>
		<div class="cards">
			<div class="card"><div class="k">Surface</div><h3>28px corners</h3><p>Cards are generous rectangles of white with warm hairline borders. Depth is the paper contrast, not a shadow.</p></div>
			<div class="card"><div class="k">Rhythm</div><h3>720px column</h3><p>The reading measure never widens. Grids sit outside it; prose never does.</p></div>
			<div class="card"><div class="k">Accent</div><h3>One clay line</h3><p>An eyebrow label, a quote rule, a link underline. Three appearances per screen is already a lot.</p></div>
		</div>
	</section>

	<!-- 03 -->
	<section class="section">
		<p class="section-label">03 — Figures</p>
		<h2>Thin ink lines, one clay highlight</h2>
		<p class="lede">Diagrams are drawn, not rendered: hairline strokes, open shapes, a single warm
			emphasis. No gradients, no 3D, no drop shadows on a diagram element.</p>
		<div class="figure">
			<svg viewBox="0 0 640 200" role="img" aria-label="Token flows from theme into components and pages">
				<g fill="none" stroke="#191919" stroke-width="1.25">
					<rect x="12" y="62" width="150" height="76" rx="18"/>
					<rect x="245" y="62" width="150" height="76" rx="18"/>
					<rect x="478" y="62" width="150" height="76" rx="18"/>
					<path d="M162 100 H245" stroke="#cc785c" stroke-width="1.5"/>
					<path d="M395 100 H478" stroke="#cc785c" stroke-width="1.5"/>
					<path d="M236 94 l9 6 -9 6" stroke="#cc785c" stroke-width="1.5"/>
					<path d="M469 94 l9 6 -9 6" stroke="#cc785c" stroke-width="1.5"/>
					<circle cx="87" cy="30" r="7" stroke="#cc785c"/>
					<circle cx="320" cy="30" r="7" stroke="#cc785c"/>
					<circle cx="553" cy="30" r="7" stroke="#cc785c"/>
				</g>
				<g font-family="Georgia, serif" font-size="16" fill="#191919" text-anchor="middle">
					<text x="87" y="106">theme.css</text>
					<text x="320" y="106">components</text>
					<text x="553" y="106">the page</text>
				</g>
				<g font-family="-apple-system, sans-serif" font-size="11" fill="#6e6c64" text-anchor="middle" letter-spacing="1.4">
					<text x="87" y="170">TOKENS</text>
					<text x="320" y="170">SHAPES</text>
					<text x="553" y="170">VOICE</text>
				</g>
			</svg>
			<p class="figcaption">One value, changed once, arriving everywhere.</p>
		</div>
	</section>

	<!-- 04 -->
	<section class="section">
		<p class="section-label">04 — Controls</p>
		<h2>Ink pills</h2>
		<div class="row" style="margin-top: 28px;">
			<button class="btn">Primary</button>
			<button class="btn btn-secondary">Secondary</button>
			<button class="btn btn-quiet">Learn more</button>
			<button class="btn" disabled>Unavailable</button>
		</div>
		<div class="row" style="margin-top: 20px;">
			<input class="input" placeholder="you@company.com">
			<button class="btn">Subscribe</button>
		</div>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#f0eee6 · book cloth</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#191919 · ink pills</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#cc785c · clay voice</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#ffffff · paper</span></div>
		</div>
		<p class="note">Buttons are full pills at 46px. The clay swatch above is the largest area of accent the system ever shows — and it is a swatch, not a surface.</p>
	</section>

	<!-- 05 MOBILE -->
	<section class="section">
		<p class="section-label">05 — Mobile</p>
		<h2>A pocket edition, not a different book</h2>
		<p class="lede">The phone build keeps the serif display, the drop cap and the cream page. What
			changes is the measure and the margins — the same choices a printer makes going from folio to pocket.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-top"><span class="mark"><i></i><i></i><i></i><i></i></span><b>Vetta</b><span class="spacer"></span><span style="color:var(--color-muted);font-size:13px">☰</span></div>
				<div class="phone-body">
					<p class="eyebrow">Design notes — no. 04</p>
					<h4>A system set like a well-bound book</h4>
					<p class="drop">Warm cream paper, dark ink, a single clay voice. The serif carries every heading; the sans carries the sentences.</p>
					<div class="m-card"><div class="k">Surface</div><h5>28px corners</h5></div>
					<div class="m-card"><div class="k">Accent</div><h5>One clay line</h5></div>
				</div>
				<div class="m-cta"><button class="btn">Read the handbook</button></div>
			</div>
			<ul class="rules">
				<li><b>The measure</b>720px becomes the viewport at 22px gutters. Body text holds 16px/1.75 — a book does not shrink its text to fit a smaller page, it shortens the line.</li>
				<li><b>Display type</b>56px → 38px → 25px in the phone frame. Serif headings keep weight 500 at every size; they never bold up to compensate for a small screen.</li>
				<li><b>The drop cap</b>Survives, at 40px instead of 62px. It is the one ornament worth keeping on a phone, and it stays clay.</li>
				<li><b>Cards</b>Three columns become one stack with 14px gaps. Padding drops 28px → 16px and the radius eases 28px → 20px, so the corner stays proportional to the box.</li>
				<li><b>Pills</b>Buttons keep the full radius and go full width for the primary action. Height 46px → 42px, still comfortably above the touch minimum.</li>
				<li><b>Navigation</b>The masthead links collapse to a single menu glyph. No bottom tab bar exists — this is a document, and documents scroll.</li>
				<li><b>Figures</b>Thin-line diagrams reflow to a vertical stack with the clay arrow rotated. Stroke weight stays 1.25px; hairlines are the drawing style, not a desktop detail.</li>
			</ul>
		</div>
	</section>

	<!-- 06 DON'T -->
	<section class="section">
		<p class="section-label">06 — Off-style, for contrast</p>
		<h2>What breaks the binding</h2>
		<div class="compare">
			<div class="cmp-off">Cool dark panel
				<small>Blue-gray neutrals · 6px corner · sans everywhere · glossy shadow · dark mode. Each one on its own is enough to make this stop looking like print.</small></div>
			<div class="cmp-on"><b>Same content, on-style</b>
				<small>Cream page, white card, 28px corner, warm hairline, serif heading at weight 500, no shadow. If it feels unhurried, it is right.</small></div>
		</div>
		<p class="note">Also out: clay-filled buttons or banners, tight dense grids, cool grays of any kind, and a dark theme — this system has one temperature.</p>
	</section>
</div>

<footer><div class="col">Vetta design reference — anthropic · cream, ink, one clay voice.</div></footer>
</body>
</html>
`;

const Netflix_THEME = `/* Netflix — cinematic black, one red, content is the interface. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #e50914;
	--color-primary-foreground: #ffffff;
	--color-surface: #141414;
	--color-surface-foreground: #ffffff;
	--color-surface-raised: #1f1f1f;
	--color-muted: #808080;
	--color-accent: #46d369;
	--color-danger: #eb3942;
	--color-border: #303030;

	--radius-sm: 2px;
	--radius-md: 4px;
	--radius-lg: 4px;
	--radius-xl: 8px;
	--radius-2xl: 12px;

	--shadow-sm: 0 2px 4px rgb(0 0 0 / 0.5);
	--shadow-md: 0 8px 20px rgb(0 0 0 / 0.6);
	--shadow-lg: 0 20px 60px rgb(0 0 0 / 0.8);
}
`;

const Netflix_SPEC = `# Netflix

## Atmosphere
A dark cinema where the interface disappears and posters glow. Black stage,
one red signature, sharp edges, big imagery. Everything says "press play".

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (#141414) everywhere; \`surface-raised\` for hover cards and rows.
- \`primary\` red for THE action (play/subscribe) and the logo moment — nothing
  else is red except \`danger\` states.
- \`accent\` green only for match percentages and "new" tags.
- Text white; secondary \`muted\`; \`border\` almost never — darkness separates.

## Typography
System font stack only. Cinematic scale:
- Hero titles \`font-black tracking-tight\` 40–64px, often on imagery.
- Shelf titles 18–20px \`font-bold\`; card meta 12–13px \`muted\`.
- Buttons 14–16px \`font-semibold\`.

## Shape & depth
- Sharp-ish: \`rounded-md\` (4px) on cards/buttons; nothing bubbly.
- Depth via image glow and \`shadow-lg\` on the hover-expanded card; gradients
  (black→transparent) anchor text onto artwork.

## Components
- Buttons: \`rounded-md\` h-10–12; primary solid red; secondary \`white/20\`
  translucent fill with white text (over imagery).
- Poster cards: 16:9 image, no chrome at rest; on hover scale up with
  \`shadow-lg\` and reveal a metadata strip on \`surface-raised\`.
- Hero: full-bleed artwork, left-aligned title block over a horizontal
  gradient, two buttons.
- Badges: tiny red "N", green match % \`font-bold\`, \`muted\` maturity chips
  with 1px border.

## Layout
Horizontal shelves over a full-width canvas; rows of 4–6 posters with 8–12px
gaps (tight — imagery forms a wall). Page gutters 40–56px. Vertical rhythm by
shelf (32–40px between).

## Don'ts
- No white backgrounds, no cards with visible borders, no rounded-xl.
- Red never fills panels or decorates text; it is the action color.
- Never crowd artwork with UI chrome — text sits on gradients, not boxes.
`;

const Netflix_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Netflix — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #e50914;
		--color-primary-foreground: #ffffff;
		--color-surface: #141414;
		--color-surface-foreground: #ffffff;
		--color-surface-raised: #1f1f1f;
		--color-muted: #808080;
		--color-accent: #46d369;
		--color-danger: #eb3942;
		--color-border: #303030;

		--radius-sm: 2px;
		--radius-md: 4px;
		--radius-lg: 4px;
		--radius-xl: 8px;
		--radius-2xl: 12px;

		--shadow-sm: 0 2px 4px rgb(0 0 0 / 0.5);
		--shadow-md: 0 8px 20px rgb(0 0 0 / 0.6);
		--shadow-lg: 0 20px 60px rgb(0 0 0 / 0.8);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
	p { margin: 0; }
	::selection { background: rgb(229 9 20 / 0.5); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	/* ── Chrome floats over the artwork; it never sits in a bar ───── */
	.topbar {
		position: absolute; top: 0; left: 0; right: 0; z-index: 3;
		display: flex; align-items: center; gap: 22px;
		padding: 18px 20px;
		background: linear-gradient(180deg, rgb(0 0 0 / 0.75), transparent);
	}
	@media (min-width: 768px) { .topbar { padding: 20px 48px; } }
	.wordmark { color: var(--color-primary); font-weight: 800; font-size: 24px; letter-spacing: -0.04em; }
	.topnav { display: none; gap: 18px; font-size: 14px; color: #e5e5e5; }
	@media (min-width: 820px) { .topnav { display: flex; } }
	.topnav .is-active { font-weight: 700; }
	.profile { width: 30px; height: 30px; border-radius: var(--radius-md); background: linear-gradient(135deg, #e50914, #7a0009); }

	/* ── Hero: full-bleed artwork, gradient anchors the text ──────── */
	.hero { position: relative; min-height: 480px; display: flex; align-items: flex-end; overflow: hidden; }
	@media (min-width: 768px) { .hero { min-height: 620px; } }
	.hero-art {
		position: absolute; inset: 0;
		background:
			radial-gradient(120% 90% at 78% 22%, #6b1015 0%, #2a0508 45%, #141414 82%),
			linear-gradient(115deg, #1b1b1b, #141414);
	}
	/* Two gradients: one horizontal to hold the text, one vertical to the shelf. */
	.hero-scrim-h { position: absolute; inset: 0; background: linear-gradient(90deg, rgb(20 20 20 / 0.95) 0%, rgb(20 20 20 / 0.55) 42%, transparent 70%); }
	.hero-scrim-v { position: absolute; left: 0; right: 0; bottom: 0; height: 200px; background: linear-gradient(180deg, transparent, var(--color-surface)); }
	.hero-body { position: relative; z-index: 2; padding: 0 20px 56px; max-width: 640px; }
	@media (min-width: 768px) { .hero-body { padding: 0 48px 88px; } }
	.hero .kick { display: flex; align-items: center; gap: 8px; font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; color: #e5e5e5; }
	.nbadge { color: var(--color-primary); font-weight: 800; font-size: 15px; }
	.hero h1 { font-size: 42px; margin: 14px 0 0; }
	@media (min-width: 768px) { .hero h1 { font-size: 68px; } }
	.hero .meta { display: flex; align-items: center; gap: 12px; margin-top: 16px; font-size: 14px; flex-wrap: wrap; }
	.match { color: var(--color-accent); font-weight: 700; }
	.chip-age { border: 1px solid rgb(255 255 255 / 0.4); padding: 0 7px; font-size: 12px; color: #e5e5e5; }
	.hero p { margin-top: 16px; font-size: 16px; color: #e0e0e0; max-width: 46ch; text-shadow: 0 1px 4px rgb(0 0 0 / 0.6); }
	.hero .actions { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }

	/* ── Buttons: 4px radius, red is THE action ───────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 600;
		height: 44px; padding: 0 24px;
		border: 0; border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; display: inline-flex; align-items: center; gap: 9px;
		transition: background-color 140ms ease, opacity 140ms ease;
	}
	.btn:hover { background: #f6121d; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(255 255 255 / 0.7); }
	/* Secondary is translucent white — it has to work on top of any frame. */
	.btn-glass { background: rgb(109 109 110 / 0.7); color: #fff; }
	.btn-glass:hover { background: rgb(109 109 110 / 0.5); }
	.btn-white { background: #fff; color: #141414; }
	.btn-white:hover { background: rgb(255 255 255 / 0.82); }
	.btn[disabled] { cursor: not-allowed; background: #3a3a3a; color: #8c8c8c; }

	/* ── Shelves: tight gaps, imagery forms a wall ────────────────── */
	.shelf { padding: 0 20px 34px; }
	@media (min-width: 768px) { .shelf { padding: 0 48px 40px; } }
	.shelf-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
	.shelf-head h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
	@media (min-width: 768px) { .shelf-head h2 { font-size: 20px; } }
	.shelf-head span { font-size: 12px; color: var(--color-muted); letter-spacing: 0.08em; text-transform: uppercase; }
	.rowposters { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
	@media (min-width: 620px) { .rowposters { grid-template-columns: repeat(4, 1fr); gap: 10px; } }
	@media (min-width: 1000px) { .rowposters { grid-template-columns: repeat(6, 1fr); gap: 10px; } }
	/* At rest a poster has no chrome at all. */
	.poster { border-radius: var(--radius-md); overflow: hidden; position: relative; transition: transform 220ms ease, box-shadow 220ms ease; background: var(--color-surface-raised); }
	.poster:hover { transform: scale(1.08); box-shadow: var(--shadow-lg); z-index: 2; }
	.poster .art { aspect-ratio: 16/9; display: grid; place-items: center; font-weight: 800; font-size: 20px; letter-spacing: -0.03em; color: rgb(255 255 255 / 0.9); }
	.poster .strip { background: var(--color-surface-raised); padding: 8px 10px 10px; display: none; }
	.poster:hover .strip { display: block; }
	.poster .strip .line1 { display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.poster .strip .line2 { font-size: 11px; color: var(--color-muted); margin-top: 4px; }
	.play-dot { width: 22px; height: 22px; border-radius: 50%; background: #fff; color: #141414; display: grid; place-items: center; font-size: 9px; }
	.top10 { position: absolute; left: 0; top: 0; background: var(--color-primary); color: #fff; font-size: 10px; font-weight: 800; padding: 2px 5px; letter-spacing: 0.06em; }

	/* ── Reference sections ───────────────────────────────────────── */
	.wrap { max-width: 1160px; margin: 0 auto; padding: 0 20px 90px; }
	@media (min-width: 768px) { .wrap { padding: 0 48px 112px; } }
	.section { padding-top: 52px; }
	.section-label { font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 10px; }
	.section h2 { font-size: 28px; }
	@media (min-width: 768px) { .section h2 { font-size: 34px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; font-size: 15px; }
	.note { margin-top: 18px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 60px; border-radius: var(--radius-md); }
	.sw b { display: block; font-size: 13px; font-weight: 700; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 280px 1fr; gap: 44px; } }
	.phone {
		width: 280px; max-width: 100%; margin: 0 auto;
		border-radius: 22px; overflow: hidden; background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 9px 16px 4px; font-size: 10px; color: #e5e5e5; position: relative; z-index: 3; }
	.m-hero { position: relative; height: 300px; display: flex; align-items: flex-end; margin-top: -22px; }
	/* Portrait artwork on phones — the frame changes, the treatment doesn't. */
	.m-hero .art { position: absolute; inset: 0; background: radial-gradient(120% 80% at 60% 22%, #6b1015, #2a0508 55%, #141414 90%); }
	.m-hero .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgb(0 0 0 / 0.5) 0%, transparent 30%, rgb(20 20 20 / 0.95) 92%); }
	.m-hero .body { position: relative; z-index: 2; padding: 0 14px 12px; text-align: center; width: 100%; }
	.m-hero h5 { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; margin: 0; }
	.m-hero .meta { font-size: 10px; color: #d0d0d0; margin-top: 6px; }
	.m-hero .btns { display: flex; gap: 6px; margin-top: 10px; }
	.m-hero .btns .btn { flex: 1; height: 32px; font-size: 12px; padding: 0 10px; justify-content: center; }
	.m-shelf { padding: 12px 14px 4px; }
	.m-shelf h6 { margin: 0 0 8px; font-size: 13px; font-weight: 700; }
	.m-row { display: flex; gap: 6px; }
	.m-row .p { flex: 1; aspect-ratio: 2/3; border-radius: var(--radius-md); display: grid; place-items: center; font-size: 11px; font-weight: 800; color: rgb(255 255 255 / 0.85); }
	.m-tabs { display: flex; background: #0b0b0b; margin-top: 10px; }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 13px; }
	.m-tabs .is-active { color: #fff; font-weight: 600; }
	.m-tabs .g { display: block; width: 16px; height: 16px; border: 1.6px solid currentColor; border-radius: 3px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 3px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 20px; border-radius: 18px; background: var(--color-surface-raised); border: 1px solid #4a4a4a; font-size: 15px; font-weight: 700; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 0; border-radius: var(--radius-md); overflow: hidden; }
	.cmp-on .art { aspect-ratio: 16/9; background: radial-gradient(110% 90% at 70% 25%, #6b1015, #2a0508 60%, #141414); display: flex; align-items: flex-end; padding: 14px; font-size: 15px; font-weight: 700; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the browse screen. Artwork is the page; chrome floats on gradients
     and there is exactly one red thing on screen. -->
<div class="hero">
	<div class="hero-art"></div>
	<div class="hero-scrim-h"></div>
	<div class="hero-scrim-v"></div>

	<div class="topbar">
		<span class="wordmark">VETTA</span>
		<nav class="topnav"><span class="is-active">Home</span><span>Series</span><span>Films</span><span>New &amp; popular</span><span>My list</span></nav>
		<span class="spacer"></span>
		<span style="font-size:15px">⌕</span>
		<span class="profile"></span>
	</div>

	<div class="hero-body">
		<div class="kick"><span class="nbadge">V</span> Series</div>
		<h1>The Hairline</h1>
		<div class="meta">
			<span class="match">97% match</span>
			<span>2026</span>
			<span class="chip-age">16+</span>
			<span>3 seasons</span>
			<span class="chip-age">4K HDR</span>
		</div>
		<p>A design team discovers that everything holding their interface together is one pixel
			wide — and that someone has been quietly removing it.</p>
		<div class="actions">
			<button class="btn btn-white">▶ Play</button>
			<button class="btn btn-glass">＋ My list</button>
			<button class="btn btn-glass">ⓘ More info</button>
		</div>
	</div>
</div>

<div class="shelf">
	<div class="shelf-head"><h2>Trending now</h2><span>Explore all ›</span></div>
	<div class="rowposters">
		<div class="poster"><span class="top10">TOP 10</span><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #7a1015, #24070a)">S1</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">98%</span><span class="chip-age">16+</span></div><div class="line2">Thriller · Design · 3 seasons</div></div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #14406b, #061323)">S2</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">91%</span><span class="chip-age">12+</span></div><div class="line2">Documentary · 1 season</div></div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #4b1d6b, #170824)">S3</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">88%</span><span class="chip-age">18+</span></div><div class="line2">Drama · Limited series</div></div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #6b4a10, #241704)">S4</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">94%</span><span class="chip-age">12+</span></div><div class="line2">Comedy · 2 seasons</div></div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #106b4a, #04241a)">S5</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">85%</span><span class="chip-age">16+</span></div><div class="line2">Sci-fi · Film</div></div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #6b1046, #240418)">S6</div>
			<div class="strip"><div class="line1"><span class="play-dot">▶</span><span class="match">90%</span><span class="chip-age">16+</span></div><div class="line2">Mystery · 4 seasons</div></div></div>
	</div>
</div>

<div class="shelf">
	<div class="shelf-head"><h2>Continue watching</h2></div>
	<div class="rowposters">
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #33383f, #121417)">E4</div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #3f3327, #17130e)">E2</div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #27333f, #0e1317)">E7</div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #3f2733, #170e13)">E1</div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #2b3f27, #101710)">E9</div></div>
		<div class="poster"><div class="art" style="background:radial-gradient(100% 100% at 30% 20%, #3a3f27, #15170e)">E3</div></div>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Artwork first</p>
		<h2>The interface disappears</h2>
		<p class="lede">A poster at rest has no border, no label, no radius beyond 4px and no shadow.
			All of that arrives on hover: the card scales to 1.08, takes <code>shadow-lg</code>, and reveals a
			metadata strip. Text over artwork always sits on a gradient — never in a box.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#e50914 · the action</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#46d369 · match % only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#141414 · the stage</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#1f1f1f · hover strip</span></div>
		</div>
		<p class="note">Red belongs to the wordmark, the Top 10 flag and the play button. It never fills a panel, tints a background or colors a paragraph.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Controls</p>
		<h2>Solid, translucent, done</h2>
		<div class="row" style="margin-top: 22px;">
			<button class="btn btn-white">▶ Play</button>
			<button class="btn">Subscribe</button>
			<button class="btn btn-glass">＋ My list</button>
			<button class="btn" disabled>Unavailable</button>
		</div>
		<p class="note">Secondary buttons are a translucent gray-white fill, because they usually sit on top of artwork and cannot rely on a fixed background. Radius stays at 4px — nothing in this system is bubbly.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Landscape shelves become portrait walls</h2>
		<p class="lede">The one real change on a phone is aspect ratio: 16:9 stills give way to 2:3
			portrait art, because a phone screen is tall and six thumbnails per row would be unreadable.
			Everything else — gradients, sharp corners, one red button — is unchanged.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="m-hero">
					<div class="art"></div><div class="scrim"></div>
					<div class="body">
						<h5>The Hairline</h5>
						<div class="meta">Thriller · Design · Mystery</div>
						<div class="btns">
							<button class="btn btn-white">▶ Play</button>
							<button class="btn btn-glass">＋ List</button>
						</div>
					</div>
				</div>
				<div class="m-shelf">
					<h6>Trending now</h6>
					<div class="m-row">
						<span class="p" style="background:radial-gradient(100% 100% at 30% 20%, #7a1015, #24070a)">S1</span>
						<span class="p" style="background:radial-gradient(100% 100% at 30% 20%, #14406b, #061323)">S2</span>
						<span class="p" style="background:radial-gradient(100% 100% at 30% 20%, #4b1d6b, #170824)">S3</span>
					</div>
				</div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Home</div>
					<div><span class="g"></span>New</div>
					<div><span class="g"></span>Search</div>
					<div><span class="g"></span>Downloads</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Aspect ratio</b>16:9 → 2:3. Three portrait posters per row instead of six landscape ones, still at 6–8px gaps so the artwork keeps forming a wall.</li>
				<li><b>Hero</b>The horizontal scrim becomes a vertical one and the text block centers. Title 68px → 24px; the synopsis is dropped entirely in favour of a genre line.</li>
				<li><b>Hover states</b>There are none. The scale-and-reveal card becomes a tap that opens the title page, so no metadata is stranded behind an interaction the device cannot perform.</li>
				<li><b>Buttons</b>Play and My List pair up full width at 32–44px. Play stays white-on-dark; the translucent gray secondary still works over any artwork.</li>
				<li><b>Chrome</b>The top nav collapses to the wordmark and profile over a gradient, never a solid bar. The four destinations move to a bottom tab bar on near-black.</li>
				<li><b>Gutters</b>48px → 14px. Artwork is allowed to run closer to the edge on a phone; that is what makes it feel full-bleed.</li>
				<li><b>Badges</b>Match percentage, maturity chip and the red Top 10 flag all keep their exact desktop treatment — they are small enough to survive untouched.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the cinema</h2>
		<div class="compare">
			<div class="cmp-off">Bordered rounded card
				<small>18px radius · visible 1px border · a chrome box wrapped around content. Borders and big radii both announce the interface, which is exactly what this system refuses to do.</small></div>
			<div class="cmp-on"><div class="art">Same content, on-style</div>
				<small>4px radius, no border, artwork to the edges, text sitting on a gradient. Darkness does the separating.</small></div>
		</div>
		<p class="note">Also out: white backgrounds, red as a panel fill or text color, and any UI chrome crowded on top of artwork without a gradient underneath it.</p>
	</section>
</div>

</body>
</html>
`;

const Airbnb_THEME = `/* Airbnb — warm white hospitality, coral rausch, soft cards. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #ff385c;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #222222;
	--color-surface-raised: #f7f7f7;
	--color-muted: #717171;
	--color-accent: #00a699;
	--color-danger: #c13515;
	--color-border: #dddddd;

	--radius-sm: 8px;
	--radius-md: 10px;
	--radius-lg: 12px;
	--radius-xl: 16px;
	--radius-2xl: 24px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.08);
	--shadow-md: 0 6px 16px rgb(0 0 0 / 0.12);
	--shadow-lg: 0 16px 40px rgb(0 0 0 / 0.16);
}
`;

const Airbnb_SPEC = `# Airbnb

## Atmosphere
Warm hospitality. Clean white, friendly rounded cards, photography doing the
talking, and one coral heartbeat. Feels human, trustworthy, vacation-ready.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white; \`surface-raised\` for chips, secondary panels, footers.
- \`primary\` (rausch coral) for CTAs, likes, active filters — the only loud
  color, and it must not sprawl: one coral moment per view.
- \`accent\` (teal) tiny: superhost/verified badges.
- Ink \`surface-foreground\`; supporting copy \`muted\`.

## Typography
System font stack only. Rounded-feeling and warm:
- Headings \`font-semibold\` 22–32px; card titles 15–16px \`font-medium\`.
- Body 14–16px; metadata 12–14px \`muted\`.
- Prices bold; ratings with a small star glyph, 14px.

## Shape & depth
- Soft radii: cards \`rounded-xl\` (12–16px), search/pills \`rounded-full\`.
- Photos are \`rounded-xl\` and edge-to-edge inside cards.
- \`shadow-sm\` rest, \`shadow-md\` hover; the floating search pill uses shadow +
  hairline border.

## Components
- Buttons: h-11 \`rounded-lg\`; primary coral filled; secondary black-bordered
  white; text links underlined black.
- Listing card: photo top (4:3, rounded), title/meta/price stack, heart icon
  top-right on the photo.
- Filter chips: bordered pills, selected = black fill white text.
- Search bar: white pill, \`shadow-md\`, segmented labels divided by hairlines.

## Layout
Card grids 2–4 columns, gaps 24px; page gutters 24–48px. Sticky white header
with hairline bottom border. Generous section spacing (48px+).

## Don'ts
- Coral never fills large areas or backgrounds — buttons and icons only.
- No dark theme, no sharp corners, no heavy black shadows.
- Don't crowd cards; photos need whitespace to breathe.
`;

const Airbnb_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Airbnb — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #ff385c;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #222222;
		--color-surface-raised: #f7f7f7;
		--color-muted: #717171;
		--color-accent: #00a699;
		--color-danger: #c13515;
		--color-border: #dddddd;

		--radius-sm: 8px;
		--radius-md: 10px;
		--radius-lg: 12px;
		--radius-xl: 16px;
		--radius-2xl: 24px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.08);
		--shadow-md: 0 6px 16px rgb(0 0 0 / 0.12);
		--shadow-lg: 0 16px 40px rgb(0 0 0 / 0.16);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 15px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
	p { margin: 0; }
	::selection { background: rgb(255 56 92 / 0.22); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	.wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px; }
	@media (min-width: 900px) { .wrap { padding: 0 48px; } }

	/* ── Sticky white header with the floating search pill ────────── */
	.header { border-bottom: 1px solid var(--color-border); padding: 16px 0; }
	.header-inner { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
	.logo { display: flex; align-items: center; gap: 8px; color: var(--color-primary); font-weight: 700; font-size: 19px; letter-spacing: -0.02em; }
	.logo .mk { width: 24px; height: 24px; border-radius: 50% 50% 50% 6px; background: var(--color-primary); }
	/* Segmented pill divided by hairlines — the signature control. */
	.searchpill {
		display: none; align-items: center;
		border: 1px solid var(--color-border); border-radius: 9999px;
		box-shadow: var(--shadow-sm); height: 48px; padding: 0 6px 0 0;
		font-size: 14px; background: var(--color-surface);
	}
	@media (min-width: 820px) { .searchpill { display: flex; } }
	.searchpill .seg { padding: 0 18px; border-right: 1px solid var(--color-border); }
	.searchpill .seg:last-of-type { border-right: 0; }
	.searchpill .seg b { display: block; font-size: 12px; font-weight: 600; }
	.searchpill .seg span { font-size: 13px; color: var(--color-muted); }
	.searchpill .go { width: 34px; height: 34px; border-radius: 50%; background: var(--color-primary); color: #fff; display: grid; place-items: center; font-size: 14px; }
	.usermenu { display: flex; align-items: center; gap: 10px; border: 1px solid var(--color-border); border-radius: 9999px; padding: 5px 6px 5px 12px; box-shadow: none; }
	.usermenu:hover { box-shadow: var(--shadow-sm); }
	.usermenu .av { width: 30px; height: 30px; border-radius: 50%; background: var(--color-surface-foreground); }

	/* ── Filter chips ─────────────────────────────────────────────── */
	.filters { display: flex; gap: 12px; padding: 20px 0 8px; overflow-x: auto; }
	.chip {
		display: inline-flex; align-items: center; gap: 8px; flex: none;
		border: 1px solid var(--color-border); border-radius: 9999px;
		padding: 8px 16px; font-size: 14px; background: var(--color-surface);
		white-space: nowrap;
	}
	.chip.is-selected { background: var(--color-surface-foreground); color: #fff; border-color: var(--color-surface-foreground); }
	.chip .g { width: 16px; height: 16px; border: 1.5px solid currentColor; border-radius: 4px; opacity: 0.75; }

	/* ── Listing cards: photo-led, heart on the image ─────────────── */
	.grid { display: grid; grid-template-columns: repeat(1, 1fr); gap: 24px; padding: 20px 0 56px; }
	@media (min-width: 560px) { .grid { grid-template-columns: repeat(2, 1fr); } }
	@media (min-width: 900px) { .grid { grid-template-columns: repeat(4, 1fr); } }
	.listing { min-width: 0; }
	.photo {
		position: relative; aspect-ratio: 4/3; border-radius: var(--radius-lg); overflow: hidden;
		background: linear-gradient(140deg, #e9d9c9, #cdb6a1);
	}
	.photo .heart {
		position: absolute; right: 12px; top: 12px; font-size: 19px; line-height: 1;
		color: rgb(255 255 255 / 0.9); text-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
	}
	.photo .heart.liked { color: var(--color-primary); }
	.photo .flag {
		position: absolute; left: 12px; top: 12px; background: var(--color-surface);
		border-radius: 9999px; padding: 4px 10px; font-size: 12px; font-weight: 600;
		box-shadow: var(--shadow-sm);
	}
	.photo .dots { position: absolute; left: 0; right: 0; bottom: 10px; display: flex; justify-content: center; gap: 5px; }
	.photo .dots i { width: 5px; height: 5px; border-radius: 50%; background: rgb(255 255 255 / 0.6); }
	.photo .dots i:first-child { background: #fff; }
	.listing .l1 { display: flex; align-items: baseline; gap: 8px; margin-top: 12px; }
	.listing .l1 b { font-weight: 500; font-size: 15px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.listing .rating { margin-left: auto; font-size: 14px; display: flex; align-items: center; gap: 4px; flex: none; }
	.listing .meta { font-size: 14px; color: var(--color-muted); margin-top: 2px; }
	.listing .price { margin-top: 8px; font-size: 15px; }
	.listing .price b { font-weight: 600; }
	.badge-teal { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--color-accent); font-weight: 600; margin-top: 6px; }
	.badge-teal .d { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

	/* ── Reference sections ───────────────────────────────────────── */
	.section { padding: 48px 0; border-top: 1px solid var(--color-border); }
	@media (min-width: 768px) { .section { padding: 64px 0; } }
	.section-label { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 10px; }
	.section h2 { font-size: 26px; }
	@media (min-width: 768px) { .section h2 { font-size: 32px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; }
	.note { margin-top: 18px; font-size: 14px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Buttons: 44px, coral for the one ask ─────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 600;
		height: 44px; padding: 0 22px;
		border: 1px solid transparent; border-radius: var(--radius-sm);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 150ms ease, transform 150ms ease;
	}
	.btn:hover { background: #e0304f; }
	.btn:active { transform: scale(0.98); }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--color-surface-foreground); }
	.btn-outline { background: var(--color-surface); color: var(--color-surface-foreground); border-color: var(--color-surface-foreground); }
	.btn-outline:hover { background: var(--color-surface-raised); }
	.btn-link { background: transparent; color: var(--color-surface-foreground); text-decoration: underline; padding: 0 8px; }
	.btn-link:hover { background: var(--color-surface-raised); }
	.btn[disabled] { cursor: not-allowed; background: #ebebeb; color: #b0b0b0; }
	.btn-pill { border-radius: 9999px; }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 340px; height: 52px; padding: 0 16px;
		border: 1px solid var(--color-border); border-radius: var(--radius-sm);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: var(--color-muted); }
	.input:focus { outline: none; border-color: var(--color-surface-foreground); box-shadow: 0 0 0 1px var(--color-surface-foreground); }

	/* Booking panel: the one heavily shadowed object on a listing page. */
	.bookcard { border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); padding: 22px; max-width: 370px; }
	.bookcard .top { display: flex; align-items: baseline; gap: 6px; }
	.bookcard .top b { font-size: 21px; font-weight: 600; }
	.datebox { border: 1px solid var(--color-border); border-radius: var(--radius-sm); margin-top: 16px; overflow: hidden; }
	.datebox .r { display: flex; }
	.datebox .c { flex: 1; padding: 9px 12px; border-right: 1px solid var(--color-border); }
	.datebox .c:last-child { border-right: 0; }
	.datebox .c b { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
	.datebox .c span { font-size: 14px; }
	.datebox .r + .r .c { border-top: 1px solid var(--color-border); }
	.bookrow { display: flex; justify-content: space-between; font-size: 15px; padding: 10px 0; }
	.bookrow.total { border-top: 1px solid var(--color-border); font-weight: 600; margin-top: 6px; padding-top: 16px; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 62px; border-radius: var(--radius-lg); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 13px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 288px 1fr; gap: 44px; } }
	.phone {
		width: 288px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 30px;
		overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-md);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 11px 18px 6px; font-size: 10px; color: var(--color-muted); }
	/* The search pill collapses to one line but keeps its shadow and radius. */
	.m-search { margin: 4px 14px 10px; border: 1px solid var(--color-border); border-radius: 9999px; box-shadow: var(--shadow-sm); padding: 9px 14px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.m-search b { font-weight: 600; }
	.m-chips { display: flex; gap: 8px; padding: 0 14px 10px; overflow: hidden; }
	.m-chips .chip { font-size: 11px; padding: 5px 11px; }
	.m-listing { padding: 0 14px 12px; }
	.m-listing .photo { aspect-ratio: 1; border-radius: var(--radius-lg); }
	.m-listing .l1 { margin-top: 8px; }
	.m-listing .l1 b { font-size: 13px; }
	.m-listing .rating { font-size: 12px; }
	.m-listing .meta, .m-listing .price { font-size: 12px; }
	.m-tabs { display: flex; border-top: 1px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 13px; }
	.m-tabs .is-active { color: var(--color-primary); font-weight: 600; }
	.m-tabs .g { display: block; width: 17px; height: 17px; border: 1.6px solid currentColor; border-radius: 5px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 15px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 24px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 4px; background: var(--color-primary); color: #fff; font-size: 16px; font-weight: 600; box-shadow: 0 10px 26px rgb(0 0 0 / 0.35); }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; opacity: 0.92; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-lg); background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); font-size: 16px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	footer { background: var(--color-surface-raised); border-top: 1px solid var(--color-border); padding: 28px 0 48px; font-size: 13px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — the search results page. Photography leads, chrome is a hairline,
     and there is exactly one coral moment on screen. -->
<header class="header">
	<div class="wrap header-inner">
		<span class="logo"><span class="mk"></span>vetta</span>
		<span class="spacer"></span>
		<span class="searchpill">
			<span class="seg"><b>Anywhere</b></span>
			<span class="seg"><b>Any week</b></span>
			<span class="seg"><span>Add guests</span></span>
			<span class="go">⌕</span>
		</span>
		<span class="spacer"></span>
		<button class="btn btn-link">Vetta your home</button>
		<span class="usermenu"><span>☰</span><span class="av"></span></span>
	</div>
</header>

<div class="wrap">
	<div class="filters">
		<span class="chip is-selected"><span class="g"></span>All</span>
		<span class="chip"><span class="g"></span>Cabins</span>
		<span class="chip"><span class="g"></span>Design</span>
		<span class="chip"><span class="g"></span>Lakefront</span>
		<span class="chip"><span class="g"></span>Tiny homes</span>
		<span class="chip"><span class="g"></span>Countryside</span>
		<span class="chip"><span class="g"></span>Amazing views</span>
	</div>

	<div class="grid">
		<div class="listing">
			<div class="photo" style="background:linear-gradient(140deg,#e9d9c9,#b99f86)">
				<span class="flag">Guest favourite</span><span class="heart liked">♥</span>
				<span class="dots"><i></i><i></i><i></i><i></i><i></i></span>
			</div>
			<div class="l1"><b>Cabin in Hakone</b><span class="rating">★ 4.94</span></div>
			<div class="meta">Mountain and forest views</div>
			<div class="meta">18–23 Apr</div>
			<div class="price"><b>¥24,800</b> night</div>
			<div class="badge-teal"><span class="d"></span>Superhost</div>
		</div>

		<div class="listing">
			<div class="photo" style="background:linear-gradient(140deg,#cfd9e3,#94a7bd)">
				<span class="heart">♡</span>
				<span class="dots"><i></i><i></i><i></i><i></i><i></i></span>
			</div>
			<div class="l1"><b>Loft in Lisbon</b><span class="rating">★ 4.87</span></div>
			<div class="meta">City skyline view</div>
			<div class="meta">2–7 May</div>
			<div class="price"><b>€142</b> night</div>
		</div>

		<div class="listing">
			<div class="photo" style="background:linear-gradient(140deg,#dfe6d5,#a5b592)">
				<span class="flag">New</span><span class="heart">♡</span>
				<span class="dots"><i></i><i></i><i></i><i></i><i></i></span>
			</div>
			<div class="l1"><b>Farmhouse in Umbria</b><span class="rating">★ 5.0</span></div>
			<div class="meta">Olive grove and pool</div>
			<div class="meta">9–14 Jun</div>
			<div class="price"><b>€210</b> night</div>
			<div class="badge-teal"><span class="d"></span>Superhost</div>
		</div>

		<div class="listing">
			<div class="photo" style="background:linear-gradient(140deg,#e6dbe9,#b39ec0)">
				<span class="heart">♡</span>
				<span class="dots"><i></i><i></i><i></i><i></i><i></i></span>
			</div>
			<div class="l1"><b>Studio in Copenhagen</b><span class="rating">★ 4.78</span></div>
			<div class="meta">Canal-side, walk everywhere</div>
			<div class="meta">21–26 May</div>
			<div class="price"><b>kr 1,180</b> night</div>
		</div>
	</div>

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Photography first</p>
		<h2>The card is a photo with words under it</h2>
		<p class="lede">A 4:3 image at 12px radius, then title and rating on one line, two muted meta
			lines, and a bold price. No box, no border, no background — the card is defined by the
			photograph and the whitespace around it.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#ff385c · one moment</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#00a699 · superhost only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#f7f7f7 · chips, footer</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>ink</b><span>#222 · selected chips</span></div>
		</div>
		<p class="note">Selected filter chips fill with ink, not coral. Coral is spent on the search button, the liked heart and the reserve CTA — one per view, never as a background.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Controls</p>
		<h2>Rounded, roomy, unhurried</h2>
		<div class="row" style="margin-top: 24px;">
			<button class="btn">Reserve</button>
			<button class="btn btn-outline">Save</button>
			<button class="btn btn-link">Show all 240 photos</button>
			<button class="btn" disabled>Unavailable</button>
		</div>
		<div class="row" style="margin-top: 20px; align-items: flex-start;">
			<input class="input" placeholder="Where are you going?">
			<div class="bookcard">
				<div class="top"><b>¥24,800</b><span class="muted">night</span><span class="spacer"></span><span style="font-size:14px">★ 4.94 · <span class="muted">128 reviews</span></span></div>
				<div class="datebox">
					<div class="r">
						<div class="c"><b>Check-in</b><span>18/04/2026</span></div>
						<div class="c"><b>Checkout</b><span>23/04/2026</span></div>
					</div>
					<div class="r"><div class="c"><b>Guests</b><span>2 guests</span></div></div>
				</div>
				<button class="btn btn-pill" style="width:100%;margin-top:16px;height:48px">Reserve</button>
				<p class="muted" style="text-align:center;font-size:13px;margin-top:10px">You won't be charged yet</p>
				<div class="bookrow"><span style="text-decoration:underline">¥24,800 × 5 nights</span><span>¥124,000</span></div>
				<div class="bookrow"><span style="text-decoration:underline">Cleaning fee</span><span>¥6,400</span></div>
				<div class="bookrow total"><span>Total before taxes</span><span>¥130,400</span></div>
			</div>
		</div>
		<p class="note">The booking panel is the only element on a listing page carrying <code>shadow-md</code>. Everything else rests on hairlines.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>One photo at a time</h2>
		<p class="lede">The four-column grid becomes a single column of square photos, and the segmented
			search pill collapses into one tappable line that still carries its shadow and full radius.
			Booking moves to a bar pinned above the home indicator.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="m-search"><span>⌕</span><b>Hakone</b><span class="muted">· 18–23 Apr · 2 guests</span></div>
				<div class="m-chips">
					<span class="chip is-selected">All</span><span class="chip">Cabins</span><span class="chip">Design</span><span class="chip">Lake</span>
				</div>
				<div class="m-listing">
					<div class="photo" style="background:linear-gradient(140deg,#e9d9c9,#b99f86)">
						<span class="flag" style="font-size:10px;padding:3px 8px">Guest favourite</span>
						<span class="heart liked">♥</span>
						<span class="dots"><i></i><i></i><i></i><i></i><i></i></span>
					</div>
					<div class="l1"><b>Cabin in Hakone</b><span class="rating">★ 4.94</span></div>
					<div class="meta">Mountain and forest views</div>
					<div class="price"><b>¥24,800</b> night</div>
				</div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Explore</div>
					<div><span class="g"></span>Wishlists</div>
					<div><span class="g"></span>Trips</div>
					<div><span class="g"></span>Profile</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Grid</b>4 columns → 2 → 1, gaps staying at 24px. Photos go 4:3 → 1:1 on the phone, because a square gives the image more of a tall screen.</li>
				<li><b>Search pill</b>Collapses from three segments to one summary line — destination bold, dates and guests muted — but keeps the full pill radius, the hairline and <code>shadow-sm</code>. It stays sticky at the top.</li>
				<li><b>Filter chips</b>Scroll horizontally with no scrollbar and no fade. Selected still fills with ink, so the coral budget is untouched.</li>
				<li><b>Photo carousel</b>The dot indicator stays on the image at the same size — it is the affordance for swiping, and it is one of the few controls that is genuinely better on touch.</li>
				<li><b>Booking</b>The shadowed side panel becomes a bar pinned to the bottom: price and rating left, a full-radius coral Reserve button right.</li>
				<li><b>Type</b>Headings 32px → 26px, card titles 15px → 13px, body stays 14–15px. Prices never shrink — they are what the row is for.</li>
				<li><b>Targets</b>Buttons stay 44px+, the heart gets a 44px hit area even though the glyph is 19px, and chips grow their vertical padding rather than their text.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the welcome</h2>
		<div class="compare">
			<div class="cmp-off">Coral as a background
				<small>Full coral panel · 4px corners · heavy black shadow. Coral is a heartbeat, not a wallpaper; spread across a surface it stops meaning "this is the action".</small></div>
			<div class="cmp-on">Same content, on-style
				<small>White surface, 12px radius, hairline border, soft shadow, ink text. Coral waits on the one button that books something.</small></div>
		</div>
		<p class="note">Also out: a dark theme, sharp corners, heavy black shadows, and crowding cards until the photography has no room to breathe.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — airbnb · warm white, one coral, photography first.</div></footer>
</body>
</html>
`;

const Duolingo_THEME = `/* Duolingo — chunky playful, feather green, 3D-press buttons. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #58cc02;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #4b4b4b;
	--color-surface-raised: #f7f7f7;
	--color-muted: #777777;
	--color-accent: #1cb0f6;
	--color-danger: #ff4b4b;
	--color-border: #e5e5e5;

	--radius-sm: 8px;
	--radius-md: 12px;
	--radius-lg: 16px;
	--radius-xl: 20px;
	--radius-2xl: 28px;

	--shadow-sm: 0 2px 0 rgb(0 0 0 / 0.12);
	--shadow-md: 0 4px 0 rgb(0 0 0 / 0.15);
	--shadow-lg: 0 8px 24px rgb(0 0 0 / 0.15);
}
`;

const Duolingo_SPEC = `# Duolingo

## Atmosphere
A cheerful game that happens to teach. Feather-green energy, chunky rounded
shapes, buttons that physically press down. Loud, friendly, impossible to
feel intimidated by.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white; \`surface-raised\` for wells and locked/disabled states.
- \`primary\` green is everywhere it counts: CTAs, correct answers, progress.
- \`accent\` (sky blue) for secondary actions and informational moments.
- \`danger\` (soft red) for hearts/mistakes; \`muted\` for locked/secondary text.
- Bonus voices via soft tints (\`accent/15\`, \`primary/15\`) on cards.

## Typography
System font stack only. Chunky and loud:
- Headings \`font-extrabold\` 22–32px; buttons \`font-bold uppercase
  tracking-wide\` 14–15px.
- Body 15–17px \`font-medium\`; stats/streaks \`font-extrabold\` with icon.
- Everything slightly bolder than feels reasonable — that's the voice.

## Shape & depth
- Big radii: cards \`rounded-2xl\` (16–28px), buttons \`rounded-xl\`.
- The 3D press: buttons and cards sit on a hard bottom edge —
  \`shadow-sm\`/\`shadow-md\` are hard-edged (0 blur) drops; active state removes
  the shadow and nudges down 2px (\`translate-y-0.5\`).
- Borders are thick (2px) and friendly, not hairline.

## Components
- Buttons: h-12 \`rounded-xl\` \`font-bold uppercase\`; primary green with darker
  green bottom edge; secondary white with 2px border + gray bottom edge.
- Progress bars: fat (h-4) \`rounded-full\` green fills on \`surface-raised\`.
- Lesson nodes: big circles with icon, done = green, active = pulsing ring,
  locked = \`surface-raised\` + \`muted\` icon.
- Streak/gem counters: icon + \`font-extrabold\` number chips.

## Layout
Single centered play column (~600px) with a stats side rail on desktop.
Spacing chunky: 16/24/32. Few elements per screen, each one big and tappable.

## Don'ts
- No hairline borders, no subtle grays-on-gray, no elegant thin type.
- Green must stay vivid — never darken it into "corporate" green.
- No dense tables or small click targets; everything is a big friendly shape.
`;

const Duolingo_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Duolingo — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #58cc02;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #4b4b4b;
		--color-surface-raised: #f7f7f7;
		--color-muted: #777777;
		--color-accent: #1cb0f6;
		--color-danger: #ff4b4b;
		--color-border: #e5e5e5;

		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 16px;
		--radius-xl: 20px;
		--radius-2xl: 28px;

		--shadow-sm: 0 2px 0 rgb(0 0 0 / 0.12);
		--shadow-md: 0 4px 0 rgb(0 0 0 / 0.15);
		--shadow-lg: 0 8px 24px rgb(0 0 0 / 0.15);

		/* The darker edges that make the 3D press work. */
		--green-edge: #46a302;
		--blue-edge: #1899d6;
		--red-edge: #ea2b2b;
		--gray-edge: #b7b7b7;

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Nunito, Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		font-weight: 500;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	/* Everything is slightly bolder than feels reasonable. That's the voice. */
	h1, h2, h3 { margin: 0; font-weight: 800; line-height: 1.2; }
	p { margin: 0; }
	::selection { background: rgb(88 204 2 / 0.3); }
	.spacer { flex: 1; }
	.muted { color: var(--color-muted); }

	.wrap { max-width: 1000px; margin: 0 auto; padding: 0 16px; }
	@media (min-width: 768px) { .wrap { padding: 0 24px; } }

	/* ── Top bar: chunky counters, 2px borders ────────────────────── */
	.topbar { border-bottom: 2px solid var(--color-border); }
	.topbar-inner { display: flex; align-items: center; gap: 14px; padding: 14px 0; }
	.brand { display: flex; align-items: center; gap: 10px; color: var(--color-primary); font-weight: 800; font-size: 21px; }
	.brand .owl { width: 30px; height: 30px; border-radius: 50% 50% 46% 46%; background: var(--color-primary); }
	.counter { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 16px; }
	.counter.fire { color: #ff9600; }
	.counter.gem { color: var(--color-accent); }
	.counter.heart { color: var(--color-danger); }

	/* ── Play column + stats rail ─────────────────────────────────── */
	.play { display: grid; grid-template-columns: 1fr; gap: 24px; padding: 24px 0 40px; }
	@media (min-width: 900px) { .play { grid-template-columns: 1fr 320px; gap: 32px; } }

	.unit {
		background: var(--color-primary); color: #fff;
		border-radius: var(--radius-lg);
		box-shadow: 0 4px 0 var(--green-edge);
		padding: 18px 22px; display: flex; align-items: center; gap: 16px;
	}
	.unit .k { font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.9; }
	.unit h2 { font-size: 22px; margin-top: 2px; }
	.unit .guide { margin-left: auto; }

	/* Lesson path: big circular nodes you cannot possibly mis-tap. */
	.path { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 34px 0; }
	.node {
		width: 74px; height: 74px; border-radius: 50%;
		display: grid; place-items: center; font-size: 26px; color: #fff;
		background: var(--color-primary); box-shadow: 0 6px 0 var(--green-edge);
		position: relative;
	}
	.node.locked { background: var(--color-surface-raised); box-shadow: 0 6px 0 var(--color-border); color: #afafaf; }
	.node.active { background: var(--color-primary); box-shadow: 0 6px 0 var(--green-edge), 0 0 0 8px rgb(88 204 2 / 0.2); }
	.node.chest { background: #ffc800; box-shadow: 0 6px 0 #e5a600; }
	.node .start {
		position: absolute; top: -34px; left: 50%; transform: translateX(-50%);
		background: var(--color-surface-raised); color: var(--color-primary);
		border: 2px solid var(--color-border); border-radius: var(--radius-sm);
		padding: 3px 12px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
		white-space: nowrap;
	}
	.node.off-l { transform: translateX(-64px); }
	.node.off-r { transform: translateX(64px); }
	.node.off-l2 { transform: translateX(-38px); }

	/* Exercise card: the thing the whole system is built to hold. */
	.exercise { border: 2px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
	.exercise h3 { font-size: 20px; }
	.choices { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 16px; }
	@media (min-width: 560px) { .choices { grid-template-columns: repeat(2, 1fr); } }
	.choice {
		border: 2px solid var(--color-border); border-bottom-width: 4px;
		border-radius: var(--radius-md); padding: 14px 16px;
		font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 12px;
	}
	.choice .n { width: 22px; height: 22px; border: 2px solid var(--color-border); border-radius: var(--radius-sm); display: grid; place-items: center; font-size: 12px; color: var(--color-muted); }
	.choice.is-selected { border-color: var(--color-accent); background: rgb(28 176 246 / 0.12); color: #1899d6; }
	.choice.is-selected .n { border-color: var(--color-accent); color: #1899d6; }
	.choice.is-correct { border-color: var(--color-primary); background: rgb(88 204 2 / 0.14); color: #58a700; }
	.choice.is-wrong { border-color: var(--color-danger); background: rgb(255 75 75 / 0.12); color: #ea2b2b; }

	/* Fat progress bar. */
	.bar { height: 16px; border-radius: 9999px; background: var(--color-border); overflow: hidden; }
	.bar .fill { display: block; height: 100%; border-radius: 9999px; background: var(--color-primary); width: 64%; position: relative; }
	.bar .fill::after { content: ""; position: absolute; left: 8px; right: 8px; top: 3px; height: 4px; border-radius: 9999px; background: rgb(255 255 255 / 0.3); }

	/* Stats rail */
	.rail { display: flex; flex-direction: column; gap: 16px; }
	.railcard { border: 2px solid var(--color-border); border-radius: var(--radius-lg); padding: 16px 18px; }
	.railcard h3 { font-size: 16px; margin-bottom: 10px; }
	.rr { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 15px; font-weight: 700; }
	.rr .ic { width: 30px; height: 30px; border-radius: var(--radius-sm); display: grid; place-items: center; font-size: 15px; }
	.tint-green { background: rgb(88 204 2 / 0.15); }
	.tint-blue { background: rgb(28 176 246 / 0.15); }
	.tint-red { background: rgb(255 75 75 / 0.15); }
	.tint-gold { background: rgb(255 200 0 / 0.2); }

	/* ── Buttons: the 3D press ────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 800;
		text-transform: uppercase; letter-spacing: 0.06em;
		height: 50px; padding: 0 24px;
		border: 0; border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		box-shadow: 0 4px 0 var(--green-edge);
		cursor: pointer;
		transition: transform 60ms ease, box-shadow 60ms ease, filter 120ms ease;
	}
	.btn:hover { filter: brightness(1.06); }
	/* Press: the shadow disappears and the button drops into it. */
	.btn:active { transform: translateY(4px); box-shadow: none; }
	.btn:focus-visible { outline: none; box-shadow: 0 4px 0 var(--green-edge), 0 0 0 4px rgb(88 204 2 / 0.35); }
	.btn-blue { background: var(--color-accent); box-shadow: 0 4px 0 var(--blue-edge); }
	.btn-blue:active { box-shadow: none; }
	.btn-danger { background: var(--color-danger); box-shadow: 0 4px 0 var(--red-edge); }
	.btn-danger:active { box-shadow: none; }
	.btn-secondary {
		background: var(--color-surface); color: var(--color-muted);
		border: 2px solid var(--color-border); box-shadow: 0 4px 0 var(--color-border);
	}
	.btn-secondary:active { box-shadow: none; }
	.btn[disabled] { cursor: not-allowed; background: var(--color-border); color: #afafaf; box-shadow: 0 4px 0 var(--gray-edge); transform: none; }
	.btn-lg { height: 58px; font-size: 17px; padding: 0 34px; }
	.row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }

	.input {
		font: inherit; font-size: 16px; font-weight: 500; width: 100%; max-width: 340px; height: 50px; padding: 0 16px;
		border: 2px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #afafaf; }
	.input:focus { outline: none; border-color: var(--color-accent); }

	/* ── Reference sections ───────────────────────────────────────── */
	.section { padding: 40px 0; border-top: 2px solid var(--color-border); }
	.section-label { font-size: 13px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 8px; }
	.section h2 { font-size: 26px; }
	@media (min-width: 768px) { .section h2 { font-size: 32px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 60ch; }
	.note { margin-top: 18px; font-size: 14px; color: var(--color-muted); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 24px; }
	@media (min-width: 700px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill2 { height: 68px; border-radius: var(--radius-lg); }
	.sw b { display: block; font-size: 14px; font-weight: 800; margin-top: 10px; }
	.sw span { font-size: 13px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 26px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 286px 1fr; gap: 44px; } }
	.phone {
		width: 286px; max-width: 100%; margin: 0 auto;
		border: 2px solid var(--color-border); border-radius: 30px;
		overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 12px 18px 4px; font-size: 10px; color: var(--color-muted); font-weight: 700; }
	.phone-top { display: flex; align-items: center; gap: 10px; padding: 4px 16px 12px; border-bottom: 2px solid var(--color-border); font-size: 13px; }
	.phone-top .counter { font-size: 13px; }
	.phone-body { padding: 14px 16px 10px; }
	.m-unit { background: var(--color-primary); color: #fff; border-radius: var(--radius-md); box-shadow: 0 4px 0 var(--green-edge); padding: 10px 14px; }
	.m-unit .k { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9; }
	.m-unit b { font-size: 15px; }
	.m-path { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 0 6px; }
	.m-path .node { width: 56px; height: 56px; font-size: 20px; box-shadow: 0 5px 0 var(--green-edge); }
	.m-path .node.locked { box-shadow: 0 5px 0 var(--color-border); }
	.m-path .node.chest { box-shadow: 0 5px 0 #e5a600; }
	.m-path .node .start { font-size: 10px; padding: 2px 9px; top: -28px; }
	.m-tabs { display: flex; border-top: 2px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; font-weight: 800; color: var(--color-muted); padding: 9px 0 14px; text-transform: uppercase; letter-spacing: 0.04em; }
	.m-tabs .is-active { color: var(--color-primary); }
	.m-tabs .g { display: block; width: 20px; height: 20px; border: 2.5px solid currentColor; border-radius: 6px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 2px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 16px; font-weight: 800; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 24px; }
	@media (min-width: 700px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 6px; background: #fff; border: 1px solid #e8e8e8; box-shadow: 0 2px 10px rgb(0 0 0 / 0.06); font-size: 15px; font-weight: 400; color: #8a8a8a; }
	.cmp-off small { display: block; font-size: 13px; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-lg); background: #fff; border: 2px solid var(--color-border); box-shadow: 0 4px 0 var(--color-border); font-size: 16px; font-weight: 800; }
	.cmp-on small { display: block; font-weight: 500; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the lesson path. Big shapes, vivid green, and buttons that sit on
     a hard bottom edge so they can physically press down. -->
<div class="topbar">
	<div class="wrap topbar-inner">
		<span class="brand"><span class="owl"></span>vetta</span>
		<span class="spacer"></span>
		<span class="counter fire">🔥 12</span>
		<span class="counter gem">💎 480</span>
		<span class="counter heart">❤ 5</span>
	</div>
</div>

<div class="wrap play">
	<main>
		<div class="unit">
			<div>
				<div class="k">Section 2 · Unit 4</div>
				<h2>Order in a café</h2>
			</div>
			<button class="btn btn-secondary guide" style="height:42px;color:#fff;border-color:rgb(255 255 255 / 0.5);box-shadow:0 4px 0 var(--green-edge);background:transparent">Guide</button>
		</div>

		<div class="path">
			<div class="node">★</div>
			<div class="node off-l">★</div>
			<div class="node off-l2 active"><span class="start">Start</span>▶</div>
			<div class="node off-r chest">🎁</div>
			<div class="node off-r locked">★</div>
			<div class="node locked">🏆</div>
		</div>

		<div class="exercise">
			<h3>Which one means "the coffee"?</h3>
			<div class="choices">
				<div class="choice is-correct"><span class="n">1</span>el café</div>
				<div class="choice is-selected"><span class="n">2</span>la leche</div>
				<div class="choice"><span class="n">3</span>el agua</div>
				<div class="choice is-wrong"><span class="n">4</span>la mesa</div>
			</div>
			<div class="row" style="margin-top:20px">
				<button class="btn btn-secondary">Skip</button>
				<span class="spacer"></span>
				<button class="btn">Check</button>
			</div>
		</div>
	</main>

	<aside class="rail">
		<div class="railcard">
			<h3>Daily quests</h3>
			<div class="rr"><span class="ic tint-gold">⚡</span>Earn 30 XP<span class="spacer"></span><span class="muted">20/30</span></div>
			<div class="bar" style="height:12px"><span class="fill" style="width:66%"></span></div>
			<div class="rr" style="margin-top:8px"><span class="ic tint-green">✓</span>Get 5 in a row<span class="spacer"></span><span class="muted">3/5</span></div>
			<div class="bar" style="height:12px"><span class="fill" style="width:60%"></span></div>
		</div>
		<div class="railcard">
			<h3>Your stats</h3>
			<div class="rr"><span class="ic tint-red">🔥</span>12 day streak</div>
			<div class="rr"><span class="ic tint-blue">💎</span>480 gems</div>
			<div class="rr"><span class="ic tint-green">⚡</span>1,240 total XP</div>
		</div>
		<div class="railcard" style="border-color: var(--color-accent); background: rgb(28 176 246 / 0.08);">
			<h3 style="color:#1899d6">Unlock leaderboards!</h3>
			<p class="muted" style="font-size:14px;margin-bottom:12px">Complete 4 more lessons to start competing.</p>
			<button class="btn btn-blue" style="width:100%">Keep going</button>
		</div>
	</aside>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — The press</p>
		<h2>Every button sits on a hard edge</h2>
		<p class="lede">The bottom edge is a zero-blur drop in a darker shade of the button's own color.
			Pressing removes the shadow and translates the button down by exactly that amount, so it lands
			flush with the surface. That single interaction carries the whole personality.</p>
		<div class="row" style="margin-top: 22px;">
			<button class="btn">Continue</button>
			<button class="btn btn-blue">Practice</button>
			<button class="btn btn-secondary">Skip</button>
			<button class="btn btn-danger">Quit lesson</button>
			<button class="btn" disabled>Check</button>
		</div>
		<div class="row" style="margin-top: 18px;">
			<button class="btn btn-lg">Start my streak</button>
			<input class="input" placeholder="Type the answer">
		</div>
		<p class="note">Borders are 2px and friendly, never hairlines. Answer choices carry a 4px bottom border for the same reason — they are pressable objects, not list rows.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Color</p>
		<h2>Vivid green, always</h2>
		<p class="lede">Feather green means progress, correctness and go. Sky blue is the secondary
			voice, soft red is a lost heart, gold is a reward. Every one of them stays bright — darkening
			green into a "corporate" shade is the fastest way out of this system.</p>
		<div class="swatches">
			<div class="sw"><div class="fill2" style="background: var(--color-primary); box-shadow: 0 5px 0 var(--green-edge)"></div><b>primary</b><span>#58cc02 · go, correct</span></div>
			<div class="sw"><div class="fill2" style="background: var(--color-accent); box-shadow: 0 5px 0 var(--blue-edge)"></div><b>accent</b><span>#1cb0f6 · secondary</span></div>
			<div class="sw"><div class="fill2" style="background: var(--color-danger); box-shadow: 0 5px 0 var(--red-edge)"></div><b>danger</b><span>#ff4b4b · hearts</span></div>
			<div class="sw"><div class="fill2" style="background: var(--color-surface-raised); box-shadow: 0 5px 0 var(--color-border)"></div><b>raised</b><span>#f7f7f7 · locked</span></div>
		</div>
		<div class="bar" style="margin-top:24px;max-width:460px"><span class="fill"></span></div>
		<p class="note">Progress bars are 16px tall with a full radius and a lighter inner highlight. A thin 4px progress line would look like a different product entirely.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>The phone is the real device</h2>
		<p class="lede">This layout starts on a phone: one lesson path, one big button, nothing small
			enough to mis-tap. On desktop it simply gains a stats rail — everything else is identical.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-top">
					<span class="brand" style="font-size:15px"><span class="owl" style="width:22px;height:22px"></span></span>
					<span class="spacer"></span>
					<span class="counter fire">🔥 12</span><span class="counter gem">💎 480</span><span class="counter heart">❤ 5</span>
				</div>
				<div class="phone-body">
					<div class="m-unit"><div class="k">Section 2 · Unit 4</div><b>Order in a café</b></div>
					<div class="m-path">
						<div class="node active"><span class="start">Start</span>▶</div>
						<div class="node off-l">★</div>
						<div class="node off-r chest">🎁</div>
						<div class="node locked">★</div>
					</div>
				</div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Learn</div>
					<div><span class="g"></span>Practice</div>
					<div><span class="g"></span>Quests</div>
					<div><span class="g"></span>Profile</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>The stats rail</b>Below 900px it moves into the bottom tab bar and a collapsible quests card above the path. It is supporting information, so it goes first.</li>
				<li><b>Lesson nodes</b>74px → 56px circles and never smaller. The hard 5–6px bottom edge scales with them, because a node without its edge stops looking pressable.</li>
				<li><b>The path</b>Nodes keep their alternating left/right offsets, reduced from ±64px to ±38px. That zig-zag is the layout's signature and it survives every width.</li>
				<li><b>Counters</b>Streak, gems and hearts stay in the top bar at extra-bold. They are the reason people open the app; they are never hidden behind a menu.</li>
				<li><b>The check button</b>Pins to the bottom of the exercise screen at full width and 58px tall — the largest target on the screen at every breakpoint.</li>
				<li><b>Answer choices</b>Two columns → one, still 2px bordered with a 4px bottom edge and 14px padding. Nothing compresses into a compact list.</li>
				<li><b>Borders</b>Stay 2px everywhere. Thinning them for a small screen makes the whole interface look breakable.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the game</h2>
		<div class="compare">
			<div class="cmp-off">Elegant and thin
				<small>1px hairline border · soft blurred shadow · light gray text at weight 400 · 6px radius. Tasteful, restrained, and completely wrong here.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>2px border, hard 4px bottom edge, 16px radius, weight 800. Loud, chunky and impossible to feel intimidated by.</small></div>
		</div>
		<p class="note">Also out: gray-on-gray subtlety, small tap targets, dense tables, and green muted into something corporate.</p>
	</section>
</div>

</body>
</html>
`;

const Figma_THEME = `/* Figma — crisp canvas white, blue tool, purple spark. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #0d99ff;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #1e1e1e;
	--color-surface-raised: #f5f5f5;
	--color-muted: #757575;
	--color-accent: #a259ff;
	--color-danger: #f24822;
	--color-border: #e6e6e6;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 8px;
	--radius-xl: 13px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 3px rgb(0 0 0 / 0.1);
	--shadow-md: 0 4px 14px rgb(0 0 0 / 0.15);
	--shadow-lg: 0 10px 32px rgb(0 0 0 / 0.2);
}
`;

const Figma_SPEC = `# Figma

## Atmosphere
A bright tool canvas with a designer's wink. Neutral chrome that stays out of
the way, blue for the active tool, purple for the spark of fun. Crisp 1px
precision everywhere.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white canvas; \`surface-raised\` for toolbars/panels/wells.
- \`primary\` blue = selection, active tool, primary button, focus.
- \`accent\` purple appears in small joyful doses: badges, plan tags, community.
- Ink \`surface-foreground\` (near-black); labels \`muted\` at 11–12px.

## Typography
System font stack only. Compact tool typography:
- Panel labels 11px \`font-medium uppercase tracking-wide text-muted\`.
- Controls/body 12–13px; dialog titles 15–16px \`font-semibold\`.
- Numbers in inputs use \`font-mono\` 12px (coordinates, sizes, hex).

## Shape & depth
- Small radii: controls \`rounded-md\` (6px), floating panels \`rounded-xl\` (13px).
- Panels float with \`shadow-md\`; inline controls are flat with hairline
  \`border\` between sections.

## Components
- Buttons: h-8 \`rounded-md\`; primary filled blue; secondary bordered; icon
  buttons 32px squares with hover \`bg-surface-raised\`.
- Property rows: 32px, label left in \`muted\`, mono value input right.
- Segmented icon groups (alignment cluster) in a bordered \`surface-raised\` pill.
- Tabs: text-only, active gets \`font-semibold\` ink + 2px blue underline.

## Layout
Three-zone tool layout: left layers panel (240px), center canvas, right
properties (240px), 40px toolbars. Spacing 4/8/12 — tight but ordered by
hairline dividers.

## Don'ts
- Purple never exceeds badge-size areas; blue owns interaction.
- No large soft shadows on inline UI; only floating panels cast.
- No oversized typography — this is instrument UI, not marketing.
`;

const Figma_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Figma — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #0d99ff;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #1e1e1e;
		--color-surface-raised: #f5f5f5;
		--color-muted: #757575;
		--color-accent: #a259ff;
		--color-danger: #f24822;
		--color-border: #e6e6e6;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 8px;
		--radius-xl: 13px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 3px rgb(0 0 0 / 0.1);
		--shadow-md: 0 4px 14px rgb(0 0 0 / 0.15);
		--shadow-lg: 0 10px 32px rgb(0 0 0 / 0.2);

		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 13px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
	p { margin: 0; }
	::selection { background: rgb(13 153 255 / 0.28); }
	.spacer { flex: 1; }
	.mono { font-family: var(--mono); }

	/* ── Instrument UI: 40px toolbars, 240px panels, 1px hairlines ── */
	.toolbar {
		display: flex; align-items: center; gap: 4px;
		height: 44px; padding: 0 8px;
		background: var(--color-surface-raised);
		border-bottom: 1px solid var(--color-border);
	}
	.logo { width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--color-surface-foreground); position: relative; flex: none; }
	.logo::after { content: ""; position: absolute; inset: 8px; border-radius: 50%; background: var(--color-primary); }
	.tool {
		width: 32px; height: 32px; border-radius: var(--radius-md);
		display: grid; place-items: center; color: var(--color-muted); font-size: 13px; flex: none;
	}
	.tool.is-active { background: var(--color-primary); color: #fff; }
	.tool:hover { background: rgb(0 0 0 / 0.06); }
	.tool.is-active:hover { background: var(--color-primary); }
	.filename { font-size: 13px; font-weight: 500; margin-left: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* Drawing tools are hidden rather than shrunk below the tablet breakpoint. */
	@media (max-width: 700px) { .tool-extra, .zoom, .faces { display: none; } }
	.filename small { color: var(--color-muted); font-weight: 400; }
	.zoom { font-family: var(--mono); font-size: 12px; color: var(--color-muted); padding: 0 8px; }
	.faces { display: flex; gap: -6px; }
	.face { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--color-surface-raised); margin-left: -6px; }

	.editor { display: grid; grid-template-columns: 1fr; border-bottom: 1px solid var(--color-border); }
	@media (min-width: 1000px) { .editor { grid-template-columns: 240px 1fr 240px; } }

	.panel { background: var(--color-surface); font-size: 12px; }
	.panel.left { border-right: 1px solid var(--color-border); display: none; }
	.panel.right { border-left: 1px solid var(--color-border); display: none; }
	@media (min-width: 1000px) { .panel.left, .panel.right { display: block; } }
	.panel-tabs { display: flex; gap: 14px; padding: 0 12px; border-bottom: 1px solid var(--color-border); }
	.panel-tabs span { padding: 10px 0; font-size: 12px; color: var(--color-muted); }
	.panel-tabs .is-active { color: var(--color-surface-foreground); font-weight: 600; box-shadow: inset 0 -2px 0 var(--color-primary); }
	.panel-group { padding: 10px 8px; border-bottom: 1px solid var(--color-border); }
	/* 11px uppercase label — the panel typography of the whole system. */
	.panel-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted); padding: 0 4px 8px; display: flex; align-items: center; }

	.layer { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px; border-radius: var(--radius-sm); color: var(--color-surface-foreground); }
	.layer:hover { background: var(--color-surface-raised); }
	.layer.is-selected { background: rgb(13 153 255 / 0.12); color: var(--color-primary); }
	.layer .g { width: 12px; height: 12px; flex: none; border: 1.5px solid currentColor; opacity: 0.7; }
	.layer .g.txt { border: 0; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
	.layer .g.frm { border-radius: 2px; }
	.layer .g.ell { border-radius: 50%; }
	.layer.indent { padding-left: 20px; }
	.layer.indent2 { padding-left: 34px; }
	.layer .badge-c { margin-left: auto; color: var(--color-accent); font-size: 11px; }

	/* ── Canvas: gray field, one selected frame with handles ──────── */
	.canvas { background: #e5e5e5; padding: 32px 16px; overflow: hidden; display: grid; place-items: center; min-height: 340px; }
	.frame-wrap { position: relative; }
	.frame-name { position: absolute; top: -18px; left: 0; font-size: 11px; color: var(--color-primary); }
	.artboard { width: 300px; max-width: 100%; background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 18px; }
	.artboard h4 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
	.artboard p { font-size: 11px; color: var(--color-muted); }
	.ab-row { display: flex; gap: 8px; margin-top: 14px; }
	.ab-box { flex: 1; height: 44px; border-radius: var(--radius-sm); background: var(--color-surface-raised); }
	.ab-cta { margin-top: 14px; height: 32px; border-radius: var(--radius-md); background: var(--color-primary); color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 600; }
	/* Selection: 1px blue outline plus 6px square handles. */
	.sel { position: absolute; inset: -1px; border: 1px solid var(--color-primary); pointer-events: none; }
	.h { position: absolute; width: 7px; height: 7px; background: #fff; border: 1px solid var(--color-primary); border-radius: 1px; }
	.h.tl { left: -4px; top: -4px; } .h.tr { right: -4px; top: -4px; }
	.h.bl { left: -4px; bottom: -4px; } .h.br { right: -4px; bottom: -4px; }
	.dim { position: absolute; left: 50%; transform: translateX(-50%); bottom: -26px; background: var(--color-primary); color: #fff; font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: var(--radius-sm); white-space: nowrap; }
	.cursor { position: absolute; right: -46px; top: 46px; display: flex; align-items: flex-start; gap: 2px; }
	/* The collaborator cursor hangs outside the frame, so it goes before it can push the page. */
	@media (max-width: 700px) { .cursor { display: none; } }
	.cursor .arrow { width: 0; height: 0; border-left: 8px solid var(--color-accent); border-top: 5px solid transparent; border-bottom: 9px solid transparent; transform: rotate(-20deg); }
	.cursor .name { background: var(--color-accent); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: var(--radius-sm); margin-top: 8px; }

	/* ── Property rows: label left, mono value right, 32px tall ───── */
	.prow { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 4px; }
	.prow .pl { width: 52px; flex: none; color: var(--color-muted); font-size: 11px; }
	.pinput {
		flex: 1; min-width: 0; height: 24px; display: flex; align-items: center; gap: 4px;
		border: 1px solid transparent; border-radius: var(--radius-sm);
		padding: 0 6px; font-family: var(--mono); font-size: 12px;
	}
	.pinput:hover { border-color: var(--color-border); }
	.pinput.is-focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px rgb(13 153 255 / 0.2); }
	.pinput .u { color: var(--color-muted); font-size: 11px; }
	.seg { display: flex; background: var(--color-surface-raised); border-radius: var(--radius-md); padding: 2px; gap: 2px; }
	.seg span { flex: 1; height: 22px; display: grid; place-items: center; border-radius: var(--radius-sm); font-size: 11px; color: var(--color-muted); }
	.seg .is-active { background: var(--color-surface); color: var(--color-surface-foreground); box-shadow: var(--shadow-sm); }
	.fillrow { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px; }
	.chipcolor { width: 16px; height: 16px; border-radius: var(--radius-sm); border: 1px solid rgb(0 0 0 / 0.1); flex: none; }
	.opacity { font-family: var(--mono); font-size: 12px; color: var(--color-muted); margin-left: auto; }

	/* ── Reference sections ───────────────────────────────────────── */
	.wrap { max-width: 1000px; margin: 0 auto; padding: 0 20px 80px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 104px; } }
	.section { padding-top: 48px; }
	@media (min-width: 768px) { .section { padding-top: 64px; } }
	.section-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-accent); margin-bottom: 8px; }
	.section h2 { font-size: 22px; }
	@media (min-width: 768px) { .section h2 { font-size: 26px; } }
	.lede { color: var(--color-muted); margin-top: 10px; max-width: 66ch; font-size: 14px; }
	.note { margin-top: 16px; font-size: 12px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

	/* ── Buttons: 32px, tool-sized ────────────────────────────────── */
	.btn {
		font: inherit; font-size: 12px; font-weight: 500;
		height: 32px; padding: 0 12px;
		border: 1px solid transparent; border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 120ms ease;
	}
	.btn:hover { background: #0b87e5; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--color-primary); }
	.btn-secondary { background: var(--color-surface); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: var(--color-surface-raised); }
	.btn-ghost { background: transparent; color: var(--color-muted); }
	.btn-ghost:hover { background: var(--color-surface-raised); color: var(--color-surface-foreground); }
	.btn-danger { background: var(--color-danger); }
	.btn-accent { background: var(--color-accent); }
	.btn[disabled] { cursor: not-allowed; background: var(--color-surface-raised); color: #b3b3b3; }
	.badge { display: inline-block; border-radius: var(--radius-sm); padding: 1px 7px; font-size: 11px; font-weight: 500; background: rgb(162 89 255 / 0.14); color: var(--color-accent); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 18px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 48px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 12px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 11px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 24px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 280px 1fr; gap: 40px; } }
	.phone {
		width: 280px; max-width: 100%; margin: 0 auto;
		border-radius: 22px; overflow: hidden; background: #e5e5e5;
		box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);
	}
	.phone-bar { display: flex; align-items: center; gap: 6px; background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border); padding: 8px 10px; font-size: 11px; }
	.phone-bar .logo { width: 20px; height: 20px; }
	.phone-canvas { padding: 20px 14px 26px; display: grid; place-items: center; position: relative; }
	.m-art { width: 190px; background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 12px; position: relative; }
	.m-art h5 { margin: 0; font-size: 12px; font-weight: 600; }
	.m-art .b { height: 26px; border-radius: 4px; background: var(--color-surface-raised); margin-top: 8px; }
	.m-art .c { height: 24px; border-radius: 6px; background: var(--color-primary); margin-top: 8px; }
	/* A comment pin, not an edit handle: touch is for review. */
	.pin { position: absolute; right: -10px; top: 26px; width: 22px; height: 22px; border-radius: 50% 50% 50% 2px; background: var(--color-accent); color: #fff; font-size: 10px; display: grid; place-items: center; box-shadow: var(--shadow-sm); }
	.sheet { background: var(--color-surface); border-top: 1px solid var(--color-border); padding: 8px 12px 14px; }
	.sheet .grab { width: 34px; height: 4px; border-radius: 2px; background: var(--color-border); margin: 0 auto 10px; }
	.sheet .prow { height: 30px; }
	.m-tabs { display: flex; background: var(--color-surface); border-top: 1px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 12px; }
	.m-tabs .is-active { color: var(--color-primary); font-weight: 600; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 11px 0; border-bottom: 1px solid var(--color-border); font-size: 13px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 12px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 18px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 26px; border-radius: 20px; background: rgb(162 89 255 / 0.12); border: 0; box-shadow: 0 12px 30px rgb(162 89 255 / 0.3); font-size: 22px; font-weight: 700; color: var(--color-accent); }
	.cmp-off small { display: block; font-size: 12px; font-weight: 400; color: var(--color-muted); margin-top: 10px; }
	.cmp-on { padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); font-size: 13px; font-weight: 600; }
	.cmp-on small { display: block; font-size: 12px; font-weight: 400; color: var(--color-muted); margin-top: 6px; }
</style>
</head>
<body>

<!-- COVER — the editor itself: three zones, hairline dividers, blue selection,
     one purple collaborator. Nothing here is marketing-sized. -->
<div class="toolbar">
	<span class="logo"></span>
	<span class="tool is-active">▧</span>
	<span class="tool tool-extra">▭</span>
	<span class="tool tool-extra">◯</span>
	<span class="tool tool-extra">✎</span>
	<span class="tool tool-extra">T</span>
	<span class="filename">Design tokens <small>/ Component audit</small></span>
	<span class="spacer"></span>
	<span class="zoom">128%</span>
	<span class="faces"><span class="face" style="background:#0d99ff"></span><span class="face" style="background:#a259ff"></span><span class="face" style="background:#f24822"></span></span>
	<button class="btn">Share</button>
</div>

<div class="editor">
	<aside class="panel left">
		<div class="panel-tabs"><span class="is-active">Layers</span><span>Assets</span><span>Pages</span></div>
		<div class="panel-group" style="border-bottom:0">
			<div class="layer"><span class="g frm"></span>Desktop / Dashboard</div>
			<div class="layer indent"><span class="g frm"></span>Header</div>
			<div class="layer indent2"><span class="g txt">T</span>Title</div>
			<div class="layer indent2"><span class="g ell"></span>Avatar<span class="badge-c">◆</span></div>
			<div class="layer is-selected indent"><span class="g frm"></span>Card / Metric<span class="badge-c">◆</span></div>
			<div class="layer indent2"><span class="g txt">T</span>Label</div>
			<div class="layer indent2"><span class="g txt">T</span>Value</div>
			<div class="layer indent2"><span class="g frm"></span>Button / Primary<span class="badge-c">◆</span></div>
			<div class="layer indent"><span class="g frm"></span>Table</div>
			<div class="layer"><span class="g frm"></span>Mobile / Dashboard</div>
		</div>
	</aside>

	<div class="canvas">
		<div class="frame-wrap">
			<span class="frame-name">Card / Metric</span>
			<div class="artboard">
				<h4>Gross volume</h4>
				<p>Last 7 days</p>
				<div class="ab-row"><span class="ab-box"></span><span class="ab-box"></span><span class="ab-box"></span></div>
				<div class="ab-cta">View report</div>
			</div>
			<div class="sel">
				<span class="h tl"></span><span class="h tr"></span><span class="h bl"></span><span class="h br"></span>
			</div>
			<span class="dim">300 × 186</span>
			<span class="cursor"><span class="arrow"></span><span class="name">Ana</span></span>
		</div>
	</div>

	<aside class="panel right">
		<div class="panel-tabs"><span class="is-active">Design</span><span>Prototype</span><span>Inspect</span></div>
		<div class="panel-group">
			<div class="panel-label">Alignment</div>
			<div class="seg"><span class="is-active">⇤</span><span>⇔</span><span>⇥</span><span>⇞</span><span>⇕</span><span>⇟</span></div>
		</div>
		<div class="panel-group">
			<div class="panel-label">Position &amp; size</div>
			<div class="prow"><span class="pl">X</span><span class="pinput">124</span><span class="pl" style="width:20px">Y</span><span class="pinput">288</span></div>
			<div class="prow"><span class="pl">W</span><span class="pinput is-focus">300</span><span class="pl" style="width:20px">H</span><span class="pinput">186</span></div>
			<div class="prow"><span class="pl">Angle</span><span class="pinput">0<span class="u">°</span></span><span class="pl" style="width:20px">⌐</span><span class="pinput">6</span></div>
		</div>
		<div class="panel-group">
			<div class="panel-label">Auto layout</div>
			<div class="prow"><span class="pl">Gap</span><span class="pinput">8</span><span class="pl" style="width:34px">Pad</span><span class="pinput">18</span></div>
		</div>
		<div class="panel-group">
			<div class="panel-label">Fill</div>
			<div class="fillrow"><span class="chipcolor" style="background:#ffffff"></span><span class="mono" style="font-size:12px">FFFFFF</span><span class="opacity">100%</span></div>
			<div class="panel-label" style="padding-top:12px">Stroke</div>
			<div class="fillrow"><span class="chipcolor" style="background:#e6e6e6"></span><span class="mono" style="font-size:12px">E6E6E6</span><span class="opacity">1</span></div>
		</div>
		<div class="panel-group" style="border-bottom:0">
			<div class="panel-label">Effects</div>
			<div class="fillrow"><span class="chipcolor" style="background:rgb(0 0 0 / 0.1)"></span><span style="font-size:12px">Drop shadow</span><span class="opacity">Y 1 · B 3</span></div>
		</div>
	</aside>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Chrome</p>
		<h2>Instrument UI, not marketing UI</h2>
		<p class="lede">Panel labels are 11px uppercase muted; controls sit at 12–13px; the largest
			type in the entire editor is a 16px dialog title. Every number a user can edit is monospace,
			so a column of values stays readable while it changes.</p>
		<div class="row" style="margin-top: 18px;">
			<button class="btn">Primary</button>
			<button class="btn btn-secondary">Secondary</button>
			<button class="btn btn-ghost">Ghost</button>
			<button class="btn btn-danger">Delete</button>
			<button class="btn" disabled>Publishing…</button>
			<span class="badge">Community</span>
		</div>
		<div class="row" style="margin-top: 14px;">
			<span class="tool is-active">▧</span><span class="tool">▭</span><span class="tool">◯</span><span class="tool">T</span>
			<span style="font-size:12px;color:var(--color-muted);margin-left:6px">32px icon squares · hover fills with #f5f5f5 · active fills blue</span>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Color</p>
		<h2>Blue owns interaction, purple is a wink</h2>
		<p class="lede">Selection outlines, active tools, focus rings, primary buttons — all blue.
			Purple never exceeds badge size: a plan tag, a community label, a collaborator cursor.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#0d99ff · selection, focus</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#a259ff · badges only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#f5f5f5 · panels, hover</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#f24822 · destructive</span></div>
		</div>
		<p class="note">The canvas field is #e5e5e5 — one step darker than the panel fill — so a white artboard reads as an object sitting on a surface rather than as the page itself.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>On a phone the tool becomes a viewer</h2>
		<p class="lede">Three panels cannot survive a 375px viewport, and pretending otherwise produces
			unusable 20px targets. The mobile build inverts the priority: the canvas takes the whole screen,
			editing collapses into a bottom sheet, and the primary verb becomes commenting rather than drawing.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-bar"><span class="logo"></span><span>Design tokens</span><span class="spacer"></span><span class="mono" style="font-size:10px;color:var(--color-muted)">128%</span><span class="face" style="background:#a259ff;width:18px;height:18px;margin:0"></span></div>
				<div class="phone-canvas">
					<div class="m-art">
						<h5>Gross volume</h5>
						<div class="b"></div>
						<div class="c"></div>
						<span class="pin">2</span>
					</div>
				</div>
				<div class="sheet">
					<div class="grab"></div>
					<div class="panel-label">Card / Metric</div>
					<div class="prow"><span class="pl">W</span><span class="pinput">300</span><span class="pl" style="width:20px">H</span><span class="pinput">186</span></div>
					<div class="fillrow"><span class="chipcolor" style="background:#fff"></span><span class="mono" style="font-size:12px">FFFFFF</span><span class="opacity">100%</span></div>
				</div>
				<div class="m-tabs"><div class="is-active">Canvas</div><div>Comments</div><div>Layers</div><div>Files</div></div>
			</div>
			<ul class="rules">
				<li><b>&lt; 1000px — panels</b>Layers and Design panels leave the layout entirely. Layers becomes a tab; Design becomes a draggable bottom sheet showing only the selected node's properties.</li>
				<li><b>Property rows</b>Keep the label-left / mono-value-right structure and the 11px uppercase group label. Row height grows 32px → 40px so the value is tappable, but the type sizes do not change.</li>
				<li><b>Selection</b>The 1px blue outline stays; the four 7px handles are dropped, because a 7px target cannot be dragged with a finger. Resizing happens through the sheet's W/H fields.</li>
				<li><b>Comment pins</b>Purple pins are the one element that grows for touch — 22px minimum, anchored to the node rather than to the viewport.</li>
				<li><b>Toolbar</b>44px stays; the tool cluster reduces to move + comment. Drawing tools are hidden rather than shrunk.</li>
				<li><b>Canvas field</b>Still #e5e5e5 with the artboard floating on <code class="mono">shadow-sm</code>. Pinch-zoom replaces the zoom control, which becomes a readout.</li>
				<li><b>Hairlines</b>All dividers stay at exactly 1px. Precision chrome is the identity — thickening borders for "mobile clarity" is the wrong instinct here.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the instrument</h2>
		<div class="compare">
			<div class="cmp-off">Oversized purple panel
				<small>22px type · 20px radius · purple used as a surface · big colored shadow on inline UI. Tool chrome that shouts is tool chrome you stop seeing past.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>13px text, 6px radius, 1px #e6e6e6 border, no shadow. Only floating panels cast; inline controls are flat and separated by hairlines.</small></div>
		</div>
		<p class="note">Also out: purple beyond badge size, soft shadows on inline controls, sans-serif numbers in property fields, and any heading above 16px inside the editor.</p>
	</section>
</div>

</body>
</html>
`;

const Glassmorphism_THEME = `/* Glassmorphism (nocturne) — colorless glass over a deep night scene.
   The scene owns every colour; the glass only borrows light from it. */
@theme static {
	--color-primary: #e4b863;
	--color-primary-foreground: #f3dca8;
	--color-surface: #0b1322;
	--color-surface-foreground: #ffffff;
	--color-surface-raised: #16233a;
	--color-muted: #9aa4b8;
	--color-accent: #7c9cc4;
	--color-danger: #d9606e;
	--color-border: #303643;

	/* ── The night scene: the only place colour lives ─────────────── */
	--color-night-deep: #060a13;
	--color-night: #0b1322;
	--color-night-steel: #16233a;
	--color-moon-steel: #33517a;
	--color-moonlight: #7c9cc4;
	--color-champagne: #e4b863;
	--color-champagne-bright: #f3dca8;

	/* ── Glass: always colourless, never above 15% ────────────────── */
	--glass-fill: rgb(255 255 255 / 0.08);
	--glass-fill-quiet: rgb(255 255 255 / 0.05);
	--glass-fill-hover: rgb(255 255 255 / 0.14);
	--glass-border: rgb(255 255 255 / 0.15);
	--glass-border-hover: rgb(255 255 255 / 0.32);
	--glass-luminance: linear-gradient(180deg, rgb(255 255 255 / 0.12), transparent);
	--glass-blur: 60px;
	--glass-blur-mobile: 30px;
	--glass-saturate: 180%;

	/* Light wells — large, soft, low-alpha radials behind the glass. */
	--well-moonlight: radial-gradient(circle, rgb(124 156 196 / 0.28) 0%, transparent 65%);
	--well-steel: radial-gradient(circle, rgb(51 81 122 / 0.35) 0%, transparent 65%);
	--well-champagne: radial-gradient(circle, rgb(228 184 99 / 0.12) 0%, transparent 60%);

	--radius-sm: 16px;
	--radius-md: 20px;
	--radius-lg: 24px;
	--radius-xl: 28px;
	--radius-2xl: 32px;
	--radius-full: 9999px;

	/* Directional: outer depth, a lit top edge, a shaded bottom edge. */
	--shadow-sm: 0 8px 24px rgb(3 7 18 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.18);
	--shadow-md: 0 16px 40px rgb(3 7 18 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.22), inset 0 -1px 0 rgb(2 6 16 / 0.35);
	--shadow-lg: 0 24px 64px rgb(3 7 18 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.32), inset 0 -1px 0 rgb(2 6 16 / 0.35);
	--shadow-champagne: 0 4px 20px rgb(228 184 99 / 0.15), inset 0 1px 0 rgb(243 220 168 / 0.35);

	--ease-glass: cubic-bezier(0.16, 1, 0.3, 1);
	--duration-base: 500ms;
	--duration-sweep: 700ms;
}
`;

const Glassmorphism_SPEC = `# Glassmorphism

## Atmosphere
Colourless glass over a deep night scene. The scene carries all the colour and
the glass only borrows light from it — city lights through a rain-washed window,
architectural glazing after dark. Quiet luxury rather than novelty: cinematic,
composed, and believable enough that the panels read as a material instead of an
effect.

Fits premium product pages, media and control surfaces, dashboards that sit over
imagery, and anything that wants to feel expensive at night. It is a poor fit for
dense data work, documents, and any interface that must stay legible on a flat
white page.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is the night base and \`night-deep\` is its darker edge. The page is
  never a flat fill: it always carries two or three soft light wells.
- \`moonlight\` and \`moon-steel\` are the light-well colours, used only as large
  low-alpha radial gradients behind the glass — never as fills, text, or borders.
- Glass panels use \`glass-fill\` (white at 5–12%) and never exceed 15%. Glass is
  colourless; a tinted panel is the single fastest way out of this style.
- \`primary\` is champagne, the one accent. It appears as a low-alpha fill with a
  \`primary-foreground\` label on the main action, on a key figure, or as a border
  at ~40% — three appearances per screen is already generous.
- \`accent\` (moonlight) marks live and link states in the rare case a second
  signal is unavoidable.
- Text is \`surface-foreground\` at full strength for headings, ~60% for body and
  ~40% for captions. \`muted\` is the flat equivalent for surfaces that cannot
  carry an alpha.
- \`border\` is the flat equivalent of \`glass-border\`; prefer the alpha token so
  the edge picks up whatever the scene puts behind it.

## Typography
System font stack only — a neutral grotesque, nothing decorative.
- Headings \`font-semibold tracking-tight\`, 28–56px. The type is quiet; the
  material is the event.
- Body 15–16px at ~60% white with relaxed leading; captions and metadata 12–13px
  at ~40%.
- Numerals in stats and controls are \`tabular-nums\`, and a single key figure may
  take \`primary-foreground\`.
- Body measure stays at 65–75 characters. Long prose sits on \`surface-raised\`
  rather than on glass — text over a blurred scene is harder to read than it
  looks in a mockup.

## Shape & depth
- Radius floor is \`radius-sm\` (16px); panels default to \`radius-lg\`/\`radius-2xl\`
  (24–32px). Nothing square, nothing below 16px.
- Every panel is three layers, and all three are required:
  1. a colourless \`glass-fill\` with \`backdrop-blur\` at the \`glass-blur\` token and
     \`backdrop-saturate\` at \`glass-saturate\` — the saturation boost is what makes
     the scene's lights glow through;
  2. an inner luminance gradient (\`glass-luminance\`) from the top edge down;
  3. a directional shadow (\`shadow-md\`) — outer depth, a lit top inset edge, a
     shaded bottom inset edge.
- Drop any one layer and the panel reads as flat translucency rather than glass.
- A 2–3% film-grain overlay across the viewport removes the plastic sheen.
- Borders are \`glass-border\` at rest and \`glass-border-hover\` on hover.

## Spacing & layout
- Cards pad 24 → 32 → 40; buttons 20/12 → 24/14. Glass needs room: crowded
  panels overlap each other's blur and the depth collapses.
- Section rhythm 64 → 96; container padding 20 → 32.
- Panels sit apart over the scene rather than butting together, and they are
  never nested — a glass card inside a glass card doubles the blur and turns
  both to milk.
- Light wells are placed behind panel edges, not behind body text, so there is
  always something with structure for the glass to refract.

## Components
- **Buttons:** glass pill or \`radius-sm\` rectangle at \`glass-fill\`, with the
  primary action taking a champagne fill at low alpha, a champagne border at
  ~40%, \`primary-foreground\` text and \`shadow-champagne\`. Hover lifts 1–2px,
  brightens the border and raises the fill one step.
- **Specular sweep:** a skewed white-to-transparent highlight that travels across
  a panel on hover. One element per screen may carry it; it is a garnish.
- **Cards:** the three-layer panel, lifting on hover to \`shadow-lg\` with a
  brighter border.
- **Inputs:** \`surface-raised\` fields rather than glass, with a \`glass-border\`
  edge and a champagne focus ring. Fields must stay readable, and readable beats
  translucent every time.
- **Toggles and sliders:** recessed \`night-deep\` track holding a glass thumb; the
  active track takes champagne at low alpha.
- **Navigation:** a floating glass pill rather than a docked bar, so the scene
  continues underneath it.
- **States:** cover default, hover, keyboard focus, active, disabled, loading,
  empty, error and success. Disabled drops to \`glass-fill-quiet\` with no shadow;
  focus is a champagne ring, never a removed outline.

## Motion
- Spring easing throughout: \`ease-glass\` at \`duration-base\`. Nothing snaps.
- Hover lifts 1–4px and deepens the shadow one step; active presses to ~0.97.
- The specular sweep runs at \`duration-sweep\` with ease-out.
- No bounce, no elastic overshoot, no parallax, no fade-in-on-scroll.
- Under \`prefers-reduced-motion\` drop the lift and the sweep, keep the border and
  shadow change so state stays legible.

## Accessibility
- Body text at 60% white over the night scene clears 4.5:1; do not go below it
  for anything a user has to read. Captions at 40% are for metadata only.
- Contrast is measured against the darkest point the panel can sit over, not the
  average — a light well drifting behind a panel raises its background.
- Champagne text on a champagne fill works only in the \`primary-foreground\` /
  low-alpha-fill pairing; champagne on the night scene at small sizes does not.
- Glass must never be the only cue for state; pair it with a border, an icon or
  a label change.

## Don't
- No purple-to-pink gradients. That combination is the generic look this system
  exists to avoid.
- No tinted glass. Colour belongs to the scene, never to the panel.
- No glass fill above 15% — past that it is a solid block, not a material.
- No glass on a flat solid background; without light wells or imagery there is
  nothing to refract.
- No low blur values, and never omit the saturation boost.
- No single-layer shadow — without the lit and shaded inset edges there is no
  light direction.
- No square or small corners, and no nested glass panels.
- No second accent colour, and no gradient text.
- No glass as the default surface for everything; it is for the panels that
  matter, over a scene worth seeing.
- No fast transitions under ~200ms, and no bounce or elastic curves.
`;

const Glassmorphism_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glassmorphism — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #e4b863;
		--color-primary-foreground: #f3dca8;
		--color-surface: #0b1322;
		--color-surface-foreground: #ffffff;
		--color-surface-raised: #16233a;
		--color-muted: #9aa4b8;
		--color-accent: #7c9cc4;
		--color-danger: #d9606e;
		--color-border: #303643;

		--color-night-deep: #060a13;
		--color-night: #0b1322;
		--color-night-steel: #16233a;
		--color-moon-steel: #33517a;
		--color-moonlight: #7c9cc4;
		--color-champagne: #e4b863;
		--color-champagne-bright: #f3dca8;

		--glass-fill: rgb(255 255 255 / 0.08);
		--glass-fill-quiet: rgb(255 255 255 / 0.05);
		--glass-fill-hover: rgb(255 255 255 / 0.14);
		--glass-border: rgb(255 255 255 / 0.15);
		--glass-border-hover: rgb(255 255 255 / 0.32);
		--glass-luminance: linear-gradient(180deg, rgb(255 255 255 / 0.12), transparent);
		--glass-blur: 60px;
		--glass-blur-mobile: 30px;
		--glass-saturate: 180%;

		--well-moonlight: radial-gradient(circle, rgb(124 156 196 / 0.28) 0%, transparent 65%);
		--well-steel: radial-gradient(circle, rgb(51 81 122 / 0.35) 0%, transparent 65%);
		--well-champagne: radial-gradient(circle, rgb(228 184 99 / 0.12) 0%, transparent 60%);

		--radius-sm: 16px;
		--radius-md: 20px;
		--radius-lg: 24px;
		--radius-xl: 28px;
		--radius-2xl: 32px;
		--radius-full: 9999px;

		--shadow-sm: 0 8px 24px rgb(3 7 18 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.18);
		--shadow-md: 0 16px 40px rgb(3 7 18 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.22), inset 0 -1px 0 rgb(2 6 16 / 0.35);
		--shadow-lg: 0 24px 64px rgb(3 7 18 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.32), inset 0 -1px 0 rgb(2 6 16 / 0.35);
		--shadow-champagne: 0 4px 20px rgb(228 184 99 / 0.15), inset 0 1px 0 rgb(243 220 168 / 0.35);

		--ease-glass: cubic-bezier(0.16, 1, 0.3, 1);
		--duration-base: 500ms;
		--duration-sweep: 700ms;

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-night);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
		min-height: 100vh;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.025em; line-height: 1.15; }
	p { margin: 0; }
	::selection { background: rgb(228 184 99 / 0.3); }
	.spacer { flex: 1; }
	.dim { color: rgb(255 255 255 / 0.6); }
	.faint { color: rgb(255 255 255 / 0.4); }
	.num { font-variant-numeric: tabular-nums; }

	/* ── THE SCENE — fixed behind everything, because glass with nothing
	   behind it is just a translucent box. Never a flat fill. ───────── */
	.scene { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
	.scene .base { position: absolute; inset: 0; background: linear-gradient(165deg, var(--color-night) 0%, var(--color-night-deep) 100%); }
	.well { position: absolute; border-radius: 50%; }
	.well-1 { width: 560px; height: 560px; top: -140px; right: -80px; background: var(--well-moonlight); }
	.well-2 { width: 520px; height: 520px; bottom: -160px; left: -100px; background: var(--well-steel); }
	.well-3 { width: 420px; height: 420px; top: 42%; left: 46%; background: var(--well-champagne); }
	/* Film grain — 2.5% noise takes the plastic off the whole picture. */
	.grain {
		position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: 0.025;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
	}
	.page { position: relative; z-index: 2; }

	.wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }

	/* ── THE PANEL — three layers, all three required ───────────────── */
	.glass {
		position: relative; overflow: hidden;
		background: var(--glass-fill);
		-webkit-backdrop-filter: blur(var(--glass-blur-mobile)) saturate(var(--glass-saturate));
		backdrop-filter: blur(var(--glass-blur-mobile)) saturate(var(--glass-saturate));
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-sm);
		transition: transform var(--duration-base) var(--ease-glass),
			box-shadow var(--duration-base) var(--ease-glass),
			border-color var(--duration-base) var(--ease-glass),
			background-color var(--duration-base) var(--ease-glass);
	}
	@media (min-width: 768px) {
		.glass {
			-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
			backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
			box-shadow: var(--shadow-md);
		}
	}
	/* Layer 2: the inner luminance running down from the lit top edge. */
	.glass::before {
		content: ""; position: absolute; inset: 0; pointer-events: none;
		background: var(--glass-luminance);
	}
	.glass > * { position: relative; z-index: 1; }
	.glass.lift:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: var(--glass-border-hover); }

	/* ── Cover: a night control surface ─────────────────────────────── */
	/* padding-block only — a \`padding\` shorthand here would wipe .wrap's gutters
	   and knock the hero out of line with every panel below it. */
	.topbar { padding-block: 22px 0; }
	/* The nav floats as a pill so the scene keeps running underneath it. */
	.navpill {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 10px 8px 18px; border-radius: var(--radius-full);
	}
	.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -0.02em; }
	.brand .lens { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(145deg, rgb(255 255 255 / 0.5), rgb(124 156 196 / 0.25)); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5); }
	.navlinks { display: none; gap: 22px; font-size: 14px; }
	@media (min-width: 760px) { .navlinks { display: flex; } }
	.navlinks span { color: rgb(255 255 255 / 0.6); }
	.navlinks .is-active { color: #fff; }

	.hero { padding-block: 36px 26px; }
	@media (min-width: 768px) { .hero { padding-block: 56px 34px; } }
	.hero .eyebrow { font-size: 13px; color: rgb(255 255 255 / 0.4); letter-spacing: 0.04em; }
	.hero h1 { font-size: 34px; margin-top: 12px; max-width: 15ch; }
	@media (min-width: 768px) { .hero h1 { font-size: 46px; max-width: 34ch; } }
	.hero p { margin-top: 18px; max-width: 50ch; color: rgb(255 255 255 / 0.6); }
	.hero .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }

	.board { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
	@media (min-width: 880px) { .board { grid-template-columns: 1.3fr 1fr; gap: 20px; } }

	.roomcard { padding: 24px; display: flex; flex-direction: column; }
	@media (min-width: 768px) { .roomcard { padding: 32px; } }
	.roomcard .head { display: flex; align-items: flex-start; gap: 14px; }
	.roomcard .temp { font-size: 52px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
	@media (min-width: 768px) { .roomcard .temp { font-size: 68px; } }
	.roomcard .deg { font-size: 22px; color: rgb(255 255 255 / 0.4); vertical-align: 22px; }
	.roomcard .place { font-size: 14px; color: rgb(255 255 255 / 0.6); }
	.roomcard .when { margin-left: auto; text-align: right; font-size: 13px; color: rgb(255 255 255 / 0.4); }

	/* A slider: recessed night track holding a glass thumb. */
	.cardfoot { margin-top: auto; padding-top: 22px; }
	.ministats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
	.ministat { padding: 14px 16px; border-radius: var(--radius-md); background: rgb(255 255 255 / 0.05); border: 1px solid rgb(255 255 255 / 0.1); }
	.ministat .k { font-size: 12px; color: rgb(255 255 255 / 0.4); }
	.ministat .v { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
	.slider { margin-top: 26px; position: relative; height: 44px; border-radius: var(--radius-full); background: rgb(6 10 19 / 0.55); box-shadow: inset 0 2px 6px rgb(2 6 16 / 0.6); padding: 5px; display: flex; align-items: center; }
	.slider .track { height: 100%; width: 62%; flex: none; position: relative; border-radius: var(--radius-full); background: linear-gradient(90deg, rgb(228 184 99 / 0.28), rgb(228 184 99 / 0.06)); }
	.slider .thumb { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%; background: rgb(255 255 255 / 0.18); border: 1px solid rgb(255 255 255 / 0.42); box-shadow: var(--shadow-sm); }
	.slider .val { margin-left: auto; padding-right: 14px; font-size: 13px; color: rgb(255 255 255 / 0.6); }

	.scenecard { padding: 24px; display: flex; flex-direction: column; }
	@media (min-width: 768px) { .scenecard { padding: 28px; } }
	.scenecard h3 { font-size: 17px; }
	.scenecard .sub { font-size: 13px; color: rgb(255 255 255 / 0.4); margin-top: 4px; }
	.sline { display: flex; align-items: center; gap: 12px; padding: 13px 0; border-bottom: 1px solid rgb(255 255 255 / 0.08); font-size: 14px; }
	.sline:last-of-type { border-bottom: 0; }
	.sline .k { color: rgb(255 255 255 / 0.6); }
	.sline .v { margin-left: auto; font-variant-numeric: tabular-nums; }
	.sline .v.gold { color: var(--color-champagne-bright); }

	/* Devices sit in one full-width row rather than a block that has to be
	   stretched to match its neighbour — stretching opens voids inside glass. */
	.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
	@media (min-width: 880px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; margin-top: 20px; } }
	.tile { padding: 18px; display: flex; flex-direction: column; }
	.tile .ic { width: 38px; height: 38px; border-radius: var(--radius-sm); background: rgb(255 255 255 / 0.1); border: 1px solid rgb(255 255 255 / 0.14); display: grid; place-items: center; font-size: 16px; }
	.tile b { display: block; margin-top: 14px; font-size: 15px; font-weight: 600; }
	/* Scoped to the meta line: a bare \`.tile span\` also hits the icon and the toggle. */
	.tile .meta { font-size: 12px; color: rgb(255 255 255 / 0.4); margin-bottom: 14px; }
	.tile .sw { margin-top: auto; }

	/* Toggle: recessed track, glass thumb, champagne when on. */
	.sw { width: 52px; height: 30px; border-radius: var(--radius-full); background: rgb(6 10 19 / 0.55); box-shadow: inset 0 2px 5px rgb(2 6 16 / 0.55); padding: 3px; display: flex; justify-content: flex-start; }
	.sw.is-on { background: rgb(228 184 99 / 0.22); box-shadow: inset 0 1px 0 rgb(243 220 168 / 0.3); justify-content: flex-end; }
	.sw i { display: block; width: 24px; height: 24px; border-radius: 50%; background: rgb(255 255 255 / 0.22); border: 1px solid rgb(255 255 255 / 0.4); box-shadow: var(--shadow-sm); }
	.sw.is-on i { background: rgb(243 220 168 / 0.9); border-color: rgb(243 220 168 / 0.8); }

	/* Now-playing bar with the specular sweep — one per screen. */
	.nowbar { display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-radius: var(--radius-xl); margin-top: 18px; margin-bottom: 40px; }
	@media (min-width: 880px) { .nowbar { margin-top: 20px; } }
	.nowbar .art { width: 48px; height: 48px; flex: none; border-radius: var(--radius-sm); background: linear-gradient(140deg, #33517a, #0b1322 75%); border: 1px solid rgb(255 255 255 / 0.16); }
	.nowbar b { display: block; font-size: 15px; font-weight: 600; }
	.nowbar span { font-size: 13px; color: rgb(255 255 255 / 0.4); }
	.nowbar .ctrl { display: flex; align-items: center; gap: 16px; color: rgb(255 255 255 / 0.6); font-size: 15px; }
	.sweep::after {
		content: ""; position: absolute; inset: 0; pointer-events: none;
		transform: translateX(-150%) skewX(-20deg);
		background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.25), transparent);
		transition: transform var(--duration-sweep) ease-out;
	}
	.sweep:hover::after { transform: translateX(150%) skewX(-20deg); }

	/* ── Controls ───────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 500;
		padding: 13px 22px; min-height: 46px;
		border-radius: var(--radius-sm);
		background: var(--glass-fill);
		-webkit-backdrop-filter: blur(20px) saturate(var(--glass-saturate));
		backdrop-filter: blur(20px) saturate(var(--glass-saturate));
		border: 1px solid var(--glass-border);
		color: var(--color-surface-foreground);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition: transform var(--duration-base) var(--ease-glass),
			background-color var(--duration-base) var(--ease-glass),
			border-color var(--duration-base) var(--ease-glass),
			box-shadow var(--duration-base) var(--ease-glass);
	}
	.btn:hover { transform: translateY(-2px); background: var(--glass-fill-hover); border-color: var(--glass-border-hover); }
	.btn:active { transform: scale(0.97); transition-duration: 150ms; }
	.btn:focus-visible { outline: none; box-shadow: var(--shadow-sm), 0 0 0 3px rgb(228 184 99 / 0.45); }
	/* The one accent: champagne at low alpha, bright champagne label. */
	.btn-primary {
		background: rgb(228 184 99 / 0.15);
		border-color: rgb(228 184 99 / 0.4);
		color: var(--color-champagne-bright);
		box-shadow: var(--shadow-champagne);
	}
	.btn-primary:hover { background: rgb(228 184 99 / 0.22); border-color: rgb(228 184 99 / 0.55); }
	.btn-quiet { background: transparent; border-color: transparent; box-shadow: none; color: rgb(255 255 255 / 0.6); }
	.btn-quiet:hover { background: rgb(255 255 255 / 0.08); color: #fff; }
	.btn-danger { border-color: rgb(217 96 110 / 0.45); color: #f0a8b1; }
	.btn[disabled] { cursor: not-allowed; background: var(--glass-fill-quiet); border-color: rgb(255 255 255 / 0.08); color: rgb(255 255 255 / 0.3); box-shadow: none; transform: none; }
	.btn-sm { padding: 9px 16px; min-height: 38px; font-size: 14px; border-radius: var(--radius-sm); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* Inputs are a solid raised field, not glass — readable beats translucent. */
	.field { max-width: 400px; }
	.flabel { display: block; font-size: 13px; color: rgb(255 255 255 / 0.6); margin-bottom: 8px; }
	.input {
		font: inherit; font-size: 15px; width: 100%; padding: 13px 16px;
		background: rgb(22 35 58 / 0.85); color: #fff;
		border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
	}
	.input::placeholder { color: rgb(255 255 255 / 0.35); }
	.input:focus { outline: none; border-color: rgb(228 184 99 / 0.55); box-shadow: 0 0 0 3px rgb(228 184 99 / 0.2); }

	.chip {
		display: inline-flex; align-items: center; gap: 7px;
		padding: 5px 14px; border-radius: var(--radius-full);
		background: var(--glass-fill); border: 1px solid var(--glass-border);
		font-size: 13px; color: rgb(255 255 255 / 0.75);
	}
	.chip .d { width: 6px; height: 6px; border-radius: 50%; background: var(--color-moonlight); }
	.chip.gold { border-color: rgb(228 184 99 / 0.4); color: var(--color-champagne-bright); }
	.chip.gold .d { background: var(--color-champagne); }

	/* ── Sections ───────────────────────────────────────────────────── */
	.section { padding-block: 56px; }
	@media (min-width: 768px) { .section { padding-block: 80px; } }
	.section-label { font-size: 13px; color: var(--color-champagne); letter-spacing: 0.06em; margin-bottom: 12px; }
	.section h2 { font-size: 28px; }
	@media (min-width: 768px) { .section h2 { font-size: 38px; } }
	.lede { margin-top: 14px; max-width: 62ch; color: rgb(255 255 255 / 0.6); }
	.note { margin-top: 20px; font-size: 14px; color: rgb(255 255 255 / 0.4); }

	/* Layer explainer */
	.layers { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 30px; }
	@media (min-width: 720px) { .layers { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	.layerbox { padding: 22px; }
	.layerbox .n { font-size: 12px; color: var(--color-champagne); letter-spacing: 0.1em; }
	.layerbox h3 { font-size: 17px; margin-top: 8px; }
	.layerbox p { font-size: 14px; color: rgb(255 255 255 / 0.6); margin-top: 8px; }
	.sample { height: 76px; border-radius: var(--radius-md); margin-top: 16px; position: relative; overflow: hidden; }
	.s-fill { background: var(--glass-fill); border: 1px solid var(--glass-border); }
	.s-lum { background: var(--glass-fill); border: 1px solid var(--glass-border); }
	.s-lum::after { content: ""; position: absolute; inset: 0; background: var(--glass-luminance); }
	.s-shadow { background: var(--glass-fill); border: 1px solid var(--glass-border); box-shadow: var(--shadow-md); }

	.swatches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 28px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
	.sw2 .fill { height: 64px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); }
	.sw2 b { display: block; font-size: 13px; font-weight: 500; margin-top: 10px; }
	.sw2 span { font-size: 12px; color: rgb(255 255 255 / 0.4); }

	/* ── Mobile ─────────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 34px; margin-top: 32px; align-items: start; }
	@media (min-width: 880px) { .mobile { grid-template-columns: 292px 1fr; gap: 48px; } }
	.phone {
		width: 292px; max-width: 100%; margin: 0 auto;
		border-radius: 40px; padding: 9px; overflow: hidden;
		background: rgb(255 255 255 / 0.06);
		border: 1px solid rgb(255 255 255 / 0.16);
		box-shadow: var(--shadow-lg);
	}
	/* The phone carries its own miniature scene — glass needs one at every size. */
	.phone-inner { border-radius: 32px; overflow: hidden; position: relative; background: linear-gradient(165deg, #0b1322, #060a13); min-width: 0; }
	.phone-inner .well { position: absolute; }
	.phone-inner .pw1 { width: 220px; height: 220px; top: -70px; right: -60px; background: var(--well-moonlight); }
	.phone-inner .pw2 { width: 200px; height: 200px; bottom: -60px; left: -50px; background: var(--well-steel); }
	.phone-body { position: relative; z-index: 1; padding: 14px; }
	.phone-status { display: flex; justify-content: space-between; font-size: 10px; color: rgb(255 255 255 / 0.5); padding: 4px 6px 10px; }
	.m-pill { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600; }
	.m-pill .lens { width: 16px; height: 16px; }
	.m-card { padding: 14px; margin-top: 12px; border-radius: var(--radius-xl); }
	.m-card .temp { font-size: 38px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
	.m-card .place { font-size: 11px; color: rgb(255 255 255 / 0.6); }
	.m-slider { margin-top: 12px; height: 32px; border-radius: var(--radius-full); background: rgb(6 10 19 / 0.55); box-shadow: inset 0 2px 5px rgb(2 6 16 / 0.6); padding: 4px; display: flex; align-items: center; }
	.m-slider .track { height: 100%; width: 62%; border-radius: var(--radius-full); background: linear-gradient(90deg, rgb(228 184 99 / 0.28), rgb(228 184 99 / 0.06)); }
	.m-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
	.m-tile { padding: 11px; border-radius: var(--radius-lg); }
	.m-tile b { display: block; font-size: 11px; font-weight: 600; margin-top: 8px; }
	.m-tile .sw { width: 40px; height: 24px; margin-top: 9px; }
	.m-tile .sw i { width: 18px; height: 18px; }
	.m-cta { margin-top: 12px; }
	.m-cta .btn { width: 100%; justify-content: center; padding: 11px; min-height: 42px; font-size: 13px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 15px 0; border-bottom: 1px solid rgb(255 255 255 / 0.1); font-size: 15px; color: rgb(255 255 255 / 0.6); }
	.rules li:last-child { border-bottom: 0; }
	.rules b { display: block; color: #fff; font-size: 15px; font-weight: 600; margin-bottom: 3px; }

	/* ── Off-style ──────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; margin-top: 28px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	/* Everything this system exists to avoid, in one box. */
	.cmp-off {
		padding: 24px; border-radius: 10px;
		background: linear-gradient(135deg, rgb(102 126 234 / 0.55), rgb(118 75 162 / 0.55) 55%, rgb(240 147 251 / 0.5));
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
		border: 1px solid rgb(255 255 255 / 0.35);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
		font-size: 16px; font-weight: 600;
	}
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: rgb(255 255 255 / 0.75); margin-top: 10px; line-height: 1.6; }
	.cmp-on { padding: 24px; font-size: 16px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: rgb(255 255 255 / 0.6); margin-top: 10px; line-height: 1.6; }

	footer { padding-block: 30px 60px; font-size: 13px; color: rgb(255 255 255 / 0.4); }

	@media (prefers-reduced-motion: reduce) {
		.glass, .btn { transition: border-color 200ms linear, box-shadow 200ms linear; }
		.glass.lift:hover, .btn:hover, .btn:active { transform: none; }
		.sweep::after, .sweep:hover::after { transition: none; transform: translateX(-150%) skewX(-20deg); }
	}
</style>
</head>
<body>

<!-- THE SCENE — deep ink base plus three soft light wells. The glass has
     nothing to refract without it, so it is built first and sits behind
     everything, fixed, for the whole page. -->
<div class="scene" aria-hidden="true">
	<div class="base"></div>
	<div class="well well-1"></div>
	<div class="well well-2"></div>
	<div class="well well-3"></div>
</div>
<div class="grain" aria-hidden="true"></div>

<div class="page">

<!-- COVER — a night control surface. Colourless panels, one champagne action. -->
<div class="wrap topbar">
	<div class="navpill glass">
		<span class="brand"><span class="lens"></span>Nocturne</span>
		<nav class="navlinks"><span class="is-active">Home</span><span>Rooms</span><span>Scenes</span><span>Energy</span></nav>
		<span class="spacer"></span>
		<span class="chip"><span class="d"></span>4 devices on</span>
		<button class="btn btn-sm">Menu</button>
	</div>
</div>

<div class="wrap hero">
	<p class="eyebrow">Good evening — 21:48</p>
	<h1>The scene carries the colour. The glass only borrows its light.</h1>
	<p>Colourless white panels at eight percent, sixty pixels of blur and a saturation
		boost, over a deep ink night lit by two soft wells. One champagne accent, and nothing else.</p>
	<div class="actions">
		<button class="btn btn-primary">Set evening scene</button>
		<button class="btn">All devices</button>
	</div>
</div>

<div class="wrap board">
	<div class="roomcard glass lift">
		<div class="head">
			<div>
				<div class="temp num">21<span class="deg">°C</span></div>
				<div class="place">Living room · target 22°</div>
			</div>
			<div class="when">
				<div>Outside 8°</div>
				<div class="faint">Clear night</div>
			</div>
		</div>
		<div class="slider">
			<span class="track"><span class="thumb"></span></span>
			<span class="val num">62%</span>
		</div>
		<div class="ministats">
			<div class="ministat"><div class="k">Humidity</div><div class="v num">44%</div></div>
			<div class="ministat"><div class="k">Air</div><div class="v">Good</div></div>
			<div class="ministat"><div class="k">Tonight</div><div class="v num">1.4 kWh</div></div>
		</div>
		<div class="row cardfoot">
			<span class="chip gold"><span class="d"></span>Evening scene</span>
			<span class="chip"><span class="d"></span>Auto until 07:00</span>
		</div>
	</div>

	<div class="scenecard glass lift">
		<h3>Evening scene</h3>
		<p class="sub">Runs at sunset · 4 devices</p>
		<div style="margin-top: 8px;">
			<div class="sline"><span class="k">Lights</span><span class="v gold num">40%</span></div>
			<div class="sline"><span class="k">Blinds</span><span class="v">Closed</span></div>
			<div class="sline"><span class="k">Target</span><span class="v num">22°</span></div>
			<div class="sline"><span class="k">Music</span><span class="v">Living room</span></div>
		</div>
		<div class="cardfoot">
			<button class="btn btn-sm btn-primary">Run now</button>
			<button class="btn btn-sm">Edit</button>
		</div>
	</div>
</div>

<div class="wrap tiles">
	<div class="tile glass lift">
		<span class="ic">◐</span>
		<b>Ambient</b><span class="meta">3 lamps · warm</span>
		<span class="sw is-on"><i></i></span>
	</div>
	<div class="tile glass lift">
		<span class="ic">≋</span>
		<b>Climate</b><span class="meta">Quiet mode</span>
		<span class="sw is-on"><i></i></span>
	</div>
	<div class="tile glass lift">
		<span class="ic">◫</span>
		<b>Blinds</b><span class="meta">Closed</span>
		<span class="sw"><i></i></span>
	</div>
	<div class="tile glass lift">
		<span class="ic">♪</span>
		<b>Speakers</b><span class="meta">Living room</span>
		<span class="sw is-on"><i></i></span>
	</div>
</div>

<div class="wrap">
	<div class="nowbar glass sweep">
		<span class="art"></span>
		<span><b>Nocturne in E-flat</b><span>Now playing · Living room</span></span>
		<span class="spacer"></span>
		<span class="ctrl"><span>⏮</span><span>⏸</span><span>⏭</span></span>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Scene before glass</p>
		<h2>Build the night first</h2>
		<p class="lede">A deep ink base and two or three large, soft light wells at low alpha. The wells
			sit behind panel edges rather than behind body text, so there is always something with structure
			for the blur to pick up. A flat background — or the familiar purple-to-pink gradient — leaves the
			glass with nothing to do.</p>
		<div class="swatches">
			<div class="sw2"><div class="fill" style="background: var(--color-night-deep)"></div><b>night-deep</b><span>page edges</span></div>
			<div class="sw2"><div class="fill" style="background: var(--color-night)"></div><b>night</b><span>the base</span></div>
			<div class="sw2"><div class="fill" style="background: var(--color-night-steel)"></div><b>night-steel</b><span>fields, bands</span></div>
			<div class="sw2"><div class="fill" style="background: var(--color-moon-steel)"></div><b>moon-steel</b><span>deep light well</span></div>
			<div class="sw2"><div class="fill" style="background: var(--color-moonlight)"></div><b>moonlight</b><span>bright light well</span></div>
		</div>
		<p class="note">The well colours appear only as large low-alpha radials. They are never a fill, a border, or a text colour.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — The panel</p>
		<h2>Three layers, all three required</h2>
		<p class="lede">Drop any one of them and the result is flat translucency — the thing that reads
			as "a div with opacity" rather than as a material.</p>
		<div class="layers">
			<div class="layerbox glass">
				<div class="n">LAYER 1</div>
				<h3>Colourless fill</h3>
				<p>White at 5–12%, never above 15% and never tinted, with heavy blur and a saturation boost so the scene's lights glow through.</p>
				<div class="sample s-fill"></div>
			</div>
			<div class="layerbox glass">
				<div class="n">LAYER 2</div>
				<h3>Inner luminance</h3>
				<p>A white gradient falling from the top edge, which is what makes the surface look lit from above rather than evenly tinted.</p>
				<div class="sample s-lum"></div>
			</div>
			<div class="layerbox glass">
				<div class="n">LAYER 3</div>
				<h3>Directional shadow</h3>
				<p>Outer depth, a lit inset top edge, a shaded inset bottom edge. A single-layer shadow gives the panel no direction.</p>
				<div class="sample s-shadow"></div>
			</div>
		</div>
		<p class="note">Panels never nest. Glass inside glass doubles the blur and turns both panels to milk. A 2.5% film-grain overlay across the viewport takes the plastic off the whole picture.</p>
	</section>

	<!-- 03 -->
	<section class="section">
		<p class="section-label">03 — Controls</p>
		<h2>One champagne accent</h2>
		<p class="lede">The primary action is a champagne fill at fifteen percent with a champagne border
			at forty and a bright champagne label. Everything else is the same colourless glass as the panels.
			Hover lifts and brightens the border; press settles to 0.97.</p>
		<div class="row" style="margin-top: 26px;">
			<button class="btn btn-primary">Set scene</button>
			<button class="btn">Secondary</button>
			<button class="btn btn-quiet">Quiet</button>
			<button class="btn btn-danger">Remove device</button>
			<button class="btn" disabled>Syncing…</button>
		</div>
		<div class="row" style="margin-top: 22px; align-items: flex-end;">
			<div class="field">
				<label class="flabel">Scene name</label>
				<input class="input" placeholder="Late evening">
			</div>
			<button class="btn btn-primary">Save</button>
		</div>
		<p class="note">Inputs are a solid raised field rather than glass. Text over a blurred scene is harder to read than it looks in a mockup, and readable beats translucent every time.</p>
		<div class="row" style="margin-top: 22px;">
			<span class="chip"><span class="d"></span>Live</span>
			<span class="chip gold"><span class="d"></span>Champagne accent</span>
			<span class="sw is-on"><i></i></span>
			<span class="sw"><i></i></span>
		</div>
	</section>

	<!-- 04 MOBILE -->
	<section class="section">
		<p class="section-label">04 — Mobile</p>
		<h2>The blur scales down, the scene never goes away</h2>
		<p class="lede">Sixty pixels of blur on a phone is expensive and, on a small panel, indistinguishable
			from thirty. What must not change is the scene underneath: a phone build with a flat background and
			glass on top of it is the most common way this style collapses.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-inner">
					<div class="well pw1"></div>
					<div class="well pw2"></div>
					<div class="phone-body">
						<div class="phone-status"><span>21:48</span><span>5G ▮</span></div>
						<div class="m-pill glass">
							<span class="brand" style="font-size:12px"><span class="lens"></span>Nocturne</span>
							<span class="spacer"></span>
							<span class="faint" style="font-size:10px">4 on</span>
						</div>
						<div class="m-card glass">
							<div class="temp num">21°</div>
							<div class="place">Living room · target 22°</div>
							<div class="m-slider"><span class="track"></span></div>
						</div>
						<div class="m-tiles">
							<div class="m-tile glass"><span class="ic" style="width:28px;height:28px;font-size:13px">◐</span><b>Ambient</b><span class="sw is-on"><i></i></span></div>
							<div class="m-tile glass"><span class="ic" style="width:28px;height:28px;font-size:13px">◫</span><b>Blinds</b><span class="sw"><i></i></span></div>
						</div>
						<div class="m-cta"><button class="btn btn-primary">Set evening scene</button></div>
					</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Blur</b>60px → 30px below the tablet breakpoint. Below about 20px the panel stops reading as glass, so 30px is the floor rather than a starting point.</li>
				<li><b>Shadow</b><code>shadow-md</code> → <code>shadow-sm</code>: the outer depth halves and the shaded bottom inset edge drops, but the lit top edge stays — that inset highlight is what makes the panel look lit from above.</li>
				<li><b>The scene shrinks with the screen</b>Light wells go from ~560px to ~220px so two of them still land behind panel edges. Scaling the page down without scaling the wells leaves the glass sitting over flat colour.</li>
				<li><b>Padding</b>Cards 32px → 14–24px, buttons 22px → 16px. Panels still keep clear space between them; overlapping blurs on a small screen turn the whole surface milky.</li>
				<li><b>Radius</b>32px → 24px on cards, 40px on the device shell. The floor stays at 16px at every width.</li>
				<li><b>Hover has no equivalent</b>The lift and the specular sweep are dropped on touch; press-to-0.97 and the border brightening carry the whole interaction.</li>
				<li><b>Type</b>Headings 54px → 34px; body stays 15–16px at 60% white. Captions never drop below 40% — on a phone held at arm's length that is already the floor for legibility.</li>
				<li><b>Cost</b>Backdrop blur is the most expensive thing on the page. Keep the number of simultaneously visible glass panels in single digits, and never animate the blur radius itself.</li>
			</ul>
		</div>
	</section>

	<!-- 05 DON'T -->
	<section class="section">
		<p class="section-label">05 — Off-style, for contrast</p>
		<h2>What breaks the illusion</h2>
		<div class="compare">
			<div class="cmp-off">Tinted purple-pink glass
				<small>A violet-to-pink fill at 55%, 4px of blur, no saturation boost, a flat outer shadow and a 10px corner. This is the generic look the system is defined against — and every one of those five choices is independently disqualifying.</small></div>
			<div class="cmp-on glass">Same panel, on-style
				<small>Colourless white at 8%, 60px blur with a 180% saturation boost, the inner luminance gradient, a directional shadow with lit and shaded inset edges, and a 32px corner.</small></div>
		</div>
		<p class="note">Also out: glass over a flat background, fills above 15%, nested panels, a second accent colour, gradient text, and transitions fast enough to snap.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — glassmorphism · colourless glass, one champagne accent.</div></footer>

</div>
</body>
</html>
`;

const Openai_THEME = `/* OpenAI — restrained lab white, teal signal, generous air. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #10a37f;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #202123;
	--color-surface-raised: #f7f7f8;
	--color-muted: #6e6e80;
	--color-accent: #ab68ff;
	--color-danger: #ef4146;
	--color-border: #ececf1;

	--radius-sm: 6px;
	--radius-md: 8px;
	--radius-lg: 12px;
	--radius-xl: 16px;
	--radius-2xl: 24px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
	--shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
	--shadow-lg: 0 12px 40px rgb(0 0 0 / 0.12);
}
`;

const Openai_SPEC = `# OpenAI

## Atmosphere
A restrained research lab. Off-white calm, near-mono palette, one teal
signal. Interfaces read like well-set documents: quiet, precise, spacious.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white; \`surface-raised\` (#f7f7f8) for wells, sidebars, code.
- \`primary\` teal used surgically: primary button, active state, links.
- \`accent\` purple extremely rare — a badge or a data series, never layout.
- Ink \`surface-foreground\` (soft near-black); most supporting text \`muted\`.

## Typography
System font stack only. Editorial-technical:
- Headings \`font-semibold tracking-tight\` 20–36px with generous top margin.
- Body 15–16px \`leading-relaxed\`; UI labels 13–14px.
- \`font-mono\` for code/model names in \`surface-raised\` chips with border.

## Shape & depth
- Medium-soft radii: controls \`rounded-lg\` (12px), cards \`rounded-xl\`.
- Nearly flat: hairline borders + \`surface-raised\` fills; \`shadow-md\` only on
  menus/dialogs. Whitespace is the depth.

## Components
- Buttons: h-10 \`rounded-lg\`; primary filled teal; secondary bordered white;
  ghost for toolbars.
- Chat blocks: alternating plain \`surface\` and \`surface-raised\` full-width
  bands with a centered ~768px text column.
- Inputs: the composer is the hero — \`rounded-xl\` bordered field with
  \`shadow-sm\` and an icon send button.
- Cards: bordered, minimal — small \`muted\` label, 15px title, no imagery.

## Layout
One centered reading column (~768px) for content; optional 260px sidebar on
\`surface-raised\`. Section spacing 48–64px; in-card spacing 16/24.

## Don'ts
- Never more than teal + one neutral on screen; no gradients, no glow.
- No dense dashboards or heavy tables; break data into quiet cards.
- No pure black text or borders — everything is softened one step.
`;

const Openai_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAI — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #10a37f;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #202123;
		--color-surface-raised: #f7f7f8;
		--color-muted: #6e6e80;
		--color-accent: #ab68ff;
		--color-danger: #ef4146;
		--color-border: #ececf1;

		--radius-sm: 6px;
		--radius-md: 8px;
		--radius-lg: 12px;
		--radius-xl: 16px;
		--radius-2xl: 24px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
		--shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
		--shadow-lg: 0 12px 40px rgb(0 0 0 / 0.12);

		--sans: -apple-system, BlinkMacSystemFont, "Söhne", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.75;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
	p { margin: 0; }
	::selection { background: rgb(16 163 127 / 0.18); }
	code { font-family: var(--mono); font-size: 0.86em; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1px 6px; }

	/* Everything lives in one centered 768px reading column. */
	.col { max-width: 768px; margin: 0 auto; padding: 0 20px; }
	@media (min-width: 768px) { .col { padding: 0 32px; } }

	/* ── App chrome: quiet rail, no shadow, no color ───────────────── */
	.top {
		display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
		height: 56px; padding: 0 20px;
		border-bottom: 1px solid var(--color-border);
	}
	@media (min-width: 768px) { .top { padding: 0 32px; } }
	.mark { width: 24px; height: 24px; border-radius: 50%; border: 2.5px solid var(--color-surface-foreground); }
	.top b { font-size: 15px; font-weight: 600; }
	.spacer { flex: 1; }
	.chip {
		display: inline-flex; align-items: center; gap: 6px;
		font-family: var(--mono); font-size: 12px;
		background: var(--color-surface-raised); border: 1px solid var(--color-border);
		border-radius: 9999px; padding: 3px 12px; color: var(--color-muted);
	}
	.chip .d { width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary); }

	/* ── Conversation: alternating full-width bands ────────────────── */
	.band { border-bottom: 1px solid var(--color-border); }
	.band.raised { background: var(--color-surface-raised); }
	.turn { display: flex; gap: 20px; padding: 28px 0; }
	@media (max-width: 600px) { .turn { gap: 14px; padding: 22px 0; } }
	.who {
		flex: none; width: 30px; height: 30px; border-radius: var(--radius-sm);
		display: grid; place-items: center; font-size: 12px; font-weight: 600;
		background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-muted);
	}
	.who.ai { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
	.msg { min-width: 0; font-size: 16px; }
	.msg p + p { margin-top: 16px; }
	.msg ul { margin: 16px 0 0; padding-left: 20px; color: var(--color-surface-foreground); }
	.msg li { margin-top: 6px; }
	.msg .meta { margin-top: 14px; font-size: 13px; color: var(--color-muted); display: flex; gap: 14px; flex-wrap: wrap; }
	.codeblock {
		margin-top: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		overflow: hidden; background: var(--color-surface);
	}
	.codeblock .h { display: flex; align-items: center; padding: 8px 14px; background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border); font-family: var(--mono); font-size: 12px; color: var(--color-muted); }
	.codeblock pre { margin: 0; padding: 14px; font-family: var(--mono); font-size: 13px; line-height: 1.7; overflow-x: auto; }
	.codeblock .c { color: var(--color-muted); }
	.codeblock .s { color: var(--color-primary); }

	/* ── Composer: the hero control of the whole system ───────────── */
	.composer-band { padding: 28px 0 40px; }
	.composer {
		display: flex; align-items: flex-end; gap: 10px;
		border: 1px solid var(--color-border); border-radius: var(--radius-xl);
		box-shadow: var(--shadow-sm);
		padding: 12px 12px 12px 18px; background: var(--color-surface);
	}
	.composer .ph { flex: 1; color: var(--color-muted); font-size: 16px; padding: 4px 0 10px; }
	.send {
		flex: none; width: 34px; height: 34px; border: 0; border-radius: var(--radius-md);
		background: var(--color-primary); color: #fff; cursor: pointer;
		font-size: 15px; line-height: 1;
	}
	.send:hover { background: #0e8f6f; }
	.composer-note { margin-top: 12px; text-align: center; font-size: 12px; color: var(--color-muted); }

	/* ── Reference sections ───────────────────────────────────────── */
	.section { padding: 56px 0; border-bottom: 1px solid var(--color-border); }
	@media (min-width: 768px) { .section { padding: 72px 0; } }
	.section-label { font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-muted); margin-bottom: 12px; }
	.section h2 { font-size: 26px; }
	@media (min-width: 768px) { .section h2 { font-size: 32px; } }
	.lede { color: var(--color-muted); margin-top: 14px; }
	.note { margin-top: 20px; font-size: 14px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	/* ── Buttons ──────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 500;
		height: 40px; padding: 0 18px;
		border: 1px solid transparent; border-radius: var(--radius-lg);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease;
	}
	.btn:hover { background: #0e8f6f; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(16 163 127 / 0.28); }
	.btn-secondary { background: var(--color-surface); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: var(--color-surface-raised); }
	.btn-ghost { background: transparent; color: var(--color-muted); }
	.btn-ghost:hover { background: var(--color-surface-raised); color: var(--color-surface-foreground); }
	.btn[disabled] { cursor: not-allowed; background: var(--color-surface-raised); color: #b4b4bd; border-color: var(--color-border); }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 380px; height: 44px; padding: 0 14px;
		border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #a0a0ab; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgb(16 163 127 / 0.15); }

	/* ── Quiet cards: no imagery, no shadow, one small label ──────── */
	.cards { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 28px; }
	@media (min-width: 640px) { .cards { grid-template-columns: repeat(2, 1fr); } }
	.card { border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 24px; }
	.card .k { font-family: var(--mono); font-size: 12px; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.06em; }
	.card h3 { font-size: 16px; margin-top: 10px; }
	.card p { font-size: 14px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 28px; }
	@media (min-width: 640px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 60px; border-radius: var(--radius-lg); border: 1px solid var(--color-border); }
	.sw b { display: block; font-family: var(--mono); font-size: 12px; font-weight: 400; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 32px; align-items: start; }
	@media (min-width: 820px) { .mobile { grid-template-columns: 280px 1fr; gap: 40px; } }
	.phone {
		width: 280px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 26px;
		background: var(--color-surface); box-shadow: var(--shadow-lg); overflow: hidden;
	}
	.phone-status { display: flex; justify-content: space-between; padding: 10px 18px 4px; font-size: 10px; color: var(--color-muted); }
	.phone-top { display: flex; align-items: center; gap: 8px; padding: 6px 16px 12px; border-bottom: 1px solid var(--color-border); font-size: 13px; }
	.phone-top .mark { width: 18px; height: 18px; border-width: 2px; }
	/* Bands run edge to edge on the phone: the alternating fill is what
	   separates turns, so it must not be inset into bubbles. */
	.m-turn { padding: 14px 16px; font-size: 13px; line-height: 1.6; display: flex; gap: 10px; }
	.m-turn.raised { background: var(--color-surface-raised); }
	.m-turn .who { width: 22px; height: 22px; font-size: 10px; }
	.m-composer { margin: 12px 14px 18px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); padding: 8px 8px 8px 14px; }
	.m-composer .ph { flex: 1; font-size: 12px; color: var(--color-muted); }
	.m-composer .send { width: 28px; height: 28px; font-size: 13px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 14px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 28px; }
	@media (min-width: 640px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off {
		padding: 24px; border-radius: 24px; color: #fff;
		background: linear-gradient(135deg, #10a37f, #ab68ff);
		box-shadow: 0 16px 40px rgb(171 104 255 / 0.35);
		font-size: 17px; font-weight: 700;
	}
	.cmp-off small { display: block; font-size: 13px; font-weight: 400; opacity: 0.92; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-xl); font-size: 17px; font-weight: 600; }
	.cmp-on small { display: block; font-size: 13px; font-weight: 400; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	footer { padding: 40px 0 64px; font-size: 13px; color: var(--color-muted); text-align: center; }
</style>
</head>
<body>

<!-- COVER — a conversation. Alternating full-width bands, a centered text
     column, and one teal control. Nothing else is colored. -->
<div class="top">
	<span class="mark"></span><b>Vetta</b>
	<span class="chip"><span class="d"></span>research-preview</span>
	<span class="spacer"></span>
	<button class="btn btn-ghost">Share</button>
	<button class="btn btn-secondary">New chat</button>
</div>

<div class="band">
	<div class="col">
		<div class="turn">
			<span class="who">You</span>
			<div class="msg">
				<p>What actually distinguishes this design system from a generic white-and-gray one?</p>
			</div>
		</div>
	</div>
</div>

<div class="band raised">
	<div class="col">
		<div class="turn">
			<span class="who ai">◎</span>
			<div class="msg">
				<p>Three things, in order of how much they matter:</p>
				<ul>
					<li><b>Bands, not bubbles.</b> A turn is a full-width strip of <code>surface</code> or <code>surface-raised</code>
						with the text held to a 768px column. No chat bubble ever appears.</li>
					<li><b>One signal color.</b> Teal marks the primary action, the active state and links — nothing else.
						Purple exists but is reserved for a badge or a single data series.</li>
					<li><b>Whitespace is the depth.</b> Borders are hairlines, fills are one step off white, and the only
						shadow in the system belongs to a menu or the composer.</li>
				</ul>
				<div class="codeblock">
					<div class="h">tokens.css</div>
					<pre><span class="c">/* the signal, and everything else */</span>
--color-primary: <span class="s">#10a37f</span>;   <span class="c">/* teal: action, active, link */</span>
--color-accent:  #ab68ff;   <span class="c">/* badge or one series — never layout */</span>
--color-border:  #ececf1;   <span class="c">/* hairline, softened one step */</span></pre>
				</div>
				<div class="meta"><span>gpt-style · 812 tokens</span><span>Copy</span><span>Regenerate</span></div>
			</div>
		</div>
	</div>
</div>

<div class="band">
	<div class="col composer-band">
		<div class="composer">
			<span class="ph">Ask a follow-up…</span>
			<button class="send">↑</button>
		</div>
		<p class="composer-note">The composer is the hero control: 16px radius, hairline border, the only <code>shadow-sm</code> on the page.</p>
	</div>
</div>

<div class="col">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Controls</p>
		<h2>Forty pixels tall, softened one step</h2>
		<p class="lede">Buttons are 12px-radius rectangles: filled teal for the one real action, bordered
			white for secondary, ghost inside toolbars. Focus is a soft teal ring, never a hard outline.</p>
		<div class="row" style="margin-top: 28px;">
			<button class="btn">Primary</button>
			<button class="btn btn-secondary">Secondary</button>
			<button class="btn btn-ghost">Ghost</button>
			<button class="btn" disabled>Generating…</button>
		</div>
		<div class="row" style="margin-top: 20px;">
			<input class="input" placeholder="you@company.com">
			<button class="btn">Join the waitlist</button>
		</div>
		<div class="row" style="margin-top: 20px;">
			<span class="chip">gpt-4-turbo</span><span class="chip">128k context</span><span class="chip"><span class="d"></span>online</span>
		</div>
		<p class="note">Model names, token counts and every other machine value live in bordered mono chips on <code>surface-raised</code>.</p>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Cards</p>
		<h2>Quiet cards, no imagery</h2>
		<div class="cards">
			<div class="card"><div class="k">Research</div><h3>Break data into calm blocks</h3><p>There are no dense dashboards here. A metric gets a card, a sentence and a lot of air around it.</p></div>
			<div class="card"><div class="k">Safety</div><h3>Hairlines instead of shadows</h3><p>Structure is a 1px #ececf1 border. Depth is the 48–64px gap between sections.</p></div>
		</div>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>teal signal</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>bands, wells, code</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>rare · badge only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>ink</b><span>#202123 · softened black</span></div>
		</div>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>The column was always the point</h2>
		<p class="lede">On a phone the 768px column simply becomes the screen. Bands still run edge to edge,
			the composer docks to the bottom, and the sidebar becomes a drawer — the reading rhythm is untouched.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>5G ▮</span></div>
				<div class="phone-top"><span class="mark"></span><b>Vetta</b><span class="spacer"></span><span class="chip" style="font-size:10px;padding:2px 8px">preview</span></div>
				<div class="m-turn"><span class="who">You</span><span>What makes this system different?</span></div>
				<div class="m-turn raised"><span class="who ai">◎</span><span>Bands instead of bubbles, one teal signal, and whitespace doing the work a shadow usually does.</span></div>
				<div class="m-turn"><span class="who">You</span><span>And on a small screen?</span></div>
				<div class="m-turn raised"><span class="who ai">◎</span><span>Identical. The column becomes the viewport and nothing else moves.</span></div>
				<div class="m-composer"><span class="ph">Ask a follow-up…</span><button class="send">↑</button></div>
			</div>
			<ul class="rules">
				<li><b>Bands stay full-bleed</b>The alternating <code>surface</code> / <code>surface-raised</code> strip is what separates turns. It must reach both edges — turning it into an inset bubble is the one change that breaks the system.</li>
				<li><b>Composer docks</b>It pins to the bottom above the keyboard, keeps its 16px radius and hairline border, and the send button stays 34px so it clears the touch minimum.</li>
				<li><b>Sidebar</b>The optional 260px conversation rail becomes a drawer over a light scrim, still on <code>surface-raised</code> with no shadow of its own.</li>
				<li><b>Type</b>Body 16px → 15px; headings 32px → 26px. Line height stays at 1.75 — the generous leading is what makes long answers readable on a phone.</li>
				<li><b>Gutters</b>32px → 20px. The turn's avatar gap tightens from 20px to 14px, and that is the only density change.</li>
				<li><b>Code</b>Code blocks keep their border and 13px mono, and scroll horizontally inside the block. Wrapping code is never allowed.</li>
				<li><b>Targets</b>Every control clears 44px on touch, which is why inputs are already 44px on desktop rather than shrinking to fit a toolbar.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the lab</h2>
		<div class="compare">
			<div class="cmp-off">Teal-to-purple gradient
				<small>24px radius · two-hue gradient · colored glow · bold white type. Putting the accent and the signal in one gradient is the loudest possible mistake here.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>16px radius, white fill, hairline border, no shadow, ink text. Teal appears once — on the button you actually want pressed.</small></div>
		</div>
		<p class="note">Also out: pure black text or borders, dense tables, glows, and any surface that needs two colors to explain itself.</p>
	</section>
</div>

<footer>Vetta design reference — openai · one teal signal, one reading column.</footer>
</body>
</html>
`;

const Slack_THEME = `/* Slack — friendly workspace white, aubergine anchor, candy accents. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #4a154b;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #1d1c1d;
	--color-surface-raised: #f8f8f8;
	--color-muted: #616061;
	--color-accent: #36c5f0;
	--color-danger: #e01e5a;
	--color-border: #dddddd;

	--radius-sm: 4px;
	--radius-md: 6px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.08);
	--shadow-md: 0 4px 12px rgb(0 0 0 / 0.12);
	--shadow-lg: 0 12px 36px rgb(0 0 0 / 0.16);
}
`;

const Slack_SPEC = `# Slack

## Atmosphere
A friendly workplace lobby. White and airy where you read, deep aubergine
where you navigate, with candy-colored moments that keep it human. Chatty,
approachable, but organized.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white for content; the left nav rail is the ONE dark area — fill
  it with \`primary\` (aubergine) and white/70 text.
- \`primary\` also styles primary buttons and active states outside the rail.
- \`accent\` (sky blue) for links/mentions/info; \`danger\` (pink-red) for
  notifications and destructive actions.
- Body ink \`surface-foreground\`; timestamps and hints \`muted\`.

## Typography
System font stack only. Conversational clarity:
- Channel/heading text \`font-bold\` 15–18px (bold, not big).
- Messages 15px with \`leading-relaxed\`; sender names \`font-bold\`.
- Timestamps/meta 12px \`muted\`; buttons 13px \`font-semibold\`.

## Shape & depth
- Modest radii (\`rounded-lg\` ≈ 8px); avatars \`rounded-lg\` (not circles).
- Mostly flat: hairline \`border\` between panes; \`shadow-md\` for popovers,
  hover toolbars, and modals only.

## Components
- Buttons: h-9 \`rounded-lg\`; primary filled aubergine; secondary white with
  border; a green "Go" variant only for calls/join.
- Message row: 36px avatar, name+time header line, hover reveals an icon
  toolbar floating with \`shadow-sm\`.
- Sidebar items: 28px rows, white/70, active = white text on \`white/15\` fill.
- Emoji/reaction chips: \`surface-raised\` pills with count, selected gets
  \`accent/15\` fill + accent border.

## Layout
Classic three-pane: 260px aubergine rail, content column, optional thread
pane. Message list is the page — full-height scroll with sticky date pills.

## Don'ts
- Aubergine never appears in the content pane as fills — rail/buttons only.
- Never gray-on-gray text; hints use \`muted\` on white.
- No sharp corporate tables; everything reads as conversation blocks.
`;

const Slack_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slack — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #4a154b;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #1d1c1d;
		--color-surface-raised: #f8f8f8;
		--color-muted: #616061;
		--color-accent: #36c5f0;
		--color-danger: #e01e5a;
		--color-border: #dddddd;

		--radius-sm: 4px;
		--radius-md: 6px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.08);
		--shadow-md: 0 4px 12px rgb(0 0 0 / 0.12);
		--shadow-lg: 0 12px 36px rgb(0 0 0 / 0.16);

		--green: #2eb67d;
		--yellow: #ecb22e;
		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 15px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	/* Bold, not big — headings gain weight instead of size. */
	h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; }
	p { margin: 0; }
	::selection { background: rgb(54 197 240 / 0.35); }
	.spacer { flex: 1; }

	/* ── Three-pane workspace ─────────────────────────────────────── */
	.app { display: grid; grid-template-columns: 1fr; border-bottom: 1px solid var(--color-border); }
	@media (min-width: 940px) { .app { grid-template-columns: 260px 1fr 300px; } }

	/* The rail is the ONE dark area in the entire system. */
	.rail { display: none; background: var(--color-primary); color: rgb(255 255 255 / 0.72); padding: 12px 8px; }
	@media (min-width: 940px) { .rail { display: block; } }
	.ws { display: flex; align-items: center; gap: 8px; padding: 4px 8px 16px; color: #fff; font-weight: 700; font-size: 17px; }
	.ws .logo { width: 24px; height: 24px; border-radius: var(--radius-md); background: #fff; flex: none; position: relative; }
	.ws .logo::after { content: ""; position: absolute; inset: 6px; border-radius: 2px; background: var(--color-primary); }
	.r-group { font-size: 13px; padding: 14px 8px 4px; opacity: 0.75; display: flex; align-items: center; gap: 6px; }
	.r-item { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border-radius: var(--radius-sm); font-size: 15px; }
	.r-item .h { opacity: 0.7; }
	.r-item.is-active { background: rgb(255 255 255 / 0.15); color: #fff; font-weight: 700; }
	.r-item.unread { color: #fff; font-weight: 700; }
	.r-item .pill { margin-left: auto; background: var(--color-danger); color: #fff; font-size: 12px; font-weight: 700; border-radius: 9999px; padding: 0 7px; }
	.r-item .dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; }
	.r-item .dot.on { background: var(--green); border-color: var(--green); }

	.pane { min-width: 0; border-right: 1px solid var(--color-border); }
	.ch-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px; border-bottom: 1px solid var(--color-border); }
	.ch-head h1 { font-size: 18px; }
	.ch-head .meta { font-size: 13px; color: var(--color-muted); }
	.faces { display: flex; align-items: center; gap: 6px; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 3px 8px; font-size: 13px; color: var(--color-muted); }
	.face { width: 20px; height: 20px; border-radius: var(--radius-sm); }

	.messages { padding: 12px 0 8px; }
	.datepill { text-align: center; position: relative; margin: 14px 0; }
	.datepill::before { content: ""; position: absolute; left: 20px; right: 20px; top: 50%; border-top: 1px solid var(--color-border); }
	.datepill span { position: relative; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 9999px; padding: 2px 14px; font-size: 13px; font-weight: 700; }

	/* Message row: 36px square avatar, bold name + time, relaxed body. */
	.msg { display: flex; gap: 10px; padding: 8px 20px; position: relative; }
	.msg:hover { background: var(--color-surface-raised); }
	.av { width: 36px; height: 36px; border-radius: var(--radius-lg); flex: none; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 13px; }
	.msg .body { min-width: 0; }
	.msg .line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
	.msg .name { font-weight: 700; font-size: 15px; }
	.msg .time { font-size: 12px; color: var(--color-muted); }
	.msg .txt { font-size: 15px; }
	.msg .txt a, .mention { color: var(--color-accent); font-weight: 500; }
	.mention { background: rgb(54 197 240 / 0.14); border-radius: var(--radius-sm); padding: 0 3px; }
	.tag-badge { font-size: 11px; font-weight: 700; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0 5px; color: var(--color-muted); }

	.reactions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
	.rx { display: inline-flex; align-items: center; gap: 5px; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: 9999px; padding: 1px 9px; font-size: 12px; font-weight: 700; color: var(--color-muted); }
	.rx.on { background: rgb(54 197 240 / 0.15); border-color: var(--color-accent); color: #1264a3; }
	.thread { margin-top: 6px; font-size: 13px; color: var(--color-accent); font-weight: 700; display: flex; align-items: center; gap: 6px; }
	.thread .faces2 { display: flex; }
	.thread .faces2 span { width: 18px; height: 18px; border-radius: var(--radius-sm); margin-right: -4px; border: 1.5px solid #fff; }

	/* Hover toolbar: the one floating thing inside the message list. */
	.hovertools { position: absolute; right: 20px; top: -10px; display: flex; gap: 2px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 3px; }
	.hovertools span { width: 26px; height: 26px; display: grid; place-items: center; border-radius: var(--radius-sm); font-size: 13px; color: var(--color-muted); }

	.composer { margin: 8px 20px 20px; border: 1px solid #8d8d8e; border-radius: var(--radius-lg); }
	.composer .fmt { display: flex; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--color-border); color: var(--color-muted); font-size: 13px; }
	.composer .ph { padding: 10px 12px; color: #868686; font-size: 15px; }
	.composer .foot { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px 12px; color: var(--color-muted); font-size: 14px; }

	.thr { display: none; padding: 0; }
	@media (min-width: 940px) { .thr { display: block; } }
	.thr-head { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--color-border); font-weight: 700; }
	.thr .msg { padding: 8px 16px; }

	/* ── Reference sections ───────────────────────────────────────── */
	.wrap { max-width: 940px; margin: 0 auto; padding: 0 20px 80px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px 104px; } }
	.section { padding-top: 52px; }
	@media (min-width: 768px) { .section { padding-top: 68px; } }
	.section-label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-primary); margin-bottom: 8px; }
	.section h2 { font-size: 24px; }
	@media (min-width: 768px) { .section h2 { font-size: 28px; } }
	.lede { color: var(--color-muted); margin-top: 10px; max-width: 64ch; }
	.note { margin-top: 16px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

	/* ── Buttons ──────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 13px; font-weight: 700;
		height: 36px; padding: 0 16px;
		border: 1px solid transparent; border-radius: var(--radius-lg);
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 120ms ease, box-shadow 120ms ease;
	}
	.btn:hover { background: #611f69; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--color-accent); }
	.btn-secondary { background: var(--color-surface); color: var(--color-surface-foreground); border-color: var(--color-border); }
	.btn-secondary:hover { background: var(--color-surface-raised); }
	.btn-go { background: var(--green); }
	.btn-go:hover { background: #269b6a; }
	.btn-danger { background: var(--color-surface); color: var(--color-danger); border-color: var(--color-danger); }
	.btn-danger:hover { background: var(--color-danger); color: #fff; }
	.btn[disabled] { cursor: not-allowed; background: var(--color-surface-raised); color: #a0a0a0; border-color: var(--color-border); }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 340px; height: 40px; padding: 0 12px;
		border: 1px solid #8d8d8e; border-radius: var(--radius-lg);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #868686; }
	.input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgb(54 197 240 / 0.25); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 22px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(5, 1fr); } }
	.sw .fill { height: 60px; border-radius: var(--radius-lg); }
	.sw b { display: block; font-size: 13px; font-weight: 700; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 26px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 286px 1fr; gap: 42px; } }
	.phone {
		width: 286px; max-width: 100%; margin: 0 auto;
		border-radius: 26px; overflow: hidden; background: var(--color-surface);
		box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 9px 16px 4px; font-size: 10px; color: rgb(255 255 255 / 0.8); background: var(--color-primary); }
	/* On mobile the aubergine moves to the top bar — it is still the only dark area. */
	.phone-head { background: var(--color-primary); color: #fff; padding: 4px 14px 12px; }
	.phone-head b { font-size: 15px; font-weight: 700; }
	.phone-head .sub { font-size: 11px; opacity: 0.75; }
	.phone-msgs { padding: 10px 0; }
	.phone-msgs .msg { padding: 7px 14px; }
	.phone-msgs .av { width: 30px; height: 30px; font-size: 11px; }
	.phone-msgs .txt { font-size: 13px; line-height: 1.5; }
	.phone-msgs .name { font-size: 13px; }
	.m-composer { margin: 6px 14px 12px; border: 1px solid #8d8d8e; border-radius: var(--radius-lg); padding: 8px 10px; font-size: 12px; color: #868686; display: flex; align-items: center; gap: 8px; }
	.m-tabs { display: flex; border-top: 1px solid var(--color-border); background: var(--color-surface); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 12px; position: relative; }
	.m-tabs .is-active { color: var(--color-primary); font-weight: 700; }
	.m-tabs .g { display: block; width: 16px; height: 16px; border-radius: var(--radius-sm); border: 1.5px solid currentColor; margin: 0 auto 4px; }
	.m-tabs .n { position: absolute; top: 4px; right: 22px; background: var(--color-danger); color: #fff; font-size: 9px; font-weight: 700; border-radius: 9999px; padding: 0 5px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 13px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 14px; font-weight: 700; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 22px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: var(--radius-sm); background: var(--color-primary); color: rgb(255 255 255 / 0.85); font-size: 15px; font-weight: 700; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; opacity: 0.8; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-lg); background: var(--color-surface); border: 1px solid var(--color-border); font-size: 15px; font-weight: 700; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the three-pane workspace. Aubergine rail, white reading area,
     candy accents. Everything in the content pane reads as conversation. -->
<div class="app">
	<aside class="rail">
		<div class="ws"><span class="logo"></span>Vetta<span class="spacer"></span><span style="font-size:13px;opacity:.7">✎</span></div>
		<div class="r-item"><span class="h">⌂</span>Threads</div>
		<div class="r-item"><span class="h">✉</span>Drafts &amp; sent</div>
		<div class="r-group">▾ Channels</div>
		<div class="r-item is-active"><span class="h">#</span>design-system</div>
		<div class="r-item unread"><span class="h">#</span>releases<span class="pill">3</span></div>
		<div class="r-item"><span class="h">#</span>general</div>
		<div class="r-item"><span class="h">#</span>random</div>
		<div class="r-item"><span class="h">＋</span>Add channels</div>
		<div class="r-group">▾ Direct messages</div>
		<div class="r-item"><span class="dot on"></span>Ana Rivera</div>
		<div class="r-item unread"><span class="dot on"></span>Jun Sun<span class="pill">1</span></div>
		<div class="r-item"><span class="dot"></span>Mo Okafor</div>
	</aside>

	<main class="pane">
		<div class="ch-head">
			<h1># design-system</h1>
			<span class="meta">Tokens, components, and the occasional argument about radius.</span>
			<span class="spacer"></span>
			<span class="faces"><span class="face" style="background:#e01e5a"></span><span class="face" style="background:#2eb67d"></span><span class="face" style="background:#ecb22e"></span>14</span>
		</div>

		<div class="messages">
			<div class="datepill"><span>Today</span></div>

			<div class="msg">
				<span class="av" style="background:#e01e5a">AR</span>
				<div class="body">
					<div class="line"><span class="name">Ana Rivera</span><span class="time">9:41 AM</span></div>
					<div class="txt">Shipped the radius audit — every component now pulls from the token scale instead of
						hard-coding 6 and 8. <span class="mention">@jun</span> the table was the only holdout.</div>
					<div class="reactions"><span class="rx on">✅ 4</span><span class="rx">🎉 2</span><span class="rx">＋</span></div>
					<div class="thread"><span class="faces2"><span style="background:#2eb67d"></span><span style="background:#ecb22e"></span></span>3 replies · last reply 12m ago</div>
				</div>
			</div>

			<div class="msg">
				<span class="av" style="background:#2eb67d">JS</span>
				<div class="body">
					<div class="line"><span class="name">Jun Sun</span><span class="time">9:52 AM</span><span class="tag-badge">In a call</span></div>
					<div class="txt">Nice. One thing worth writing down: the rail is the only dark surface we get.
						Aubergine anywhere in the content pane and this stops looking like itself.</div>
					<div class="reactions"><span class="rx">👀 1</span><span class="rx">＋</span></div>
				</div>
				<div class="hovertools"><span>😀</span><span>💬</span><span>⇪</span><span>⋯</span></div>
			</div>

			<div class="msg">
				<span class="av" style="background:#ecb22e">MO</span>
				<div class="body">
					<div class="line"><span class="name">Mo Okafor</span><span class="time">10:04 AM</span></div>
					<div class="txt">Added a <span class="mention">#releases</span> reminder for Thursday. Anyone want to
						take the changelog write-up?</div>
					<div class="reactions"><span class="rx">🙋 1</span><span class="rx">＋</span></div>
				</div>
			</div>
		</div>

		<div class="composer">
			<div class="fmt"><b>B</b><i>I</i><span>S̶</span><span>🔗</span><span>≔</span><span>⌗</span></div>
			<div class="ph">Message #design-system</div>
			<div class="foot"><span>＋</span><span>😀</span><span>@</span><span class="spacer"></span><button class="btn" style="height:28px;padding:0 12px">Send</button></div>
		</div>
	</main>

	<aside class="thr">
		<div class="thr-head">Thread<span class="spacer"></span><span style="color:var(--color-muted);font-weight:400">✕</span></div>
		<div class="msg">
			<span class="av" style="background:#2eb67d">JS</span>
			<div class="body">
				<div class="line"><span class="name">Jun Sun</span><span class="time">10:12 AM</span></div>
				<div class="txt">Table rows are at 8px now. Want me to bump the header too?</div>
			</div>
		</div>
		<div class="msg">
			<span class="av" style="background:#e01e5a">AR</span>
			<div class="body">
				<div class="line"><span class="name">Ana Rivera</span><span class="time">10:15 AM</span></div>
				<div class="txt">Leave the header square — it reads as a boundary, not a card.</div>
				<div class="reactions"><span class="rx on">👍 2</span></div>
			</div>
		</div>
		<div class="composer" style="margin: 8px 16px 16px;">
			<div class="ph" style="font-size:14px">Reply…</div>
		</div>
	</aside>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — The rail rule</p>
		<h2>Aubergine navigates, white converses</h2>
		<p class="lede">The dark rail is the only filled dark area in the system. Aubergine also styles
			primary buttons and active states outside the rail, but it never appears as a fill in the content
			pane — a purple banner mid-conversation is the fastest way out of this style.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#4a154b · rail, CTA</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#36c5f0 · links, mentions</span></div>
			<div class="sw"><div class="fill" style="background: var(--green)"></div><b>green</b><span>join &amp; call only</span></div>
			<div class="sw"><div class="fill" style="background: var(--yellow)"></div><b>yellow</b><span>emoji, avatars</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#e01e5a · badges</span></div>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Blocks &amp; controls</p>
		<h2>Bold, not big</h2>
		<p class="lede">Channel names, sender names and buttons are weight 700 at 13–18px. Nothing scales
			up for emphasis; it thickens. Avatars are 8px-radius squares — circles belong to a different system.</p>
		<div class="row" style="margin-top: 20px;">
			<button class="btn">Create channel</button>
			<button class="btn btn-secondary">Cancel</button>
			<button class="btn btn-go">Join huddle</button>
			<button class="btn btn-danger">Archive</button>
			<button class="btn" disabled>Sending…</button>
		</div>
		<div class="row" style="margin-top: 16px;">
			<input class="input" placeholder="Search Vetta">
			<span class="rx on">✅ 4</span><span class="rx">🎉 2</span><span class="rx">＋</span>
		</div>
		<p class="note">Reaction chips are pills on <code>surface-raised</code>; the ones you've clicked take a 15% sky fill with a sky border. That pair — tinted fill plus matching border — is the selected state everywhere in the system.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Three panes become three tabs</h2>
		<p class="lede">The rail, the channel and the thread are separate screens on a phone. The aubergine
			follows the navigation: it moves from a left rail to the top bar, and it is still the only dark
			surface on screen.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-head">
					<b># design-system</b>
					<div class="sub">14 members · Tokens and components</div>
				</div>
				<div class="phone-msgs">
					<div class="msg">
						<span class="av" style="background:#e01e5a">AR</span>
						<div class="body">
							<div class="line"><span class="name">Ana Rivera</span><span class="time">9:41</span></div>
							<div class="txt">Shipped the radius audit — everything pulls from tokens now.</div>
							<div class="reactions"><span class="rx on">✅ 4</span><span class="rx">🎉 2</span></div>
						</div>
					</div>
					<div class="msg">
						<span class="av" style="background:#2eb67d">JS</span>
						<div class="body">
							<div class="line"><span class="name">Jun Sun</span><span class="time">9:52</span></div>
							<div class="txt">The rail is the only dark surface we get.</div>
						</div>
					</div>
				</div>
				<div class="m-composer"><span>＋</span><span class="spacer">Message #design-system</span><span>😀</span></div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Home</div>
					<div><span class="g"></span><span class="n">4</span>DMs</div>
					<div><span class="g"></span>Activity</div>
					<div><span class="g"></span>You</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>&lt; 940px — the rail</b>Becomes the Home tab: a full screen of channels on aubergine, keeping the 28px rows, the white/70 text and the white/15 active fill.</li>
				<li><b>The thread pane</b>Becomes a pushed screen with a back arrow, not a modal. Replies keep their indentation relationship through the header, not through layout.</li>
				<li><b>Top bar</b>Takes the aubergine so navigation still reads as the dark region. Content below it stays white — that division survives at every width.</li>
				<li><b>Message row</b>Avatar 36px → 30px, text 15px → 13px, but the name stays weight 700 and the timestamp stays 12px muted. Messages never become bubbles.</li>
				<li><b>Hover toolbar</b>There is no hover, so the emoji / reply / share cluster moves to a long-press action sheet with the same four items in the same order.</li>
				<li><b>Composer</b>Docks above the keyboard and drops the formatting strip behind an <b>Aa</b> toggle. The send button stays aubergine; green is reserved for joining a huddle or a call.</li>
				<li><b>Badges</b>Unread counts move from the rail row to the tab bar in the same danger pink, so the notification language does not change.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the lobby</h2>
		<div class="compare">
			<div class="cmp-off">Aubergine content block
				<small>Dark fill in the reading area · 4px corners · low-contrast white/85 text. The rail color belongs to navigation; in the content pane it reads as an error.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>White surface, 8px radius, hairline border, ink text with muted metadata. Content panes stay light so conversation stays legible.</small></div>
		</div>
		<p class="note">Also out: gray text on gray fills, circular avatars, sharp corporate tables, and green used for anything that isn't joining or calling.</p>
	</section>
</div>

</body>
</html>
`;

const Coinbase_THEME = `/* Coinbase — institutional crypto, one decisive blue, pill actions. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #0052ff;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #0a0b0d;
	--color-surface-raised: #f7f8fa;
	--color-muted: #5b616e;
	--color-accent: #00d395;
	--color-danger: #cf202f;
	--color-border: #dfe1e4;

	--radius-sm: 6px;
	--radius-md: 8px;
	--radius-lg: 12px;
	--radius-xl: 16px;
	--radius-2xl: 24px;

	--shadow-sm: 0 1px 2px rgb(10 11 13 / 0.06);
	--shadow-md: 0 4px 12px rgb(10 11 13 / 0.08);
	--shadow-lg: 0 12px 32px rgb(10 11 13 / 0.12);
}
`;

const Coinbase_SPEC = `# Coinbase

## Atmosphere
Institutional crypto. Bank-grade white and near-black ink with one decisive
blue; numbers front and center, zero visual risk. Feels regulated, liquid,
exact.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white; \`surface-raised\` for wells, rows, secondary panels.
- \`primary\` (#0052ff) owns every action: buttons, links, active tabs, chart
  line.
- \`accent\` green = positive deltas only; \`danger\` red = negative deltas and
  destructive. Never decorative.
- Ink \`surface-foreground\` near-black; supporting text \`muted\`.

## Typography
System font stack only. Numbers are the interface:
- Balances huge: \`font-semibold tracking-tight tabular-nums\` 32–48px.
- Headings 18–24px \`font-semibold\`; body/labels 14px; captions 12–13px
  \`muted\`.
- Every numeric column \`tabular-nums\`; deltas prefixed +/− and colored.

## Shape & depth
- Controls \`rounded-lg\`–\`rounded-xl\` (12–16px); primary CTAs are full pills.
- Nearly flat: hairline \`border\` rows/cards; \`shadow-md\` only on menus and
  the trade panel.

## Components
- Buttons: h-11 pill; primary filled blue; secondary \`surface-raised\` fill
  with ink text (no borders on secondary).
- Asset rows: 56–64px — icon circle, name + ticker \`muted\`, sparkline,
  price + colored delta right-aligned, hairline dividers.
- Stat header: portfolio balance block with delta pill under it.
- Tabs: text with 2px blue underline; filter chips as bordered pills.

## Layout
Centered content ~1120px, main column + 360px trade/side panel. Row lists
dominate; spacing 8/16/24. White space communicates safety — never cram.

## Don'ts
- Blue never appears as tinted backgrounds or washes; solid or nothing.
- Green/red only for market movement and confirmations — no decoration.
- No gradients, no glass, no dark panels mixed into the light app.
`;

const Coinbase_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coinbase — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #0052ff;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #0a0b0d;
		--color-surface-raised: #f7f8fa;
		--color-muted: #5b616e;
		--color-accent: #00d395;
		--color-danger: #cf202f;
		--color-border: #dfe1e4;

		--radius-sm: 6px;
		--radius-md: 8px;
		--radius-lg: 12px;
		--radius-xl: 16px;
		--radius-2xl: 24px;

		--shadow-sm: 0 1px 2px rgb(10 11 13 / 0.06);
		--shadow-md: 0 4px 12px rgb(10 11 13 / 0.08);
		--shadow-lg: 0 12px 32px rgb(10 11 13 / 0.12);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
	p { margin: 0; }
	::selection { background: rgb(0 82 255 / 0.18); }
	.spacer { flex: 1; }
	.num { font-variant-numeric: tabular-nums; }

	.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
	@media (min-width: 768px) { .wrap { padding: 0 32px; } }

	/* ── Chrome ───────────────────────────────────────────────────── */
	.topbar { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; min-height: 64px; border-bottom: 1px solid var(--color-border); }
	.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 18px; }
	.brand .mk { width: 26px; height: 26px; border-radius: 50%; background: var(--color-primary); position: relative; }
	.brand .mk::after { content: ""; position: absolute; left: 8px; top: 11px; width: 10px; height: 4px; background: #fff; border-radius: 1px; }
	.topnav { display: none; gap: 22px; font-size: 14px; color: var(--color-muted); }
	@media (min-width: 820px) { .topnav { display: flex; } }
	.topnav .is-active { color: var(--color-surface-foreground); font-weight: 600; }

	/* ── Portfolio header: the balance is the page ────────────────── */
	.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; padding: 32px 0 56px; }
	@media (min-width: 940px) { .layout { grid-template-columns: minmax(0, 1fr) 360px; gap: 40px; } }
	.balance-label { font-size: 14px; color: var(--color-muted); }
	.balance { font-size: clamp(28px, 9vw, 38px); font-weight: 600; letter-spacing: -0.03em; margin-top: 6px; }
	@media (min-width: 768px) { .balance { font-size: 48px; } }
	.delta-pill {
		display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
		font-size: 14px; font-weight: 600; color: #007a5a;
	}
	.delta-pill .tri { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 7px solid #007a5a; }
	.delta-pill.down { color: var(--color-danger); }
	.delta-pill.down .tri { border-bottom: 0; border-top: 7px solid var(--color-danger); }

	.tabs { display: flex; gap: 22px; margin-top: 28px; border-bottom: 1px solid var(--color-border); overflow-x: auto; }
	.tabs span { flex: none; }
	.tabs span { padding: 0 0 12px; font-size: 14px; color: var(--color-muted); }
	.tabs .is-active { color: var(--color-surface-foreground); font-weight: 600; box-shadow: inset 0 -2px 0 var(--color-primary); }

	.chart { margin-top: 20px; }
	.chart svg { display: block; width: 100%; height: auto; }
	.ranges { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
	.range { border: 1px solid var(--color-border); border-radius: 9999px; padding: 4px 12px; font-size: 13px; color: var(--color-muted); }
	.range.is-active { border-color: var(--color-primary); color: var(--color-primary); font-weight: 600; }

	/* ── Asset rows: 64px, hairline dividers, numbers right ───────── */
	.assets { margin-top: 32px; }
	.assets h2 { font-size: 20px; margin-bottom: 4px; }
	.arow { display: flex; align-items: center; gap: 14px; height: 64px; border-bottom: 1px solid var(--color-border); }
	.coin { width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff; font-size: 13px; font-weight: 700; }
	.aname { min-width: 0; }
	.aname b { display: block; font-weight: 600; font-size: 15px; }
	.aname span { font-size: 13px; color: var(--color-muted); }
	.spark { flex: none; width: 88px; display: none; }
	@media (min-width: 620px) { .spark { display: block; } }
	.spark svg { display: block; width: 100%; height: 28px; }
	.aprice { margin-left: auto; text-align: right; flex: none; }
	.aprice b { display: block; font-weight: 600; font-size: 15px; font-variant-numeric: tabular-nums; }
	.aprice span { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: #007a5a; }
	.aprice span.down { color: var(--color-danger); }

	/* ── Trade panel: one of two places a shadow appears ──────────── */
	.trade { border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-md); padding: 20px; align-self: start; min-width: 0; }
	.seg { display: flex; background: var(--color-surface-raised); border-radius: 9999px; padding: 3px; }
	.seg span { flex: 1; text-align: center; padding: 7px 0; border-radius: 9999px; font-size: 14px; font-weight: 600; color: var(--color-muted); }
	.seg .is-active { background: var(--color-surface); color: var(--color-surface-foreground); box-shadow: var(--shadow-sm); }
	.amountwell { background: var(--color-surface-raised); border-radius: var(--radius-lg); padding: 20px; margin-top: 16px; text-align: center; }
	.amountwell .big { font-size: clamp(26px, 8vw, 34px); font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.amountwell .sub { font-size: 13px; color: var(--color-muted); margin-top: 4px; }
	.trow { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; }
	.trow .k { color: var(--color-muted); }
	.trow .v { font-weight: 600; font-variant-numeric: tabular-nums; }

	/* ── Buttons: 44px pills, blue or nothing ─────────────────────── */
	.btn {
		font: inherit; font-size: 15px; font-weight: 600;
		height: 44px; padding: 0 24px; width: 100%;
		border: 0; border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 140ms ease;
	}
	.btn:hover { background: #0043d1; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(0 82 255 / 0.35); }
	/* Secondary is a raised fill with ink text — no borders, no tinted blue. */
	.btn-secondary { background: var(--color-surface-raised); color: var(--color-surface-foreground); }
	.btn-secondary:hover { background: #eceef2; }
	.btn-danger { background: var(--color-danger); }
	.btn-danger:hover { background: #b41b28; }
	.btn[disabled] { cursor: not-allowed; background: var(--color-surface-raised); color: #9aa0aa; }
	.btn-auto { width: auto; }
	.btn-sm { height: 36px; font-size: 14px; padding: 0 18px; }

	.input {
		font: inherit; font-size: 15px; width: 100%; max-width: 360px; height: 48px; padding: 0 18px;
		border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		background: var(--color-surface); color: var(--color-surface-foreground);
	}
	.input::placeholder { color: #9aa0aa; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgb(0 82 255 / 0.15); }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding: 48px 0; border-top: 1px solid var(--color-border); }
	@media (min-width: 768px) { .section { padding: 64px 0; } }
	.section-label { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 10px; }
	.section h2 { font-size: 24px; }
	@media (min-width: 768px) { .section h2 { font-size: 30px; } }
	.lede { color: var(--color-muted); margin-top: 12px; max-width: 62ch; font-size: 15px; }
	.note { margin-top: 18px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 60px; border-radius: var(--radius-lg); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 13px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 288px 1fr; gap: 44px; } }
	.phone {
		width: 288px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-border); border-radius: 28px;
		overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 11px 18px 4px; font-size: 10px; color: var(--color-muted); }
	.phone-body { padding: 10px 16px 4px; }
	.phone-body .balance { font-size: 30px; }
	.phone-body .balance-label { font-size: 12px; }
	.m-arow { display: flex; align-items: center; gap: 10px; height: 56px; border-bottom: 1px solid var(--color-border); }
	.m-arow .coin { width: 30px; height: 30px; font-size: 11px; }
	.m-arow .aname b { font-size: 14px; }
	.m-arow .aname span { font-size: 11px; }
	.m-arow .aprice b { font-size: 14px; }
	.m-arow .aprice span { font-size: 11px; }
	.m-cta { display: flex; gap: 8px; padding: 12px 16px 14px; }
	.m-tabs { display: flex; border-top: 1px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 12px; }
	.m-tabs .is-active { color: var(--color-primary); font-weight: 600; }
	.m-tabs .g { display: block; width: 16px; height: 16px; border: 1.6px solid currentColor; border-radius: 4px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 14px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 24px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: var(--radius-xl); background: linear-gradient(135deg, rgb(0 82 255 / 0.12), rgb(0 211 149 / 0.18)); font-size: 16px; font-weight: 600; color: var(--color-primary); }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 22px; border-radius: var(--radius-xl); background: var(--color-surface-raised); font-size: 16px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }

	footer { border-top: 1px solid var(--color-border); padding: 32px 0 56px; font-size: 13px; color: var(--color-muted); }
</style>
</head>
<body>

<!-- COVER — the portfolio. Numbers are the interface: one huge balance, one
     blue line, and green/red only where the market actually moved. -->
<div class="wrap">
	<div class="topbar">
		<span class="brand"><span class="mk"></span>Vetta</span>
		<nav class="topnav"><span class="is-active">Portfolio</span><span>Trade</span><span>Earn</span><span>Pay</span><span>Learn</span></nav>
		<span class="spacer"></span>
		<button class="btn btn-auto btn-sm">Buy crypto</button>
	</div>

	<div class="layout">
		<main>
			<div class="balance-label">Portfolio balance</div>
			<div class="balance num">$48,210.94</div>
			<div class="delta-pill"><span class="tri"></span>$1,204.18 (2.56%) today</div>

			<div class="tabs"><span class="is-active">Overview</span><span>Assets</span><span>Activity</span><span>Statements</span></div>

			<div class="chart">
				<svg viewBox="0 0 720 200" role="img" aria-label="Portfolio value over the last 24 hours">
					<path d="M0 150 C 60 146, 90 120, 150 128 S 240 92, 300 104 S 380 60, 440 74 S 540 40, 600 34 S 680 52, 720 42"
						fill="none" stroke="#0052ff" stroke-width="2.5" stroke-linecap="round"/>
					<circle cx="720" cy="42" r="4.5" fill="#0052ff"/>
				</svg>
			</div>
			<div class="ranges">
				<span class="range is-active">1H</span><span class="range">24H</span><span class="range">1W</span>
				<span class="range">1M</span><span class="range">1Y</span><span class="range">ALL</span>
			</div>

			<div class="assets">
				<h2>Your assets</h2>
				<div class="arow">
					<span class="coin" style="background:#f7931a">BTC</span>
					<span class="aname"><b>Bitcoin</b><span>0.4182 BTC</span></span>
					<span class="spark"><svg viewBox="0 0 88 28"><path d="M0 22 L14 18 L28 20 L42 11 L56 14 L70 6 L88 4" fill="none" stroke="#00a37a" stroke-width="2"/></svg></span>
					<span class="aprice"><b>$28,410.02</b><span>+3.12%</span></span>
				</div>
				<div class="arow">
					<span class="coin" style="background:#627eea">ETH</span>
					<span class="aname"><b>Ethereum</b><span>5.9004 ETH</span></span>
					<span class="spark"><svg viewBox="0 0 88 28"><path d="M0 10 L14 14 L28 9 L42 16 L56 13 L70 19 L88 22" fill="none" stroke="#cf202f" stroke-width="2"/></svg></span>
					<span class="aprice"><b>$14,882.40</b><span class="down">−1.04%</span></span>
				</div>
				<div class="arow">
					<span class="coin" style="background:#2775ca">USDC</span>
					<span class="aname"><b>USD Coin</b><span>3,904.12 USDC</span></span>
					<span class="spark"><svg viewBox="0 0 88 28"><path d="M0 14 L14 14 L28 13 L42 14 L56 14 L70 13 L88 14" fill="none" stroke="#5b616e" stroke-width="2"/></svg></span>
					<span class="aprice"><b>$3,904.12</b><span style="color:var(--color-muted)">0.00%</span></span>
				</div>
				<div class="arow">
					<span class="coin" style="background:#0a0b0d">SOL</span>
					<span class="aname"><b>Solana</b><span>42.10 SOL</span></span>
					<span class="spark"><svg viewBox="0 0 88 28"><path d="M0 20 L14 16 L28 18 L42 10 L56 12 L70 8 L88 5" fill="none" stroke="#00a37a" stroke-width="2"/></svg></span>
					<span class="aprice"><b>$1,014.40</b><span>+6.44%</span></span>
				</div>
			</div>
		</main>

		<aside class="trade">
			<div class="seg"><span class="is-active">Buy</span><span>Sell</span><span>Convert</span></div>
			<div class="amountwell">
				<div class="big">$500.00</div>
				<div class="sub num">≈ 0.00734 BTC</div>
			</div>
			<div class="trow"><span class="k">Pay with</span><span class="v">Bank ···4021</span></div>
			<div class="trow"><span class="k">Price</span><span class="v num">$68,102.40</span></div>
			<div class="trow"><span class="k">Fee</span><span class="v num">$2.49</span></div>
			<div class="trow" style="border-bottom:0"><span class="k">Total</span><span class="v num">$502.49</span></div>
			<button class="btn" style="margin-top: 16px;">Preview buy</button>
			<button class="btn btn-secondary" style="margin-top: 8px;">Add funds</button>
		</aside>
	</div>
</div>

<div class="wrap">

	<!-- 01 -->
	<section class="section">
		<p class="section-label">01 — Numbers</p>
		<h2>The figure is the interface</h2>
		<p class="lede">Balances run 38–48px in semibold with tight tracking and tabular figures. Every
			numeric column in the system is tabular, so a price that ticks does not shift the layout next to it.
			Deltas always carry a sign and a color; a bare percentage is never shown.</p>
		<div class="row" style="margin-top: 22px; gap: 24px;">
			<span class="delta-pill"><span class="tri"></span>+3.12%</span>
			<span class="delta-pill down"><span class="tri"></span>−1.04%</span>
			<span style="color:var(--color-muted);font-weight:600">0.00%</span>
			<span class="note" style="margin:0">flat is muted, never green</span>
		</div>
	</section>

	<!-- 02 -->
	<section class="section">
		<p class="section-label">02 — Color</p>
		<h2>Blue is solid or absent</h2>
		<p class="lede">Blue owns buttons, links, active tabs and the chart line — always at full
			strength. It never appears as a tinted wash, a 10% background or a gradient. Green and red are
			market signals, not decoration.</p>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#0052ff · every action</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#00d395 · positive only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#cf202f · negative only</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-raised)"></div><b>raised</b><span>#f7f8fa · wells, secondary</span></div>
		</div>
		<div class="row" style="margin-top: 24px;">
			<button class="btn btn-auto">Buy</button>
			<button class="btn btn-auto btn-secondary">Sell</button>
			<button class="btn btn-auto btn-danger">Close position</button>
			<button class="btn btn-auto" disabled>Confirming…</button>
		</div>
		<div class="row" style="margin-top: 16px;"><input class="input" placeholder="Search 240+ assets"></div>
		<p class="note">Secondary buttons are a raised gray fill with ink text — never a blue outline and never a blue tint. That restraint is what makes the one blue button unambiguous.</p>
	</section>

	<!-- 03 MOBILE -->
	<section class="section">
		<p class="section-label">03 — Mobile</p>
		<h2>Phone first, by nature</h2>
		<p class="lede">Most of this product is used on a phone at a moment of decision, so the mobile
			layout gets the same hierarchy at a smaller scale: balance, chart, rows, then a pair of pinned
			actions. The trade panel becomes a bottom sheet rather than a separate page.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>5G ▮</span></div>
				<div class="phone-body">
					<div class="balance-label">Portfolio balance</div>
					<div class="balance num">$48,210.94</div>
					<div class="delta-pill" style="font-size:12px"><span class="tri"></span>$1,204.18 (2.56%)</div>
					<svg viewBox="0 0 250 70" style="width:100%;height:auto;margin-top:10px" role="img" aria-label="Portfolio trend">
						<path d="M0 54 C 24 50, 34 40, 52 44 S 86 30, 106 36 S 136 18, 156 24 S 196 10, 216 8 S 240 16, 250 12" fill="none" stroke="#0052ff" stroke-width="2" stroke-linecap="round"/>
					</svg>
					<div class="ranges" style="margin-top:8px"><span class="range is-active" style="font-size:11px;padding:2px 9px">1H</span><span class="range" style="font-size:11px;padding:2px 9px">24H</span><span class="range" style="font-size:11px;padding:2px 9px">1W</span><span class="range" style="font-size:11px;padding:2px 9px">1M</span></div>
					<div class="m-arow" style="margin-top:8px">
						<span class="coin" style="background:#f7931a">BTC</span>
						<span class="aname"><b>Bitcoin</b><span>0.4182 BTC</span></span>
						<span class="aprice"><b>$28,410.02</b><span>+3.12%</span></span>
					</div>
					<div class="m-arow">
						<span class="coin" style="background:#627eea">ETH</span>
						<span class="aname"><b>Ethereum</b><span>5.9004 ETH</span></span>
						<span class="aprice"><b>$14,882.40</b><span class="down">−1.04%</span></span>
					</div>
				</div>
				<div class="m-cta"><button class="btn">Buy</button><button class="btn btn-secondary">Sell</button></div>
				<div class="m-tabs">
					<div class="is-active"><span class="g"></span>Home</div>
					<div><span class="g"></span>Trade</div>
					<div><span class="g"></span>Earn</div>
					<div><span class="g"></span>You</div>
				</div>
			</div>
			<ul class="rules">
				<li><b>Balance</b>48px → 30px, and that is the smallest it is ever allowed to be. If space is short, something else leaves the screen.</li>
				<li><b>Asset rows</b>64px → 56px. The sparkline column drops below 620px; the icon, name, ticker, price and delta all stay, because that is the minimum a decision needs.</li>
				<li><b>Trade panel</b>The 360px side panel becomes a bottom sheet on <code>shadow-md</code>, keeping the Buy / Sell / Convert segmented control at the top of the sheet.</li>
				<li><b>Pinned actions</b>Buy and Sell pin above the tab bar as a 44px pill pair — full-strength blue for buy, raised gray for sell, never two blues.</li>
				<li><b>Chart</b>Same single blue line at 2px, gridlines and axis labels omitted at every size. Range chips shrink to 11px but stay pill-shaped and bordered.</li>
				<li><b>Whitespace</b>Section padding 64px → 48px, gutters 32px → 20px. Air is how this system communicates safety, so it is compressed last, not first.</li>
				<li><b>Tabs</b>The top nav becomes a four-item bottom bar; the underlined tab set inside the page stays horizontal and scrolls.</li>
			</ul>
		</div>
	</section>

	<!-- 04 DON'T -->
	<section class="section">
		<p class="section-label">04 — Off-style, for contrast</p>
		<h2>What breaks the bank-grade feel</h2>
		<div class="compare">
			<div class="cmp-off">Blue-to-green wash
				<small>Tinted gradient panel · blue used at 12% · green as decoration. Diluted blue and decorative green together make the interface look speculative rather than regulated.</small></div>
			<div class="cmp-on">Same content, on-style
				<small>Flat #f7f8fa well, ink text, one solid blue action. Blue is solid or it is not there; green appears only when a number actually went up.</small></div>
		</div>
		<p class="note">Also out: gradients of any kind, glass effects, dark panels mixed into the light app, and cramped rows — space is part of the trust signal here.</p>
	</section>
</div>

<footer><div class="wrap">Vetta design reference — coinbase · one blue, tabular everything.</div></footer>
</body>
</html>
`;

const Shopify_THEME = `/* Shopify — merchant-grade light admin, commerce green. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #008060;
	--color-primary-foreground: #ffffff;
	--color-surface: #f6f6f7;
	--color-surface-foreground: #202223;
	--color-surface-raised: #ffffff;
	--color-muted: #6d7175;
	--color-accent: #5c6ac4;
	--color-danger: #d72c0d;
	--color-border: #e1e3e5;

	--radius-sm: 4px;
	--radius-md: 8px;
	--radius-lg: 8px;
	--radius-xl: 12px;
	--radius-2xl: 16px;

	--shadow-sm: 0 1px 0 rgb(22 29 37 / 0.05);
	--shadow-md: 0 2px 8px rgb(22 29 37 / 0.1);
	--shadow-lg: 0 8px 24px rgb(22 29 37 / 0.15);
}
`;

const Shopify_SPEC = `# Shopify

## Atmosphere
A merchant's clean back office. Cool light gray floor, white work cards, calm
commerce green. Everything optimized for getting orders out the door.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` (#f6f6f7) app background; \`surface-raised\` (white) for every card.
- \`primary\` green for primary actions and success/paid states.
- \`accent\` (indigo) for informational highlights and links.
- \`danger\` for destructive/overdue; ink \`surface-foreground\`; labels \`muted\`;
  cards close with hairline \`border\` + \`shadow-sm\`.

## Typography
System font stack only. Ops clarity:
- Page titles \`font-semibold\` 20–24px; card headings 16px \`font-semibold\`.
- Body/controls 14px; table text 13–14px; captions 12px \`muted\`.
- Amounts \`tabular-nums font-medium\`; statuses 12px \`font-medium\`.

## Shape & depth
- Uniform \`rounded-lg\` (8px) cards and controls; badges are pills.
- Shallow, consistent depth: every card \`shadow-sm\` + border; \`shadow-md\`
  for popovers only.

## Components
- Buttons: h-9 \`rounded-lg\`; primary filled green; secondary white bordered;
  plain-text tertiary.
- Status badges: soft-filled pills (\`primary/15\`, \`accent/15\`, \`danger/15\`,
  gray) with matching dark text and a leading dot.
- Index tables: white card, 44px rows, checkbox column, hover \`surface\` wash,
  sortable \`muted\` headers.
- Banner alerts: tinted card-width strips with icon + title + action link.

## Layout
Top bar + 240px nav; content max ~998px centered. Cards stack vertically
with 16px gaps; two-column split (main + 320px aside) for detail pages.
Spacing 4/8/12/16/20.

## Don'ts
- Green is action/success only — never decorative fills or headings.
- No borderless shadow-only cards; the border+shadow pair is the signature.
- No dense excel-like grids without card wrappers; no dark theme.
`;

const Shopify_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shopify — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #008060;
		--color-primary-foreground: #ffffff;
		--color-surface: #f6f6f7;
		--color-surface-foreground: #202223;
		--color-surface-raised: #ffffff;
		--color-muted: #6d7175;
		--color-accent: #5c6ac4;
		--color-danger: #d72c0d;
		--color-border: #e1e3e5;

		--radius-sm: 4px;
		--radius-md: 8px;
		--radius-lg: 8px;
		--radius-xl: 12px;
		--radius-2xl: 16px;

		--shadow-sm: 0 1px 0 rgb(22 29 37 / 0.05);
		--shadow-md: 0 2px 8px rgb(22 29 37 / 0.1);
		--shadow-lg: 0 8px 24px rgb(22 29 37 / 0.15);

		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-weight: 600; line-height: 1.3; }
	p { margin: 0; }
	::selection { background: rgb(0 128 96 / 0.2); }
	.spacer { flex: 1; }

	/* ── Admin chrome: dark top bar, 240px nav, 998px work area ───── */
	.topbar { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px; background: #1a1c1d; color: #e3e3e3; }
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #fff; }
	.brand .bag { width: 24px; height: 24px; border-radius: var(--radius-sm); background: var(--color-primary); }
	.searchbar { flex: 1; max-width: 460px; height: 32px; border-radius: var(--radius-md); background: #303233; border: 1px solid #43464a; color: #9a9c9e; font-size: 13px; display: flex; align-items: center; padding: 0 12px; }
	.store { display: flex; align-items: center; gap: 8px; font-size: 13px; }
	.store .init { width: 26px; height: 26px; border-radius: var(--radius-md); background: var(--color-accent); color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 600; }

	.admin { display: grid; grid-template-columns: 1fr; }
	@media (min-width: 940px) { .admin { grid-template-columns: 240px 1fr; } }
	.nav { display: none; padding: 12px 8px; }
	@media (min-width: 940px) { .nav { display: block; } }
	.n-item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-radius: var(--radius-md); font-size: 14px; color: var(--color-surface-foreground); }
	.n-item .g { width: 16px; height: 16px; border: 1.5px solid var(--color-muted); border-radius: 3px; flex: none; }
	.n-item.is-active { background: #ebebeb; font-weight: 600; }
	.n-item.is-active .g { border-color: var(--color-surface-foreground); background: #dfdfdf; }
	.n-item .num { margin-left: auto; font-size: 12px; color: var(--color-muted); }

	.work { min-width: 0; padding: 20px 16px 40px; }
	@media (min-width: 768px) { .work { padding: 24px 24px 56px; } }
	.work-inner { max-width: 998px; margin: 0 auto; }
	.page-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
	.page-head h1 { font-size: 20px; }
	@media (min-width: 768px) { .page-head h1 { font-size: 24px; } }

	/* ── The card: hairline border AND shadow-sm. Both, always. ───── */
	.card {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}
	.card + .card { margin-top: 16px; }
	.card-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--color-border); }
	.card-head h2 { font-size: 16px; }
	.card-body { padding: 16px; }

	/* Banner: tinted card-width strip with icon, title and an action link. */
	.banner { display: flex; gap: 12px; border-radius: var(--radius-lg); padding: 14px 16px; border: 1px solid; margin-bottom: 16px; }
	.banner .ico { width: 20px; height: 20px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 700; }
	.banner b { font-size: 14px; display: block; }
	.banner p { font-size: 13px; color: var(--color-muted); margin-top: 2px; }
	.banner a { color: var(--color-accent); font-weight: 500; text-decoration: none; }
	.banner.info { background: #f2f7fe; border-color: #b3d4fc; }
	.banner.info .ico { background: var(--color-accent); }
	.banner.warn { background: #fff5ea; border-color: #ffd79d; }
	.banner.warn .ico { background: #b98900; }

	/* ── Stats strip ──────────────────────────────────────────────── */
	.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
	@media (min-width: 720px) { .stats { grid-template-columns: repeat(4, 1fr); } }
	.stat { padding: 16px; border-right: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
	@media (min-width: 720px) { .stat { border-bottom: 0; } .stat:last-child { border-right: 0; } }
	.stat .k { font-size: 13px; color: var(--color-muted); }
	.stat .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; }
	.stat .delta { font-size: 12px; color: var(--color-primary); font-weight: 500; }
	.stat .delta.down { color: var(--color-danger); }

	/* ── Index table: 44px rows, checkbox column, sortable headers ── */
	.index { width: 100%; border-collapse: collapse; font-size: 13px; }
	.index th { text-align: left; font-size: 12px; font-weight: 500; color: var(--color-muted); padding: 10px 12px; background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border); }
	.index td { padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-border); }
	.index tbody tr:hover { background: var(--color-surface); }
	.index tr:last-child td { border-bottom: 0; }
	.cb { width: 16px; height: 16px; border: 1.5px solid #8c9196; border-radius: var(--radius-sm); display: inline-block; vertical-align: middle; }
	.cb.checked { background: var(--color-primary); border-color: var(--color-primary); position: relative; }
	.cb.checked::after { content: ""; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(42deg); }
	.order-id { font-weight: 600; }
	.amt { font-variant-numeric: tabular-nums; font-weight: 500; }
	@media (max-width: 720px) { .hide-sm { display: none; } }

	/* Status badges: soft fill + matching dark text + leading dot. */
	.badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 9999px; padding: 2px 10px; font-size: 12px; font-weight: 500; }
	.badge .d { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
	.badge.paid { background: rgb(0 128 96 / 0.15); color: #0b5c48; }
	.badge.info { background: rgb(92 106 196 / 0.15); color: #3c4696; }
	.badge.due { background: rgb(215 44 13 / 0.13); color: #a02209; }
	.badge.gray { background: #e4e5e7; color: #5c5f62; }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section { padding-top: 40px; }
	.section-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-primary); margin-bottom: 6px; }
	.section h2 { font-size: 20px; }
	.lede { color: var(--color-muted); margin-top: 8px; max-width: 66ch; }
	.note { margin-top: 14px; font-size: 13px; color: var(--color-muted); }
	.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

	/* ── Buttons ──────────────────────────────────────────────────── */
	.btn {
		font: inherit; font-size: 13px; font-weight: 500;
		height: 36px; padding: 0 14px;
		border: 1px solid transparent; border-radius: var(--radius-md);
		background: var(--color-primary); color: var(--color-primary-foreground);
		box-shadow: var(--shadow-sm); cursor: pointer;
		transition: background-color 120ms ease;
	}
	.btn:hover { background: #006e52; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--color-primary); }
	.btn-secondary { background: var(--color-surface-raised); color: var(--color-surface-foreground); border-color: #babfc3; }
	.btn-secondary:hover { background: #f6f6f7; }
	.btn-plain { background: transparent; color: var(--color-accent); box-shadow: none; border-color: transparent; }
	.btn-plain:hover { background: rgb(92 106 196 / 0.08); }
	.btn-danger { background: var(--color-danger); }
	.btn-danger:hover { background: #bc2200; }
	.btn[disabled] { cursor: not-allowed; background: #f1f1f1; color: #a7a9ab; border-color: #e1e3e5; box-shadow: none; }

	.field { max-width: 360px; }
	.label { display: block; font-size: 13px; margin-bottom: 4px; }
	.input {
		font: inherit; font-size: 14px; width: 100%; height: 36px; padding: 0 12px;
		border: 1px solid #8c9196; border-radius: var(--radius-sm);
		background: var(--color-surface-raised); color: var(--color-surface-foreground);
		box-shadow: inset 0 1px 0 rgb(0 0 0 / 0.05);
	}
	.input::placeholder { color: #8c9196; }
	.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgb(0 128 96 / 0.25); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 18px; }
	@media (min-width: 720px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 54px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 13px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 22px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 284px 1fr; gap: 40px; } }
	.phone {
		width: 284px; max-width: 100%; margin: 0 auto;
		border-radius: 24px; overflow: hidden; background: var(--color-surface);
		box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 9px 16px 6px; font-size: 10px; color: #b7babc; background: #1a1c1d; }
	.phone-top { display: flex; align-items: center; gap: 8px; background: #1a1c1d; color: #fff; padding: 0 14px 12px; font-size: 13px; font-weight: 600; }
	.phone-top .init { width: 22px; height: 22px; border-radius: var(--radius-sm); background: var(--color-accent); display: grid; place-items: center; font-size: 10px; }
	.phone-body { padding: 12px; }
	.m-card { background: #fff; border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
	.m-card + .m-card { margin-top: 10px; }
	.m-stat { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 12px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
	.m-stat:last-child { border-bottom: 0; }
	.m-stat b { font-size: 16px; font-variant-numeric: tabular-nums; }
	/* Orders keep the card wrapper, lose the columns. */
	.m-order { padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
	.m-order:last-child { border-bottom: 0; }
	.m-order .l1 { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
	.m-order .l2 { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; font-size: 11px; color: var(--color-muted); }
	.m-tabs { display: flex; background: #fff; border-top: 1px solid var(--color-border); }
	.m-tabs div { flex: 1; text-align: center; font-size: 10px; color: var(--color-muted); padding: 8px 0 12px; }
	.m-tabs .is-active { color: var(--color-surface-foreground); font-weight: 600; }
	.m-tabs .g { display: block; width: 16px; height: 16px; border: 1.5px solid currentColor; border-radius: 3px; margin: 0 auto 4px; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 12px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; color: var(--color-muted); }
	.rules b { display: block; color: var(--color-surface-foreground); font-size: 13px; font-weight: 600; margin-bottom: 2px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 18px; }
	@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 20px; border-radius: var(--radius-lg); background: var(--color-primary); color: #fff; font-size: 15px; font-weight: 600; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; opacity: 0.85; margin-top: 8px; line-height: 1.6; }
	.cmp-on { padding: 20px; border-radius: var(--radius-lg); background: var(--color-surface-raised); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); font-size: 15px; font-weight: 600; }
	.cmp-on small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 8px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the merchant back office. Gray floor, white work cards, green
     only where something is an action or a success. -->
<div class="topbar">
	<span class="brand"><span class="bag"></span>Vetta</span>
	<span class="searchbar">Search orders, products and customers</span>
	<span class="spacer"></span>
	<span class="store"><span class="init">VS</span><span>Vetta Supply</span></span>
</div>

<div class="admin">
	<nav class="nav">
		<div class="n-item is-active"><span class="g"></span>Home</div>
		<div class="n-item"><span class="g"></span>Orders<span class="num">14</span></div>
		<div class="n-item"><span class="g"></span>Products</div>
		<div class="n-item"><span class="g"></span>Customers</div>
		<div class="n-item"><span class="g"></span>Content</div>
		<div class="n-item"><span class="g"></span>Finances</div>
		<div class="n-item"><span class="g"></span>Analytics</div>
		<div class="n-item"><span class="g"></span>Marketing</div>
		<div class="n-item"><span class="g"></span>Discounts</div>
	</nav>

	<main class="work">
		<div class="work-inner">
			<div class="page-head">
				<h1>Orders</h1>
				<span class="badge gray">14 open</span>
				<span class="spacer"></span>
				<button class="btn btn-secondary">Export</button>
				<button class="btn">Create order</button>
			</div>

			<div class="banner info">
				<span class="ico">i</span>
				<div><b>Payouts resume tomorrow</b><p>Your bank verification finished this morning. <a href="#">View payout schedule</a></p></div>
			</div>
			<div class="banner warn">
				<span class="ico">!</span>
				<div><b>2 orders are overdue for fulfillment</b><p>Both are ship-by today. <a href="#">Fulfill now</a></p></div>
			</div>

			<div class="card">
				<div class="stats">
					<div class="stat"><div class="k">Total sales</div><div class="v">$48,210</div><div class="delta">↑ 12.4%</div></div>
					<div class="stat"><div class="k">Orders</div><div class="v">312</div><div class="delta">↑ 6.1%</div></div>
					<div class="stat"><div class="k">Fulfilled</div><div class="v">298</div><div class="delta">↑ 4.8%</div></div>
					<div class="stat"><div class="k">Returns</div><div class="v">7</div><div class="delta down">↓ 1.2%</div></div>
				</div>
			</div>

			<div class="card">
				<div class="card-head">
					<h2>All orders</h2>
					<span class="badge info"><span class="d"></span>Live</span>
					<span class="spacer"></span>
					<button class="btn btn-plain">Filter</button>
					<button class="btn btn-plain">Sort</button>
				</div>
				<table class="index">
					<thead>
						<tr>
							<th style="width:34px"><span class="cb checked"></span></th>
							<th>Order</th><th class="hide-sm">Date</th><th class="hide-sm">Customer</th>
							<th>Payment</th><th class="hide-sm">Fulfillment</th><th style="text-align:right">Total</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><span class="cb checked"></span></td>
							<td class="order-id">#1042</td><td class="hide-sm">Apr 12</td><td class="hide-sm">Amara N.</td>
							<td><span class="badge paid"><span class="d"></span>Paid</span></td>
							<td class="hide-sm"><span class="badge gray"><span class="d"></span>Unfulfilled</span></td>
							<td class="amt" style="text-align:right">$1,240.00</td>
						</tr>
						<tr>
							<td><span class="cb"></span></td>
							<td class="order-id">#1041</td><td class="hide-sm">Apr 12</td><td class="hide-sm">Jun S.</td>
							<td><span class="badge info"><span class="d"></span>Pending</span></td>
							<td class="hide-sm"><span class="badge gray"><span class="d"></span>Unfulfilled</span></td>
							<td class="amt" style="text-align:right">$89.00</td>
						</tr>
						<tr>
							<td><span class="cb"></span></td>
							<td class="order-id">#1040</td><td class="hide-sm">Apr 11</td><td class="hide-sm">Harbor Dev</td>
							<td><span class="badge paid"><span class="d"></span>Paid</span></td>
							<td class="hide-sm"><span class="badge paid"><span class="d"></span>Fulfilled</span></td>
							<td class="amt" style="text-align:right">$4,500.00</td>
						</tr>
						<tr>
							<td><span class="cb"></span></td>
							<td class="order-id">#1039</td><td class="hide-sm">Apr 11</td><td class="hide-sm">Mo O.</td>
							<td><span class="badge due"><span class="d"></span>Overdue</span></td>
							<td class="hide-sm"><span class="badge gray"><span class="d"></span>Unfulfilled</span></td>
							<td class="amt" style="text-align:right">$32.50</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- 01 -->
			<section class="section">
				<p class="section-label">01 — The card</p>
				<h2>Border and shadow, never one without the other</h2>
				<p class="lede">Every work surface is white, 8px-radius, closed by a hairline border and
					lifted by a shadow so shallow it reads as a printed edge. A borderless shadow-only card
					or a bare bordered rectangle both look like a different admin.</p>
				<div class="swatches">
					<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#f6f6f7 · the floor</span></div>
					<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#008060 · action, paid</span></div>
					<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#5c6ac4 · links, info</span></div>
					<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#d72c0d · overdue</span></div>
				</div>
				<p class="note">Green is action and success only. A green heading, a green banner background, or a green decorative fill all break the rule — the merchant reads green as "this went through".</p>
			</section>

			<!-- 02 -->
			<section class="section">
				<p class="section-label">02 — Controls</p>
				<h2>36px, calm, unmistakable</h2>
				<div class="row" style="margin-top: 16px;">
					<button class="btn">Create order</button>
					<button class="btn btn-secondary">Export</button>
					<button class="btn btn-plain">More actions</button>
					<button class="btn btn-danger">Cancel order</button>
					<button class="btn" disabled>Fulfilling…</button>
				</div>
				<div class="field" style="margin-top: 16px;">
					<label class="label">Tracking number</label>
					<input class="input" placeholder="1Z999AA10123456784">
				</div>
				<div class="row" style="margin-top: 16px;">
					<span class="badge paid"><span class="d"></span>Paid</span>
					<span class="badge info"><span class="d"></span>Pending</span>
					<span class="badge due"><span class="d"></span>Overdue</span>
					<span class="badge gray"><span class="d"></span>Unfulfilled</span>
				</div>
				<p class="note">Badges are always the same construction: a 15%-opacity fill, dark matching text, and a leading dot so status is legible without relying on hue alone.</p>
			</section>

			<!-- 03 MOBILE -->
			<section class="section">
				<p class="section-label">03 — Mobile</p>
				<h2>The merchant is on their phone in a stockroom</h2>
				<p class="lede">Fulfilment happens away from a desk, so the phone build is not a cut-down
					admin — it is the same work with the columns that matter kept and everything else deferred.</p>
				<div class="mobile">
					<div class="phone">
						<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
						<div class="phone-top"><span class="init">VS</span>Orders<span class="spacer"></span><span style="font-weight:400;font-size:11px;color:#b7babc">14 open</span></div>
						<div class="phone-body">
							<div class="banner warn" style="margin-bottom:10px;padding:10px;border-radius:var(--radius-md)">
								<span class="ico" style="width:16px;height:16px;font-size:10px">!</span>
								<div><b style="font-size:12px">2 orders overdue</b><p style="font-size:11px">Ship by today</p></div>
							</div>
							<div class="m-card">
								<div class="m-stat"><span>Total sales</span><b>$48,210</b></div>
								<div class="m-stat"><span>Orders</span><b>312</b></div>
							</div>
							<div class="m-card">
								<div class="m-order">
									<div class="l1"><b>#1042</b><span class="amt">$1,240.00</span></div>
									<div class="l2"><span class="badge paid"><span class="d"></span>Paid</span><span>Amara N. · Apr 12</span></div>
								</div>
								<div class="m-order">
									<div class="l1"><b>#1041</b><span class="amt">$89.00</span></div>
									<div class="l2"><span class="badge info"><span class="d"></span>Pending</span><span>Jun S. · Apr 12</span></div>
								</div>
								<div class="m-order">
									<div class="l1"><b>#1039</b><span class="amt">$32.50</span></div>
									<div class="l2"><span class="badge due"><span class="d"></span>Overdue</span><span>Mo O. · Apr 11</span></div>
								</div>
							</div>
						</div>
						<div class="m-tabs">
							<div class="is-active"><span class="g"></span>Home</div>
							<div><span class="g"></span>Orders</div>
							<div><span class="g"></span>Products</div>
							<div><span class="g"></span>More</div>
						</div>
					</div>
					<ul class="rules">
						<li><b>&lt; 940px — nav</b>The 240px side nav becomes a four-item bottom bar; the rest of the destinations live behind "More". The dark top bar stays, since it is how the merchant knows which store they are in.</li>
						<li><b>Index table</b>Below 720px date, customer and fulfilment leave the table. On the phone each order becomes a two-line block inside the same card: id and amount on top, status badge and customer below.</li>
						<li><b>Cards</b>Keep border + shadow + 8px radius at 12px page gutters. Card gaps tighten 16px → 10px; nothing becomes full-bleed, because the white card is what separates work from floor.</li>
						<li><b>Banners</b>Stay tinted and stay above the content, at reduced padding. They are the only element allowed to interrupt, so they must survive the breakpoint.</li>
						<li><b>Bulk select</b>The checkbox column is dropped; multi-select moves to a long-press that turns the card into a selection state with an action bar pinned at the bottom.</li>
						<li><b>Numbers</b>Amounts stay <code>tabular-nums</code> and never fall below 13px. The stat block reads as label-left / figure-right rather than stacked, so a glance down the column still aligns.</li>
						<li><b>Targets</b>Buttons 36px → 44px, rows 44px → 56px. Primary actions in a detail view pin to the bottom of the viewport.</li>
					</ul>
				</div>
			</section>

			<!-- 04 DON'T -->
			<section class="section">
				<p class="section-label">04 — Off-style, for contrast</p>
				<h2>What breaks the back office</h2>
				<div class="compare">
					<div class="cmp-off">Green as decoration
						<small>Commerce green used as a large fill behind ordinary content. Green means "paid" and "go" here — spending it on decoration makes every real success state quieter.</small></div>
					<div class="cmp-on">Same content, on-style
						<small>White card, hairline border, shadow-sm, ink text. Green stays on the one button that creates something and on the Paid badge.</small></div>
				</div>
				<p class="note">Also out: borderless shadow-only cards, excel-like grids without a card wrapper, and a dark theme of any kind.</p>
			</section>
		</div>
	</main>
</div>

</body>
</html>
`;

const Medium_THEME = `/* Medium — editorial white, serif voice, green ask + yellow highlight. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #1a8917;
	--color-primary-foreground: #ffffff;
	--color-surface: #ffffff;
	--color-surface-foreground: #242424;
	--color-surface-raised: #fafafa;
	--color-muted: #6b6b6b;
	--color-accent: #ffc017;
	--color-danger: #c94a4a;
	--color-border: #e6e6e6;

	--radius-sm: 2px;
	--radius-md: 4px;
	--radius-lg: 4px;
	--radius-xl: 8px;
	--radius-2xl: 12px;

	--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
	--shadow-md: 0 2px 10px rgb(0 0 0 / 0.08);
	--shadow-lg: 0 8px 32px rgb(0 0 0 / 0.12);
}
`;

const Medium_SPEC = `# Medium

## Atmosphere
A quiet magazine. White paper, serif prose, acres of margin. The chrome
whispers so the writing can speak; one green ask and one yellow highlighter.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` white page; \`surface-raised\` sparingly for code and side panels.
- \`primary\` (green) for the few real actions: follow, subscribe, publish.
- \`accent\` (yellow) is the brand flourish: hero backgrounds, member badges,
  highlighted text (\`accent/40\` wash behind serif text).
- Ink #242424 \`surface-foreground\`; bylines/captions \`muted\`; hairline
  \`border\` dividers.

## Typography
The whole identity — mix the two stacks deliberately:
- Article titles and prose in \`font-serif\`: titles \`font-bold\` 32–42px,
  body 20–21px \`leading-relaxed\`.
- UI chrome (nav, buttons, meta) in sans 13–14px.
- Kickers/bylines 13px sans \`text-muted\`; pull quotes serif italic 24px with
  a 3px ink left border.

## Shape & depth
- Minimal radii: buttons are pills, images/cards \`rounded-md\` (4px) or square.
- Flat as paper: hairline dividers organize everything; \`shadow-md\` only for
  menus and the sticky toolbar.

## Components
- Buttons: slim pills h-9; primary filled green; secondary bordered ink;
  most "actions" are plain \`muted\` icon buttons.
- Story list item: kicker + serif \`font-bold\` title + 2-line \`muted\` sans
  excerpt + meta row (avatar 20px, name, date, read time) + small square
  thumbnail right.
- Clap/response bar: \`muted\` icon+count pairs separated by dots.
- Topic chips: \`surface-raised\` pills 13px; member star in \`accent\`.

## Layout
One sacred reading column: 680px centered, 48–64px vertical rhythm between
blocks. List pages: 728px main + 368px sticky aside split by a hairline.
Whitespace is the design.

## Don'ts
- Never set body prose in sans, never set UI chrome in serif.
- No cards with shadows for stories — dividers, not boxes.
- Green and yellow never co-occur in one component; no other hues at all.
`;

const Medium_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Medium — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #1a8917;
		--color-primary-foreground: #ffffff;
		--color-surface: #ffffff;
		--color-surface-foreground: #242424;
		--color-surface-raised: #fafafa;
		--color-muted: #6b6b6b;
		--color-accent: #ffc017;
		--color-danger: #c94a4a;
		--color-border: #e6e6e6;

		--radius-sm: 2px;
		--radius-md: 4px;
		--radius-lg: 4px;
		--radius-xl: 8px;
		--radius-2xl: 12px;

		--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
		--shadow-md: 0 2px 10px rgb(0 0 0 / 0.08);
		--shadow-lg: 0 8px 32px rgb(0 0 0 / 0.12);

		--serif: "Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, Cambria, "Times New Roman", serif;
		--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	/* Prose is serif. Chrome is sans. The two never trade places. */
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--serif);
		font-size: 20px;
		line-height: 1.62;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; font-family: var(--serif); font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
	p { margin: 0; }
	::selection { background: rgb(255 192 23 / 0.45); }
	.ui { font-family: var(--sans); }
	.spacer { flex: 1; }

	/* ── Masthead: the yellow band is the brand flourish ───────────── */
	.mast { border-bottom: 1px solid var(--color-surface-foreground); background: var(--color-accent); }
	.mast-inner { max-width: 1192px; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; min-height: 62px; font-family: var(--sans); font-size: 14px; }
	.wordmark { font-family: var(--serif); font-weight: 700; font-size: 26px; letter-spacing: -0.02em; }
	.mast .links { display: none; gap: 20px; }
	@media (min-width: 780px) { .mast .links { display: flex; } }

	/* ── Story hero on the yellow ─────────────────────────────────── */
	.hero { background: var(--color-accent); border-bottom: 1px solid var(--color-surface-foreground); }
	.hero-inner { max-width: 1192px; margin: 0 auto; padding: 56px 24px 64px; }
	@media (min-width: 900px) { .hero-inner { padding: 88px 24px 96px; max-width: 900px; } }
	.hero h1 { font-size: 46px; max-width: 14ch; }
	@media (min-width: 768px) { .hero h1 { font-size: 76px; } }
	.hero p { margin-top: 22px; font-size: 20px; max-width: 34em; }
	.hero .actions { margin-top: 34px; }

	/* ── The sacred reading column ────────────────────────────────── */
	.article { max-width: 680px; margin: 0 auto; padding: 0 24px 64px; }
	.kicker { font-family: var(--sans); font-size: 13px; color: var(--color-muted); letter-spacing: 0.02em; }
	.byline { display: flex; align-items: center; gap: 12px; padding: 28px 0; border-bottom: 1px solid var(--color-border); font-family: var(--sans); font-size: 14px; }
	.byline .av { width: 44px; height: 44px; border-radius: 50%; background: #d8d8d8; flex: none; }
	.byline b { display: block; font-weight: 500; }
	.byline .meta { color: var(--color-muted); font-size: 13px; }
	.clapbar { display: flex; align-items: center; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--color-border); font-family: var(--sans); font-size: 13px; color: var(--color-muted); }
	.clapbar .item { display: flex; align-items: center; gap: 6px; }
	.clapbar .g { width: 18px; height: 18px; border: 1.5px solid currentColor; border-radius: 50%; }

	.article h2 { font-size: 30px; margin-top: 48px; }
	@media (min-width: 768px) { .article h2 { font-size: 34px; } }
	.article p { margin-top: 26px; font-size: 20px; }
	@media (min-width: 768px) { .article p { font-size: 21px; } }
	.article .lede-p { margin-top: 32px; }
	.hl { background: rgb(255 192 23 / 0.4); }
	.dropcap::first-letter { float: left; font-size: 66px; line-height: 0.8; padding: 8px 8px 0 0; font-weight: 700; }
	.pull {
		border-left: 3px solid var(--color-surface-foreground);
		padding-left: 24px; margin: 40px 0; font-style: italic; font-size: 24px; line-height: 1.42;
	}
	@media (min-width: 768px) { .pull { font-size: 26px; } }
	.figure { margin: 44px 0; }
	.figure .band { height: 210px; border-radius: var(--radius-md); background: repeating-linear-gradient(135deg, #f3f3f3 0 22px, #ececec 22px 44px); }
	.figure figcaption { font-family: var(--sans); font-size: 13px; color: var(--color-muted); text-align: center; margin-top: 12px; }
	.divider-dots { text-align: center; letter-spacing: 0.6em; color: var(--color-muted); margin: 48px 0; }

	/* ── Story list: dividers, not boxes ──────────────────────────── */
	.listing { max-width: 1192px; margin: 0 auto; padding: 0 24px 72px; display: grid; grid-template-columns: 1fr; gap: 0; }
	@media (min-width: 1000px) { .listing { grid-template-columns: 728px 1fr; gap: 64px; } }
	.feed h3.feedhead { font-family: var(--sans); font-size: 14px; font-weight: 500; letter-spacing: 0.04em; padding: 22px 0 6px; border-bottom: 1px solid var(--color-surface-foreground); }
	.story { display: flex; gap: 24px; padding: 30px 0; border-bottom: 1px solid var(--color-border); align-items: flex-start; }
	.story .body { min-width: 0; flex: 1; }
	.story .k { font-family: var(--sans); font-size: 13px; color: var(--color-muted); display: flex; align-items: center; gap: 8px; }
	.story .k .av { width: 20px; height: 20px; border-radius: 50%; background: #d8d8d8; }
	.story h4 { font-family: var(--serif); font-weight: 700; font-size: 21px; margin: 8px 0 0; line-height: 1.25; }
	.story .ex { font-family: var(--sans); font-size: 15px; color: var(--color-muted); margin-top: 6px; line-height: 1.5; }
	.story .m { font-family: var(--sans); font-size: 13px; color: var(--color-muted); margin-top: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.star { color: var(--color-accent); }
	.thumb { width: 112px; height: 112px; flex: none; border-radius: var(--radius-md); background: repeating-linear-gradient(135deg, #f0f0f0 0 16px, #e7e7e7 16px 32px); }
	@media (max-width: 620px) { .thumb { width: 80px; height: 80px; } .story { gap: 16px; } }
	.chip { display: inline-block; font-family: var(--sans); font-size: 13px; background: var(--color-surface-raised); border-radius: 9999px; padding: 5px 14px; color: var(--color-surface-foreground); }

	.aside { display: none; }
	@media (min-width: 1000px) { .aside { display: block; padding-top: 30px; border-left: 1px solid var(--color-border); padding-left: 40px; } }
	.aside h5 { font-family: var(--sans); font-size: 14px; font-weight: 500; margin: 0 0 14px; }
	.aside .s { padding: 12px 0; }
	.aside .s b { font-family: var(--serif); font-size: 16px; display: block; line-height: 1.3; }
	.aside .s span { font-family: var(--sans); font-size: 13px; color: var(--color-muted); }

	/* ── Controls: slim pills, sans, quiet ────────────────────────── */
	.btn {
		font-family: var(--sans); font-size: 14px; font-weight: 400;
		height: 38px; padding: 0 18px;
		border: 1px solid transparent; border-radius: 9999px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		cursor: pointer; transition: background-color 150ms ease, color 150ms ease;
	}
	.btn:hover { background: #156b13; }
	.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(26 137 23 / 0.3); }
	.btn-outline { background: transparent; color: var(--color-surface-foreground); border-color: var(--color-surface-foreground); }
	.btn-outline:hover { background: var(--color-surface-foreground); color: #fff; }
	.btn-quiet { background: transparent; color: var(--color-muted); border-color: transparent; padding: 0 8px; }
	.btn-quiet:hover { color: var(--color-surface-foreground); }
	.btn[disabled] { cursor: not-allowed; background: transparent; color: #b3b3b3; border-color: var(--color-border); }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

	.input {
		font-family: var(--sans); font-size: 15px; width: 100%; max-width: 320px; height: 38px; padding: 0 4px;
		border: 0; border-bottom: 1px solid var(--color-surface-foreground); border-radius: 0;
		background: transparent; color: var(--color-surface-foreground);
	}
	.input::placeholder { color: var(--color-muted); }
	.input:focus { outline: none; border-bottom-width: 2px; }

	/* ── Reference sections ───────────────────────────────────────── */
	.ref { max-width: 728px; margin: 0 auto; padding: 0 24px 96px; font-family: var(--sans); font-size: 16px; }
	.section { padding-top: 56px; border-top: 1px solid var(--color-border); margin-top: 56px; }
	.section-label { font-size: 13px; color: var(--color-muted); letter-spacing: 0.04em; margin-bottom: 10px; }
	.section h2 { font-family: var(--serif); font-size: 30px; }
	.lede { color: var(--color-muted); margin-top: 12px; font-size: 16px; line-height: 1.6; }
	.note { margin-top: 18px; font-size: 14px; color: var(--color-muted); line-height: 1.6; }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 24px; }
	@media (min-width: 640px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 58px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
	.sw b { display: block; font-size: 13px; font-weight: 600; margin-top: 8px; }
	.sw span { font-size: 12px; color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; margin-top: 28px; align-items: start; }
	@media (min-width: 860px) { .mobile { grid-template-columns: 284px 1fr; gap: 40px; } }
	.phone {
		width: 284px; max-width: 100%; margin: 0 auto;
		border: 1px solid var(--color-surface-foreground); border-radius: 24px;
		overflow: hidden; background: var(--color-surface);
	}
	.phone-status { display: flex; justify-content: space-between; padding: 10px 16px 4px; font-size: 10px; color: var(--color-muted); background: var(--color-accent); }
	.phone-mast { display: flex; align-items: center; gap: 8px; background: var(--color-accent); padding: 2px 16px 10px; border-bottom: 1px solid var(--color-surface-foreground); }
	.phone-mast .wordmark { font-size: 19px; }
	.phone-body { padding: 14px 16px 8px; }
	.phone-body .k { font-size: 11px; color: var(--color-muted); font-family: var(--sans); display: flex; align-items: center; gap: 6px; }
	.phone-body .k .av { width: 16px; height: 16px; border-radius: 50%; background: #d8d8d8; }
	.phone-body h6 { font-family: var(--serif); font-weight: 700; font-size: 25px; line-height: 1.18; margin: 10px 0 0; }
	.phone-body .p { font-size: 15px; line-height: 1.6; margin-top: 12px; }
	.phone-body .pull { font-size: 15px; margin: 14px 0; padding-left: 12px; border-left-width: 2px; }
	/* The floating toolbar is one of only two shadows in the system. */
	.readbar { display: flex; align-items: center; gap: 14px; margin: 6px 12px 14px; padding: 9px 14px; border-radius: 9999px; box-shadow: var(--shadow-md); font-family: var(--sans); font-size: 11px; color: var(--color-muted); background: #fff; }
	.readbar .g { width: 15px; height: 15px; border: 1.4px solid currentColor; border-radius: 50%; }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 14px 0; border-bottom: 1px solid var(--color-border); font-size: 15px; color: var(--color-muted); line-height: 1.55; }
	.rules b { display: block; font-family: var(--serif); font-size: 17px; font-weight: 700; color: var(--color-surface-foreground); margin-bottom: 3px; }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 24px; }
	@media (min-width: 640px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 22px; border-radius: 14px; background: #fff; box-shadow: 0 8px 28px rgb(0 0 0 / 0.14); font-family: var(--sans); font-size: 17px; font-weight: 700; }
	.cmp-off small { display: block; font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 10px; line-height: 1.6; }
	.cmp-on { padding: 22px 0; border-top: 1px solid var(--color-surface-foreground); font-family: var(--serif); font-size: 21px; font-weight: 700; }
	.cmp-on small { display: block; font-family: var(--sans); font-weight: 400; font-size: 13px; color: var(--color-muted); margin-top: 10px; line-height: 1.6; }
</style>
</head>
<body>

<!-- COVER — the yellow band, a serif headline, and one green ask. Everything
     else on the page is a hairline and a lot of margin. -->
<header class="mast">
	<div class="mast-inner">
		<span class="wordmark">Vetta</span>
		<span class="links"><span>Our story</span><span>Membership</span><span>Write</span></span>
		<span class="spacer"></span>
		<button class="btn btn-quiet">Sign in</button>
		<button class="btn" style="background: var(--color-surface-foreground)">Get started</button>
	</div>
</header>

<section class="hero">
	<div class="hero-inner">
		<h1>Stay curious.</h1>
		<p>Serif prose, acres of margin, and chrome quiet enough that the writing is the
			only thing on the page asking for attention.</p>
		<div class="actions"><button class="btn" style="background: var(--color-surface-foreground); height: 44px; font-size: 17px; padding: 0 26px;">Start reading</button></div>
	</div>
</section>

<article class="article">
	<div class="byline">
		<span class="av"></span>
		<span><b>Ana Rivera</b><span class="meta">14 min read · Apr 12 · <span class="star">★</span> Member-only</span></span>
		<span class="spacer"></span>
		<button class="btn btn-outline">Follow</button>
	</div>

	<p class="kicker" style="margin-top:36px">DESIGN SYSTEMS</p>
	<h2 style="font-size:38px;margin-top:10px">Dividers, not boxes</h2>

	<p class="lede-p dropcap">Every story list wants to become a grid of cards. It is the reflex answer
		to "how do I separate these things" — and it is the wrong one here. A card adds a border, a radius,
		a shadow and a padding value to a problem that a single hairline already solved.</p>

	<p>The reading column is 680px and never widens. <span class="hl">Whitespace is the design</span>, so
		the vertical rhythm between blocks sits at 48–64px and nothing competes for the margin.</p>

	<blockquote class="pull">Never set body prose in sans, and never set UI chrome in serif. That one
		rule carries most of the identity.</blockquote>

	<p>Chrome — the nav, the buttons, the bylines, the read-time — is sans at 13–14px in muted gray.
		Prose is serif at 20–21px with relaxed leading. When those two swap, the page immediately reads
		as a product rather than a publication.</p>

	<figure class="figure">
		<div class="band"></div>
		<figcaption>Figures sit at 4px radius or square, never with a shadow.</figcaption>
	</figure>

	<p>Color is rationed to two: green for the few real asks — follow, subscribe, publish — and yellow
		as the flourish, whether that is a hero band, a member star, or a wash behind a highlighted sentence.
		They never appear in the same component.</p>

	<div class="clapbar">
		<span class="item"><span class="g"></span>1.2K</span>
		<span class="item"><span class="g"></span>38</span>
		<span class="spacer"></span>
		<span class="item"><span class="g"></span></span>
		<span class="item"><span class="g"></span></span>
	</div>
</article>

<div class="divider-dots">· · ·</div>

<div class="listing">
	<div class="feed">
		<h3 class="feedhead">More from Vetta</h3>

		<div class="story">
			<div class="body">
				<div class="k"><span class="av"></span>Jun Sun <span>in</span> <b style="font-weight:500">The Column</b></div>
				<h4>Why your type scale should start with the paragraph</h4>
				<p class="ex">Most scales are designed from the headline down. Doing it the other way around
					makes long-form reading the default rather than the exception.</p>
				<div class="m"><span class="star">★</span><span>Apr 09</span><span>·</span><span>8 min read</span><span>·</span><span class="chip">Typography</span></div>
			</div>
			<div class="thumb"></div>
		</div>

		<div class="story">
			<div class="body">
				<div class="k"><span class="av"></span>Mo Okafor</div>
				<h4>The case against the card</h4>
				<p class="ex">A hairline and 30px of space separate two stories perfectly well. Everything
					a card adds after that is decoration you now have to maintain.</p>
				<div class="m"><span>Apr 07</span><span>·</span><span>6 min read</span><span>·</span><span class="chip">Layout</span></div>
			</div>
			<div class="thumb"></div>
		</div>

		<div class="story">
			<div class="body">
				<div class="k"><span class="av"></span>Kaori Mori</div>
				<h4>Two hues is a whole palette</h4>
				<p class="ex">One color for the ask, one for the flourish, and a strict rule that they never
					share a component. It is more restrictive than it sounds, and more freeing.</p>
				<div class="m"><span class="star">★</span><span>Apr 02</span><span>·</span><span>11 min read</span><span>·</span><span class="chip">Color</span></div>
			</div>
			<div class="thumb"></div>
		</div>
	</div>

	<aside class="aside">
		<h5>Staff picks</h5>
		<div class="s"><b>The margin is the message</b><span>Ana Rivera · 5 min</span></div>
		<div class="s"><b>Writing a house style for hairlines</b><span>Jun Sun · 7 min</span></div>
		<div class="s"><b>When to break the 680</b><span>Mo Okafor · 4 min</span></div>
		<h5 style="margin-top:26px">Recommended topics</h5>
		<div class="row" style="gap:8px"><span class="chip">Design</span><span class="chip">Writing</span><span class="chip">Typography</span><span class="chip">Culture</span></div>
	</aside>
</div>

<div class="ref">
	<!-- 01 -->
	<section class="section" style="border-top:0;margin-top:0;padding-top:0">
		<p class="section-label">01 — Controls</p>
		<h2>Almost nothing is a button</h2>
		<p class="lede">Most "actions" are plain muted glyphs with a count next to them. The few real
			asks are slim green pills; the rest are ink-outlined. Inputs are a single underline, not a box.</p>
		<div class="row" style="margin-top: 22px;">
			<button class="btn">Subscribe</button>
			<button class="btn btn-outline">Follow</button>
			<button class="btn btn-quiet">Save</button>
			<button class="btn" disabled>Publishing…</button>
		</div>
		<div class="row" style="margin-top: 20px;">
			<input class="input" placeholder="you@company.com">
			<button class="btn">Get the newsletter</button>
		</div>
		<div class="swatches">
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#1a8917 · the ask</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-accent)"></div><b>accent</b><span>#ffc017 · the flourish</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface-foreground)"></div><b>ink</b><span>#242424 · prose</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-muted)"></div><b>muted</b><span>#6b6b6b · all chrome</span></div>
		</div>
		<p class="note">Green and yellow never co-occur in one component, and there are no other hues in the system at all.</p>
	</section>

	<!-- 02 MOBILE -->
	<section class="section">
		<p class="section-label">02 — Mobile</p>
		<h2>A phone is where long-form actually gets read</h2>
		<p class="lede">The 680px column becomes the viewport, prose drops one step to 18px, and the
			thumbnail shrinks instead of disappearing — a story list without images loses its scanning rhythm.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="phone-mast"><span class="wordmark">Vetta</span><span class="spacer"></span><span style="font-family:var(--sans);font-size:11px">⌕ ☰</span></div>
				<div class="phone-body">
					<div class="k"><span class="av"></span>Ana Rivera · 14 min</div>
					<h6>Dividers, not boxes</h6>
					<p class="p">Every story list wants to become a grid of cards. <span class="hl">It is the wrong reflex.</span></p>
					<blockquote class="pull">Never set body prose in sans.</blockquote>
					<p class="p" style="font-size:14px;color:var(--color-muted)">A hairline and 30px of space separate two stories perfectly well.</p>
				</div>
				<div class="readbar"><span class="g"></span>1.2K<span class="g"></span>38<span class="spacer"></span><span class="g"></span><span class="g"></span></div>
			</div>
			<ul class="rules">
				<li><b>The column</b>680px becomes the viewport at 24px gutters. Prose goes 21px → 18px and line height stays at 1.62 — that leading is what makes a long piece survive a small screen.</li>
				<li><b>Titles</b>Article titles 38px → 25px, hero 76px → 46px. They stay serif bold; they never switch to sans for "clarity at small sizes".</li>
				<li><b>The drop cap</b>Kept, at roughly half size. It is a publication signal, and it costs nothing on touch.</li>
				<li><b>Story list</b>Thumbnails shrink 112px → 80px rather than dropping out. The excerpt goes from two lines to one; the meta row wraps instead of truncating.</li>
				<li><b>The aside</b>The 368px sticky sidebar moves below the feed as a plain divider-separated list. It never becomes a carousel of cards.</li>
				<li><b>Clap bar</b>Detaches from the flow and floats as a pill on <code>shadow-md</code> above the bottom edge — one of only two shadows this system permits.</li>
				<li><b>Yellow</b>The masthead band stays yellow on mobile. It is the one piece of color the reader sees before the writing starts, so it survives every breakpoint.</li>
			</ul>
		</div>
	</section>

	<!-- 03 DON'T -->
	<section class="section">
		<p class="section-label">03 — Off-style, for contrast</p>
		<h2>What breaks the magazine</h2>
		<div class="compare">
			<div class="cmp-off">Sans headline in a floating card
				<small>14px radius · drop shadow · sans-serif title · boxed excerpt. This is the single most common way a Medium-style layout stops looking like one.</small></div>
			<div class="cmp-on">Same story, on-style
				<small>Serif bold title, one ink hairline above it, sans excerpt in muted gray, no box at all. Dividers separate; boxes decorate.</small></div>
		</div>
		<p class="note">Also out: prose in sans, chrome in serif, shadows on story items, and any third hue beyond the green and the yellow.</p>
	</section>
</div>

</body>
</html>
`;

const Retro95_THEME = `/* Retro 95 — beveled gray chrome, navy title bars, zero curvature. Palette derived from awesome-design-md (MIT). */
@theme static {
	--color-primary: #000080;
	--color-primary-foreground: #ffffff;
	--color-surface: #008080;
	--color-surface-foreground: #000000;
	--color-surface-raised: #c3c3c3;
	--color-muted: #5a5a5a;
	--color-accent: #008080;
	--color-danger: #aa0000;
	--color-border: #868a8e;

	--radius-sm: 0px;
	--radius-md: 0px;
	--radius-lg: 0px;
	--radius-xl: 0px;
	--radius-2xl: 0px;

	--shadow-sm: 1px 1px 0 rgb(0 0 0 / 0.5);
	--shadow-md: 2px 2px 0 rgb(0 0 0 / 0.5);
	--shadow-lg: 4px 4px 0 rgb(0 0 0 / 0.5);
}
`;

const Retro95_SPEC = `# Retro 95

## Atmosphere
1995 desktop nostalgia, played straight. Teal desktop, gray chrome windows,
navy title bars, beveled everything. Charmingly rigid — a museum piece that
still boots.

## Color roles
All colors come from \`theme.css\` tokens — never hardcode hex in frames.
- \`surface\` is the teal desktop; every window/panel is \`surface-raised\`
  (silver #c3c3c3).
- \`primary\` (navy) fills title bars and selection highlights, with white text.
- \`accent\` teal for desktop/secondary chrome moments; \`danger\` for the
  classic error red.
- Text is pure black on silver; disabled text \`muted\` with the classic
  white 1px offset (simulate with \`text-muted\` + \`drop-shadow\`).

## Typography
System font stack only, played small and plain:
- Everything 11–13px, \`font-normal\`; window titles 12px \`font-bold\` white.
- No tracking tricks, no large display type — headings are just bold 13px.
- \`font-mono\` for terminal/notepad content areas on white.

## Shape & depth
- ZERO border radius. Every corner is square — no exceptions.
- The bevel IS the depth: raised chrome = 2px light top/left
  (\`border-t-white border-l-white\`) + dark bottom/right
  (\`border-b-[#5a5a5a] border-r-[#5a5a5a]\`); sunken wells invert it.
- Shadows are hard offsets (\`shadow-md\` = 2px 2px 0): windows may cast one.

## Components
- Window: silver panel, navy title bar with white bold title + □ ✕ buttons
  (16px beveled squares), inner content on white with sunken bevel.
- Buttons: h-7 silver beveled rectangles, black 12px label; pressed state
  inverts the bevel and nudges text 1px down-right.
- Inputs: white sunken fields, square, black caret; no focus rings — focus is
  a 1px dotted black outline.
- Menus/toolbars: flat silver strips with beveled separators; menu items
  highlight navy with white text.
- Status bar: bottom sunken strip with beveled section dividers.

## Layout
Windows float on the teal desktop, slightly offset like real 1995. Inside a
window: menu bar (24px), toolbar, content well, status bar (24px). Spacing is
tight and even: 4/8px. Alignment is grid-perfect — the OS would not tolerate
less.

## Don'ts
- Absolutely no rounded corners, gradients, blur, or soft shadows.
- No modern minimalism: chrome is supposed to be visible and chunky.
- Never anti-historical colors (pastels, neons) — stay in the system palette.
`;

const Retro95_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Retro 95 — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
		--color-primary: #000080;
		--color-primary-foreground: #ffffff;
		--color-surface: #008080;
		--color-surface-foreground: #000000;
		--color-surface-raised: #c3c3c3;
		--color-muted: #5a5a5a;
		--color-accent: #008080;
		--color-danger: #aa0000;
		--color-border: #868a8e;

		--radius-sm: 0px;
		--radius-md: 0px;
		--radius-lg: 0px;
		--radius-xl: 0px;
		--radius-2xl: 0px;

		--shadow-sm: 1px 1px 0 rgb(0 0 0 / 0.5);
		--shadow-md: 2px 2px 0 rgb(0 0 0 / 0.5);
		--shadow-lg: 4px 4px 0 rgb(0 0 0 / 0.5);

		--bevel-light: #ffffff;
		--bevel-dark: #5a5a5a;
		--sans: "Segoe UI", Tahoma, Verdana, Geneva, "MS Sans Serif", -apple-system, sans-serif;
		--mono: "Courier New", ui-monospace, Menlo, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	body {
		margin: 0;
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 12px;
		line-height: 1.45;
		padding: 14px 12px 40px;
	}
	/* Headings are just bold 13px. No display type exists in this system. */
	h1, h2, h3 { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.3; }
	p { margin: 0; }
	::selection { background: var(--color-primary); color: #fff; }
	.spacer { flex: 1; }
	.mono { font-family: var(--mono); }

	/* ── The bevel IS the depth. Raised: light top/left, dark bottom/right. ── */
	.raised {
		background: var(--color-surface-raised);
		border-top: 2px solid var(--bevel-light);
		border-left: 2px solid var(--bevel-light);
		border-bottom: 2px solid var(--bevel-dark);
		border-right: 2px solid var(--bevel-dark);
	}
	.sunken {
		background: #ffffff;
		border-top: 2px solid var(--bevel-dark);
		border-left: 2px solid var(--bevel-dark);
		border-bottom: 2px solid var(--bevel-light);
		border-right: 2px solid var(--bevel-light);
	}
	.sunken-gray { background: var(--color-surface-raised); }

	/* ── Windows float on the teal desktop, slightly offset ───────── */
	.window { max-width: 880px; margin: 0 auto 22px; box-shadow: var(--shadow-md); }
	.window.offset { margin-left: auto; margin-right: auto; }
	.titlebar {
		display: flex; align-items: center; gap: 6px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		padding: 3px 3px 3px 5px; font-size: 12px; font-weight: 700;
		margin: 2px;
	}
	.titlebar.inactive { background: var(--color-border); }
	.titlebar .ico { width: 14px; height: 14px; background: var(--color-surface-raised); flex: none; }
	.tbtn {
		width: 17px; height: 15px; flex: none;
		background: var(--color-surface-raised); color: #000;
		border-top: 1px solid var(--bevel-light); border-left: 1px solid var(--bevel-light);
		border-bottom: 1px solid var(--bevel-dark); border-right: 1px solid var(--bevel-dark);
		display: grid; place-items: center; font-size: 9px; font-weight: 700; line-height: 1;
	}
	.menubar { display: flex; gap: 2px; padding: 1px 4px; font-size: 12px; }
	.menubar span { padding: 2px 7px; }
	.menubar span:first-child { background: var(--color-primary); color: #fff; }
	.menubar u { text-decoration: underline; }
	.toolbar { display: flex; align-items: center; gap: 3px; padding: 3px 4px; }
	.tool {
		width: 24px; height: 22px; display: grid; place-items: center; font-size: 12px;
		background: var(--color-surface-raised);
		border-top: 1px solid var(--bevel-light); border-left: 1px solid var(--bevel-light);
		border-bottom: 1px solid var(--bevel-dark); border-right: 1px solid var(--bevel-dark);
	}
	.tool.pressed { border-top-color: var(--bevel-dark); border-left-color: var(--bevel-dark); border-bottom-color: var(--bevel-light); border-right-color: var(--bevel-light); }
	.toolsep { width: 2px; height: 20px; border-left: 1px solid var(--bevel-dark); border-right: 1px solid var(--bevel-light); margin: 0 3px; }
	.content { margin: 3px; padding: 8px; }
	.statusbar { display: flex; gap: 3px; margin: 3px; font-size: 11px; }
	.statusbar .cell { padding: 2px 6px; flex: none; border-top: 1px solid var(--bevel-dark); border-left: 1px solid var(--bevel-dark); border-bottom: 1px solid var(--bevel-light); border-right: 1px solid var(--bevel-light); }
	.statusbar .cell.grow { flex: 1; }

	/* ── File list ────────────────────────────────────────────────── */
	.filelist { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; }
	.filelist th {
		text-align: left; font-weight: 400; padding: 2px 6px; background: var(--color-surface-raised);
		border-top: 1px solid var(--bevel-light); border-left: 1px solid var(--bevel-light);
		border-bottom: 1px solid var(--bevel-dark); border-right: 1px solid var(--bevel-dark);
	}
	.filelist td { padding: 2px 6px; }
	.filelist tr.selected td { background: var(--color-primary); color: #fff; }
	.filelist .ic { width: 16px; }
	@media (max-width: 620px) { .filelist .hide-sm { display: none; } }

	/* ── Controls ─────────────────────────────────────────────────── */
	.btn {
		font-family: var(--sans); font-size: 12px; font-weight: 400;
		height: 24px; min-width: 78px; padding: 0 12px;
		background: var(--color-surface-raised); color: #000;
		border-top: 2px solid var(--bevel-light); border-left: 2px solid var(--bevel-light);
		border-bottom: 2px solid var(--bevel-dark); border-right: 2px solid var(--bevel-dark);
		border-radius: 0; cursor: pointer;
	}
	/* Pressed inverts the bevel and nudges the label 1px down-right. */
	.btn:active {
		border-top-color: var(--bevel-dark); border-left-color: var(--bevel-dark);
		border-bottom-color: var(--bevel-light); border-right-color: var(--bevel-light);
		padding: 1px 11px 0 13px;
	}
	.btn:focus-visible { outline: 1px dotted #000; outline-offset: -4px; }
	.btn.default { box-shadow: 0 0 0 1px #000; }
	.btn[disabled] { cursor: default; color: var(--color-muted); text-shadow: 1px 1px 0 #fff; }
	.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

	.input {
		font-family: var(--sans); font-size: 12px; height: 22px; padding: 0 5px; width: 100%; max-width: 240px;
		background: #fff; color: #000; border-radius: 0;
		border-top: 2px solid var(--bevel-dark); border-left: 2px solid var(--bevel-dark);
		border-bottom: 2px solid var(--bevel-light); border-right: 2px solid var(--bevel-light);
	}
	.input:focus { outline: none; }

	.check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
	.box { width: 13px; height: 13px; background: #fff; flex: none; display: grid; place-items: center; font-size: 10px; line-height: 1;
		border-top: 2px solid var(--bevel-dark); border-left: 2px solid var(--bevel-dark);
		border-bottom: 2px solid var(--bevel-light); border-right: 2px solid var(--bevel-light); }
	.radio { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px inset #868a8e; flex: none; display: grid; place-items: center; font-size: 9px; }

	.progress { height: 20px; padding: 2px; display: flex; gap: 2px; max-width: 280px; }
	.progress i { width: 12px; background: var(--color-primary); display: block; }

	.fieldset { border: 1px solid var(--bevel-dark); border-right-color: var(--bevel-light); border-bottom-color: var(--bevel-light); padding: 10px; margin-top: 10px; position: relative; }
	.fieldset > .legend { position: absolute; top: -8px; left: 8px; background: var(--color-surface-raised); padding: 0 4px; font-size: 12px; }

	.notepad { font-family: var(--mono); font-size: 12px; line-height: 1.5; padding: 6px; min-height: 120px; white-space: pre-wrap; }

	/* ── Sections ─────────────────────────────────────────────────── */
	.section-title { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
	.lede { margin-top: 6px; max-width: 74ch; }
	.note { margin-top: 10px; color: var(--color-muted); }

	.swatches { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
	@media (min-width: 640px) { .swatches { grid-template-columns: repeat(4, 1fr); } }
	.sw .fill { height: 42px; }
	.sw b { display: block; font-size: 12px; font-weight: 700; margin-top: 5px; }
	.sw span { color: var(--color-muted); }

	/* ── Mobile ───────────────────────────────────────────────────── */
	.mobile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; margin-top: 12px; align-items: start; }
	@media (min-width: 820px) { .mobile { grid-template-columns: 264px 1fr; gap: 26px; } }
	/* A 1995 window on a 2026 phone: the chrome does not round, it shrinks. */
	.phone { width: 264px; max-width: 100%; margin: 0 auto; background: var(--color-surface); padding: 6px; box-shadow: var(--shadow-md); }
	.phone-status { display: flex; justify-content: space-between; font-size: 10px; color: #cfe9e9; padding: 2px 4px 6px; }
	.m-window { box-shadow: var(--shadow-sm); }
	.m-window .titlebar { font-size: 11px; }
	.m-content { margin: 3px; padding: 6px; }
	.m-filelist { width: 100%; border-collapse: collapse; font-size: 11px; background: #fff; }
	.m-filelist td { padding: 2px 5px; }
	.m-filelist tr.selected td { background: var(--color-primary); color: #fff; }
	.m-taskbar { display: flex; gap: 4px; align-items: center; margin-top: 6px; padding: 2px; }
	.m-start { font-weight: 700; font-size: 11px; padding: 2px 8px; display: flex; align-items: center; gap: 4px;
		border-top: 2px solid var(--bevel-light); border-left: 2px solid var(--bevel-light);
		border-bottom: 2px solid var(--bevel-dark); border-right: 2px solid var(--bevel-dark); }
	.m-task { flex: 1; font-size: 11px; padding: 2px 6px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		border-top: 2px solid var(--bevel-dark); border-left: 2px solid var(--bevel-dark);
		border-bottom: 2px solid var(--bevel-light); border-right: 2px solid var(--bevel-light); }
	.m-clock { font-size: 11px; padding: 2px 6px;
		border-top: 1px solid var(--bevel-dark); border-left: 1px solid var(--bevel-dark);
		border-bottom: 1px solid var(--bevel-light); border-right: 1px solid var(--bevel-light); }

	.rules { margin: 0; padding: 0; list-style: none; }
	.rules li { padding: 7px 0; border-bottom: 1px solid var(--bevel-dark); }
	.rules li:last-child { border-bottom: 0; }
	.rules b { display: block; font-weight: 700; margin-bottom: 1px; }
	.rules span { color: var(--color-muted); }

	/* ── Off-style ────────────────────────────────────────────────── */
	.compare { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 10px; }
	@media (min-width: 640px) { .compare { grid-template-columns: repeat(2, 1fr); } }
	.cmp-off { padding: 16px; border-radius: 12px; background: linear-gradient(140deg, #f8fafc, #e2e8f0); box-shadow: 0 8px 22px rgb(15 23 42 / 0.14); color: #475569; font-size: 13px; }
	.cmp-off small { display: block; margin-top: 8px; color: #64748b; }
	.cmp-on { padding: 14px; font-size: 12px; }
	.cmp-on small { display: block; margin-top: 8px; color: var(--color-muted); }

	.desktop-icons { display: flex; gap: 22px; max-width: 880px; margin: 0 auto 14px; color: #fff; font-size: 11px; text-align: center; }
	.desktop-icons .di { width: 62px; }
	.desktop-icons .di .g { width: 32px; height: 28px; margin: 0 auto 4px; background: var(--color-surface-raised);
		border-top: 2px solid var(--bevel-light); border-left: 2px solid var(--bevel-light);
		border-bottom: 2px solid var(--bevel-dark); border-right: 2px solid var(--bevel-dark); }
</style>
</head>
<body>

<!-- COVER — a teal desktop with windows on it. Zero radius, beveled chrome,
     navy title bars. Everything is 11–13px and grid-perfect. -->
<div class="desktop-icons">
	<div class="di"><div class="g"></div>My Computer</div>
	<div class="di"><div class="g"></div>Design Tokens</div>
	<div class="di"><div class="g"></div>Recycle Bin</div>
</div>

<div class="window raised">
	<div class="titlebar">
		<span class="ico"></span>Design Tokens — C:\\VETTA\\TOKENS
		<span class="spacer"></span>
		<span class="tbtn">_</span><span class="tbtn">□</span><span class="tbtn">✕</span>
	</div>
	<div class="menubar">
		<span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>H</u>elp</span>
	</div>
	<div class="toolbar">
		<span class="tool">◀</span><span class="tool">▶</span><span class="tool">↑</span>
		<span class="toolsep"></span>
		<span class="tool pressed">▤</span><span class="tool">▦</span>
		<span class="toolsep"></span>
		<span class="tool">✂</span><span class="tool">⧉</span><span class="tool">📋</span>
		<span class="spacer"></span>
		<span class="input sunken" style="max-width:180px;height:22px;padding:2px 5px;display:flex;align-items:center">C:\\VETTA\\TOKENS</span>
	</div>
	<div class="content sunken">
		<table class="filelist">
			<thead>
				<tr><th class="ic"></th><th>Name</th><th class="hide-sm">Size</th><th class="hide-sm">Type</th><th>Modified</th></tr>
			</thead>
			<tbody>
				<tr class="selected"><td>▤</td><td>THEME.CSS</td><td class="hide-sm">2 KB</td><td class="hide-sm">Cascading Style Sheet</td><td>12/04/95 09:41</td></tr>
				<tr><td>▤</td><td>DESIGN.MD</td><td class="hide-sm">4 KB</td><td class="hide-sm">Markdown Document</td><td>12/04/95 09:12</td></tr>
				<tr><td>▤</td><td>DEMO.HTM</td><td class="hide-sm">18 KB</td><td class="hide-sm">HTML Document</td><td>11/04/95 17:04</td></tr>
				<tr><td>▦</td><td>SCREENS</td><td class="hide-sm">—</td><td class="hide-sm">File Folder</td><td>09/04/95 11:20</td></tr>
				<tr><td>▤</td><td>README.TXT</td><td class="hide-sm">1 KB</td><td class="hide-sm">Text Document</td><td>02/04/95 08:55</td></tr>
			</tbody>
		</table>
	</div>
	<div class="statusbar">
		<span class="cell grow">5 object(s)</span>
		<span class="cell">25.3 KB</span>
		<span class="cell">My Computer</span>
	</div>
</div>

<div class="window raised" style="max-width: 460px;">
	<div class="titlebar">
		<span class="ico"></span>Properties — THEME.CSS
		<span class="spacer"></span>
		<span class="tbtn">✕</span>
	</div>
	<div class="content">
		<div class="row" style="gap:10px;align-items:flex-start">
			<span class="tool" style="width:32px;height:30px;font-size:15px">▤</span>
			<div style="flex:1">
				<input class="input" value="THEME.CSS" style="max-width:100%">
			</div>
		</div>
		<div class="fieldset">
			<span class="legend">Attributes</span>
			<div class="row" style="gap:16px">
				<span class="check"><span class="box">✓</span>Read-only</span>
				<span class="check"><span class="box"></span>Hidden</span>
				<span class="check"><span class="box">✓</span>Archive</span>
			</div>
			<div class="row" style="gap:16px;margin-top:8px">
				<span class="check"><span class="radio">●</span>Tokens only</span>
				<span class="check"><span class="radio"></span>Full export</span>
			</div>
		</div>
		<div class="fieldset">
			<span class="legend">Copying</span>
			<div class="progress sunken sunken-gray"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
			<p style="margin-top:6px">Copying 3 of 5 files…</p>
		</div>
		<div class="row" style="justify-content:flex-end;margin-top:12px">
			<button class="btn default">OK</button>
			<button class="btn">Cancel</button>
			<button class="btn" disabled>Apply</button>
		</div>
	</div>
</div>

<div class="window raised" style="max-width: 620px;">
	<div class="titlebar inactive">
		<span class="ico"></span>Notepad — README.TXT
		<span class="spacer"></span>
		<span class="tbtn">_</span><span class="tbtn">□</span><span class="tbtn">✕</span>
	</div>
	<div class="menubar"><span style="background:transparent;color:#000"><u>F</u>ile</span><span><u>E</u>dit</span><span><u>S</u>earch</span><span><u>H</u>elp</span></div>
	<div class="content sunken notepad">RETRO 95 — HOUSE RULES
======================

1. Zero border radius. Every corner is square. No exceptions.
2. The bevel is the depth: 2px white top/left, 2px #5a5a5a
   bottom/right. Sunken wells invert it.
3. All type is 11-13px and plain. Window titles are 12px bold
   white on navy. There is no display type in this system.
4. Focus is a 1px dotted black outline, drawn inside the
   control. There are no focus rings.
5. Disabled text is gray with a 1px white offset underneath.</div>
	<div class="statusbar"><span class="cell grow">Ln 1, Col 1</span><span class="cell">100%</span></div>
</div>

<!-- 01 -->
<div class="window raised">
	<div class="titlebar"><span class="ico"></span>01 — Chrome &amp; bevels<span class="spacer"></span><span class="tbtn">✕</span></div>
	<div class="content">
		<div class="section-title"><h2>Two pixels of light, two of shadow</h2></div>
		<p class="lede">Every raised object takes a white top and left edge with a #5a5a5a bottom and
			right; every well inverts it. That single pair does all the work that radius, shadow and color
			do in a modern system — which is why nothing here needs any of them.</p>
		<div class="row" style="margin-top:12px">
			<button class="btn default">OK</button>
			<button class="btn">Cancel</button>
			<button class="btn">Browse…</button>
			<button class="btn" disabled>Apply</button>
			<span class="check"><span class="box">✓</span>Show hidden files</span>
		</div>
		<div class="row" style="margin-top:10px">
			<input class="input" value="C:\\VETTA\\">
			<span class="mono" style="color:var(--color-muted)">sunken well · white fill · square caret</span>
		</div>
		<div class="swatches">
			<div class="sw"><div class="fill raised"></div><b>surface-raised</b><span>#c3c3c3 silver</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-primary)"></div><b>primary</b><span>#000080 navy</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-surface)"></div><b>surface</b><span>#008080 desktop</span></div>
			<div class="sw"><div class="fill" style="background: var(--color-danger)"></div><b>danger</b><span>#aa0000 error</span></div>
		</div>
		<p class="note">Navy fills title bars and selection highlights, always with white text. Teal belongs to the desktop behind the windows and nowhere else.</p>
	</div>
</div>

<!-- 02 MOBILE -->
<div class="window raised">
	<div class="titlebar"><span class="ico"></span>02 — Mobile<span class="spacer"></span><span class="tbtn">✕</span></div>
	<div class="content">
		<div class="section-title"><h2>The chrome shrinks — it never softens</h2></div>
		<p class="lede">A 1995 interface on a 2026 phone is a genuine constraint: the bevels and hit
			targets were drawn for a mouse. The answer is to keep every rule and change only the arithmetic —
			one window fills the viewport, the taskbar becomes the navigation, and controls grow taller
			without gaining a single pixel of radius.</p>
		<div class="mobile">
			<div class="phone">
				<div class="phone-status"><span>9:41</span><span>LTE ▮</span></div>
				<div class="m-window raised">
					<div class="titlebar"><span class="ico"></span>Design Tokens<span class="spacer"></span><span class="tbtn">✕</span></div>
					<div class="menubar"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span></div>
					<div class="m-content sunken">
						<table class="m-filelist">
							<tbody>
								<tr class="selected"><td>▤</td><td>THEME.CSS</td><td>2 KB</td></tr>
								<tr><td>▤</td><td>DESIGN.MD</td><td>4 KB</td></tr>
								<tr><td>▤</td><td>DEMO.HTM</td><td>18 KB</td></tr>
								<tr><td>▦</td><td>SCREENS</td><td>—</td></tr>
							</tbody>
						</table>
					</div>
					<div class="statusbar"><span class="cell grow">4 object(s)</span><span class="cell">24 KB</span></div>
				</div>
				<div class="m-taskbar raised">
					<span class="m-start">▤ Start</span>
					<span class="m-task">Design Tokens</span>
					<span class="m-clock">9:41</span>
				</div>
			</div>
			<ul class="rules">
				<li><b>One window, full width</b><span>Overlapping windows are a mouse idea. On a phone a single window fills the viewport with a 6px teal margin, so you can still see the desktop it belongs to.</span></li>
				<li><b>The taskbar is the nav</b><span>Start button, one task button per open window, and the clock. It pins to the bottom and keeps its raised bevel and pressed task state.</span></li>
				<li><b>Bevels stay 2px</b><span>They do not thin out, round off or turn into a hairline. At 2px they are already the smallest structural element the system has.</span></li>
				<li><b>Targets grow, chrome doesn't</b><span>Buttons go from 24px to 36px tall and title-bar boxes from 17px to 28px. Padding grows; border width, radius and type size do not.</span></li>
				<li><b>Columns drop</b><span>The file list keeps name and size, dropping type and modified date below 620px. It stays a table with a beveled header — never a card list.</span></li>
				<li><b>Type floor</b><span>11px is the smallest size in the system and 13px bold is the largest. Nothing scales up on mobile; the density is historically accurate and stays.</span></li>
				<li><b>No gestures</b><span>Swipe and long-press have no 1995 equivalent, so every action stays reachable from a menu bar or a button. Hidden gestures would be an anachronism.</span></li>
			</ul>
		</div>
	</div>
</div>

<!-- 03 DON'T -->
<div class="window raised">
	<div class="titlebar"><span class="ico"></span>03 — Off-style, for contrast<span class="spacer"></span><span class="tbtn">✕</span></div>
	<div class="content">
		<div class="section-title"><h2>What breaks the museum piece</h2></div>
		<div class="compare">
			<div class="cmp-off">Modern soft panel
				<small>12px radius · gradient fill · blurred drop shadow · slate-gray text. Any one of these makes the whole thing read as a costume rather than the real machine.</small></div>
			<div class="cmp-on raised">Same content, on-style
				<small>Square corners, flat #c3c3c3 fill, 2px bevel, black 12px text. The chrome is supposed to be visible and chunky — that is the aesthetic, not a limitation.</small></div>
		</div>
		<p class="note">Also out: pastels and neons, anti-historical colors of any kind, large display type, and modern minimalism that hides the chrome.</p>
	</div>
	<div class="statusbar"><span class="cell grow">Vetta design reference — retro-95</span><span class="cell">READY</span></div>
</div>

</body>
</html>
`;

/** 上游 25 套,顺序即清单的 `order`(按风格差异交错排,便于横看时相邻两张差别明显)。 */
export const UPSTREAM_DESIGN_STYLES: readonly DesignStyle[] = [
	{
		id: "linear",
		name: "Linear",
		category: "dev",
		vibe: "dark",
		tagline: "暗色高密度，工程师的冷静秩序",
		themeCss: Linear_THEME,
		designMd: Linear_SPEC,
		demoHtml: Linear_DEMO,
	},
	{
		id: "doodle-pop",
		name: "Doodle Pop",
		category: "playful",
		vibe: "light",
		tagline: "柠黄撞黑，波点贴纸游戏感",
		themeCss: DoodlePop_THEME,
		designMd: DoodlePop_SPEC,
		demoHtml: DoodlePop_DEMO,
	},
	{
		id: "stripe",
		name: "Stripe",
		category: "fintech",
		vibe: "light",
		tagline: "蓝紫金融质感，云淡阴影考究",
		themeCss: Stripe_THEME,
		designMd: Stripe_SPEC,
		demoHtml: Stripe_DEMO,
	},
	{
		id: "spotify",
		name: "Spotify",
		category: "media",
		vibe: "dark",
		tagline: "近黑舞台，一抹电光绿",
		themeCss: Spotify_THEME,
		designMd: Spotify_SPEC,
		demoHtml: Spotify_DEMO,
	},
	{
		id: "meadow-buddies",
		name: "Meadow Buddies",
		category: "playful",
		vibe: "light",
		tagline: "鼠尾草绿与杏黄，森林伙伴陪你运动",
		themeCss: MeadowBuddies_THEME,
		designMd: MeadowBuddies_SPEC,
		demoHtml: MeadowBuddies_DEMO,
	},
	{
		id: "notion",
		name: "Notion",
		category: "productivity",
		vibe: "light",
		tagline: "暖灰纸面，文字即界面",
		themeCss: Notion_THEME,
		designMd: Notion_SPEC,
		demoHtml: Notion_DEMO,
	},
	{
		id: "vercel",
		name: "Vercel",
		category: "dev",
		vibe: "light",
		tagline: "黑白极简，瑞士式精确",
		themeCss: Vercel_THEME,
		designMd: Vercel_SPEC,
		demoHtml: Vercel_DEMO,
	},
	{
		id: "headspace",
		name: "Headspace",
		category: "playful",
		vibe: "light",
		tagline: "日出暖橙，圆到底的松弛感",
		themeCss: Headspace_THEME,
		designMd: Headspace_SPEC,
		demoHtml: Headspace_DEMO,
	},
	{
		id: "github",
		name: "GitHub",
		category: "dev",
		vibe: "dark",
		tagline: "暗夜代码栖息地，绿色行动",
		themeCss: Github_THEME,
		designMd: Github_SPEC,
		demoHtml: Github_DEMO,
	},
	{
		id: "geometric-bold",
		name: "Geometric Bold",
		category: "creative",
		vibe: "light",
		tagline: "包豪斯色块，硬边框，零阴影",
		themeCss: GeometricBold_THEME,
		designMd: GeometricBold_SPEC,
		demoHtml: GeometricBold_DEMO,
	},
	{
		id: "apple",
		name: "Apple",
		category: "consumer",
		vibe: "light",
		tagline: "留白与大字，高级感的呼吸",
		themeCss: Apple_THEME,
		designMd: Apple_SPEC,
		demoHtml: Apple_DEMO,
	},
	{
		id: "discord",
		name: "Discord",
		category: "consumer",
		vibe: "dark",
		tagline: "深色俱乐部，蓝紫活力",
		themeCss: Discord_THEME,
		designMd: Discord_SPEC,
		demoHtml: Discord_DEMO,
	},
	{
		id: "claymorphism",
		name: "Claymorphism",
		category: "playful",
		vibe: "light",
		tagline: "糖果马卡龙，超大圆角，捏得动的立体感",
		themeCss: Claymorphism_THEME,
		designMd: Claymorphism_SPEC,
		demoHtml: Claymorphism_DEMO,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		category: "ai",
		vibe: "light",
		tagline: "书页米色，衬线与陶土",
		themeCss: Anthropic_THEME,
		designMd: Anthropic_SPEC,
		demoHtml: Anthropic_DEMO,
	},
	{
		id: "netflix",
		name: "Netflix",
		category: "media",
		vibe: "dark",
		tagline: "影院黑，一颗红色按钮",
		themeCss: Netflix_THEME,
		designMd: Netflix_SPEC,
		demoHtml: Netflix_DEMO,
	},
	{
		id: "airbnb",
		name: "Airbnb",
		category: "consumer",
		vibe: "light",
		tagline: "珊瑚色的温暖待客之道",
		themeCss: Airbnb_THEME,
		designMd: Airbnb_SPEC,
		demoHtml: Airbnb_DEMO,
	},
	{
		id: "duolingo",
		name: "Duolingo",
		category: "playful",
		vibe: "light",
		tagline: "鲜绿游戏感，按钮会下沉",
		themeCss: Duolingo_THEME,
		designMd: Duolingo_SPEC,
		demoHtml: Duolingo_DEMO,
	},
	{
		id: "figma",
		name: "Figma",
		category: "creative",
		vibe: "light",
		tagline: "工具白，蓝色选中紫色灵感",
		themeCss: Figma_THEME,
		designMd: Figma_SPEC,
		demoHtml: Figma_DEMO,
	},
	{
		id: "glassmorphism",
		name: "Glassmorphism",
		category: "premium",
		vibe: "dark",
		tagline: "深夜场景之上，一层不着色的玻璃",
		themeCss: Glassmorphism_THEME,
		designMd: Glassmorphism_SPEC,
		demoHtml: Glassmorphism_DEMO,
	},
	{
		id: "openai",
		name: "OpenAI",
		category: "ai",
		vibe: "light",
		tagline: "实验室白，青绿点睛",
		themeCss: Openai_THEME,
		designMd: Openai_SPEC,
		demoHtml: Openai_DEMO,
	},
	{
		id: "slack",
		name: "Slack",
		category: "productivity",
		vibe: "light",
		tagline: "白底茄紫导航，糖果点缀",
		themeCss: Slack_THEME,
		designMd: Slack_SPEC,
		demoHtml: Slack_DEMO,
	},
	{
		id: "coinbase",
		name: "Coinbase",
		category: "fintech",
		vibe: "light",
		tagline: "一蓝到底，数字优先",
		themeCss: Coinbase_THEME,
		designMd: Coinbase_SPEC,
		demoHtml: Coinbase_DEMO,
	},
	{
		id: "shopify",
		name: "Shopify",
		category: "commerce",
		vibe: "light",
		tagline: "商家后台，商业绿行动色",
		themeCss: Shopify_THEME,
		designMd: Shopify_SPEC,
		demoHtml: Shopify_DEMO,
	},
	{
		id: "medium",
		name: "Medium",
		category: "editorial",
		vibe: "light",
		tagline: "杂志白，衬线正文黄高亮",
		themeCss: Medium_THEME,
		designMd: Medium_SPEC,
		demoHtml: Medium_DEMO,
	},
	{
		id: "retro-95",
		name: "Retro 95",
		category: "retro",
		vibe: "light",
		tagline: "1995 桌面，斜面银灰零圆角",
		themeCss: Retro95_THEME,
		designMd: Retro95_SPEC,
		demoHtml: Retro95_DEMO,
	},
];
