import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeDesignFs } from "./design-fs.ts";
import { performDesignBuild } from "./design-build-step.ts";
import { TailwindUnavailableError, createTailwindCompiler } from "./tailwind-theme.ts";

/**
 * 构建脚本的进程入口。
 *
 * 打成**独立产物**(`dist/electron/design-build.mjs`)并由构建器以子进程启动,理由与
 * `docs/architecture/design-canvas.md` §6.5 一致:一次构建 = 一个子进程,结束即退出。
 * 把它放进主进程会直接冻住界面 —— Tailwind 编译是 CPU 活儿,而设计里有多少帧、多少
 * 类名是 agent 写的,不由我们决定。
 *
 * 打成 **ESM** 而不是像主进程那样打成 CJS:`@tailwindcss/node` 是 ESM-only,而 CJS 里的
 * 动态 import 会被改写成 require —— 那条路在 ESM-only 包上不通。
 *
 * 用法:`design-build.mjs <设计包根目录> <产出目录>`
 *
 * 本文件不 import React、不 import Electron。
 */

const [, , designRoot, stagingPath] = process.argv;

if (designRoot === undefined || stagingPath === undefined) {
  process.stderr.write("design-build: missing arguments (expected <designRoot> <stagingPath>)\n");
  process.exit(2);
}

try {
  const result = await performDesignBuild({
    fs: new NodeDesignFs(),
    designRoot,
    stagingPath,
    // 脚本自己所在的目录 = 应用目录。`tailwindcss` 从那里向上能找到。
    resolveBase: dirname(fileURLToPath(import.meta.url)),
    compiler: createTailwindCompiler({ resolveBase: dirname(fileURLToPath(import.meta.url)) }),
  });
  process.stdout.write(
    `theme.css ${result.cssBytes} bytes from ${result.candidateCount} candidates across ${result.fileCount} files\n`,
  );
} catch (error) {
  // Tailwind 不在安装里是配置问题,不是"这次构建运气不好" —— 分开说,免得让人去重跑。
  const message =
    error instanceof TailwindUnavailableError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`design-build: ${message}\n`);
  process.exit(1);
}
