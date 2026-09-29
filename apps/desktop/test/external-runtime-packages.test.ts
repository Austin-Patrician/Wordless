import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_ASAR_UNPACK, RUNTIME_EXTERNALS } from "../scripts/external-packages.mjs";

/**
 * 打包清单守卫:**被 external 的运行时依赖,必须有一个把它带进安装包的来源。**
 *
 * ## 这条守卫是为什么写的
 *
 * `@tailwindcss/node` / `tailwindcss` / `@lightningcss` 被 external 了(它们不能内联进产物),
 * 但只出现在 `devDependencies` 里 —— 于是 `npm run dist:win` 打出来的安装包里根本没有它们,
 * 而 `dist/electron/design-build.mjs` 会在子进程里 `import("@tailwindcss/node")` 失败。
 *
 * 症状不是"报错",而是**每份设计都没有样式**:`dist/theme.css` 永远生不出来,画布上是无样式的
 * 裸结构,截图失真,agent 只能自己编原因(实测它编出的是"你这台机器的安装损坏或被拦截")。
 * 而开发机上一切正常 —— 脚本向上解析会摸到仓库自己的 `node_modules`。所以**只有安装版会中**,
 * 团队自测和 CI 都不会发现。
 *
 * 文档里其实记着"打包要 asarUnpack",但漏了更前面的一半(包根本不在),而且那是"打包配置改动,
 * 不是代码改动"、没人守 —— 于是烂了整整一轮。所以这里守的不是配置格式,而是那条不变量本身。
 *
 * ## 为什么不解析 YAML
 *
 * 这条守卫要问的只是"名字在不在"。为它引入一个 YAML 解析器到 `devDependencies` 不划算,所以
 * 直接读文本:上面断言的是**每个名字都必须出现**,少一个就红 —— 文件形状变了会导致红,而不是
 * 静默通过。这正是守卫要的方向。
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (relativePath) => readFileSync(resolve(appRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const builderConfig = readText("electron-builder.yml");
const appManifest = readJson("package.json");
const lock = readJson("../../package-lock.json");

/** 从 `electron-builder.yml` 里取一段顶层块(`key:` 到下一个非缩进行)。 */
function blockOf(key) {
  const lines = builderConfig.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  assert.notEqual(start, -1, `electron-builder.yml 里没有 ${key}: 这一段`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("\t")) break;
    block.push(line);
  }
  return block.join("\n");
}

/** 取一段块里的 `- 值` 列表(去掉注释与空行)。 */
function listOf(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

test("external 的运行时依赖,每一个都有随包发布的来源", () => {
  const declared = appManifest.dependencies ?? {};
  for (const rule of RUNTIME_EXTERNALS) {
    assert.ok(
      typeof rule.shippedBy === "string" && rule.shippedBy !== "",
      `${rule.id} 没写 shippedBy —— 这一栏就是这次事故缺的那一环`,
    );
    assert.ok(
      Object.hasOwn(declared, rule.shippedBy),
      `${rule.shippedBy} 不在 apps/desktop/package.json 的 dependencies 里。` +
        `${rule.id} 被 external 了,运行期要解析它,所以它必须随包发布。`,
    );
  }
});

test("声明的运行时依赖版本与锁文件一致", () => {
  const declared = appManifest.dependencies ?? {};
  for (const rule of RUNTIME_EXTERNALS) {
    const range = declared[rule.shippedBy];
    // 只钉精确版本:`^`/`~` 会让安装包里的编译器与渲染层构建时用的那一份漂开,
    // 而它们必须逐字节一致(渲染层产出的类名由这份编译器生成)。
    if (!/^\d/.test(range)) continue;
    const resolved = lock.packages[`node_modules/${rule.shippedBy}`]?.version;
    assert.equal(
      resolved,
      range,
      `${rule.shippedBy} 声明 ${range} 但锁文件解析到 ${resolved ?? "(未安装)"}`,
    );
  }
});

test("原生模块全部在 asarUnpack 里", () => {
  const unpacked = listOf(blockOf("asarUnpack"));
  for (const glob of NATIVE_ASAR_UNPACK) {
    assert.ok(unpacked.includes(glob), `asarUnpack 缺 ${glob} —— 原生 .node 不能从 asar 里加载`);
  }
  assert.deepEqual(
    unpacked.slice().sort(),
    NATIVE_ASAR_UNPACK.slice().sort(),
    "asarUnpack 与 external-packages.mjs 的 NATIVE_ASAR_UNPACK 必须逐条一致(两边各写一份会漂)",
  );
});

test("external 判定本身没被改坏", async () => {
  const { isExternalRuntimeDependency } = await import("../scripts/external-packages.mjs");
  // 子路径与平台后缀包必须一起被外部化,否则它们会被内联进主进程产物、原生 require 找错路径。
  for (const id of [
    "@tailwindcss/node",
    "@tailwindcss/node/dist/index.js",
    "tailwindcss",
    "tailwindcss/index.css",
    "lightningcss",
    "lightningcss-win32-x64-msvc",
    "sharp",
    "@img/sharp-win32-x64",
    "@ff-labs/fff-bin-win32-x64",
    "@yuuang/ffi-rs-win32-x64-msvc",
    "undici",
  ]) {
    assert.equal(isExternalRuntimeDependency(id), true, `${id} 应当被外部化`);
  }
  for (const id of ["electron", "node:fs", "react", "@wordless/capability-design"]) {
    assert.equal(isExternalRuntimeDependency(id), false, `${id} 不该被外部化`);
  }
});
