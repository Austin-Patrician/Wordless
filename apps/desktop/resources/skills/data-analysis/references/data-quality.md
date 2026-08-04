# Data Quality

Run quality checks before interpreting patterns. Separate blocking issues from warnings.

## Establish Grain

State what one row represents. Identify candidate keys and verify uniqueness. A mixed or unknown grain blocks joins, rates, averages, and regression unless the analysis explicitly handles it.

## Core Profile

Measure at minimum:

- row and column counts
- duplicate rows and duplicate candidate keys
- null counts and rates
- inferred and conflicting types
- numeric min, max, median, and quantiles
- categorical cardinality and dominant values
- timestamp min, max, timezone, frequency, and gaps
- invalid domain values and impossible combinations

Bound displayed samples and value counts. Do not print entire frames or all unique values.

## Quality Dimensions

- Completeness: required fields and periods are present.
- Uniqueness: keys identify one record at the intended grain.
- Validity: types, ranges, categories, and dates satisfy domain rules.
- Consistency: units, labels, casing, date formats, and identifiers agree across sources.
- Integrity: foreign keys and parent-child relationships reconcile.
- Timeliness: latest period and expected refresh cadence are present.
- Stability: row counts, missing rates, and distributions do not shift unexpectedly.

## Cleaning Policy

- Preserve raw values and create transformed columns or intermediate datasets.
- Never remove characters, rows, outliers, or duplicates without a stated rule.
- Do not use language-specific cleaning such as retaining only Chinese characters by default.
- Record every coercion, imputation, exclusion, normalization, and deduplication rule.
- Prefer explicit mappings over fuzzy matching. Ask before applying ambiguous mappings.

## Quality Gate

Stop or request clarification when:

- the unit of analysis is unknown
- required fields are mostly missing
- candidate keys are non-unique and no aggregation rule exists
- timestamps or units conflict materially
- a source appears partial or stale for the requested period

Continue with warnings only when the limitation can be bounded and cannot reverse the main conclusion.
