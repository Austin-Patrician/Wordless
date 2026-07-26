import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironment } from "../src/main/environment/shell-environment.ts";

test("parses the null-delimited login environment and keeps inherited keys", () => {
  const environment = parseEnvironment("PATH=/usr/local/bin\0HOME=/Users/test\0SHELL=/bin/zsh\0SECRET=value\0BROKEN\0");

  assert.deepEqual(environment, {
    PATH: "/usr/local/bin",
    HOME: "/Users/test",
    SHELL: "/bin/zsh",
  });
});
