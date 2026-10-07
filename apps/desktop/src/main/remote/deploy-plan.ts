/**
 * 远程部署的**步骤** —— 教程档与(将来的)SSH 自动部署共用这一份。
 *
 * 为什么要有这个模块:教程里写一套命令、自动部署里跑另一套,两者迟早漂移,
 * 而漂移的表现是"照着教程能跑通、点自动部署却不行"(或者反过来),用户完全无从判断谁对。
 * 所以命令只写在这里,两边都从它读。
 *
 * 只产出 **id + 命令 + 少量参数**,文案(标题、说明)在 `i18n.ts` 里按 id 取 ——
 * 这样两种语言都能用,而不是把中文焊死在命令旁边。
 *
 * 架构上有一条**必须写清**的事:中继**不做 TLS**(它只监听环回),TLS 由反向代理(Caddy)终结。
 * 所以"没有域名"时不生成证书那几步,而且**如实说明代价**(链路上是明文)。
 */

/**
 * apt 的**等锁**参数。
 *
 * 真实踩到过:`E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process … (unattended-upgr)`
 * —— 新装的 Ubuntu 默认会自己跑 `unattended-upgrades`,而它正好占着 dpkg 的锁。
 * 不加这两个参数 apt 会**直接失败**;加上之后它会**等**(最多 5 分钟)。
 *
 * (`DPkg::Lock::Timeout` 管 dpkg 前端锁,`APT::Get::Lock::Timeout` 管 apt 自己的 lists 锁 ——
 * 两个都写,免得只等了一半。)
 */
export const APT_LOCK_OPTIONS = "-o DPkg::Lock::Timeout=300 -o APT::Get::Lock::Timeout=300";

/** 中继在服务器上跑的**默认**端口(反向代理指向它)。可以改,见 `DeployPlanInput.relayPort`。 */
export const DEPLOY_RELAY_PORT = 8787;

/** 服务器上的目录。 */
export const DEPLOY_REMOTE_DIR = "/opt/wordless-relay";

/**
 * 上传的**来源**:本机上要传到服务器上去的那两样东西。
 *
 * 只有一处 —— **安装目录里随包发布的那一份**。曾经有第二个来源(复制到"下载"里的"部署包"),
 * 为的是让教程里那句 `scp` 指向一个短路径;那个理由后来不成立了(教程每一步都能一键复制,
 * 用户从来不敲路径;而副本会旧、跳过还会让 `scp` 找不到文件),见
 * `docs/architecture/remote-deployment.md` §5.9。
 *
 * 两样东西在**不同的父目录**下(`Resources/relay` 与 `Resources/web-client`),所以 Upload
 * 是两行、远程名字显式写出 —— 落点不该由本地 basename 决定。
 */
export interface DeployUploadSource {
	/** 本机的 `relay.mjs`。 */
	readonly relayPath: string;
	/** 本机的网页客户端构建产物目录。 */
	readonly webClientDir: string;
}

export interface DeployStep {
	/** 文案的键:`remoteDeployStep<Id>` / `remoteDeployStep<Id>Note`。 */
	readonly id: string;
	/** 要粘进终端的一整段(多行就是多行,一条命令)。 */
	readonly command: string;
	/** 这一步要不要 sudo(界面上标出来,用户好判断该不该输密码)。 */
	readonly sudo: boolean;
	/**
	 * 这一步在**哪儿**跑。
	 *
	 * 上传那一步是**本机**命令(`scp` 从这里往外传),其余在服务器上。
	 * 自动部署必须知道这件事 —— 否则会把 `scp` 发到服务器上执行,而那边没有那些文件。
	 */
	readonly target: "local" | "server";
}

export interface DeployPlan {
	readonly steps: readonly DeployStep[];
	/** 最后一步:回到 Wordless 里填什么地址。 */
	readonly relayBaseUrl: string;
	/** 有没有可信 TLS。没有时界面要如实说"链路上是明文"。 */
	readonly secure: boolean;
	/**
	 * **跳过了哪些步骤、为什么**。
	 *
	 * 探测到服务器上已经有 Node 20 时,"装 Node"那一步就不该出现在计划里 ——
	 * 但也不能悄悄消失:用户会以为漏了。所以列出来,界面照实说。
	 */
	readonly skipped: readonly { readonly id: string; readonly reason: string }[];
	/**
	 * **走哪条反向代理路线**。
	 *
	 * 自动判断:nginx 在跑 → 用 nginx(它多半已经占着 80/443,装 Caddy 也绑不上);
	 * 否则 Caddy(没有就装)。
	 */
	readonly proxy: "caddy" | "nginx";
	/**
	 * **不拦路、但要说出来的事**:发行版不对、端口被占、这台机器上已经部署过。
	 *
	 * 它们是"失败了也看不出原因"的那一类,所以提前说。**不**因此跳过步骤 ——
	 * 跳过等于替用户做决定(他可能就是想用那个端口),而说清楚了他自己就能判断。
	 */
	readonly warnings: readonly { readonly key: string; readonly detail?: string }[];
	/** 服务器的 `/health` 地址(自检用)。 */
	readonly healthUrl: string;
}

export interface DeployPlanInput {
	/** 服务器地址:ssh / scp 的目标(域名或 IP)。 */
	readonly server: string;
	/** 登录用户(systemd 单元里要用)。 */
	readonly user: string;
	/** 指向这台服务器的域名。空 = 不做 TLS(代价见文档)。 */
	readonly domain?: string;
	/** 本机上要传上去的那两样东西(见 `DeployUploadSource`)。 */
	readonly upload: DeployUploadSource;
	/**
	 * 中继在服务器上监听哪个端口(默认 8787)。
	 *
	 * 为什么可以改:8787 可能被服务器上别的东西占着,或者用户有自己的端口规划。
	 * 它**只在本机监听**,所以这个端口不需要对外放行。
	 */
	readonly relayPort?: number;
	/**
	 * 对外用哪个端口(默认 80/443,由 Caddy 决定)。
	 *
	 * 443 之外要显式写出来(`域名:8443`),而且**必须一起出现在地址里** ——
	 * 只改服务器上的配置、地址里还写着默认端口,手机就会连到一个没人监听的端口上。
	 */
	readonly publicPort?: number;
	/**
	 * 探测结果(有就据此**跳过不需要的步骤**)。
	 *
	 * 没探测过时不会跳过任何步骤 —— 但每一条安装命令本身也**自带判断**:
	 * 照着教程手动做的人同样不会把服务器上已有的环境重装一遍。
	 */
	readonly facts?: {
		readonly node?: { readonly present: boolean; readonly version?: string; readonly major?: number };
		readonly distro?: { readonly id?: string; readonly version?: string };
		readonly caddy?: boolean;
		readonly caddyActive?: boolean;
		readonly nginx?: boolean;
		readonly nginxActive?: boolean;
		readonly deployDirExists?: boolean;
		/**
		 * 服务器上那次部署的版本(读 `${DEPLOY_REMOTE_DIR}/version.json`)。
		 *
		 * 没有版本文件 = 上一次部署发生在"我们开始写版本文件"之前 —— 那也说明**它一定是旧的**。
		 */
		readonly deployedVersion?: string;
		readonly listeningPorts?: readonly number[];
		readonly aptBusy?: boolean;
		readonly sudoNoPassword?: boolean;
	};
	/** 这台电脑上装的是哪一版(用来和服务器上那一版比 —— 见 `remoteWarnRedeployOutdated`)。 */
	readonly version?: string;
}

/**
 * 生成部署步骤。
 *
 * 没有占位符:域名、用户、路径全部填进去 —— "把 `<你的域名>` 换成你的域名"这种话
 * 每个字都认识,但抄错一次就是十分钟的困惑。
 */
export function remoteDeployPlan(input: DeployPlanInput): DeployPlan {
	/**
	 * 域名先**规范化**:用户很可能把整条地址粘进来(`https://relay.example.com/`)。
	 * 直接塞进 `server_name` 会生成一份语法没错、但永远匹配不上的 nginx 配置 ——
	 * 表现是"配置写好了,访问却还是别人的站点"。
	 */
	const domain = normalizeDomain(input.domain);
	const domainLooksWrong = (input.domain?.trim().length ?? 0) > 0 && domain === undefined;
	const secure = domain !== undefined && domain.length > 0;
	const host = secure ? (domain as string) : input.server;
	// 端口按值域收一道:填了 `0` / `99999` / 空白就退回默认,而不是生成一条起不来的命令。
	const relayPort = validPort(input.relayPort) ?? DEPLOY_RELAY_PORT;
	const publicPort = validPort(input.publicPort);
	/** 地址里的端口:443 / 80 是默认值,不写出来(写了也照样能用,但不写更干净)。 */
	const urlPort = publicPort === undefined || publicPort === 443 ? "" : `:${publicPort}`;

	/**
	 * 地址与自检地址**只在这里拼一次**。
	 *
	 * 之前是三处各拼一次(自检、返回的中继地址、界面显示),端口一可配就必然有一处忘了改 ——
	 * 而那处的表现是"手机连到一个没人监听的端口"。
	 */
	/**
	 * **有没有反向代理**,决定了三件事:中继绑哪儿、地址怎么写、要不要 TLS。
	 *
	 * - 有域名 = 有反代:中继只监听环回(`127.0.0.1`),对外由代理负责,地址用 443/自定义对外端口;
	 * - 没域名 = **没有反代**:中继自己就是对外服务,必须绑 `0.0.0.0` 并放行它那个端口 ——
	 *   否则地址写着公网端口、服务却只在环回上听,外面永远连不上(这一条原来写错了)。
	 */
	const behindProxy = secure;
	const relayHost = behindProxy ? "127.0.0.1" : "0.0.0.0";
	// 自定义对外端口 + 有域名:**签不了证书**(Let's Encrypt 的校验只认 80 与 443),
	// 所以地址给明文,并在警告里说清楚(而不是给一个连不上的 `wss://`)。
	const tlsUsable = behindProxy && (publicPort === undefined || publicPort === 80 || publicPort === 443);
	const relayBaseUrl = tlsUsable ? `wss://${host}${urlPort}` : `ws://${host}:${behindProxy ? (publicPort ?? relayPort) : relayPort}`;
	const healthUrl = tlsUsable
		? `https://${host}${urlPort}/health`
		: `http://${host}:${behindProxy ? (publicPort ?? relayPort) : relayPort}/health`;

	/** 探测说已经有 Node 20 以上:这一步整条跳过(而不是"装了也没坏处")。 */
	const nodeReady = (input.facts?.node?.major ?? 0) >= 20;
	const skipped: { id: string; reason: string }[] = [];

	/**
	 * 反代路线。
	 *
	 * **nginx 在跑就用 nginx**:它多半已经占着 80/443 —— 而 80 是 Caddy 自动签证书要用的
	 * (HTTP-01 校验 + HTTP→HTTPS 跳转),被占了 Caddy 既绑不上端口也签不下证书。
	 * 这种机器上"再装一个 Caddy"是白装。
	 */
	// nginx 装着、而且 80 被占着 —— 那多半就是它在占,别去装 Caddy 跟它抢。
	// (真实踩到:nginx 是手动起的 / 跑在 Docker 里,`systemctl is-active` 说它没在跑,
	// 于是计划去装 Caddy,而 Caddy 起不来。)
	const port80Busy = (input.facts?.listeningPorts ?? []).includes(80);
	const proxy: "caddy" | "nginx" =
		input.facts?.nginxActive === true || (input.facts?.nginx === true && port80Busy) ? "nginx" : "caddy";

	const steps: DeployStep[] = [
		{
			id: "InstallNode",
			sudo: true,
			target: "server",
			/**
			 * **有就不装**。
			 *
			 * 安装命令自带判断:已经有 Node 20 以上就原样跳过 —— 别人机器上的环境不该被我们重装一遍
			 * (可能正在跑着别的东西,而"反正装上也没坏处"是错的)。
			 * 这也让**照着教程手动做**的人和自动部署走同一条安全路径。
			 */
			command: [
				'current=$(node -v 2>/dev/null || echo none)',
				'major=$(printf %s "$current" | sed "s/^v//;s/\\..*//")',
				'if [ "$current" != none ] && [ "$major" -ge 20 ] 2>/dev/null; then',
				'  echo "已经有 Node $current,跳过安装"',
				"else",
				"  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -",
				`  sudo apt-get install -y ${APT_LOCK_OPTIONS} nodejs`,
				"fi",
				"node -v",
			].join("\n"),
		},
		{
			id: "PrepareDir",
			sudo: true,
			target: "server",
			// `web-client` 这一层**必须先建**:上传那一步是"把目录内容落进去",目标不存在就没地方落。
			command: [
				`sudo mkdir -p ${DEPLOY_REMOTE_DIR}/web-client`,
				`sudo chown -R ${input.user} ${DEPLOY_REMOTE_DIR}`,
			].join("\n"),
		},
		{
			id: "Upload",
			sudo: false,
			target: "local",
			/*
				两行,而且**远程名字是显式写出来的**。

				不能写成"一个目录里装两样东西,整体 scp 过去":那样远程文件名由**本地 basename**
				决定 —— 打包版里 web 客户端是 `…/Resources/web-client`(正好),开发版却是
				`apps/web-client/dist`(会传成 `dist/`),而 systemd 单元认的是 `web-client`。
				显式写名字之后,来源叫什么、在哪儿,都无所谓了。

				`web-client` 那行传的是**目录内容**(`"…"/*`):目标是 PrepareDir 建好的目录,
				逐项落进去是覆盖合并 —— 重复部署是幂等的,而且不用先删掉旧目录
				(删了万一这次上传失败,线上就只剩 404 了)。

				引号**只包住目录那一段**,`/*` 留在外面 —— 路径里有空格是常事(Windows 的用户名、
				改过的"下载"目录),而"引号包住整个含通配符的路径"会让通配符不再展开。
			*/
			command: [
				`scp -r "${input.upload.relayPath}" ${input.user}@${input.server}:${DEPLOY_REMOTE_DIR}/relay.mjs`,
				`scp -r "${input.upload.webClientDir}"/* ${input.user}@${input.server}:${DEPLOY_REMOTE_DIR}/web-client/`,
			].join("\n"),
		},
		{
			id: "Service",
			sudo: true,
			target: "server",
			command: [
				`sudo tee /etc/systemd/system/wordless-relay.service > /dev/null <<'UNIT'`,
				"[Unit]",
				"Description=Wordless relay",
				"After=network.target",
				"",
				"[Service]",
				`ExecStart=/usr/bin/env node ${DEPLOY_REMOTE_DIR}/relay.mjs --port ${relayPort} --host ${relayHost} --web-root ${DEPLOY_REMOTE_DIR}/web-client`,
				`User=${input.user}`,
				"Restart=always",
				"",
				"[Install]",
				"WantedBy=multi-user.target",
				"UNIT",
				"sudo systemctl daemon-reload",
				"sudo systemctl enable wordless-relay",
				/*
					**重启,不是 `enable --now`。**

					`enable --now` 对"已经在跑"的服务是**空操作** —— 于是升级部署(这台服务器上
					已经部署过一次)会出现最典型的那个坑:新的 `relay.mjs` 躺在磁盘上,而进程里
					跑的还是旧代码。`restart` 两边都对:没在跑就起来,在跑就换成新的。
				*/
				"sudo systemctl restart wordless-relay",
				"systemctl --no-pager status wordless-relay | head -12",
			].join("\n"),
		},
	];

	if (secure && proxy === "nginx") {
		/**
		 * nginx 路线。
		 *
		 * 我们自己只写一个 **server 块**(反代到本机中继 + WebSocket 升级头),
		 * 证书交给 **certbot** —— 它是 nginx 这条路上最通行的做法:自己改配置加 443、自己续期。
		 */
		steps.push(
			{
				id: "NginxSite",
				sudo: true,
				target: "server",
				command: [
					`sudo tee /etc/nginx/conf.d/wordless-relay.conf > /dev/null <<'NGINX'`,
					`# wordless-relay`,
					`server {`,
					// 对外端口可以不是 80/443(用户要的):代理只监听这一个端口。
					`\tlisten ${publicPort ?? 80};`,
					`\tserver_name ${domain};`,
					``,
					`\tlocation / {`,
					`\t\tproxy_pass http://127.0.0.1:${relayPort};`,
					// WebSocket 升级:中继全靠它,少了这一行手机连上就立刻断。
					`\t\tproxy_http_version 1.1;`,
					`\t\tproxy_set_header Upgrade $http_upgrade;`,
					`\t\tproxy_set_header Connection "upgrade";`,
					`\t\tproxy_set_header Host $host;`,
					// 长连接:手机挂着不动时不该被 nginx 掐断。
					`\t\tproxy_read_timeout 3600s;`,
					`\t}`,
					`}`,
					"NGINX",
					// 先验配置:语法错的话 reload 只会说"配置有问题",看不出是哪一行。
					"sudo nginx -t",
					"sudo systemctl reload nginx",
				].join("\n"),
			},
			...(publicPort === undefined || publicPort === 80 || publicPort === 443
				? [
						{
							id: "NginxCert",
							sudo: true,
							target: "server" as const,
							command: [
					`sudo apt-get install -y ${APT_LOCK_OPTIONS} certbot python3-certbot-nginx`,
					// `--redirect` 顺手把 HTTP 跳转到 HTTPS;不填邮箱是刻意的(不替用户订阅通知)。
					`sudo certbot --nginx -d ${domain} --redirect --non-interactive --agree-tos --register-unsafely-without-email`,
					// 成败由最后一条命令决定:确认证书真的装上了。
					`sudo test -f /etc/letsencrypt/live/${domain}/fullchain.pem`,
							].join("\n"),
						},
					]
				: []),
		);
	}

	if (secure && proxy === "caddy") {
		/**
		 * 装 Caddy:**已经装好就跳过**(apt 虽然幂等,但每次 update 都很慢)。
		 *
		 * 注意"装好"≠"配好":下面那一步(写配置、reload)无论如何都要做 ——
		 * 把两步一起塞进 else 里是错的(测试当场抓到了)。
		 */
		if (input.facts?.caddy === true) {
			skipped.push({ id: "InstallCaddy", reason: "caddy" });
		} else {
			steps.push({
				id: "InstallCaddy",
				sudo: true,
				target: "server",
				command: [
					`sudo apt-get install -y ${APT_LOCK_OPTIONS} debian-keyring debian-archive-keyring apt-transport-https curl`,
					"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
					"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list",
					`sudo apt-get update ${APT_LOCK_OPTIONS}`,
					`sudo apt-get install -y ${APT_LOCK_OPTIONS} caddy`,
					// 这一步的成败由**最后一条命令**决定:所以最后确认一次它真的装上了 ——
					// 否则前面失败、后面成功,这一步会被报成"成功"(真实踩到的那次就是这个形状)。
					"command -v caddy",
				].join("\n"),
			});
		}

		steps.push({
			id: "Tls",
			sudo: true,
			target: "server",
			/**
			 * Caddy 自己去签证书、自己续期,并**自动处理 WebSocket 升级** —— 不用我们写代理细节。
			 *
			 * 但**不能覆盖别人已有的 Caddyfile**:那台机器上可能还挂着别的站点,
			 * `tee` 一把盖掉等于把别人的服务弄停。所以:已经有我们的那一段就跳过,
			 * 有别的配置就**追加**,什么都没有才新建。
			 */
			command: [
				`if sudo grep -q "wordless-relay" /etc/caddy/Caddyfile 2>/dev/null; then`,
				`  echo "Caddyfile 里已经有 wordless-relay,跳过"`,
				`else`,
				`  sudo tee -a /etc/caddy/Caddyfile > /dev/null <<'CADDY'`,
				``,
				`# wordless-relay`,
				// 端口不是 443 时要显式写在站点地址里,否则 Caddy 只会听 80/443。
				`${domain}${publicPort === undefined || publicPort === 443 ? "" : `:${publicPort}`} {`,
				`\treverse_proxy 127.0.0.1:${relayPort}`,
				"}",
				"CADDY",
				"fi",
				// 先验配置:语法错的话,restart 只会说"服务没起来",看不出是哪一行错了。
				"sudo caddy validate --config /etc/caddy/Caddyfile",
				// **restart 而不是 reload**:reload 要求服务已经在跑,而刚装好的机器上它可能是停的
				// (真实踩到:`caddy.service is not active, cannot reload`)。
				// restart 对"停着的"会把它起来,对"在跑的"会平滑重载 —— 两种都对。
				"sudo systemctl enable caddy",
				"sudo systemctl restart caddy",
				// 成败由最后一条命令决定:确认它真的在跑;没起来就把它自己的日志摆出来。
				// "起不来"的原因太多(端口被占、配置错、域名解析不对),只有它自己的日志说得清。
				"systemctl is-active caddy || { systemctl status caddy --no-pager | tail -20; journalctl -u caddy -n 30 --no-pager; exit 1; }",
			].join("\n"),
		});
	}

	const warnings: { key: string; detail?: string }[] = [];
	if (domainLooksWrong) {
		// 不当域名用,但**说清楚**(静默忽略会让用户拿到一个 ws:// 地址而不知道为什么)。
		warnings.push({ key: "remoteWarnDomainIgnored", detail: input.domain?.trim() ?? "" });
	}
	if (behindProxy && !tlsUsable) {
		// 自定义对外端口上**签不了证书**:Let's Encrypt 的校验只认 80(HTTP-01)与 443(TLS-ALPN-01)。
		warnings.push({ key: "remoteWarnNoTlsOnCustomPort", detail: String(publicPort ?? relayPort) });
	}
	if (!behindProxy) {
		// 没有域名 = 中继自己对外:绑 0.0.0.0,而且那个端口要放行。
		warnings.push({ key: "remoteWarnDirectExposure", detail: String(relayPort) });
	}

	/** 我们的命令是 apt + nodesource 那一套:别的发行版上会以"某一步 exit 1"的形式失败。 */
	const distroId = input.facts?.distro?.id;
	const debianLike = distroId === undefined || distroId === "ubuntu" || distroId === "debian";
	if (!debianLike) {
		warnings.push({ key: "remoteWarnDistro", detail: `${distroId} ${input.facts?.distro?.version ?? ""}`.trim() });
	}
	// 端口被占:装得再好也起不来,而报错只会说"服务没起来"。
	const listening = input.facts?.listeningPorts ?? [];
	if (listening.includes(relayPort)) {
		warnings.push({ key: "remoteWarnRelayPort", detail: String(relayPort) });
	}
	if (secure && listening.includes(80)) {
		warnings.push({ key: "remoteWarnPort80", detail: "80" });
	}
	if (secure && listening.includes(443)) {
		// 443 上已经有东西(多半是 nginx/apache):Caddy 抢不到,证书也就签不下来。
		warnings.push({ key: "remoteWarnPort443", detail: "443" });
	}
	if (secure && proxy === "nginx" && (input.facts?.caddy === true || input.facts?.caddyActive === true)) {
		// 上一次部署可能留下过 Caddy(甚至还在跑)。两个反代抢 80/443 时,后起的那个起不来。
		warnings.push({ key: "remoteWarnCaddyLeftover" });
	}
	if (secure && proxy === "nginx") {
		// 说清楚为什么不是 Caddy:用户看到"教程里写的是 Caddy"会以为我们跑错了。
		warnings.push({ key: "remoteWarnNginxPath" });
	}
	if (secure && proxy === "caddy" && input.facts?.caddy !== true && input.facts?.nginxActive !== true) {
		// 80/443 被占、但既不是 nginx 也不是 caddy:多半是别的东西,先弄清楚是谁。
		const busy = input.facts?.listeningPorts ?? [];
		if (busy.includes(80) || busy.includes(443)) {
			warnings.push({ key: "remoteWarnUnknownProxy", detail: busy.filter((port) => port === 80 || port === 443).join(" / ") });
		}
	}
	if (input.facts?.caddy === true && input.facts?.caddyActive === false && proxy === "caddy") {
		// 装着但没在跑:我们会 restart 把它起来(而不是 reload —— reload 对停着的服务会失败)。
		warnings.push({ key: "remoteWarnCaddyInactive" });
	}
	if (input.facts?.aptBusy === true) {
		// 不拦路:我们给 apt 加了等锁参数,它会等 —— 但用户看到"卡在这里"时得能对上号。
		warnings.push({ key: "remoteWarnAptBusy" });
	}
	if (input.facts?.sudoNoPassword === false) {
		// 这一条**会拦路**(部署跑不下去):我们是拿 `ssh host bash -s` 跑命令的,没有终端可以输密码。
		warnings.push({ key: "remoteWarnSudoPassword" });
	}
	if (input.facts?.deployDirExists === true) {
		warnings.push({ key: "remoteWarnRedeploy", detail: DEPLOY_REMOTE_DIR });
		/**
		 * 服务器上那一版**是不是旧的**。
		 *
		 * 这是"我更新了桌面端,要不要重新部署一次"这个问题的答案 —— 以前只能靠用户自己记
		 * ("上次部署是什么时候来着")。三种情形分开说,因为要做的事不一样:
		 * 版本一致(不用动)、版本不同(重新部署)、读不出(一定是老部署,重新部署)。
		 */
		const deployed = input.facts?.deployedVersion;
		if (input.version !== undefined && deployed !== input.version) {
			warnings.push({
				key: deployed === undefined ? "remoteWarnRedeployUnknown" : "remoteWarnRedeployOutdated",
				detail: deployed === undefined ? input.version : `${deployed} → ${input.version}`,
			});
		}
	}

	if (nodeReady) {
		// 已经在计划里生成过了:这里只把它**拿掉**,并记下为什么。
		const index = steps.findIndex((step) => step.id === "InstallNode");
		if (index >= 0) steps.splice(index, 1);
		skipped.push({ id: "InstallNode", reason: input.facts?.node?.version ?? "" });
	}

	steps.push({
		id: "Verify",
		sudo: false,
		target: "server",
		command: `curl -fsS ${healthUrl} && echo ""`,
	});

	/**
	 * **记下这一版**。
	 *
	 * 排在最后(服务起来了、自检也过了才写):这样"服务器上是 vX"是一句**真话** ——
	 * 写早了的话,服务没起来也照样写着新版本,而用户下次看到版本一致就以为不用重新部署。
	 * 探测读的就是它(见 `remoteWarnRedeployOutdated`):"我更新了桌面端,要不要再部署一次"
	 * 从此不必靠记忆。
	 */
	if (input.version !== undefined) {
		steps.push({
			id: "Stamp",
			sudo: true,
			target: "server",
			command: [
				`sudo tee ${DEPLOY_REMOTE_DIR}/version.json > /dev/null <<'JSON'`,
				`{"version":"${input.version}","deployedAt":"${new Date().toISOString()}"}`,
				"JSON",
				`cat ${DEPLOY_REMOTE_DIR}/version.json`,
			].join("\n"),
		});
	}

	return {
		steps,
		proxy,
		skipped,
		warnings,
		relayBaseUrl,
		secure,
		healthUrl,
	};
}

/**
 * 域名规范化:去掉协议、路径、末尾的点,转小写。
 *
 * 只认"像域名"的写法(至少一个点、标签只含字母数字与连字符):证书签的是**名字**,
 * 签给 IP 是不行的,而 `192.168.1.9` 这种值填进 `server_name` 只会让人困惑。
 * 不合法时返回 `undefined`(当作没填),由调用方**配一条警告**说明 —— 不静默忽略。
 */
export function normalizeDomain(input: string | undefined): string | undefined {
	const trimmed = input?.trim();
	if (trimmed === undefined || trimmed.length === 0) return undefined;
	const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	const host = withoutScheme.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
	// 去掉端口(域名不写端口)与末尾的点(`example.com.` 是合法的 FQDN 写法)。
	const name = (host.split(":")[0] ?? "").replace(/\.$/, "").toLowerCase();
	const looksLikeDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name);
	// IPv4 字面量**不算域名**:Let's Encrypt 不给 IP 签证书(默认),填进去只会让人困惑。
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return undefined;
	return looksLikeDomain ? name : undefined;
}

/** 端口合法就给出来,否则当作"没填"。 */
function validPort(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1 || value > 65_535) return undefined;
	return value;
}

/**
 * 服务器要求(不是命令,是"先确认这几件事")。
 *
 * 域名那一条要**说清为什么**:证书签给域名,不签给 IP —— 没有域名就只能明文,
 * 而这正是我们推荐先上域名的原因。
 */
export const DEPLOY_REQUIREMENTS = ["Server", "Domain", "Ports", "Node"] as const;
