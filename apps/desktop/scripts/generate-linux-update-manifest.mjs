import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * 生成 Linux 的 electron-updater 清单(`latest-linux.yml`)。
 *
 * 与 mac/win 那两个生成器的差别只有一个:**AppImage 的块图内嵌在文件尾部**。
 * electron-builder 追加的顺序是 `[文件本体][deflate(块图 JSON)][uint32 BE 压缩后长度]`,并把最后
 * 那个长度当作 `blockMapSize` 交给更新清单;electron-updater 用它算
 * `fileSize - (blockMapSize + 4)` 去读块图做差分下载(见 `FileWithEmbeddedBlockMapDifferentialDownloader`)。
 * 清单里少这个字段**不会报错**,差分更新会静默退化成每次全量下载 —— AppImage 上百 MB,所以这里
 * 把它补上,并且当场把那段字节解出来验证"它真的是一份块图"。
 *
 * **只登记 AppImage**:Linux 上 electron-updater 只支持 AppImage 自更新
 * (`AppImageUpdater.isUpdaterActive()` 在 `APPIMAGE` 环境变量缺席时直接返回 false)。
 * deb/rpm 照常随 GitHub Release 与 R2 发布,只是不进更新清单。
 *
 * 决策与真机验收项见 `docs/architecture/linux-release.md` §2 与 §3 D1。
 */

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}`);
  return process.argv[index + 1];
}

function optionalArgument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index < 0 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

async function sha512File(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

/**
 * 读尾部内嵌的块图,返回它的压缩长度(`blockMapSize`)。
 *
 * 结尾 4 字节是**压缩后**块图的长度(electron-updater 用同一个数字定位),块图本身是
 * `deflateRawSync` 出来的裸 deflate 流。两边都校验:长度越界或解不出一份带 files 的块图,
 * 都说明这个文件不是 electron-builder 打出来的 AppImage(或者打包后被人改过)。
 */
async function embeddedBlockMapSize(filePath, fileSize) {
  const handle = await open(filePath, "r");
  try {
    const sizeBuffer = Buffer.allocUnsafe(4);
    const sizeRead = await handle.read(sizeBuffer, 0, sizeBuffer.length, fileSize - sizeBuffer.length);
    if (sizeRead.bytesRead !== sizeBuffer.length) throw new Error("cannot read the embedded block map length");
    const blockMapSize = sizeBuffer.readUInt32BE(0);
    if (!Number.isSafeInteger(blockMapSize) || blockMapSize <= 0 || blockMapSize >= fileSize - sizeBuffer.length) {
      throw new Error(`the embedded block map length (${String(blockMapSize)}) is not plausible for a ${String(fileSize)} byte file`);
    }
    const compressed = Buffer.allocUnsafe(blockMapSize);
    const blockMapRead = await handle.read(compressed, 0, compressed.length, fileSize - sizeBuffer.length - blockMapSize);
    if (blockMapRead.bytesRead !== compressed.length) throw new Error("cannot read the embedded block map");
    const blockMap = JSON.parse(inflateRawSync(compressed).toString("utf8"));
    if (!blockMap || typeof blockMap !== "object" || !Array.isArray(blockMap.files) || blockMap.files.length === 0) {
      throw new Error("the embedded block map does not contain any files");
    }
    return blockMapSize;
  } finally {
    await handle.close();
  }
}

const releaseDirectory = path.resolve(argument("--release-dir"));
const version = argument("--version").replace(/^v/i, "");
const outputPath = path.resolve(argument("--output"));
const urlPrefix = optionalArgument("--url-prefix").replace(/^\/+|\/+$/g, "");
const artifactUrl = (name) => (urlPrefix ? `${urlPrefix}/${name}` : name);
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const artifactPattern = new RegExp(`^Wordless-${escapedVersion}-linux-(?:arm64|x64)\\.AppImage$`, "i");
const names = (await readdir(releaseDirectory)).filter((name) => artifactPattern.test(name)).sort();
if (names.length !== 1) {
  throw new Error(`Expected exactly one Linux AppImage update artifact for ${version}, found ${names.length}${names.length ? ` (${names.join(", ")})` : ""}`);
}

const name = names[0];
const filePath = path.join(releaseDirectory, name);
const fileStat = await stat(filePath);
if (!fileStat.isFile()) throw new Error(`${name} is not a file`);

const sha512 = await sha512File(filePath);
const blockMapSize = await embeddedBlockMapSize(filePath, fileStat.size);
const lines = [
  `version: ${version}`,
  "files:",
  `  - url: ${artifactUrl(name)}`,
  `    sha512: ${sha512}`,
  `    size: ${fileStat.size}`,
  `    blockMapSize: ${blockMapSize}`,
  `path: ${artifactUrl(name)}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
];
await writeFile(outputPath, lines.join("\n"), "utf8");
