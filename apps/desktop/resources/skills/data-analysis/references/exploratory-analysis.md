# Exploratory And Business Analysis

Use this branch for profiling, comparisons, trends, funnels, cohorts, KPIs, and general diagnostic questions.

## Analysis Plan

Write down:

- question and decision supported
- unit of analysis
- measures and denominators
- dimensions and segments
- filters and exclusions
- time range and comparison baseline
- assumptions that can change interpretation

## Recommended Sequence

1. Validate totals and denominators.
2. Summarize distributions, not only averages.
3. Compare meaningful segments with both absolute values and rates.
4. Inspect temporal patterns at an appropriate grain.
5. Rank drivers while retaining volume context.
6. Investigate surprising results with bounded samples and reconciliation checks.

## Guardrails

- Use weighted averages when group sizes differ and weighting is meaningful.
- Report counts beside percentages.
- Separate missing or unknown categories instead of silently excluding them.
- Avoid interpreting correlations computed from identifiers, codes, sparse columns, or mixed grains.
- Do not rank tiny groups without minimum-volume context.
- Label partial periods and incomplete cohorts.

## Findings

Every finding must include a claim, concrete evidence, interpretation, and implication. Record limitations that could reverse the conclusion. Prefer a few decision-useful findings over an exhaustive dump of statistics.
