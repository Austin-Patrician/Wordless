import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { protocol } from "electron";
import type { DesktopDataAnalysisService } from "../data-analysis/data-analysis-service";

const identifier = /^[a-f0-9-]{36}$/i;

export function registerAnalysisProtocol(service: DesktopDataAnalysisService): void {
  protocol.handle("wordless-analysis", async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [sessionId, analysisId, ...fileParts] = parts;
    if (url.hostname !== "output" || !sessionId || !analysisId || fileParts.length === 0 || !identifier.test(sessionId) || !identifier.test(analysisId)) return new Response("Not found", { status: 404 });
    try {
      const source = await service.resolveProtocolOutput(sessionId, analysisId, fileParts.join("/"));
      const extension = extname(source).toLowerCase();
      const contentType = extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : "application/octet-stream";
      return new Response(await readFile(source), { headers: { "access-control-allow-origin": "*", "content-type": contentType, "x-content-type-options": "nosniff" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
