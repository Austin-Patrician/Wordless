import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DesktopDataAnalysisService } from "../src/main/data-analysis/data-analysis-service.ts";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("data analysis service inspects, validates, publishes, and restores a CSV analysis", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-service-"));
  try {
    const workspace = join(root, "workspace");
    const metadataRoot = join(root, "metadata");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "分组,数值\n一,10\n二,20\n", "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot, resourcesRoot: join(appRoot, "resources") });
    const inspected = await service.inspect("11111111-1111-4111-8111-111111111111", workspace, { paths: ["sales.csv"], title: "Sales" });
    assert.equal(inspected.datasets[0]?.datasets[0]?.rows, 2);
    assert.deepEqual(inspected.datasets[0]?.datasets[0]?.columns.map((column) => column.name), ["分组", "数值"]);
    const output = join(workspace, inspected.outputRoot);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "analysis-manifest.json"), JSON.stringify({
      version: 1,
      title: "Sales",
      objective: "Summarize sales.",
      inputs: [{ path: "sales.csv", rows: 2, grain: "one row" }],
      methods: [{ name: "summary", purpose: "Summarize", assumptions: "Rows are observations" }],
      findings: [{ title: "Total", statement: "The total is 30.", evidence: "10 + 20 = 30" }],
      charts: [],
      validation: [{ name: "total", status: "passed", detail: "Reconciled" }],
    }, null, 2), "utf8");
    const validated = await service.validate("11111111-1111-4111-8111-111111111111", workspace, inspected.id);
    assert.equal(validated.status, "validated");
    const published = await service.publish("11111111-1111-4111-8111-111111111111", workspace, inspected.id);
    assert.equal(published.status, "published");
    assert.match(await readFile(join(output, "analysis-report.md"), "utf8"), /# Sales/);
    const restored = await service.snapshot("11111111-1111-4111-8111-111111111111", workspace);
    assert.equal(restored.runs[0]?.status, "published");
    await writeFile(join(output, "analysis-report.md"), "# Updated sales report\n", "utf8");
    const updated = await service.snapshot("11111111-1111-4111-8111-111111111111", workspace);
    assert.equal(updated.runs[0]?.reportContent, "# Updated sales report\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("data analysis service discovers shell-generated analysis output and restores bounded source previews", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-discovery-"));
  try {
    const workspace = join(root, "workspace");
    const output = join(workspace, "analysis-output", "manual-analysis");
    await mkdir(output, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "group,value\none,10\ntwo,20\n", "utf8");
    await writeFile(join(output, "analysis-manifest.json"), JSON.stringify({
      version: 1,
      title: "Manual sales analysis",
      objective: "Summarize sales.",
      inputs: [{ path: "../../sales.csv", format: "csv", rows: 2 }],
      methods: [],
      findings: [],
      charts: [],
      validation: [],
    }), "utf8");
    await writeFile(join(output, "analysis-report.md"), "# Manual sales analysis\n", "utf8");
    await mkdir(join(output, "research", "source-cache"), { recursive: true });
    await writeFile(join(output, "research", "source-cache", "source.md"), "# Source\n", "utf8");
    await writeFile(join(output, "research", "evidence.json"), JSON.stringify({ version: 1, mode: "quick", objective: "Verify context", questions: ["Why?"], dimensions: [{ id: "context", name: "Context", question: "Why?", status: "ready", claimCount: 1, sourceCount: 1 }], sources: [{ id: "source-one", url: "https://example.com/", title: "Example", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/source.md", contentHash: "source", sourceType: "web" }], claims: [{ id: "context.c1", dimensionId: "context", statement: "External context changed.", kind: "external", evidenceRefs: ["source-one"], confidence: "medium", caveats: [] }], conflicts: [] }), "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot: join(root, "metadata"), resourcesRoot: join(appRoot, "resources") });
    const snapshot = await service.snapshot("22222222-2222-4222-8222-222222222222", workspace);
    assert.equal(snapshot.runs[0]?.status, "published");
    assert.equal(snapshot.runs[0]?.datasets[0]?.datasets[0]?.rows, 2);
    assert.deepEqual(snapshot.runs[0]?.datasets[0]?.datasets[0]?.sample[0], { group: "one", value: "10" });
    assert.equal(snapshot.runs[0]?.research?.status, "ready");
    assert.equal(snapshot.runs[0]?.research?.claims[0]?.id, "context.c1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("data analysis service preserves a verified data result when research is blocked", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-research-blocked-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "group,value\none,10\ntwo,20\n", "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot: join(root, "metadata"), resourcesRoot: join(appRoot, "resources") });
    const inspected = await service.inspect("33333333-3333-4333-8333-333333333333", workspace, { paths: ["sales.csv"], title: "Sales" });
    const prepared = await service.prepareResearch("33333333-3333-4333-8333-333333333333", workspace, {
      analysisId: inspected.id,
      mode: "normal",
      objective: "Explain the observed change",
      questions: ["What external factors explain it?"],
      dimensions: [{ id: "drivers", name: "External drivers", question: "What explains the change?" }],
    });
    assert.equal(prepared.run.research?.status, "awaiting-confirmation");
    await assert.rejects(() => service.snapshotResearchSource("33333333-3333-4333-8333-333333333333", workspace, { analysisId: inspected.id, dimensionId: "drivers", url: "https://example.com/source" }), /confirmed and started/);
    await assert.rejects(() => service.startResearch("33333333-3333-4333-8333-333333333333", workspace, { analysisId: inspected.id, confirmationToken: "not-the-token", webResearchAvailable: true }), /confirmation is missing or expired/);
    const blocked = await service.startResearch("33333333-3333-4333-8333-333333333333", workspace, { analysisId: inspected.id, confirmationToken: prepared.confirmationToken, webResearchAvailable: false });
    assert.equal(blocked.research?.status, "blocked");
    assert.equal(blocked.datasets[0]?.path, "sales.csv");
    const restored = await service.snapshot("33333333-3333-4333-8333-333333333333", workspace);
    assert.equal(restored.runs[0]?.research?.blockedReason, "A ready Web Search Connector is required for external research.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("research source snapshots reject private and non-http URLs", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-research-security-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "group,value\none,10\n", "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot: join(root, "metadata"), resourcesRoot: join(appRoot, "resources") });
    const inspected = await service.inspect("44444444-4444-4444-8444-444444444444", workspace, { paths: ["sales.csv"] });
    const prepared = await service.prepareResearch("44444444-4444-4444-8444-444444444444", workspace, { analysisId: inspected.id, mode: "quick", objective: "Verify a source", questions: ["Is it true?"], dimensions: [{ id: "fact", name: "Fact", question: "Is it true?" }] });
    await service.startResearch("44444444-4444-4444-8444-444444444444", workspace, { analysisId: inspected.id, confirmationToken: prepared.confirmationToken, webResearchAvailable: true });
    await assert.rejects(() => service.snapshotResearchSource("44444444-4444-4444-8444-444444444444", workspace, { analysisId: inspected.id, dimensionId: "fact", url: "http://127.0.0.1:8080/private" }), /Private research source/);
    await assert.rejects(() => service.snapshotResearchSource("44444444-4444-4444-8444-444444444444", workspace, { analysisId: inspected.id, dimensionId: "fact", url: "file:///C:/private.txt" }), /HTTP or HTTPS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("research mutations preserve claims submitted by parallel dimensions", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-research-concurrency-"));
  try {
    const sessionId = "55555555-5555-4555-8555-555555555555";
    const workspace = join(root, "workspace");
    const metadataRoot = join(root, "metadata");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "group,value\none,10\n", "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot, resourcesRoot: join(appRoot, "resources") });
    const inspected = await service.inspect(sessionId, workspace, { paths: ["sales.csv"] });
    const prepared = await service.prepareResearch(sessionId, workspace, {
      analysisId: inspected.id,
      mode: "normal",
      objective: "Explain and forecast",
      questions: ["Why?", "What next?"],
      dimensions: [
        { id: "drivers", name: "Drivers", question: "Why?" },
        { id: "outlook", name: "Outlook", question: "What next?" },
      ],
    });
    await service.startResearch(sessionId, workspace, { analysisId: inspected.id, confirmationToken: prepared.confirmationToken, webResearchAvailable: true });

    const metadataPath = join(metadataRoot, `${sessionId}.json`);
    const stored = JSON.parse(await readFile(metadataPath, "utf8")) as { runs: Array<{ id: string; research?: { sources: unknown[]; sourceCount: number } }> };
    const run = stored.runs.find((candidate) => candidate.id === inspected.id)!;
    run.research!.sources = [
      { id: "source-drivers", url: "https://example.com/drivers", title: "Drivers", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/drivers.md", contentHash: "drivers", sourceType: "web" },
      { id: "source-outlook", url: "https://example.com/outlook", title: "Outlook", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/outlook.md", contentHash: "outlook", sourceType: "web" },
    ];
    run.research!.sourceCount = 2;
    await writeFile(metadataPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

    await Promise.all([
      service.submitResearchDimension(sessionId, workspace, { analysisId: inspected.id, dimensionId: "drivers", claims: [{ id: "drivers-1", statement: "Driver claim", kind: "external", evidenceRefs: ["source-drivers"], confidence: "high" }] }),
      service.submitResearchDimension(sessionId, workspace, { analysisId: inspected.id, dimensionId: "outlook", claims: [{ id: "outlook-1", statement: "Outlook claim", kind: "external", evidenceRefs: ["source-outlook"], confidence: "medium" }] }),
    ]);

    const snapshot = await service.snapshot(sessionId, workspace);
    assert.deepEqual(snapshot.runs[0]?.research?.claims.map((claim) => claim.id).sort(), ["drivers-1", "outlook-1"]);
    assert.equal(snapshot.runs[0]?.research?.completedDimensions, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale evidence file does not replace a newly prepared research generation", async () => {
  const root = await mkdtemp(join(appRoot, "test", ".analysis-research-generation-"));
  try {
    const sessionId = "66666666-6666-4666-8666-666666666666";
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "sales.csv"), "group,value\none,10\n", "utf8");
    const service = new DesktopDataAnalysisService({ metadataRoot: join(root, "metadata"), resourcesRoot: join(appRoot, "resources") });
    const inspected = await service.inspect(sessionId, workspace, { paths: ["sales.csv"] });
    const researchRoot = join(workspace, inspected.outputRoot, "research");
    await mkdir(researchRoot, { recursive: true });
    await writeFile(join(researchRoot, "evidence.json"), JSON.stringify({
      version: 1,
      researchId: "old-research",
      mode: "quick",
      objective: "Old objective",
      questions: ["Old question"],
      dimensions: [{ id: "old", name: "Old", question: "Old?", status: "ready", claimCount: 1, sourceCount: 1 }],
      sources: [{ id: "old-source", url: "https://example.com/old", title: "Old", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: null, contentHash: null, sourceType: "web" }],
      claims: [{ id: "old-claim", dimensionId: "old", statement: "Old claim", kind: "external", evidenceRefs: ["old-source"], confidence: "medium", caveats: [] }],
      conflicts: [],
    }), "utf8");

    const prepared = await service.prepareResearch(sessionId, workspace, { analysisId: inspected.id, mode: "quick", objective: "New objective", questions: ["New question"], dimensions: [{ id: "new", name: "New", question: "New question" }] });
    const snapshot = await service.snapshot(sessionId, workspace);

    assert.notEqual(prepared.run.research?.researchId, "old-research");
    assert.equal(snapshot.runs[0]?.research?.researchId, prepared.run.research?.researchId);
    assert.equal(snapshot.runs[0]?.research?.status, "awaiting-confirmation");
    assert.deepEqual(snapshot.runs[0]?.research?.claims, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
