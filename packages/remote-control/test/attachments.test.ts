import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ATTACHMENT_CHUNK_BYTES,
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_MAX_FILES,
	attachmentChunkCount,
	attachmentExtension,
	checkAttachment,
	checkAttachments,
} from "../src/attachments.ts";

/**
 * 远端附件的策略。两端共用这一份,所以这里的每一条都是"两端同时生效的规则"。
 */

describe("扩展名", () => {
	it("取最后一段,小写", () => {
		assert.equal(attachmentExtension("照片.JPG"), "jpg");
		assert.equal(attachmentExtension("a/b/c/report.PDF"), "pdf");
	});

	it("没有扩展名或只有点的时候给空串(而不是瞎猜)", () => {
		assert.equal(attachmentExtension("README"), "");
		assert.equal(attachmentExtension(".gitignore"), "");
		assert.equal(attachmentExtension("trailing."), "");
	});
});

describe("单个文件", () => {
	it("图片、文档、文本都放行", () => {
		for (const name of ["a.png", "b.pdf", "c.docx", "d.md", "e.ts", "f.csv", "g.svg"]) {
			assert.equal(checkAttachment({ name, size: 1024 }), undefined, name);
		}
	});

	it("可执行文件与压缩包拒掉(并说清为什么)", () => {
		const exe = checkAttachment({ name: "tool.exe", size: 1024 });
		assert.equal(exe?.code, "unsupported_type");
		assert.match(exe?.message ?? "", /exe/);
		assert.equal(checkAttachment({ name: "bundle.zip", size: 1024 })?.code, "unsupported_type");
		assert.equal(checkAttachment({ name: "app.dmg", size: 1024 })?.code, "unsupported_type");
	});

	it("空文件拒掉(发过去也没意义)", () => {
		assert.equal(checkAttachment({ name: "a.txt", size: 0 })?.code, "empty");
	});

	it("超过上限拒掉,并说清上限是多少", () => {
		const big = checkAttachment({ name: "a.png", size: ATTACHMENT_MAX_BYTES + 1 });
		assert.equal(big?.code, "too_large");
		assert.match(big?.message ?? "", /8MB/);
		assert.equal(checkAttachment({ name: "a.png", size: ATTACHMENT_MAX_BYTES }), undefined);
	});
});

describe("一批文件", () => {
	it("数量超了先拦(不用逐个检查)", () => {
		const files = Array.from({ length: ATTACHMENT_MAX_FILES + 1 }, (_, index) => ({ name: `a${index}.png`, size: 10 }));
		assert.equal(checkAttachments(files)?.code, "too_many");
	});

	it("数量没超时逐个检查,返回第一条理由", () => {
		assert.equal(checkAttachments([{ name: "ok.png", size: 10 }, { name: "bad.exe", size: 10 }])?.code, "unsupported_type");
	});

	it("全通过时没有理由", () => {
		assert.equal(checkAttachments([{ name: "a.png", size: 10 }, { name: "b.md", size: 10 }]), undefined);
	});
});

describe("分片", () => {
	it("按 256KB 切", () => {
		assert.equal(attachmentChunkCount(1), 1);
		assert.equal(attachmentChunkCount(ATTACHMENT_CHUNK_BYTES), 1);
		assert.equal(attachmentChunkCount(ATTACHMENT_CHUNK_BYTES + 1), 2);
	});

	it("一片 base64 之后仍然远低于单帧上限(1_500_000)", () => {
		// 这是分片存在的理由:一帧装不下的话,对端会把整条链路关掉。
		assert.ok(Math.ceil((ATTACHMENT_CHUNK_BYTES * 4) / 3) < 400_000);
	});
});
