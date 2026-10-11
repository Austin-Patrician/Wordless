import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  knowledgeBundlePath,
  looksLikeKnowledgeBundle,
  normalizeKnowledgeBaseName,
  resolveActiveKnowledgeBase,
} from "../src/main/knowledge/knowledge-library.ts";
import { DEFAULT_KNOWLEDGE_BASE_NAME } from "@wordless/domain";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 多库管理。
 *
 * 两个核心决定在这里被钉住:
 *   1. **清单从文件系统推出来,不存注册表** —— 存了就有第二份真相,而用户在 Finder 里
 *      拷进来一份、删掉一份之后,"哪个是真的"没有好答案;
 *   2. **库名直接当目录名用**,所以归一必须挡住路径逃逸(`..`、分隔符、绝对路径)。
 */

let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-library-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("库名归一:挡的是路径逃逸", () => {
  it("正常名字通过,首尾空白与连续空格被收掉", () => {
    assert.equal(normalizeKnowledgeBaseName("  工作  资料 "), "工作 资料");
    assert.equal(normalizeKnowledgeBaseName("合同"), "合同");
  });

  it("路径逃逸与保留字符被拒 —— 库名会变成目录名", () => {
    for (const name of ["../外面", "a/b", "a\\b", "..", ".", "", "   ", ".hidden", "a:b", "a?b", "a*b"]) {
      assert.equal(normalizeKnowledgeBaseName(name), null, name);
    }
    assert.equal(normalizeKnowledgeBaseName("x".repeat(61)), null, "太长也不行");
  });
});

describe("认出像库的目录", () => {
  it("有任一约定的标记就算", () => {
    assert.equal(looksLikeKnowledgeBundle(["raws", "index.md"]), true);
    assert.equal(looksLikeKnowledgeBundle(["sources"]), true);
    assert.equal(looksLikeKnowledgeBundle(["concepts"]), true);
    assert.equal(looksLikeKnowledgeBundle(["entities"]), true);
    assert.equal(looksLikeKnowledgeBundle(["index.md"]), true);
  });

  it("一个空目录、或只有别的东西,不算库", () => {
    assert.equal(looksLikeKnowledgeBundle([]), false);
    assert.equal(looksLikeKnowledgeBundle(["笔记", "照片"]), false);
  });
});

describe("当前用哪个库", () => {
  it("记的那个还在就用它", () => {
    assert.equal(resolveActiveKnowledgeBase(["甲", "乙"], "乙"), "乙");
  });

  it("记的那个不在了(用户在 Finder 里删了)→ 退到第一个,而不是报错、也不是重建同名空库", () => {
    assert.equal(resolveActiveKnowledgeBase(["甲", "乙"], "丙"), "甲");
    assert.equal(resolveActiveKnowledgeBase(["甲", "乙"], null), "甲");
  });

  it("一个都没有 → null(调用方去建默认那个)", () => {
    assert.equal(resolveActiveKnowledgeBase([], "甲"), null);
    assert.equal(resolveActiveKnowledgeBase([], null), null);
  });
});

describe("真文件系统:清单就是目录", () => {
  it("在根目录里放一个像库的目录,它就出现在清单里", async () => {
    const root = join(directory, "清单");
    await mkdir(join(root, "甲库", "raws"), { recursive: true });
    await mkdir(join(root, "乙库", "concepts"), { recursive: true });
    // 一个不是库的目录(只有别的东西)不该出现。
    await mkdir(join(root, "随手放的"), { recursive: true });
    await writeFile(join(root, "随手放的", "笔记.txt"), "x", "utf-8");

    const { readdir } = await import("node:fs/promises");
    const names: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const children = await readdir(join(root, entry.name));
      if (looksLikeKnowledgeBundle(children)) names.push(entry.name);
    }
    assert.deepEqual(names.sort(), ["乙库", "甲库"]);
  });

  it("每个库的失败账本各记各的(按 bundle 根分文件)", async () => {
    const root = join(directory, "账本");
    const state = join(directory, "账本-state");
    const first = new KnowledgeService(knowledgeBundlePath(root, "甲库"), { stateDirectory: state });
    const second = new KnowledgeService(knowledgeBundlePath(root, "乙库"), { stateDirectory: state });
    await first.ensureBundle();
    await second.ensureBundle();

    await first.writeFailures({ version: 1, entries: { "a.pdf": { hash: "h", attempts: 3, quarantined: true, firstFailedAt: "", lastFailedAt: "" } } });
    assert.equal(Object.keys((await first.readFailures()).entries).length, 1);
    assert.equal(Object.keys((await second.readFailures()).entries).length, 0, "乙库的账本是空的");
  });

  it("默认库名是一个合法名字", () => {
    assert.equal(normalizeKnowledgeBaseName(DEFAULT_KNOWLEDGE_BASE_NAME), DEFAULT_KNOWLEDGE_BASE_NAME);
  });
});

describe("删除库:两道守卫", () => {
  /**
   * 这是个 `rm -r`,而库名是从渲染层来的。归一挡路径逃逸,再确认一次父目录 ——
   * 破坏性操作上"只删它自己"不能只靠调用方守规矩。
   */
  it("逃逸的名字在归一这一步就被挡掉", () => {
    for (const name of ["../..", "..", "/etc", "a/../b", ".ssh"]) {
      assert.equal(normalizeKnowledgeBaseName(name), null, name);
    }
  });

  it("归一过的名字,拼出来的父目录就是根", () => {
    const root = join(directory, "守卫");
    const target = knowledgeBundlePath(root, normalizeKnowledgeBaseName("工作")!);
    assert.equal(join(target, ".."), root, "父目录必须正好是根 —— 多一层少一层都不行");
  });
});
