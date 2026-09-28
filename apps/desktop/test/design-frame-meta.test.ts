import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_FRAME_SIZE } from "../src/main/design/manifest.ts";
import { resolveFrameSizes } from "../src/main/design/frame-size.ts";
import {
  frameComment,
  parseFrameMeta,
  sanitizeFrameTitle,
  withFrameMeta,
} from "../src/main/design/frame-meta.ts";

test("读得出声明", () => {
  const source = `<!doctype html>\n<!-- @frame { "width": 390, "height": 844, "title": "首页" } -->\n<html></html>`;
  assert.deepEqual(parseFrameMeta(source, "index"), { width: 390, height: 844, title: "首页" });
});

test("声明可以有多余空白", () => {
  const source = `<!--   @frame    {  "width" : 390 ,  "height" : 844 , "title" : "首页" }   -->`;
  assert.deepEqual(parseFrameMeta(source, "index"), { width: 390, height: 844, title: "首页" });
});

test("没有声明时尺寸是 null,不回落到默认值", () => {
  // 补默认尺寸会让 agent 以为自己写对了,而画布上多出一块谁都没要的画板。
  assert.deepEqual(parseFrameMeta("<html></html>", "index"), { width: null, height: null, title: "index" });
});

test("坏声明等同没声明,而不是抛错", () => {
  for (const source of [
    `<!-- @frame { not json } -->`,
    `<!-- @frame [1, 2] -->`,
    `<!-- @frame "just a string" -->`,
    `<!-- @frame -->`,
  ]) {
    const parsed = parseFrameMeta(source, "index");
    assert.deepEqual(parsed, { width: null, height: null, title: "index" }, source);
  }
});

test("部分声明如实返回,策略交给尺寸解析", () => {
  // 解析器只如实报告读到了什么;"给了一半"该怎么办是 frame-size 的策略。
  // 分开的理由是这两件事的 issue 不同:漏声明和"给了宽没给高"对 agent 的可操作性不一样。
  const parsed = parseFrameMeta(`<!-- @frame { "width": 390 } -->`, "index");
  assert.deepEqual(parsed, { width: 390, height: null, title: "index" });
  // 而尺寸解析里"半份声明"等同没有声明,所以帧仍然拿得到兜底尺寸、不会掉出画布。
  assert.deepEqual(resolveFrameSizes([{ id: "index", parsed }]).get("index"), FALLBACK_FRAME_SIZE);
});

test("非法尺寸不被当成声明", () => {
  for (const width of [0, -1, Number.NaN, "390", null]) {
    const source = `<!-- @frame ${JSON.stringify({ width, height: 844, title: "t" })} -->`;
    assert.equal(parseFrameMeta(source, "index").width, null, `width=${String(width)}`);
  }
});

test("空标题回落到帧 id", () => {
  const source = `<!-- @frame { "width": 390, "height": 844, "title": "   " } -->`;
  assert.equal(parseFrameMeta(source, "index").title, "index");
});

test("生成与解析是一对往返", () => {
  const comment = frameComment({ width: 390.4, height: 844.6, title: "首页" });
  // 尺寸取整:小数尺寸没有意义,还会让清单难读。
  assert.deepEqual(parseFrameMeta(comment, "x"), { width: 390, height: 845, title: "首页" });
});

test("改标题只动标题,其余源码原样", () => {
  const source = `<!doctype html>\n<!-- @frame { "width": 390, "height": 844, "title": "旧" } -->\n<link rel="stylesheet" href="../theme.css">\n`;
  const next = withFrameMeta(source, { title: "新标题" });
  assert.ok(next !== null);
  assert.equal(parseFrameMeta(next, "x").title, "新标题");
  assert.equal(parseFrameMeta(next, "x").width, 390);
  assert.ok(next.startsWith("<!doctype html>\n"));
  assert.ok(next.includes(`href="../theme.css"`));
});

test("声明里没有标题时补上", () => {
  const next = withFrameMeta(`<!-- @frame { "width": 390, "height": 844 } -->`, { title: "标题" });
  assert.deepEqual(next === null ? null : parseFrameMeta(next, "x"), {
    width: 390,
    height: 844,
    title: "标题",
  });
});

test("坏声明会被重写修好", () => {
  const next = withFrameMeta(`<!-- @frame { broken } -->`, { title: "标题" });
  assert.ok(next !== null);
  assert.equal(parseFrameMeta(next, "x").title, "标题");
});

test("没有声明时返回 null,不往源码里瞎塞", () => {
  // 调用方据此报错,而不是猜一个位置插进去。
  assert.equal(withFrameMeta("<html></html>", { title: "标题" }), null);
});

test("标题里的危险字符被清理", () => {
  // 控制字符会让清单与标签页不可读;超长标题同理。
  assert.equal(sanitizeFrameTitle("a\nb\tc"), "a b c");
  assert.equal(sanitizeFrameTitle("  spaced  out  "), "spaced out");
  assert.equal(sanitizeFrameTitle("x".repeat(100)).length, 60);
  assert.equal(sanitizeFrameTitle("\u0000\u0001"), "");
});

test("清理后的标题仍能安全往返", () => {
  const messy = `标题 with "quotes" and \\ backslash`;
  const next = withFrameMeta(`<!-- @frame { "width": 1, "height": 1 } -->`, { title: messy });
  assert.ok(next !== null);
  assert.equal(parseFrameMeta(next, "x").title, sanitizeFrameTitle(messy));
});
