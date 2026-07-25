import { readFile } from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";

const assetFileName = /^[a-f0-9]{64}\.(jpg|png|webp)$/i;

function mimeType(fileName: string): string {
  if (fileName.endsWith(".jpg")) return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export function registerAppearanceProtocol(backgroundsRoot: string): void {
  protocol.handle("wordless-appearance", (request) => {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    const [fileName] = pathParts;
    if (url.hostname !== "background" || pathParts.length !== 1 || !fileName || !assetFileName.test(fileName)) return new Response("Not found", { status: 404 });
    const source = path.join(backgroundsRoot, fileName);
    return readFile(source)
      .then((data) => new Response(data, { headers: { "cache-control": "public, max-age=31536000, immutable", "content-type": mimeType(fileName), "x-content-type-options": "nosniff" } }))
      .catch(() => new Response("Not found", { status: 404 }));
  });
}
