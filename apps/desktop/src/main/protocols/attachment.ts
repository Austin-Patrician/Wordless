import { readFile } from "node:fs/promises";
import { protocol } from "electron";

const sessionIdPattern = /^[a-f0-9-]{36}$/i;
const previewPathPattern = /^\.attachments\/[a-f0-9-]{36}-[a-zA-Z0-9._-]{1,160}$/;

type AttachmentResolver = (sessionId: string, previewPath: string) => Promise<{ path: string; mimeType: string } | undefined>;

export function registerAttachmentProtocol(resolveAttachment: AttachmentResolver): void {
  protocol.handle("wordless-attachment", async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    const [sessionId, previewPath] = parts;
    if (url.hostname !== "preview" || parts.length !== 2 || !sessionIdPattern.test(sessionId ?? "") || !previewPathPattern.test(previewPath ?? "")) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const resolved = await resolveAttachment(sessionId!, previewPath!);
      if (!resolved) return new Response("Not found", { status: 404 });
      return new Response(await readFile(resolved.path), {
        headers: {
          "content-type": resolved.mimeType,
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
