import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_STYLES } from "../src/main/design/style-catalog.ts";
import { DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf, parseManifest } from "../src/main/design/manifest.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 把一套内置风格应用到**已有**设计上。
 *
 * 三条纪律各有一条用例:应用前整包备份、只落规范不机械改帧、风格 id 进清单。第三条最容易被
 * 忽略 —— 而它是"这份设计应用了哪一套"这个状态的真源。
 */

const ROOT = "/w";
const DESIGN = `${ROOT}/meadow.wdesign`;
const STYLE = DESIGN_STYLES[0]!;

function frameSource(title: string): string {
  return `<!doctype html>\n<!-- @frame {"width":390,"height":844,"title":"${title}"} -->\n<html><body>hi</body></html>\n`;
}

function fixture(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(manifestPathOf(DESIGN), JSON.stringify({
    version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 },
    mode: "built", style: null, frames: [],
  }));
  fs.putFile(`${DESIGN}/frames/index.html`, frameSource("首页"));
  fs.putFile(`${DESIGN}/assets/logo.svg`, "<svg/>");
  fs.putFile(`${DESIGN}/theme.css`, "/* 旧的令牌 */\n@theme { --color-primary: #000; }");
  return fs;
}

test("应用风格:写令牌与规范,并把风格 id 记进清单", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });

  const applied = await store.applyStyle(DESIGN, STYLE.id);
  assert.ok(applied);

  assert.equal(fs.text(`${DESIGN}/theme.css`), STYLE.themeCss);
  assert.equal(fs.text(`${DESIGN}/DESIGN.md`), STYLE.designMd);
  // 风格 id 是"这份设计应用了哪一套"的真源,`design_status` 与风格工具都读它。
  const manifest = parseManifest(JSON.parse(fs.text(manifestPathOf(DESIGN)) ?? "{}"));
  assert.equal(manifest.manifest.style, STYLE.id);
});

test("应用风格:先把整包源文件备份进 .build/style-backup", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const before = fs.text(`${DESIGN}/theme.css`);

  await store.applyStyle(DESIGN, STYLE.id);

  /*
    用户点错一次就再也回不来了 —— 令牌是整份设计的真源,所以覆盖之前必须留一份。
    落在 `.build/` 里是因为它点开头:画布与目录扫描都会跳过,不会被当成设计内容,
    也不会把自己算进源指纹。
  */
  assert.equal(fs.text(`${DESIGN}/.build/style-backup/theme.css`), before);
  assert.equal(fs.text(`${DESIGN}/.build/style-backup/design.json`) !== undefined, true);
  assert.equal(
    fs.text(`${DESIGN}/.build/style-backup/frames/index.html`),
    fs.text(`${DESIGN}/frames/index.html`),
  );
});

test("应用风格:已有帧**一个字节都不动**,并如实说它们需要重设", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const frameBefore = fs.text(`${DESIGN}/frames/index.html`);

  const applied = await store.applyStyle(DESIGN, STYLE.id);

  // 设计不能靠替换令牌机械改风格:换了规范之后要改的是间距、层次与字号。
  assert.equal(fs.text(`${DESIGN}/frames/index.html`), frameBefore);
  assert.equal(applied?.framesNeedRestyle, true);
  assert.equal(applied?.opened.manifest.frames.length, 1);
});

test("应用风格:一份空设计不需要重设(没有帧可重设)", async () => {
  const fs = fixture();
  fs.remove(`${DESIGN}/frames`);
  const store = new DesignStore({ fs });

  const applied = await store.applyStyle(DESIGN, STYLE.id);

  assert.equal(applied?.framesNeedRestyle, false);
});

test("不认识的风格 id 什么都不做,也不写盘", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const before = fs.text(`${DESIGN}/theme.css`);

  assert.equal(await store.applyStyle(DESIGN, "not-a-style"), null);
  assert.equal(fs.text(`${DESIGN}/theme.css`), before);
  assert.equal(fs.has(`${DESIGN}/.build/style-backup/theme.css`), false);
});
