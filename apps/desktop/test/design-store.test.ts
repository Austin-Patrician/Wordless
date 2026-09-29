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

test("摘要里的时间取清单与帧文件里最新的那一刻", async () => {
  /*
    画廊按它倒序,而它必须**跟着 agent 的改动走**:agent 改一帧的内容是重写那个 HTML,清单
    一动不动 —— 只看清单的话,"我刚让 agent 改完的那份"会排在后面。
  */
  const fs = fixture();
  fs.setModified(manifestPathOf(DESIGN), 1_000);
  fs.setModified(`${DESIGN}/frames/index.html`, 9_000);
  fs.setModified(`${DESIGN}/frames/login.html`, 5_000);
  const store = new DesignStore({ fs });

  const designs = await store.listDesigns(ROOT);
  assert.equal(designs[0]?.updatedAt, 9_000, "取最新的那一帧,而不是清单");

  // 一个根都没有时列表是空的,而不是抛 —— "列出设计"不该因为一个坏根就整页失败。
  const empty = new DesignStore({ fs });
  assert.deepEqual(await empty.listDesigns("/nowhere"), []);
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

test("改标题写回帧源码,而不是清单 —— 标题的声明在文件里", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  // 清单里的 `frames` 是空的:帧由 `openDesign` 与磁盘对账之后才出现。
  await store.openDesign(DESIGN);

  assert.equal(await store.updateFrameMeta(DESIGN, "index", { title: "首页 v2" }), true);

  // 清单里那份只是上次同步的快照 —— 只改清单的话,下一次对账就被帧文件改回去了。
  const source = fs.text(`${DESIGN}/frames/index.html`) ?? "";
  assert.match(source, /"title":"首页 v2"/);
  // 其余源码一个字节都不动。
  assert.match(source, /<html><body>hi<\/body><\/html>/);
});

test("改尺寸只动宽高,标题原样保留", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  assert.equal(await store.updateFrameMeta(DESIGN, "login", { width: 1440, height: 900 }), true);

  const source = fs.text(`${DESIGN}/frames/login.html`) ?? "";
  assert.match(source, /"width":1440/);
  assert.match(source, /"height":900/);
  // 补丁里没给的字段保持原值 —— 改尺寸把标题抹掉是这类接口最容易犯的错。
  assert.match(source, /"title":"登录"/);
});

test("帧里没有 @frame 声明时拒绝,而且不往源码里塞一行", async () => {
  const fs = fixture();
  fs.putFile(`${DESIGN}/frames/bare.html`, "<!doctype html><html><body>hi</body></html>");
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  // 往猜出来的位置插一行注释会写坏文件,而漏声明的帧本来就会从 design_status 报出来。
  assert.equal(await store.updateFrameMeta(DESIGN, "bare", { title: "x" }), false);
  assert.equal(fs.text(`${DESIGN}/frames/bare.html`), "<!doctype html><html><body>hi</body></html>");
});

test("帧不存在、或内容没变时不写盘", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);
  const before = fs.text(`${DESIGN}/frames/index.html`);

  assert.equal(await store.updateFrameMeta(DESIGN, "nope", { title: "x" }), false);
  /*
    标题本来就是"首页":没有变化就不该白写一次盘(也不会让画布误以为源变了)。
    **但它不是失败** —— 这里踩过:返回 false 会让界面报"改不了这一帧",而用户要的状态其实
    已经成立了。一次无效果的改名,与"把已经亮着的灯打开"是同一件事。
  */
  assert.equal(await store.updateFrameMeta(DESIGN, "index", { title: "首页" }), true);
  assert.equal(fs.text(`${DESIGN}/frames/index.html`), before);
});
test("新建帧:写文件、对账进清单,并落到最右帧的右边", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  const opened = await store.createFrame({ designPath: DESIGN, title: "画面" });

  // 一帧就是一个文件 —— 没有注册步骤。
  const source = fs.text(`${DESIGN}/frames/frame-2.html`) ?? "";
  assert.match(source, /@frame/);
  assert.match(source, /"width":390/);
  // 标题带序号:画布上唯一的标签就是它,两帧同名等于没有标签。
  assert.match(source, /"title":"画面 2"/);
  // 对账之后它就在清单里,而且落到了最右帧的右边(index 与 login 各 390 宽,FRAME_GAP = 80)。
  // 按 id 比而不是按顺序:清单顺序是「帧文件名排序」的产物,不是这条测试要考的东西。
  const placed = new Map(opened?.manifest.frames.map((frame) => [frame.id, frame.x]));
  assert.deepEqual([placed.get("index"), placed.get("login"), placed.get("frame-2")], [0, 470, 940]);
});

test("新建帧:磁盘上已有的 id 也算占用 —— 那是 agent 刚写进去、还没对账的帧", async () => {
  const fs = fixture();
  // 清单里没有它,但文件在。
  fs.putFile(`${DESIGN}/frames/frame-2.html`, frameSource({ height: 844, title: "手写的", width: 390 }));
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  const opened = await store.createFrame({ designPath: DESIGN });

  // 只查清单的实现会覆盖掉那个真实文件。
  assert.match(fs.text(`${DESIGN}/frames/frame-2.html`) ?? "", /"title":"手写的"/);
  assert.ok(opened?.manifest.frames.some((frame) => frame.id === "frame-3"));
});

test("新建帧:不是设计包时返回 null,不写任何文件", async () => {
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  assert.equal(await store.createFrame({ designPath: "/w/nope.wdesign" }), null);
  assert.equal(fs.has("/w/nope.wdesign/frames/frame-2.html"), false);
});

test("新建帧:用户画出来的落点优先于自动布局", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  // 画在左下角一个奇怪的位置上 —— 那正是用户在画布上做的决定。
  const opened = await store.createFrame({ designPath: DESIGN, x: -300, y: 1200, width: 200, height: 300 });

  const placed = opened?.manifest.frames.find((frame) => frame.id === "frame-2");
  assert.deepEqual([placed?.x, placed?.y, placed?.width, placed?.height], [-300, 1200, 200, 300]);
  // 而且源码里的声明就是这两个尺寸 —— 位图与活体都按它算。
  assert.match(fs.text(`${DESIGN}/frames/frame-2.html`) ?? "", /"width":200/);
});

test("删除帧:只删文件,清单由对账更新", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);

  const opened = await store.deleteFrame(DESIGN, "login");

  assert.equal(fs.has(`${DESIGN}/frames/login.html`), false);
  assert.deepEqual(opened?.manifest.frames.map((frame) => frame.id), ["index"]);
});

test("删除帧:帧不存在时不写任何东西", async () => {
  const fs = fixture();
  const store = new DesignStore({ fs });
  await store.openDesign(DESIGN);
  const before = fs.text(`${DESIGN}/frames/index.html`);

  assert.equal(await store.deleteFrame(DESIGN, "nope"), null);
  assert.equal(fs.text(`${DESIGN}/frames/index.html`), before);
});
