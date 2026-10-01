import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HostEnvironmentFacts } from "@wordless/protocol";
import { environmentFactsPayload } from "../src/main/environment/environment-facts-payload.ts";

/**
 * 环境面板载荷的合成。
 *
 * 这条测试的来历:曾经这里写成 `{ ...hostEnvironment.facts() }` —— `facts()` 是异步的,展开的
 * 是个 Promise,载荷变成 `{}`,打开设置页立刻报 `Cannot read properties of undefined (reading
 * 'found')`。所以第一件事就是**钉住"事实一个字段都不能少"**。
 */

const FACTS: HostEnvironmentFacts = {
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: true, version: "3.12.4", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } },
  probedAt: 1,
};

describe("environmentFactsPayload", () => {
  it("事实的每个字段都在 —— 面板读的是 facts.node.found 这类字段,少一个就白屏", async () => {
    const payload = await environmentFactsPayload({
      readFacts: async () => FACTS,
      readOcrStatus: async () => ({ available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." }),
    });
    assert.equal(payload.platform, "darwin");
    assert.deepEqual(payload.shell, FACTS.shell);
    assert.equal(payload.node?.found, true);
    assert.equal(payload.node?.version, "22.20.0");
    assert.equal(payload.python?.found, true);
    assert.deepEqual(payload.python?.packages, FACTS.python.packages);
    assert.equal(payload.probedAt, 1);
    assert.deepEqual(payload.ocr, { available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." });
  });

  it("没有文字识别服务时给一个明确的未就绪,而不是留空", async () => {
    const payload = await environmentFactsPayload({ readFacts: async () => FACTS });
    assert.equal(payload.ocr?.available, false);
    assert.match(payload.ocr?.detail ?? "", /not part of this build/);
    assert.equal(payload.node?.found, true);
  });

  it("异步事实会被等出来(漏 await 就会变成空对象 —— 这正是那个 bug)", async () => {
    // 故意让事实晚一点才到:如果实现里没 await,这里拿到的会是 undefined 字段。
    const payload = await environmentFactsPayload({
      readFacts: () => new Promise((resolve) => setTimeout(() => resolve(FACTS), 5)),
    });
    assert.equal(payload.node?.found, true);
    assert.equal(payload.python?.found, true);
  });
});
