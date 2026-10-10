import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptsDirectory = new URL("../scripts/", import.meta.url);
const scriptPath = (name: string) => fileURLToPath(new URL(name, scriptsDirectory));

/**
 * 一份**形状正确**的 AppImage:文件本体 + deflate(块图) + 4 字节大端长度。
 * 这正是 electron-builder 的 `appendBlockmap` 追加的东西,electron-updater 也按这个布局去读
 * (`fileSize - (blockMapSize + 4)`)。
 */
function appImageFixture(payload: string) {
  const body = Buffer.from(payload);
  const blockMap = { version: "2", files: [{ name: "file", offset: 0, checksums: ["checksum"], sizes: [body.length] }] };
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(blockMap)));
  const sizeHeader = Buffer.allocUnsafe(4);
  sizeHeader.writeUInt32BE(compressed.length, 0);
  return { bytes: Buffer.concat([body, compressed, sizeHeader]), blockMapSize: compressed.length };
}

test("linux update metadata carries the embedded block map size", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-linux-update-manifest-"));
  try {
    const version = "1.2.3";
    const name = `Wordless-${version}-linux-x64.AppImage`;
    const { bytes, blockMapSize } = appImageFixture("appimage-payload");
    await writeFile(path.join(root, name), bytes);

    const output = path.join(root, "latest-linux.yml");
    await execFileAsync(process.execPath, [
      scriptPath("generate-linux-update-manifest.mjs"),
      "--release-dir", root,
      "--version", version,
      "--url-prefix", "v1.2.3",
      "--output", output,
    ]);

    const yaml = await readFile(output, "utf8");
    assert.match(yaml, /version: 1\.2\.3/);
    assert.match(yaml, new RegExp(`url: v1\\.2\\.3/${name.replaceAll(".", "\\.")}`));
    assert.match(yaml, new RegExp(`path: v1\\.2\\.3/${name.replaceAll(".", "\\.")}`));
    assert.match(yaml, new RegExp(`size: ${String(bytes.length)}`));
    // 少了这一行不会报错,但差分更新会退化成全量下载 —— 所以它必须被钉住。
    assert.match(yaml, new RegExp(`blockMapSize: ${String(blockMapSize)}`));
    assert.ok(yaml.includes(createHash("sha512").update(bytes).digest("base64")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("linux update metadata rejects an AppImage without an embedded block map", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-linux-update-manifest-bad-"));
  try {
    // 一个"看起来像 AppImage"但尾部没有块图的文件:与其让用户在差分下载时炸,不如在这里红。
    await writeFile(path.join(root, "Wordless-1.2.3-linux-x64.AppImage"), "not-an-appimage");
    await assert.rejects(
      execFileAsync(process.execPath, [
        scriptPath("generate-linux-update-manifest.mjs"),
        "--release-dir", root,
        "--version", "1.2.3",
        "--output", path.join(root, "latest-linux.yml"),
      ]),
      /embedded block map/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update manifests use the immutable version directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-update-manifests-"));
  try {
    const artifacts = new Map([
      ["Wordless-1.2.3-mac-arm64.zip", "mac-arm64-zip"],
      ["Wordless-1.2.3-mac-x64.zip", "mac-x64-zip"],
      ["Wordless-1.2.3-mac-arm64.dmg", "mac-arm64-dmg"],
      ["Wordless-1.2.3-mac-x64.dmg", "mac-x64-dmg"],
      ["Wordless-1.2.3-win-x64.exe", "windows-exe"],
    ]);
    await Promise.all([...artifacts].map(([name, contents]) => writeFile(path.join(root, name), contents)));

    const windowsOutput = path.join(root, "latest.yml");
    const macOutput = path.join(root, "latest-mac.yml");
    await execFileAsync(process.execPath, [
      new URL("generate-windows-update-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", root,
      "--version", "1.2.3",
      "--url-prefix", "v1.2.3",
      "--output", windowsOutput,
    ]);
    await execFileAsync(process.execPath, [
      new URL("generate-mac-update-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", root,
      "--version", "1.2.3",
      "--url-prefix", "v1.2.3",
      "--output", macOutput,
    ]);

    const windows = await readFile(windowsOutput, "utf8");
    const mac = await readFile(macOutput, "utf8");
    assert.match(windows, /url: v1\.2\.3\/Wordless-1\.2\.3-win-x64\.exe/);
    assert.match(windows, /path: v1\.2\.3\/Wordless-1\.2\.3-win-x64\.exe/);
    assert.ok(windows.includes(createHash("sha512").update("windows-exe").digest("base64")));
    for (const name of [...artifacts.keys()].filter((name) => /mac/.test(name))) {
      assert.match(mac, new RegExp(`url: v1\\.2\\.3/${name.replaceAll(".", "\\.")}`));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest exposes only objects that exist in version directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-release-manifest-"));
  try {
    const releaseDirectory = path.join(root, "release");
    await mkdir(releaseDirectory);
    const currentName = "Wordless-1.2.3-win-x64.exe";
    const checksumName = "SHA256SUMS.txt";
    await writeFile(path.join(releaseDirectory, currentName), "current-installer");
    await writeFile(path.join(releaseDirectory, checksumName), "checksum-data");

    const githubReleases = [
      {
        tag_name: "v1.2.3",
        name: "Wordless 1.2.3",
        draft: false,
        prerelease: false,
        assets: [
          { name: currentName, size: 17, browser_download_url: `https://github.invalid/${currentName}` },
          { name: checksumName, size: 13, browser_download_url: `https://github.invalid/${checksumName}` },
        ],
      },
      {
        tag_name: "v1.2.2",
        name: "Wordless 1.2.2",
        draft: false,
        prerelease: false,
        assets: [
          { name: "Wordless-1.2.2-win-x64.exe", size: 10, browser_download_url: "https://github.invalid/old.exe" },
        ],
      },
      {
        tag_name: "v1.2.1",
        name: "Wordless 1.2.1",
        draft: false,
        prerelease: false,
        assets: [
          { name: "Wordless-1.2.1-win-x64.exe", size: 10, browser_download_url: "https://github.invalid/legacy.exe" },
        ],
      },
    ];
    const githubPath = path.join(root, "github-releases.json");
    const objectsPath = path.join(root, "r2-objects.json");
    const outputPath = path.join(root, "releases.json");
    await writeFile(githubPath, JSON.stringify(githubReleases));
    await writeFile(objectsPath, JSON.stringify({ Contents: [
      { Key: `releases/v1.2.3/${currentName}` },
      { Key: `releases/v1.2.3/${checksumName}` },
      { Key: "releases/v1.2.2/Wordless-1.2.2-win-x64.exe" },
      { Key: "releases/Wordless-1.2.1-win-x64.exe" },
    ] }));

    await execFileAsync(process.execPath, [
      new URL("generate-release-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", releaseDirectory,
      "--github-releases", githubPath,
      "--r2-objects", objectsPath,
      "--output", outputPath,
      "--public-base-url", "https://download.example/releases",
      "--current-tag", "v1.2.3",
    ]);

    const manifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(manifest.releases[0].assets[0].urls, [
      `https://download.example/releases/v1.2.3/${currentName}`,
      `https://github.invalid/${currentName}`,
    ]);
    assert.deepEqual(manifest.releases[1].assets[0].urls, [
      "https://download.example/releases/v1.2.2/Wordless-1.2.2-win-x64.exe",
      "https://github.invalid/old.exe",
    ]);
    assert.deepEqual(manifest.releases[2].assets[0].urls, ["https://github.invalid/legacy.exe"]);
    assert.equal(manifest.releases[0].assets[0].sha256, createHash("sha256").update("current-installer").digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 命名契约:上游产物名与下游的三处假设必须是**同一个字符串**。
 *
 * v0.7.2 就是因为它们分叉了才发不出去 —— electron-builder 在 Linux 上把 `${arch}` 展开成
 * **发行版架构名**(x64 在 AppImage/rpm 上是 `x86_64`、在 deb 上是 `amd64`,arm64 是 `arm_aarch64`),
 * 而 workflow 的 glob、R2 清单和这里的脚本都按 `-linux-x64-` 找文件:三个二进制一个都没上传,
 * 构建却报成功,一路等到 R2 镜像那一步才炸。
 *
 * 这条测试把"改了一处忘了另一处"变成测试里的红,而不是发布时的红。
 */
test("linux artifact naming is pinned once and every consumer agrees", async () => {
  const desktopRoot = new URL("../", import.meta.url);
  const builderConfig = await readFile(new URL("electron-builder.yml", desktopRoot), "utf8");
  const workflow = await readFile(new URL("../../../.github/workflows/release-desktop.yml", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("package.json", desktopRoot), "utf8")) as {
    scripts: Record<string, string>;
  };

  // ① `linux:` 段里必须**显式**钉住产物名
  const lines = builderConfig.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "linux:");
  assert.notEqual(start, -1, "electron-builder.yml 里找不到 linux: 段");
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(line)) break; // 下一个顶层键
    block.push(line);
  }
  const artifactName = block
    .map((line) => /^\s+artifactName:\s*(\S+)\s*$/.exec(line)?.[1])
    .find((value): value is string => Boolean(value));
  assert.ok(artifactName, "linux: 段里必须显式写 artifactName —— 依赖默认值正是这次的坑");
  // `${arch}` 在 Linux 上不是 electron-builder 的内部名,写它就等于把名字交给那张按目标而定的映射表。
  assert.doesNotMatch(artifactName, /\$\{arch\}/);

  // ② 产物名里的架构 token 必须与 `dist:linux` 实际构建的架构一致
  const archFlag = /--(x64|arm64|ia32|armv7l)\b/.exec(manifest.scripts["dist:linux"] ?? "")?.[1];
  assert.ok(archFlag, "dist:linux 必须显式写架构");
  const token = /-linux-([a-z0-9_]+)\.\$\{ext\}$/.exec(artifactName)?.[1];
  assert.equal(
    token,
    archFlag,
    `产物名里的架构 token(${token ?? "缺失"})与 dist:linux 构建的架构(${archFlag})不一致 —— 改了架构就要同时改名字`,
  );

  // ③ 下游**三处**必须认同同一个 token —— 而且断言要盯住"具体那一处"。
  //
  // 这里踩过一次:第一版写的是 `workflow.includes("…-linux-x64.deb")`,结果**上面那个守卫步骤**
  // 里的同一个字符串就把断言满足了 —— 于是从上传 glob 里删掉 `.deb` 也照样绿。这正是原来那个
  // bug 的形状(守卫被错误的东西满足),所以每一处单独切出来断言。
  const sectionBetween = (start: string, end: string): string => {
    const from = workflow.indexOf(start);
    assert.notEqual(from, -1, `workflow 里找不到 ${start}`);
    const to = workflow.indexOf(end, from);
    assert.notEqual(to, -1, `workflow 里找不到 ${start} 之后的 ${end}`);
    return workflow.slice(from, to);
  };
  const guardLine = workflow.split("\n").find((line) => line.trimStart().startsWith("for name in"));
  assert.ok(guardLine, "找不到逐个断言 Linux 二进制的守卫步骤");
  const uploadGlobs = sectionBetween("name: wordless-linux-x64", "if-no-files-found:");
  const r2List = sectionBetween("files=(", ")");
  for (const extension of ["AppImage", "deb", "rpm"]) {
    // 构建期守卫:少了它,"三个二进制全缺"会在 upload-artifact 那里报成功(v0.7.2 就是这样)。
    assert.ok(guardLine.includes(`-linux-${archFlag}.${extension}`), `守卫没盯住 ${extension}`);
    // 上传 glob:少了它,二进制进不了 workflow 产物 → 也就进不了 release。
    assert.ok(uploadGlobs.includes(`Wordless-*-linux-${archFlag}.${extension}`), `上传 glob 缺少 ${extension}`);
    // R2 清单:少了它,镜像那一步会 `stat` 不到文件。
    assert.ok(r2List.includes(`Wordless-\${VERSION}-linux-${archFlag}.${extension}`), `R2 清单缺少 ${extension}`);
  }

  // ④ 把模板真正产出的名字喂给脚本 —— 名字对不上时这里红,而不是发布时红
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-linux-naming-"));
  try {
    const artifact = artifactName.replace("${version}", "1.2.3").replace("${ext}", "AppImage");
    const { bytes } = appImageFixture("appimage-payload");
    await writeFile(path.join(root, artifact), bytes);
    const output = path.join(root, "latest-linux.yml");
    await execFileAsync(process.execPath, [
      scriptPath("generate-linux-update-manifest.mjs"),
      "--release-dir", root,
      "--version", "1.2.3",
      "--output", output,
    ]);
    assert.match(await readFile(output, "utf8"), new RegExp(`path: ${artifact.replaceAll(".", "\\.")}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
