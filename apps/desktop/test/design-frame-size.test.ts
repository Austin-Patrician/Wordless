import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_FRAME_SIZE } from "../src/main/design/manifest.ts";
import { resolveFrameSizes, type FrameSizeInput } from "../src/main/design/frame-size.ts";

function declared(id: string, width: number, height: number): FrameSizeInput {
  return { id, parsed: { width, height, title: id } };
}

function undeclared(id: string): FrameSizeInput {
  return { id, parsed: { width: null, height: null, title: id } };
}

test("帧自己声明的尺寸优先于一切", () => {
  const sizes = resolveFrameSizes([declared("a", 390, 844), declared("b", 1440, 900)], { width: 100, height: 100 });
  assert.deepEqual(sizes.get("a"), { width: 390, height: 844 });
  assert.deepEqual(sizes.get("b"), { width: 1440, height: 900 });
});

test("漏声明的帧拿多数派尺寸", () => {
  const sizes = resolveFrameSizes([
    declared("a", 390, 844),
    declared("b", 390, 844),
    declared("c", 1440, 900),
    undeclared("d"),
  ]);
  assert.deepEqual(sizes.get("d"), { width: 390, height: 844 });
});

test("多数派并列时结果与输入顺序无关", () => {
  // 早先的实现是"保留先遇到的",那要求调用方先把 entries 排序 —— 一个容易忘的前提,
  // 忘掉的表现是同一份设计每次打开可能给出不同尺寸,画布会跳。现在由判定本身保证。
  const forward = resolveFrameSizes([declared("a", 390, 844), declared("b", 1440, 900), undeclared("z")]);
  const backward = resolveFrameSizes([declared("b", 1440, 900), declared("a", 390, 844), undeclared("z")]);
  assert.deepEqual(forward.get("z"), backward.get("z"));

  const third = resolveFrameSizes([declared("a", 1440, 900), declared("b", 390, 844), undeclared("z")]);
  assert.deepEqual(third.get("z"), forward.get("z"));
});

test("一个声明都没有时退到品类尺寸", () => {
  const sizes = resolveFrameSizes([undeclared("a"), undeclared("b")], { width: 1440, height: 900 });
  assert.deepEqual(sizes.get("a"), { width: 1440, height: 900 });
  assert.deepEqual(sizes.get("b"), { width: 1440, height: 900 });
});

test("连品类都没有时退到全局兜底", () => {
  const sizes = resolveFrameSizes([undeclared("a")]);
  assert.deepEqual(sizes.get("a"), FALLBACK_FRAME_SIZE);
});

test("品类尺寸排在多数派之后", () => {
  // 一份设计中途改了品类(海报改成手机屏)时,已经在画布上的那些帧才是真相。
  const sizes = resolveFrameSizes([declared("a", 390, 844), declared("b", 390, 844), undeclared("c")], {
    width: 1440,
    height: 900,
  });
  assert.deepEqual(sizes.get("c"), { width: 390, height: 844 });
});

test("返回值覆盖全部输入 —— 没有帧会因为漏声明而掉出画布", () => {
  const inputs = [declared("a", 390, 844), undeclared("b"), undeclared("c")];
  const sizes = resolveFrameSizes(inputs);
  assert.equal(sizes.size, inputs.length);
  for (const input of inputs) {
    const size = sizes.get(input.id);
    assert.ok(size !== undefined && size.width > 0 && size.height > 0, input.id);
  }
});

test("空输入返回空 Map", () => {
  assert.equal(resolveFrameSizes([]).size, 0);
});
