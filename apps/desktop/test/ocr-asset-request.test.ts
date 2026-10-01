import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { OCR_ASSET_HEADERS, contentTypeFor, parseOcrUrl } from "../src/main/ocr/ocr-asset-request.ts";

/**
 * `wordless-ocr://` 的 URL 解析。
 *
 * 这一层是**唯一真的会被用错**的地方:一次目录穿越就等于把一个隐藏窗口的手伸到用户磁盘上。
 * 所以每条"必须被拒"的形状都要有测试,而不是靠"我们只拼固定字符串"的自觉。
 */

describe("parseOcrUrl", () => {
  it("运行器页面与它的资源", () => {
    assert.deepEqual(parseOcrUrl("wordless-ocr://runner/index.html"), { root: "runner", relative: "index.html" });
    assert.deepEqual(parseOcrUrl("wordless-ocr://runner/assets/index-abc.js"), { root: "runner", relative: "assets/index-abc.js" });
  });

  it("资产分 ort 与 models 两个根", () => {
    assert.deepEqual(parseOcrUrl("wordless-ocr://assets/ort/ort-wasm-simd-threaded.wasm"), {
      root: "ort",
      relative: "ort-wasm-simd-threaded.wasm",
    });
    assert.deepEqual(parseOcrUrl("wordless-ocr://assets/models/ppocrv5_rec.onnx"), {
      root: "models",
      relative: "ppocrv5_rec.onnx",
    });
  });

  it("穿越不可能逃出根目录", () => {
    // 断言的是**不变量**而不是某种机制:URL 解析器本身会把 `..` 规整掉(于是结果是根目录内的
    // 一个普通文件名),规整不掉的则由我们拒掉。两种都安全,危险的是"规整后仍在外面的路径"。
    for (const url of [
      "wordless-ocr://runner/../secret.txt",
      "wordless-ocr://runner/a/../../b.txt",
      "wordless-ocr://runner/%2e%2e/secret.txt",
      "wordless-ocr://assets/models/../../resources/python/x",
      "wordless-ocr://runner/a%2f..%2fb",
      "wordless-ocr://assets/ort/..%2f..%2fsecret",
    ]) {
      const route = parseOcrUrl(url);
      if (route === null) continue;
      assert.ok(!route.relative.includes(".."), `规整后仍含 ..: ${url}`);
      assert.ok(!route.relative.startsWith("/"), `规整后成了绝对路径: ${url}`);
      const resolved = resolve("/roots", route.root, route.relative);
      assert.ok(resolved.startsWith("/roots/"), `逃出了根目录: ${url} -> ${resolved}`);
    }
  });

  it("跨根目录的穿越被直接拒绝", () => {
    // 这两条规整之后会落到别的根(或别的段)上,必须 null,不能"顺手换个根"。
    assert.equal(parseOcrUrl("wordless-ocr://assets/models/../../resources/python/x"), null);
    assert.equal(parseOcrUrl("wordless-ocr://runner/a%2f..%2fb"), null);
  });

  it("陌生的 host、缺文件、空路径都拒绝", () => {
    for (const url of [
      "wordless-ocr://elsewhere/index.html",
      "wordless-ocr://assets/index.html",
      "wordless-ocr://assets/ort/",
      "wordless-ocr://assets/other/x.wasm",
      "wordless-ocr://runner/",
      "https://example.com/x",
      "not a url",
    ]) {
      assert.equal(parseOcrUrl(url), null, url);
    }
  });

  it("反斜杠与空格不被当成合法路径", () => {
    assert.equal(parseOcrUrl("wordless-ocr://runner/a\\b"), null);
    assert.equal(parseOcrUrl("wordless-ocr://runner/a b.js"), null);
  });
});

describe("响应头与内容类型", () => {
  it("wasm 必须是 application/wasm(否则流式编译会退化成解释执行)", () => {
    assert.equal(contentTypeFor("ort-wasm-simd-threaded.wasm"), "application/wasm");
    assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
    assert.equal(contentTypeFor("ppocrv5_det.onnx"), "application/octet-stream");
    assert.equal(contentTypeFor("ppocrv5_dict.txt"), "text/plain; charset=utf-8");
    assert.equal(contentTypeFor("mystery"), "application/octet-stream");
  });

  it("每个响应都带跨源隔离三件套 —— 没有它们就没有多线程 wasm", () => {
    assert.equal(OCR_ASSET_HEADERS["cross-origin-opener-policy"], "same-origin");
    assert.equal(OCR_ASSET_HEADERS["cross-origin-embedder-policy"], "require-corp");
    assert.equal(OCR_ASSET_HEADERS["cross-origin-resource-policy"], "same-origin");
    assert.equal(OCR_ASSET_HEADERS["x-content-type-options"], "nosniff");
  });
});
