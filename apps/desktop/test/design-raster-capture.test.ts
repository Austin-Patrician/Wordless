import assert from "node:assert/strict";
import test from "node:test";
import { imagePixelSize, rasterCaptureParams } from "../src/main/design/raster-port.ts";

/**
 * 截图参数与"位图到底多大"。
 *
 * 两件事都在**真实现之外**可断言,而真实现 import 了 Electron、`node --test` 加载不了 ——
 * 所以不抽出来的话,它们就没有测试守着。
 */

// ─────────────────── 截图参数 ───────────────────

test("the capture clip carries the frame size and the scale, not a scaled window", () => {
  const params = rasterCaptureParams({ width: 390, height: 844, pixelRatio: 2 });

  // 窗口是帧的声明尺寸;倍率只出现在 scale 上。改窗口尺寸会让页面按新视口**重排**,
  // 内容只占左边一半、右边一片空白(handlers.ts 里踩过)。
  assert.deepEqual(params.clip, { x: 0, y: 0, width: 390, height: 844, scale: 2 });
});

test("a nonsense scale falls back to 1 instead of producing an unusable bitmap", () => {
  for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      rasterCaptureParams({ width: 390, height: 844, pixelRatio: bad }).clip.scale,
      1,
      `${bad} 应该退回 1`,
    );
  }
});

test("fractional sizes are rounded, and never to zero", () => {
  const params = rasterCaptureParams({ width: 390.4, height: 0.2, pixelRatio: 1 });
  assert.equal(params.clip.width, 390);
  assert.equal(params.clip.height, 1, "0 像素高的窗口截不出东西");
});

test("png is requested without a quality parameter", () => {
  const png = rasterCaptureParams({ width: 10, height: 10, pixelRatio: 1, format: "png" });
  const jpeg = rasterCaptureParams({ width: 10, height: 10, pixelRatio: 1, format: "jpeg" });
  const fallback = rasterCaptureParams({ width: 10, height: 10, pixelRatio: 1 });

  assert.equal(png.quality, undefined);
  assert.equal(jpeg.quality, 90);
  assert.equal(fallback.format, "jpeg", "没指定就是 JPEG —— 画布要小");
});

// ─────────────────── 位图尺寸 ───────────────────

/** 手搓一个 JPEG 头:SOI + SOF0(带宽高)+ EOI。 */
function jpegOf(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, 长度 17,精度 8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}

/** 手搓一个 PNG 头:签名 + IHDR 的宽高。 */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR 长度
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test("the size is read back from the bytes, for both formats", () => {
  // **读回来而不是算**:算出来的值一旦与编码器差一个像素,画布上就会半像素错位。
  assert.deepEqual(imagePixelSize(jpegOf(780, 1688)), { width: 780, height: 1688 });
  assert.deepEqual(imagePixelSize(pngOf(1170, 2532)), { width: 1170, height: 2532 });
});

test("a JPEG with an APPn segment before the frame header is still read correctly", () => {
  // Chromium 的截图前面通常有 JFIF/ICC 之类的段 —— 扫描必须跳段,不能只看前几字节。
  //
  // 段长度是**含它自己那两字节**的总长:这里是 4(2 长度 + 2 载荷)。长度写大了会直接跳过
  // SOF,读出来是 null —— 所以这条同时守着"长度语义"没被写反。
  const app0 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]);
  const body = new Uint8Array([...app0, ...jpegOf(390, 844).slice(2)]);

  assert.deepEqual(imagePixelSize(body), { width: 390, height: 844 });
});

test("the segment length includes its own two bytes, so the scan lands on the real frame header", () => {
  // 长度少算 2 个字节的话,扫描会正好落在载荷里**我们埋的那两字节**上 —— 所以这里埋一个假
  // SOF,让"读歪了"表现为一个**错误尺寸**(而不是 null)。只靠"逐字节往前走"是分辨不出来
  // 的:少跳 2 字节之后它照样能走到真的 SOF(基线验证时抓到过)。
  const L = 20;
  const payload = new Uint8Array(L - 2).fill(0x01);
  // 少跳过 2 字节时会到达的位置 = 载荷下标 L-4。
  payload[L - 4] = 0xff;
  payload[L - 3] = 0xc0;

  const soi = new Uint8Array([0xff, 0xd8]);
  const header = new Uint8Array([0xff, 0xe0, (L >> 8) & 0xff, L & 0xff]);
  const body = new Uint8Array([...soi, ...header, ...payload, ...jpegOf(780, 1688).slice(2)]);

  assert.deepEqual(imagePixelSize(body), { width: 780, height: 1688 });
});

test("a segment that claims an impossible length stops the scan instead of running away", () => {
  // 长度 0 会让"跳过它"变成原地打转 —— 必须当成坏数据。
  const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);
  assert.equal(imagePixelSize(broken), null);
});

test("unrecognized bytes report null rather than a guessed size", () => {
  // 猜一个尺寸会让画布把位图贴进一个尺寸不符的槽 —— 那比报失败难查得多。
  assert.equal(imagePixelSize(new Uint8Array(0)), null);
  assert.equal(imagePixelSize(new Uint8Array([1, 2, 3, 4, 5])), null);
  assert.equal(imagePixelSize(new Uint8Array(64)), null, "全零字节不是任何一种图片");
});
