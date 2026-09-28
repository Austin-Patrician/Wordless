import assert from "node:assert/strict";
import test from "node:test";
import { createDesignHandlers } from "../src/main/design/handlers.ts";
import type { DesignExporter } from "../src/main/design/design-exporter.ts";
import { DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf } from "../src/main/design/manifest.ts";
import { encodeRasterImage } from "../src/main/design/raster-port.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 导出渲染图与素材。
 *
 * 边界上真正会错的是这几件:**取消算不算失败**、没有被导出的东西时说没说清、以及导出的文件
 * 叫什么。它们都在假 exporter 上验 —— 真实现只有"弹对话框 + 写文件"。
 */

const ROOT = "/w";
const DESIGN = `${ROOT}/meadow.wdesign`;

function frameSource(title: string): string {
  return `<!doctype html>\n<!-- @frame {"width":390,"height":844,"title":"${title}"} -->\n<html><body>hi</body></html>\n`;
}

function fixture(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(manifestPathOf(DESIGN), JSON.stringify({
    version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static", style: null, frames: [],
  }));
  fs.putFile(`${DESIGN}/frames/index.html`, frameSource("首页"));
  fs.putFile(`${DESIGN}/assets/logo.svg`, "<svg/>");
  fs.putFile(`${DESIGN}/assets/nested/icon.svg`, "<svg/>");
  fs.putFile(`${DESIGN}/theme.css`, "@theme { --color-primary: #4f46e5; }");
  return fs;
}

interface Recorded {
  directory: string | null;
  written: string[];
  copied: string[];
}

function exporterInto(recorded: Recorded, directory: string | null = "/out"): DesignExporter {
  return {
    async chooseDirectory() {
      recorded.directory = directory;
      return directory;
    },
    async writeFile(target) {
      recorded.written.push(target);
    },
    async copyFile(_from, to) {
      recorded.copied.push(to);
    },
  };
}

interface RasterRequestLike {
  key: string;
  url: string;
  width: number;
  height: number;
  pixelRatio: number;
}

function handlersWith(fs: FakeDesignFs, exporter: DesignExporter, seen: RasterRequestLike[] = []) {
  // 光栅池注入假 port:这里考的是"请求长什么样""键与文件名怎么对上",不是 Electron 能不能截图。
  const pool = {
    async run(requests: RasterRequestLike[]) {
      seen.push(...requests);
      return requests.map((request) => ({
        ok: true as const,
        key: request.key,
        bytes: new Uint8Array([1, 2, 3]),
        width: request.width,
        height: request.height,
      }));
    },
  } as never;
  return createDesignHandlers(
    new DesignStore({ fs }),
    pool,
    {} as never,
    undefined,
    exporter,
  );
}

test("没有配 exporter 时照实返回 null,而不是假成功", async () => {
  // 与 `builds` 同一条纪律:没有的能力要说没有。
  const handlers = createDesignHandlers(new DesignStore({ fs: fixture() }), {} as never, {} as never);
  assert.equal(await handlers.exportDesign({ path: DESIGN, what: "frames" }), null);
});

test("导出按帧的**声明尺寸**,而不是乘过倍数的尺寸", async () => {
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const seen: RasterRequestLike[] = [];
  const handlers = handlersWith(fixture(), exporterInto(recorded), seen);

  const result = await handlers.exportDesign({ path: DESIGN, what: "frames" });

  assert.deepEqual(result, { ok: true, directory: "/out", files: ["/out/index.png"] });
  assert.deepEqual(recorded.written, ["/out/index.png"]);
  /*
    **这条是踩出来的。** 原来传的是 `frame.width * 2`(780×1688),于是离屏窗口变成 780 宽,
    而页面按 780 的视口重排、内容只占左边 390 —— 导出的图比页面大一圈,右边和下边一片空白。
    倍数只能来自**设备像素比**(每 CSS 像素几个物理像素),不是把窗口放大。
  */
  assert.deepEqual(seen.map((request) => [request.width, request.height]), [[390, 844]]);
});

test("取消不是失败 —— 界面不该为此报红", async () => {
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(fixture(), exporterInto(recorded, null));

  assert.deepEqual(await handlers.exportDesign({ path: DESIGN, what: "frames" }), {
    ok: false,
    reason: "cancelled",
  });
  assert.deepEqual(recorded.written, []);
});

test("一帧都没有时说「没有可导出的」,而不是导出一个空成功", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(manifestPathOf(DESIGN), JSON.stringify({
    version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static", style: null, frames: [],
  }));
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(fs, exporterInto(recorded));

  assert.deepEqual(await handlers.exportDesign({ path: DESIGN, what: "frames" }), { ok: false, reason: "empty" });
});

test("下载素材 = 各帧的图 **加** 规范与素材文件(整套交接)", async () => {
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(fixture(), exporterInto(recorded));

  const result = await handlers.exportDesign({ path: DESIGN, what: "assets" });

  assert.equal(result?.ok, true);
  // 帧的图照出现在两边。
  assert.deepEqual(recorded.written, ["/out/index.png"]);
  // 素材 = 规范 + assets,按相对路径复制(含子目录)。比顺序无意义,比集合。
  assert.deepEqual(recorded.copied.slice().sort(), [
    "/out/assets/logo.svg",
    "/out/assets/nested/icon.svg",
    "/out/theme.css",
  ]);
});

test("一份设计没有 assets 目录、但有帧时,素材**照常导出**", async () => {
  /*
    **这条也是踩出来的。** 原来"素材"只指 `assets/**`,于是设计没有那个目录就报「没有可导出
    的东西」—— 而它有五个帧。参考实现里「下载素材」的意思是**每帧一张原尺寸完整图**,不是
    设计包的资源目录。
  */
  const fs = fixture();
  fs.remove(`${DESIGN}/assets`);
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(fs, exporterInto(recorded));

  const result = await handlers.exportDesign({ path: DESIGN, what: "assets" });

  assert.equal(result?.ok, true);
  assert.deepEqual(recorded.written, ["/out/index.png"]);
  assert.deepEqual(recorded.copied, ["/out/theme.css"]);
});

test("既没有帧、也没有规范时才说「没有」", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(manifestPathOf(DESIGN), JSON.stringify({
    version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 },
    mode: "static", style: null, frames: [],
  }));
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(fs, exporterInto(recorded));

  assert.deepEqual(await handlers.exportDesign({ path: DESIGN, what: "assets" }), { ok: false, reason: "empty" });
});

test("不是设计包时照实失败", async () => {
  const recorded: Recorded = { copied: [], directory: null, written: [] };
  const handlers = handlersWith(new FakeDesignFs(), exporterInto(recorded));

  const result = await handlers.exportDesign({ path: "/w/nope.wdesign", what: "frames" });
  assert.equal(result?.ok, false);
});

test("导出的渲染图走 PNG,画布的位图走 JPEG", () => {
  /*
    这一条看着像在考一个三元表达式,其实在考一件事:**导出与画布的取舍是分开的**。
    画布贴的位图要小(同像素数下 JPEG 小一个量级),导出的文件要准(无损,拿去用时
    文字边缘不该有振铃)。同一个离屏窗口两种都出,差别只在这一个判断上。

    抽成纯函数正是因为真实现 import 了 Electron,`node --test` 加载不了 —— 不抽出来的话,
    「导出给的是 PNG」这件事就没有测试守着。
  */
  const calls: string[] = [];
  const image = {
    toPNG: () => {
      calls.push("png");
      return new Uint8Array([1]);
    },
    toJPEG: (quality: number) => {
      calls.push(`jpeg:${quality}`);
      return new Uint8Array([2]);
    },
  };

  assert.deepEqual(encodeRasterImage(image, "png", 0.82), new Uint8Array([1]));
  assert.deepEqual(encodeRasterImage(image, undefined, 0.82), new Uint8Array([2]));
  assert.deepEqual(calls, ["png", "jpeg:0.82"]);
});