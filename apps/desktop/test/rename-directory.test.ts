import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renameDirectory } from "../scripts/rename-directory.mjs";

/**
 * `renameDirectory` 的契约。它守着打包脚本在 Windows 上栽过的那两条规矩:
 *
 * - 目标目录必须**不存在**(Windows 的 `MoveFileEx` 带 REPLACE_EXISTING 也不能替换目录 →
 *   `EPERM`;POSIX 允许覆盖空目录,所以在 mac/Linux 上完全看不出来);
 * - `rm -rf` 之后目录可能短暂处于"待删除"状态(杀软/索引器握着句柄)→ `EPERM`/`EACCES`/`EBUSY`,
 *   退避重试即可。
 *
 * `move` 可注入就是为了在这里确定性地造出这些错误码 —— 真去触发一次 Windows 的 EPERM
 * 在这台机器上做不到。
 */

function failing(times: number, code: string) {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    move: async (from: string, to: string) => {
      calls.push([from, to]);
      if (calls.length <= times) throw Object.assign(new Error(code), { code });
    },
  };
}

describe("renameDirectory", () => {
  it("一次成功就只调一次,并把参数原样传下去", async () => {
    const { calls, move } = failing(0, "EPERM");
    await renameDirectory("/staging/python", "/resources/python/win-x64", { move });
    assert.deepEqual(calls, [["/staging/python", "/resources/python/win-x64"]]);
  });

  it("EPERM 之后会重试并最终成功(待删除窗口)", async () => {
    const { calls, move } = failing(2, "EPERM");
    await renameDirectory("/staging/python", "/resources/python/win-x64", { move, delay: 1 });
    assert.equal(calls.length, 3);
  });

  it("EACCES / EBUSY 同样重试(杀软与索引器给的是这两个)", async () => {
    for (const code of ["EACCES", "EBUSY"]) {
      const { calls, move } = failing(1, code);
      await renameDirectory("/a", "/b", { move, delay: 1 });
      assert.equal(calls.length, 2, code);
    }
  });

  it("试满次数还不成就把**原始错误**抛出去(不能把 EPERM 吞掉)", async () => {
    const { calls, move } = failing(99, "EPERM");
    await assert.rejects(
      () => renameDirectory("/a", "/b", { move, attempts: 3, delay: 1 }),
      (cause: NodeJS.ErrnoException) => cause.code === "EPERM",
    );
    assert.equal(calls.length, 3);
  });

  it("非瞬时的错误立刻抛,不做无谓重试(EXDEV 那种重试也不会变好)", async () => {
    const { calls, move } = failing(99, "EXDEV");
    await assert.rejects(
      () => renameDirectory("/a", "/b", { move, delay: 1 }),
      (cause: NodeJS.ErrnoException) => cause.code === "EXDEV",
    );
    assert.equal(calls.length, 1);
  });
});
