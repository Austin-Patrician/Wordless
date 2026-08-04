# Source Routing

## Input Inventory

For every source, record:

- absolute or workspace-relative path
- format and file size
- modified timestamp
- sheets or logical tables
- row and column counts when cheaply available
- field names and inferred types
- bounded sample size and sampling method
- encoding, delimiter, and parse warnings

Call `data_inspect` before writing task-specific analysis code. This is required to register bounded source previews in the Analysis panel. If encoding detection is wrong, report the issue instead of bypassing the registered inspection path.

## Format Strategy

### CSV and TSV

- Detect delimiter from extension first, then validate column consistency.
- Stream once for row count and a bounded sample.
- Record malformed rows instead of silently dropping them.
- Use DuckDB or PyArrow for large scans, joins, and aggregations when available.

### JSON and JSONL

- Distinguish an array of records, a single record, and newline-delimited records.
- Flatten nested fields only when the intended grain remains clear.
- Preserve arrays and nested objects unless the user confirms an expansion rule.

### XLSX

- Inspect with `openpyxl.load_workbook(..., read_only=True, data_only=True)`.
- Treat each sheet as a separate dataset until evidence supports combining them.
- Detect blank leading rows, repeated headers, merged layouts, formulas with stale cached values, and mixed-type columns.
- Never save the workbook and never claim formula values were recalculated.

### Parquet

- Read schema and row-group metadata before loading rows.
- Select only required columns and row groups.
- Preserve logical timestamp, decimal, and categorical types.

## Execution Strategy

Estimate the working set from file size, sampled string widths, column count, and expected intermediate tables.

- Use pandas when inputs and intermediates fit comfortably below 25% of available memory.
- Use DuckDB or PyArrow when projection and aggregation can avoid full materialization.
- Use chunked processing when transforms cannot be expressed as bounded queries.
- Materialize Parquet when repeated scans or multi-step analysis justify the conversion cost.

Do not create Parquet merely because a dataset exceeds a fixed row threshold. Record the chosen engine and rationale in the manifest.

## Dependency Failure

When a required reader is missing, stop that branch and report one exact requirement, for example `openpyxl is required to inspect XLSX files`. Do not run an installer.
