/**
 * **被 external 的运行时依赖**：打包时不会被内联，所以必须**随包发布**。
 *
 * 这份表是两件事的唯一真源：`scripts/build-electron.mjs` 的外化判定，以及
 * `test/external-runtime-packages.test.ts` 的打包清单守卫。
 *
 * ## 为什么要写成"规则 + 谁发布它"两栏
 *
 * 原来这里只有一栏：两张手写的 `isXxx(id)` 谓词。它们回答了"什么不该被内联"，却**没有回答
 * "那它从哪来"** —— 而 `@tailwindcss/node` 正是这样漏掉的：四个包被 external 了，却只出现在
 * `devDependencies` 里，安装包因此永远缺一份编译器运行时（症状：安装版上每份设计的样式都编译
 * 不出来，画布上是无样式的裸结构；而开发机上一切正常，因为仓库自己的 `node_modules` 就在旁边）。
 *
 * 所以 `shippedBy` 这一栏是这次事故的直接产物：它指名**哪个包把它带进安装包**，守卫据此去
 * `apps/desktop/package.json` 的 `dependencies` 里核对。少了这一栏，同一个错误可以再犯一次而
 * 无人察觉 —— 文档里记着"打包要 asarUnpack"整整一轮，就是这么烂掉的。
 *
 * ## `match` 的三种写法
 *
 * - `exact`：`id === name`。
 * - `package`：`id === name || id.startsWith(name + "/")` —— 包自己与它的子路径。
 * - `prefix`：`id.startsWith(name)`。平台二进制包是 `fff-bin-win32-x64` 这种"名字 + 平台后缀"，
 *   中间没有 `/`，所以只能按前缀匹配（`lightningcss` 也是同一形态）。
 */

/**
 * 原生模块：`.node` 不能从 asar 里加载，所以它们还必须进 `electron-builder.yml` 的 `asarUnpack`。
 * 与非原生项分开，是因为"没装上"和"装上了但解不出来"是两种不同的坏法。
 */
export const NATIVE_ASAR_UNPACK = [
  "node_modules/@ff-labs/**/*",
  "node_modules/ffi-rs/**/*",
  "node_modules/@yuuang/**/*",
  "node_modules/sharp/**/*",
  "node_modules/@img/**/*",
  // Tailwind 那棵树整体解出来：`lightningcss` / `@tailwindcss/oxide` 是原生模块，而
  // `@tailwindcss/node` 会在运行期用 `enhanced-resolve` 去解析 `tailwindcss` 的 CSS 与
  // 自身的转发依赖 —— 整棵解开可以一次消除"asar 路径 + JS 解析器"这一整类不确定性。
  // asarUnpack 不增加体积：文件是从 asar 挪到 `app.asar.unpacked`，asar 里只留索引。
  "node_modules/@tailwindcss/**/*",
  "node_modules/lightningcss*/**/*",
];

export const RUNTIME_EXTERNALS = [
  { id: "undici", match: "exact", shippedBy: "undici" },
  // `ws` 是 CJS 包:内联进 single-file CJS 时,它的命名导入会变成 undefined(踩过)。
  // 外化之后主进程在运行时 require 它 —— 与 apps/relay 里已经正常工作的那条路径一致。
  { id: "ws", match: "exact", shippedBy: "ws" },
  { id: "sharp", match: "package", shippedBy: "sharp" },
  // `@img/*` 是 sharp 的平台原生包，随 sharp 一起进来。
  { id: "@img", match: "package", shippedBy: "sharp" },
  { id: "@ff-labs/fff-node", match: "package", shippedBy: "@ff-labs/fff-node" },
  // ffi-rs 与两个平台包都不是直接依赖，由 fff-node 带进来。
  { id: "ffi-rs", match: "package", shippedBy: "@ff-labs/fff-node" },
  { id: "@ff-labs/fff-bin-", match: "prefix", shippedBy: "@ff-labs/fff-node" },
  { id: "@yuuang/ffi-rs-", match: "prefix", shippedBy: "@ff-labs/fff-node" },
  /**
   * 设计样式编译。
   *
   * 成因与上面那批不同：这几个是 **JS 包，但必须外部化**（`@tailwindcss/node` 是 ESM 且带原生
   * 依赖，内联进主进程产物会让原生 require 在错误路径上解析）。唯一消费者是主进程以子进程启动的
   * `dist/electron/design-build.mjs`，它动态 `import()` 这几个包。
   */
  { id: "@tailwindcss/node", match: "package", shippedBy: "@tailwindcss/node" },
  { id: "@tailwindcss/oxide", match: "package", shippedBy: "@tailwindcss/oxide" },
  { id: "tailwindcss", match: "package", shippedBy: "tailwindcss" },
  { id: "lightningcss", match: "prefix", shippedBy: "lightningcss" },
];

/** 判断一个 import 标识符是否属于"不能内联、必须随包发布"的那批。 */
export function isExternalRuntimeDependency(id) {
  return RUNTIME_EXTERNALS.some((rule) => {
    switch (rule.match) {
      case "exact":
        return id === rule.id;
      case "package":
        return id === rule.id || id.startsWith(`${rule.id}/`);
      case "prefix":
        return id.startsWith(rule.id);
      default:
        return false;
    }
  });
}
