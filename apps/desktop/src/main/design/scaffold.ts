import { frameComment } from "./frame-meta.ts";
import { emptyManifest, MANIFEST_FILE, serializeManifest, type DesignManifest } from "./manifest.ts";
import { TAILWIND_RECIPE_ID } from "./build-recipes.ts";

/**
 * 新建一个设计包。
 *
 * **由插件产脚手架,不由 agent 手搓** —— 目录结构、令牌文件、第一个帧的 `@frame` 声明都是
 * 约定;让模型每次自己拼一遍,迟早会拼出一个少了下划线的目录名或者写错的清单。
 *
 * 刻意**不铺任何示例内容**:一份设计可能是界面、幻灯片或海报,预置一个手机画板等于替用户
 * 押了尺寸和品类。品类尺寸记在清单的 `defaultFrameSize` 里 —— 它只在某个帧漏声明时兜底,
 * 不往画布上放任何东西。
 *
 * 本文件不 import React、不 import Electron。
 */

/**
 * 默认主题令牌。
 *
 * Tailwind v4 的 `@theme` 写法,于是帧里可以直接用 `bg-primary`、`text-surface-foreground`
 * 这样的工具类。这是**给用户的文件**,所以中英文宿主都要能读 —— 用英文写。
 * 改这里就是给整份设计换肤。
 *
 * `static` 不是可有可无的:默认的 `@theme` **只发出被用到的**变量,帧里的类只要没用到
 * 某个令牌,产物里就没有它 —— 于是手写 `var(--color-primary)` 会静默取不到值。加了 static
 * 之后全部声明都会发出,代价只是产物大一点点。内置风格与生成器也都用 static,别改回去。
 */
export const DEFAULT_THEME_CSS = `/* Colour system for this design document: Tailwind v4 @theme tokens.
 * Every frame uses them as utilities (bg-primary, text-surface-foreground, …).
 * Edit here to reskin the whole design. */
@theme static {
	--color-primary: #4f46e5;
	--color-primary-foreground: #ffffff;
	--color-surface: #f8fafc;
	--color-surface-foreground: #0f172a;
	--color-muted: #64748b;
	--color-accent: #f59e0b;
	--color-danger: #ef4444;
}
`;

/**
 * 目录名清洗。
 *
 * 只保留对文件系统安全的字符:路径分隔符、冒号、问号这些在某个平台上会被拒绝,而失败会
 * 出现在"新建设计"这个最容易让人放弃的第一步。
 */
export function sanitizeDesignName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\.wdesign$/i, "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "design";
}

export const DESIGN_DIRECTORY_SUFFIX = ".wdesign";

/** 帧 id 的字符集:它必须同时是合法文件名与合法 URL 段。 */
export function sanitizeFrameId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "index";
}

/**
 * 下一个可用的帧 id,以及它排在第几。
 *
 * 从 **2** 起:首帧是 `index`(建包时那个)。取"最小的空位"而不是"最大值 +1",于是删掉
 * `frame-2` 之后再新建会把它补回来 —— 帧 id 是人会在文件名里读到的东西,不该一直往上涨。
 *
 * 返回序号是因为调用方要用它给标题编号:画布上唯一的标签就是标题,两帧都叫"未命名画面"
 * 是没法认的。
 *
 * `taken` 要**同时**包含清单里的和 `frames/` 目录里的:清单是上次同步的快照,而磁盘上可能
 * 已经有 agent 写进去、还没对账的帧 —— 只查清单会覆盖掉一个真实文件。
 */
export function nextFrameId(taken: Iterable<string>): { id: string; ordinal: number } {
  const used = new Set(taken);
  for (let ordinal = 2; ; ordinal += 1) {
    const id = `frame-${ordinal}`;
    if (!used.has(id)) return { id, ordinal };
  }
}

/** 空帧的源码。声明在最前面,`@frame` 注释是它的尺寸与标题的唯一来源。 */
export function blankFrameSource(input: { width: number; height: number; title: string }): string {
  return `<!doctype html>
${frameComment(input)}
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<link rel="stylesheet" href="../theme.css" />
	</head>
	<body class="bg-surface text-surface-foreground">
		<main class="grid min-h-screen place-items-center">
			<p class="text-muted">${escapeHtml(input.title)}</p>
		</main>
	</body>
</html>
`;
}

export interface ScaffoldResult {
  /** `x.wdesign` 的目录路径。 */
  designPath: string;
  /** 首个帧的 id。 */
  frameId: string;
  manifest: DesignManifest;
  files: { path: string; content: string }[];
}

/**
 * 算出要写哪些文件。
 *
 * 纯函数:返回清单而不是自己写盘,于是"建一份设计包包含什么"这件事可以单测,而写盘由
 * store 统一处理(它才有 write-then-rename 那套纪律)。
 */
export function scaffoldDesign(input: {
  /** 目录所在的工作区根。 */
  root: string;
  name: string;
  title: string;
  frameWidth: number;
  frameHeight: number;
  /**
   * 选中的风格。给了就用它的 `theme.css` 与 `DESIGN.md`,否则用内置的默认令牌。
   *
   * 风格在**建包时**落盘而不是事后追加:一份设计从第一帧起就该带着它的令牌,否则第一帧
   * 必然是按默认审美写的,之后要改的是所有帧。
   */
  style?: { id: string; themeCss: string; designMd: string } | null;
}): ScaffoldResult {
  // `input.name` 已经是**最终**目录名(含消歧序号,如果需要):唯一性要在磁盘上探测,
  // 那是异步的,而这个函数是纯的。store 负责探到空闲名字再调这里。
  const designPath = joinPath(input.root, `${sanitizeDesignName(input.name)}${DESIGN_DIRECTORY_SUFFIX}`);

  const frameId = "index";
  const width = Math.max(1, Math.round(input.frameWidth));
  const height = Math.max(1, Math.round(input.frameHeight));
  const title = input.title.trim() || "Home";

  const manifest: DesignManifest = {
    ...emptyManifest(),
    /**
     * **新设计默认是 `built` 模式,而且这是必需的,不是偏好。**
     *
     * 帧里写的是 `bg-surface`、`text-muted` 这类工具类,`theme.css` 里只有 `@theme` 块
     * —— 浏览器对这两者都不认。若建成 `static`,`dist/` 就是源文件的原样拷贝,结果是
     * 一段样式都不生效,文字用默认字体贴在白底上。
     *
     * `static` 仍然保留给"帧里是纯 CSS、不需要编译"的设计。
     */
    mode: "built",
    build: { recipe: TAILWIND_RECIPE_ID },
    style: input.style?.id ?? null,
    // 品类尺寸:只在帧漏声明时兜底,不往画布上放任何东西。
    defaultFrameSize: { width, height },
    frames: [
      {
        id: frameId,
        file: `frames/${frameId}.html`,
        x: 0,
        y: 0,
        width,
        height,
        title,
      },
    ],
  };

  return {
    designPath,
    frameId,
    manifest,
    files: [
      { path: `${designPath}/theme.css`, content: input.style?.themeCss ?? DEFAULT_THEME_CSS },
      ...(input.style ? [{ path: `${designPath}/DESIGN.md`, content: input.style.designMd }] : []),
      { path: `${designPath}/frames/${frameId}.html`, content: blankFrameSource({ width, height, title }) },
      { path: `${designPath}/${MANIFEST_FILE}`, content: serializeManifest(manifest) },
    ],
  };
}

export function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    return "&quot;";
  });
}
