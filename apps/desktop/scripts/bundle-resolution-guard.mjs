/**
 * 构建期守卫:**主进程产物里不许出现被 `browser` 字段替换过的模块。**
 *
 * ## 这条守卫是为什么写的
 *
 * electron 主进程是 **Node** 环境,但 `build-electron.mjs` 用的是 vite 的 lib 构建,而 vite
 * 默认按 **client** 规则解析依赖(`resolve.mainFields` 含 `browser`)。于是任何声明了
 * `browser` 字段的包,它的实现会被**悄悄换成浏览器那一份** —— 不报错、不警告,只在运行时炸。
 *
 * 真实事故:`mammoth` 的 `browser` 字段把 `./lib/unzip.js` 换成了 `./browser/unzip.js`,而后者
 * **只接受 `arrayBuffer`**。docx 那条路传的是 `buffer` → 每一份 Word 文档都读不出来,报
 * "Could not find file in options"(2026-10-12 起,KB 功能的 docx 抽取从未成功过)。而**测试
 * 全绿**:测试不经过打包器,`import("mammoth")` 走 Node 解析,拿到的是正确的那一份。
 *
 * 所以这个判断必须发生在**构建期**:产物里出现过"被替换过的模块"就是错,不管当时有没有症状
 * (同一份产物里 `yaml` 也被换过,只是它的 browser 变体是同一实现的 ESM 镜像,没表现出来)。
 *
 * ## 为什么是纯函数
 *
 * 它要能对着**合成的** sourcemap 断言(见 `test/bundle-resolution-guard.test.ts`),否则这条
 * 守卫本身也只能靠"下次再炸一次"来验证。
 */

/**
 * 从产物 sourcemap 的 `sources` 里找出"被 `browser` 字段替换进来"的模块。
 *
 * **只管精确命中**(产物里出现的就是 `browser` 字段映射出来的那个文件)。它覆盖"某个具体文件
 * 被换掉"这种直接证据(mammoth 那次:产物里就有 `mammoth/browser/unzip.js`)。
 *
 * 有一类它**看不见**:被换掉的是某个包的入口,而那个入口只是几行 re-export(摇树时被内联掉,
 * 不留在 sourcemap 里),于是产物里只剩它的传递依赖(`yaml` 那次:`browser/index.js` 不在
 * sources 里,`browser/dist/**` 在)。那一类由 {@link assertNodeResolution} 在**机制层**守 ——
 * 它检查解析配置本身,不依赖产物里剩下什么。
 *
 * @param {readonly string[]} sources sourcemap 里的模块路径(形如 `../../node_modules/mammoth/browser/unzip.js`)
 * @param {(packageName: string) => unknown} browserFieldOf 读某个包的 `browser` 字段(读不到就返回 undefined)
 * @returns {Array<{ packageName: string, replaced: string, browser: string, source: string }>}
 */
export function browserFieldSubstitutions(sources, browserFieldOf) {
  const hits = [];
  const seen = new Set();
  for (const source of sources) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(source);
    if (match === null) continue;
    const [, packageName, relative] = match;
    const field = browserFieldOf(packageName);
    // `browser` 字段有两种形状:字符串(整个包的入口)与对象(逐文件替换)。
    // 只有对象形状才是"某个文件被换掉了" —— 字符串那种不产生这种路径。
    if (field === null || typeof field !== "object") continue;
    for (const [replaced, browser] of Object.entries(field)) {
      if (typeof browser !== "string") continue;
      if (browser.replace(/^\.\//, "") !== relative) continue;
      const key = `${packageName}:${relative}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ packageName, replaced, browser: relative, source });
    }
  }
  return hits;
}

/**
 * 把命中项说成人能照着改的话。
 *
 * 消息里必须带**包名**与**被换掉的文件** —— 只报"产物里有 browser 变体",下一个人还得自己
 * 猜是哪个依赖、为什么危险。
 */
export function describeSubstitutions(hits) {
  const lines = hits.map(
    (hit) => `  - ${hit.packageName}: ${hit.replaced} → ${hit.browser}`,
  );
  return [
    "主进程产物里出现了被 `browser` 字段替换过的模块:",
    ...lines,
    "",
    "electron 主进程是 Node 环境,不能按浏览器的规则解析依赖 —— 被换掉的实现可能在运行时才炸",
    "(真实事故:mammoth 的 browser/unzip.js 只接受 arrayBuffer,于是所有 docx 都读不出来)。",
    "修法见 `build-electron.mjs` 的 `resolve.mainFields` / `resolve.conditions`(都去掉 browser)。",
  ].join("\n");
}

/**
 * **机制层守卫:主进程的解析配置里不许出现 `browser`。**
 *
 * "被换成浏览器那份实现"有**两条**路,各由一个配置项管:
 *
 *   1. 老式的 `browser` 字段(对象映射,逐文件替换)→ `resolve.mainFields`;
 *      mammoth 走的是这条(`./lib/unzip.js` → `./browser/unzip.js`)。
 *   2. `exports` 的条件解析 → `resolve.conditions`。`yaml` 走的是这条:它的 exports 是
 *      `{ types, node: ./dist/index.js, default: ./browser/index.js }` —— 条件里没有 `node`
 *      时会落到 `default`,也就是**浏览器那份**。
 *
 * 所以只改一个不够(实测:只改 `mainFields` 时 mammoth 好了、yaml 照旧)。这条判据直接检查
 * 配置,因此它覆盖**机制**而不是"这一次的产物长什么样" —— 后者对"入口被摇掉、只剩传递依赖"
 * 那一类看不见(见 {@link browserFieldSubstitutions} 的说明)。
 */
export function assertNodeResolution(resolve) {
  const mainFields = resolve?.mainFields ?? [];
  const conditions = resolve?.conditions ?? [];
  const offenders = [
    ...(mainFields.includes("browser") ? [`resolve.mainFields 里有 "browser"(老式 browser 字段会被用上)`] : []),
    // **`conditions` 必须有 `node`**,不只是"没有 browser":`exports` 里 `node` 与 `default`
    // 是两条分支,缺 `node` 时会落到 `default` —— 而 `default` 往往是浏览器那份(yaml 就是
    // 这么被换掉的)。所以"没写 browser"不算合格。
    ...(conditions.includes("node") ? [] : [`resolve.conditions 里没有 "node"(exports 会落到 default 分支)`]),
    ...(conditions.includes("browser") ? [`resolve.conditions 里有 "browser"`] : []),
  ];
  if (offenders.length === 0) return;
  throw new Error(
    [
      `electron 主进程的解析配置不是 Node 的规则:${offenders.join("、")}。`,
      "这会让声明了 browser 字段(或 exports 里有 default 分支)的包被换成浏览器实现。",
      "真实事故:mammoth 的 browser/unzip.js 只接受 arrayBuffer → 所有 docx 都读不出来。",
      "主进程是 Node 环境:mainFields 不含 browser,conditions 用 vite 的 server 默认(node、import)。",
    ].join("\n"),
  );
}
