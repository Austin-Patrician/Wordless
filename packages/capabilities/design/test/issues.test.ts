import { expect, it } from "vitest";
import { designIssues, isBlocking, type DesignFacts, type FrameFacts } from "../src/issues.ts";

function frame(id: string, overrides: Partial<FrameFacts> = {}): FrameFacts {
  return { id, title: id, file: `frames/${id}.html`, declaredSize: true, fileExists: true, ...overrides };
}

function facts(overrides: Partial<DesignFacts> = {}): DesignFacts {
  return {
    path: "/w/meadow.wdesign",
    name: "meadow",
    mode: "static",
    style: "linear",
    hasDesignDoc: true,
    frames: [frame("index", { title: "Home" })],
    ...overrides,
  };
}

function codes(input: DesignFacts): string[] {
  return designIssues(input).map((issue) => issue.code);
}

it("一帧都没有时直接报出来,不再逐帧报", () => {
  expect(codes(facts({ frames: [] }))).toContain("no-frames");
});

it("没应用风格时报 style-not-applied", () => {
  expect(codes(facts({ style: null }))).toContain("style-not-applied");
});

it("应用了风格但没有 DESIGN.md 时报 design-doc-missing", () => {
  // 风格 id 在、规则不在 —— agent 拿不到"该怎么写"的那份规范。
  expect(codes(facts({ style: "linear", hasDesignDoc: false }))).toContain("design-doc-missing");
  expect(codes(facts({ style: null, hasDesignDoc: false }))).not.toContain("design-doc-missing");
});

it("风格与规范齐备时不报整份设计级的问题", () => {
  expect(codes(facts())).toEqual([]);
});

it("帧文件不在磁盘上时只报这一条", () => {
  // 文件都没了,再报尺寸和标题没有意义 —— 会淹掉真正要修的那一条。
  const result = codes(facts({ frames: [frame("gone", { fileExists: false, declaredSize: false, title: "gone" })] }));
  expect(result).toEqual(["frame-file-missing"]);
});

it("漏 @frame 声明时报 frame-size-missing", () => {
  expect(codes(facts({ frames: [frame("index", { title: "Home", declaredSize: false })] }))).toContain(
    "frame-size-missing",
  );
});

it("标题只是文件名时报 frame-title-generic", () => {
  // 画布上按标题标帧,标题等于文件名时标签什么也没说明。
  expect(codes(facts({ frames: [frame("index")] }))).toContain("frame-title-generic");
  expect(codes(facts({ frames: [frame("index", { title: "Home" })] }))).not.toContain("frame-title-generic");
});

it("一个问题里带上帧 id,便于定位", () => {
  const issue = designIssues(facts({ frames: [frame("login", { title: "Login", declaredSize: false })] })).find(
    (candidate) => candidate.code === "frame-size-missing",
  );
  expect(issue?.frameId).toBe("login");
});

it("区分阻塞与不阻塞", () => {
  // 尺寸靠兜底不阻塞:帧仍然上画布。文件缺失阻塞:那一帧根本不在。
  expect(isBlocking({ code: "no-frames", frameId: null, message: "" })).toBe(true);
  expect(isBlocking({ code: "frame-file-missing", frameId: "a", message: "" })).toBe(true);
  expect(isBlocking({ code: "frame-size-missing", frameId: "a", message: "" })).toBe(false);
  expect(isBlocking({ code: "style-not-applied", frameId: null, message: "" })).toBe(false);
});
