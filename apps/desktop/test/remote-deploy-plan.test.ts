import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEPLOY_RELAY_PORT, DEPLOY_REQUIREMENTS, remoteDeployPlan } from "../src/main/remote/deploy-plan.ts";

/**
 * 部署步骤。
 *
 * 这里钉住的是"照抄能不能跑通":命令里**不许留占位符**、端口与路径必须前后一致、
 * 有没有 TLS 决定最后填 `ws://` 还是 `wss://`。
 * 自动部署(P3)会跑同一份 —— 所以这一份错了,两条路一起错。
 */

const plan = (overrides: Partial<Parameters<typeof remoteDeployPlan>[0]> = {}) =>
	remoteDeployPlan({
		server: "1.2.3.4",
		user: "ubuntu",
		// 教程档的来源:用户找得到的部署包目录。
		upload: { relayPath: "/Users/me/Downloads/wordless-deploy/relay.mjs", webClientDir: "/Users/me/Downloads/wordless-deploy/web-client" },
		...overrides,
	});

describe("远程部署步骤", () => {
	it("有域名:TLS 由 Caddy 终结,最后填 wss://", () => {
		const result = plan({ domain: "relay.example.com" });
		assert.equal(result.secure, true);
		assert.equal(result.relayBaseUrl, "wss://relay.example.com");
		assert.equal(result.healthUrl, "https://relay.example.com/health");
		const ids = result.steps.map((step) => step.id);
		assert.ok(ids.includes("InstallCaddy"), "有域名就该有装 Caddy 这一步");
		assert.ok(ids.includes("Tls"), "有域名就该有证书那一步");
		const tls = result.steps.find((step) => step.id === "Tls");
		assert.match(tls?.command ?? "", /relay\.example\.com \{/);
		// 中继自己**不做 TLS**:反向代理指向环回地址上的中继。
		assert.match(tls?.command ?? "", new RegExp(`reverse_proxy 127\\.0\\.0\\.1:${DEPLOY_RELAY_PORT}`));
	});

	it("没有域名:不生成证书步骤,而且最后填的是 ws:// 并带端口", () => {
		// 不是"忘了写",是**如实不给**:没有域名就没有可信证书,给一条装 Caddy 的命令只会让人白折腾。
		const result = plan();
		assert.equal(result.secure, false);
		assert.equal(result.relayBaseUrl, `ws://1.2.3.4:${DEPLOY_RELAY_PORT}`);
		// 自检地址**也要带端口**:没有反向代理时,80 端口上什么都没有。
		// (这一条原来写的是不带端口 —— 端口可配之后才发现自检会打到一个没人监听的地方。)
		assert.equal(result.healthUrl, `http://1.2.3.4:${DEPLOY_RELAY_PORT}/health`);
		const ids = result.steps.map((step) => step.id);
		assert.equal(ids.includes("Tls"), false);
		assert.equal(ids.includes("InstallCaddy"), false);
	});

	it("命令里**不许有占位符**:域名、用户、路径全部填进去", () => {
		// "把 <你的域名> 换成你的域名"这种话每个字都认识,但抄错一次就是十分钟的困惑。
		const result = plan({ domain: "relay.example.com" });
		const all = result.steps.map((step) => step.command).join("\n");
		// 注意:shell 的重定向(`>` / `<<'UNIT'`)是命令的一部分,不算占位符 ——
		// 所以这里查的是"看起来像让人替换的写法"。
		for (const marker of ["<你的", "<your", "<domain", "<host", "<user", "<server", "TODO", "FIXME", "xxx"]) {
			assert.equal(all.toLowerCase().includes(marker.toLowerCase()), false, `命令里不该出现 ${marker}`);
		}
		assert.match(all, /ubuntu@1\.2\.3\.4:/, "scp 的目标要是填进去的服务器与用户");
		assert.match(all, /User=ubuntu/, "systemd 单元里要是填进去的用户");
		assert.match(all, /--web-root \/opt\/wordless-relay\/web-client/);
	});

	it("上传那一步:远程落点**显式写出来**,来源目录叫什么名字都不影响", () => {
		/*
			这是这次修复的核心不变式。以前是"整个目录 scp 过去",远程名字由本地 basename 决定 ——
			打包版里正好叫 `web-client`,开发版却是 `apps/web-client/dist`,于是会传成 `dist/`,
			而 systemd 单元认的是 `web-client`。显式写名字之后,来源在哪儿都无所谓。
		*/
		const upload = plan({
			upload: { relayPath: "/opt/src/relay.mjs", webClientDir: "/opt/src/dist" },
		}).steps.find((step) => step.id === "Upload");
		const lines = (upload?.command ?? "").split("\n");
		assert.equal(lines.length, 2, "两样东西各一行:落点不同,不能合成一句");
		assert.equal(lines[0], 'scp -r "/opt/src/relay.mjs" ubuntu@1.2.3.4:/opt/wordless-relay/relay.mjs');
		assert.equal(
			lines[1],
			'scp -r "/opt/src/dist"/* ubuntu@1.2.3.4:/opt/wordless-relay/web-client/',
			"来源叫 dist 也得落到 web-client —— 远程名字是我们定的,不是 basename 定的",
		);
		// 引号只包目录、不包通配符:包住了 `*` 就不再展开(路径里有空格时这是唯一正确的写法)。
		assert.equal(lines[1]?.includes('"/*"'), false, "通配符不能被引号吃掉");
	});

	it("上传的是**目录内容**:目标目录由 PrepareDir 先建好,落进去是覆盖合并", () => {
		// 目标不存在就没地方落,所以 PrepareDir 必须建它;而"落进去"而不是"先删再传"是刻意的:
		// 删了万一这次上传失败,线上就只剩 404。
		const result = plan();
		const ids = result.steps.map((step) => step.id);
		assert.ok(ids.indexOf("PrepareDir") < ids.indexOf("Upload"), "先建目录再上传");
		const prepare = result.steps.find((step) => step.id === "PrepareDir");
		assert.match(prepare?.command ?? "", /mkdir -p \/opt\/wordless-relay\/web-client/);
		assert.equal(/rm -rf/.test(result.steps.map((step) => step.command).join("\n")), false, "部署不许删线上已有的东西");
	});

	it("上传那一步真的跑得起来:假 `scp` 收到的是**展开后的文件**与**写死的远程名字**", () => {
		/*
			上面那条查的是字符串。这一条**真的执行**那行命令(把 `scp` 换成一个只记录参数的替身),
			因为它依赖两件只有真跑才看得见的事:

			1. `web-client/*` 由 **shell 展开** —— 展开出来的是 `index.html`、`assets` 这些**目录内容**,
			   而不是 `dist` 这个名字本身(这正是"来源叫什么名字都无所谓"的由来);
			2. 两行各传一次,远程落点分别是 `relay.mjs` 与 `web-client/`。
		*/
		const root = mkdtempSync(join(tmpdir(), "wordless-upload-"));
		try {
			const shim = join(root, "bin");
			mkdirSync(shim, { recursive: true });
			const calls = join(root, "calls.txt");
			// 替身:`scp` 只把收到的参数逐行记下来,然后成功退出(真的 scp 要 sshd,这里不需要)。
			writeFileSync(join(shim, "scp"), `#!/bin/sh\nprintf '%s\\n' "---" "$@" >> ${calls}\n`, { mode: 0o755 });
			chmodSync(join(shim, "scp"), 0o755);

			// 来源目录**故意叫 dist,而且父目录带空格**:打包版里叫 web-client、开发版叫 dist,
			// 而用户的主目录里什么都可能有 —— 落点都不该因此改变。
			const webClientDir = join(root, "my dir", "dist");
			mkdirSync(join(webClientDir, "assets"), { recursive: true });
			writeFileSync(join(webClientDir, "index.html"), "<html></html>");
			writeFileSync(join(webClientDir, "assets", "app.js"), "");
			const relayPath = join(root, "my dir", "relay.mjs");
			writeFileSync(relayPath, "");

			const upload = plan({ upload: { relayPath, webClientDir } }).steps.find((step) => step.id === "Upload");
			const result = spawnSync("bash", ["-c", upload?.command ?? ""], {
				encoding: "utf8",
				env: { ...process.env, PATH: `${shim}:${process.env.PATH ?? ""}` },
			});
			assert.equal(result.status, 0, `上传那一步没跑通:${result.stderr}`);

			const invocations = readFileSync(calls, "utf8").trim().split("---\n").filter((line) => line.length > 0);
			assert.deepEqual(invocations.map((line) => line.trim().split("\n")), [
				["-r", relayPath, "ubuntu@1.2.3.4:/opt/wordless-relay/relay.mjs"],
				[
					"-r",
					join(webClientDir, "assets"),
					join(webClientDir, "index.html"),
					"ubuntu@1.2.3.4:/opt/wordless-relay/web-client/",
				],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("每一步都是**语法正确的 shell**(长脚本里最容易写坏引号)", () => {
		for (const upload of [
			{ relayPath: "/tmp/relay.mjs", webClientDir: "/tmp/web-client" },
			// 带空格与中文的路径也要能过 —— 用户的主目录里什么都可能有。
			{ relayPath: "/tmp/my dir/中继.mjs", webClientDir: "/tmp/my dir/web client" },
		]) {
			for (const step of plan({ upload }).steps) {
				const result = spawnSync("bash", ["-n", "-c", step.command], { encoding: "utf8" });
				assert.equal(result.status, 0, `${step.id} 的语法错了:${result.stderr}`);
			}
		}
	});

	it("中继**只听环回**:公网那一侧交给反向代理", () => {		// 中继暴露到公网且没有 TLS 时,连接码与手机凭据是明文的(见 remote-access.md §18.2)。
		const service = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "Service");
		assert.match(service?.command ?? "", /--host 127\.0\.0\.1/);
	});

	it("自检用的是中继自己的 /health(与设置页里的探测同一个接口)", () => {
		const verify = plan().steps.at(-1);
		assert.equal(verify?.id, "Verify");
		assert.match(verify?.command ?? "", /\/health/);
		assert.match(verify?.command ?? "", /curl -fsS/);
	});

	it("要求清单是**固定的四项**,文案在 i18n 里按 id 取", () => {
		assert.deepEqual([...DEPLOY_REQUIREMENTS], ["Server", "Domain", "Ports", "Node"]);
	});

	it("每一步的 sudo 都标出来(用户好判断该不该输密码)", () => {
		const steps = plan({ domain: "relay.example.com" }).steps;
		assert.equal(steps.find((step) => step.id === "Upload")?.sudo, false, "上传是本机命令,不需要 sudo");
		assert.equal(steps.find((step) => step.id === "Service")?.sudo, true);
		assert.equal(steps.find((step) => step.id === "Verify")?.sudo, false);
	});

	it("可以指定端口:中继监听端口与对外端口各走各的", () => {
		// 8787 可能被服务器上别的东西占着;对外端口也未必是 443。
		const result = plan({ domain: "relay.example.com", relayPort: 9001, publicPort: 8443 });
		const all = result.steps.map((step) => step.command).join("\n");
		assert.match(all, /--port 9001/, "中继监听指定的端口");
		assert.match(all, /reverse_proxy 127\.0\.0\.1:9001/, "反向代理指向同一个端口");
		assert.match(all, /relay\.example\.com:8443 \{/, "对外端口要写在站点地址里");
		// **地址里必须带上对外端口**:只改服务器配置、地址还写默认端口,手机会连到没人监听的地方。
		//
		// 但**不是 80/443 时签不了证书**(Let's Encrypt 的校验只认那两个端口),所以给的是明文,
		// 并配一条警告 —— 而不是生成一个 `wss://` 让用户去撞墙。
		assert.equal(result.relayBaseUrl, "ws://relay.example.com:8443");
		assert.equal(result.healthUrl, "http://relay.example.com:8443/health");
		assert.deepEqual(result.warnings, [{ key: "remoteWarnNoTlsOnCustomPort", detail: "8443" }]);
	});

	it("端口非法就当没填(退回默认),而不是生成一条起不来的命令", () => {
		for (const bad of [0, 70_000, 1.5, Number.NaN]) {
			const result = plan({ domain: "relay.example.com", relayPort: bad as never, publicPort: bad as never });
			const all = result.steps.map((step) => step.command).join("\n");
			assert.match(all, /--port 8787/, `${bad} 要退回默认端口`);
			assert.equal(result.relayBaseUrl, "wss://relay.example.com", "默认 443 不写出来");
		}
	});

	it("没有域名 = 没有反向代理:中继自己对外绑 0.0.0.0,并提醒放行端口", () => {
		// 原来这里写死了 `--host 127.0.0.1`:地址写着公网端口、服务却只在环回上听,外面永远连不上。
		const result = plan({ relayPort: 9001 });
		const service = result.steps.find((step) => step.id === "Service")?.command ?? "";
		assert.match(service, /--host 0\.0\.0\.0/, "没有代理时中继必须自己对外");
		assert.equal(result.relayBaseUrl, "ws://1.2.3.4:9001");
		assert.equal(result.healthUrl, "http://1.2.3.4:9001/health");
		assert.deepEqual(result.warnings, [{ key: "remoteWarnDirectExposure", detail: "9001" }]);
	});

	it("有域名时:中继只监听环回(对外交给代理)", () => {
		const service = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "Service")?.command ?? "";
		assert.match(service, /--host 127\.0\.0\.1/);
	});

	it("自定义对外端口 + nginx:listen 用那个端口;而 certbot 就不跑了(它按 80/443 工作)", () => {
		const result = plan({ domain: "relay.example.com", publicPort: 8443, facts: { nginxActive: true } });
		const site = result.steps.find((step) => step.id === "NginxSite")?.command ?? "";
		assert.match(site, /listen 8443;/);
		assert.equal(
			result.steps.some((step) => step.id === "NginxCert"),
			false,
			"自定义端口上 certbot 帮不上忙 —— 不摆一个必然失败的步骤",
		);
	});

	it("服务器上已经有 Node 20:**整条跳过安装**,而且列出跳过了什么", () => {
		// 用户提的:不该"反正装上也没坏处" —— 那会改掉别人机器上的环境,还可能把正在跑的东西换掉。
		const result = plan({ domain: "relay.example.com", facts: { node: { present: true, version: "v20.11.0", major: 20 } } });
		assert.equal(
			result.steps.some((step) => step.id === "InstallNode"),
			false,
			"已经有 20 就不该出现安装那一步",
		);
		assert.deepEqual(result.skipped, [{ id: "InstallNode", reason: "v20.11.0" }]);
		// 也不能**悄悄**消失:列出来,界面照实说。
		assert.equal(result.steps[0]?.id, "PrepareDir");
	});

	it("Node 太旧或没装:保留安装那一步", () => {
		for (const facts of [{ node: { present: true, version: "v18.19.0", major: 18 } }, { node: { present: false } }]) {
			const result = plan({ domain: "relay.example.com", facts });
			assert.equal(result.steps.some((step) => step.id === "InstallNode"), true);
			assert.deepEqual(result.skipped, []);
		}
	});

	it("没探测过:安装命令**自带判断**,照着教程手动做也不会重装", () => {
		// 手动路径没有探测结果,所以判断写在命令里:这是两条路共用的同一条安全线。
		const command = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "InstallNode")?.command ?? "";
		assert.match(command, /node -v 2>\/dev\/null/, "先看有没有");
		assert.match(command, /-ge 20/, "再看够不够");
		assert.match(command, /跳过安装/, "够了就跳过");
		assert.match(command, /nodesource/, "不够才装");
	});

	it("写 Caddy 配置**不覆盖别人已有的**:有我们的就跳过,否则追加", () => {
		// 那台机器上可能还挂着别的站点,`tee` 一把盖掉等于把别人的服务弄停。
		const command = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "Tls")?.command ?? "";
		assert.match(command, /grep -q "wordless-relay"/, "先看有没有我们那一段");
		assert.match(command, /tee -a/, "追加,而不是覆盖");
		assert.equal(command.includes("sudo tee /etc/caddy/Caddyfile > /dev/null"), false);
	});

	it("Caddy 已经装好:跳过安装那一步(apt 幂等,但每次 update 都很慢)", () => {
		const result = plan({ domain: "relay.example.com", facts: { caddy: true } });
		assert.equal(result.steps.some((step) => step.id === "InstallCaddy"), false);
		assert.deepEqual(result.skipped, [{ id: "InstallCaddy", reason: "caddy" }]);
		// 配 HTTPS 那一步还要做:装好 ≠ 配好。
		assert.equal(result.steps.some((step) => step.id === "Tls"), true);
	});

	it("发行版不是 Debian 系:警告,但不拦路", () => {
		// 我们的命令是 apt + nodesource 那一套,在 CentOS 上会以"某一步 exit 1"的形式失败。
		const result = plan({ domain: "relay.example.com", facts: { distro: { id: "centos", version: "9" } } });
		assert.deepEqual(result.warnings, [{ key: "remoteWarnDistro", detail: "centos 9" }]);
		// 不跳过任何步骤:拦下来等于替用户做决定。
		assert.equal(result.steps.length > 0, true);
		assert.equal(result.steps.some((step) => step.id === "InstallNode"), true);
	});

	it("端口被占:说出来,别让它变成一句笼统的服务没起来", () => {
		const result = plan({
			domain: "relay.example.com",
			relayPort: 9001,
			facts: { listeningPorts: [80, 443, 9001] },
		});
		assert.deepEqual(
			result.warnings.map((warning) => warning.key),
			// 后一条是"占着 80/443 的既不是 nginx 也不是 Caddy":这时装 Caddy 会白起一次。
			["remoteWarnRelayPort", "remoteWarnPort80", "remoteWarnPort443", "remoteWarnUnknownProxy"],
		);
	});

	it("已经部署过:说明这次是覆盖升级", () => {
		const result = plan({ domain: "relay.example.com", facts: { deployDirExists: true } });
		assert.deepEqual(result.warnings, [{ key: "remoteWarnRedeploy", detail: "/opt/wordless-relay" }]);
	});

	it("覆盖升级时**重启服务**(`enable --now` 对「已经在跑」的服务是空操作)", () => {
		// 真实坑:升级部署之后新的 relay.mjs 躺在磁盘上,而进程里跑的还是旧代码 ——
		// 于是"部署成功了"和"服务器上是新的"是两件事。
		const service = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "Service");
		assert.match(service?.command ?? "", /systemctl restart wordless-relay/);
		assert.doesNotMatch(service?.command ?? "", /enable --now/);
	});

	it("服务器上那一版是旧的:提醒**重新部署一次**(答案不靠用户自己记)", () => {
		const result = plan({
			domain: "relay.example.com",
			version: "1.4.0",
			facts: { deployDirExists: true, deployedVersion: "1.2.0" },
		});
		assert.deepEqual(result.warnings, [
			{ key: "remoteWarnRedeploy", detail: "/opt/wordless-relay" },
			{ key: "remoteWarnRedeployOutdated", detail: "1.2.0 → 1.4.0" },
		]);
	});

	it("读不出服务器上那一版:也提醒(它一定是旧的)", () => {
		const result = plan({ domain: "relay.example.com", version: "1.4.0", facts: { deployDirExists: true } });
		assert.deepEqual(result.warnings.at(-1), { key: "remoteWarnRedeployUnknown", detail: "1.4.0" });
	});

	it("版本一致:不提这件事(不要用噪音换安全感)", () => {
		const result = plan({
			domain: "relay.example.com",
			version: "1.4.0",
			facts: { deployDirExists: true, deployedVersion: "1.4.0" },
		});
		assert.deepEqual(result.warnings, [{ key: "remoteWarnRedeploy", detail: "/opt/wordless-relay" }]);
	});

	it("部署完之后在服务器上**记下这一版**(而且排在自检之后:写早了就是假话)", () => {
		const steps = plan({ domain: "relay.example.com", version: "1.4.0" }).steps;
		const stamp = steps.find((step) => step.id === "Stamp");
		assert.ok(stamp, "有版本号就该写进去");
		assert.match(stamp?.command ?? "", /version.json/);
		assert.match(stamp?.command ?? "", /1\.4\.0/);
		// 顺序:自检在前,记版本在后 —— 服务没起来就不该说"服务器上是新版本"。
		assert.ok(steps.findIndex((step) => step.id === "Verify") < steps.findIndex((step) => step.id === "Stamp"));
	});

	it("没有版本号(开发版):不写那一步,而不是写一个假的", () => {
		assert.equal(
			plan({ domain: "relay.example.com" }).steps.some((step) => step.id === "Stamp"),
			false,
		);
	});

	it("一切正常时:没有任何警告(不要用噪音换安全感)", () => {
		const result = plan({ domain: "relay.example.com", facts: { distro: { id: "ubuntu", version: "22.04" }, listeningPorts: [] } });
		assert.deepEqual(result.warnings, []);
	});

	it("每条 apt 命令都要**等锁**(真实踩到:dpkg 锁被 unattended-upgrades 占着)", () => {
		// 现场:`E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process … (unattended-upgr)`
		// —— 新装的 Ubuntu 默认会自己跑 unattended-upgrades。不加等锁参数,apt 直接失败。
		const result = plan({ domain: "relay.example.com" });
		const aptLines = result.steps
			.flatMap((step) => step.command.split("\n"))
			.filter((line) => line.includes("apt-get install") || line.includes("apt-get update"));
		assert.ok(aptLines.length >= 3, `要检查到几条 apt 命令(现在 ${aptLines.length} 条)`);
		for (const line of aptLines) {
			assert.match(line, /DPkg::Lock::Timeout=\d+/, `这条缺等锁参数:${line}`);
			assert.match(line, /APT::Get::Lock::Timeout=\d+/, `这条缺 lists 锁参数:${line}`);
		}
	});

	it("每一步的成败由**最后一条命令**决定:所以最后要确认真的装上了", () => {
		// 真实踩到的那次:装 Caddy 的第一步失败(锁)、后面几条成功,整步被报成"成功"。
		const install = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "InstallCaddy")?.command ?? "";
		assert.match(install.split("\n").at(-1) ?? "", /command -v caddy/, "最后要确认 caddy 真的在");
		// Node 那一步本来就以 `node -v` 收尾,同理。
		const node = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "InstallNode")?.command ?? "";
		assert.match(node.split("\n").at(-1) ?? "", /node -v/);
	});

	it("服务器上正在跑 apt:提前说一声(我们会等,但用户得知道为什么慢)", () => {
		const result = plan({ domain: "relay.example.com", facts: { aptBusy: true } });
		assert.deepEqual(result.warnings, [{ key: "remoteWarnAptBusy" }]);
	});

	it("sudo 要密码:这一条**会拦路**,必须说清楚", () => {
		// 我们是拿 `ssh host bash -s` 跑命令的:没有终端可以输密码,`sudo` 会以
		// "a password is required" 失败 —— 而那句话看不出"你得先配 NOPASSWD"。
		const result = plan({ domain: "relay.example.com", facts: { sudoNoPassword: false } });
		assert.deepEqual(result.warnings, [{ key: "remoteWarnSudoPassword" }]);
	});

	it("免密 sudo 可用时:不吓唬人", () => {
		const result = plan({ domain: "relay.example.com", facts: { sudoNoPassword: true, aptBusy: false } });
		assert.deepEqual(result.warnings, []);
	});

	it("配 HTTPS 用 **restart** 而不是 reload(真实踩到:caddy.service is not active, cannot reload)", () => {
		// reload 要求服务已经在跑,而刚装好的机器上它可能是停的;restart 对停着的会把它起来。
		const tls = plan({ domain: "relay.example.com" }).steps.find((step) => step.id === "Tls")?.command ?? "";
		assert.match(tls, /systemctl restart caddy/);
		assert.equal(/systemctl reload caddy/.test(tls), false, "不能再靠 reload");
		// 先验配置:语法错的话 restart 只会说"服务没起来",看不出是哪一行错了。
		assert.match(tls, /caddy validate --config \/etc\/caddy\/Caddyfile/);
		assert.match(tls, /systemctl enable caddy/, "开机自启也要打开");
		// 成败由最后一条命令决定:确认它真的在跑;没起来就把它自己的日志摆出来。
		const last = tls.split("\n").at(-1) ?? "";
		assert.match(last, /is-active caddy/);
		assert.match(last, /journalctl -u caddy/, "起不来时要有它自己的日志");
		assert.match(last, /exit 1/, "日志打完之后要真的失败");
	});

	it("Caddy 装着但没在跑:提前说一声", () => {
		const result = plan({ domain: "relay.example.com", facts: { caddy: true, caddyActive: false } });
		assert.deepEqual(result.warnings, [{ key: "remoteWarnCaddyInactive" }]);
	});

	it("nginx 在跑:**走 nginx 路线**,不装 Caddy(80 被占,Caddy 既绑不上也签不了证书)", () => {
		// 用户问的:能不能按"服务器上装了什么"来判断 —— 能,而且这是对的判断依据。
		const result = plan({ domain: "relay.example.com", facts: { nginx: true, nginxActive: true } });
		assert.equal(result.proxy, "nginx");
		const ids = result.steps.map((step) => step.id);
		assert.equal(ids.includes("InstallCaddy"), false, "不要装 Caddy");
		assert.equal(ids.includes("Tls"), false, "也不要写 Caddyfile");
		assert.ok(ids.includes("NginxSite"));
		assert.ok(ids.includes("NginxCert"));
		assert.deepEqual(result.warnings, [{ key: "remoteWarnNginxPath" }]);
	});

	it("nginx 路线的配置:**反代 + WebSocket 升级头 + 长连接**,证书交给 certbot", () => {
		const site = plan({ domain: "relay.example.com", relayPort: 9001, facts: { nginxActive: true } }).steps.find(
			(step) => step.id === "NginxSite",
		)?.command ?? "";
		assert.match(site, /proxy_pass http:\/\/127\.0\.0\.1:9001/);
		// 少了升级头,手机连上就立刻断 —— 这是 WebSocket 反代最容易漏的一行。
		assert.match(site, /proxy_set_header Upgrade \$http_upgrade/);
		assert.match(site, /proxy_set_header Connection "upgrade"/);
		assert.match(site, /proxy_read_timeout 3600s/, "长连接:手机挂着不动不该被掐断");
		// 先验配置再 reload。
		assert.match(site, /nginx -t/);
		assert.match(site, /systemctl reload nginx/);
		// 配置里的 `$http_upgrade` 必须是**字面量**(heredoc 用引号定界,不做变量展开)。
		assert.equal(site.includes("<<'NGINX'"), true);

		const cert = plan({ domain: "relay.example.com", facts: { nginxActive: true } }).steps.find(
			(step) => step.id === "NginxCert",
		)?.command ?? "";
		assert.match(cert, /certbot --nginx -d relay\.example\.com/);
		assert.match(cert, /--redirect/, "顺手把 HTTP 跳到 HTTPS");
		assert.match(cert.split("\n").at(-1) ?? "", /fullchain\.pem/, "最后确认证书真的装上了");
	});

	it("nginx 没在跑:还是走 Caddy(默认路线)", () => {
		const result = plan({ domain: "relay.example.com", facts: { nginx: true, nginxActive: false } });
		assert.equal(result.proxy, "caddy");
		assert.ok(result.steps.some((step) => step.id === "InstallCaddy"));
	});

	it("80/443 被占、但既不是 nginx 也不是 Caddy:说清楚,别让 Caddy 白起一次", () => {
		const result = plan({
			domain: "relay.example.com",
			facts: { listeningPorts: [80, 443], nginxActive: false, caddy: false },
		});
		assert.deepEqual(result.warnings, [
			{ key: "remoteWarnPort80", detail: "80" },
			{ key: "remoteWarnPort443", detail: "443" },
			{ key: "remoteWarnUnknownProxy", detail: "80 / 443" },
		]);
	});

	it("域名粘成整条地址也能用:去掉协议与路径(否则 server_name 永远匹配不上)", () => {
		// 用户很可能直接粘 `https://relay.example.com/` —— 塞进 server_name 会生成一份
		// 语法没错、但永远匹配不上的配置,表现是"配置写好了,访问却还是别人的站点"。
		for (const input of ["https://relay.example.com/", "http://relay.example.com", "Relay.Example.COM.", "relay.example.com:443"]) {
			const result = plan({ domain: input, facts: { nginxActive: true } });
			assert.equal(result.proxy, "nginx");
			assert.equal(result.relayBaseUrl, "wss://relay.example.com", `输入 ${input} 要规范化成 relay.example.com`);
			const site = result.steps.find((step) => step.id === "NginxSite")?.command ?? "";
			assert.match(site, /server_name relay\.example\.com;/);
			assert.equal(site.includes(input.replace(/\//g, "\/")), input.startsWith("https") ? false : site.includes(input));
		}
	});

	it("填的不是域名(比如 IP):当没填处理,而且**说出来**", () => {
		// 静默忽略会让用户拿到一个 ws:// 地址却不知道为什么。
		const result = plan({ domain: "192.168.1.9" });
		assert.equal(result.secure, false);
		assert.equal(result.relayBaseUrl, "ws://1.2.3.4:8787");
		assert.deepEqual(
			result.warnings.map((warning) => warning.key),
			["remoteWarnDomainIgnored", "remoteWarnDirectExposure"],
		);
	});

	it("二级域名 + nginx:地址不带端口(443 是默认值)", () => {
		// 用户问的:能不能用一个二级域名代替 :9001 —— 能,这就是标准做法。
		const result = plan({ domain: "relay.example.com", facts: { nginxActive: true } });
		assert.equal(result.relayBaseUrl, "wss://relay.example.com");
		assert.equal(result.healthUrl, "https://relay.example.com/health");
		// 中继只监听本机:对外那 80/443 还是 nginx 的,我们只是加了一个**按名字**匹配的虚拟主机。
		const service = result.steps.find((step) => step.id === "Service")?.command ?? "";
		assert.match(service, /--host 127\.0\.0\.1/);
		const site = result.steps.find((step) => step.id === "NginxSite")?.command ?? "";
		assert.match(site, /listen 80;/, "默认走 80,证书由 certbot 加上 443");
	});
	it("nginx 装着、80 被占着,但 systemd 说它没在跑:仍然走 nginx 路线", () => {
		// 真实踩到:nginx 是手动起的 / 跑在 Docker 里,`systemctl is-active nginx` = inactive,
		// 于是计划去装 Caddy —— 而 Caddy 起不来(80 被占、8787 还被旧配置占着)。
		const result = plan({
			domain: "relay.example.com",
			facts: { nginx: true, nginxActive: false, listeningPorts: [80] },
		});
		assert.equal(result.proxy, "nginx");
		assert.equal(result.steps.some((step) => step.id === "InstallCaddy"), false);
	});

	it("走 nginx 时,服务器上还留着 Caddy:提醒别让两个反代抢 80/443", () => {
		const result = plan({
			domain: "relay.example.com",
			facts: { nginxActive: true, caddy: true, caddyActive: true },
		});
		assert.deepEqual(
			result.warnings.map((warning) => warning.key),
			["remoteWarnCaddyLeftover", "remoteWarnNginxPath"],
		);
	});
});
