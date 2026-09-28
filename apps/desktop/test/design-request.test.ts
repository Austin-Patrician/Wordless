import assert from "node:assert/strict";
import test from "node:test";
import { WorkspacePathService } from "@wordless/platform-node";
import { resolveDesignRequest } from "../src/main/design/design-request.ts";
import { contentTypeOf } from "../src/main/design/design-request.ts";
import type { DesignRequest } from "../src/main/design/design-url.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 用**真实的** `WorkspacePathService#isWithinRoot`,不重写一份路径比较 —— 两处规则漂开
 * 是这类缺陷的典型来源。
 */
const paths = new WorkspacePathService();
const isWithinRoot = (root: string, candidate: string): boolean => paths.isWithinRoot(root, candidate);

const DESIGN = "/w/meadow.wdesign";
const DESIGN_ID = "0123456789abcdef";
const OUTSIDE = "/outside/secret.txt";

function fixture(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(`${DESIGN}/dist/frames/index.html`, "<html>ok</html>");
  fs.putFile(`${DESIGN}/dist/theme.css`, "body{}");
  fs.putFile(`${DESIGN}/dist/assets/logo.svg`, "<svg/>");
  fs.putFile(`${DESIGN}/dist/assets/blob.bin`, "x");
  // 包外真实存在的文件:这样"被挡住"只可能来自路径约束,不会因为文件不存在而假通过。
  fs.putFile(OUTSIDE, "root:x:0:0");
  fs.putFile("/w/outside.txt", "sibling");
  return fs;
}

function resolve(fs: FakeDesignFs, request: DesignRequest) {
  return resolveDesignRequest({
    request,
    resolveDesign: (id) => (id === DESIGN_ID ? DESIGN : null),
    fs,
    isWithinRoot,
  });
}

test("帧解析到渲染根里的固定位置", async () => {
  const result = await resolve(fixture(), { kind: "frame", designId: DESIGN_ID, frameId: "index" });
  assert.deepEqual(result, {
    ok: true,
    path: `${DESIGN}/dist/frames/index.html`,
    contentType: "text/html; charset=utf-8",
  });
});

test("资源按后缀给出正确的 content-type", async () => {
  const fs = fixture();
  const css = await resolve(fs, { kind: "asset", designId: DESIGN_ID, relativePath: "theme.css" });
  assert.equal(css.ok && css.contentType, "text/css; charset=utf-8");
  const svg = await resolve(fs, { kind: "asset", designId: DESIGN_ID, relativePath: "assets/logo.svg" });
  assert.equal(svg.ok && svg.contentType, "image/svg+xml");
});

test("未知后缀按二进制流,不猜成 html", async () => {
  // 猜成 text/html 会让一张图片被当成页面解析。
  const blob = await resolve(fixture(), { kind: "asset", designId: DESIGN_ID, relativePath: "assets/blob.bin" });
  assert.equal(blob.ok && blob.contentType, "application/octet-stream");
  assert.equal(contentTypeOf(`${DESIGN}/dist/frames/noext`), "application/octet-stream");
});

test("注册表里没有的设计 id 一律 404", async () => {
  // URL 里没有路径,只有 id —— 所以"指向一个任意目录"从一开始就不可能。
  const result = await resolve(fixture(), { kind: "frame", designId: "ffffffffffffffff", frameId: "index" });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("没有渲染根时是 404,不是错误", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(`${DESIGN}/design.json`, "{}");
  const result = await resolve(fs, { kind: "frame", designId: DESIGN_ID, frameId: "index" });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("手造的 `../` 资源路径被路径约束挡住", async () => {
  // 这条绕过 `parseDesignUrl`:URL 归一化会在那之前吃掉 `..`,所以只有直接构造请求
  // 才能验证约束层本身。目标文件**真实存在**,被挡住只可能来自约束。
  const result = await resolve(fixture(), {
    kind: "asset",
    designId: DESIGN_ID,
    relativePath: "../outside.txt",
  });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("多级 `../` 同样被挡住", async () => {
  const result = await resolve(fixture(), {
    kind: "asset",
    designId: DESIGN_ID,
    relativePath: "../../outside/secret.txt",
  });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("指向包外的符号链接被 realpath 戳穿", async () => {
  // 这是只看字面路径挡不住的一类:链接本身在 dist/assets/ 里,看起来完全合法,
  // 但它指向包外。所以判定必须建立在 realpath 之后。
  const fs = fixture();
  fs.putSymlink(`${DESIGN}/dist/assets/escape.txt`, OUTSIDE);
  const result = await resolve(fs, { kind: "asset", designId: DESIGN_ID, relativePath: "assets/escape.txt" });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("指向包内的符号链接照常可用", async () => {
  // 反过来也要成立,否则就等于"符号链接一律不可用",那是另一个 bug。
  const fs = fixture();
  fs.putSymlink(`${DESIGN}/dist/assets/alias.css`, `${DESIGN}/dist/theme.css`);
  const result = await resolve(fs, { kind: "asset", designId: DESIGN_ID, relativePath: "assets/alias.css" });
  assert.equal(result.ok, true);
});

test("目录不是可服务的目标", async () => {
  const result = await resolve(fixture(), { kind: "asset", designId: DESIGN_ID, relativePath: "assets" });
  assert.deepEqual(result, { ok: false, status: 404 });
});

test("不存在的帧是 404", async () => {
  const result = await resolve(fixture(), { kind: "frame", designId: DESIGN_ID, frameId: "nope" });
  assert.deepEqual(result, { ok: false, status: 404 });
});
