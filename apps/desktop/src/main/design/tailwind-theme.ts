/**
 * 用 Tailwind 把设计包的令牌编译成真 CSS。
 *
 * **入口的形状照 open-vetta 的引擎**(`engine/src/styles.css`):先 `@import "tailwindcss"`
 * 把 preflight 与工具层拉进来,再引入设计自己的 `@theme` 令牌。它那边的 `theme.css` 与我们
 * 的**逐字相同**(只有 `@theme`),所以这不是"文件写错了",而是"少了编译这一步" —— 浏览器
 * 既不懂 `@theme`,也没见过 `bg-surface` 这些类名。
 *
 * **与它的差别在机制上**:它把这套编译放在每个设计一个的常驻 Vite dev server 里(因为它的帧
 * 是 JSX 模块)。我们的帧是静态 HTML、渲染读 `dist/`,所以**一次批量编译**就能得到同样的
 * 产物 —— 没有常驻进程,没有端口,没有运行时 `npm ci`。
 *
 * 本文件不 import React、不 import Electron。
 */

/**
 * 编译入口。
 *
 * `@theme` 必须排在 `@import "tailwindcss"` **之后**(与 open-vetta 的顺序一致):
 * v4 里 `@theme` 是在默认主题之上做增量覆盖,先声明令牌再引入工具层并不能让它们生效。
 */
export function buildTailwindEntry(themeCss: string): string {
  return `@import "tailwindcss";\n${themeCss}\n`;
}

export interface TailwindCompileInput {
  /** 设计包的 `theme.css`(只有 `@theme` 块)。 */
  themeCss: string;
  /** 从帧源码里扫出来的候选类名。 */
  candidates: readonly string[];
  /**
   * 解析 `@import` 的基准目录。
   *
   * **不能给设计包目录。** 设计包在工作区里(应用之外),从那里解析不到 `tailwindcss`
   * —— 实测报的是 `Can't resolve 'tailwindcss' in '<设计包路径>'`。入口 CSS 是我们自己
   * 拼的字符串(令牌已内联),所以这个 base 只用来做模块解析,给**应用自己的目录**才是对的。
   */
  resolveBase: string;
}

/**
 * 编译器端口。
 *
 * 端口化的理由与仓库里其它服务一致:`@tailwindcss/node` 是个带原生依赖的重物,而"入口拼得
 * 对不对""候选有没有传下去""失败怎么报"这些都要能在不加载它的前提下测透。
 */
export interface TailwindCompiler {
  compile(input: TailwindCompileInput): Promise<string>;
}

/** 工具不可用。文案要指到具体是哪个包 —— "构建失败"四个字对谁都没用。 */
export class TailwindUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      "Tailwind is not part of this build: the @tailwindcss/node package could not be loaded. " +
        "It is a dependency of the app, so this means the installation is incomplete.",
      { cause },
    );
    this.name = "TailwindUnavailableError";
  }
}

/**
 * 真编译器。
 *
 * `@tailwindcss/node` 是 ESM 且带原生依赖(`lightningcss` / `oxide`),所以**动态 import**:
 * 静态 import 会让打包器试图把它内联进主进程产物,而那既会拖慢启动、也会让原生 require
 * 在错误的路径上解析。只有真的要构建时才加载它。
 */
export interface TailwindCompilerOptions {
  /** 解析 `tailwindcss` 的目录。给构建脚本自己所在的应用目录。 */
  resolveBase: string;
}

export function createTailwindCompiler(options: TailwindCompilerOptions): TailwindCompiler {
  return {
    async compile(input: TailwindCompileInput): Promise<string> {
      let compile: typeof import("@tailwindcss/node").compile;
      try {
        ({ compile } = await import("@tailwindcss/node"));
      } catch (error) {
        throw new TailwindUnavailableError(error);
      }

      const compiler = await compile(buildTailwindEntry(input.themeCss), {
        base: options.resolveBase,
        // 我们自己去扫候选(见 `tailwind-candidates.ts`),所以不需要依赖回调。
        onDependency: () => {},
      });

      // `build()` 返回的就是 CSS 文本(`@tailwindcss/vite` 也把它的返回值直接当 `code`)。
      return compiler.build([...input.candidates]);
    },
  };
}
