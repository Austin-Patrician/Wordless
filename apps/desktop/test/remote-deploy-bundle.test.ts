import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { prepareDeployBundle } from "../src/main/remote/deploy-bundle.ts";

/**
 * "准备部署包"。
 *
 * 这一步存在的理由:教程里那句 `scp` 必须指向**真实存在的路径** ——
 * 让用户自己去安装目录里翻 `relay.mjs` 与 `web-client` 是不现实的。
 * 所以这里钉住的是"复制出来的东西真的能用":两个文件都在,而且每次都覆盖成最新的一份。
 */

const setup = async (): Promise<{ relayBundlePath: string; webClientDir: string; targetDir: string; root: string }> => {
	const root = await mkdtemp(join(tmpdir(), "wordless-deploy-"));
	const relayBundlePath = join(root, "relay.mjs");
	await writeFile(relayBundlePath, "// relay bundle v1");
	const webClientDir = join(root, "dist");
	await mkdir(webClientDir, { recursive: true });
	await writeFile(join(webClientDir, "index.html"), "<!doctype html>v1");
	return { relayBundlePath, webClientDir, targetDir: join(root, "out"), root };
};

describe("准备部署包", () => {
	it("把中继单文件与网页客户端复制到目标目录", async () => {
		const rig = await setup();
		const result = await prepareDeployBundle(rig);
		assert.equal(result.ok, true);
		assert.equal(result.dir, rig.targetDir);
		assert.equal(await readFile(join(rig.targetDir, "relay.mjs"), "utf8"), "// relay bundle v1");
		assert.match(await readFile(join(rig.targetDir, "web-client", "index.html"), "utf8"), /v1/);
	});

	it("每次都覆盖:部署包最怕的就是旧", async () => {
		const rig = await setup();
		await prepareDeployBundle(rig);
		await writeFile(rig.relayBundlePath, "// relay bundle v2");
		const again = await prepareDeployBundle(rig);
		assert.equal(again.ok, true);
		assert.equal(await readFile(join(rig.targetDir, "relay.mjs"), "utf8"), "// relay bundle v2");
	});

	it("缺中继单文件:说清是**哪一样**缺,而不是笼统的失败", async () => {
		const rig = await setup();
		const result = await prepareDeployBundle({ ...rig, relayBundlePath: join(rig.root, "nope.mjs") });
		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /中继单文件/);
	});

	it("缺网页客户端产物:同样说清", async () => {
		const rig = await setup();
		const result = await prepareDeployBundle({ ...rig, webClientDir: join(rig.root, "no-dist") });
		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /网页客户端/);
	});
});
