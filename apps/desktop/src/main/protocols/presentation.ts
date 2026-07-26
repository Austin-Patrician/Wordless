import { readFile } from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";

const sessionId = /^[a-f0-9-]{36}$/i;
const artifactId = /^[a-f0-9-]{36}$/i;
const previewName = /^(?:deck\.html|slide-[0-9]+\.png)$/;

export function registerPresentationProtocol(artifactsRoot: string): void {
  protocol.handle("wordless-presentation", (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [session, artifact, revision, fileName] = parts;
    if (url.hostname !== "preview" || parts.length !== 4 || !session || !artifact || !revision || !fileName || !sessionId.test(session) || !artifactId.test(artifact) || !/^\d+$/.test(revision) || !previewName.test(fileName)) {
      return new Response("Not found", { status: 404 });
    }
    const source = path.join(artifactsRoot, session, artifact, revision, fileName);
    return readFile(source)
      .then((data) => new Response(data, { headers: { "content-type": fileName.endsWith(".png") ? "image/png" : "text/html; charset=utf-8", "x-content-type-options": "nosniff" } }))
      .catch(() => new Response("Not found", { status: 404 }));
  });
}
