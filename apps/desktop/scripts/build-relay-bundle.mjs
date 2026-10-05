import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "vite";

/**
 * 把中继打成**一个自包含的 `relay.mjs`** —— 远程部署时要传到服务器上去的那一个文件。
 *
 * 为什么必须自包含:服务器上**不装 npm 依赖**。部署应该是"上传两个东西 + 起服务",
 * 而不是"在服务器上 npm install"(那要装构建工具、要联网、要等,而且失败的样子千奇百怪)。
 *
 * 所以 `ws` 要**打进去**(它在桌面端主进程里是 external 的,那是另一回事:那边随包发布)。
 * 而 `ws` 的可选原生加速(`bufferutil` / `utf-8-validate`)保持 external —— 它们只是加速,
 * 没有也能跑,而带上它们就得为每个平台准备二进制。
 *
 * 产物随包发布(`electron-builder.yml` 的 extraResources),"准备部署包"时复制到用户选的位置。
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appRoot, "../..");
const outputDirectory = resolve(appRoot, "resources/relay");

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);
/** 可选的原生加速:`ws` 有它们更快,没有也能跑。 */
const optionalNatives = new Set(["bufferutil", "utf-8-validate"]);

export async function buildRelayBundle() {
	await build({
		configFile: false,
		logLevel: "error",
		publicDir: false,
		root: repositoryRoot,
		build: {
			outDir: outputDirectory,
			emptyOutDir: true,
			// 目标是 Node:内置模块留在外面,其余全部打进来。
			ssr: true,
			minify: false,
			lib: {
				entry: resolve(repositoryRoot, "apps/relay/src/main.ts"),
				formats: ["esm"],
				fileName: () => "relay.mjs",
			},
			rollupOptions: {
				external: (id) => nodeBuiltins.has(id) || id.startsWith("node:") || optionalNatives.has(id),
				// 单文件:服务器上只传这一个,所以不许拆 chunk。
				output: { entryFileNames: "relay.mjs", codeSplitting: false },
			},
			// `noExternal: true` 把依赖也打进来(默认会外化所有依赖)。
			ssrEmitAssets: false,
		},
		ssr: { noExternal: true },
	});
	return resolve(outputDirectory, "relay.mjs");
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const output = await buildRelayBundle();
	process.stdout.write(`relay bundle: ${output}\n`);
}
