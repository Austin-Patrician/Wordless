import assert from "node:assert/strict";
import test from "node:test";
import { DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf } from "../src/main/design/manifest.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

const ROOT = "/w";
const DESIGN = `${ROOT}/meadow.wdesign`;

function frameSource(meta: { width: number; height: number; title: string } | null): string {
  const comment = meta === null ? "" : `<!-- @frame ${JSON.stringify(meta)} -->\n`;
  return `<!doctype html>\n${comment}<html><body>hi</body></html>\n`;
}

function fixture(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({
      version: 1,
      type: "wordless-design",
      canvas: { x: 0, y: 0, zoom: 1 },
      mode: "static",
      style: null,
      frames: [],
    }),
  );
  fs.putFile(`${DESIGN}/frames/index.html`, frameSource({ width: 390, height: 844, title: "首页" }));
  fs.putFile(`${DESIGN}/frames/login.html`, frameSource({ width: 390, height: 844, title: "登录" }));
  fs.putFile(`${DESIGN}/theme.css`, "@theme { --color-primary: #4f46e5; }");
  fs.putFile(`${DESIGN}/assets/logo.svg`, "<svg/>");
  return fs;
}

test("按 design.json 认出设计包,并跳过非设计目录", async () => {
  const fs = fixture();
  fs.putFile(`${ROOT}/notes/readme.md`, "not a design");
  fs.putFile(`${ROOT}/other.txt`, "x");
  const store = new DesignStore({ fs });

  const designs = await store.listDesigns(ROOT);
  assert.deepEqual(
    designs.map((design) => [design.name, design.frameCount]),
    [["meadow", 2]],
  );
  // 列表里带上了 id,渲染层拿它拼 URL —— 路径不进 URL。
  assert.match(designs[0].id, /^[a-f0-9]{16}$/);
});

test("打开设计时把磁盘上的帧读进清单,并按声明取尺寸", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });

  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);
  assert.deepEqual(
    opened.manifest.frames.map((frame) => [frame.id, frame.file, frame.width, frame.height, frame.title]),
    [
      ["index", "frames/index.html", 390, 844, "首页"],
      ["login", "frames/login.html", 390, 844, "登录"],
    ],
  );
});

test("新帧自动放到最右帧的右边,不叠在已有内容上", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  // 第一帧落在原点。
  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);
  const [first, second] = opened.manifest.frames;
  assert.deepEqual({ x: first.x, y: first.y }, { x: 0, y: 0 });
  // 第二帧在第一帧右边,间隔 80。
  assert.equal(second.x, 390 + 80);
  assert.equal(second.y, 0);
});

test("漏声明尺寸的帧拿多数派尺寸,而不是掉出画布", async () => {
  const fs = fixture();
  fs.putFile(`${DESIGN}/frames/blank.html`, frameSource(null));
  const store = new DesignStore({ fs });

  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);
  const blank = opened.manifest.frames.find((frame) => frame.id === "blank");
  // fail-open:照常上画布,尺寸取多数派(390×844);缺失本身由 issues 报出去。
  assert.deepEqual({ width: blank?.width, height: blank?.height }, { width: 390, height: 844 });
  // 标题回落到帧 id。
  assert.equal(blank?.title, "blank");
});

test("整份设计都没有声明时退到品类尺寸", async () => {
  const fs = fixture();
  fs.putFile(`${DESIGN}/frames/index.html`, frameSource(null));
  fs.putFile(`${DESIGN}/frames/login.html`, frameSource(null));
  const manifest = JSON.parse(fs.text(manifestPathOf(DESIGN)) ?? "{}");
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({ ...manifest, defaultFrameSize: { width: 1440, height: 900 } }),
  );
  const store = new DesignStore({ fs });

  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);
  for (const frame of opened.manifest.frames) {
    assert.deepEqual({ width: frame.width, height: frame.height }, { width: 1440, height: 900 });
  }
});

test("用户在画布上的位置不被覆盖,其余跟随声明", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const first = await store.openDesign(DESIGN);
  assert.ok(first !== null);

  // 模拟用户把 index 拖到别处、agent 改了它的标题与尺寸。
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({
      ...first.manifest,
      frames: first.manifest.frames.map((frame) =>
        frame.id === "index" ? { ...frame, x: 1234, y: 567 } : frame,
      ),
    }),
  );
  fs.putFile(`${DESIGN}/frames/index.html`, frameSource({ width: 428, height: 926, title: "首页 v2" }));

  const second = await store.openDesign(DESIGN);
  assert.ok(second !== null);
  const index = second.manifest.frames.find((frame) => frame.id === "index");
  // 位置归清单 —— 用户拖拽赢。
  assert.deepEqual({ x: index?.x, y: index?.y }, { x: 1234, y: 567 });
  // 标题与尺寸归声明 —— 声明赢。
  assert.deepEqual({ width: index?.width, height: index?.height, title: index?.title }, {
    width: 428,
    height: 926,
    title: "首页 v2",
  });
});

test("磁盘上删掉的帧从清单里消失", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  await fs.remove(`${DESIGN}/frames/login.html`);
  const opened = await store.openDesign(DESIGN);
  assert.deepEqual(opened?.manifest.frames.map((frame) => frame.id), ["index"]);
});

test("同步渲染根:帧、令牌、资源都进去,清单不进去", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  assert.equal(fs.has(`${DESIGN}/dist/frames/index.html`), true);
  assert.equal(fs.has(`${DESIGN}/dist/frames/login.html`), true);
  assert.equal(fs.has(`${DESIGN}/dist/theme.css`), true);
  assert.equal(fs.has(`${DESIGN}/dist/assets/logo.svg`), true);
  // 清单是画布的事,渲染不需要它;放进去只会多一份会过期的副本。
  assert.equal(fs.has(`${DESIGN}/dist/design.json`), false);
});

test("相对引用在产物里依然成立", async () => {
  // 这是整个渲染模型的基础:`frames/index.html` 里写的 `../theme.css` 在
  // `dist/frames/index.html` 下必须仍然指向 `dist/theme.css`。
  const fs = fixture();
  fs.putFile(
    `${DESIGN}/frames/index.html`,
    `<!doctype html>\n<!-- @frame {"width":390,"height":844,"title":"首页"} -->\n<link rel="stylesheet" href="../theme.css">\n`,
  );
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  const html = fs.text(`${DESIGN}/dist/frames/index.html`) ?? "";
  assert.ok(html.includes('href="../theme.css"'));
  assert.equal(fs.has(`${DESIGN}/dist/theme.css`), true);
});

test("built 模式刷新帧,但不覆盖编译出来的 theme.css", async () => {
  // 这条曾经钉的是"built 模式完全不碰渲染根"。那个行为是错的:它意味着 agent 改了帧之后
  // 画布上还是上一次构建的快照 —— 打开设计看不到改动。产物形状两种模式一致,差别只在
  // `theme.css` 从哪来,所以 built 下要刷新帧、又必须留住那份编译产物。
  const fs = fixture();
  const manifest = JSON.parse(fs.text(manifestPathOf(DESIGN)) ?? "{}");
  fs.putFile(manifestPathOf(DESIGN), JSON.stringify({ ...manifest, mode: "built" }));
  fs.putFile(`${DESIGN}/dist/theme.css`, "/* COMPILED */");
  const store = new DesignStore({ fs });

  await store.openDesign(DESIGN);

  assert.equal(fs.has(`${DESIGN}/dist/frames/index.html`), true, "帧的改动必须能出现在产物里");
  assert.equal(fs.text(`${DESIGN}/dist/theme.css`), "/* COMPILED */", "编译产物不能被源文件覆盖");
});

test("清单坏到读不出来时当作不是设计,而不是抛错", async () => {
  const fs = fixture();
  fs.putFile(manifestPathOf(DESIGN), "{ this is not json");
  const store = new DesignStore({ fs });

  assert.equal(await store.openDesign(DESIGN), null);
  assert.deepEqual(await store.listDesigns(ROOT), []);
});

test("字段级损坏就地修复并回写", async () => {
  const fs = fixture();
  const manifest = JSON.parse(fs.text(manifestPathOf(DESIGN)) ?? "{}");
  // canvas 坏、mode 非法、frames 里混了一条没有几何的。
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({ ...manifest, canvas: { x: "nope" }, mode: "wat", frames: [{ id: "x" }] }),
  );
  const store = new DesignStore({ fs });

  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);
  assert.equal(opened.repaired, true);
  assert.deepEqual(opened.manifest.canvas, { x: 0, y: 0, zoom: 1 });
  assert.equal(opened.manifest.mode, "static");

  // 回写之后磁盘上就是修复过的内容,临时文件不残留。
  const written = JSON.parse(fs.text(manifestPathOf(DESIGN)) ?? "{}");
  assert.deepEqual(written.canvas, { x: 0, y: 0, zoom: 1 });
  assert.equal(
    (await fs.listFiles(DESIGN)).some((file) => file.relPath.endsWith(".tmp")),
    false,
  );
});

test("保存视口只动 canvas,不动帧", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  const opened = await store.openDesign(DESIGN);
  assert.ok(opened !== null);

  assert.equal(await store.saveCanvas(DESIGN, { x: -120, y: 40, zoom: 0.75 }), true);
  const reread = await store.openDesign(DESIGN);
  assert.deepEqual(reread?.manifest.canvas, { x: -120, y: 40, zoom: 0.75 });
  assert.deepEqual(reread?.manifest.frames.map((frame) => frame.id), ["index", "login"]);
});

test("保存视口到不存在的设计上返回 false", async () => {
  const store = new DesignStore({ fs: new FakeDesignFs() });
  assert.equal(await store.saveCanvas(`${ROOT}/nope.wdesign`, { x: 0, y: 0, zoom: 1 }), false);
});

test("注册表让同一份设计在任何时候拿到同一个 id", async () => {
  const store = new DesignStore({ fs: fixture() });
  const first = await store.openDesign(DESIGN);
  const second = await store.openDesign(DESIGN);
  assert.equal(first?.summary.id, second?.summary.id);
  assert.equal(store.registry.resolve(first?.summary.id ?? ""), DESIGN);
});

test("移动帧只改清单,不碰帧源码", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);
  const sourceBefore = fs.text(`${DESIGN}/frames/index.html`);

  assert.equal(await store.moveFrames(DESIGN, [{ frameId: "index", x: 500, y: 120 }]), true);
  const opened = await store.openDesign(DESIGN);
  const index = opened?.manifest.frames.find((frame) => frame.id === "index");
  assert.deepEqual({ x: index?.x, y: index?.y }, { x: 500, y: 120 });
  // 位置是纯布局;源码一个字节都不该动。
  assert.equal(fs.text(`${DESIGN}/frames/index.html`), sourceBefore);
});

test("多选拖拽一次提交,一次修订", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  assert.equal(
    await store.moveFrames(DESIGN, [
      { frameId: "index", x: 10, y: 10 },
      { frameId: "login", x: 480, y: 10 },
    ]),
    true,
  );
  const opened = await store.openDesign(DESIGN);
  assert.deepEqual(
    opened?.manifest.frames.map((frame) => [frame.id, frame.x, frame.y]),
    [
      ["index", 10, 10],
      ["login", 480, 10],
    ],
  );
});

test("没有实际变化时不写盘", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);
  const manifestBefore = fs.text(manifestPathOf(DESIGN));

  assert.equal(await store.moveFrames(DESIGN, [{ frameId: "index", x: 0, y: 0 }]), false);
  // 位置本来就是 0,0 —— 不写,免得每次点一下都产生一次修订。
  assert.equal(fs.text(manifestPathOf(DESIGN)), manifestBefore);
});

test("非法坐标被忽略,不会写坏清单", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  // 一个 NaN 写进清单,之后每次打开都要修复一遍。
  assert.equal(await store.moveFrames(DESIGN, [{ frameId: "index", x: Number.NaN, y: 5 }]), false);
  const opened = await store.openDesign(DESIGN);
  assert.deepEqual({ x: opened?.manifest.frames[0].x, y: opened?.manifest.frames[0].y }, { x: 0, y: 0 });
});

test("移动不存在的帧是无操作", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);
  assert.equal(await store.moveFrames(DESIGN, [{ frameId: "ghost", x: 1, y: 1 }]), false);
  // 空移动列表同样无操作。
  assert.equal(await store.moveFrames(DESIGN, []), false);
});
