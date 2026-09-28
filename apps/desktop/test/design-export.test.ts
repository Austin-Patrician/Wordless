import assert from "node:assert/strict";
import test from "node:test";
import { createDesignHandlers } from "../src/main/design/handlers.ts";
import type { DesignExporter } from "../src/main/design/design-exporter.ts";
import { DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf } from "../src/main/design/manifest.ts";
import { rasterCaptureParams } from "../src/main/design/raster-port.ts";
import { DESIGN_IMAGE_PAYLOAD_LIMIT, isDesignImageBytes } from "@wordless/protocol";
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
  /** 保存对话框被请求的名字(`chooseSaveFile` 的入参)。 */
  savedAs: string | null;
  /** 保存对话框返回什么。null = 用户取消。 */
  savePath: string | null;
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
    async chooseSaveFile(input) {
      recorded.savedAs = input.suggestedName;
      return recorded.savePath;
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

function handlersWith(
  fs: FakeDesignFs,
  exporter: DesignExporter,
  seen: RasterRequestLike[] = [],
  clipboard?: { writeImage(bytes: Uint8Array): Promise<boolean> },
) {
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
    clipboard,
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
  const png = rasterCaptureParams({ width: 390, height: 844, pixelRatio: 2, format: "png" });
  const canvas = rasterCaptureParams({ width: 390, height: 844, pixelRatio: 2 });

  assert.equal(png.format, "png", "导出要无损");
  assert.equal(png.quality, undefined, "PNG 没有质量参数");
  assert.equal(canvas.format, "jpeg", "画布贴的位图要小");
  assert.equal(canvas.quality, 90);

  // 倍率是 `clip.scale`,**不是窗口尺寸** —— 改窗口尺寸会让页面按新视口重排。
  assert.equal(png.clip.scale, 2);
  assert.deepEqual([png.clip.width, png.clip.height], [390, 844], "窗口还是帧的声明尺寸");
});
// ─────────────────── 合成图:保存与复制(第 ③ 步)───────────────────

function recorded(): Recorded {
  return { directory: null, written: [], copied: [], savedAs: null, savePath: "/out/design.png" };
}

test("保存合成图:问到落点、写下去,并把路径交回去", async () => {
  // 界面要能说出东西去哪了 —— 否则用户不知道文件在哪儿。
  const log = recorded();
  const handlers = handlersWith(fixture(), exporterInto(log));

  const result = await handlers.saveMockupImage({
    fileName: "community-recycle-app",
    extension: "png",
    bytes: new Uint8Array([1, 2, 3]),
  });

  assert.deepEqual(result, { ok: true, path: "/out/design.png" });
  assert.equal(log.savedAs, "community-recycle-app.png", "建议名要带扩展名,否则用户在摘要里看不到它是什么文件");
  assert.deepEqual(log.written, ["/out/design.png"]);
});

test("取消不是错误:返回 cancelled,而且什么都没写", async () => {
  const log = recorded();
  log.savePath = null; // 用户按了取消
  const handlers = handlersWith(fixture(), exporterInto(log));

  const result = await handlers.saveMockupImage({
    fileName: "design",
    extension: "png",
    bytes: new Uint8Array([1]),
  });

  assert.deepEqual(result, { ok: false, reason: "cancelled" });
  assert.deepEqual(log.written, [], "取消之后不该留下任何文件");
});

test("写盘失败要说清楚原因,而不是笼统的 failed", async () => {
  const log = recorded();
  const exporter: DesignExporter = {
    ...exporterInto(log),
    async writeFile() {
      throw new Error("EACCES: permission denied");
    },
  };
  const handlers = handlersWith(fixture(), exporter);

  const result = await handlers.saveMockupImage({
    fileName: "design",
    extension: "pdf",
    bytes: new Uint8Array([1]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : null, "failed");
  assert.match(result.ok === false ? (result.detail ?? "") : "", /EACCES/);
});

test("没有接宿主能力时照实说,而不是假成功", async () => {
  const handlers = createDesignHandlers(new DesignStore({ fs: fixture() }), {} as never, {} as never);

  const result = await handlers.saveMockupImage({
    fileName: "design",
    extension: "png",
    bytes: new Uint8Array([1]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : null, "failed");
});

test("复制合成图:交给剪贴板,并把它的结果原样交回", async () => {
  const seen: Uint8Array[] = [];
  const handlers = handlersWith(fixture(), exporterInto(recorded()), [], {
    async writeImage(bytes) {
      seen.push(bytes);
      return true;
    },
  });

  assert.equal(await handlers.copyMockupImage({ bytes: new Uint8Array([7, 8]) }), true);
  assert.deepEqual([...seen[0]!], [7, 8]);
});

test("剪贴板被占用时返回 false —— 调用方据此提示,而不是崩", async () => {
  const handlers = handlersWith(fixture(), exporterInto(recorded()), [], {
    async writeImage() {
      return false;
    },
  });

  assert.equal(await handlers.copyMockupImage({ bytes: new Uint8Array([1]) }), false);
});

test("没有剪贴板能力时返回 false,而不是抛", async () => {
  const handlers = handlersWith(fixture(), exporterInto(recorded()));

  assert.equal(await handlers.copyMockupImage({ bytes: new Uint8Array([1]) }), false);
});

test("字节守卫:非空 Uint8Array 通过,别的都拒", () => {
  // 这一层是"渲染层 → 主进程"的方向,所以必须查。但**不逐字节 walk**:
  // `instanceof` + 上限是 O(1) 的,给的是同样的保证。
  assert.equal(isDesignImageBytes(new Uint8Array([1])), true);
  assert.equal(isDesignImageBytes(new Uint8Array(0)), false, "空数组不是一张图");
  assert.equal(isDesignImageBytes([1, 2, 3]), false, "普通数组不是字节");
  assert.equal(isDesignImageBytes(null), false);
  assert.equal(isDesignImageBytes("bytes"), false);
  assert.equal(isDesignImageBytes({ byteLength: 3 }), false, "长得像不算");
  assert.equal(
    isDesignImageBytes(new Uint8Array(DESIGN_IMAGE_PAYLOAD_LIMIT + 1)),
    false,
    "超过上限的不是我们产出的东西",
  );
});
