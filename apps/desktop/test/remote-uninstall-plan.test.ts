import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CADDY_BLOCK_AWK, remoteUninstallPlan } from "../src/main/remote/uninstall-plan.ts";

/**
 * 撤下来(停用 / 卸载)。
 *
 * 这里钉住的是**别删错东西**:卸载是删东西的动作,而服务器上有别人的站点、别人的证书。
 * 所以两条主线:
 * 1. **只删探到的** —— 没探到就不出现在计划里(不照着脚本盲删一遍);
 * 2. **Caddyfile 只摘我们那四行** —— 形状不对就一行都不动(下面用真的 `awk` 跑一遍)。
 */

const plan = (overrides: Partial<Parameters<typeof remoteUninstallPlan>[0]> = {}) =>
	remoteUninstallPlan({ scope: "remove", ...overrides });

const all = {
	deployDirExists: true,
	serviceExists: true,
	serviceActive: true,
	nginxSiteExists: true,
	caddyBlockExists: true,
};

/**
 * 真跑一次那段 awk。
 *
 * 这一段 shell/awk 是「别人的站点不会被误删」这条保证的**全部**实现 —— 所以它不能只被"看着像对",
 * 得拿真的 `awk` 和真的 Caddyfile 跑一遍(下面那几个"形状被改过"的用例就是这么抓出来的)。
 */
const runAwk = (content: string): { output: string; status: number } => {
	const file = join(mkdtempSync(join(tmpdir(), "wordless-caddy-")), "Caddyfile");
	writeFileSync(file, content);
	const result = spawnSync("awk", [CADDY_BLOCK_AWK, file], { encoding: "utf8" });
	return { output: result.stdout, status: result.status ?? 0 };
};

const OUR_BLOCK = ["# wordless-relay", "relay.example.com {", "\treverse_proxy 127.0.0.1:8787", "}"].join("\n");

const NGINX_CONF = ["server {", "\tlisten 80;", "\tserver_name relay.example.com;", "\tlocation / {", "\t\tproxy_pass http://127.0.0.1:8787;", "\t}", "}"].join("\n");

/**
 * 把 nginx 那一步**真的跑一遍**(逻辑照原样,只是把 `/etc/nginx` 指到沙箱里)。
 *
 * nginx 那条路上,"卸载完整吗"这个问题只能这么回答:证书、续期配置、别人文件里同名站点
 * 都不在我们删掉的那份文件里 —— 所以那一段脚本的收尾是**把它们说出来**。
 * 这里用一个假的 `sudo`(原样执行)+ 一份真的 nginx 配置树来验:该删的删了、别人的一行没动、
 * 该说出来的都说了。
 */
const runNginxStep = (command: string): { output: string; status: number; root: string } => {
	const root = mkdtempSync(join(tmpdir(), "wordless-nginx-"));
	const nginxDir = join(root, "etc/nginx/conf.d");
	mkdirSync(nginxDir, { recursive: true });
	mkdirSync(join(root, "bin"), { recursive: true });
	// 假 sudo:沙箱里不需要提权,原样执行就好(这样脚本的**逻辑**一行都没变)。
	writeFileSync(join(root, "bin/sudo"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
	writeFileSync(join(nginxDir, "wordless-relay.conf"), NGINX_CONF);
	const script = command.replaceAll("/etc/nginx", join(root, "etc/nginx"));
	const result = spawnSync("bash", ["-c", script], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
	});
	return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0, root };
};

describe("卸载计划", () => {
	it("探测到的东西**都删**,顺序是:先停服务 → 删单元 → 删目录 → 删反代 → 自检", () => {
		const result = plan({ facts: all });
		assert.deepEqual(
			result.steps.map((step) => step.id),
			["StopService", "RemoveUnit", "RemoveDir", "RemoveNginxSite", "RemoveCaddyBlock", "VerifyRemoved"],
		);
		assert.equal(result.nothingToDo, false);
	});

	it("没探到的一律**不出现**在计划里(卸载不能照着脚本盲删一遍)", () => {
		const result = plan({ facts: { deployDirExists: true } });
		assert.deepEqual(
			result.steps.map((step) => step.id),
			["RemoveDir", "VerifyRemoved"],
		);
		// 跳过的那几项要说明,不能悄悄消失。
		assert.deepEqual(
			result.skipped.map((entry) => entry.id),
			["StopService", "RemoveUnit", "RemoveNginxSite", "RemoveCaddyBlock"],
		);
	});

	it("什么都没探到:没有步骤、也没有警告(界面据此说清「不用卸」)", () => {
		const result = plan({ facts: {} });
		assert.equal(result.nothingToDo, true);
		assert.deepEqual(result.steps, []);
	});

	it("**先停再删**:服务还在跑的时候删掉它的代码,它只会一直重启失败", () => {
		const result = plan({ facts: all });
		const stop = result.steps.find((step) => step.id === "StopService");
		assert.match(stop?.command ?? "", /systemctl disable --now wordless-relay/);
		assert.ok(
			result.steps.findIndex((step) => step.id === "StopService") <
				result.steps.findIndex((step) => step.id === "RemoveDir"),
		);
	});

	it("删目录之前先 `ls` 一遍:日志里留下「当时里面有什么」的证据", () => {
		const remove = plan({ facts: all }).steps.find((step) => step.id === "RemoveDir");
		assert.match(remove?.command ?? "", /sudo ls -la \/opt\/wordless-relay/);
		assert.match(remove?.command ?? "", /sudo rm -rf \/opt\/wordless-relay/);
	});

	it("nginx 那一份是**我们写的整份文件**,可以整份删;而它没在跑时只删不重启", () => {
		const step = plan({ facts: all }).steps.find((entry) => entry.id === "RemoveNginxSite");
		assert.match(step?.command ?? "", /sudo rm -f \/etc\/nginx\/conf\.d\/wordless-relay\.conf/);
		assert.match(step?.command ?? "", /sudo nginx -t/);
		// 没装/没跑 nginx 时不替它做主重启(所以 reload 失败只是**说一句**)。
		assert.match(step?.command ?? "", /systemctl reload nginx 2>\/dev\/null \|\| echo/);
	});

	it("自检的**每一行都一定打印**(静默的检查等于没检查)", () => {
		const step = plan({ facts: all, relayPort: 9001 }).steps.find((entry) => entry.id === "VerifyRemoved");
		const lines = (step?.command ?? "").split("\n");
		// 服务单元、目录、nginx 那一份、Caddyfile 那一段、端口 —— 探到几样就查几样。
		assert.equal(lines.length, 5);
		for (const line of lines) assert.match(line, /\|\| echo /, "每一行都要有「没做到」的说法");
		// 端口按调用方给的看:中继换过端口时不该去测默认那个。
		assert.match(step?.command ?? "", /dev\/tcp\/127\.0\.0\.1\/9001/);
	});

	it("中继端口非法就退回默认(计划里的端口必须真的能用)", () => {
		const step = plan({ facts: all, relayPort: 0 }).steps.find((entry) => entry.id === "VerifyRemoved");
		assert.match(step?.command ?? "", /dev\/tcp\/127\.0\.0\.1\/8787/);
	});

	it("警告说清**我们不动什么**:证书、软件包、以及这台电脑上的地址", () => {
		const result = plan({ facts: all });
		assert.deepEqual(
			result.warnings.map((warning) => warning.key),
			["remoteWarnUninstallCerts", "remoteWarnUninstallCertbot", "remoteWarnUninstallCaddy", "remoteWarnUninstallAddress"],
		);
		// 只有 nginx 站点、没有 Caddy 那一段时:不提 Caddy,改提 certbot(那是 nginx 路线上装的)。
		assert.deepEqual(
			plan({ facts: { deployDirExists: true, nginxSiteExists: true } }).warnings.map((warning) => warning.key),
			["remoteWarnUninstallCerts", "remoteWarnUninstallCertbot", "remoteWarnUninstallAddress"],
		);
		// 两者都没有(只有目录):软件包那两条都不该出现(不说与用户无关的话)。
		assert.deepEqual(
			plan({ facts: { deployDirExists: true } }).warnings.map((warning) => warning.key),
			["remoteWarnUninstallAddress"],
		);
	});

	it("停用:只停,不删(文件与配置都留着)", () => {
		const result = remoteUninstallPlan({ scope: "stop", facts: all });
		assert.deepEqual(
			result.steps.map((step) => step.id),
			["StopService", "VerifyStopped"],
		);
		assert.equal(result.nothingToDo, false);
		// 反代还在、后面没人应答 —— 会是 502,不是连不上,得让用户对得上号。
		assert.deepEqual(result.warnings.map((warning) => warning.key), ["remoteWarnStopProxy"]);
	});

	it("停用:服务不在时什么都不做(而不是跑一条必然报错的命令)", () => {
		const result = remoteUninstallPlan({ scope: "stop", facts: { deployDirExists: true } });
		assert.equal(result.nothingToDo, true);
		assert.deepEqual(result.steps, []);
	});

	it("停用的自检也要**一定打印**(停没停、文件在不在)", () => {
		const step = remoteUninstallPlan({ scope: "stop", facts: all }).steps.find((entry) => entry.id === "VerifyStopped");
		for (const line of (step?.command ?? "").split("\n")) assert.match(line, /\|\| echo /);
	});
});

describe("nginx 那条路:卸载完整吗", () => {
	it("整份配置删掉(certbot 加的证书行也在这份文件里),并把**不在文件里**的三样说出来", () => {
		const step = plan({ facts: { nginxSiteExists: true } }).steps.find((entry) => entry.id === "RemoveNginxSite");
		const { output, status, root } = runNginxStep(step?.command ?? "");
		assert.equal(status, 0);
		// 该删的删了。
		assert.throws(() => readFileSync(join(root, "etc/nginx/conf.d/wordless-relay.conf")), /ENOENT/);
		// 证书与续期配置不在那份文件里:位置要说出来,而且要给出**具体**的命令(域名是从配置里读出来的)。
		assert.match(output, /\/etc\/letsencrypt\/live\/relay\.example\.com/);
		assert.match(output, /certbot delete --cert-name relay\.example\.com/);
	});

	it("别人文件里也写着同一个域名:**一行都不动**,但要说出来", () => {
		const step = plan({ facts: { nginxSiteExists: true } }).steps.find((entry) => entry.id === "RemoveNginxSite");
		const root = mkdtempSync(join(tmpdir(), "wordless-nginx-others-"));
		const nginxDir = join(root, "etc/nginx/conf.d");
		mkdirSync(nginxDir, { recursive: true });
		mkdirSync(join(root, "bin"), { recursive: true });
		writeFileSync(join(root, "bin/sudo"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
		writeFileSync(join(nginxDir, "wordless-relay.conf"), NGINX_CONF);
		// 用户原来就有的站点(同一个域名)—— 我们不认识它,所以只报不动。
		const theirs = ["server {", "\tlisten 8080;", "\tserver_name relay.example.com;", "}"].join("\n");
		writeFileSync(join(nginxDir, "theirs.conf"), theirs);
		writeFileSync(join(nginxDir, "other.conf"), ["server {", "\tserver_name blog.example.com;", "}"].join("\n"));
		const script = (step?.command ?? "").replaceAll("/etc/nginx", join(root, "etc/nginx"));
		const result = spawnSync("bash", ["-c", script], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
		});
		const output = `${result.stdout}${result.stderr}`;
		assert.match(output, /theirs\.conf/, "要说出来:还有个文件写着同一个域名");
		assert.equal(output.includes("other.conf"), false, "别的域名不必提(那是噪音)");
		assert.equal(readFileSync(join(nginxDir, "theirs.conf"), "utf8"), theirs, "别人的配置**一行都不能动**");
	});

	it("读不出域名时:说清没去别处找(而不是拿一个空模式把每个站点都列出来)", () => {
		const step = plan({ facts: { nginxSiteExists: true } }).steps.find((entry) => entry.id === "RemoveNginxSite");
		const root = mkdtempSync(join(tmpdir(), "wordless-nginx-nodomain-"));
		const nginxDir = join(root, "etc/nginx/conf.d");
		mkdirSync(nginxDir, { recursive: true });
		mkdirSync(join(root, "bin"), { recursive: true });
		writeFileSync(join(root, "bin/sudo"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
		// 没有 `server_name` 那一行(被人手工改过)。
		writeFileSync(join(nginxDir, "wordless-relay.conf"), ["server {", "\tlisten 80;", "}"].join("\n"));
		writeFileSync(join(nginxDir, "blog.conf"), ["server {", "\tserver_name blog.example.com;", "}"].join("\n"));
		const script = (step?.command ?? "").replaceAll("/etc/nginx", join(root, "etc/nginx"));
		const result = spawnSync("bash", ["-c", script], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
		});
		const output = `${result.stdout}${result.stderr}`;
		assert.match(output, /没能从配置里读出域名/);
		assert.equal(output.includes("blog.conf"), false, "空模式会把每个站点都列出来 —— 不能那样");
	});

	it("自检里也要有 nginx 那一份:删没删干净由**那一行**说", () => {
		const step = plan({ facts: { nginxSiteExists: true } }).steps.find((entry) => entry.id === "VerifyRemoved");
		assert.match(step?.command ?? "", /\[ -f \/etc\/nginx\/conf\.d\/wordless-relay\.conf \] && echo "注意:nginx 站点文件还在" \|\| echo "nginx 站点文件已删除"/);
		// 没探到 nginx 那一份时不必提它(不说与用户无关的话)。
		const withoutNginx = plan({ facts: { deployDirExists: true } }).steps.find((entry) => entry.id === "VerifyRemoved");
		assert.equal((withoutNginx?.command ?? "").includes("nginx"), false);
	});

	it("软件包:nginx 路线要说 certbot(那是我们装的),Caddy 路线说 Caddy", () => {
		assert.deepEqual(
			plan({ facts: { nginxSiteExists: true } }).warnings.map((warning) => warning.key),
			["remoteWarnUninstallCerts", "remoteWarnUninstallCertbot", "remoteWarnUninstallAddress"],
		);
		assert.deepEqual(
			plan({ facts: { caddyBlockExists: true } }).warnings.map((warning) => warning.key),
			["remoteWarnUninstallCerts", "remoteWarnUninstallCaddy", "remoteWarnUninstallAddress"],
		);
	});

	it("每一步都是**语法正确的 shell**(长脚本里最容易写坏引号)", () => {
		for (const scope of ["stop", "remove"] as const) {
			for (const step of remoteUninstallPlan({ scope, facts: all }).steps) {
				const result = spawnSync("bash", ["-n", "-c", step.command], { encoding: "utf8" });
				assert.equal(result.status, 0, `${step.id} 的语法错了:${result.stderr}`);
			}
		}
	});
});

describe("Caddyfile 只摘我们那一段", () => {
	it("默认配置 + 我们那一段:摘掉之后**别人的一行不动**", () => {
		const original = [":80 {", "\troot * /usr/share/caddy", "\tfile_server", "}", "", OUR_BLOCK, ""].join("\n");
		const { output, status } = runAwk(original);
		assert.equal(status, 0);
		assert.equal(output.includes("wordless-relay"), false);
		assert.match(output, /root \* \/usr\/share\/caddy/);
		assert.match(output, /file_server/);
	});

	it("我们的块在**别的站点前面**:摘掉之后那个站点还是完整的", () => {
		const original = [OUR_BLOCK, "", "# 别人的站", "blog.example.com {", "\troot * /srv/blog", "\tfile_server", "}", ""].join(
			"\n",
		);
		const { output, status } = runAwk(original);
		assert.equal(status, 0);
		assert.equal(output.includes("wordless-relay"), false);
		assert.match(output, /blog\.example\.com \{/);
		assert.match(output, /root \* \/srv\/blog/);
	});

	it("形状被手工改过:**一行都不动**(宁可留着我们的块,也不能碰别人的站点)", () => {
		// 真实抓到的那个写法:`从标记行删到下一个 }` 在块少了收尾那行时,会一路吞到下一个站点的 `}`。
		const drifted = [
			"# wordless-relay",
			"relay.example.com {",
			"\treverse_proxy 127.0.0.1:8787",
			"\tencode gzip",
			"}",
			"",
			"blog.example.com {",
			"\troot * /srv/blog",
			"}",
			"",
		].join("\n");
		const { output, status } = runAwk(drifted);
		assert.equal(status, 4, "认不出形状 = 报给调用方(它据此什么都不做)");
		assert.equal(output, drifted, "原样输出");
	});

	it("块少了收尾那行:也**一行都不动**(不能把别人的站点吞掉)", () => {
		const broken = ["# wordless-relay", "relay.example.com {", "\treverse_proxy 127.0.0.1:8787", "", "blog.example.com {", "\troot * /srv/blog", "}", ""].join("\n");
		const { output, status } = runAwk(broken);
		assert.equal(status, 4);
		assert.equal(output, broken);
	});

	it("没有我们那一段:原样输出(调用方据此当成「已经删过了」)", () => {
		const plain = ["blog.example.com {", "\troot * /srv/blog", "}", ""].join("\n");
		const { output, status } = runAwk(plain);
		assert.equal(status, 4);
		assert.equal(output, plain);
	});

	it("两段都在时:**两段都摘掉**(部署过两次的机器)", () => {
		const twice = [OUR_BLOCK, "", OUR_BLOCK, ""].join("\n");
		const { output, status } = runAwk(twice);
		assert.equal(status, 0);
		assert.equal(output.includes("wordless-relay"), false);
	});
});
