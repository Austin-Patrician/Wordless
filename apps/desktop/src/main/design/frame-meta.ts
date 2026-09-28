/**
 * 帧文件里的尺寸/标题声明。
 *
 * 格式是一行 HTML 注释,**不是** DOM 里的元素 —— 声明不该出现在渲染结果里:
 *
 * ```html
 * <!doctype html>
 * <!-- @frame { "width": 390, "height": 844, "title": "首页" } -->
 * ```
 *
 * 用 JSON 而不是 JS 对象字面量:HTML 注释里没有 JS 语法,`JSON.parse` 是唯一没有歧义
 * 的读法(参考实现用正则拆 JS 字面量,注释里自己写着"花括号会让 `[^}]*` 提前收口")。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface ParsedFrameMeta {
  /** 没声明就是 null。 */
  width: number | null;
  height: number | null;
  title: string;
}

/** 声明可以出现在文件任何位置,但约定放开头(在 `<!doctype html>` 之后)。 */
const FRAME_COMMENT = /<!--\s*@frame\s*(\{[\s\S]*?\})\s*-->/;

/**
 * 从帧源码里读声明。
 *
 * **尺寸缺失不回落到任何默认值** —— 补默认尺寸会让 agent 以为自己写对了,而画布上多出
 * 一块谁都没要的画板。缺就是缺,由调用方按兜底链决定用哪个尺寸,并把这个缺失作为
 * issue 报出去("渲染"和"报错"是两件事,可以都要)。
 */
export function parseFrameMeta(source: string, fallbackTitle: string): ParsedFrameMeta {
  const empty: ParsedFrameMeta = { width: null, height: null, title: fallbackTitle };
  const match = FRAME_COMMENT.exec(source);
  const body = match?.[1];
  if (body === undefined) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 坏声明等同没声明:帧照常上画布,问题从 issues 报出去。
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty;

  const record = parsed as Record<string, unknown>;
  return {
    width: positiveNumber(record.width),
    height: positiveNumber(record.height),
    title: typeof record.title === "string" && record.title.trim() !== "" ? record.title : fallbackTitle,
  };
}

/** 生成一行声明注释。 */
export function frameComment(meta: { width: number; height: number; title: string }): string {
  const payload = JSON.stringify({
    width: Math.round(meta.width),
    height: Math.round(meta.height),
    title: sanitizeFrameTitle(meta.title),
  });
  return `<!-- @frame ${escapeForHtmlComment(payload)} -->`;
}

/**
 * 让 JSON 里不可能出现 `-->`。
 *
 * `JSON.stringify` **不转义 `<` 和 `>`**,于是标题里只要有一个 `-->`,注释就会**提前结束**,
 * 后面的内容变成真正的标记 —— 那是注入,不是格式问题。把这两个字符换成 JSON 的 `\uXXXX`
 * 转义:读回来完全一样,而注释里再也凑不出 `-->`。
 */
function escapeForHtmlComment(payload: string): string {
  return payload.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/**
 * 把标题写回声明注释,其余源码原样保留。
 *
 * 标题的**声明**在帧文件里(清单里那份只是上次同步的快照),所以改标题要写回源码 ——
 * 只改清单的话,下一次 agent 动这一行就被改回去了。
 *
 * 找不到声明时返回 null:调用方据此报错,而不是往源码里瞎塞一行。
 */
export function withFrameTitle(source: string, title: string): string | null {
  const match = FRAME_COMMENT.exec(source);
  const body = match?.[1];
  if (match === null || body === undefined || match.index === undefined) return null;

  let parsed: Record<string, unknown> = {};
  try {
    const candidate = JSON.parse(body) as unknown;
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    // 坏声明也照样重写:把标题写进去正好把它修好。
  }

  const next = { ...parsed, title: sanitizeFrameTitle(title) };
  // 与 `frameComment` 用同一个转义:改标题同样不能把注释写坏。
  const replacement = `<!-- @frame ${escapeForHtmlComment(JSON.stringify(next))} -->`;
  return `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
}

/**
 * 标题要写进 JSON 字符串里:换行会被 `JSON.stringify` 转义成 `\n`(没问题),但控制字符
 * 与超长标题会让清单和标签页变得不可读。截断到 60 字符。
 */
export function sanitizeFrameTitle(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
