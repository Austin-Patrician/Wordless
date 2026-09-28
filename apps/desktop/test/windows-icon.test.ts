import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindowsIcon,
  isElectronDefaultExeIcon,
  parseIco,
} from "../scripts/windows-icon.mjs";

const iconPath = resolve(dirname(fileURLToPath(import.meta.url)), "../build/icon.ico");

test("build/icon.ico is a valid Windows icon with a 256px image", () => {
  const icon = assertWindowsIcon(readFileSync(iconPath), iconPath);
  assert.equal(icon.count, 7);
  assert.equal(icon.maxSize, 256);
  assert.ok(icon.images.every((image) => image.png));
});

test("rejects truncated or non-ICO bytes", () => {
  assert.throws(() => parseIco(Buffer.from("not-an-icon")), /not a valid ICO/);
});

test("detects the default Electron exe icon fingerprint", () => {
  assert.equal(
    isElectronDefaultExeIcon([
      { bytes: 1320, png: false },
      { bytes: 5160, png: false },
      { bytes: 11560, png: false },
      { bytes: 18963, png: true },
    ]),
    true,
  );
  assert.equal(
    isElectronDefaultExeIcon([{ bytes: 115480, png: true }]),
    false,
  );
});

test("accepts a flat vector brand icon that compresses far below the old 50 kB threshold", () => {
  // The brand icon is drawn from an SVG, so its frames are a few hundred bytes
  // each. This used to be reported as the Electron default.
  assert.equal(
    isElectronDefaultExeIcon([
      { bytes: 562, png: true },
      { bytes: 1165, png: true },
      { bytes: 5833, png: true },
      { bytes: 12864, png: true },
    ]),
    false,
  );
});
