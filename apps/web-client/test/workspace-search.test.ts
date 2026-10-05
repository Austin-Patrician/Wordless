import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	WORKSPACE_PICKER_MAX_ROWS,
	WORKSPACE_SEARCH_CACHE_LIMIT,
	WORKSPACE_SEARCH_TTL_MS,
	createWorkspaceSearchCache,
	isStaleSearch,
	isUnsupportedMethod,
	orderWorkspaceMatches,
	workspacePathParts,
	workspaceSearchKey,
} from "../src/workspace-search.ts";

/**
 * `@` 搜索的三条效率保证:**不重复问**、**只认最新那次**、**缓存有上限**。
 *
 * 它们都是纯函数,所以能直接钉住 —— 而它们一旦错了,表现是"手机上打字一顿一顿的",
 * 那种问题在真机上很难复现,只能靠这里。
 */

const entry = (path: string) => ({ path, name: path, kind: "file" as const });

describe("查询缓存", () => {
	it("同一段查询在有效期内只问一次", () => {
		const cache = createWorkspaceSearchCache();
		cache.write("k", [entry("a.ts")], 1_000);
		assert.deepEqual(cache.read("k", 1_000 + WORKSPACE_SEARCH_TTL_MS - 1), [entry("a.ts")]);
	});

	it("过期之后要重新问(文件可能刚被改过)", () => {
		const cache = createWorkspaceSearchCache();
		cache.write("k", [entry("a.ts")], 1_000);
		assert.equal(cache.read("k", 1_000 + WORKSPACE_SEARCH_TTL_MS), undefined);
		// 过期项顺手删掉,不留着占地方。
		assert.equal(cache.read("k", 1_000 + WORKSPACE_SEARCH_TTL_MS + 1), undefined);
	});

	it("键归一化大小写与首尾空白:`App` 与 `app ` 是同一段查询", () => {
		assert.equal(workspaceSearchKey("s1", "App"), workspaceSearchKey("s1", " app "));
	});

	it("键里有会话:换会话之后**不能**拿上一个会话的结果回答(那不是慢,是错)", () => {
		assert.notEqual(workspaceSearchKey("s1", "app"), workspaceSearchKey("s2", "app"));
	});

	it("超过上限丢最旧的,而不是无限长下去", () => {
		const cache = createWorkspaceSearchCache({ limit: 3 });
		for (let index = 0; index < 10; index += 1) cache.write(`k${index}`, [entry(`f${index}.ts`)], 1_000);
		assert.equal(cache.read("k0", 1_000), undefined);
		assert.deepEqual(cache.read("k9", 1_000), [entry("f9.ts")]);
	});

	it("读过的排到队尾:淘汰的是最久没用过的", () => {
		const cache = createWorkspaceSearchCache({ limit: 3 });
		cache.write("a", [entry("a.ts")], 1_000);
		cache.write("b", [entry("b.ts")], 1_000);
		cache.write("c", [entry("c.ts")], 1_000);
		// 用一下 a,它就不该是被丢的那个。
		assert.ok(cache.read("a", 1_000));
		cache.write("d", [entry("d.ts")], 1_000);
		assert.ok(cache.read("a", 1_000), "用过的还在");
		assert.equal(cache.read("b", 1_000), undefined, "最久没用过的被丢掉");
	});

	it("上限是正数(传 0 或负数时不该把缓存搞成永远空)", () => {
		const cache = createWorkspaceSearchCache({ limit: 0 });
		cache.write("k", [entry("a.ts")], 1_000);
		assert.ok(cache.read("k", 1_000));
		assert.ok(WORKSPACE_SEARCH_CACHE_LIMIT > 0);
	});

	it("清空(断开连接时用:换了一台电脑,缓存里的路径就不作数了)", () => {
		const cache = createWorkspaceSearchCache();
		cache.write("k", [entry("a.ts")], 1_000);
		cache.clear();
		assert.equal(cache.read("k", 1_000), undefined);
	});
});

describe("摆进选择器的顺序", () => {
	const file = (path: string) => ({ path, name: path, kind: "file" as const });
	const dir = (path: string) => ({ path, name: path, kind: "directory" as const });

	it("目录在前(找文件时先缩范围)", () => {
		const ordered = orderWorkspaceMatches([file("src/a.ts"), dir("src/lib"), file("src/b.ts")]);
		assert.deepEqual(ordered.map((entry) => entry.path), ["src/lib", "src/a.ts", "src/b.ts"]);
	});

	it("同类按路径排:同一段查询每次摆出来的顺序都一样", () => {
		const ordered = orderWorkspaceMatches([file("b.ts"), file("a.ts")]);
		assert.deepEqual(ordered.map((entry) => entry.path), ["a.ts", "b.ts"]);
	});

	it("超过上限就截掉 —— 而且**键盘走的是同一份**,不会选中看不见的那一行", () => {
		const many = Array.from({ length: 20 }, (_value, index) => file(`f${index}.ts`));
		assert.equal(orderWorkspaceMatches(many).length, WORKSPACE_PICKER_MAX_ROWS);
	});
});

describe("路径拆成名字与目录", () => {
	const parts = (path: string, name: string) => workspacePathParts({ path, name });

	it("普通文件:名字与它所在的目录分开", () => {
		assert.deepEqual(parts("src/renderer/thread/Composer.tsx", "Composer.tsx"), {
			name: "Composer.tsx",
			directory: "src/renderer/thread",
		});
	});

	it("目录条目也一样(名字是最后那一段)", () => {
		assert.deepEqual(parts("src/renderer", "renderer"), { name: "renderer", directory: "src" });
	});

	it("工作区根下的文件:没有目录可显示,而不是显示一个空的第二段", () => {
		assert.deepEqual(parts("README.md", "README.md"), { name: "README.md", directory: "" });
	});

	it("**以本机给的名字为准**:它和路径对不上时也认它(那是权威的显示名)", () => {
		// 形状变了(对方比我们新)时不能把整条路径当名字 —— 那比"目录少一段"糟得多。
		assert.deepEqual(parts("src/app.tsx", "app.tsx"), { name: "app.tsx", directory: "src" });
		assert.deepEqual(parts("src/别的名字.tsx", "app.tsx"), { name: "app.tsx", directory: "src" });
	});

	it("名字是空的(老版本只给路径):从路径里取最后一段", () => {
		assert.deepEqual(parts("src/renderer/Composer.tsx", ""), { name: "Composer.tsx", directory: "src/renderer" });
	});
});

describe("只认最新那次", () => {
	it("先发的后回来:丢掉", () => {
		// 第 2 次是最新发出的;第 1 次回来时序号对不上。
		assert.equal(isStaleSearch(1, 2), true);
		assert.equal(isStaleSearch(2, 2), false);
	});
});

describe("老版本桌面端(不认识这个方法)", () => {
	it("认得出「不支持」,而且只认这一种", () => {
		assert.equal(isUnsupportedMethod({ code: "not_found", message: "unsupported method: session.workspace-files" }), true);
		// 会话不存在也是 not_found,但那**不是**"这台机器没有这个功能":该报错就报错。
		assert.equal(isUnsupportedMethod({ code: "not_found", message: "session not found: abc" }), false);
		assert.equal(isUnsupportedMethod({ code: "busy", message: "unsupported method" }), false);
		assert.equal(isUnsupportedMethod(undefined), false);
	});
});
