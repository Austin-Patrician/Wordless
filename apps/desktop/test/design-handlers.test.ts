import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { DesignListRequestSchema, DesignOpenRequestSchema, DesignOpenedSchema, DesignSummarySchema } from "@wordless/protocol";
import { createDesignHandlers } from "../src/main/design/handlers.ts";
import { DesignStore } from "../src/main/design/design-store.ts";
import { manifestPathOf } from "../src/main/design/manifest.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

const ROOT = "/w";
const DESIGN = `${ROOT}/meadow.wdesign`;

function fixture(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(
    manifestPathOf(DESIGN),
    JSON.stringify({
      version: 1,
      type: "wordless-design",
      canvas: { x: 0, y: 0, zoom: 1 },
      mode: "static",
      style: "linear",
      frames: [],
    }),
  );
  const meta = (width: number, height: number, title: string) =>
    `<!doctype html>\n<!-- @frame ${JSON.stringify({ width, height, title })} -->\n`;
  fs.putFile(`${DESIGN}/frames/index.html`, meta(390, 844, "首页"));
  fs.putFile(`${DESIGN}/frames/login.html`, meta(390, 844, "登录"));
  fs.putFile(`${DESIGN}/theme.css`, "@theme {}");
  return fs;
}

function handlers(fs: FakeDesignFs) {
  return createDesignHandlers(new DesignStore({ fs }));
}

test("列表返回的每一项都满足 DTO schema", async () => {
  const result = await handlers(fixture()).listDesigns({ root: ROOT });
  assert.equal(result.length, 1);
  for (const summary of result) {
    // 拿**发布的 schema** 校验处理器输出,而不是自己写一套断言:主进程的内部类型与
    // DTO 是两份契约,漂移会在这里变成失败而不是渲染层一个看不懂的 undefined。
    assert.equal(Value.Check(DesignSummarySchema, summary), true, JSON.stringify([...Value.Errors(DesignSummarySchema, summary)]));
  }
  assert.deepEqual(result[0].name, "meadow");
  assert.equal(result[0].style, "linear");
  assert.equal(result[0].frameCount, 2);
});

test("打开设计返回的整个对象满足 DTO schema", async () => {
  const opened = await handlers(fixture()).openDesign({ path: DESIGN });
  assert.ok(opened !== null);
  assert.equal(
    Value.Check(DesignOpenedSchema, opened),
    true,
    JSON.stringify([...Value.Errors(DesignOpenedSchema, opened)]),
  );
});

test("帧 URL 由主进程生成,每个帧都有", async () => {
  const opened = await handlers(fixture()).openDesign({ path: DESIGN });
  assert.ok(opened !== null);
  const ids = opened.manifest.frames.map((frame) => frame.id);
  assert.deepEqual(Object.keys(opened.frameUrls).sort(), ids.sort());
  for (const [frameId, url] of Object.entries(opened.frameUrls)) {
    // 渲染层不该有机会拼 URL,所以这里钉住形状:scheme + host + 不透明 id + 帧 id。
    assert.match(url, new RegExp(`^wordless-design://frame/[a-f0-9]{16}/${frameId}$`));
  }
});

test("帧 URL 里没有路径 —— 只有不透明 id", async () => {
  const opened = await handlers(fixture()).openDesign({ path: DESIGN });
  assert.ok(opened !== null);
  for (const url of Object.values(opened.frameUrls)) {
    assert.equal(url.includes("meadow"), false);
    assert.equal(url.includes(ROOT), false);
  }
});

test("不是设计包时返回 null,而不是抛错", async () => {
  const fs = new FakeDesignFs();
  fs.putFile(`${ROOT}/notes/readme.md`, "x");
  assert.equal(await handlers(fs).openDesign({ path: `${ROOT}/notes` }), null);
  assert.deepEqual(await handlers(fs).listDesigns({ root: ROOT }), []);
});

test("清单与帧一起送达,画布不需要再读一次磁盘", async () => {
  const opened = await handlers(fixture()).openDesign({ path: DESIGN });
  assert.ok(opened !== null);
  assert.deepEqual(
    opened.manifest.frames.map((frame) => [frame.id, frame.width, frame.height, frame.title]),
    [
      ["index", 390, 844, "首页"],
      ["login", 390, 844, "登录"],
    ],
  );
  assert.deepEqual(opened.manifest.canvas, { x: 0, y: 0, zoom: 1 });
  assert.equal(opened.repaired, true);
});

test("请求 schema 拒绝多余的字段", () => {
  // DTO 全部 `additionalProperties: false`,所以渲染层传错形状会在边界被挡住,
  // 而不是悄悄用一个默认值继续。
  assert.equal(Value.Check(DesignListRequestSchema, { root: ROOT }), true);
  assert.equal(Value.Check(DesignListRequestSchema, { root: ROOT, extra: 1 }), false);
  assert.equal(Value.Check(DesignListRequestSchema, {}), false);
  assert.equal(Value.Check(DesignOpenRequestSchema, { path: DESIGN }), true);
  assert.equal(Value.Check(DesignOpenRequestSchema, { path: DESIGN, mode: "built" }), false);
});
