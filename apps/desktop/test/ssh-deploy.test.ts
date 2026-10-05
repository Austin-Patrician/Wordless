import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SshDeploy, type SshTarget } from "../src/main/remote/ssh-deploy.ts";
import type { DeployStep } from "../src/main/remote/deploy-plan.ts";

/**
 * 远程部署的执行器。
 *
 * 这里**不连真的服务器**(那要凭据,而且不可重复),而是注入 spawn 看它到底怎么调:
 * 认证参数、命令去哪儿跑、失败停不停、密码临时文件删没删。
 * 这几件事任何一件错了,表现都是"点了没反应"或者更糟的"密码留在了磁盘上"。
 */

interface SpawnCall {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly stdin: string;
}

const createFakeSpawn = (options: { readonly failOn?: string; readonly exitCode?: number } = {}) => {
	const calls: SpawnCall[] = [];
	let pendingStdin = "";
	const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
		const child = new EventEmitter() as EventEmitter & {
			stdout: EventEmitter;
			stderr: EventEmitter;
			stdin: { end: (value?: string) => void; on: () => void };
			kill: () => void;
		};
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdin = {
			end: (value?: string) => {
				pendingStdin = value ?? "";
				const call = calls.at(-1);
				if (call !== undefined) calls[calls.length - 1] = { ...call, stdin: pendingStdin };
				const failed = options.failOn !== undefined && (pendingStdin.includes(options.failOn) || args.join(" ").includes(options.failOn));
				child.stdout.emit("data", Buffer.from(failed ? "boom: 命令失败\n" : "ok\n"));
				queueMicrotask(() => child.emit("close", failed ? 1 : (options.exitCode ?? 0)));
			},
			on: () => undefined,
		};
		child.kill = () => undefined;
		calls.push({ command, args, env: settings.env, stdin: "" });
		return child;
	}) as never;
	return { spawn, calls };
};

const target = (auth: SshTarget["auth"] = { kind: "key" }): SshTarget => ({
	host: "1.2.3.4",
	user: "ubuntu",
	port: 2222,
	auth,
});

const step = (id: string, command: string, where: "local" | "server"): DeployStep => ({
	id,
	command,
	sudo: false,
	target: where,
});

describe("SSH 部署执行器", () => {
	it("密钥认证:走系统 ssh,带端口与主机密钥策略", async () => {
		const fake = createFakeSpawn();
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target());
		assert.equal(result.ok, true);
		assert.ok(result.findings.length >= 0);
		const call = fake.calls[0];
		assert.equal(call?.command, "ssh");
		assert.ok(call?.args.includes("2222"), "端口要带上");
		assert.ok(call?.args.includes("StrictHostKeyChecking=accept-new"), "第一次记录指纹");
		assert.ok(call?.args.includes("BatchMode=yes"), "密钥认证不给交互的机会");
		assert.equal(call?.args.at(-1), "bash -s", "命令从 stdin 进,避开引号地狱");
		assert.match(call?.stdin ?? "", /uname -srm/, "探测是只读的");
	});

	it("探测失败:把 ssh 的原话带回来,而不是一句笼统的连不上", async () => {
		const fake = createFakeSpawn({ failOn: "uname" });
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target());
		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /boom/, "ssh 的 stderr 原样带回来");
	});

	it("密码认证:走 SSH_ASKPASS,而且**用完就删**", async () => {
		const fake = createFakeSpawn();
		const root = join(tmpdir(), "wordless-askpass-test");
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: root });
		await deploy.probe(target({ kind: "password", password: "hunter2'$x" }));
		const call = fake.calls[0];
		const script = call?.env.SSH_ASKPASS;
		assert.ok(script, "要给出 askpass 脚本");
		assert.equal(call?.env.SSH_ASKPASS_REQUIRE, "force");
		// 密码**不在命令行里**:命令行对同机的任何进程可见。
		assert.equal(call?.args.join(" ").includes("hunter2"), false);
		// 连接结束(无论成败)之后临时目录必须没了 —— 否则密码留在了磁盘上。
		await assert.rejects(() => readdir(join(root, script.split("/").at(-2) ?? "")));
	});

	it("askpass 脚本**真的原样输出**密码(引号、$、空格都不能被 shell 吃掉)", async () => {
		// 这是整条密码链路里最容易错的一处:脚本要"输出这段密码",而密码里可能有引号与 $。
		// 做法是让 fake spawn 在**脚本还在的时候**真的执行它一次,比对输出。
		const tricky = `a'b$c"d e`;
		let printed = "";
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const script = settings.env.SSH_ASKPASS;
			if (script !== undefined && printed === "") {
				printed = execFileSync("/bin/sh", [script], { encoding: "utf8" }).trim();
			}
			return (fake.spawn as never as (...rest: unknown[]) => unknown)(command, args, settings);
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		await deploy.probe(target({ kind: "password", password: tricky }));
		assert.equal(printed, tricky, "脚本输出必须与密码逐字相同");
	});

	it("逐步执行:本地那一步在**本机**跑,服务器那几步走 ssh", async () => {
		const fake = createFakeSpawn();
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		const seen: string[] = [];
		const result = await deploy.run(
			target(),
			[step("Upload", "scp -r a b", "local"), step("Verify", "curl -fsS /health", "server")],
			(progress) => seen.push(`${progress.id}:${progress.status}`),
		);
		assert.equal(result.ok, true);
		assert.deepEqual(seen, ["Upload:running", "Upload:done", "Verify:running", "Verify:done"]);
		assert.equal(fake.calls[0]?.command, "/bin/bash", "上传是本机命令");
		// 本机那一步把命令作为 `bash -lc <命令>` 传:没有引号地狱(它是我们自己的计划,不是用户输入)。
		assert.match(fake.calls[0]?.args.join(" ") ?? "", /scp -r a b/);
		assert.equal(fake.calls[1]?.command, "ssh");
	});

	it("某一步失败:立刻停下,并把那一步的输出交出来", async () => {
		const fake = createFakeSpawn({ failOn: "systemctl" });
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		const progress: Array<{ id: string; status: string; output?: string }> = [];
		const result = await deploy.run(
			target(),
			[step("InstallNode", "echo installing", "server"), step("Service", "systemctl enable", "server")],
			(entry) => progress.push(entry),
		);
		assert.equal(result.ok, false);
		assert.equal(result.failedStep, "Service");
		assert.equal(progress.at(-1)?.status, "failed");
		assert.match(progress.at(-1)?.output ?? "", /boom/, "失败那一步的输出要能看到");
		assert.equal(progress.some((entry) => entry.id === "Verify"), false, "失败之后不该继续");
	});

	it("探测结果**结构化**:Node 装没装、够不够用,不能只给一行字让界面去猜", async () => {
		// 计划要据此**跳过**不需要的步骤,所以这里必须给出可判断的字段。
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			// 让探测命令输出一台"已经有 Node 20 且有 sudo"的服务器。
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit("data", Buffer.from("system=Linux 6.8 x86_64\nuser=ubuntu\nsudo=yes\nnode=v20.11.0\narch=x86_64\n"));
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target());
		assert.equal(result.ok, true);
		assert.equal(result.facts.node.present, true);
		assert.equal(result.facts.node.version, "v20.11.0");
		assert.equal(result.facts.node.major, 20, "主版本号要能直接比");
		assert.equal(result.facts.sudo, true);
		assert.equal(result.facts.user, "ubuntu");
	});

	it("没装 Node:结构化结果说清楚(而不是给一个空版本号)", async () => {
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit("data", Buffer.from("system=Linux\nuser=root\nsudo=no\nnode=none\narch=aarch64\n"));
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target());
		assert.equal(result.facts.node.present, false);
		assert.equal(result.facts.node.version, undefined);
		assert.equal(result.facts.sudo, false);
	});

	it("探测还要问会不会撞车的那几件事:发行版、反向代理、目标目录、端口占用", async () => {
		// 只问"要装什么"是不够的:端口被占、发行版不对,失败时会以"某一步 exit 1"的形式出现,
		// 那句话完全看不出真正的原因。
		const fake = createFakeSpawn();
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		await deploy.probe(target(), [80, 443, 9001]);
		const probe = fake.calls[0]?.stdin ?? "";
		assert.match(probe, /os-release/, "发行版要问");
		assert.match(probe, /command -v caddy/, "反向代理装没装要问");
		assert.match(probe, /aptbusy=/, "apt 是不是正在跑要问(dpkg 锁被占时 apt 会失败)");
		assert.match(probe, /nginxrunning=/, "nginx 有没有进程要问(systemd 只认 systemd 管的)");
		assert.match(probe, /sudonopass=/, "能不能免密 sudo 要问(没有终端可以输密码)");
		assert.match(probe, /-d \/opt\/wordless-relay/, "目标目录在不在要问(在 = 覆盖升级)");
		assert.match(probe, /deployedversion=/, "服务器上是哪一版要读回来(升级部署的核心问题)");
		// 卸载是"删东西":服务器上到底有什么必须先问清楚,否则只能照着脚本盲删。
		assert.match(probe, /serviceexists=/, "服务单元在不在要问");
		assert.match(probe, /serviceactive=/, "服务活没活着要问");
		assert.match(probe, /nginxconf=/, "我们写的 nginx 站点在不在要问");
		assert.match(probe, /caddyblock=/, "Caddyfile 里有没有我们那一段要问");
		// 探测是只读的、不该卡住:读 Caddyfile 的 sudo 必须带 `-n`(否则会挂在那里等密码)。
		assert.match(probe, /sudo -n grep -q wordless-relay/);
		assert.match(probe, /dev\/tcp\/127\.0\.0\.1\/80/, "端口占用要问");
		assert.match(probe, /dev\/tcp\/127\.0\.0\.1\/9001/, "要问的端口由调用方给(含中继端口)");
		// 端口探测不依赖 `ss` / `netstat` / `lsof`:它们不一定装。
		assert.equal(/\bss -|netstat|lsof/.test(probe), false);
	});

	it("探测结果里撞车的几项也要结构化", async () => {
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit(
					"data",
					Buffer.from(
						"system=Linux\nuser=ubuntu\nsudo=yes\nnode=v20.11.0\narch=x86_64\ndistro=ubuntu\ndistro_version=22.04\ncaddy=yes\ncaddyactive=no\nnginx=yes\nnginxactive=no\nnginxrunning=yes\ndeploydir=yes\naptbusy=yes\nsudonopass=no\nport_80=yes\nport_443=no\n",
					),
				);
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target(), [80, 443]);
		assert.equal(result.facts.distro?.id, "ubuntu");
		assert.equal(result.facts.distro?.version, "22.04");
		assert.equal(result.facts.caddy, true, "装着");
		assert.equal(result.facts.caddyActive, false, "但没在跑(真实踩到过)")
		// 装着、systemd 说没在跑,但有进程:合并之后算"在跑"(手动起的 / Docker 里的)。
		assert.equal(result.facts.nginxActive, true);
		assert.equal(result.facts.deployDirExists, true);
		assert.deepEqual(result.facts.listeningPorts, [80], "只有真的在监听的才算");
		assert.equal(result.facts.aptBusy, true);
		assert.equal(result.facts.sudoNoPassword, false);
	});

	it("服务器上那一版**读回来**:升级部署的判据(读不出来就是没有那行)", async () => {
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit("data", Buffer.from("system=Linux\nuser=ubuntu\nsudo=yes\nnode=v20.11.0\narch=x86_64\ndeploydir=yes\ndeployedversion=1.2.0\n"));
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target(), [80]);
		assert.equal(result.facts.deployedVersion, "1.2.0");
	});

	it("卸载要看的那四项也要结构化(缺着 = 没探到 = 当没有,不猜)", async () => {
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit(
					"data",
					Buffer.from("system=Linux\nuser=ubuntu\nsudo=yes\nnode=v20.11.0\narch=x86_64\nserviceexists=yes\nserviceactive=no\nnginxconf=yes\ncaddyblock=no\n"),
				);
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target(), [80]);
		assert.equal(result.facts.serviceExists, true);
		assert.equal(result.facts.serviceActive, false, "装着但没在跑(升级部署之后重启过就是这个形状)");
		assert.equal(result.facts.nginxSiteExists, true);
		assert.equal(result.facts.caddyBlockExists, false);
	});

	it("探不通时:那四项一律按「没有」算(卸载那边据此一行都不动)", async () => {
		const fake = createFakeSpawn();
		const deploy = new SshDeploy({ spawn: fake.spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe({ host: "1.2.3.4", user: "ubuntu", auth: { kind: "key" } }, [80]);
		assert.equal(result.ok, true);
		assert.equal(result.facts.serviceExists, false);
		assert.equal(result.facts.nginxSiteExists, false);
		assert.equal(result.facts.caddyBlockExists, false);
	});

	it("老部署(还没有版本文件):这一项**缺着**,而不是空字符串", async () => {
		const fake = createFakeSpawn();
		const spawn = ((command: string, args: readonly string[], settings: { env: NodeJS.ProcessEnv }) => {
			const child = (fake.spawn as never as (c: string, a: readonly string[], s: unknown) => {
				stdout: EventEmitter;
				stderr: EventEmitter;
				stdin: { end: (value?: string) => void; on: () => void };
				kill: () => void;
			})(command, args, settings);
			const original = child.stdin.end;
			child.stdin.end = (value?: string) => {
				original.call(child.stdin, value);
				child.stdout.emit("data", Buffer.from("system=Linux\nuser=ubuntu\nsudo=yes\nnode=v20.11.0\narch=x86_64\ndeploydir=yes\n"));
			};
			return child;
		}) as never;
		const deploy = new SshDeploy({ spawn, tmpRoot: tmpdir() });
		const result = await deploy.probe(target(), [80]);
		// 缺着 = "读不出来" = 一定是老部署 —— 计划据此提醒重新部署,所以不能是空字符串。
		assert.equal("deployedVersion" in result.facts, false);
	});
});
