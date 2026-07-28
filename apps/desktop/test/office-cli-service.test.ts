import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.deepEqual(templates.map((template) => template.id), [
      "auto",
      "blank",
      "aura-coffee",
      "aura-coffee-dark",
      "future-2050",
      "cat-philosophy",
      "cat-secret-life",
      "feline-report",
      "aionui-promo",
      "geminicli-timetravel",
      "attention-budget",
      "alien-guide",
      "mars-settlement",
      "space-exploration",
      "time-travel",
      "wildlife-company",
    ]);

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

    const sources = await service.registerSources(sessionId, artifactId, [{
      url: "https://example.com/research",
      title: "Research source",
      slideNumbers: [2, 1, 2],
    }]);
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0]?.slideNumbers, [1, 2]);
    await assert.rejects(
      service.registerSources(sessionId, artifactId, [{ url: "http://127.0.0.1/private", title: "Private", slideNumbers: [1] }]),
      /Unsafe presentation source URL/,
    );
    const migrated = JSON.parse(await readFile(path.join(root, sessionId, "manifest.json"), "utf8")) as { version: number; presentation: Record<string, { sources: unknown[] }> };
    assert.equal(migrated.version, 3);
    assert.equal(migrated.presentation[artifactId]?.sources.length, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("creates and atomically edits spreadsheet artifacts with the bundled OfficeCLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-spreadsheet-"));
  const workspaceRoot = path.join(root, "workspace");
    const resourcePlatform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
    const binaryPath = path.resolve("resources", "officecli", `${resourcePlatform}-${process.arch}`, process.platform === "win32" ? "officecli.exe" : "officecli");
  try {
    await mkdir(workspaceRoot, { recursive: true });
    const service = new OfficeCliService({ artifactsRoot: path.join(root, "artifacts"), binaryPath });
    const artifact = await service.createSpreadsheet(sessionId, workspaceRoot, { name: "quarterly-plan.xlsx", locale: "en-US" });
    assert.equal(artifact.kind, "spreadsheet");
    assert.equal(artifact.revision, 1);

    const updated = await service.applySpreadsheet(sessionId, workspaceRoot, artifact.id, [
      { command: "set", path: "/Sheet1/A1", props: { value: "Revenue", "font.bold": true } },
      { command: "set", path: "/Sheet1/B1", props: { value: 120 } },
    ]);
    assert.equal(updated.revision, 2);
    assert.match(await service.readSpreadsheet(sessionId, workspaceRoot, artifact.id, { kind: "get", path: "/Sheet1/A1" }), /Revenue/);
    const report = await service.qualityScanSpreadsheet(sessionId, workspaceRoot, artifact.id);
    assert.equal(report.revision, 2);
    assert.notEqual(report.status, "needs-fix");

    await assert.rejects(service.applySpreadsheet(sessionId, workspaceRoot, artifact.id, [
      { command: "set", path: "/MissingSheet/A1", props: { value: "invalid" } },
    ]));
    assert.match(await service.readSpreadsheet(sessionId, workspaceRoot, artifact.id, { kind: "get", path: "/Sheet1/A1" }), /Revenue/);
    assert.equal((await service.spreadsheetChanges(sessionId, artifact.id)).length, 1);
    await service.dispose();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
