import { dirname, resolve } from "node:path";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { generateAppIcon } from "./generate-app-icon.mjs";
import { readWindowsIcon } from "./windows-icon.mjs";
import { isExternalRuntimeDependency } from "./external-packages.mjs";
import { assertNodeResolution, browserFieldSubstitutions, describeSubstitutions } from "./bundle-resolution-guard.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appRoot, "../..");
const outputDirectory = resolve(appRoot, "dist/electron");
const applicationIcon = resolve(appRoot, "src/icons/common-icons/wordless.png");
const windowsApplicationIcon = resolve(appRoot, "build/icon.ico");
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);

function isNodeBuiltin(id) {
  return nodeBuiltins.has(id) || id.startsWith("node:");
}

/**
 * **外化判定的规则表在 `scripts/external-packages.mjs`。**
 *
 * 这里原来是两张手写的谓词。它们只说"什么不该被内联",没说"那它从哪来" —— 于是
 * `@tailwindcss/node` 被 external 了却没随包发布,安装版永远缺一份编译器运行时。
 * 规则表因此多了一栏 `shippedBy`,由 `test/external-runtime-packages.test.ts` 守着。
 */

/**
 * 主进程的解析配置:**按 Node 的规则,不带 `browser`**。
 *
 * vite 默认用 client 规则(含 `browser`),而 electron 主进程是 Node 环境。任何声明了
 * `browser` 字段(或 `exports` 里有 `default` 分支)的包,实现会被**悄悄换成浏览器那一份** ——
 * 不报错、不警告,只在运行时炸。真实事故:mammoth 的 `browser/unzip.js` 只接受 `arrayBuffer`,
 * 而 docx 那条路传的是 `buffer`,于是**每一份 Word 文档都读不出来**("Could not find file in
 * options"),而测试全绿(测试不过打包器,走 Node 解析,拿到的是正确的那一份)。
 *
 * 两条路都要堵(实测:只堵一条不够):
 *   - `mainFields` —— 老式 `browser` 字段的对象映射(逐文件替换),mammoth 走这条;
 *   - `conditions` —— `exports` 的条件解析,yaml 走这条(它的 exports 是
 *     `{ types, node: ./dist/index.js, default: ./browser/index.js }`,条件里没有 `node` 时
 *     就落到 `default`,也就是浏览器那份)。`["node", "import"]` 是 vite 自己的 server 默认。
 *
 * 只去掉 `browser`,其余顺序与 vite 的 client 默认**一字不动**(module → jsnext:main →
 * jsnext,再落到 main):除"本来会被换掉的那几个文件"之外,解析结果与改动前完全一致。
 * 改动前被换过的只有两家 —— mammoth(坏)与 yaml(同一实现的 ESM 镜像,没症状)。
 *
 * 这里是**单一来源**:构建用它,构建期守卫检查的也是它(`bundle-resolution-guard.mjs` 的机制层
 * 判据),不另抄一份 —— 抄一份的话守卫可能守着一个假的配置。
 */
const nodeResolution = {
  mainFields: ["module", "jsnext:main", "jsnext"],
  conditions: ["node", "import"],
};

async function buildEntry(entry, name, emptyOutDir, options = {}) {
  await build({
    configFile: false,
    logLevel: "error",
    publicDir: false,
    root: appRoot,
    resolve: nodeResolution,
    define: {
      __WORDLESS_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.WORDLESS_GOOGLE_CLIENT_ID?.trim() ?? ""),
      __WORDLESS_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.WORDLESS_GOOGLE_CLIENT_SECRET?.trim() ?? ""),
      __WORDLESS_SKILLSMP_API_KEY__: JSON.stringify(process.env.WORDLESS_SKILLSMP_API_KEY?.trim() ?? ""),
    },
    build: {
      emptyOutDir,
      lib: { entry, fileName: () => `${name}${options.extension ?? ".cjs"}`, formats: [options.format ?? "cjs"] },
      minify: false,
      outDir: outputDirectory,
      sourcemap: true,
      target: "node22",
      rollupOptions: {
        external: (id) => id === "electron" || isNodeBuiltin(id) || isExternalRuntimeDependency(id),
      },
    },
  });
}

await buildEntry(resolve(appRoot, "src/main/index.ts"), "main", true);
await buildEntry(resolve(appRoot, "src/preload/index.ts"), "preload", false);
// OCR 运行器窗口的 preload。与主 preload 分开:那个窗口是 sandbox 的隐藏窗口,只该拿到
// 那五个桥方法,不该能碰应用 IPC。
await buildEntry(resolve(appRoot, "src/preload/ocr-runner.ts"), "ocr-preload", false);
// 设计构建脚本。**打成 ESM**:`@tailwindcss/node` 是 ESM-only,而 CJS 产物里的动态 import
// 会被改写成 require —— 那条路在 ESM-only 包上不通。
await buildEntry(resolve(appRoot, "src/main/design/design-build-entry.ts"), "design-build", false, {
  format: "es",
  extension: ".mjs",
});

/**
 * **构建期守卫:产物里不许有被 `browser` 字段替换过的模块。**
 *
 * 两道,一起跑:
 *   1. {@link assertNodeResolution} —— **机制层**,检查解析配置里有没有 `browser`。它覆盖两条
 *      已知机制(mainFields 的老式映射、conditions 的 exports 分支),不依赖产物里剩下什么;
 *   2. {@link browserFieldSubstitutions} —— **产物层**,扫 sourcemap 里有没有被换进来的文件。
 *
 * 放在**四个入口全部构建完之后**:四个入口都跑在 Node 侧,一条判据覆盖它们全部 —— 而不是
 * 只守"当初出事的那个包"。
 */
async function assertNodeBundle() {
  // 检查的就是构建用的那个对象(单一来源),不是另抄一份。
  assertNodeResolution(nodeResolution);
  const hits = [];
  for (const file of await readdir(outputDirectory)) {
    if (!file.endsWith(".map")) continue;
    const map = JSON.parse(await readFile(resolve(outputDirectory, file), "utf8"));
    hits.push(...browserFieldSubstitutions(map.sources ?? [], readBrowserField));
  }
  if (hits.length > 0) throw new Error(describeSubstitutions(hits));
}

/** 某个包 package.json 里的 `browser` 字段。读不到(没装、JSON 坏了)就当没有。 */
function readBrowserField(packageName) {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "node_modules", packageName, "package.json"), "utf8"),
    );
    return manifest.browser;
  } catch {
    return undefined;
  }
}

await assertNodeBundle();

await generateAppIcon();
await readWindowsIcon(windowsApplicationIcon);
await copyFile(applicationIcon, resolve(outputDirectory, "wordless.png"));
await copyFile(windowsApplicationIcon, resolve(outputDirectory, "wordless.ico"));
