import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNodeResolution, browserFieldSubstitutions, describeSubstitutions } from "../scripts/bundle-resolution-guard.mjs";

/**
 * 构建期守卫:**主进程产物里不许出现被 `browser` 字段替换过的模块**。
 *
 * 这条判据错了不会报错 —— 它只会让产物悄悄用上浏览器那份实现,然后在运行时(或几天后)炸。
 * 真实事故见 `bundle-resolution-guard.mjs` 的文件头:mammoth 的 `browser/unzip.js` 只接受
 * `arrayBuffer`,于是每一份 docx 都读不出来,而测试全绿。
 *
 * 所以这里对着**合成的** sourcemap 断言:判据本身必须能被测,否则它只能靠"下次再炸一次"验证。
 */

/** 读某个包的 `browser` 字段(测试里直接给表)。 */
const fields = (table: Record<string, unknown>) => (packageName: string) => table[packageName];

describe("产物里被 browser 字段替换过的模块", () => {
  it("对象形状的 browser 字段 + 产物里的那个文件 = 命中", () => {
    // 就是那次事故的形状。
    const hits = browserFieldSubstitutions(
      ["../../../../node_modules/mammoth/browser/unzip.js"],
      fields({ mammoth: { "./lib/unzip.js": "./browser/unzip.js" } }),
    );
    assert.deepEqual(hits, [
      {
        packageName: "mammoth",
        replaced: "./lib/unzip.js",
        browser: "browser/unzip.js",
        source: "../../../../node_modules/mammoth/browser/unzip.js",
      },
    ]);
  });

  it("路径带不带 `./` 都算同一个替换", () => {
    const hits = browserFieldSubstitutions(
      ["node_modules/yaml/browser/index.js"],
      fields({ yaml: { "./dist/index.js": "browser/index.js" } }),
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].packageName, "yaml");
  });

  it("作用域包的包名要连 scope 一起认出来", () => {
    const hits = browserFieldSubstitutions(
      ["node_modules/@scope/pkg/browser/entry.js"],
      fields({ "@scope/pkg": { "./lib/entry.js": "./browser/entry.js" } }),
    );
    assert.equal(hits[0]?.packageName, "@scope/pkg");
  });

  it("**字符串形状的 browser 字段不算**:它换的是整个包的入口,不是某个文件", () => {
    // 那种包在产物里不会出现 `.../browser/...` 这种路径,拿它报错只会变成噪音。
    const hits = browserFieldSubstitutions(
      ["node_modules/some-ui/browser/thing.js"],
      fields({ "some-ui": "./browser/index.js" }),
    );
    assert.deepEqual(hits, []);
  });

  it("包没声明 browser、或读不到它的 package.json,都不算", () => {
    const sources = ["node_modules/plain/dist/index.js", "node_modules/missing/browser/x.js"];
    assert.deepEqual(browserFieldSubstitutions(sources, fields({})), []);
  });

  it("同一个包被换多处时逐条报出来,不合并", () => {
    const hits = browserFieldSubstitutions(
      ["node_modules/mammoth/browser/unzip.js", "node_modules/mammoth/browser/docx/files.js"],
      fields({ mammoth: { "./lib/unzip.js": "./browser/unzip.js", "./lib/docx/files.js": "./browser/docx/files.js" } }),
    );
    assert.deepEqual(hits.map((hit) => hit.browser), ["browser/unzip.js", "browser/docx/files.js"]);
  });

  it("干净产物里没有命中", () => {
    const hits = browserFieldSubstitutions(
      ["../../node_modules/mammoth/lib/unzip.js", "src/main/index.ts", "node_modules/yaml/dist/index.js"],
      fields({ mammoth: { "./lib/unzip.js": "./browser/unzip.js" } }),
    );
    assert.deepEqual(hits, []);
  });
});

describe("命中时给的话", () => {
  it("要说清哪个包、哪个文件被换成了什么,并指向修法", () => {
    const message = describeSubstitutions([
      { packageName: "mammoth", replaced: "./lib/unzip.js", browser: "browser/unzip.js", source: "x" },
    ]);
    assert.match(message, /mammoth/);
    assert.match(message, /\.\/lib\/unzip\.js → browser\/unzip\.js/);
    // 只说"产物里有 browser 变体"没用 —— 下一个人还得自己猜为什么危险、去哪儿改。
    assert.match(message, /resolve\.mainFields/);
  });
});

/**
 * **机制层判据。** 产物层看不见"入口被摇掉、只剩传递依赖"那一类(yaml),所以这一层必须
 * 直接检查解析配置 —— 它覆盖两条已知机制,不依赖产物里剩下什么。
 */
describe("解析配置必须是 Node 的规则", () => {
  it("正确的配置放行", () => {
    assert.doesNotThrow(() =>
      assertNodeResolution({ mainFields: ["module", "jsnext:main", "jsnext"], conditions: ["node", "import"] }),
    );
    // 多一个条件(比如某个包要求的)不该被拦。
    assert.doesNotThrow(() => assertNodeResolution({ mainFields: ["main"], conditions: ["node", "import", "development"] }));
  });

  it("mainFields 里有 browser → 拦(mammoth 那条路)", () => {
    assert.throws(
      () => assertNodeResolution({ mainFields: ["browser", "module"], conditions: ["node", "import"] }),
      /mainFields/,
    );
  });

  it("conditions 里**没有 node** → 拦(yaml 那条路:会落到 default)", () => {
    // 这一条是关键:`["import"]` 看起来"没有 browser",但 yaml 的 exports 是
    // `{ types, node: ./dist/index.js, default: ./browser/index.js }` —— 缺 node 就落到
    // default,也就是浏览器那份。实测:只改 mainFields 时 mammoth 好了、yaml 照旧。
    assert.throws(() => assertNodeResolution({ mainFields: ["module"], conditions: ["import"] }), /没有 "node"/);
    assert.throws(() => assertNodeResolution({ mainFields: ["module"] }), /没有 "node"/);
  });

  it("conditions 里有 browser → 拦", () => {
    assert.throws(
      () => assertNodeResolution({ mainFields: ["module"], conditions: ["node", "browser"] }),
      /conditions/,
    );
  });

  it("报错信息要说清后果与改法(不能只说配置不对)", () => {
    try {
      assertNodeResolution({ mainFields: ["browser"], conditions: ["import"] });
      assert.fail("应当拦下来");
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /docx/);
      assert.match(message, /conditions/);
    }
  });
});
