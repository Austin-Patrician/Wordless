import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizePresentationOperations, OfficeCliService, officeCliResourcePlatform, presentationAssetUrl } from "../src/main/office/office-cli-service.ts";

const sessionId = "0d9cd4bf-56ce-4357-a69a-4dd26fd742cd";
const artifactId = "a601a30f-0a86-4161-a01a-311951217b13";

test("uses platform-neutral resource names and encoded presentation asset URLs", () => {
  assert.equal(officeCliResourcePlatform("darwin"), "mac");
  assert.equal(officeCliResourcePlatform("win32"), "win");
  assert.equal(officeCliResourcePlatform("linux"), "linux");
  assert.equal(
    presentationAssetUrl(sessionId, artifactId, 3, "slide 1.png"),
    `wordless-presentation://preview/${sessionId}/${artifactId}/3/slide%201.png`,
  );
});

test("normalizes legacy presentation operations into OfficeCLI batch commands", () => {
  assert.deepEqual(normalizePresentationOperations([
    { op: "add", path: "/slides", props: { type: "slide", title: "Overview" } },
    { op: "set", path: "/slide[1]", props: { background: "#FFFFFF" } },
    { op: "move", path: "/slide[2]", props: { after: "/slide[1]" } },
    { op: "swap", path: "/slide[1]", props: { path2: "/slide[2]" } },
  ]), [
    { command: "add", parent: "/", type: "slide", props: { title: "Overview" } },
    { command: "set", path: "/slide[1]", props: { background: "#FFFFFF" } },
    { command: "move", path: "/slide[2]", after: "/slide[1]" },
    { command: "swap", path: "/slide[1]", path2: "/slide[2]" },
  ]);
  assert.throws(() => normalizePresentationOperations([{ command: "add", parent: "/" }]), /add requires type or from/);
});

test("normalizes REST-style slide paths and legacy background properties", () => {
  assert.deepEqual(normalizePresentationOperations([
    { command: "set", path: "/slides/1", props: { backgroundFill: "solid", backgroundFillColor: "#0A1628" } },
    { command: "add", parent: "/slides/1", type: "shape", props: { geometry: "rect", left: "0", top: "0", width: "1280", height: "720", fill: "#0A1628" } },
    { command: "move", path: "/slides/2/shapes/1", after: "/slides/1/shapes/2" },
  ]), [
    { command: "set", path: "/slide[1]", props: { background: "#0A1628" } },
    { command: "add", parent: "/slide[1]", type: "shape", props: { geometry: "rect", left: "0", top: "0", width: "1280", height: "720", fill: "#0A1628" } },
    { command: "move", path: "/slide[2]/shape[1]", after: "/slide[1]/shape[2]" },
  ]);
});

test("exposes OfficeCLI templates and reads persisted presentation artifacts without a binary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-officecli-"));
  try {
    const service = new OfficeCliService({ artifactsRoot: root });
    const templates = service.listTemplates();
    assert.equal(templates[0]?.id, "auto");
    assert.deepEqual(templates.map((template) => template.id), ["auto", "blank", "aura-coffee", "aura-coffee-dark", "aionui-promo", "attention-budget"]);

    await mkdir(path.join(root, sessionId), { recursive: true });
    await writeFile(path.join(root, sessionId, "manifest.json"), JSON.stringify({
      version: 1,
      artifacts: [{
        id: artifactId,
        sessionId,
        kind: "presentation",
        sourcePath: "market-review.pptx",
        displayName: "market-review.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        revision: 2,
        status: "ready",
        capabilities: ["preview", "select", "validate", "export", "open"],
        updatedAt: 1,
      }],
    }), "utf8");

    assert.deepEqual(await service.list(sessionId), [{
      id: artifactId,
      sessionId,
      kind: "presentation",
      sourcePath: "market-review.pptx",
      displayName: "market-review.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      revision: 2,
      status: "ready",
      capabilities: ["preview", "select", "validate", "export", "open"],
      updatedAt: 1,
    }]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
