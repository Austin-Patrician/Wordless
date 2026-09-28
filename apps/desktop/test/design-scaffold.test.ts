import assert from "node:assert/strict";
import test from "node:test";
import { DesignStore } from "../src/main/design/design-store.ts";
import {
  blankFrameSource,
  nextFrameId,
  sanitizeDesignName,
  sanitizeFrameId,
  scaffoldDesign,
} from "../src/main/design/scaffold.ts";
import { manifestPathOf, parseManifest } from "../src/main/design/manifest.ts";
import { parseFrameMeta } from "../src/main/design/frame-meta.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

const ROOT = "/w";

test("目录名清洗只留下对文件系统安全的字符", () => {
  // 某个平台会拒绝的字符若留在这里,失败会出现在"新建设计"这个最容易让人放弃的第一步。
  assert.equal(sanitizeDesignName("Meadow Market"), "Meadow-Market");
  assert.equal(sanitizeDesignName("a/b:c*d?e"), "a-b-c-d-e");
  assert.equal(sanitizeDesignName("checkout.wdesign"), "checkout");
  assert.equal(sanitizeDesignName("  --x--  "), "x");
  // 全被清掉时给一个能用的名字,而不是空串。
  assert.equal(sanitizeDesignName("///"), "design");
});

test("帧 id 同时是合法文件名与合法 URL 段", () => {
  assert.equal(sanitizeFrameId("Login Screen"), "login-screen");
  assert.equal(sanitizeFrameId("../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeFrameId(""), "index");
});

test("空帧的声明能被解析器读回来", () => {
  // 脚手架生成的帧必须与解析器是一对 —— 否则新建的设计一打开就报"漏声明"。
  const source = blankFrameSource({ width: 390, height: 844, title: "Home" });
  assert.deepEqual(parseFrameMeta(source, "index"), { width: 390, height: 844, title: "Home" });
});

test("标题里的尖括号被转义,不会破坏 HTML", () => {
  const source = blankFrameSource({ width: 10, height: 10, title: "<script>x</script>" });
  // 正文里是 HTML 实体。
  assert.ok(!source.includes("<script>x</script>"));
  assert.ok(source.includes("&lt;script&gt;"));
});

test("标题里含 `-->` 时不会提前结束声明注释", () => {
  // 这一条是**注入**,不是格式问题:`JSON.stringify` 不转义 `<`/`>`,于是标题里的 `-->`
  // 会让注释提前结束,后面的内容变成真正的标记。
  const source = blankFrameSource({ width: 10, height: 10, title: "a --> <b>x</b>" });
  const comment = source.slice(source.indexOf("<!-- @frame"), source.indexOf("-->") + 3);
  // 注释体里不能再出现 `-->`(除了结尾那一个)。
  assert.equal(comment.slice(0, -3).includes("-->"), false);
  // 而读回来还是原文。
  assert.equal(parseFrameMeta(source, "index").title, "a --> <b>x</b>");
});

test("脚手架不铺示例内容 —— 只给一个空白帧", () => {
  // 预置一个手机画板等于替用户押了尺寸和品类。
  const scaffold = scaffoldDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 390, frameHeight: 844 });
  assert.equal(scaffold.designPath, `${ROOT}/meadow.wdesign`);
  assert.equal(scaffold.frameId, "index");
  assert.deepEqual(scaffold.manifest.frames.map((frame) => frame.id), ["index"]);
  // 品类尺寸进清单(兜底用),但帧自己也有声明 —— 两处都在。
  assert.deepEqual(scaffold.manifest.defaultFrameSize, { width: 390, height: 844 });
  assert.deepEqual(
    scaffold.files.map((file) => file.path.replace(scaffold.designPath, "")),
    ["/theme.css", "/frames/index.html", "/design.json"],
  );
});

test("脚手架产出的清单能被解析成一份设计", () => {
  const scaffold = scaffoldDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 390, frameHeight: 844 });
  const manifestFile = scaffold.files.find((file) => file.path.endsWith("design.json"));
  const parsed = parseManifest(JSON.parse(manifestFile?.content ?? "{}"));
  assert.equal(parsed?.repaired, false);
  assert.deepEqual(parsed?.manifest.frames.map((frame) => frame.title), ["Home"]);
});

test("建包写出全部文件,且能被列出", async () => {
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });

  const created = await store.createDesign({ root: ROOT, name: "Meadow Market", title: "Home", frameWidth: 390, frameHeight: 844 });
  assert.equal(created?.path, `${ROOT}/Meadow-Market.wdesign`);
  assert.equal(fs.has(`${ROOT}/Meadow-Market.wdesign/theme.css`), true);
  assert.equal(fs.has(`${ROOT}/Meadow-Market.wdesign/frames/index.html`), true);
  assert.equal(fs.has(manifestPathOf(`${ROOT}/Meadow-Market.wdesign`)), true);

  const designs = await store.listDesigns(ROOT);
  assert.deepEqual(designs.map((design) => [design.name, design.frameCount]), [["Meadow-Market", 1]]);
});

test("同名时加序号,不覆盖已有设计", async () => {
  // 覆盖会毁掉一份已经存在的设计。
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const first = await store.createDesign({ root: ROOT, name: "meadow", title: "A", frameWidth: 1, frameHeight: 1 });
  const second = await store.createDesign({ root: ROOT, name: "meadow", title: "B", frameWidth: 1, frameHeight: 1 });

  assert.equal(first?.path, `${ROOT}/meadow.wdesign`);
  assert.equal(second?.path, `${ROOT}/meadow-1.wdesign`);
  // 第一份还在,而且标题没被改。
  const opened = await store.openDesign(`${ROOT}/meadow.wdesign`);
  assert.deepEqual(opened?.manifest.frames.map((frame) => frame.title), ["A"]);
});

test("刚建好的包打开后没有问题可报", async () => {
  // 这是脚手架与解析器/尺寸链/样式约定是否一致的整体检查。
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  await store.createDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 390, frameHeight: 844 });

  const description = await store.describeDesign(`${ROOT}/meadow.wdesign`);
  assert.equal(description?.frames.length, 1);
  const frame = description?.frames[0];
  assert.equal(frame?.declaredSize, true, "脚手架写的帧必须自带声明");
  assert.equal(frame?.fileExists, true);
  assert.equal(frame?.title, "Home");
  // 还没应用风格,所以这一条会报出来 —— 这是设计流程的第一步,不是缺陷。
  assert.equal(description?.style, null);
  assert.equal(description?.hasDesignDoc, false);
});

test("状态读取报告「清单里有、磁盘上没有」,而不触发修复", async () => {
  // 与 openDesign 的区别就在这里:后者会先把清单对账干净,于是这类事实再也看不到。
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const created = await store.createDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 390, frameHeight: 844 });
  const designPath = created?.path ?? "";

  await fs.remove(`${designPath}/frames/index.html`);

  const description = await store.describeDesign(designPath);
  assert.equal(description?.frames[0]?.fileExists, false, "状态查询要看到修复前的事实");
  // 而清单本身没被动过。
  const raw = fs.text(manifestPathOf(designPath)) ?? "{}";
  assert.equal(JSON.parse(raw).frames.length, 1);
});

test("状态读取对不是设计包的路径返回 null", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(`${ROOT}/notes/readme.md`, "x");
  const store = new DesignStore({ fs });
  assert.equal(await store.describeDesign(`${ROOT}/notes`), null);
});

test("状态读取里,漏声明的帧被标成未声明", async () => {
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const created = await store.createDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 390, frameHeight: 844 });
  const designPath = created?.path ?? "";
  fs.putFile(`${designPath}/frames/index.html`, "<!doctype html><html></html>");

  const description = await store.describeDesign(designPath);
  assert.equal(description?.frames[0]?.declaredSize, false);
});

test("按风格建包:令牌与规范一起落盘,清单记下风格 id", () => {
  // 风格在建包时就落盘,而不是事后追加 —— 否则第一帧必然是按默认审美写的。
  const scaffold = scaffoldDesign({
    root: ROOT,
    name: "meadow",
    title: "Home",
    frameWidth: 390,
    frameHeight: 844,
    style: { id: "precise-dark", themeCss: "@theme { --color-surface: #0b0c0e; }", designMd: "# Precise Dark" },
  });
  assert.equal(scaffold.manifest.style, "precise-dark");
  const theme = scaffold.files.find((file) => file.path.endsWith("theme.css"));
  assert.equal(theme?.content, "@theme { --color-surface: #0b0c0e; }");
  const doc = scaffold.files.find((file) => file.path.endsWith("DESIGN.md"));
  assert.equal(doc?.content, "# Precise Dark");
});

test("不选风格时不写 DESIGN.md,清单里是 null", () => {
  const scaffold = scaffoldDesign({ root: ROOT, name: "meadow", title: "Home", frameWidth: 1, frameHeight: 1 });
  assert.equal(scaffold.manifest.style, null);
  assert.equal(scaffold.files.some((file) => file.path.endsWith("DESIGN.md")), false);
});

test("store 建包时把风格应用上去", async () => {
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const created = await store.createDesign({
    root: ROOT,
    name: "meadow",
    title: "Home",
    frameWidth: 390,
    frameHeight: 844,
    styleId: "calm-light",
  });
  const designPath = created?.path ?? "";

  const description = await store.describeDesign(designPath);
  assert.equal(description?.style, "calm-light");
  // `DESIGN.md` 在,于是 `design_status` 不会报 design-doc-missing。
  assert.equal(description?.hasDesignDoc, true);
  // 令牌来自那一套风格,而不是脚手架里那份默认值。
  assert.ok((fs.text(`${designPath}/theme.css`) ?? "").includes("color-surface"));
});

test("风格 id 认不出来时退回默认令牌,而不是拒绝建包", async () => {
  // 一个写错的风格 id 不该让用户完全建不了设计。
  const fs = new FakeDesignFs();
  const store = new DesignStore({ fs });
  const created = await store.createDesign({
    root: ROOT,
    name: "meadow",
    title: "Home",
    frameWidth: 1,
    frameHeight: 1,
    styleId: "no-such-style",
  });
  assert.notEqual(created, null);
  const description = await store.describeDesign(created?.path ?? "");
  assert.equal(description?.style, null);
  assert.equal(description?.hasDesignDoc, false);
});

test("下一个帧 id 取最小的空位,从 2 起", () => {
  // 首帧是 `index`(建包时那个),所以从 2 数起。
  assert.deepEqual(nextFrameId(["index"]), { id: "frame-2", ordinal: 2 });
  // 取空位而不是"最大值 +1":删掉 frame-2 之后再新建应该把它补回来 —— 帧 id 是人在文件名里
  // 会读到的东西,不该一直往上涨。
  assert.deepEqual(nextFrameId(["index", "frame-2", "frame-3"]), { id: "frame-4", ordinal: 4 });
  assert.deepEqual(nextFrameId(["index", "frame-3"]), { id: "frame-2", ordinal: 2 });
  assert.deepEqual(nextFrameId([]), { id: "frame-2", ordinal: 2 });
});
