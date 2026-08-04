import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type CommandResult = { code: number | null; stdout: string; stderr: string };

const testDirectory = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(testDirectory, "../resources/skills/data-analysis");

function runPython(script: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("python", [join(skillRoot, "scripts", script), ...args], { cwd: skillRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { stderr += error.message; resolve({ code: null, stdout, stderr }); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("data-analysis scripts inspect CSV data and render a validated report", async () => {
  const root = await mkdtemp(join(testDirectory, ".data-analysis-test-"));
  try {
    const input = join(root, "sales.csv");
    const profile = join(root, "profile.json");
    const manifest = join(root, "analysis-manifest.json");
    const report = join(root, "analysis-report.md");
    await writeFile(input, "name,group,value\nA,one,10\nB,two,20\nC,one,15\n", "utf8");
    const inspected = await runPython("inspect_data.py", [input, "--output", profile]);
    assert.equal(inspected.code, 0, inspected.stderr);
    const inspection = JSON.parse(inspected.stdout) as { datasets: Array<{ rows: number; columns: Array<{ name: string }> }> };
    assert.equal(inspection.datasets[0]?.rows, 3);
    assert.deepEqual(inspection.datasets[0]?.columns.map((column) => column.name), ["name", "group", "value"]);
    assert.equal((await readFile(profile, "utf8")).includes('"fileSizeBytes"'), true);
    await writeFile(manifest, JSON.stringify({
      version: 1,
      title: "Sales summary",
      objective: "Compare sales by group.",
      inputs: [{ path: input, rows: 3, grain: "one sale" }],
      methods: [{ name: "grouped sum", purpose: "Compare groups", assumptions: "Rows are independent" }],
      findings: [{ title: "One leads", statement: "One has the higher total.", evidence: "25 versus 20", limitations: "Small sample" }],
      charts: [],
      recommendations: ["Collect more observations."],
      validation: [{ name: "totals", status: "passed", detail: "Totals reconciled" }],
    }, null, 2), "utf8");
    const validated = await runPython("validate_analysis.py", [manifest]);
    assert.equal(validated.code, 0, validated.stderr);
    const rendered = await runPython("render_report.py", [manifest, report]);
    assert.equal(rendered.code, 0, rendered.stderr);
    const reportText = await readFile(report, "utf8");
    assert.match(reportText, /# Sales summary/);
    assert.match(reportText, /One leads/);
    assert.match(reportText, /## Validation/);
    assert.match(reportText, /\| totals \| passed \| Totals reconciled \|/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materialize_data reports a stable dependency error or creates Parquet", async () => {
  const root = await mkdtemp(join(testDirectory, ".data-analysis-materialize-"));
  try {
    const input = join(root, "values.csv");
    const output = join(root, "values.parquet");
    await writeFile(input, "id,value\n1,10\n2,20\n", "utf8");
    const result = await runPython("materialize_data.py", [input, output]);
    if (result.code === 0) {
      assert.equal((await readFile(output)).length > 0, true);
    } else {
      assert.match(`${result.stdout}\n${result.stderr}`, /(pandas|pyarrow) is required/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("data-analysis scripts validate and render source-grounded research evidence", async () => {
  const root = await mkdtemp(join(testDirectory, ".data-research-test-"));
  try {
    const manifest = join(root, "analysis-manifest.json");
    const report = join(root, "analysis-report.md");
    const researchRoot = join(root, "research");
    await mkdir(join(researchRoot, "source-cache"), { recursive: true });
    await writeFile(join(researchRoot, "source-cache", "source.md"), "# Source\n\nPrimary evidence.\n", "utf8");
    await writeFile(join(researchRoot, "evidence.json"), JSON.stringify({
      version: 1,
      mode: "normal",
      objective: "Explain the observed increase.",
      questions: ["What changed externally?"],
      dimensions: [{ id: "drivers", name: "External drivers", question: "What changed?", status: "ready", claimCount: 1, sourceCount: 1, review: { verdict: "pass", notes: [] } }],
      sources: [{ id: "source-one", url: "https://example.com/source", title: "Primary source", publisher: "Example", snapshotPath: "research/source-cache/source.md" }],
      claims: [{ id: "drivers.c1", dimensionId: "drivers", statement: "Supply tightened during the observed period.", kind: "external", evidenceRefs: ["source-one"], confidence: "medium", caveats: ["The source covers one market segment."] }],
      conflicts: [],
    }, null, 2), "utf8");
    await writeFile(manifest, JSON.stringify({
      version: 2,
      title: "Sales deep dive",
      objective: "Measure and explain the increase.",
      inputs: [{ path: "sales.csv", rows: 3, grain: "one sale" }],
      methods: [{ name: "trend", purpose: "Measure change", assumptions: "Comparable periods" }],
      findings: [{ title: "Increase", statement: "Sales increased.", evidence: "Validated local totals" }],
      charts: [],
      recommendations: ["Monitor supply conditions."],
      validation: [{ name: "totals", status: "passed", detail: "Reconciled" }],
      research: { evidencePath: "research/evidence.json" },
    }, null, 2), "utf8");
    const validated = await runPython("validate_analysis.py", [manifest]);
    assert.equal(validated.code, 0, validated.stderr);
    const rendered = await runPython("render_report.py", [manifest, report]);
    assert.equal(rendered.code, 0, rendered.stderr);
    const reportText = await readFile(report, "utf8");
    assert.match(reportText, /## Deep research and external evidence/);
    assert.match(reportText, /Supply tightened/);
    assert.match(reportText, /\[\[1\]\]\(https:\/\/example\.com\/source\)/);
    assert.match(reportText, /## References/);

    const evidence = JSON.parse(await readFile(join(researchRoot, "evidence.json"), "utf8")) as { claims: Array<{ evidenceRefs: string[] }> };
    evidence.claims[0]!.evidenceRefs = ["missing-source"];
    await writeFile(join(researchRoot, "evidence.json"), JSON.stringify(evidence), "utf8");
    const invalid = await runPython("validate_analysis.py", [manifest]);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr || invalid.stdout, /unknown references/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
