import { readFile } from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";

const assetFileName = /^[a-f0-9]{64}\.(gif|jpe?g|png|webp)$/i;
const sessionId = /^[a-f0-9-]{36}$/i;

export function mediaAssetUrl(projectId: string, fileName: string): string {
  return `wordless-media://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`;
}

export function registerMediaProtocol(mediaAssetsRoot: string): void {
  protocol.handle("wordless-media", (request) => {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    const [projectId, fileName] = pathParts;
    if (url.hostname !== "asset" || pathParts.length !== 2 || !projectId || !fileName || !sessionId.test(projectId) || !assetFileName.test(fileName)) {
      return new Response("Not found", { status: 404 });
    }
    const source = path.join(mediaAssetsRoot, projectId, fileName);
    return readFile(source)
      .then((data) => new Response(data, { headers: { "access-control-allow-origin": "*", "content-type": mimeType(fileName) } }))
      .catch(() => new Response("Not found", { status: 404 }));
  });
}

function mimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}
