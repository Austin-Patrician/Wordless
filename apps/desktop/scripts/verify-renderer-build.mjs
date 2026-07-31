import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const indexPath = resolve("dist/renderer/index.html");
const html = await readFile(indexPath, "utf8");
const rootAbsoluteAsset = /(?:src|href)=["']\/assets\//;
const relativeAsset = /(?:src|href)=["']\.\/assets\//;

if (rootAbsoluteAsset.test(html)) {
  throw new Error("Renderer build contains root-absolute /assets URLs that cannot load through Electron file:// pages");
}

if (!relativeAsset.test(html)) {
  throw new Error("Renderer build does not contain expected relative ./assets URLs");
}

console.log("Verified Electron-safe relative renderer asset URLs.");
