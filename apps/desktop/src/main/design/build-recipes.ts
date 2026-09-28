/**
 * 「构建」这一步的命令从哪里来。
 *
 * **这份表就是安全边界。**
 *
 * 设计包是 agent 写的。如果清单能声明一条命令,那么点一次「重新构建」就等于在应用进程
 * 里执行 agent 写在文本文件里的任意命令 —— 而仓库对命令的约束是在 **shell 工具的边界**
 * 上做的(`agent-workspace-policy` 里匹配 `resolveCommandSecurityRules` 的规则),那条
 * 边界在这里根本走不到。命令与清单之间必须隔着一次代码改动。
 *
 * 所以:清单只能声明**用哪一套构建**,argv 一律由这份第一方表产生。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface BuildRecipeInput {
  designPath: string;
  /**
   * 构建器给出的产出目录。构建**必须**把结果写进这里,而不是直接写 `dist/` ——
   * 否则"构建失败保留上一份好产物"这条无从实现。
   */
  stagingPath: string;
}

export interface BuildRecipeInvocation {
  command: string;
  args: string[];
  /** 附加环境变量,叠加在继承来的环境之上。 */
  env?: Record<string, string>;
}

export interface BuildRecipe {
  id: string;
  /** 一句话说明它做什么。失败信息要能说人话。 */
  label: string;
  /** 这套构建需要的工具在不在。返回 null 表示可用,返回字符串就是不可用的原因。 */
  unavailableReason(): string | null;
  argv(input: BuildRecipeInput): BuildRecipeInvocation;
}

/** 脚手架写进 `design.json` 的方案 id。放在这里,免得两边各写一份字符串。 */
export const TAILWIND_RECIPE_ID = "tailwind";

export interface DesignBuildRecipeOptions {
  /** 构建脚本的绝对路径。随应用发布,与主进程产物同目录。 */
  scriptPath: string;
}

/**
 * 编译 `theme.css` 与帧里用到的工具类。
 *
 * 这份设计包的 `theme.css` 里只有 `@theme` 块,而帧里写的是 `bg-surface`、`text-muted`
 * 这类工具类 —— **浏览器对这两者都不认**。所以这一步不是"锦上添花的优化",而是"一份
 * 新建设计到底有没有样式"。
 *
 * 机制上与参考实现(open-vetta 的 `design-engine`)有意不同:它把这套编译放在**每个设计
 * 一个的常驻 Vite dev server** 里(因为它的帧是 JSX 模块),代价是首次使用时 `npm ci` 整条
 * 工具链、外加每个打开的设计一个常驻进程。我们的帧是静态 HTML、渲染读 `dist/`,所以**一次
 * 批量编译**就能拿到同样的产物,由 `design-builder.ts` 以子进程执行、超时即杀。
 */
export function tailwindBuildRecipe(options: DesignBuildRecipeOptions): BuildRecipe {
  return {
    id: TAILWIND_RECIPE_ID,
    label: "Compile theme.css and the classes the frames use with Tailwind",
    /**
     * **刻意不做父侧预检。**
     *
     * "能不能加载 `@tailwindcss/node`"只有子进程知道得准 —— 那个包按平台解析原生依赖,
     * 而父进程要么去猜、要么为一个预检把重物加载进来(正好是动态 import 要避免的事)。
     * 猜错的代价是"明明能编却说不能",比不预检更糟。
     *
     * 子进程会给出确切原因(`design-build-entry.ts` 里对 `TailwindUnavailableError`
     * 单独措辞),再经 `exit-nonzero` 的 stderr 回到用户面前。
     */
    unavailableReason: () => null,
    argv: ({ designPath, stagingPath }) => ({
      // 跑应用自己的二进制,而不是假设机器上装了 node —— 用户机器上确实没有。
      command: process.execPath,
      args: [options.scriptPath, designPath, stagingPath],
      // Electron 的二进制只有带上这个才会以 Node 的身份执行脚本,否则它会去开一个新窗口。
      env: { ELECTRON_RUN_AS_NODE: "1" },
    }),
  };
}

/** 应用实际启用的一套构建方案。由主进程构造 —— 它知道脚本在哪儿。 */
export function designBuildRecipes(options: DesignBuildRecipeOptions): readonly BuildRecipe[] {
  return [tailwindBuildRecipe(options)];
}
