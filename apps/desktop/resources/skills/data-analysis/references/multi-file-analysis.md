# Multi-File Analysis

Treat every union or join as a data-contract operation, not a mechanical merge.

## Before Combining

For each input, document grain, keys, row count, columns, units, time coverage, and source priority. Normalize identifiers in intermediate data while retaining original values.

## Stacking Rows

- Confirm schemas represent the same concepts.
- Align columns by explicit names, not position.
- Add a source-file column.
- Reconcile units and timezones before stacking.
- Report missing and extra columns by source.

## Joining Columns

1. Verify key types and normalization rules.
2. Measure key uniqueness on both sides.
3. Classify cardinality as one-to-one, one-to-many, many-to-one, or many-to-many.
4. Predict the expected output grain and approximate row count.
5. Stop for confirmation before an unintended many-to-many join.
6. After joining, report matched, left-only, right-only, and duplicated-key rates.
7. Reconcile important totals before and after the join.

## Ambiguous Mapping

Do not guess between similarly named fields. Present the candidate keys, example values, uniqueness rates, and recommended mapping. Require confirmation for fuzzy entity matching or lossy normalization.

## Required Validation

- output row count matches the intended cardinality
- no silent key truncation or type coercion occurred
- aggregate totals reconcile within an explained tolerance
- unmatched records are quantified and sampled
- duplicate expansion is measured by key
- source precedence is explicit when values conflict
