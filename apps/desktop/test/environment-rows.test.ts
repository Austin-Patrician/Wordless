import assert from "node:assert/strict";
import test from "node:test";
import type { HostEnvironmentFacts } from "@wordless/protocol";
import { environmentNeedsAttention, hostEnvironmentRows, isAbsoluteExecutable } from "../src/renderer/features/settings/environment-rows.ts";
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

test("四行的顺序与含义:命令行 → Node → Python → 文字识别", () => {
  const rows = hostEnvironmentRows(FACTS, t);
  assert.deepEqual(rows.map((row) => row.id), ["shell", "node", "python", "ocr"]);
  // FACTS 里没有 ocr = 这一版没带文字识别资产,那是**未就绪**而不是错误。
  assert.deepEqual(rows.map((row) => row.status), ["ok", "ok", "ok", "missing"]);
});

test("Node 是自带那份时必须写明没有 npm —— 那才是它和用户装的那份的实际差别", () => {
  const bundled = hostEnvironmentRows(facts({ node: { found: true, version: "22.20.0", source: "wordless" } }), t)[1];
  assert.match(bundled?.detail ?? "", /自带的.*没有 npm/);
  assert.equal(bundled?.version, "v22.20.0");

  const system = hostEnvironmentRows(facts({ node: { found: true, version: "24.1.0", source: "system" } }), t)[1];
  assert.equal(system?.detail, "系统安装的");
  assert.equal(system?.version, "v24.1.0");
});

test("Python 缺包那一行要**把包名单独给出**(界面不该从提示文案里抠字符串)", () => {
  const row = hostEnvironmentRows(facts({ python: { ...FACTS.python, packages: { openpyxl: true, pyarrow: false, pandas: true } } }), t)[2];
  assert.deepEqual(row?.missingPackages, ["pyarrow"]);
  assert.equal(row?.action, "install-python-packages");
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
  assert.equal(bundled?.version, "3.12.14");

  const system = hostEnvironmentRows(
    facts({ python: { found: true, version: "3.11.2", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } } }),
    t,
  )[2];
  assert.equal(system?.version, "3.11.2");
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

test("文字识别就绪时:标明是自带引擎,并给出模型集", () => {
  const row = hostEnvironmentRows(facts({ ocr: { available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." } }), t)[3];
  assert.equal(row?.status, "ok");
  assert.equal(row?.version, "ppocrv5");
  assert.match(row?.detail ?? "", /自带/);
  assert.equal(row?.hint, undefined);
});

test("没有文字识别时:说清后果 —— 看不了图的模型读不出图里的文字", () => {
  const row = hostEnvironmentRows(facts({ ocr: { available: false, modelSet: null, detail: "not bundled" } }), t)[3];
  assert.equal(row?.status, "missing");
  // 这一行**不给 action**:它不是"点一下就能装"的东西(资产随包发布),所以只解释后果与出路。
  assert.equal(row?.action, undefined);
  assert.match(row?.hint ?? "", /看不了图片的模型/);
});

test("哪些行算能不能干活的前提:命令行与 Node 是,Python 与文字识别不是", () => {
  const rows = hostEnvironmentRows(FACTS, t);
  const optional = Object.fromEntries(rows.map((row) => [row.id, row.optional === true]));
  assert.deepEqual(optional, { shell: false, node: false, python: true, ocr: true });
  // 导览页据此判定"全都准备好了" —— 所以这条断言其实守的是"用户会不会被吓到"。
  const blocking = rows.filter((row) => row.optional !== true && row.status !== "ok");
  assert.deepEqual(blocking.map((row) => row.id), []);
});

test("Python 那一行不重复行标签:版本只给号,位置只在是真路径时显示", () => {
  // 系统装的 Python:版本 3.12.4(不是 "Python 3.12.4"),位置是命令名 `python3` → 不显示。
  const system = hostEnvironmentRows(facts({ python: { found: true, version: "3.12.4", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } } }), t)[2];
  assert.equal(system?.version, "3.12.4");
  assert.equal(system?.location, undefined, "`python3` 不是位置,只是把行标签又写了一遍");

  // 自带那份:绝对路径 → 显示,用户才知道跑的是哪一个。
  const bundled = hostEnvironmentRows(facts({ python: { found: true, version: "3.12.14", executable: "/Users/x/runtimes/python/3.12.14/bin/python3", source: "wordless", packages: { openpyxl: true, pyarrow: true, pandas: true } } }), t)[2];
  assert.equal(bundled?.version, "3.12.14");
  assert.equal(bundled?.location, "/Users/x/runtimes/python/3.12.14/bin/python3");
});

test("isAbsoluteExecutable:POSIX 与 Windows 的绝对路径都认", () => {
  assert.equal(isAbsoluteExecutable("/usr/bin/python3"), true);
  assert.equal(isAbsoluteExecutable("C:\\Python312\\python.exe"), true);
  assert.equal(isAbsoluteExecutable("python3"), false);
  assert.equal(isAbsoluteExecutable("python.exe"), false);
  assert.equal(isAbsoluteExecutable(undefined), false);
});

test("什么时候该提醒用户:只有非可选的项没就绪才算", () => {
  // 命令行与 Node 都在 = 什么都不说(把"已就绪"印在输入框底下是纯噪声)。
  assert.equal(environmentNeedsAttention(hostEnvironmentRows(FACTS, t)), false);

  // 缺 Python 或文字识别:那是可选能力,不提醒。
  assert.equal(environmentNeedsAttention(hostEnvironmentRows(facts({ python: { found: false, source: "none", packages: { openpyxl: false, pyarrow: false, pandas: false } } }), t)), false);
  assert.equal(environmentNeedsAttention(hostEnvironmentRows(facts({ ocr: { available: false, modelSet: null, detail: "not bundled" } }), t)), false);

  // 缺命令行(或 Node):这才影响 agent 干活,要提醒。
  assert.equal(environmentNeedsAttention(hostEnvironmentRows(facts({ shell: null }), t)), true);
  assert.equal(environmentNeedsAttention(hostEnvironmentRows(facts({ node: { found: false, source: "none" } }), t)), true);
});
