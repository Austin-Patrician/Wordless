import { readFile } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const MINIMUM_WINDOWS_ICON_PX = 256;

export function parseIco(buffer) {
  if (buffer.length < 6 || buffer[0] !== 0 || buffer[1] !== 0 || buffer[2] !== 1 || buffer[3] !== 0) {
    throw new Error("Icon is not a valid ICO file");
  }
  const count = buffer.readUInt16LE(4);
  const images = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > buffer.length) throw new Error("ICO directory is truncated");
    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    const bytes = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    const payload = buffer.subarray(imageOffset, imageOffset + bytes);
    images.push({
      width,
      height,
      bytes,
      imageOffset,
      png: payload.subarray(0, 4).equals(PNG_SIGNATURE),
    });
  }
  return { count, images, maxSize: images.reduce((max, image) => Math.max(max, image.width, image.height), 0) };
}

export function assertWindowsIcon(buffer, path) {
  const icon = parseIco(buffer);
  if (icon.maxSize < MINIMUM_WINDOWS_ICON_PX) {
    throw new Error(`Windows icon must include a ${MINIMUM_WINDOWS_ICON_PX}x${MINIMUM_WINDOWS_ICON_PX} image: ${path}`);
  }
  return icon;
}

export async function readWindowsIcon(path) {
  return assertWindowsIcon(await readFile(path), path);
}

export function isElectronDefaultExeIcon(icons) {
  if (icons.length === 0) return true;
  return !icons.some((icon) => icon.png && icon.bytes >= 50_000);
}
