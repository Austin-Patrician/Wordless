import { rename } from "node:fs/promises";

/**
 * 把目录搬到**不存在**的目标位置上,并且容忍 Windows 上那个"刚删完还不能动"的窗口。
 *
 * 两条 Windows 特有的规矩,合起来解释了打包脚本在这上面栽的两次:
 *
 * 1. **目标目录必须不存在。** Windows 上 `rename` 落到 `MoveFileEx`,而它带的
 *    `MOVEFILE_REPLACE_EXISTING` 按文档**不能用于目录**(「This value cannot be used if
 *    lpNewFileName or lpExistingFileName names a directory」)。所以"先 `mkdir` 目标、
 *    再 rename 上去"在 Windows 上必然 `ERROR_ACCESS_DENIED` → Node 报 `EPERM`;
 *    而 POSIX 的 `rename(2)` 允许覆盖空目录,于是 mac/Linux 上完全看不出问题。
 *    (跨卷那一次是同一个调用的另一条规矩:`ERROR_NOT_SAME_DEVICE` → `EXDEV`。)
 *
 * 2. **`rm -rf` 之后目录可能短暂处于"待删除"状态** —— 杀软、索引器、或刚退出进程还握着句柄。
 *    这时对它 `rename` 会 `EPERM`/`EACCES`/`EBUSY`,等一会儿就好了。这不是我们代码的错,
 *    但打包在 CI 上跑,输不起这个偶发 —— 所以退避重试几次。
 *
 * `move` / `attempts` / `delay` 可注入,是为了让测试能确定性地造出上面这些错误码。
 */
export async function renameDirectory(
  from,
  to,
  { move = rename, attempts = 5, delay = 250 } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await move(from, to);
      return;
    } catch (cause) {
      const code = cause?.code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!transient || attempt >= attempts - 1) throw cause;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
