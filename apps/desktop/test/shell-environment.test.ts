import assert from "node:assert/strict";
import test from "node:test";
import { loginShellPath, parseEnvironment } from "../src/main/environment/shell-environment.ts";

test("parses the null-delimited login environment and keeps inherited keys", () => {
  const environment = parseEnvironment("PATH=/usr/local/bin\0HOME=/Users/test\0SHELL=/bin/zsh\0SECRET=value\0BROKEN\0");

  assert.deepEqual(environment, {
    PATH: "/usr/local/bin",
    HOME: "/Users/test",
    SHELL: "/bin/zsh",
  });
});

test("asks zsh on macOS and the user's login shell on Linux", () => {
  // `exists` 一律注入:真去 stat 的话这条测试就变成了"跑测试的那台机器上有没有 /bin/zsh"。
  const exists = (available: string[]) => (path: string) => available.includes(path);
  assert.equal(loginShellPath({ platform: "darwin", shell: "/bin/bash", exists: exists([]) }), "/bin/zsh");
  assert.equal(loginShellPath({ platform: "linux", shell: "/bin/zsh", exists: exists(["/bin/zsh"]) }), "/bin/zsh");
  assert.equal(loginShellPath({ platform: "win32", shell: "C:\\Windows", exists: exists(["C:\\Windows"]) }), undefined);
});

test("Linux falls back when $SHELL is missing, relative, or not installed", () => {
  const exists = (available: string[]) => (path: string) => available.includes(path);
  // 没设 $SHELL(从 .desktop 启动的某些会话就是这样)。
  assert.equal(loginShellPath({ platform: "linux", shell: undefined, exists: exists(["/bin/bash"]) }), "/bin/bash");
  // 相对路径或空串不是登录 shell 描述,直接忽略。
  assert.equal(loginShellPath({ platform: "linux", shell: "bash", exists: exists(["/bin/bash"]) }), "/bin/bash");
  assert.equal(loginShellPath({ platform: "linux", shell: "", exists: exists(["/bin/bash"]) }), "/bin/bash");
  // $SHELL 指向的东西不存在(用户删了/容器里没有)时也不能拿它去 spawn。
  assert.equal(loginShellPath({ platform: "linux", shell: "/bin/fish", exists: exists(["/bin/bash"]) }), "/bin/bash");
  assert.equal(loginShellPath({ platform: "linux", shell: "/bin/fish", exists: exists(["/bin/sh"]) }), "/bin/sh");
  assert.equal(loginShellPath({ platform: "linux", shell: "/bin/fish", exists: exists([]) }), undefined);
});
