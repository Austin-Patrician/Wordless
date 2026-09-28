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

/**
 * Electron's default app icon, fingerprinted by the byte size of its four
 * frames: three uncompressed DIB frames plus one PNG `256`. These are exact
 * constants of the shipped `electron.exe`, not a heuristic.
 *
 * The previous rule ("no PNG frame of at least 50 kB") only worked because the
 * brand icon used to be rendered from a 4096px JPEG, whose flat-photo `256`
 * frame compressed to 127 kB. A flat vector brand compresses to well under
 * 50 kB, so that rule reported a correctly branded exe as "still the default
 * icon" and failed the Windows release.
 */
const ELECTRON_DEFAULT_ICON_FRAME_BYTES = new Set([1320, 5160, 11560, 18963]);

export function isElectronDefaultExeIcon(icons) {
  if (icons.length === 0) return true;
  return icons.length <= ELECTRON_DEFAULT_ICON_FRAME_BYTES.size && icons.every((icon) => ELECTRON_DEFAULT_ICON_FRAME_BYTES.has(icon.bytes));
}
