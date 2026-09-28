import assert from "node:assert/strict";
import test from "node:test";
import { designBuildRecipes, type BuildRecipe } from "../src/main/design/build-recipes.ts";
import type { BuildRunner, BuildRunnerInput, BuildRunnerResult } from "../src/main/design/design-builder.ts";
import {
  BUILD_PREVIOUS_DIRECTORY,
  BUILD_STAGING_DIRECTORY,
  resolveBuildPlan,
  runDesignBuild,
} from "../src/main/design/design-builder.ts";
import { DesignStore } from "../src/main/design/design-store.ts";
import { emptyManifest, parseManifest, serializeManifest, type DesignManifest } from "../src/main/design/manifest.ts";
import { DESIGN_RASTER_BUDGETS } from "../src/main/design/raster-budgets.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 构建器的三条纪律都靠假实现来验。
 *
 * 用真子进程跑构建会引入两件事:一是慢,二是"超时"要真的等两分钟。而这里要断言的核心
 * ——**失败时一个字节都不动旧的 `dist/`** —— 恰恰只有把"失败"变成可控输入才验得准。
 */

const DESIGN_PATH = "/workspace/login.wdesign";

/** 记录被调用过什么,并回放预先安排好的结果。 */
class FakeBuildRunner implements BuildRunner {
  readonly calls: BuildRunnerInput[] = [];
  result: BuildRunnerResult = { code: 0, timedOut: false, stdout: "built", stderr: "" };
  throws: Error | null = null;
  /** 构建过程中往暂存目录写的东西 —— 真构建就是在这里产出。 */
  produce: (stagingPath: string) => void;

  private readonly fs: FakeDesignFs;

  constructor(fs: FakeDesignFs) {
    this.fs = fs;
    this.produce = (stagingPath) => {
      this.fs.putFile(`${stagingPath}/frames/index.html`, "<!doctype html><html></html>");
    };
  }

  async run(input: BuildRunnerInput): Promise<BuildRunnerResult> {
    this.calls.push(input);
    if (this.throws !== null) throw this.throws;
    // **无论成败都先产出** —— 真构建是边跑边写的。若只在成功时才写,"失败不动旧产物"
    // 这条就会被验成一个空镜头:根本没有东西可动。
    this.produce(input.args[0] ?? "");
    return this.result;
  }
}

/** 一套可用的方案:argv 从表里来,`args[0]` 就是暂存目录。 */
function recipe(overrides: Partial<BuildRecipe> = {}): BuildRecipe {
  return {
    id: "test-recipe",
    label: "test build",
    unavailableReason: () => null,
    argv: ({ stagingPath }) => ({ command: "node", args: [stagingPath] }),
    ...overrides,
  };
}

function builtManifest(overrides: Partial<DesignManifest> = {}): DesignManifest {
  return { ...emptyManifest(), mode: "built", build: { recipe: "test-recipe" }, ...overrides };
}

/** 上一次构建留下的、能看的产物。 */
function withExistingDist(fs: FakeDesignFs): void {
  fs.putFile(`${DESIGN_PATH}/dist/theme.css`, "OLD THEME");
  fs.putFile(`${DESIGN_PATH}/dist/frames/index.html`, "OLD FRAME");
}

function distSnapshot(fs: FakeDesignFs): Record<string, string | undefined> {
  return {
    "dist/theme.css": fs.text(`${DESIGN_PATH}/dist/theme.css`),
    "dist/frames/index.html": fs.text(`${DESIGN_PATH}/dist/frames/index.html`),
  };
}

async function build(fs: FakeDesignFs, runner: FakeBuildRunner, manifest: DesignManifest, recipes: readonly BuildRecipe[] = [recipe()]) {
  return await runDesignBuild({
    fs,
    runner,
    manifest,
    designPath: DESIGN_PATH,
    recipes,
    timeoutMs: 1_000,
  });
}

// ─────────────────────────── 该不该构建 ───────────────────────────

test("a static design is not built at all", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  // `static` 的产物由 syncRenderRoot 从源同步,构建器插手就是两套真相。
  const result = await build(fs, runner, emptyManifest());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "not-built-mode");
  assert.equal(runner.calls.length, 0, "static 模式下不该起任何子进程");
});

test("built mode without a declared recipe is reported, not guessed", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const manifest = { ...builtManifest(), build: undefined };
  const result = await build(fs, runner, manifest);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "recipe-missing");
  assert.equal(runner.calls.length, 0);
});

test("an unregistered recipe is refused instead of shelling out to something unknown", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const result = await build(fs, runner, builtManifest({ build: { recipe: "tailwind" } }), [recipe()]);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "recipe-unavailable");
  assert.match(result.ok === false ? result.detail : "", /tailwind/);
  assert.equal(runner.calls.length, 0);
});

test("a recipe whose tool is missing says exactly what is missing", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const missing = recipe({ unavailableReason: () => "@tailwindcss/node is not shipped in this build." });
  const result = await build(fs, runner, builtManifest(), [missing]);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "recipe-unavailable");
  assert.match(result.ok === false ? result.detail : "", /@tailwindcss\/node/);
  assert.equal(runner.calls.length, 0);
});

test("the command comes from the recipe table, never from the manifest", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  // 清单里塞一条命令。它必须被完全忽略 —— 清单只能声明方案 id。
  const manifest = { ...builtManifest(), command: "rm -rf /" } as unknown as DesignManifest;
  const result = await build(fs, runner, manifest);

  assert.equal(result.ok, true);
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.command, "node");
  assert.notEqual(runner.calls[0]?.command, "rm -rf /");
});

// ────────────────────── 只有成功才碰 dist/ ──────────────────────

test("a failing build leaves the previous dist untouched, byte for byte", async () => {
  const fs = new FakeDesignFs();
  withExistingDist(fs);
  const before = distSnapshot(fs);

  const runner = new FakeBuildRunner(fs);
  runner.result = { code: 1, timedOut: false, stdout: "partial", stderr: "boom" };
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "exit-nonzero");
  assert.match(result.ok === false ? result.stderr : "", /boom/, "失败原因要带着 stderr 交回去");
  assert.deepEqual(distSnapshot(fs), before, "旧的 dist 必须一个字节都没动");
  assert.equal(fs.has(`${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}/frames/index.html`), false, "暂存目录要清掉");
});

test("a timed-out build is stopped and leaves the previous dist untouched", async () => {
  const fs = new FakeDesignFs();
  withExistingDist(fs);
  const before = distSnapshot(fs);

  const runner = new FakeBuildRunner(fs);
  runner.result = { code: null, timedOut: true, stdout: "still going", stderr: "" };
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "timeout");
  assert.match(result.ok === false ? result.stdout : "", /still going/, "超时也要带回已经吐出来的输出");
  assert.deepEqual(distSnapshot(fs), before);
});

test("a runner that cannot even start a process is reported, not thrown", async () => {
  const fs = new FakeDesignFs();
  withExistingDist(fs);
  const before = distSnapshot(fs);

  const runner = new FakeBuildRunner(fs);
  runner.throws = new Error("spawn ENOENT");
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "spawn-failed");
  assert.deepEqual(distSnapshot(fs), before);
});

test("a build that exits zero but writes nothing does not replace a good dist", async () => {
  const fs = new FakeDesignFs();
  withExistingDist(fs);
  const before = distSnapshot(fs);

  const runner = new FakeBuildRunner(fs);
  runner.produce = () => {
    // 什么都不写。
  };
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "output-missing");
  assert.deepEqual(distSnapshot(fs), before, "空产物不能把上一份能看的产物换掉");
});

// ─────────────────────────── 成功路径 ───────────────────────────

test("a successful build replaces dist with the staged output and cleans up after itself", async () => {
  const fs = new FakeDesignFs();
  withExistingDist(fs);

  const runner = new FakeBuildRunner(fs);
  runner.produce = (stagingPath) => {
    fs.putFile(`${stagingPath}/theme.css`, "NEW THEME");
    fs.putFile(`${stagingPath}/frames/index.html`, "NEW FRAME");
  };
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, true);
  assert.deepEqual(distSnapshot(fs), { "dist/theme.css": "NEW THEME", "dist/frames/index.html": "NEW FRAME" });
  // 目录在内存实现里不是实体,所以断言它下面的文件——这才是"清干净了"的真实含义。
  assert.equal(fs.text(`${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}/frames/index.html`), undefined, "暂存目录不能留下");
  assert.equal(fs.text(`${DESIGN_PATH}/${BUILD_PREVIOUS_DIRECTORY}/theme.css`), undefined, "中转目录里不能有残留");
  assert.equal(fs.text(`${DESIGN_PATH}/${BUILD_PREVIOUS_DIRECTORY}/frames/index.html`), undefined, "中转目录里不能有残留");
});

test("a first successful build creates dist where there was none", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, true);
  assert.equal(fs.text(`${DESIGN_PATH}/dist/frames/index.html`), "<!doctype html><html></html>");
});

test("the build runs in the design package with the staging directory as its output", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  await build(fs, runner, builtManifest());

  assert.equal(runner.calls[0]?.cwd, DESIGN_PATH);
  assert.equal(runner.calls[0]?.args[0], `${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}`);
  assert.equal(runner.calls[0]?.timeoutMs, 1_000);
});

test("the staging directory is cleared before the build, so a stale one cannot be mistaken for output", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(`${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}/leftover.html`, "STALE");

  const runner = new FakeBuildRunner(fs);
  runner.produce = (stagingPath) => {
    fs.putFile(`${stagingPath}/frames/index.html`, "FRESH");
  };
  const result = await build(fs, runner, builtManifest());

  assert.equal(result.ok, true);
  assert.equal(fs.has(`${DESIGN_PATH}/dist/leftover.html`), false, "上一次留下的暂存内容不能被当成这次的产物");
});

// ─────────────────────────── 清单字段 ───────────────────────────

test("the build recipe survives a manifest round trip", () => {
  const parsed = parseManifest({
    version: 1,
    type: "wordless-design",
    canvas: { x: 0, y: 0, zoom: 1 },
    mode: "built",
    style: null,
    build: { recipe: "tailwind" },
    frames: [],
  });

  assert.notEqual(parsed, null);
  assert.equal(parsed?.repaired, false);
  assert.deepEqual(parsed?.manifest.build, { recipe: "tailwind" });
});

test("an empty build declaration is dropped and reported as a repair", () => {
  const parsed = parseManifest({
    version: 1,
    type: "wordless-design",
    canvas: { x: 0, y: 0, zoom: 1 },
    mode: "built",
    style: null,
    // `build: {}` 不代表任何东西 —— 说得出"要用哪套"才叫声明。
    build: {},
    frames: [],
  });

  assert.notEqual(parsed, null);
  assert.equal(parsed?.repaired, true);
  assert.equal(parsed?.manifest.build, undefined);
});

test("a static design carries no build declaration", () => {
  const parsed = parseManifest({
    version: 1,
    type: "wordless-design",
    canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static",
    style: null,
    frames: [],
  });

  assert.equal(parsed?.manifest.build, undefined);
});

test("resolveBuildPlan hands the recipe the staging path it must write into", () => {
  const plan = resolveBuildPlan({
    manifest: builtManifest(),
    designPath: DESIGN_PATH,
    recipes: [recipe()],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.ok === true ? plan.args[0] : null, `${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}`);
});

// ─────────────────── 接缝:store 是唯一的发起处 ───────────────────

test("buildDesign returns null for a path that is not a design package", async () => {
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const result = await store.buildDesign({ designPath: DESIGN_PATH, runner: new FakeBuildRunner(fs) });

  assert.equal(result, null, "不是设计包要说 null,而不是编一个构建失败出来");
});

test("buildDesign reads the manifest instead of taking one from the caller", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(`${DESIGN_PATH}/design.json`, serializeManifest(emptyManifest()));
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });

  const result = await store.buildDesign({ designPath: DESIGN_PATH, runner });

  assert.equal(result?.ok, false);
  assert.equal(result?.ok === false ? result.code : null, "not-built-mode");
  assert.equal(runner.calls.length, 0, "static 模式不该起子进程");
});

test("buildDesign uses the build timeout from the budget that owns it", async () => {
  const fs = new FakeDesignFs();
  const manifest = builtManifest();
  fs.putFile(`${DESIGN_PATH}/design.json`, serializeManifest(manifest));
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });

  await store.buildDesign({ designPath: DESIGN_PATH, runner, recipes: [recipe()] });

  assert.equal(
    runner.calls[0]?.timeoutMs,
    DESIGN_RASTER_BUDGETS.buildTimeoutMs,
    "超时该来自 main 侧的额度表,而不是渲染层或某个调用方随手写的数",
  );
});

test("the shipped registry holds exactly the tailwind recipe", () => {
  const recipes = designBuildRecipes({ scriptPath: "/app/dist/electron/design-build.mjs" });

  // 钉住"应用实际启用了哪几套方案"。加一套就得动这条 —— 那正是想要的效果:
  // 新增一条能执行命令的路径,不该是一次没人注意的改动。
  assert.deepEqual(
    recipes.map((recipe) => recipe.id),
    ["tailwind"],
  );
  assert.equal(recipes[0]?.unavailableReason(), null, "发布版里不该有不可用的借口");
});

test("the tailwind recipe runs the app's own binary on an app-shipped script", () => {
  const plan = resolveBuildPlan({
    manifest: builtManifest({ build: { recipe: "tailwind" } }),
    designPath: DESIGN_PATH,
    recipes: designBuildRecipes({ scriptPath: "/app/dist/electron/design-build.mjs" }),
  });

  assert.equal(plan.ok, true);
  if (!plan.ok) return;

  // 命令与参数**全部**来自第一方表:清单里只有 "recipe": "tailwind" 这一个字符串。
  assert.equal(plan.command, process.execPath, "跑应用自己的二进制,不假设机器上装了 node");
  assert.deepEqual(plan.args, [
    "/app/dist/electron/design-build.mjs",
    DESIGN_PATH,
    `${DESIGN_PATH}/${BUILD_STAGING_DIRECTORY}`,
  ]);
  // Electron 的二进制只有带上这个才会以 Node 的身份执行脚本,否则它会去开一个新窗口。
  assert.equal(plan.env?.ELECTRON_RUN_AS_NODE, "1");
});

test("a design in built mode with no recipe declared is refused before any process starts", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const recipes = designBuildRecipes({ scriptPath: "/app/dist/electron/design-build.mjs" });

  const result = await build(fs, runner, { ...builtManifest(), build: undefined }, recipes);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : null, "recipe-missing");
  assert.equal(runner.calls.length, 0);
});

// ──────────────── 用户可见的契约:新建设计就是有样式的 ────────────────

test("creating a design builds it, so the very first frame has styles", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  const store = new DesignStore({ fs });

  const created = await store.createDesign({
    root: "/workspace",
    name: "Login",
    title: "Login",
    frameWidth: 1440,
    frameHeight: 900,
    // id 必须与脚手架写进 design.json 的一致 —— 不一致时 `recipe-unavailable` 会立刻说出来。
    builds: { runner, recipes: [recipe({ id: "tailwind" })] },
  });

  assert.notEqual(created, null);
  assert.equal(created?.build?.ok, true, "建包后必须真的构建了一次");
  assert.equal(runner.calls.length, 1);

  // 脚手架默认就是 built 模式 —— 否则 dist/ 只是源文件的原样拷贝,而帧里那些工具类
  // 一条都不生效(见 docs/architecture/design-canvas.md §14.10)。
  const manifest = JSON.parse(fs.text(`${created?.path}/design.json`) ?? "{}");
  assert.equal(manifest.mode, "built");
  assert.deepEqual(manifest.build, { recipe: "tailwind" });
});

test("a build failure never turns a created design into a failed creation", async () => {
  const fs = new FakeDesignFs();
  const runner = new FakeBuildRunner(fs);
  runner.result = { code: 1, timedOut: false, stdout: "", stderr: "tailwind exploded" };
  const store = new DesignStore({ fs });

  const created = await store.createDesign({
    root: "/workspace",
    name: "Login",
    title: "Login",
    frameWidth: 1440,
    frameHeight: 900,
    // id 必须与脚手架写进 design.json 的一致 —— 不一致时 `recipe-unavailable` 会立刻说出来。
    builds: { runner, recipes: [recipe({ id: "tailwind" })] },
  });

  // 盘上已经有一份不错的设计了。把它当成"没建成"会得到一个更糟的状态:调用方以为要重来,
  // 而用户看到的是"创建失败",设计其实在。
  assert.notEqual(created, null, "构建失败不能让建包失败");
  assert.deepEqual(created?.build, {
    ok: false,
    code: "exit-nonzero",
    detail: "The build exited with code 1.",
    stdout: "",
    stderr: "tailwind exploded",
  });
  assert.equal(fs.text(`${created?.path}/design.json`) === undefined, false, "清单必须留在盘上");
});

test("opening a built design refreshes its frames but keeps the compiled stylesheet", async () => {
  const fs = new FakeDesignFs();
  fs.putFile("/workspace/login.wdesign/design.json", serializeManifest(builtManifest()));
  fs.putFile("/workspace/login.wdesign/theme.css", "@theme {\n\t--color-primary: #4f46e5;\n}");
  fs.putFile("/workspace/login.wdesign/frames/index.html", '<body class="bg-surface">');
  // 上一次构建的产物。
  fs.putFile("/workspace/login.wdesign/dist/theme.css", "/* COMPILED */");
  fs.putFile("/workspace/login.wdesign/dist/frames/index.html", "OLD FRAME");

  const store = new DesignStore({ fs });
  // 打开时会顺带同步渲染根。
  await store.openDesign("/workspace/login.wdesign");

  // 帧的改动必须能看到 —— 否则 agent 改了帧,画布上还是上一次构建的快照。
  assert.equal(fs.text("/workspace/login.wdesign/dist/frames/index.html"), '<body class="bg-surface">');
  // 但编译产物必须留住 —— 拿源文件覆盖它等于每次打开都把样式删掉。
  assert.equal(fs.text("/workspace/login.wdesign/dist/theme.css"), "/* COMPILED */");
});
