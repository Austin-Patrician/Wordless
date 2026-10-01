import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import {
  HostEnvironmentService,
  PythonUnavailableError,
  type HostRunOptions,
  type PythonRuntime,
} from "../src/main/environment/host-environment-service.ts";

const DEPENDENCIES = (input: { openpyxl?: boolean; pyarrow?: boolean; pandas?: boolean; executable?: string }) =>
  JSON.stringify({
    executable: input.executable ?? "/usr/bin/python3",
    openpyxl: input.openpyxl ?? false,
    pyarrow: input.pyarrow ?? false,
    pandas: input.pandas ?? false,
  });

/** 一个可编程的假进程层:按 `命令 首参` 决定回答什么,并记录每一次调用。 */
function fakeRunner(answers: Record<string, string | Error>) {
  const calls: { command: string; args: readonly string[]; options?: HostRunOptions }[] = [];
  const run = async (command: string, args: readonly string[], options?: HostRunOptions): Promise<string> => {
    calls.push({ command, args, options });
    const key = `${command} ${args[0] ?? ""}`.trim();
    const answer = answers[key] ?? answers[command];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`ENOENT: ${key}`);
    return answer;
  };
  const keyOf = (call: { command: string; args: readonly string[] }) => `${call.command} ${call.args[0] ?? ""}`.trim();
  return { calls, run, countFor: (key: string) => calls.filter((call) => keyOf(call) === key).length };
}

test("探测 Python:版本与依赖一起拿到,并按依赖多少排序", async () => {
  const runner = fakeRunner({
    "python3 --version": "Python 3.12.4\n",
    "python3 -c": DEPENDENCIES({ pandas: true, executable: "/usr/bin/python3" }),
    "python --version": "Python 3.9.6\n",
    "python -c": DEPENDENCIES({ pandas: true, pyarrow: true, executable: "/usr/local/bin/python" }),
  });
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run });

  const runtimes = await service.pythonRuntimes();
  assert.deepEqual(runtimes.map((runtime) => runtime.version), ["Python 3.9.6", "Python 3.12.4"]);
  assert.deepEqual(runtimes[0]?.dependencies, { openpyxl: false, pyarrow: true, pandas: true });
});

test("探测 Python:同一个可执行文件只留一个(python 与 python3 常常是同一个)", async () => {
  const runner = fakeRunner({
    "python3 --version": "Python 3.12.4\n",
    "python3 -c": DEPENDENCIES({ pandas: true, executable: "/usr/bin/python3" }),
    "python --version": "Python 3.12.4\n",
    "python -c": DEPENDENCIES({ pandas: true, executable: "/usr/bin/Python3" }),
  });
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run });

  assert.equal((await service.pythonRuntimes()).length, 1);
});

test("探测 Python:不是 3.x 的候选不会被收下(Store 上的假别名也骗不过)", async () => {
  const runner = fakeRunner({
    "python3 --version": "Python 2.7.18\n",
    // 依赖探测也能通过 —— 于是"被拒"只可能是因为版本闸门,而不是因为探测失败。
    "python3 -c": DEPENDENCIES({ pandas: true }),
    "python --version": new Error("Python was not found; run without arguments to install from the Microsoft Store"),
  });
  const service = new HostEnvironmentService({ platform: "win32", run: runner.run });

  assert.deepEqual(await service.pythonRuntimes(), []);
});

test("探测失败不抛错:探不到就是“没有”", async () => {
  const service = new HostEnvironmentService({ platform: "darwin", run: fakeRunner({}).run });

  assert.deepEqual(await service.pythonRuntimes(), []);
  const facts = await service.facts();
  assert.equal(facts.python.found, false);
  assert.deepEqual(facts.python.packages, { openpyxl: false, pyarrow: false, pandas: false });
});

test("requirePython:有 Python 但缺包,和一台机器完全没有 Python,是两件事", async () => {
  const withPython = new HostEnvironmentService({
    platform: "darwin",
    run: fakeRunner({ "python3 --version": "Python 3.12.4\n", "python3 -c": DEPENDENCIES({ pandas: true }) }).run,
  });
  const missingPackages = await withPython.requirePython(["pyarrow"]).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  assert.ok(missingPackages instanceof PythonUnavailableError);
  assert.equal(missingPackages.hasPython, true);
  assert.deepEqual(missingPackages.dependencies, ["pyarrow"]);

  const noPython = new HostEnvironmentService({ platform: "darwin", run: fakeRunner({}).run });
  const error = await noPython.requirePython().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  assert.ok(error instanceof PythonUnavailableError);
  assert.equal(error.hasPython, false);
});

test("requirePython:选中能满足依赖的那一个,而不是第一个能找到的", async () => {
  const runner = fakeRunner({
    "python3 --version": "Python 3.12.4\n",
    "python3 -c": DEPENDENCIES({ pandas: true, executable: "/usr/bin/python3" }),
    "python --version": "Python 3.9.6\n",
    "python -c": DEPENDENCIES({ pandas: true, pyarrow: true, executable: "/usr/local/bin/python" }),
  });
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run });

  assert.equal((await service.requirePython(["pyarrow"])).command, "python");
});

test("探测不拿工作区当 cwd(Windows 上当前目录会被先搜成命令来源)", async () => {
  const runner = fakeRunner({});
  const service = new HostEnvironmentService({ platform: "win32", run: runner.run });
  await service.pythonRuntimes();

  assert.ok(runner.calls.length > 0);
  for (const call of runner.calls) {
    assert.ok(call.options?.cwd);
    assert.notEqual(call.options?.cwd, process.cwd());
  }
});

test("事实:shell / Node / Python 一次说清", async () => {
  const runner = fakeRunner({
    "node --version": "v22.20.0\n",
    "python3 --version": "Python 3.12.4\n",
    "python3 -c": DEPENDENCIES({ pandas: true, pyarrow: true, openpyxl: true }),
  });
  const service = new HostEnvironmentService({ platform: process.platform, run: runner.run });

  const facts = await service.facts();
  // shell 走真实解析(POSIX 上永远不会失败);这里只断言"解析出了一个 shell,并给出了种类"。
  assert.ok(facts.shell?.executable);
  assert.ok(["bash", "sh", "other"].includes(facts.shell?.kind ?? ""));
  assert.deepEqual(facts.node, { found: true, version: "22.20.0", source: "system" });
  assert.deepEqual(facts.python, {
    found: true,
    version: "Python 3.12.4",
    executable: "python3",
    source: "system",
    packages: { openpyxl: true, pyarrow: true, pandas: true },
  });
  assert.ok(facts.probedAt > 0);
});

test("重探有节流:失败会连着发生,不节流就等于把探测挂在失败路径上反复跑子进程", async () => {
  const runner = fakeRunner({ "python3 --version": "Python 3.12.4\n", "python3 -c": DEPENDENCIES({}) });
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run });

  await service.pythonRuntimes();
  assert.equal(runner.countFor("python3 --version"), 1);

  // 第一次重探:缓存失效,下一次访问真的再探一遍。
  await service.refresh("python");
  await service.pythonRuntimes();
  assert.equal(runner.countFor("python3 --version"), 2);

  // 紧接着的第二次:被节流挡住 —— 缓存没清,所以也没有第三次探测。
  await service.refresh("python");
  await service.pythonRuntimes();
  assert.equal(runner.countFor("python3 --version"), 2);
});

test("runPython 把参数原样交给运行器", async () => {
  const runner = fakeRunner({ "python3 /scripts/a.py": "ok" });
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run });
  const runtime: PythonRuntime = {
    command: "python3",
    args: [],
    version: "Python 3.12.4",
    dependencies: { openpyxl: false, pyarrow: false, pandas: false },
  };

  await service.runPython(runtime, "/scripts/a.py", ["--x", "1"], "/tmp", undefined, 1_000);
  assert.deepEqual(runner.calls.at(-1)?.args, ["/scripts/a.py", "--x", "1"]);
  assert.equal(runner.calls.at(-1)?.options?.timeoutMs, 1_000);
});

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

/** 把"自带的那份 Node"的探测答出来,同时让系统 node 探测失败。 */
function withoutSystemNode(bundledVersion = "v22.20.0\n") {
  return fakeRunner({ [process.execPath]: bundledVersion });
}

function runCapture(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ stdout, stderr: `${stderr}${error.message}`, code: null }));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

test("Node 兜底:系统有能用的 node 时,一个字都不改", async () => {
  const runner = fakeRunner({ "node --version": "v22.20.0\n" });
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  const service = new HostEnvironmentService({ platform: "darwin", run: runner.run, binDirectory, env });

  const state = await service.installNodeFallback();
  assert.deepEqual(state, { source: "system", version: "22.20.0" });
  // 尊重用户那份:不前置(否则 nvm/volta 里钉住的版本会被抢走)。
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal((await service.facts()).node.source, "system");
});

test("Node 兜底:系统没有 node 时,把自带的那份放到 PATH 最前面", async () => {
  const runner = withoutSystemNode();
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    run: runner.run,
    binDirectory,
    electronBinaryPath: process.execPath,
    env,
  });

  const state = await service.installNodeFallback();
  assert.deepEqual(state, { source: "wordless", version: "22.20.0" });
  assert.equal(env.PATH!.startsWith(binDirectory), true);
  assert.equal(env.PATH!.includes("/usr/bin"), true);
  // 系统 node 的探测必须用**注入前**的 PATH,否则会把我们自己这层当成系统版。
  assert.equal(runner.calls[0]?.options?.env?.PATH, "/usr/bin:/bin");
});

test("Node 兜底:系统 node 太旧(低于下限)时会被盖掉 —— 过旧比没有更难查", async () => {
  const runner = fakeRunner({ "node --version": "v12.22.12\n", [process.execPath]: "v22.20.0\n" });
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    run: runner.run,
    binDirectory,
    electronBinaryPath: process.execPath,
    env,
  });

  assert.deepEqual(await service.installNodeFallback(), { source: "wordless", version: "22.20.0" });
  assert.equal(env.PATH!.startsWith(binDirectory), true);
});

test("Node 兜底:自带的那份也跑不起来时,绝不往 PATH 里放一个坏脚本", async () => {
  const runner = fakeRunner({ [process.execPath]: new Error("boom") });
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    run: runner.run,
    binDirectory,
    electronBinaryPath: process.execPath,
    env,
  });

  assert.deepEqual(await service.installNodeFallback(), { source: "none" });
  assert.equal(env.PATH, "/usr/bin:/bin");
});

test("Node 兜底:没配目录就不做兜底,事实如实说没有(而不是假装有)", async () => {
  const service = new HostEnvironmentService({ platform: "darwin", run: withoutSystemNode().run });
  assert.deepEqual(await service.installNodeFallback(), { source: "none" });
});

test("Node 兜底:重复装不会把目录塞进 PATH 两次", async () => {
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    run: withoutSystemNode().run,
    binDirectory,
    electronBinaryPath: process.execPath,
    env,
  });

  await service.installNodeFallback();
  await service.installNodeFallback();
  assert.deepEqual(env.PATH!.split(delimiter).filter((entry) => entry === binDirectory), [binDirectory]);
});

test("Node 兜底:用户中途装好了 node,重新探测就把它接回来(不是重启才行)", async () => {
  const answers: Record<string, string | Error> = { "node --version": new Error("ENOENT"), [process.execPath]: "v22.20.0\n" };
  const runner = fakeRunner(answers);
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    run: runner.run,
    binDirectory,
    electronBinaryPath: process.execPath,
    env,
  });

  await service.installNodeFallback();
  assert.equal(env.PATH!.startsWith(binDirectory), true);

  answers["node --version"] = "v24.1.0\n";
  await service.refresh("node");
  assert.deepEqual(await service.installNodeFallback(), { source: "system", version: "24.1.0" });
  assert.equal(env.PATH!.includes(binDirectory), false);
});

test("POSIX 兜底脚本:系统装好了 node 就让位,没有就用 ELECTRON_RUN_AS_NODE 跑起来", async () => {
  if (process.platform === "win32") return;
  const binDirectory = await mkdtemp(join(tmpdir(), "wordless-bin-"));
  const realNodeDirectory = await mkdtemp(join(tmpdir(), "wordless-real-"));
  const electronDirectory = await mkdtemp(join(tmpdir(), "wordless-electron-"));
  const electronBinary = join(electronDirectory, "Wordless");
  await writeExecutable(electronBinary, '#!/bin/sh\necho "electron:run_as_node=$ELECTRON_RUN_AS_NODE args=$*"\n');

  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  const service = new HostEnvironmentService({
    platform: "darwin",
    // 这一条用的是**假的 Electron 二进制**,所以"自带那份 Node"的探测也要答在它头上。
    run: fakeRunner({ [electronBinary]: "v22.20.0\n" }).run,
    binDirectory,
    electronBinaryPath: electronBinary,
    env,
  });
  await service.installNodeFallback();

  // ① 没有别的 node:走的是自带那份,并且带上了 ELECTRON_RUN_AS_NODE。
  const bundled = await runCapture(join(binDirectory, "node"), ["-e", "1"], { PATH: binDirectory });
  assert.equal(bundled.code, 0, bundled.stderr);
  assert.match(bundled.stdout, /electron:run_as_node=1 args=-e 1/);

  // ② 用户中途装好了 node:脚本自己让位,不必重启(也不靠设置里的重新探测)。
  await writeExecutable(join(realNodeDirectory, "node"), '#!/bin/sh\necho "real-node:$*"\n');
  const handed = await runCapture(join(binDirectory, "node"), ["script.js"], {
    PATH: `${realNodeDirectory}${delimiter}${binDirectory}`,
  });
  assert.equal(handed.code, 0, handed.stderr);
  assert.equal(handed.stdout.trim(), "real-node:script.js");
});

/** 造一棵"打包进来的 Python":一个能应答 --version 与依赖探测的 sh 脚本(不需要真 Python)。 */
async function seedFixture(options: { marker?: string; interpreterName?: string; broken?: boolean; symlinked?: boolean } = {}) {
  const { marker = "20260929:3.12.14:fake.tar.gz", interpreterName = "bin/python3", broken = false } = options;
  const vendor = await mkdtemp(join(tmpdir(), "wordless-vendor-"));
  const runtimes = await mkdtemp(join(tmpdir(), "wordless-runtimes-"));
  const interpreterPath = join(vendor, interpreterName);
  await mkdir(dirname(interpreterPath), { recursive: true });
  await writeFile(join(vendor, ".wordless-python-version"), `${marker}\n`, "utf8");
  const script = broken
    ? '#!/bin/sh\nexit 1\n'
    : [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "Python 3.12.14"; exit 0; fi',
        `echo '{"executable":"${interpreterPath}","openpyxl":true,"pyarrow":true,"pandas":true}'`,
        "",
      ].join("\n");
  if (options.symlinked) {
    // 真树就是这样:bin/python3 是指向 bin/python3.12 的**相对**链接。
    await rm(interpreterPath, { force: true });
    await writeExecutable(join(dirname(interpreterPath), "python3.12"), script);
    await symlink("python3.12", interpreterPath);
  } else {
    await writeExecutable(interpreterPath, script);
  }
  return { vendor, runtimes, interpreterPath };
}

const PYTHON_ARGS = { pythonVendorDirectory: "vendor", runtimesDirectory: "runtimes" } as const;

function bundledService(fixture: { vendor: string; runtimes: string }, platform: NodeJS.Platform = "darwin") {
  return new HostEnvironmentService({
    platform,
    pythonVendorDirectory: fixture.vendor,
    runtimesDirectory: fixture.runtimes,
    env: { PATH: "/usr/bin" },
  });
}

test("内置 Python:首启从应用包拷到用户目录,并真的能跑", async () => {
  const fixture = await seedFixture();
  const service = bundledService(fixture);

  const runtimes = await service.pythonRuntimes();
  const bundled = runtimes.find((runtime) => runtime.bundled);
  assert.ok(bundled, "内置的那份应当被探到");
  assert.equal(bundled.version, "Python 3.12.14");
  assert.deepEqual(bundled.dependencies, { openpyxl: true, pyarrow: true, pandas: true });
  // 副本落在用户目录(应用包里那份不可写 —— 改它会破坏签名,而 pip 装包早晚要用它)。
  assert.equal(bundled.command.startsWith(fixture.runtimes), true);
  assert.equal((await readFile(join(fixture.runtimes, "python", "3.12.14", ".wordless-python-version"), "utf8")).trim(), "20260929:3.12.14:fake.tar.gz");

  const facts = await service.facts();
  assert.equal(facts.python.source, "wordless");
  assert.equal(facts.python.found, true);
});

test("内置 Python:已经有副本时不重复拷(mtime 不变)", async () => {
  const fixture = await seedFixture();
  const first = bundledService(fixture);
  const target = join(fixture.runtimes, "python", "3.12.14", "bin", "python3");
  await first.pythonRuntimes();
  const before = (await stat(target)).mtimeMs;

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  const second = bundledService(fixture);
  await second.pythonRuntimes();

  assert.equal((await stat(target)).mtimeMs, before);
});

test("内置 Python:副本被删/被破坏时会被重拷(不是只信标记文件)", async () => {
  const fixture = await seedFixture();
  await bundledService(fixture).pythonRuntimes();

  const target = join(fixture.runtimes, "python", "3.12.14", "bin", "python3");
  await rm(target, { force: true });

  const again = bundledService(fixture);
  const bundled = (await again.pythonRuntimes()).find((runtime) => runtime.bundled);
  assert.ok(bundled, "副本没了就该重新拷一份");
  assert.equal((await stat(target)).size > 0, true);
});

test("内置 Python:打包时跳过了(没有资产)就当作没有,不报错", async () => {
  const fixture = await seedFixture({ marker: "skipped" });
  const service = bundledService(fixture);

  assert.deepEqual((await service.pythonRuntimes()).find((runtime) => runtime.bundled), undefined);
});

test("内置 Python:存在但跑不起来 = 没有", async () => {
  const fixture = await seedFixture({ broken: true });
  const service = bundledService(fixture);

  assert.equal(await service.seedPythonRuntime(), undefined);
  assert.equal((await service.pythonRuntimes()).find((runtime) => runtime.bundled), undefined);
  // 断言的是"不会把坏的那份交出去",而不是"这台机器没有 Python"(开发机上往往装着一个)。
  assert.notEqual((await service.facts()).python.source, "wordless");
});

test("内置 Python:Windows 上认的是 python.exe(打包结构不同)", async () => {
  const fixture = await seedFixture({ interpreterName: "python.exe" });
  const service = bundledService(fixture, "win32");

  const bundled = (await service.pythonRuntimes()).find((runtime) => runtime.bundled);
  assert.ok(bundled, "Windows 上应当找到 python.exe");
  assert.equal(bundled.command.endsWith("python.exe"), true);
});

test("内置 Python:用户那份依赖不齐时,内置那份胜出(排序按依赖满足数)", async () => {
  const fixture = await seedFixture();
  const service = new HostEnvironmentService({
    platform: "darwin",
    pythonVendorDirectory: fixture.vendor,
    runtimesDirectory: fixture.runtimes,
    env: { PATH: "/usr/bin" },
    run: async (command, args) => {
      // 只回答"用户装的"那个 python3:内置那份在 runtimes 目录下,答案不同,于是能区分开。
      if (command.startsWith(fixture.runtimes)) {
        if (args[0] === "--version") return "Python 3.12.14\n";
        return '{"executable":"bundled-python","openpyxl":true,"pyarrow":true,"pandas":true}';
      }
      if (command.endsWith("python3") && args[0] === "--version") return "Python 3.11.2\n";
      if (command.endsWith("python3")) return '{"executable":"user-python","openpyxl":true,"pyarrow":false,"pandas":false}';
      throw new Error(`ENOENT: ${command}`);
    },
  });

  const runtimes = await service.pythonRuntimes();
  assert.equal(runtimes.length, 2);
  assert.equal(runtimes[0]?.bundled, true);
  assert.deepEqual(runtimes[0]?.dependencies, { openpyxl: true, pyarrow: true, pandas: true });
  assert.equal(runtimes[1]?.version, "Python 3.11.2");
});

test("内置 Python:副本里的符号链接必须保持相对 —— 否则 sys.prefix 会指回应用包", async () => {
  const fixture = await seedFixture({ symlinked: true });
  const service = bundledService(fixture);
  const bundled = (await service.pythonRuntimes()).find((runtime) => runtime.bundled);
  assert.ok(bundled, "跟着符号链接也要能跑起来");

  // 这一条钉的是一个真实缺陷:`fs.cp` 默认(verbatimSymlinks: false)会把相对链接解析成**绝对路径**,
  // 于是副本里的 python3 指回应用包,CPython 按可执行文件的真实路径算 sys.prefix —— pip 就往应用包里装。
  const copied = join(fixture.runtimes, "python", "3.12.14", "bin", "python3");
  assert.equal(await readlink(copied), "python3.12");
  // macOS 上 /var 是指向 /private/var 的链接:两边都要 realpath 之后再比。
  assert.equal((await realpath(copied)).startsWith(await realpath(fixture.runtimes)), true);
});

// ---------------------------------------------------------------------------
// 按需安装第三方包(P4b:运行时内置,包不内置)
// ---------------------------------------------------------------------------

const ALL_PRESENT = '{"executable":"bundled","openpyxl":true,"pyarrow":true,"pandas":true}';
const NONE_PRESENT = '{"executable":"bundled","openpyxl":false,"pyarrow":false,"pandas":false}';

/** 一个记录 pip 调用的假运行器:seed 校验、依赖探测、pip 安装三种调用分开答。 */
function provisionRunner(options: { before: string; after: string; pipError?: Error }) {
  const calls: { args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
  let installed = false;
  const run = async (command: string, args: readonly string[], runOptions?: HostRunOptions): Promise<string> => {
    calls.push({ args, env: runOptions?.env });
    if (args[0] === "--version") return "Python 3.12.14\n";
    if (args[0] === "-c") return installed ? options.after : options.before;
    if (args[1] === "pip") {
      if (options.pipError) throw options.pipError;
      installed = true;
      return "Successfully installed pandas-2.3.3\n";
    }
    throw new Error(`unexpected: ${command} ${args.join(" ")}`);
  };
  return { calls, run, pipCalls: () => calls.filter((call) => call.args[1] === "pip") };
}

async function provisionService(runner: ReturnType<typeof provisionRunner>) {
  const fixture = await seedFixture();
  const service = new HostEnvironmentService({
    platform: "darwin",
    pythonVendorDirectory: fixture.vendor,
    runtimesDirectory: fixture.runtimes,
    env: { PATH: "/usr/bin" },
    run: runner.run,
  });
  return { fixture, service };
}

test("按需安装:pin 死版本、只收 wheel、走镜像,并且装进内置那份的目录", async () => {
  const runner = provisionRunner({ before: NONE_PRESENT, after: ALL_PRESENT });
  const { fixture, service } = await provisionService(runner);

  const result = await service.provisionPythonPackages();
  assert.equal(result.ok, true);
  assert.deepEqual(result.installed, ["pandas", "numpy", "pyarrow", "openpyxl"]);

  const pip = runner.pipCalls()[0];
  assert.ok(pip, "应当调用过 pip");
  assert.deepEqual(pip.args.slice(0, 2), ["-m", "pip"]);
  // 只收 wheel:没有预编译版本的包要现场编译,而 Wordless 不带编译工具链。
  assert.equal(pip.args.includes("--only-binary"), true);
  assert.equal(pip.args.includes(":all:"), true);
  assert.equal(pip.args.includes("--no-input"), true);
  // 版本 pin 死 —— 不 pin 就等于每次装的东西不一样。
  for (const requirement of ["pandas==2.3.3", "numpy==2.3.5", "pyarrow==22.0.0", "openpyxl==3.1.5"]) {
    assert.equal(pip.args.includes(requirement), true, `缺少 ${requirement}`);
  }
  // 镜像 + 缓存在我们自己的目录里(不往用户 home 丢东西)。
  assert.equal(pip.env?.PIP_INDEX_URL, "https://pypi.tuna.tsinghua.edu.cn/simple");
  assert.equal(pip.env?.PIP_TRUSTED_HOST, "pypi.tuna.tsinghua.edu.cn");
  assert.equal(pip.env?.PIP_CACHE_DIR, join(fixture.runtimes, "pip-cache"));
});

test("按需安装:已经装好了就不重复装(用户点第二次不该再下 56MB)", async () => {
  const runner = provisionRunner({ before: ALL_PRESENT, after: ALL_PRESENT });
  const { service } = await provisionService(runner);

  const result = await service.provisionPythonPackages();
  assert.deepEqual(result, { ok: true, installed: [] });
  assert.equal(runner.pipCalls().length, 0);
});

test("按需安装:失败时把 pip 的原话带回去,而不是只给一句安装失败", async () => {
  const runner = provisionRunner({ before: NONE_PRESENT, after: NONE_PRESENT, pipError: new Error("ERROR: Could not find a version that satisfies the requirement pyarrow==22.0.0") });
  const { service } = await provisionService(runner);

  const result = await service.provisionPythonPackages();
  assert.equal(result.ok, false);
  assert.deepEqual(result.installed, []);
  assert.match(result.message ?? "", /Could not find a version/);
});

test("按需安装:装完 import 不了 = 没装成(pip 说成功不算数)", async () => {
  const runner = provisionRunner({ before: NONE_PRESENT, after: NONE_PRESENT });
  const { service } = await provisionService(runner);

  const result = await service.provisionPythonPackages();
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /cannot be imported/);
});

test("按需安装:没有内置 Python 时给一句人话,不抛错", async () => {
  const service = new HostEnvironmentService({ platform: "darwin", run: provisionRunner({ before: NONE_PRESENT, after: ALL_PRESENT }).run });

  const result = await service.provisionPythonPackages();
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /No bundled Python/);
});
