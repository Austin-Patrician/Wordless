import assert from "node:assert/strict";
import test from "node:test";
import {
  designAssetUrl,
  designFrameUrl,
  frameRelativePath,
  parseDesignUrl,
} from "../src/main/design/design-url.ts";

const DESIGN_ID = "0123456789abcdef";

test("帧 URL 往返一致", () => {
  const url = designFrameUrl(DESIGN_ID, "login");
  assert.deepEqual(parseDesignUrl(url), { kind: "frame", designId: DESIGN_ID, frameId: "login" });
});

test("资源 URL 支持多级路径,往返一致", () => {
  const url = designAssetUrl(DESIGN_ID, "assets/icons/logo.png");
  assert.deepEqual(parseDesignUrl(url), {
    kind: "asset",
    designId: DESIGN_ID,
    relativePath: "assets/icons/logo.png",
  });
});

test("无害的文件名不被拒:空格、中文、括号", () => {
  // 安全边界是后面的 realpath + isWithinRoot,不是字符集。白名单会把完全无害的文件名
  // 一起拒掉,而那些名字并不构成任何逃逸。
  for (const name of ["assets/a b.png", "assets/图 标(1).png", "assets/a+b.png"]) {
    const url = designAssetUrl(DESIGN_ID, name);
    assert.deepEqual(parseDesignUrl(url), { kind: "asset", designId: DESIGN_ID, relativePath: name });
  }
});

test("编码后的分隔符仍然被拒 —— 这才是可达的那条判断", () => {
  // `new URL` 按 `/` 分段,所以裸的分隔符进不到这里;但百分号编码能绕过 URL 层的分段,
  // 解码后一段变成两段。这条判断是真正在起作用的那条。
  const slash = designAssetUrl(DESIGN_ID, "assets/a").replace("assets/a", "assets/a%2Fb");
  assert.equal(parseDesignUrl(slash), null);
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/assets/a%5Cb`), null);
});

test("URL 归一化会吃掉 `..` 之前的段 —— 逃逸被拒的真实机制", () => {
  // 这条测试钉的是**机制**,不是结论。`new URL` 在构造时就归一化了 `.` 与 `..`,
  // 所以到达校验时设计 id 已经被 `..` 吃掉了,是 **id 校验**失败而不是段校验拦住的。
  // 若哪天有人把 id 校验改松,这条会立刻失败,而不是悄悄放行。
  assert.equal(new URL(`wordless-design://asset/${DESIGN_ID}/assets/../../etc/passwd`).pathname, "/etc/passwd");
  assert.equal(new URL(`wordless-design://frame/${DESIGN_ID}/..`).pathname, "/");
  // 归一化之后连 `..` 段都不存在了,所以 `.`/`..` 的段判断对 URL 输入不可达。
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/assets/../../etc/passwd`), null);
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/../../etc/passwd`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/..`), null);
  // `.` 会被折叠掉,结果是一个完全正常的包内路径 —— 不是逃逸。
  assert.deepEqual(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/assets/./x.png`), {
    kind: "asset",
    designId: DESIGN_ID,
    relativePath: "assets/x.png",
  });
});

test("scheme 与 host 必须精确匹配", () => {
  assert.equal(parseDesignUrl(`https://frame/${DESIGN_ID}/login`), null);
  assert.equal(parseDesignUrl(`wordless-design://other/${DESIGN_ID}/login`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}`), null);
});

test("设计 id 必须是 16 位十六进制", () => {
  // id 不是路径,所以这里挡的是格式而不是逃逸 —— 逃逸由"根本没有路径"从结构上排除。
  assert.equal(parseDesignUrl("wordless-design://frame/short/login"), null);
  assert.equal(parseDesignUrl("wordless-design://frame/ZZZZZZZZZZZZZZZZ/login"), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}0/login`), null);
});

test("帧 id 拒绝 `..` 与分隔符", () => {
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/..`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/.`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/a%2Fb`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/a%5Cb`), null);
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/`), null);
  // 多一级也不行:帧路径是固定的 `frames/<id>.html`。
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/a/b`), null);
});

test("资源路径逐段校验,任一非法就整体拒绝", () => {
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/..`), null);
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/`), null);
  // 编码的反斜杠解码后是分隔符,一段变两段。
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/assets/%5C..%5Cx.png`), null);
});

test("空字节被拒绝", () => {
  assert.equal(parseDesignUrl(`wordless-design://asset/${DESIGN_ID}/assets/a%00b.png`), null);
});

test("非法的百分号编码被拒绝而不是抛错", () => {
  assert.equal(parseDesignUrl(`wordless-design://frame/${DESIGN_ID}/%`), null);
});

test("帧的相对路径是固定的", () => {
  assert.equal(frameRelativePath("index"), "frames/index.html");
});
