import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * "准备部署包":把要传到服务器上的**两样东西**复制到一个用户找得到的地方。
 *
 * 为什么要有这一步:教程里那句 `scp` 得指向**真实存在的路径**。让用户自己去安装目录里翻
 * `relay.mjs` 和 `web-client`(而且还要在打包版里找到 `app.asar` 旁边),是不现实的。
 *
 * 复制而不是"就地引用":安装目录随时可能被升级/卸载,用户手里的部署包不该跟着变。
 */

export interface DeployBundleInput {
	/** 中继单文件(随包发布,见 `scripts/build-relay-bundle.mjs`)。 */
	readonly relayBundlePath: string;
	/** 网页客户端构建产物目录。 */
	readonly webClientDir: string;
	/** 目标目录(通常是"下载"里的一个固定子目录)。 */
	readonly targetDir: string;
}

export interface DeployBundleResult {
	readonly ok: boolean;
	readonly dir?: string;
	/** 缺哪一样、为什么,原样带回给用户看。 */
	readonly error?: string;
}

export async function prepareDeployBundle(input: DeployBundleInput): Promise<DeployBundleResult> {
	try {
		await assertFile(input.relayBundlePath);
	} catch {
		return { ok: false, error: "这台机器上还没有中继单文件(打包时生成,开发版需要先构建一次)。" };
	}
	try {
		await assertFile(join(input.webClientDir, "index.html"));
	} catch {
		return { ok: false, error: "还没有网页客户端的构建产物,先构建一次再准备部署包。" };
	}
	try {
		// 每次都重新铺一遍:上一次的内容可能已经是旧版本,而"部署包"最怕的就是旧。
		await mkdir(input.targetDir, { recursive: true });
		await cp(input.relayBundlePath, join(input.targetDir, "relay.mjs"));
		await cp(input.webClientDir, join(input.targetDir, "web-client"), { recursive: true });
	} catch (cause) {
		return { ok: false, error: `复制部署包失败:${cause instanceof Error ? cause.message : String(cause)}` };
	}
	return { ok: true, dir: input.targetDir };
}

async function assertFile(path: string): Promise<void> {
	const info = await stat(path);
	if (!info.isFile()) throw new Error(`${path} 不是文件`);
}
