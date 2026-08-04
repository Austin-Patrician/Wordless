# Validation

Validation protects the difference between executed evidence and plausible prose.

## Required Checks

- Re-run key calculations from an independent aggregation or bounded sample.
- Reconcile source row counts, filtered rows, excluded rows, and final rows.
- Reconcile important totals before and after cleaning, joining, and grouping.
- Verify denominators used for every rate and percentage.
- Inspect representative rows behind surprising findings.
- Confirm chart data matches the reported numbers and labels.
- Confirm generated chart and report files exist and are non-empty.
- Confirm no source file was overwritten.

## Statistical Checks

- Verify assumptions and sample sizes before tests.
- Report effect sizes and uncertainty.
- Use held-out or temporal validation for predictive methods.
- Compare forecasts with a naive baseline.
- Assess clustering stability across seeds or samples.
- Review anomaly examples and flagged rates.

## Validation Status

Use `passed` when the check completed and supports the result, `warning` when a bounded limitation remains, and `failed` when the report must not claim completion.

Do not suppress failed checks. Fix the analysis, narrow the claim, or explain that the requested conclusion cannot be supported.

## Final Review

Before delivery, confirm that every major claim has concrete evidence, every chart has an interpretable source, caveats are visible, and recommendations follow from the findings rather than generic advice.
