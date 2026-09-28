import assert from "node:assert/strict";
import test from "node:test";
import {
  attachMockupFrame,
  detachMockupFrame,
  mockupRailFrames,
  mockupShotsFor,
  swapMockupFrames,
} from "../src/renderer/features/design/mockup-attach.ts";
import { layoutMockup, mockupPixelSize, mockupRenderScale } from "../src/renderer/features/design/mockup-layout.ts";
import {
  MOCKUP_RADIUS_RATIO,
  defaultMockupOptions,
  loadMockupOptions,
  maxMockupRadius,
  normalizeMockupOptions,
} from "../src/renderer/features/design/mockup-options.ts";
import { paginateMockup } from "../src/renderer/features/design/mockup-paginate.ts";
import { mockupBrandInk } from "../src/renderer/features/design/mockup-render.ts";
import { buildMockupPdf } from "../src/renderer/features/design/mockup-pdf.ts";
import type { MockupOptions, MockupShot } from "../src/renderer/features/design/mockup-types.ts";
import { centerMockupViewport, stackMockupPages } from "../src/renderer/features/design/mockup-view.ts";

/**
 * 导出设置与合成几何的 1:1 保真度。
 *
 * 这些数字是**照着参考实现抄的**,不是随手取的:间距、内边距、品牌块比例、8000px 上限。
 * 它们一旦被改动,导出的图就不再是同一张图 —— 所以每一个都钉住。
 */

const PHONE = { cssWidth: 390, cssHeight: 844 };

function shot(id: string, overrides: Partial<MockupShot> = {}): MockupShot {
  return { frameId: id, title: id, ...PHONE, image: null, ...overrides };
}

function options(overrides: Partial<MockupOptions> = {}): MockupOptions {
  return { ...defaultMockupOptions(PHONE.cssHeight), ...overrides };
}

// ───────────────────────────── 默认值 ─────────────────────────────

test("the defaults match the reference implementation", () => {
  const defaults = defaultMockupOptions(844);

  assert.equal(defaults.radius, Math.round(844 * MOCKUP_RADIUS_RATIO), "圆角跟着归一化高度走");
  assert.equal(defaults.borderWidth, 12);
  assert.equal(defaults.borderColor, "#000000");
  assert.equal(defaults.background, "#1C1C1E");
  assert.equal(defaults.transparent, false);
  assert.equal(defaults.shadow, true);
  assert.equal(defaults.brand, true);
  assert.equal(defaults.scale, 2);
  assert.equal(defaults.perPage, 3, "手机稿三连是最常用的一张图");
});

test("the radius slider tops out at half the normalized height", () => {
  assert.equal(maxMockupRadius(844), 422);
  // 极小的稿子也要留出一个能拖动的区间。
  assert.equal(maxMockupRadius(4), 8);
});

// ─────────────────────── 逐字段校验(不是整份丢弃)───────────────────────

test("a single bad field does not wipe the rest of the saved settings", () => {
  // 这条是「整体校验」的症结:加了 `perPage` 之后,旧数据里没有它 —— 整份丢弃会把用户
  // 调过的圆角、背景、开关**全部**清掉。
  const stored = {
    radius: 24,
    borderWidth: 20,
    borderColor: "#ff0000",
    background: "#ffffff",
    transparent: true,
    shadow: false,
    brand: false,
    scale: 1,
    // perPage 缺失
  };

  const merged = normalizeMockupOptions(stored, defaultMockupOptions(844));

  assert.equal(merged.radius, 24, "用户调过的值必须留下");
  assert.equal(merged.background, "#ffffff");
  assert.equal(merged.transparent, true);
  assert.equal(merged.scale, 1);
  assert.equal(merged.perPage, 3, "缺的那一个字段退回默认");
});

test("each field falls back on its own when it is unusable", () => {
  const merged = normalizeMockupOptions(
    { radius: -5, borderWidth: "12", borderColor: "  ", background: 7, scale: 3, perPage: 9 },
    defaultMockupOptions(844),
  );

  assert.equal(merged.radius, 42, "负数不合法 → 默认");
  assert.equal(merged.borderWidth, 12, "字符串不合法 → 默认");
  assert.equal(merged.borderColor, "#000000");
  assert.equal(merged.background, "#1C1C1E");
  assert.equal(merged.scale, 2, "只接受 1 或 2");
  assert.equal(merged.perPage, 3, "只接受 1..4");
});

test("garbage in storage degrades to the defaults instead of throwing", () => {
  assert.deepEqual(normalizeMockupOptions(null, defaultMockupOptions(844)), defaultMockupOptions(844));
  // node 里没有 localStorage,这条同时覆盖了"存储不可用"这条路径。
  assert.deepEqual(loadMockupOptions("/w/x.wdesign", 844), defaultMockupOptions(844));
});

// ───────────────────────────── 布局几何 ─────────────────────────────

test("an empty page has no geometry", () => {
  const layout = layoutMockup([], options());

  assert.deepEqual(layout, { width: 0, height: 0, rects: [], brand: null, fit: 1 });
});

test("shots are normalized on the tallest one, so nothing is ever scaled down", () => {
  // **矮的那帧排在前面**,这一点是必要的:排在后面的话"取第一帧的高度"与"取最高"结果
  // 相同,这条测试就分辨不出两者了(基线验证时抓到过)。
  const short = shot("short", { cssWidth: 800, cssHeight: 400 });
  const tall = shot("tall", { cssWidth: 390, cssHeight: 844 });
  const layout = layoutMockup([short, tall], options({ borderWidth: 0, brand: false }));

  // 844 是归一化高度;两帧都按它换算宽度(高宽比不变)。
  assert.equal(layout.rects[0]?.height, 844, "矮的那一帧被**放大**到同一高度,而不是把高的缩小");
  assert.equal(layout.rects[1]?.height, 844);
  assert.equal(Math.round(layout.rects[0]?.width ?? 0), 1688, "800/400 × 844");
  assert.equal(Math.round(layout.rects[1]?.width ?? 0), 390);
});

test("the border sits outside every shot, so no interface pixel is covered", () => {
  const bare = layoutMockup([shot("a")], options({ borderWidth: 0, brand: false }));
  const bordered = layoutMockup([shot("a")], options({ borderWidth: 20, brand: false }));

  // 截图矩形本身没变。
  assert.equal(bordered.rects[0]?.width, bare.rects[0]?.width);
  assert.equal(bordered.rects[0]?.height, bare.rects[0]?.height);
  // 但整张图每边多了一个边框宽。
  assert.equal(Math.round(bordered.width - bare.width), 40);
  assert.equal(Math.round(bordered.height - bare.height), 40);
  // 而且截图被推进去了,正好一个边框宽。
  assert.equal(Math.round((bordered.rects[0]?.x ?? 0) - (bare.rects[0]?.x ?? 0)), 20);
});

test("the brand block costs height and shifts the shots down", () => {
  const withBrand = layoutMockup([shot("a")], options({ brand: true }));
  const without = layoutMockup([shot("a")], options({ brand: false }));

  assert.notEqual(withBrand.brand, null);
  assert.equal(without.brand, null);
  assert.ok(withBrand.height > without.height, "品牌块占了高度");
  assert.ok((withBrand.rects[0]?.y ?? 0) > (without.rects[0]?.y ?? 0), "画框被压下去了");
  // 品牌块在左上角。
  assert.equal(withBrand.brand?.x, (withBrand.rects[0]?.x ?? 0) - (options().borderWidth + 0));
});

test("spacing and padding are the reference ratios of the normalized height", () => {
  const layout = layoutMockup([shot("a"), shot("b")], options({ borderWidth: 0, brand: false }));
  const gap = 844 * 0.06;
  const padding = 844 * 0.1;

  assert.equal(Math.round((layout.rects[1]?.x ?? 0) - (layout.rects[0]?.x ?? 0) - 390), Math.round(gap));
  assert.equal(Math.round(layout.width), Math.round(390 * 2 + gap + padding * 2));
  assert.equal(Math.round(layout.height), Math.round(844 + padding * 2));
});

test("a partly filled page still reserves its columns, so pages stay the same width", () => {
  const full = layoutMockup([shot("a"), shot("b"), shot("c")], options({ borderWidth: 0, brand: false }));
  // 末页只剩一帧,但这一页是为"每页三格"排的。
  const lastPage = layoutMockup([shot("a")], options({ borderWidth: 0, brand: false }), 3);

  assert.equal(Math.round(lastPage.width), Math.round(full.width), "多页叠起来不会一页宽一页窄");
  assert.equal(lastPage.rects.length, 1, "空位不画东西,只是占宽");
});

test("the output is capped at 8000px per side by scaling down, not by cropping", () => {
  const huge = shot("huge", { cssWidth: 4000, cssHeight: 6000 });
  const layout = layoutMockup([huge], options({ scale: 2, brand: false }));

  assert.ok(layout.fit < 1, "超上限要让步");
  const size = mockupPixelSize(layout, options({ scale: 2, brand: false }));
  assert.ok(size.width <= 8000, `宽 ${size.width} 超了`);
  assert.ok(size.height <= 8000, `高 ${size.height} 超了`);
  // 倍率 = 用户选的 × 让步。
  assert.equal(mockupRenderScale(layout, options({ scale: 2, brand: false })), 2 * layout.fit);
});

test("normal sizes keep the user's scale untouched", () => {
  const layout = layoutMockup([shot("a")], options());
  assert.equal(layout.fit, 1);
  assert.equal(mockupRenderScale(layout, options()), 2);
  assert.deepEqual(mockupPixelSize(layout, options()), {
    width: Math.round(layout.width * 2),
    height: Math.round(layout.height * 2),
  });
});

// ─────────────────────── 已加入列表(rail 的补集)───────────────────────

test("adding a frame appends it, and adding it twice is a no-op", () => {
  assert.deepEqual(attachMockupFrame([], "a"), ["a"]);
  assert.deepEqual(attachMockupFrame(["a"], "b"), ["a", "b"]);
  assert.deepEqual(attachMockupFrame(["a", "b"], "a"), ["a", "b"]);
});

test("adding at an index inserts (that is what dropping onto a slot means)", () => {
  assert.deepEqual(attachMockupFrame(["a", "c"], "b", 1), ["a", "b", "c"]);
  // 越界的下标夹到两端,而不是插到别处。
  assert.deepEqual(attachMockupFrame(["a"], "b", 99), ["a", "b"]);
  assert.deepEqual(attachMockupFrame(["a"], "b", -3), ["b", "a"]);
});

test("swapping is the Figma behaviour: drag A onto B swaps them, it does not insert", () => {
  assert.deepEqual(swapMockupFrames(["a", "b", "c"], 0, 2), ["c", "b", "a"]);
  assert.deepEqual(swapMockupFrames(["a", "b"], 0, 0), ["a", "b"]);
  // 越界不动 —— 返回的仍是同一份内容的拷贝,调用方拿到的不是 undefined。
  assert.deepEqual(swapMockupFrames(["a", "b"], 0, 5), ["a", "b"]);
  assert.deepEqual(swapMockupFrames(["a", "b"], -1, 0), ["a", "b"]);
});

test("the rail is the complement of what is attached", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }];

  assert.deepEqual(
    mockupRailFrames(all, ["b"]).map((frame) => frame.id),
    ["a", "c"],
  );
  assert.deepEqual(mockupRailFrames(all, ["a", "b", "c"]), [], "都加进去了");
  assert.deepEqual(mockupRailFrames([], []), [], "设计稿里一帧都没有");
});

test("detaching removes, and unknown ids are ignored", () => {
  assert.deepEqual(detachMockupFrame(["a", "b"], "a"), ["b"]);
  assert.deepEqual(detachMockupFrame(["a"], "zz"), ["a"]);
});

test("shots are resolved in attach order, and frames that vanished are dropped", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }];

  assert.deepEqual(
    mockupShotsFor(all, ["c", "a"]).map((frame) => frame.id),
    ["c", "a"],
    "顺序就是导出顺序",
  );
  assert.deepEqual(
    mockupShotsFor(all, ["c", "gone"]).map((frame) => frame.id),
    ["c"],
    "清单里已经不存在的帧要丢掉,而不是留一个空洞",
  );
});

// ───────────────────────────── 分页 ─────────────────────────────

test("pagination chunks the shots, and the last page keeps what is left", () => {
  assert.deepEqual(paginateMockup([1, 2, 3, 4, 5, 6, 7], 3), [
    [1, 2, 3],
    [4, 5, 6],
    [7],
  ]);
  assert.deepEqual(paginateMockup([], 3), []);
});

test("a nonsense per-page value falls back to one rather than spinning", () => {
  assert.deepEqual(paginateMockup([1, 2], 0), [[1], [2]]);
  assert.deepEqual(paginateMockup([1, 2], Number.NaN), [[1], [2]]);
});

// ───────────────────────── 预览台几何 ─────────────────────────

test("pages stack vertically and each one is centred", () => {
  const stack = stackMockupPages(
    [
      { width: 1000, height: 500 },
      { width: 600, height: 500 },
    ],
    40,
  );

  assert.equal(stack.world.width, 1000);
  assert.equal(stack.world.height, 1040, "500 + 40 间距 + 500");
  assert.deepEqual(stack.boxes[0], { left: 0, top: 0, width: 1000, height: 500 });
  // 窄的那一页居中 —— 左对齐会让整叠图看着像歪了。
  assert.equal(stack.boxes[1]?.left, 200);
  assert.equal(stack.boxes[1]?.top, 540);
});

test("an empty stack has no world", () => {
  assert.deepEqual(stackMockupPages([], 40), { world: { width: 0, height: 0 }, boxes: [] });
});

test("centring keeps the zoom and puts the world in the middle", () => {
  const view = centerMockupViewport({ width: 1000, height: 500 }, { width: 1400, height: 900 }, 0.5);

  assert.equal(view.zoom, 0.5);
  assert.equal(view.x, (1400 - 500) / 2);
  assert.equal(view.y, (900 - 250) / 2);
});

// ───────────────────────────── PDF ─────────────────────────────

function text(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

test("the PDF has the objects a reader needs, and embeds the JPEGs verbatim", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildMockupPdf(
    [
      { jpeg, width: 390, height: 844 },
      { jpeg, width: 390, height: 844 },
    ],
    390,
  );
  const body = text(pdf);

  assert.ok(body.startsWith("%PDF-1.4"), "要有版本头");
  assert.ok(body.trimEnd().endsWith("%%EOF"), "要有结束标记");
  assert.match(body, /\/Type \/Catalog/);
  assert.match(body, /\/Type \/Pages \/Count 2 /);
  assert.equal(body.match(/\/Filter \/DCTDecode/g)?.length, 2, "每页一个 DCTDecode 图像");
  assert.match(body, /\/MediaBox \[0 0 390\.00 844\.00\]/, "页面按像素尺寸的长宽比");
  // JPEG 字节必须原样出现,不加任何重新编码。
  const raw = pdf.findIndex((_, index) => pdf[index] === 0xff && pdf[index + 1] === 0xd8);
  assert.ok(raw > 0, "JPEG 头找不到");
  // 交叉引用表要指向真实的 xref 偏移。
  // 写法是 `startxref\n<offset>`,偏移在关键字**之后**。
  const xrefAt = Number(/startxref\n(\d+)/.exec(body)?.[1]);
  assert.ok(body.slice(xrefAt).startsWith("xref"), "startxref 必须指向 xref 表");
});

test("a page can carry its own width, so mixed sizes keep their real proportions", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const body = text(buildMockupPdf([{ jpeg, width: 1440, height: 900, pageWidth: 720 }], 390));

  // 1440×900 的桌面帧:宽 720 → 高 450(保持真实比例,不被归一化成手机宽度)。
  assert.match(body, /\/MediaBox \[0 0 720\.00 450\.00\]/);
  assert.match(body, /\/Width 1440 \/Height 900/, "像素尺寸照原样写进图像字典");
});

test("a single page PDF is still well formed", () => {
  const pdf = buildMockupPdf([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 100, height: 100 }], 100);
  assert.match(text(pdf), /\/Count 1 /);
});

// ─────────────────────── 水印墨色(得在任何背景上读得出来)───────────────────────

test("the watermark picks ink that survives the background the user chose", () => {
  assert.equal(mockupBrandInk({ background: "#1C1C1E", transparent: false }).primary, "#ffffff", "深底用浅墨");
  assert.equal(mockupBrandInk({ background: "#ffffff", transparent: false }).primary, "#111114", "浅底用深墨");
  assert.equal(mockupBrandInk({ background: "#f59e0b", transparent: false }).primary, "#111114", "琥珀色偏亮");
  // 三位简写要按 `#aabbcc` 展开,不能当 0xabc 算。
  assert.equal(mockupBrandInk({ background: "#fff", transparent: false }).primary, "#111114");
  assert.equal(mockupBrandInk({ background: "#000", transparent: false }).primary, "#ffffff");
});

test("a transparent export gets dark ink, because it usually lands on a light document", () => {
  assert.equal(mockupBrandInk({ background: "#1C1C1E", transparent: true }).primary, "#111114");
});

test("an unparseable colour falls back to light ink, matching the dark default", () => {
  // `rgb()` 之类的写法认不出来 —— 退回浅墨,而不是抛错或猜错。
  assert.equal(mockupBrandInk({ background: "rgb(1,2,3)", transparent: false }).primary, "#ffffff");
});
