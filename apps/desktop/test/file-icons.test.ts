import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFileIcon, getFolderIcon } from "@wordless/ui-kit/file-icons";

/**
 * 文件图标那张表(现在住在 `@wordless/ui-kit`,两端共用)。
 *
 * 测试放在这里,是因为 **ui-kit 没有测试运行器**(它是一个源码包,没有 `test` 脚本),
 * 而这一条是"两端认出同一个图标"的保证 —— 值得钉住,不该因为它搬了家就没人守。
 */

describe("文件图标映射", () => {
	it("按扩展名认:tsx 是 TypeScript 的图标,不是通用文件", () => {
		const generic = getFileIcon(undefined, "没有扩展名");
		assert.notEqual(getFileIcon("tsx", "Composer.tsx"), generic);
		assert.equal(getFileIcon("tsx", "Composer.tsx"), getFileIcon("ts", "index.ts"));
	});

	it("按文件名认:package.json 认的是 Node,不是 JSON", () => {
		assert.notEqual(getFileIcon("json", "package.json"), getFileIcon("json", "data.json"));
	});

	it("测试文件单独一档(`*.test.tsx` 只看扩展名的话就是普通 TypeScript)", () => {
		assert.notEqual(getFileIcon("tsx", "Composer.test.tsx"), getFileIcon("tsx", "Composer.tsx"));
	});

	it("大小写不影响(用户的工作区里两种写法都有)", () => {
		assert.equal(getFileIcon("TSX", "Composer.TSX"), getFileIcon("tsx", "Composer.tsx"));
	});

	it("认不出来就给通用文件图标,**不猜**", () => {
		const generic = getFileIcon(undefined, "没有扩展名");
		assert.equal(getFileIcon("这个扩展名不存在", "a.这个扩展名不存在"), generic);
	});

	it("目录:常见目录名有自己的图标,认不出来的给通用文件夹", () => {
		assert.notEqual(getFolderIcon("src", false), getFolderIcon("随便什么目录", false));
	});

	it("目录的「打开」只对**没有专用图标**的那些生效(有专用图标的目录不随开合变)", () => {
		assert.notEqual(getFolderIcon("随便什么目录", true), getFolderIcon("随便什么目录", false));
		assert.equal(getFolderIcon("src", true), getFolderIcon("src", false));
	});

	it("每个图标都是一段真 SVG(空字符串会画出一个看不见的洞)", () => {
		for (const markup of [getFileIcon("tsx", "a.tsx"), getFolderIcon("src", false), getFileIcon(undefined, "x")]) {
			assert.match(markup, /^<svg[^>]*>/);
			assert.match(markup, /<\/svg>$/);
		}
	});
});
