import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOcrPort } from "../src/main/ocr/ocr-port.ts";
import type { OcrService } from "../src/main/ocr/ocr-service.ts";

/**
 * OCR 端口:能力包与桌面端之间的那一层。
 *
 * 它多做的一件事是**路径约束** —— 模型给的路径可能是相对的、也可能带 `../`。这里的判定与
 * 设计画布同一套纪律:先落回会话工作区,再允许读。
 */

const workspaceRoot = "/workspace/session";

function serviceStub(calls: Array<{ path: string }>): OcrService {
  return {
    status: async () => ({ available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." }),
    recognize: async (images: Array<{ path: string; name: string }>) => {
      for (const image of images) calls.push({ path: image.path });
      return {
        ok: true,
        recognition: {
          engine: "wordless-ocr/ppocrv5+ort-web-1.25.1+wasm2",
          cached: false,
          totalDurationMs: 300,
          loadMs: 0,
          pages: images.map((image) => ({
            name: image.name,
            path: image.path,
            text: "recognized",
            lineCount: 1,
            width: 10,
            height: 10,
            confidence: 0.9,
            durationMs: 300,
          })),
        },
      } as never;
    },
  } as unknown as OcrService;
}

/** 与 `WorkspacePathService#isWithinRoot` 同义的最小实现(测试不引入 Electron 侧的东西)。 */
function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function port(calls: Array<{ path: string }> = []) {
  return createOcrPort(serviceStub(calls), { workspaceRoot, isWithinRoot });
}

const signal = new AbortController().signal;

describe("createOcrPort", () => {
  it("相对路径落回工作区", async () => {
    const calls: Array<{ path: string }> = [];
    const outcome = await port(calls).recognize([{ path: ".attachments/shot.png", name: "shot.png", mimeType: "image/png" }], { signal });
    assert.equal(outcome.ok, true);
    assert.deepEqual(calls, [{ path: `${workspaceRoot}/.attachments/shot.png` }]);
  });

  it("绝对路径在工作区内就放行", async () => {
    const calls: Array<{ path: string }> = [];
    const outcome = await port(calls).recognize([{ path: `${workspaceRoot}/notes/img.png`, name: "img.png", mimeType: "image/png" }], { signal });
    assert.equal(outcome.ok, true);
    assert.equal(calls.length, 1);
  });

  it("逃出工作区的路径被拒绝,而且不会去读它", async () => {
    const calls: Array<{ path: string }> = [];
    for (const path of ["../outside.png", "../../etc/passwd", "/etc/passwd", "sub/../../outside.png"]) {
      const outcome = await port(calls).recognize([{ path, name: "x.png", mimeType: "image/png" }], { signal });
      assert.equal(outcome.ok, false, path);
      if (!outcome.ok) assert.match(outcome.message, /outside this session's workspace/);
    }
    assert.equal(calls.length, 0, "被拒绝的路径不该到达识别服务");
  });

  it("状态直接透传服务(含为什么不可用的说明)", async () => {
    const status = await port().status();
    assert.equal(status.available, true);
    assert.match(status.detail, /Ready/);
  });
});
