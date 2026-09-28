import assert from "node:assert/strict";
import test from "node:test";
import { performDesignBuild } from "../src/main/design/design-build-step.ts";
import { scanTailwindCandidates, scanTailwindCandidatesIn } from "../src/main/design/tailwind-candidates.ts";
import { buildTailwindEntry, type TailwindCompileInput, type TailwindCompiler } from "../src/main/design/tailwind-theme.ts";
import { FakeDesignFs } from "./design-test-fs.ts";

/**
 * 这一步验的不是"Tailwind 能编译"(那是它的活),而是**我们交给它的输入对不对**:
 * 候选扫全了没有、入口拼对没有、产物铺对没有。
 *
 * 用一个会记下被调用参数的假编译器,把这三件事都变成可断言的事实。
 */

const DESIGN_ROOT = "/workspace/login.wdesign";
const STAGING = "/workspace/login.wdesign/dist.staging";
const RESOLVE_BASE = "/app/dist/electron";

class RecordingCompiler implements TailwindCompiler {
  readonly calls: TailwindCompileInput[] = [];
  produce: (input: TailwindCompileInput) => string = () => "/* compiled */";

  async compile(input: TailwindCompileInput): Promise<string> {
    this.calls.push(input);
    return this.produce(input);
  }
}

// ─────────────────────────── 候选扫描 ───────────────────────────

test("scanTailwindCandidates finds the classes a frame actually uses", () => {
  const found = scanTailwindCandidates(
    '<body class="bg-surface text-surface-foreground"><main class="grid min-h-screen place-items-center">',
  );

  for (const expected of ["bg-surface", "text-surface-foreground", "grid", "min-h-screen", "place-items-center"]) {
    assert.ok(found.includes(expected), `漏了 ${expected}`);
  }
});

test("scanTailwindCandidates keeps the wide candidate syntax Tailwind actually supports", () => {
  const found = scanTailwindCandidates(
    '<div class="hover:bg-primary bg-[#fff]/50 !mt-4 -mt-2 md:w-1/2 text-2xl/6 data-[state=open]:block">',
  );

  for (const expected of [
    "hover:bg-primary",
    "bg-[#fff]/50",
    "!mt-4",
    "-mt-2",
    "md:w-1/2",
    "text-2xl/6",
    "data-[state=open]:block",
  ]) {
    assert.ok(found.includes(expected), `漏了 ${expected}`);
  }
});

test("scanTailwindCandidates rejects HTML tags, numbers and bare punctuation", () => {
  const found = scanTailwindCandidates('<div class="flex" data-x="1"><span>12</span> && <!-- -->');

  // 这些进来了也只是垃圾,但 `<div` 那种会掩盖真正的漏扫 —— 所以钉住它们不在。
  for (const rejected of ["<div", "12", "--", "&&"]) {
    assert.equal(found.includes(rejected), false, `不该收下 ${rejected}`);
  }
  assert.ok(found.includes("flex"));
});

test("scanTailwindCandidates scans the whole source, so classes inside @apply are seen", () => {
  const found = scanTailwindCandidates("<style>@apply bg-primary text-muted;</style>");
  assert.ok(found.includes("bg-primary"));
  assert.ok(found.includes("text-muted"));
});

test("scanTailwindCandidates is deterministic and deduplicated", () => {
  const source = '<a class="flex gap-4"><b class="gap-4 flex">';
  const once = scanTailwindCandidates(source);
  assert.deepEqual(once, [...once].sort(), "必须有序,否则同一份设计两次构建产物不同");
  assert.equal(once.filter((item) => item === "flex").length, 1);
  assert.deepEqual(once, scanTailwindCandidates(source));
});

test("scanTailwindCandidatesIn merges frames into one candidate set", () => {
  const merged = scanTailwindCandidatesIn(['<p class="text-muted">', '<p class="bg-primary">']);

  // 用"包含"而不是全等:扫整篇源码必然带出 `p`、`class` 这类词。它们无害(Tailwind 对
  // 认不出的候选什么都不生成),而把整篇源码都扫一遍换来的是"`@apply` 里的类名也看得见"。
  assert.ok(merged.includes("bg-primary"));
  assert.ok(merged.includes("text-muted"));
  assert.deepEqual(merged, [...merged].sort(), "合并后仍需有序");
});

// ─────────────────────────── 编译入口 ───────────────────────────

test("the compile entry puts the import before the tokens", () => {
  const entry = buildTailwindEntry("@theme {\n\t--color-primary: #4f46e5;\n}");

  // 顺序是照 open-vetta 引擎的 styles.css 定的:v4 里 `@theme` 是在默认主题之上做增量
  // 覆盖,先声明令牌再引入工具层并不能让它们生效。
  const importAt = entry.indexOf('@import "tailwindcss"');
  const themeAt = entry.indexOf("@theme");
  assert.ok(importAt >= 0, "入口必须引入 tailwindcss —— 否则工具层与 preflight 都不存在");
  assert.ok(importAt < themeAt, "`@import` 必须在 `@theme` 之前");
});

// ─────────────────────────── 铺产物 ───────────────────────────

function scaffoldedFs(): FakeDesignFs {
  const fs = new FakeDesignFs();
  fs.putFile(`${DESIGN_ROOT}/design.json`, '{"type":"wordless-design"}');
  fs.putFile(`${DESIGN_ROOT}/theme.css`, "@theme {\n\t--color-primary: #4f46e5;\n}");
  fs.putFile(`${DESIGN_ROOT}/DESIGN.md`, "# spec for the agent");
  fs.putFile(`${DESIGN_ROOT}/frames/index.html`, '<body class="bg-surface text-muted">');
  fs.putFile(`${DESIGN_ROOT}/frames/settings.html`, '<body class="grid min-h-screen">');
  fs.putFile(`${DESIGN_ROOT}/assets/logo.svg`, "<svg></svg>");
  fs.putFile(`${DESIGN_ROOT}/notes/todo.txt`, "not part of the design");
  return fs;
}

async function buildWith(fs: FakeDesignFs, compiler: RecordingCompiler) {
  return await performDesignBuild({ fs, designRoot: DESIGN_ROOT, stagingPath: STAGING, resolveBase: RESOLVE_BASE, compiler });
}

test("performDesignBuild lays out the renderable subset, keeping relative paths", async () => {
  const fs = scaffoldedFs();
  const compiler = new RecordingCompiler();
  await buildWith(fs, compiler);

  // 相对路径必须原样保留:`frames/index.html` 里的 `../theme.css` 在 `dist/frames/` 下
  // 依然要指向 `dist/theme.css`。
  assert.ok(fs.has(`${STAGING}/frames/index.html`));
  assert.ok(fs.has(`${STAGING}/frames/settings.html`));
  assert.ok(fs.has(`${STAGING}/assets/logo.svg`));
});

test("performDesignBuild leaves out what rendering does not need", async () => {
  const fs = scaffoldedFs();
  await buildWith(fs, new RecordingCompiler());

  // 清单与 DESIGN.md 是给人和 agent 的,不是渲染内容 —— 复制过去只会让 dist 变成第二份
  // 会过期的拷贝。
  assert.equal(fs.has(`${STAGING}/design.json`), false);
  assert.equal(fs.has(`${STAGING}/DESIGN.md`), false);
  assert.equal(fs.has(`${STAGING}/notes/todo.txt`), false);
});

test("performDesignBuild compiles the tokens together with the classes the frames use", async () => {
  const fs = scaffoldedFs();
  const compiler = new RecordingCompiler();
  await buildWith(fs, compiler);

  assert.equal(compiler.calls.length, 1);
  const call = compiler.calls[0];
  assert.match(call?.themeCss ?? "", /--color-primary/);
  assert.equal(call?.resolveBase, RESOLVE_BASE, "解析 tailwindcss 的目录是应用自己的,不是设计包");
  for (const expected of ["bg-surface", "text-muted", "grid", "min-h-screen"]) {
    assert.ok(call?.candidates.includes(expected), `候选里漏了 ${expected}`);
  }
});

test("performDesignBuild overwrites the staged theme.css with the compiled CSS", async () => {
  const fs = scaffoldedFs();
  await buildWith(fs, new RecordingCompiler());

  // 帧里的 `<link href="../theme.css">` 一个字都不用改:被换掉的是它指向的那份内容。
  assert.equal(fs.text(`${STAGING}/theme.css`), "/* compiled */");
});

test("performDesignBuild still compiles when the design has no theme.css", async () => {
  const fs = scaffoldedFs();
  await fs.remove(`${DESIGN_ROOT}/theme.css`);
  const compiler = new RecordingCompiler();

  // 一份被删掉 theme.css 的设计仍然该拿到 preflight 与工具类,而不是整页退回浏览器默认。
  const result = await buildWith(fs, compiler);
  assert.equal(compiler.calls[0]?.themeCss, "");
  assert.equal(fs.text(`${STAGING}/theme.css`), "/* compiled */");
  assert.equal(result.candidateCount > 0, true);
});

test("performDesignBuild reports what it did", async () => {
  const fs = scaffoldedFs();
  const result = await buildWith(fs, new RecordingCompiler());

  // 2 个帧 + theme.css + logo.svg
  assert.equal(result.fileCount, 4);
  // 4 条真类名,外加扫描整篇源码带出的 `body` / `class`。**垃圾候选是无害的** ——
  // Tailwind 对认不出的候选什么都不生成;而漏掉真候选才会让样式静默消失。
  assert.equal(result.candidateCount, 6);
  assert.equal(result.cssBytes, "/* compiled */".length);
});
