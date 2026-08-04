import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnalysisReportLink } from "../src/renderer/features/artifacts/analysis-report-links.ts";

const outputRoot = "analysis-output/session-1/analysis-1";

test("resolves report attachments without navigating the renderer", () => {
  assert.deepEqual(resolveAnalysisReportLink("./scripts/reproduce.py", outputRoot), { kind: "output", path: "scripts/reproduce.py" });
  assert.deepEqual(resolveAnalysisReportLink("charts/result%20chart.png#preview", outputRoot), { kind: "output", path: "charts/result chart.png" });
});

test("resolves workspace files and rejects unsafe report links", () => {
  assert.deepEqual(resolveAnalysisReportLink("../../../sales.csv", outputRoot), { kind: "workspace", path: "sales.csv" });
  assert.deepEqual(resolveAnalysisReportLink("https://example.com/report", outputRoot), { kind: "external", url: "https://example.com/report" });
  assert.deepEqual(resolveAnalysisReportLink("#results", outputRoot), { kind: "anchor" });
  assert.equal(resolveAnalysisReportLink("../../../../outside.csv", outputRoot), null);
  assert.equal(resolveAnalysisReportLink("file:///C:/secret.txt", outputRoot), null);
  assert.equal(resolveAnalysisReportLink("javascript:alert(1)", outputRoot), null);
});
