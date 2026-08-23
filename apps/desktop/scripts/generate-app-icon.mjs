import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const sourcePath = resolve(appRoot, "src/icons/common-icons/wordless.jpeg");
const pngPath = resolve(appRoot, "src/icons/common-icons/wordless.png");
const icoPath = resolve(appRoot, "build/icon.ico");
const iconSizes = [16, 24, 32, 48, 64, 128, 256];
const previewSize = 1024;

async function renderIcon(size) {
  return sharp(sourcePath, { failOn: "error" })
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  const payloads = [];
  for (const [index, image] of images.entries()) {
    const entryOffset = index * 16;
    const sizeByte = image.size === 256 ? 0 : image.size;
    directory[entryOffset] = sizeByte;
    directory[entryOffset + 1] = sizeByte;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.data.byteLength, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    payloads.push(image.data);
    offset += image.data.byteLength;
  }
  return Buffer.concat([header, directory, ...payloads]);
}

export async function generateAppIcon() {
  const images = await Promise.all(iconSizes.map(async (size) => ({ size, data: await renderIcon(size) })));
  await mkdir(dirname(pngPath), { recursive: true });
  await mkdir(dirname(icoPath), { recursive: true });
  await writeFile(pngPath, await renderIcon(previewSize));
  await writeFile(icoPath, buildIco(images));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await generateAppIcon();
}
