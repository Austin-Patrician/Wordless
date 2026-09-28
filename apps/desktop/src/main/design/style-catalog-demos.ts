/**
 * 自撰那 4 套风格的**示例页**。
 *
 * 风格目录里每套带三份东西:`theme.css`(令牌)、`DESIGN.md`(给 agent 的规范)、`demo.html`
 * (整页成品)。前两份决定"写进你设计里的东西",而这一份回答用户真正的那个问题 —— **这套长
 * 什么样**。上游那 25 套的示例随清单一起进包;这 4 套是我们自己的,所以示例也在这里手写。
 *
 * ## 与上游示例同一套约定(不是巧合,是可断言的)
 *
 * - **自包含**:一份 `<style>`,令牌以 `:root` 自定义属性内联,纯手写 CSS 消费它们。没有
 *   `<script>`、`<link>`、`@import`、`@font-face`、没有任何外链 —— 渲染它不需要网络,而它就
 *   活在 `sandbox` 的 iframe 里。
 * - **令牌逐值镜像 `theme.css`**:两边声明过的键值必须一致(`design-style-demo.test.ts` 里
 *   有一条守着)。示例与规范漂开时的症状是"示例长这样、写进你设计的却是另一套",而那正是
 *   这张卡要回答的问题被答错。
 * - **改动只在这一个地方**:改这 4 套的令牌要连同示例一起改。
 *
 * 本文件不 import 任何东西。
 */

/** 暗色仪表盘:密集、克制,颜色只用来表达状态。 */
export const PRECISE_DARK_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Precise Dark — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
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

		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}

	*, *::before, *::after { box-sizing: border-box; }
	html, body { margin: 0; }
	body {
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 13px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	.num { font-variant-numeric: tabular-nums; }
	.muted { color: var(--color-muted); }
	.label { font-size: 11px; letter-spacing: 0.03em; text-transform: uppercase; color: var(--color-muted); }
	button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
	a { color: inherit; text-decoration: none; }

	.app { min-height: 100vh; display: flex; flex-direction: column; }

	/* 顶栏:一行 40px,颜色只用来表达状态 */
	.top {
		display: flex; align-items: center; gap: 12px;
		height: 40px; padding: 0 12px;
		border-bottom: 1px solid var(--color-border);
	}
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
	.brand .mark { width: 16px; height: 16px; border-radius: var(--radius-sm); background: var(--color-primary); }
	.crumb { color: var(--color-muted); }
	.grow { flex: 1; }
	.status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-muted); }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-muted); }
	.dot.live { background: var(--color-accent); }
	.btn-primary {
		background: var(--color-primary); color: var(--color-primary-foreground);
		border-radius: var(--radius-md); padding: 6px 12px; font-weight: 600;
	}
	.btn-ghost { color: var(--color-muted); padding: 6px 8px; }
	.btn-ghost:hover { color: var(--color-surface-foreground); }

	.body { flex: 1; display: flex; min-height: 0; }

	/* 侧栏:只有一条激活项 */
	.nav { width: 176px; flex: none; border-right: 1px solid var(--color-border); padding: 8px; }
	.nav-group { margin: 12px 0 4px; padding: 0 4px; }
	.nav-item {
		display: flex; align-items: center; gap: 8px; justify-content: space-between;
		height: 32px; padding: 0 8px; border-radius: var(--radius-md); color: var(--color-muted);
	}
	.nav-item:hover { background: var(--color-surface-raised); color: var(--color-surface-foreground); }
	.nav-item.active { background: var(--color-surface-raised); color: var(--color-surface-foreground); }
	.nav-item .count { font-size: 11px; }
	.nav-item.active .count { color: var(--color-accent); }

	.main { flex: 1; min-width: 0; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
	.head { display: flex; align-items: baseline; gap: 12px; }
	.head h1 { margin: 0; font-size: 16px; font-weight: 600; }
	.head .meta { font-size: 12px; color: var(--color-muted); }

	/* 统计:四个紧凑格子,数字等宽 */
	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
	.stat {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		padding: 10px 12px;
	}
	.stat .value { margin-top: 6px; font-size: 20px; font-weight: 600; }
	.stat .delta { font-size: 11px; }
	.up { color: var(--color-accent); }
	.down { color: var(--color-muted); }

	.panel {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}
	.panel-head {
		display: flex; align-items: center; gap: 8px;
		height: 36px; padding: 0 12px; border-bottom: 1px solid var(--color-border);
	}
	.panel-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
	.tabs { display: flex; gap: 4px; }
	.tab { padding: 4px 8px; border-radius: var(--radius-sm); font-size: 12px; color: var(--color-muted); }
	.tab.active { background: var(--color-surface); color: var(--color-surface-foreground); }

	table { width: 100%; border-collapse: collapse; }
	th {
		text-align: left; font-size: 11px; font-weight: 500; letter-spacing: 0.03em;
		text-transform: uppercase; color: var(--color-muted);
		padding: 8px 12px; border-bottom: 1px solid var(--color-border);
	}
	td { padding: 0 12px; height: 36px; border-bottom: 1px solid var(--color-border); }
	tr:last-child td { border-bottom: 0; }
	.svc { display: flex; align-items: center; gap: 8px; }
	.bar { height: 4px; border-radius: 2px; background: var(--color-primary); }
	.bar.warn { background: var(--color-accent); }
	.bar.off { background: var(--color-border); }
	.tag {
		display: inline-flex; align-items: center; gap: 4px;
		border: 1px solid var(--color-border); border-radius: var(--radius-sm);
		padding: 1px 6px; font-size: 11px; color: var(--color-muted);
	}
	.right { text-align: right; }

	.split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; }
	.events { display: flex; flex-direction: column; }
	.event { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
	.event:last-child { border-bottom: 0; }
	.event time { flex: none; width: 48px; color: var(--color-muted); }
	.event .what { min-width: 0; }

	.foot {
		display: flex; align-items: center; gap: 12px;
		height: 32px; padding: 0 12px; border-top: 1px solid var(--color-border);
		font-size: 11px; color: var(--color-muted);
	}

	@media (max-width: 860px) {
		.nav { display: none; }
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.split { grid-template-columns: minmax(0, 1fr); }
		.hide-narrow { display: none; }
	}
</style>
</head>
<body>
<div class="app">
	<header class="top">
		<span class="brand"><span class="mark"></span>Edge</span>
		<span class="crumb">gateway-eu-west</span>
		<span class="grow"></span>
		<span class="status"><span class="dot live"></span>deployed 4m ago</span>
		<button class="btn-ghost">Docs</button>
		<button class="btn-primary">Deploy</button>
	</header>

	<div class="body">
		<nav class="nav">
			<div class="nav-group label">Observe</div>
			<a class="nav-item active" href="#">Services <span class="count num">12</span></a>
			<a class="nav-item" href="#">Traces</a>
			<a class="nav-item" href="#">Logs</a>
			<div class="nav-group label">Configure</div>
			<a class="nav-item" href="#">Routes <span class="count num">38</span></a>
			<a class="nav-item" href="#">Policies</a>
			<a class="nav-item" href="#">Secrets</a>
		</nav>

		<main class="main">
			<div class="head">
				<h1>Services</h1>
				<span class="meta num">12 of 12 healthy</span>
			</div>

			<section class="stats">
				<div class="stat">
					<div class="label">Requests / min</div>
					<div class="value num">248.1k</div>
					<div class="delta up num">+4.2% vs 1h</div>
				</div>
				<div class="stat">
					<div class="label">p99 latency</div>
					<div class="value num">184 ms</div>
					<div class="delta up num">-11 ms</div>
				</div>
				<div class="stat">
					<div class="label">Error rate</div>
					<div class="value num">0.04%</div>
					<div class="delta down num">within budget</div>
				</div>
				<div class="stat">
					<div class="label">Saturation</div>
					<div class="value num">61%</div>
					<div class="delta down num">3 nodes idle</div>
				</div>
			</section>

			<div class="split">
				<section class="panel">
					<div class="panel-head">
						<h2>Routes</h2>
						<span class="grow"></span>
						<div class="tabs">
							<button class="tab active">All</button>
							<button class="tab">Degraded</button>
						</div>
					</div>
					<table>
						<thead>
							<tr>
								<th>Service</th>
								<th class="right">Req / min</th>
								<th class="right">p99</th>
								<th class="right hide-narrow">Errors</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td><span class="svc"><span class="dot live"></span><span class="num">api-gateway</span></span></td>
								<td class="right num">92.4k</td>
								<td class="right num">121 ms</td>
								<td class="right num hide-narrow">0.01%</td>
								<td class="right"><span class="bar" style="width: 72px"></span></td>
							</tr>
							<tr>
								<td><span class="svc"><span class="dot live"></span><span class="num">billing-worker</span></span></td>
								<td class="right num">8.1k</td>
								<td class="right num">96 ms</td>
								<td class="right num hide-narrow">0.00%</td>
								<td class="right"><span class="bar" style="width: 24px"></span></td>
							</tr>
							<tr>
								<td><span class="svc"><span class="dot" style="background: var(--color-accent)"></span><span class="num">search-index</span></span></td>
								<td class="right num">31.7k</td>
								<td class="right num">248 ms</td>
								<td class="right num hide-narrow">0.31%</td>
								<td class="right"><span class="bar warn" style="width: 48px"></span></td>
							</tr>
							<tr>
								<td><span class="svc"><span class="dot"></span><span class="num">image-resizer</span></span></td>
								<td class="right num">1.9k</td>
								<td class="right num">402 ms</td>
								<td class="right num hide-narrow">1.24%</td>
								<td class="right"><span class="bar off" style="width: 12px"></span></td>
							</tr>
							<tr>
								<td><span class="svc"><span class="dot live"></span><span class="num">auth</span></span></td>
								<td class="right num">64.5k</td>
								<td class="right num">88 ms</td>
								<td class="right num hide-narrow">0.00%</td>
								<td class="right"><span class="bar" style="width: 60px"></span></td>
							</tr>
						</tbody>
					</table>
				</section>

				<section class="panel">
					<div class="panel-head">
						<h2>Recent events</h2>
						<span class="grow"></span>
						<span class="tag">stream</span>
					</div>
					<div class="events">
						<div class="event">
							<time class="num">12:04</time>
							<div class="what">search-index scaled to <span class="num">6</span> replicas</div>
						</div>
						<div class="event">
							<time class="num">11:58</time>
							<div class="what">Cohort <span class="num">e4c1</span> rolled back to <span class="num">v41</span></div>
						</div>
						<div class="event">
							<time class="num">11:41</time>
							<div class="what">TLS certificate renewed for <span class="num">api.gateway</span></div>
						</div>
						<div class="event">
							<time class="num">11:30</time>
							<div class="what">Budget alert cleared: error rate <span class="num">&lt; 0.05%</span></div>
						</div>
					</div>
				</section>
			</div>
		</main>
	</div>

	<footer class="foot">
		<span class="num">build 8f31c9a</span>
		<span class="grow"></span>
		<span class="num">region eu-west-1</span>
	</footer>
</div>
</body>
</html>
`;

/** 明亮克制:留白承担层级,几乎不需要边框。 */
export const CALM_LIGHT_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calm Light — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
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

		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	html, body { margin: 0; }
	body {
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; line-height: 1.3; }
	p { margin: 0; }
	a { color: var(--color-accent); }
	button { font: inherit; cursor: pointer; }
	.muted { color: var(--color-muted); }

	/* 层级由间距与字重承担,不由边框 */
	.page { max-width: 1100px; margin: 0 auto; padding: 48px 32px 72px; }
	.top { display: flex; align-items: center; gap: 16px; margin-bottom: 48px; }
	.wordmark { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
	.top nav { display: flex; gap: 24px; margin-left: 16px; }
	.top nav a { color: var(--color-muted); text-decoration: none; font-size: 13px; }
	.top nav a:hover { color: var(--color-surface-foreground); }
	.grow { flex: 1; }

	.btn-primary {
		background: var(--color-primary); color: var(--color-primary-foreground);
		border: 0; border-radius: var(--radius-md); padding: 10px 18px; font-weight: 600;
	}
	.btn-secondary {
		background: var(--color-surface); color: var(--color-surface-foreground);
		border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 10px 18px; font-weight: 500;
	}
	.btn-text { background: none; border: 0; color: var(--color-muted); padding: 10px 4px; }

	.intro { max-width: 640px; }
	.intro h1 { font-size: 18px; font-weight: 600; }
	.intro p { margin-top: 8px; color: var(--color-muted); }

	section { margin-top: 48px; }
	section > h2 { font-size: 16px; font-weight: 600; }
	section > p.hint { margin-top: 6px; color: var(--color-muted); }

	/* 卡片:1px 边框、无阴影、24px 内边距 */
	.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 24px; }
	.card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		padding: 24px;
	}
	.card h3 { font-size: 15px; font-weight: 600; }
	.card > p { margin-top: 6px; color: var(--color-muted); font-size: 13px; }

	.field { margin-top: 24px; }
	.field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px; }
	.field input, .field select {
		width: 100%; height: 40px; padding: 0 12px;
		font: inherit; color: var(--color-surface-foreground);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.field input:focus, .field select:focus {
		outline: none; border-color: var(--color-primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
	}
	.field .help { margin-top: 6px; font-size: 12px; color: var(--color-muted); }

	.audit { margin-top: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-xl); overflow: hidden; }
	.row {
		display: flex; align-items: center; gap: 16px;
		padding: 16px 24px; border-bottom: 1px solid var(--color-border);
	}
	.row:last-child { border-bottom: 0; }
	.row .name { font-weight: 500; }
	.row .detail { color: var(--color-muted); font-size: 13px; }
	.badge {
		display: inline-block; padding: 2px 10px; border-radius: 999px;
		font-size: 12px; background: var(--color-surface-raised); color: var(--color-muted);
	}
	.badge.ok { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); }

	.usage { margin-top: 24px; max-width: 520px; }
	.usage .figures { display: flex; align-items: baseline; gap: 8px; }
	.usage .figures strong { font-size: 24px; font-weight: 600; }
	.track { margin-top: 12px; height: 6px; border-radius: 3px; background: var(--color-surface-raised); overflow: hidden; }
	.track > span { display: block; height: 100%; width: 62%; border-radius: 3px; background: var(--color-accent); }

	.actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; }

	@media (max-width: 760px) {
		.page { padding: 32px 20px 56px; }
		.top nav { display: none; }
		.cards { grid-template-columns: minmax(0, 1fr); }
	}
</style>
</head>
<body>
<div class="page">
	<header class="top">
		<span class="wordmark">Northwind</span>
		<nav>
			<a href="#">Overview</a>
			<a href="#">Members</a>
			<a href="#">Billing</a>
		</nav>
		<span class="grow"></span>
		<button class="btn-text">Help</button>
		<button class="btn-secondary">Sign out</button>
	</header>

	<div class="intro">
		<h1>Workspace settings</h1>
		<p>Everything here applies to the whole workspace. Changes take effect immediately for every member.</p>
	</div>

	<section>
		<h2>Plan and usage</h2>
		<p class="hint">Your plan renews on 12 September.</p>
		<div class="usage">
			<div class="figures">
				<strong>62</strong>
				<span class="muted">of 100 seats in use</span>
			</div>
			<div class="track"><span></span></div>
		</div>
		<div class="actions">
			<button class="btn-primary">Manage plan</button>
			<button class="btn-text">Compare plans</button>
		</div>
	</section>

	<section>
		<h2>General</h2>
		<p class="hint">The name and locale members see across receipts and notifications.</p>
		<div class="cards">
			<div class="card">
				<h3>Identity</h3>
				<p>Used on invitations, invoices and the sign-in screen.</p>
				<div class="field">
					<label for="ws-name">Workspace name</label>
					<input id="ws-name" value="Northwind Studio">
				</div>
				<div class="field">
					<label for="ws-locale">Locale</label>
					<select id="ws-locale">
						<option>English (United Kingdom)</option>
						<option>English (United States)</option>
						<option>Deutsch</option>
					</select>
					<p class="help">Affects dates and number formatting only.</p>
				</div>
			</div>
			<div class="card">
				<h3>Retention</h3>
				<p>How long finished work stays searchable before it is archived.</p>
				<div class="field">
					<label for="ws-retention">Keep inactive projects for</label>
					<select id="ws-retention">
						<option>12 months</option>
						<option>24 months</option>
						<option>Forever</option>
					</select>
					<p class="help">Archived projects can be restored within 30 days.</p>
				</div>
			</div>
		</div>
	</section>

	<section>
		<h2>Members</h2>
		<p class="hint">Sign-in is managed by your identity provider.</p>
		<div class="audit">
			<div class="row">
				<span class="name">Amara Osei</span>
				<span class="detail">amara@northwind.example</span>
				<span class="grow"></span>
				<span class="badge ok">Active</span>
			</div>
			<div class="row">
				<span class="name">Jonas Weber</span>
				<span class="detail">jonas@northwind.example</span>
				<span class="grow"></span>
				<span class="badge ok">Active</span>
			</div>
			<div class="row">
				<span class="name">Priya Raman</span>
				<span class="detail">Invitation sent 3 days ago</span>
				<span class="grow"></span>
				<span class="badge">Invited</span>
			</div>
		</div>
		<div class="actions">
			<button class="btn-secondary">Invite member</button>
		</div>
	</section>
</div>
</body>
</html>
`;

/** 编辑排版:长文优先,宽行距、细横线、近直角。 */
export const EDITORIAL_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Editorial — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
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

		--serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", Georgia, serif;
		--sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	html, body { margin: 0; }
	body {
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--serif);
		font-size: 18px;
		line-height: 1.7;
		-webkit-font-smoothing: antialiased;
	}
	.label { font-family: var(--sans); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); }
	.meta { font-family: var(--sans); font-size: 12px; color: var(--color-muted); }
	a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
	a.footnote { color: var(--color-accent); text-decoration: none; font-size: 0.72em; vertical-align: super; }
	button { font: inherit; cursor: pointer; }

	.wrap { max-width: 720px; margin: 0 auto; padding: 56px 24px 96px; }

	/* 报头:一条通栏横线,三个元素 */
	.masthead { display: flex; align-items: baseline; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); }
	.masthead .wordmark { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
	.grow { flex: 1; }
	.btn-quiet {
		font-family: var(--sans); font-size: 13px;
		background: none; border: 1px solid var(--color-border);
		border-radius: var(--radius-sm); padding: 5px 12px;
	}
	.btn-filled {
		font-family: var(--sans); font-size: 13px;
		background: var(--color-primary); color: var(--color-primary-foreground);
		border: 0; border-radius: var(--radius-sm); padding: 6px 14px;
	}

	article { margin-top: 40px; }
	.eyebrow { margin-bottom: 12px; }
	h1 { margin: 0; font-size: 38px; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; }
	.standfirst { margin-top: 16px; font-size: 20px; line-height: 1.6; color: var(--color-muted); }
	.byline { margin-top: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }

	p { margin: 32px 0 0; }
	p.first { margin-top: 24px; }
	p.first::first-letter { font-size: 3.1em; line-height: 0.9; float: left; padding: 6px 10px 0 0; }
	h2 { margin: 64px 0 0; font-size: 24px; font-weight: 600; }
	h2 + p { margin-top: 16px; }

	blockquote {
		margin: 32px 0 0; padding: 0 0 0 20px;
		border-left: 1px solid var(--color-accent);
		font-size: 21px; line-height: 1.55; color: var(--color-primary);
	}

	table { width: 100%; border-collapse: collapse; margin-top: 32px; font-family: var(--sans); font-size: 14px; }
	caption { text-align: left; margin-bottom: 12px; font-family: var(--sans); font-size: 12px; color: var(--color-muted); }
	th, td { text-align: left; padding: 10px 12px 10px 0; border-bottom: 1px solid var(--color-border); }
	th { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); font-weight: 500; }
	td.num { font-variant-numeric: tabular-nums; }

	/* 旁注与脚注移到正文下方,不并排 */
	.aside { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--color-border); font-family: var(--sans); font-size: 13px; color: var(--color-muted); }
	.aside h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); font-weight: 500; }
	.toc { list-style: none; margin: 0; padding: 0; }
	.toc li { padding: 6px 0; border-bottom: 1px solid var(--color-border); }
	.toc li:last-child { border-bottom: 0; }
	.toc a { text-decoration: none; color: var(--color-surface-foreground); }
	.toc a.active { color: var(--color-accent); }

	.footnotes { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--color-border); font-family: var(--sans); font-size: 13px; color: var(--color-muted); }
	.footnotes ol { margin: 0; padding-left: 20px; }
	.footnotes li { margin-top: 8px; }

	@media (max-width: 620px) {
		body { font-size: 17px; }
		.wrap { padding: 32px 18px 64px; }
		h1 { font-size: 30px; }
		.masthead nav { display: none; }
	}
</style>
</head>
<body>
<div class="wrap">
	<header class="masthead">
		<span class="wordmark">The Quarterly</span>
		<nav class="meta"><a href="#">Archive</a> · <a href="#">Essays</a></nav>
		<span class="grow"></span>
		<button class="btn-quiet">Subscribe</button>
	</header>

	<article>
		<p class="eyebrow label">Essay · Infrastructure</p>
		<h1>The quiet cost of a standing machine</h1>
		<p class="standfirst">A development server that nobody remembers starting is still a server. It is still patched, still billed, and still the reason nobody can explain the staging environment.</p>
		<p class="byline meta">By Amara Osei · 12 September · 9 minute read</p>

		<p class="first">Every engineering organisation eventually buys the same thing twice: once as a service, and once as a machine that someone started in an afternoon and never turned off. The second purchase is invisible on the roadmap and permanent on the invoice.</p>

		<p>The reason is not laziness. A standing server is the cheapest way to answer a question that has no owner. Which version is staging on? That is a machine. Why does the nightly job take forty minutes? That is a machine. Each answer costs a few dollars a month, which is below the threshold where anyone is asked to justify it.<a class="footnote" href="#fn1">1</a></p>

		<h2>What we measured</h2>
		<p>We took an inventory of every long-running process in one organisation, across three environments, for a quarter. Then we asked two questions of each: who would notice if it stopped, and what would break.</p>

		<table>
			<caption>Standing capacity by environment, one quarter</caption>
			<thead>
				<tr>
					<th>Environment</th>
					<th>Processes</th>
					<th>Monthly cost</th>
					<th>Owned by a team</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>Production</td>
					<td class="num">41</td>
					<td class="num">£3,120</td>
					<td class="num">41</td>
				</tr>
				<tr>
					<td>Staging</td>
					<td class="num">63</td>
					<td class="num">£1,480</td>
					<td class="num">12</td>
				</tr>
				<tr>
					<td>Developer sandboxes</td>
					<td class="num">218</td>
					<td class="num">£2,640</td>
					<td class="num">4</td>
				</tr>
			</tbody>
		</table>

		<p>The pattern is not that staging is expensive. It is that staging is <em>unowned</em>: two-thirds of it belongs to nobody, which is precisely why it cannot be turned off.</p>

		<blockquote>An environment that nobody owns is not a staging environment. It is an archive with a DNS record.</blockquote>

		<h2>What actually helped</h2>
		<p>Not a policy. A page. Once the inventory was published — with the owner column, and the cost column — the number of standing processes fell by a third without anyone being asked to change a habit.</p>
		<p>Discovery is the whole mechanism. The rest is bookkeeping.</p>

		<div class="aside">
			<h3>In this essay</h3>
			<ol class="toc">
				<li><a href="#">Why a server outlives its decision</a></li>
				<li><a class="active" href="#">What we measured</a></li>
				<li><a href="#">What actually helped</a></li>
				<li><a href="#">Notes</a></li>
			</ol>
		</div>

		<div class="footnotes">
			<ol>
				<li id="fn1">Below the threshold, the cost of asking is higher than the cost of the machine — which is the whole reason it survives.</li>
			</ol>
		</div>
	</article>
</div>
</body>
</html>
`;

/** 圆角活泼:柔和圆角与暖色,布局比需要的更宽松。 */
export const PLAYFUL_DEMO = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Playful — component reference</title>
<style>
	/* Mirrors theme.css. Plain custom properties so this file opens standalone. */
	:root {
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

		--sans: "Nunito", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	}

	*, *::before, *::after { box-sizing: border-box; }
	html, body { margin: 0; }
	body {
		background: var(--color-surface);
		color: var(--color-surface-foreground);
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}
	h1, h2, h3 { margin: 0; line-height: 1.2; }
	p { margin: 0; }
	a { color: inherit; text-decoration: none; }
	button { font: inherit; cursor: pointer; }
	.muted { color: var(--color-muted); }

	.page { max-width: 1040px; margin: 0 auto; padding: 28px 24px 72px; }

	.top { display: flex; align-items: center; gap: 12px; }
	.logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; }
	.logo .dot { width: 22px; height: 22px; border-radius: 40%; background: var(--color-primary); }
	.grow { flex: 1; }
	.pill {
		border: 0; border-radius: 999px; padding: 10px 20px; font-weight: 700;
	}
	.pill.primary { background: var(--color-primary); color: var(--color-primary-foreground); }
	.pill.ghost { background: var(--color-surface-raised); color: var(--color-surface-foreground); box-shadow: 0 2px 10px rgb(124 58 237 / 0.10); }
	.pill.small { padding: 8px 16px; font-size: 14px; }

	.hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; align-items: center; margin-top: 40px; }
	.hero .tag {
		display: inline-block; background: var(--color-surface-raised); color: var(--color-primary);
		border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 700;
		box-shadow: 0 2px 10px rgb(124 58 237 / 0.10);
	}
	.hero h1 { margin-top: 16px; font-size: 42px; font-weight: 800; letter-spacing: -0.01em; }
	.hero p { margin-top: 14px; color: var(--color-muted); font-size: 17px; }
	.hero .cta { display: flex; align-items: center; gap: 12px; margin-top: 24px; }

	.art {
		background: var(--color-surface-raised);
		border-radius: var(--radius-xl);
		padding: 20px;
		box-shadow: 0 18px 40px rgb(124 58 237 / 0.14);
	}
	.art .ring { display: flex; align-items: center; gap: 16px; }
	.art .badge {
		width: 84px; height: 84px; border-radius: 50%;
		background: var(--color-surface);
		border: 8px solid var(--color-accent);
		display: grid; place-items: center;
		font-size: 22px; font-weight: 800;
	}
	.art .bars { flex: 1; display: flex; flex-direction: column; gap: 10px; }
	.art .bar { height: 12px; border-radius: 999px; background: var(--color-border); }
	.art .bar.half { width: 60%; background: var(--color-primary); }
	.art .bar.most { width: 84%; background: var(--color-accent); }

	.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 32px; }
	.stat {
		background: var(--color-surface-raised); border-radius: var(--radius-xl);
		padding: 20px; box-shadow: 0 8px 24px rgb(124 58 237 / 0.10);
	}
	.stat .big { font-size: 26px; font-weight: 800; }
	.stat .cap { font-size: 13px; color: var(--color-muted); }

	section { margin-top: 56px; }
	.section-head { display: flex; align-items: baseline; gap: 12px; }
	.section-head h2 { font-size: 24px; font-weight: 800; }
	.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 20px; }
	.card {
		background: var(--color-surface-raised); border-radius: var(--radius-xl);
		padding: 20px; box-shadow: 0 8px 24px rgb(124 58 237 / 0.10);
	}
	.card .icon { width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--color-border); display: grid; place-items: center; }
	.card .icon.ink { color: var(--color-primary); }
	.card .icon.pop { color: var(--color-accent); }
	.card .icon svg { stroke: currentColor; }

	/* 插画也走令牌,不写死颜色:一处改了令牌,整页跟着走。 */
	.empty .ground { fill: var(--color-border); }
	.empty .stem { stroke: var(--color-primary); stroke-width: 4; stroke-linecap: round; }
	.empty .leaf-a { fill: var(--color-accent); }
	.empty .leaf-b { fill: color-mix(in srgb, var(--color-primary) 45%, var(--color-surface-raised)); }
	.empty .bud { fill: var(--color-primary); }
	.empty .spark { fill: var(--color-border); }
	.card h3 { margin-top: 14px; font-size: 17px; font-weight: 700; }
	.card p { margin-top: 8px; font-size: 15px; color: var(--color-muted); }

	.empty {
		margin-top: 20px; background: var(--color-surface-raised);
		border-radius: var(--radius-xl); padding: 32px;
		box-shadow: 0 8px 24px rgb(124 58 237 / 0.10);
		display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 24px; align-items: center;
	}
	.empty h3 { font-size: 20px; font-weight: 800; }
	.empty p { margin-top: 8px; color: var(--color-muted); }
	.empty .action { margin-top: 16px; }

	footer { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--color-border); display: flex; align-items: center; gap: 16px; font-size: 14px; color: var(--color-muted); }

	@media (max-width: 820px) {
		.hero { grid-template-columns: minmax(0, 1fr); gap: 24px; }
		.hero h1 { font-size: 32px; }
		.stats, .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.empty { grid-template-columns: minmax(0, 1fr); text-align: center; justify-items: center; }
		.top nav { display: none; }
	}
	@media (max-width: 560px) {
		.stats, .cards { grid-template-columns: minmax(0, 1fr); }
	}
</style>
</head>
<body>
<div class="page">
	<header class="top">
		<span class="logo"><span class="dot"></span>Sprout</span>
		<span class="grow"></span>
		<nav class="muted" style="display: flex; gap: 20px"><a href="#">Today</a><a href="#">Garden</a><a href="#">Friends</a></nav>
		<button class="pill primary small">Start free</button>
	</header>

	<section class="hero">
		<div>
			<span class="tag">12 minutes a day</span>
			<h1>Small habits, planted properly.</h1>
			<p>Sprout turns the things you keep meaning to do into a garden you can actually see. One seed a day, no guilt, no streak anxiety.</p>
			<div class="cta">
				<button class="pill primary">Plant your first seed</button>
				<button class="pill ghost">Take the tour</button>
			</div>
		</div>
		<div class="art">
			<div class="ring">
				<div class="badge">6/7</div>
				<div class="bars">
					<span class="bar most"></span>
					<span class="bar half"></span>
					<span class="bar"></span>
				</div>
			</div>
			<div class="stats" style="margin-top: 20px; grid-template-columns: repeat(2, minmax(0, 1fr))">
				<div class="stat" style="box-shadow: none; padding: 0">
					<div class="big">34</div>
					<div class="cap">seeds planted</div>
				</div>
				<div class="stat" style="box-shadow: none; padding: 0">
					<div class="big">11</div>
					<div class="cap">weeks growing</div>
				</div>
			</div>
		</div>
	</section>

	<section>
		<div class="section-head">
			<h2>How it grows</h2>
			<span class="muted">three gentle rules</span>
		</div>
		<div class="cards">
			<div class="card">
				<div class="icon ink" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round">
						<path d="M12 20V9" />
						<path d="M12 12c0-3 2.4-5 6-5 0 3.4-2.4 5-6 5z" />
						<path d="M12 15c0-2.6-2-4.4-5.2-4.4 0 3 2 4.4 5.2 4.4z" />
					</svg>
				</div>
				<h3>One seed a day</h3>
				<p>Pick a habit and give it a size you can keep on a bad day. Ten minutes counts as done.</p>
			</div>
			<div class="card">
				<div class="icon pop" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round">
						<circle cx="12" cy="12" r="8" />
						<path d="M12 8v4.5l3 2" />
					</svg>
				</div>
				<h3>Miss a day, keep the plant</h3>
				<p>Streaks pause instead of breaking. Come back tomorrow and the soil is still yours.</p>
			</div>
			<div class="card">
				<div class="icon ink" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round">
						<path d="M7 20v-2a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v2" />
						<circle cx="12" cy="7" r="3.2" />
					</svg>
				</div>
				<h3>Grow with a friend</h3>
				<p>Share one plant with someone. You will both see it flower, and neither of you has to post anything.</p>
			</div>
		</div>
	</section>

	<section>
		<div class="section-head"><h2>Your garden today</h2></div>
		<div class="empty">
			<svg width="140" height="120" viewBox="0 0 140 120" fill="none" aria-hidden="true">
				<ellipse class="ground" cx="70" cy="104" rx="46" ry="8" />
				<path class="stem" d="M70 104V58" />
				<path class="leaf-a" d="M70 74c-14 0-24-9-24-22 15 0 24 9 24 22z" />
				<path class="leaf-b" d="M70 62c14 0 24-9 24-22-15 0-24 9-24 22z" />
				<circle class="bud" cx="70" cy="40" r="9" />
				<circle class="spark" cx="40" cy="30" r="4" />
				<circle class="spark" cx="104" cy="24" r="5" />
			</svg>
			<div>
				<h3>Nothing planted yet</h3>
				<p>Your first seed can be anything: reading four pages, stretching, or calling your sister on Sundays. Start tiny and let it grow.</p>
				<div class="action"><button class="pill primary">Choose a seed</button></div>
			</div>
		</div>
	</section>

	<footer>
		<span>Sprout</span>
		<span class="grow"></span>
		<span>Made for slow progress</span>
	</footer>
</div>
</body>
</html>
`;
