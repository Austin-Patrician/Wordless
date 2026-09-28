import assert from "node:assert/strict";
import test from "node:test";
import type { BuildRecipe } from "../src/main/design/build-recipes.ts";
import type { BuildRunner, BuildRunnerInput, BuildRunnerResult } from "../src/main/design/design-builder.ts";
import { DESIGN_REFRESH_MIN_INTERVAL_MS, DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf } from "../src/main/design/manifest.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 刷新通道。
 *
 * 它要修的是一个**看不见的**缺陷:画布上的位图是磁盘的快照,而 agent 一直在改磁盘。没有
 * 刷新,新帧不出现、改过的帧不变、新加的工具类也不存在 —— 而画布上一切看起来都很正常。
 *
 * 所以这里的断言都盯在"做了什么"上(构建有没有跑、`applied` 是真还是假),而不是"返回了
 * 什么形状"。形状对了而什么都没发生,正是原来的样子。
 */

const ROOT = "/w";
const DESIGN = `${ROOT}/meadow.wdesign`;
const INDEX = `${DESIGN}/frames/index.html`;

function frameSource(title: string): string {
  return `<!doctype html>\n<!-- @frame {"width":390,"height":844,"title":"${title}"} -->\n<html><body>hi</body></html>\n`;
}

function fixture(mode: "static" | "built" = "static"): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({
      version: 1,
      type: "wordless-design",
      canvas: { x: 0, y: 0, zoom: 1 },
      mode,
      style: null,
      ...(mode === "built" ? { build: { recipe: "test-recipe" } } : {}),
      frames: [],
    }),
  );
  fs.putFile(INDEX, frameSource("首页"));
  fs.putFile(`${DESIGN}/theme.css`, "@theme { --color-primary: #4f46e5; }");
  return fs;
}

/** 记录被调用过几次,并把产物写进暂存目录 —— 真构建就是在这里产出。 */
class FakeBuildRunner implements BuildRunner {
  readonly calls: BuildRunnerInput[] = [];
  result: BuildRunnerResult = { code: 0, timedOut: false, stdout: "built", stderr: "" };
  /**
   * 非 null 时每次构建都挂在这里。
   *
   * 存在的理由:单飞要验的是"并发的第二次不会叠一个构建",而**并发必须是可构造的输入**,
   * 不能靠时序碰运气 —— 那种测试在负载高时必然变成偶发。
   */
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;

  /**
   * 显式字段而不是参数属性:测试跑在 `node --test` 的仅剥离类型模式下,参数属性是它
   * 不支持的语法。
   */
  private readonly fs: FakeDesignFs;

  constructor(fs: FakeDesignFs) {
    this.fs = fs;
  }

  closeGate(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  openGate(): void {
    this.release?.();
    this.gate = null;
  }

  async run(input: BuildRunnerInput): Promise<BuildRunnerResult> {
    this.calls.push(input);
    if (this.gate !== null) await this.gate;
    const staging = input.args[0] ?? "";
    this.fs.putFile(`${staging}/theme.css`, "COMPILED THEME");
    this.fs.putFile(`${staging}/frames/index.html`, "<!doctype html><html></html>");
    return this.result;
  }
}

function recipe(): BuildRecipe {
  return {
    id: "test-recipe",
    label: "test build",
    unavailableReason: () => null,
    argv: ({ stagingPath }) => ({ command: "node", args: [stagingPath] }),
  };
}

function builds(runner: BuildRunner): { runner: BuildRunner; recipes: readonly BuildRecipe[] } {
  return { runner, recipes: [recipe()] };
}

/** 可控时钟。限流问的是"过了多久",没有假时间就只能真的 sleep。 */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test("源指纹跟着源变,而不跟着构建产物变", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const before = await store.sourceFingerprint(DESIGN);

  // 构建产物与状态文件都在被忽略的目录里。它们**不能**算进指纹 —— 否则一次刷新会把自己
  // 判成"源变了",然后触发下一次刷新,而那是一条无限重建的链。
  fs.putFile(`${DESIGN}/dist/theme.css`, "COMPILED");
  fs.putFile(`${DESIGN}/.build/status.json`, "{}");
  assert.equal(await store.sourceFingerprint(DESIGN), before);

  fs.putFile(INDEX, frameSource("改了标题"));
  assert.notEqual(await store.sourceFingerprint(DESIGN), before);
});

test("源没变时刷新走快路径:不做事,也不构建", async () => {
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });

  const first = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.equal(first.applied, true);
  assert.equal(runner.calls.length, 1);

  const second = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.deepEqual([second.changed, second.applied], [false, false]);
  assert.equal(second.revision, first.revision);
  // 快路径是**每秒**都会走的那条,所以"它没做事"必须被钉住。
  assert.equal(runner.calls.length, 1, "源没变时不该再起一次构建");
});

test("agent 新写的帧在下一次刷新时出现", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  assert.deepEqual((await store.openDesign(DESIGN))?.manifest.frames.map((frame) => frame.id), ["index"]);

  fs.putFile(`${DESIGN}/frames/detail.html`, frameSource("详情"));
  const refreshed = await store.refreshDesign({ designPath: DESIGN });

  assert.equal(refreshed.applied, true);
  // 新帧排在**最后**,而不是按文件名插进中间:落点是"放到已经摆好的那些的右边",
  // 而那个"已经摆好的"必须包含全部对上号的帧 —— 否则一个名字排在已有的帧前面的新帧
  // 会看到一张空画布,于是落到原点、叠在别的帧上(`reconcile.ts` 的两遍处理)。
  assert.deepEqual(refreshed.opened?.manifest.frames.map((frame) => frame.id), ["index", "detail"]);
});

test("built 设计在刷新时补齐样式表,于是它不再是 never", async () => {
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });

  // `built` 下 `dist/theme.css` 只能由构建产出,所以"从没构建过"是最初的状态 ——
  // 而那时帧一条样式都不生效。这正是 agent 建出来的包原本的样子。
  assert.equal((await store.describeDesign(DESIGN))?.styles.state, "never");

  const refreshed = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });

  assert.equal(refreshed.build?.ok, true);
  assert.equal(fs.text(`${DESIGN}/dist/theme.css`), "COMPILED THEME");
  assert.equal((await store.describeDesign(DESIGN))?.styles.state, "fresh");
});

test("改了帧但还没刷新时报 stale,刷新之后回到 fresh", async () => {
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  // 假时钟:两次刷新之间必须推过最短间隔,否则第二次会被限流挡下 —— 那是刻意的行为
  // (轮询一秒后补上),但在一个测试里"一秒"不该是真的等一秒。
  const time = clock();
  const store = new DesignStore({ fs, now: time.now });

  await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });

  fs.putFile(INDEX, frameSource("又改了"));
  assert.equal((await store.describeDesign(DESIGN))?.styles.state, "stale");

  time.advance(DESIGN_REFRESH_MIN_INTERVAL_MS);
  await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.equal((await store.describeDesign(DESIGN))?.styles.state, "fresh");
});

test("构建失败被记下来:状态可见,而且不会每一轮都重试", async () => {
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  runner.result = { code: 1, timedOut: false, stdout: "", stderr: "no tailwind here" };
  const store = new DesignStore({ fs });

  const refreshed = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.equal(refreshed.build?.ok, false);

  const styles = (await store.describeDesign(DESIGN))?.styles;
  assert.equal(styles?.state, "failed");
  assert.match(styles?.detail ?? "", /exit-nonzero/);

  // 源没再变 —— 于是下一次是快路径。记下败因而不是不记,**为的就是不要每秒重试一个坏构建**:
  // 那会得到一个永远在起子进程、又永远失败的循环,比一次可见的失败糟得多。
  const again = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.equal(again.applied, false);
  assert.equal(runner.calls.length, 1);
});

test("连续写入时触发限流,过了最短间隔才放行", async () => {
  const fs = fixture();
  const time = clock();
  const store = new DesignStore({ fs, now: time.now });

  assert.equal((await store.refreshDesign({ designPath: DESIGN })).applied, true);

  fs.putFile(INDEX, frameSource("第一改"));
  const throttled = await store.refreshDesign({ designPath: DESIGN });
  // `changed: true` 但 `applied: false` —— 源确实变了,只是这一次不做。下一次会补上。
  assert.deepEqual([throttled.changed, throttled.applied], [true, false]);

  time.advance(DESIGN_REFRESH_MIN_INTERVAL_MS);
  assert.equal((await store.refreshDesign({ designPath: DESIGN })).applied, true);
});

test("同一份设计的刷新是单飞的:并发的第二次不会叠一个构建", async () => {
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });
  runner.closeGate();

  const first = store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  // 让第一次真的走到"已经登记在刷新中"那一步(它已停在构建的闸门上)。
  await new Promise((resolve) => setTimeout(resolve, 0));

  const second = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  assert.equal(second.applied, false, "已经在刷新的设计不该再起一次");

  runner.openGate();
  assert.equal((await first).applied, true);
  assert.equal(runner.calls.length, 1);
});

test("手动刷新越过最短间隔 —— 否则那个按钮可能点了什么都不做", async () => {
  /*
    **这条是加刷新按钮时才想清楚的。** 心跳被限流是常态(下一次补上),而用户按了刷新就是在
    等:他刚在编辑器里改完一帧,而那一刻刚好落在限流窗口里 —— 静默什么都不做,读起来就是
    "这个按钮坏了"。所以手动刷新必须能越过时间那道闸。
  */
  const fs = fixture();
  const time = clock();
  const store = new DesignStore({ fs, now: time.now });

  await store.refreshDesign({ designPath: DESIGN });
  fs.putFile(INDEX, frameSource("在编辑器里改了一行"));

  // 心跳的走法:撞上间隔 → 这一次不做(下一次补上)。
  assert.equal((await store.refreshDesign({ designPath: DESIGN })).applied, false);

  // 用户按的刷新:同一次改动,force 之下必须做。
  assert.equal((await store.refreshDesign({ designPath: DESIGN, force: true })).applied, true);
});

test("手动刷新不越过单飞 —— 构建正在跑时不该再叠一个", async () => {
  // 越界只在时间那一侧。构建是子进程,再叠一个不会让用户更快拿到结果。
  const fs = fixture("built");
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });
  runner.closeGate();

  const first = store.refreshDesign({ designPath: DESIGN, builds: builds(runner) });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const forced = await store.refreshDesign({ designPath: DESIGN, builds: builds(runner), force: true });
  assert.equal(forced.applied, false, "已经在刷新时,手动刷新也要等");

  runner.openGate();
  assert.equal((await first).applied, true);
  assert.equal(runner.calls.length, 1);
});
