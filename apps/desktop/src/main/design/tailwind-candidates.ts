/**
 * 从帧源码里扫出 Tailwind 的候选类名。
 *
 * **为什么由我们扫,而不是让 Tailwind 扫**:`@tailwindcss/node` 的 `compile()` 返回的
 * `build(candidates)` 就是要一份候选列表 —— 谁扫都行。自己扫省掉一个原生依赖
 * (`@tailwindcss/oxide` 的 `Scanner`),而我们的输入形态是已知的:一小撮 HTML 帧。
 *
 * **宁可宽松。** 这不是猜测:Tailwind 对不认识的候选**什么都不生成**,所以多给的代价
 * 只是扫描时间;漏给的代价是**一条本该存在的样式静默消失** —— 那正是这次要修的那个
 * bug 的形状(源码读起来没问题,渲染出来是错的)。两边的代价不对称,所以往宽的一侧偏。
 *
 * 本文件不 import React、不 import Electron。
 */

/**
 * 候选里可能出现的字符。
 *
 * 比"合法的类名"宽得多,因为 Tailwind 的候选语法本身就很宽:变体用 `:`、任意值用
 * `[...]`、透明度用 `/`、重要性用 `!`、负数前缀用 `-`。窄一点的字符类会悄悄吃掉
 * `bg-[#fff]/50` 这类写法。
 *
 * 但 `<` `>` `|` `\` **不在其中** —— 它们不可能出现在任何候选里,收进来只会让
 * 每个 HTML 标签都变成一个候选。
 */
const CANDIDATE_CHARACTERS = /^[A-Za-z0-9!@%_\-+:.\[\]/(),#&*$~^=]+$/;

/** 单条候选的长度上限。超过它的一定不是类名,而是被切碎的正文或 URL。 */
const MAX_CANDIDATE_LENGTH = 128;

/**
 * 切分候选的分隔符。
 *
 * 选得比"类名分隔符"宽:因为扫的是**整篇源码**而不是只有 `class="…"` —— 这样
 * `<style>` 里的 `@apply`、模板字符串里拼出来的类名都能被看到。代价是正文里的词也会
 * 变成候选,而那是无害的(见文件头)。
 *
 * `=` **刻意不在其中**。它第一眼像是属性的分隔符,但 Tailwind 的任意变体里就长这样:
 * `data-[state=open]:block` —— 按 `=` 切开会把一条真候选劈成两半,而漏掉的候选不会
 * 报错,只会让那条样式静默消失。
 */
const DELIMITERS = /[\s"'`{};\\<>|]+/;

/**
 * 扫一份源码里的候选类名。
 *
 * 返回**去重且有序**的列表:构建的产物必须是确定的 —— 同一份设计扫两次得同一份 CSS。
 * 否则"构建成功但产物变了"会让缓存与比较全都失去意义。
 */
export function scanTailwindCandidates(source: string): string[] {
  const found = new Set<string>();

  for (const token of source.split(DELIMITERS)) {
    if (token.length === 0 || token.length > MAX_CANDIDATE_LENGTH) continue;
    // 必须含字母:纯数字、纯符号都不是类名,而 `text-2xl`、`w-1/2` 一定有字母。
    if (!/[A-Za-z]/.test(token)) continue;
    if (!CANDIDATE_CHARACTERS.test(token)) continue;
    found.add(token);
  }

  return [...found].sort();
}

/** 扫多份源码。一份里的候选对整份设计都有效 —— Tailwind 生成的是一个共享样式表。 */
export function scanTailwindCandidatesIn(sources: readonly string[]): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    for (const candidate of scanTailwindCandidates(source)) found.add(candidate);
  }
  return [...found].sort();
}
