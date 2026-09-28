import type { BuildRecipe } from "./build-recipes.ts";
import type { DesignFs } from "./design-fs.ts";
import type { DesignManifest } from "./manifest.ts";

/**
 * `mode: "built"` 的构建器。
 *
 * 三条纪律(见 `docs/architecture/design-canvas.md` §6.5):
 *
 * 1. **不是常驻进程** —— 一次构建 = 一个子进程,结束即退出。没有端口,没有 watch 进程。
 * 2. **超时 + 只在成功时切换** —— 失败**一个字节都不动**旧的 `dist/`。
 * 3. **画布不等待构建** —— 构建期间画布照常显示旧产物;这条由「构建器在成功之前不碰
 *    `dist/`」直接保证,不需要额外的协调。
 *
 * 本文件不 import React、不 import Electron。
 */

export const BUILD_STAGING_DIRECTORY = "dist.staging";
/**
 * 切换用的中转名。
 *
 * 为什么需要它:`rename(staging, dist)` 在目标是非空目录时会失败(POSIX 的 `rename`
 * 只有在目标为空或不存在时才允许覆盖目录)。所以得先把旧的挪开。
 */
export const BUILD_PREVIOUS_DIRECTORY = "dist.previous";

export type BuildFailureCode =
  | "not-built-mode"
  | "recipe-missing"
  | "recipe-unavailable"
  | "spawn-failed"
  | "timeout"
  | "exit-nonzero"
  | "output-missing"
  | "swap-failed";

export type DesignBuildResult =
  | { ok: true; recipeId: string; durationMs: number; stdout: string }
  | { ok: false; code: BuildFailureCode; detail: string; stdout: string; stderr: string };

export interface BuildRunnerInput {
  command: string;
  args: string[];
  cwd: string;
  /**
   * 附加环境变量,叠加在继承来的环境之上。
   *
   * 需要它是因为构建脚本跑的是**应用自己的二进制**:Electron 只有带上
   * `ELECTRON_RUN_AS_NODE=1` 才以 Node 的身份执行脚本,否则它会去开一个新窗口。
   */
  env?: Record<string, string>;
  /**
   * 到点必须**自行结束**:杀掉子进程并返回 `timedOut: true`。
   *
   * 把超时交给 runner 而不是构建器,是因为只有 runner 拿着进程句柄 —— 构建器能做的
   * 只是"等一个 promise",它无法让一个不肯退出的子进程停下。假实现也必须遵守这条:
   * 一个到点不 settle 的假实现会把构建器卡死,而测试看起来还在跑。
   */
  timeoutMs: number;
}

export interface BuildRunnerResult {
  /** 进程退出码。被信号杀掉时为 null。 */
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface BuildRunner {
  run(input: BuildRunnerInput): Promise<BuildRunnerResult>;
}

export interface ResolveBuildPlanInput {
  manifest: DesignManifest;
  designPath: string;
  recipes: readonly BuildRecipe[];
}

export type BuildPlanResolution =
  | { ok: true; recipe: BuildRecipe; command: string; args: string[]; env?: Record<string, string> }
  | { ok: false; code: BuildFailureCode; detail: string };

/**
 * 判定这份设计要不要构建、以及怎么构建。
 *
 * 抽成纯函数是因为"该不该构建"的四种说法(不是 built 模式 / 没声明方案 / 方案没注册 /
 * 方案的工具不可用)都要能被单独断言 —— 它们分别对应"这是别人的事"和"这是我的配置坏了",
 * 混成一句话会让人去翻错地方。
 */
export function resolveBuildPlan(input: ResolveBuildPlanInput): BuildPlanResolution {
  if (input.manifest.mode !== "built") {
    return {
      ok: false,
      code: "not-built-mode",
      detail: "This design is in static mode: dist/ is synced from its source files, so there is nothing to build.",
    };
  }

  const recipeId = input.manifest.build?.recipe ?? null;
  if (recipeId === null) {
    return {
      ok: false,
      code: "recipe-missing",
      detail: "This design is in built mode but design.json does not say which build recipe to use.",
    };
  }

  const recipe = input.recipes.find((candidate) => candidate.id === recipeId) ?? null;
  if (recipe === null) {
    return {
      ok: false,
      code: "recipe-unavailable",
      detail: `No build recipe named "${recipeId}" is registered.`,
    };
  }

  const unavailable = recipe.unavailableReason();
  if (unavailable !== null) {
    return { ok: false, code: "recipe-unavailable", detail: unavailable };
  }

  const { command, args, env } = recipe.argv({
    designPath: input.designPath,
    stagingPath: joinPath(input.designPath, BUILD_STAGING_DIRECTORY),
  });
  return { ok: true, recipe, command, args, ...(env === undefined ? {} : { env }) };
}

export interface RunDesignBuildInput {
  fs: DesignFs;
  runner: BuildRunner;
  manifest: DesignManifest;
  designPath: string;
  recipes: readonly BuildRecipe[];
  timeoutMs: number;
}

/**
 * 跑一次构建。
 *
 * **只有成功路径会碰 `dist/`。** 每一条失败分支都在返回之前把暂存目录清掉,并且不进
 * `dist/` —— 这就是"构建失败保留上一份好产物"的实现方式:不是靠回滚,是靠不写。
 */
export async function runDesignBuild(input: RunDesignBuildInput): Promise<DesignBuildResult> {
  const { fs, designPath } = input;

  const plan = resolveBuildPlan({ manifest: input.manifest, designPath, recipes: input.recipes });
  if (!plan.ok) return { ok: false, code: plan.code, detail: plan.detail, stdout: "", stderr: "" };

  const staging = joinPath(designPath, BUILD_STAGING_DIRECTORY);
  await fs.remove(staging);
  await fs.ensureDirectory(staging);

  const started = Date.now();
  let result: BuildRunnerResult;
  try {
    result = await input.runner.run({
      command: plan.command,
      args: plan.args,
      cwd: designPath,
      ...(plan.env === undefined ? {} : { env: plan.env }),
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    // 连进程都没起来(命令不存在、没有权限)。同样不留暂存目录。
    await fs.remove(staging);
    return { ok: false, code: "spawn-failed", detail: describeError(error), stdout: "", stderr: "" };
  }

  if (result.timedOut) {
    await fs.remove(staging);
    return {
      ok: false,
      code: "timeout",
      detail: `The build did not finish within ${input.timeoutMs}ms and was stopped.`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  if (result.code !== 0) {
    await fs.remove(staging);
    return {
      ok: false,
      code: "exit-nonzero",
      detail: `The build exited with code ${result.code === null ? "unknown (killed by a signal)" : result.code}.`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  // 成功退出但什么都没写。**这必须当成失败** —— 放它过去就等于用一次成功的空构建把
  // 上一份能看的产物换掉,而原因在退出码里看不出来。
  const produced = await fs.listFiles(staging);
  if (produced.length === 0) {
    await fs.remove(staging);
    return {
      ok: false,
      code: "output-missing",
      detail: "The build reported success but wrote nothing into its output directory, so the previous preview was kept.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  try {
    await swapIntoPlace(fs, designPath);
  } catch (error) {
    await fs.remove(staging);
    return {
      ok: false,
      code: "swap-failed",
      detail: describeError(error),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return { ok: true, recipeId: plan.recipe.id, durationMs: Date.now() - started, stdout: result.stdout };
}

/**
 * `dist.staging/` → `dist/`。
 *
 * **这不是一次原子操作,这里说清楚它到底原子在哪:**
 *
 * POSIX 的 `rename` 只在目标为空或不存在时才允许覆盖目录,而 `dist/` 是非空的,所以
 * 必须先挪开旧的。于是有两次 rename,中间有一个 `dist/` **不存在**的窗口。
 *
 * 业务上这个窗口是安全的,理由是它两侧的状态都是"能自恢复的":
 *
 * - 窗口内进来的读请求拿到 404,渲染层把它当成**"这一帧还没有产物"**(`absent`,占位卡),
 *   不是错误;
 * - 第二次 rename 失败时会把旧的搬回来,宁可回到"上一份好的"也不要停在"没有一份"。
 *
 * 真正必须保证的那条 ——**构建失败不动旧产物** —— 不依赖这里的原子性,靠的是构建器在
 * 成功之前根本不进这个函数。
 */
async function swapIntoPlace(fs: DesignFs, designPath: string): Promise<void> {
  const dist = joinPath(designPath, "dist");
  const staging = joinPath(designPath, BUILD_STAGING_DIRECTORY);
  const previous = joinPath(designPath, BUILD_PREVIOUS_DIRECTORY);

  await fs.remove(previous);
  const hadPrevious = (await fs.stat(dist)) !== null;
  if (hadPrevious) await fs.rename(dist, previous);

  try {
    await fs.rename(staging, dist);
  } catch (error) {
    if (hadPrevious) {
      try {
        await fs.rename(previous, dist);
      } catch {
        // 搬不回来就只能让上一次的构建目录留在 `dist.previous/`,下次构建会先清掉它。
      }
    }
    throw error;
  }

  await fs.remove(previous);
}

function joinPath(root: string, name: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
