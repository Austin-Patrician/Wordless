---
name: data-analysis
description: Analyze local CSV, TSV, JSON, JSONL, XLSX, and Parquet data; profile data quality; join multiple files; summarize and visualize findings; run hypothesis tests, regression, time-series forecasts, clustering, or anomaly detection; and produce an evidence-backed report. Use when the user asks to inspect, clean, compare, aggregate, explain, forecast, segment, or find anomalies in structured local data. Do not use for modifying or generating Excel workbooks, image OCR, causal inference, Bayesian modeling, generic machine-learning development, or simple arithmetic that does not require dataset inspection.
---

# Data Analysis

Analyze local structured data without placing complete datasets in the model context. Preserve source files, execute reproducible computations, validate claims, and finish with a concise answer plus `analysis-report.md` containing any useful charts.

## Non-Negotiable Rules

- Treat every input file as read-only. Never overwrite, reformat, or save an XLSX source.
- Inspect metadata and bounded samples before selecting an engine or method.
- Never paste a complete large dataset or unbounded query result into the conversation.
- Do not install Python packages, system tools, fonts, or DuckDB automatically. Report missing capabilities and the exact dependency instead.
- Ask for clarification when the target metric, unit of analysis, join key, time grain, outcome, or comparison is materially ambiguous.
- Keep generated scripts, intermediate files, charts, manifests, and reports in a dedicated output directory. Default to `analysis-output/` inside the current workspace.
- Use deterministic random seeds for sampling, forecasting, clustering, and anomaly detection.
- Distinguish observed association from causation. Do not make causal claims.
- Do not force a result when assumptions, sample size, data quality, or validation are inadequate.
- If the user asks to edit formulas, formatting, charts, or contents in an Excel workbook, direct that work to the Spreadsheet Agent.

## Workflow

1. Define the question, decision, inputs, grain, measures, dimensions, filters, time range, and expected report audience.
2. Read [references/source-routing.md](references/source-routing.md), then call `data_inspect` for every input so bounded previews and source metadata are registered in the Analysis panel. Reuse the returned `analysisId` throughout the run.
3. Read [references/data-quality.md](references/data-quality.md). Record blocking issues, warnings, and assumptions before analysis.
4. For multiple inputs, read [references/multi-file-analysis.md](references/multi-file-analysis.md) before joining or stacking data.
5. Choose exactly the relevant analysis branch:
   - General profiling, comparison, trends, or KPI work: [references/exploratory-analysis.md](references/exploratory-analysis.md)
   - Hypothesis tests or regression: [references/hypothesis-and-regression.md](references/hypothesis-and-regression.md)
   - Forecasting: [references/time-series.md](references/time-series.md)
   - Segmentation or anomaly detection: [references/clustering-and-anomaly.md](references/clustering-and-anomaly.md)
6. Save task-specific code rather than relying on an interactive process with hidden state. Preserve parameters and random seeds.
7. Read [references/validation.md](references/validation.md). Reconcile counts, totals, samples, assumptions, and generated files.
8. Read [references/visualization-and-reporting.md](references/visualization-and-reporting.md). Create the analysis manifest under the output root returned by `data_inspect`, then call `data_validate` and `data_publish`. Do not invoke the validator or renderer scripts through the shell when these tools are available.
9. Return the main findings in the user's language and link the report. State material caveats or incomplete checks.

## Engine Selection

- Use standard-library streaming for initial CSV, TSV, JSON, and JSONL inspection.
- Use `openpyxl` in read-only mode for XLSX inspection when available.
- Use Parquet metadata through `pyarrow` when available.
- Use pandas only after the estimated working set is known to fit comfortably in memory.
- Prefer DuckDB, PyArrow, Parquet materialization, or chunked processing for large or multi-file workloads.
- Base the decision on file size, estimated working set, number of columns, operation shape, and available memory. Do not use row count as the only threshold.
- Use `data_materialize` only when Parquet is useful and its declared dependencies are present.

## Required Deliverables

- A concise conversational conclusion.
- `analysis-report.md` with objective, sources, quality summary, methods, findings, embedded charts, limitations, and recommendations.
- `analysis-manifest.json` recording inputs, methods, findings, charts, warnings, and validation checks.
- Task-specific scripts and intermediate data needed to reproduce the analysis.

When the user's question asks why a pattern occurred, what external factors may affect it, what happens next, or what decision to make, finish the verified local analysis first and then load `data-deep-research`. Do not silently add external explanations to a data-only report; prepare a research plan and obtain one user confirmation before using network sources.

Do not create an Excel deliverable or a notebook unless a future skill explicitly adds that behavior.
