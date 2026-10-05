/**
 * 把部署**撤下来**的步骤(「停用服务」与「卸载部署」)。
 *
 * 与部署共用同一套形状与同一个执行器(`SshDeploy.run`),所以"预览的就是跑的"这条纪律照样成立。
 * 但有一条不同:**卸载是不可逆的**,所以这里的每一步都要能回答"你凭什么动这一行":
 *
 * | 对象 | 凭什么 | 做法 |
 * |---|---|---|
 * | 目录 `/opt/wordless-relay` | 是我们建的 | 直接删(删之前 `ls` 一遍,日志里留证据) |
 * | systemd 单元 `wordless-relay.service` | 是我们写的 | 停 → 禁用 → 删文件 → `daemon-reload` |
 * | nginx 站点 `conf.d/wordless-relay.conf` | 是我们写的整份文件 | 直接删 + `nginx -t` + reload |
 * | Caddyfile 里的那一段 | **只是我们追加的一段**,文件里可能还有别人的站点 | **只摘我们那四行**;形状不对就一行都不动(见 `CADDY_BLOCK_AWK`) |
 * | 证书、Caddy 本身 | **不一定是我们的**(Caddy 可能早就装着,证书可能是别的站点在用的) | 不动,只在界面上说清怎么自己删 |
 *
 * 最后一条是刻意的:**不替用户做主**。删掉别人机器上可能在用的东西,比留下一点垃圾糟得多。
 */

import { DEPLOY_RELAY_PORT, DEPLOY_REMOTE_DIR, type DeployStep } from "./deploy-plan.ts";

/**
 * 两件事,不是一件事:
 *
 * - `stop`:停服务(保留文件与配置)—— 可逆,所以**不拦路**;
 * - `remove`:卸载(删文件、摘配置)—— 不可逆,所以**先预览再确认**。
 *
 * 只有一把扳机的话,想"先停一下"的人只能去卸载 —— 而那是他多半不想要的。
 */
export type UninstallScope = "stop" | "remove";

/** 探测出来的"服务器上有什么"。缺一项 = 没探到 = 当没有(不猜)。 */
export interface UninstallFacts {
	readonly deployDirExists?: boolean;
	/** `/etc/systemd/system/wordless-relay.service` 在不在。 */
	readonly serviceExists?: boolean;
	/** systemd 眼里它是不是活着(文件在、服务没起 = 也要 stop 一下)。 */
	readonly serviceActive?: boolean;
	/** `/etc/nginx/conf.d/wordless-relay.conf` 在不在。 */
	readonly nginxSiteExists?: boolean;
	/** Caddyfile 里有没有我们那一段。 */
	readonly caddyBlockExists?: boolean;
}

export interface UninstallPlanInput {
	readonly scope: UninstallScope;
	/** 中继在服务器上监听的端口(默认 8787):自检用它确认"没人再监听了"。 */
	readonly relayPort?: number;
	readonly facts?: UninstallFacts;
}

export interface UninstallPlan {
	readonly steps: readonly DeployStep[];
	/** 找到了、但这一步不用跑(以及为什么)。与部署那边同一套说法。 */
	readonly skipped: readonly { readonly id: string; readonly reason: string }[];
	readonly warnings: readonly { readonly key: string; readonly detail?: string }[];
	/** 这台服务器上**没有**我们的部署:界面据此说清,而不是跑一串空命令、给一堆绿勾。 */
	readonly nothingToDo: boolean;
}

/**
 * 只摘我们自己追加的那**四行**。
 *
 * ```
 * # wordless-relay
 * relay.example.com {
 * \treverse_proxy 127.0.0.1:8787
 * }
 * ```
 *
 * 为什么不是"从标记行删到下一个 `}`":那个写法在**形状被人改过**的时候会把别人的站点一起删掉
 * (测试当场抓到过:块少了收尾那行时,它会一路吞到下一个站点的 `}`)。而 Caddyfile 是**好几个
 * 站点共用**的文件 —— 删错一行就是别人的站挂了。
 *
 * 所以这里只认**完全匹配的四行**,一行不匹配就整份原样输出并 `exit 4`(调用方据此**什么都不做**)。
 * 代价是"被手工改过的块删不掉",但那正是该交给用户自己看的那件事。
 *
 * (整个文件读进内存再输出:Caddyfile 是几 KB 的配置,不值得为流式省这点内存。)
 */
export const CADDY_BLOCK_AWK = [
	"{ lines[NR] = $0 }",
	"END {",
	"  n = NR; found = 0",
	"  for (i = 1; i <= n; i++) {",
	"    if (lines[i] == \"# wordless-relay\" && i + 3 <= n && lines[i+1] ~ /\\{[[:space:]]*$/ && lines[i+2] ~ /^[[:space:]]*reverse_proxy[[:space:]]/ && lines[i+3] ~ /^\\}/) {",
	"      i += 3; found++; continue",
	"    }",
	"    print lines[i]",
	"  }",
	"  if (found == 0) exit 4",
	"}",
].join("\n");

/** 中继端口:非法值退回默认(计划里出现的端口必须真的能用)。 */
function validPort(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : undefined;
}

export function remoteUninstallPlan(input: UninstallPlanInput): UninstallPlan {
	const relayPort = validPort(input.relayPort) ?? DEPLOY_RELAY_PORT;
	const facts = input.facts ?? {};
	const hasService = facts.serviceExists === true || facts.serviceActive === true;
	const steps: DeployStep[] = [];
	const skipped: { id: string; reason: string }[] = [];
	const warnings: { key: string; detail?: string }[] = [];

	if (input.scope === "stop") {
		if (!hasService) {
			// 停服务的前提是**它真的在**:没有就直说,而不是跑一条必然报错的命令。
			return {
				steps: [],
				skipped: [{ id: "StopService", reason: "服务器上没有 wordless-relay 服务" }],
				warnings: [],
				nothingToDo: true,
			};
		}
		steps.push({
			id: "StopService",
			sudo: true,
			target: "server",
			command: [
				// `disable --now` = 停 + 关掉开机自启 —— 这里要的正是"现在停、以后也别自己起来"。
				"sudo systemctl disable --now wordless-relay",
				"sudo systemctl reset-failed wordless-relay 2>/dev/null || true",
			].join("\n"),
		});
		steps.push({
			id: "VerifyStopped",
			sudo: false,
			target: "server",
			command: [
				// 每一行都**一定打印**:静默的检查等于没检查。
				"systemctl is-active --quiet wordless-relay && echo \"注意:服务还在跑\" || echo \"服务已停用\"",
				`[ -d ${DEPLOY_REMOTE_DIR} ] && echo "文件与配置都留着(想彻底删就用「卸载部署」)" || echo "${DEPLOY_REMOTE_DIR} 已经不在了"`,
			].join("\n"),
		});
		if (facts.nginxSiteExists === true || facts.caddyBlockExists === true) {
			// 反代还在,只是后面没人应答 —— 那会是 502 而不是连不上,用户得能对上号。
			warnings.push({ key: "remoteWarnStopProxy" });
		}
		return { steps, skipped, warnings, nothingToDo: false };
	}

	// ---- 卸载 ----

	if (!hasService) {
		skipped.push({ id: "StopService", reason: "没有这个服务" });
		skipped.push({ id: "RemoveUnit", reason: "没有这个服务" });
	} else {
		steps.push({
			id: "StopService",
			sudo: true,
			target: "server",
			// **先停再删**:服务还在跑的时候把它的代码删了,它只会一直重启失败,日志刷屏。
			command: [
				"sudo systemctl disable --now wordless-relay",
				"sudo systemctl reset-failed wordless-relay 2>/dev/null || true",
			].join("\n"),
		});
		steps.push({
			id: "RemoveUnit",
			sudo: true,
			target: "server",
			command: ["sudo rm -f /etc/systemd/system/wordless-relay.service", "sudo systemctl daemon-reload"].join("\n"),
		});
	}

	if (facts.deployDirExists === true) {
		steps.push({
			id: "RemoveDir",
			sudo: true,
			target: "server",
			// 先 `ls` 一遍:万一用户往这个目录里放了别的东西,日志里至少留着证据。
			command: [`sudo ls -la ${DEPLOY_REMOTE_DIR}`, `sudo rm -rf ${DEPLOY_REMOTE_DIR}`].join("\n"),
		});
	} else {
		skipped.push({ id: "RemoveDir", reason: `${DEPLOY_REMOTE_DIR} 不存在` });
	}

	if (facts.nginxSiteExists === true) {
		steps.push({
			id: "RemoveNginxSite",
			sudo: true,
			target: "server",
			/**
			 * nginx 那条路上,**我们写的东西全在这一份文件里** —— 包括 certbot 后来加进去的
			 * 443 监听、证书路径与 HTTP→HTTPS 跳转(`certbot --nginx` 是改**匹配那个域名的
			 * server 块**,而那个块就是我们写的)。所以整份删就是完整地撤掉。
			 *
			 * 但有三样**不在**这份文件里,所以这一段的收尾是"把它们说出来":
			 *
			 * 1. **证书与续期配置**(`/etc/letsencrypt/…`)—— 可能是别的站点在用的,不动;
			 * 2. **certbot 这个软件包** —— 可能是你自己也在用的,不动;
			 * 3. **别人文件里提到同一个域名的 server 块**(你原来就有的,或 certbot 在别处改过的)——
			 *    不是我们写的,一行都不动,但要让你知道它还在(否则"卸了怎么还能打开"会变成一个谜)。
			 *
			 * 域名从**我们那份配置里读出来**再删(删完就没地方读了)—— 有了它,上面三件事才说得具体。
			 */
			command: [
				// 不用 sed 的反向引用:`\1` 在 JS 模板串里是八进制转义。awk 取第二列再 `tr` 掉分号。
				`domain=$(sudo awk '/^[[:space:]]*server_name/ { print $2; exit }' /etc/nginx/conf.d/wordless-relay.conf | tr -d ';')`,
				// 这一份是**我们写的整份文件**(certbot 也把证书行加在这里),所以可以整份删。
				"sudo rm -f /etc/nginx/conf.d/wordless-relay.conf",
				// 先验配置再重载:语法错的话 reload 只会说"配置有问题",看不出是哪一行。
				"sudo nginx -t",
				// nginx 没在跑时 reload 会失败 —— 我们没装它,**不替它做主**重启,只如实说一句。
				"sudo systemctl reload nginx 2>/dev/null || echo \"nginx 没在跑:配置已经删了,它下次起来就不带我们的站点了\"",
				"if [ -n \"$domain\" ]; then",
				`  echo "证书在 /etc/letsencrypt/live/$domain(续期配置在 /etc/letsencrypt/renewal/$domain.conf)—— 我们不动;要一起删:sudo certbot delete --cert-name $domain"`,
				// 别人的文件里也写着同一个域名时,**一行都不动**,但要说出来 —— 否则"卸了怎么还能打开"是个谜。
				// (域名读不出来时**不查**:那样模式会退化成 `server_name.*`,把每个站点都列出来。)
				"  others=$(sudo grep -rl \"server_name.*$domain\" /etc/nginx 2>/dev/null | grep -v wordless-relay.conf | head -5 || true)",
				"  if [ -n \"$others\" ]; then",
				`    echo "注意:下面这些 nginx 配置里也写着 $domain —— 不是我们写的,我们没动它们:"`,
				`    echo "$others"`,
				"  else",
				`    echo "没有别的 nginx 配置提到 $domain"`,
				"  fi",
				"else",
				`  echo "没能从配置里读出域名:证书与续期配置请自己确认(通常在 /etc/letsencrypt),也没去别处找同名站点"`,
				"fi",
			].join("\n"),
		});
	} else {
		skipped.push({ id: "RemoveNginxSite", reason: "没有我们的 nginx 站点文件" });
	}

	if (facts.caddyBlockExists === true) {
		steps.push({
			id: "RemoveCaddyBlock",
			sudo: true,
			target: "server",
			/**
			 * Caddyfile 是**别人的文件**(可能挂着好几个站点),所以这一段的每一步都在防"删错":
			 *
			 * 1. 只删**形状完全匹配**的那四行(见 `CADDY_BLOCK_AWK`),不匹配就一行都不动;
			 * 2. 删完再确认标记真的没了(删少了也不行);
			 * 3. 改完先 `caddy validate`(语法错就退回),再备份、再替换、再重启。
			 *
			 * 顺序是"先在临时文件上做完整套检查,最后才动真文件" —— 中途任何一步不过,
			 * 服务器上的文件还是原来那一份。
			 */
			command: [
				"set -e",
				"file=/etc/caddy/Caddyfile",
				"new=/tmp/Caddyfile.wordless-new",
				"backup=/etc/caddy/Caddyfile.wordless-backup",
				`if ! sudo awk '${CADDY_BLOCK_AWK}' "$file" > "$new"; then`,
				'  if sudo grep -q "^# wordless-relay" "$file"; then',
				'    echo "Caddyfile 里那一段的形状和我们写进去的不一样(可能被人手工改过),所以**什么都没动**。"',
				'    echo "要手工删:从「# wordless-relay」那一行到它下面第一个顶格的「}」。"',
				"    exit 1",
				"  fi",
				'  echo "Caddyfile 里已经没有 wordless-relay 那一段了,跳过。"',
				"  exit 0",
				"fi",
				'if sudo grep -q "wordless-relay" "$new"; then',
				'  echo "没能干净地摘掉那一段,已保持原样(什么都没动)。"',
				"  exit 1",
				"fi",
				'if ! sudo caddy validate --config "$new"; then',
				'  echo "改完之后配置校验不过,已保持原样(什么都没动)。"',
				"  exit 1",
				"fi",
				// 到这一步才动真文件:先留备份,再替换。
				'sudo cp "$file" "$backup"',
				'sudo mv "$new" "$file"',
				"sudo systemctl restart caddy",
				'echo "已摘掉 wordless-relay 那一段(原文备份在 $backup)"',
			].join("\n"),
		});
	} else {
		skipped.push({ id: "RemoveCaddyBlock", reason: "Caddyfile 里没有我们那一段" });
	}

	steps.push({
		id: "VerifyRemoved",
		sudo: false,
		target: "server",
		/**
		 * 自检:**每一行都一定打印**,因为"没说"和"没检查"在界面上长得一模一样。
		 *
		 * 端口那一行是给"为什么那个域名还能打开"准备的:可能你自己起了个进程占着它 ——
		 * 那我们不动(不是我们的东西),但要让用户看得见。
		 */
		command: [
			'systemctl cat wordless-relay >/dev/null 2>&1 && echo "注意:服务单元还在" || echo "服务单元已移除"',
			`[ -d ${DEPLOY_REMOTE_DIR} ] && echo "注意:${DEPLOY_REMOTE_DIR} 还在" || echo "${DEPLOY_REMOTE_DIR} 已删除"`,
			// 反代那两处也各看一眼:删没删干净,由**这一行**说,而不是由"我们删过了"说。
			...(facts.nginxSiteExists === true
				? ['[ -f /etc/nginx/conf.d/wordless-relay.conf ] && echo "注意:nginx 站点文件还在" || echo "nginx 站点文件已删除"']
				: []),
			...(facts.caddyBlockExists === true
				? [
						'(grep -q wordless-relay /etc/caddy/Caddyfile 2>/dev/null || sudo -n grep -q wordless-relay /etc/caddy/Caddyfile 2>/dev/null) && echo "注意:Caddyfile 里还有我们那一段" || echo "Caddyfile 里已经没有我们那一段"',
					]
				: []),
			`(exec 3<>/dev/tcp/127.0.0.1/${relayPort}) 2>/dev/null && echo "注意:${relayPort} 上还有东西在监听(可能是你自己起的进程)" || echo "${relayPort} 已经没人监听了"`,
		].join("\n"),
	});

	if (facts.nginxSiteExists === true || facts.caddyBlockExists === true) {
		// 证书与续期配置**不动**:它可能是别的站点在用的,而且不在我们那份文件里。
		warnings.push({ key: "remoteWarnUninstallCerts" });
	}
	/**
	 * 软件包也**不动**,而且要说清是**哪一个** —— 两条路线装的东西不一样:
	 *
	 * - nginx 路线:`certbot` + `python3-certbot-nginx`(**是我们装的**);nginx 本身我们**从没装过**;
	 * - Caddy 路线:Caddy 可能早就装着(探测到"已装"时我们就没碰过它)。
	 */
	if (facts.nginxSiteExists === true) {
		warnings.push({ key: "remoteWarnUninstallCertbot" });
	}
	if (facts.caddyBlockExists === true) {
		warnings.push({ key: "remoteWarnUninstallCaddy" });
	}
	// 这台电脑上填的远程地址现在没人应答了 —— 用户多半正盯着设置页,顺手说一句。
	warnings.push({ key: "remoteWarnUninstallAddress" });

	const nothingToDo =
		facts.deployDirExists !== true &&
		!hasService &&
		facts.nginxSiteExists !== true &&
		facts.caddyBlockExists !== true;

	return { steps: nothingToDo ? [] : steps, skipped, warnings, nothingToDo };
}
