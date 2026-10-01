import assert from "node:assert/strict";
import test from "node:test";
import type { HostEnvironmentFacts } from "@wordless/protocol";
import { hostEnvironmentRows } from "../src/renderer/features/settings/environment-rows.ts";
import { messages, type MessageKey } from "../src/renderer/shared/i18n.ts";

/** 面板与欢迎页共用这份判定,所以在一处钉住"什么算可用"。 */
const t = (key: MessageKey) => messages["zh-CN"][key];

const FACTS: HostEnvironmentFacts = {
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: true, version: "3.12.4", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } },
  probedAt: 1,
};

const facts = (overrides: Partial<HostEnvironmentFacts>): HostEnvironmentFacts => ({ ...FACTS, ...overrides });

test("三行的顺序与含义:命令行 → Node → Python", () => {
  const rows = hostEnvironmentRows(FACTS, t);
  assert.deepEqual(rows.map((row) => row.id), ["shell", "node", "python"]);
  assert.deepEqual(rows.map((row) => row.status), ["ok", "ok", "ok"]);
});

test("Node 是自带那份时必须写明没有 npm —— 那才是它和用户装的那份的实际差别", () => {
  const bundled = hostEnvironmentRows(facts({ node: { found: true, version: "22.20.0", source: "wordless" } }), t)[1];
  assert.match(bundled?.detail ?? "", /自带的.*没有 npm/);
  assert.equal(bundled?.version, "v22.20.0");

  const system = hostEnvironmentRows(facts({ node: { found: true, version: "24.1.0", source: "system" } }), t)[1];
  assert.equal(system?.detail, "系统安装的");
  assert.equal(system?.version, "v24.1.0");
});

test("Python 要分开说:没有 Python,和「有 Python 但缺包」是两件事", () => {
  const missing = hostEnvironmentRows(
    facts({ python: { found: false, source: "none", packages: { openpyxl: false, pyarrow: false, pandas: false } } }),
    t,
  )[2];
  assert.equal(missing?.status, "missing");
  assert.equal(missing?.action, "python-download");
  // 内置之后,"没有 Python"这条基本上是应用坏了才会出现 —— 文案要说得像异常,而不是像"请自己去装"。
  assert.match(missing?.hint ?? "", /通常自带/);

  const partial = hostEnvironmentRows(
    facts({ python: { found: true, version: "3.12.4", executable: "python3", source: "wordless", packages: { openpyxl: true, pyarrow: false, pandas: false } } }),
    t,
  )[2];
  assert.equal(partial?.status, "partial");
  // 缺包时的出路是"一键装进内置那份",而不是让用户自己去装。
  assert.equal(partial?.action, "install-python-packages");
  assert.match(partial?.hint ?? "", /缺少 pyarrow, pandas/);
});

test("内置那份 Python 要标出来:用户得知道跑的是哪一个", () => {
  const bundled = hostEnvironmentRows(
    facts({ python: { found: true, version: "3.12.14", executable: "/x/python3", source: "wordless", packages: { openpyxl: false, pyarrow: false, pandas: false } } }),
    t,
  )[2];
  assert.match(bundled?.detail ?? "", /Wordless 自带的/);
  assert.equal(bundled?.version, "Python 3.12.14");

  const system = hostEnvironmentRows(
    facts({ python: { found: true, version: "3.11.2", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } } }),
    t,
  )[2];
  assert.equal(system?.version, "Python 3.11.2");
  assert.equal(system?.detail, "系统安装的");
});

test("命令行缺失:它给的是一句解释,不是一次安装", () => {
  const shell = hostEnvironmentRows(facts({ shell: null }), t)[0];
  assert.equal(shell?.status, "missing");
  assert.equal(shell?.action, undefined);
  assert.ok((shell?.hint ?? "").length > 0);
});

// 命令行是通用的:跑的是 bash 还是 PowerShell、装在哪个路径,都与用户无关(Windows 上把 "bash" 摆出来
// 只会让人以为缺了什么)。这一条钉住"界面里不出现实现细节"。
test("命令行那一行不暴露实现细节:不提 bash/PowerShell,也不给路径", () => {
  for (const kind of ["pwsh", "powershell", "cmd", "bash", "sh", "other"] as const) {
    const row = hostEnvironmentRows(facts({ shell: { kind, executable: "/bin/bash" } }), t)[0];
    assert.equal(row?.detail, undefined, `${kind} 不该有来源说明`);
    assert.equal(row?.location, undefined, `${kind} 不该显示路径`);
    assert.equal(row?.version, undefined, `${kind} 不该显示版本`);
  }
});
