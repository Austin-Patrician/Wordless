import type { DesignFs } from "./design-fs.ts";
import { isRenderableSource } from "./design-fs.ts";
import { scanTailwindCandidatesIn } from "./tailwind-candidates.ts";
import type { TailwindCompiler } from "./tailwind-theme.ts";

/**
 * 一次构建实际做的三步:铺产物、扫候选、编令牌。
 *
 * 单独成文件(而不是塞进 CLI 入口)是为了能测:入口只做"读 argv、拿真实现、报退出码"
 * 这三件没什么逻辑的事,而这三步里有全部逻辑。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface PerformDesignBuildInput {
  fs: DesignFs;
  /** 设计包根目录。 */
  designRoot: string;
  /** 构建器给出的产出目录。 */
  stagingPath: string;
  /** 解析 `tailwindcss` 的目录 —— 应用自己那一份,不是设计包。 */
  resolveBase: string;
  compiler: TailwindCompiler;
}

export interface PerformDesignBuildResult {
  /** 复制进产物的源文件数。 */
  fileCount: number;
  /** 扫出来的候选类名数。 */
  candidateCount: number;
  cssBytes: number;
}

export async function performDesignBuild(input: PerformDesignBuildInput): Promise<PerformDesignBuildResult> {
  const files = await input.fs.listFiles(input.designRoot);
  const sources = files.filter((file) => isRenderableSource(file.relPath));

  // ① 先按原样铺一遍:帧与资源都保持相对路径,于是帧里的 `../theme.css`、`../assets/x.png`
  // 在 `dist/` 下依然成立。这一步不做任何变换 —— 变换只发生在 theme.css 上。
  const frameSources: string[] = [];
  for (const file of sources) {
    const bytes = await input.fs.readBytes(file.path);
    await input.fs.writeBytes(joinPath(input.stagingPath, file.relPath), bytes);
    if (file.relPath.startsWith("frames/") && file.relPath.endsWith(".html")) {
      frameSources.push(new TextDecoder().decode(bytes));
    }
  }

  // ② 令牌。**读不到就当成空块继续编**,而不是失败:一份被删掉 theme.css 的设计仍然应该
  // 拿到 Tailwind 的 preflight 与内联类名能用上的工具类,而不是整页退回浏览器默认。
  let themeCss = "";
  try {
    themeCss = await input.fs.readText(joinPath(input.designRoot, "theme.css"));
  } catch {
    themeCss = "";
  }

  // ③ 编译,并**覆盖**第 ① 步铺进去的那份令牌文件。帧里的 `<link href="../theme.css">`
  // 一个字都不用改,协议也不用知道构建发生过。
  const candidates = scanTailwindCandidatesIn(frameSources);
  const css = await input.compiler.compile({ themeCss, candidates, resolveBase: input.resolveBase });
  await input.fs.writeText(joinPath(input.stagingPath, "theme.css"), css);

  return {
    fileCount: sources.length,
    candidateCount: candidates.length,
    cssBytes: css.length,
  };
}

function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const trimmed = root.replace(/[\\/]+$/, "");
  return `${trimmed}${separator}${relative.replace(/^[\\/]+/, "").split("/").join(separator)}`;
}
