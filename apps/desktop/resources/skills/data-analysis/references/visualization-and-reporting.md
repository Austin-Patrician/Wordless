# Visualization And Reporting

## Chart Selection

- comparison across categories: horizontal or vertical bar
- trend over ordered time: line
- distribution: histogram, density, box plot, or ECDF
- numeric relationship: scatter with sample size and grouping context
- matrix or cohort intensity: heatmap

Avoid 3D charts, decorative effects, dual axes without strong justification, and pie charts with many categories. Use accessible colors, visible units, honest axes, and readable labels. Do not truncate a quantitative baseline when it changes the visual conclusion.

Every chart needs a title, measure, unit, population or sample size, time range, and a concise alt description. Save charts as PNG or SVG inside the output directory and reference them with relative paths.

## Manifest Contract

Create `analysis-manifest.json` with:

- `version`: `1`
- `title`, `objective`, and `scope`
- `inputs`: path, format, role, grain, rows, and notes
- `quality`: passed checks, warnings, and blocking issues
- `methods`: name, purpose, parameters, and assumptions
- `findings`: title, statement, evidence, and limitations
- `charts`: path, title, and alt text
- `recommendations`
- `validation`: name, status (`passed`, `warning`, or `failed`), and detail

Content quality requirements:

- Write the manifest in the user's language and keep terminology consistent across findings and charts.
- Make `conclusion` a two-to-four sentence decision summary, not a restatement of the objective.
- Rank three to seven findings by decision relevance. Every finding needs quantified evidence and a specific interpretation boundary.
- Do not repeat the same sentence in `statement` and `evidence`; evidence must name the metric, denominator, comparison, or validation result.
- Recommendations must follow from a named finding and state the intended action or next decision.
- Record material data-quality issues in `quality.warnings`; do not hide them only in limitations.

Call `data_validate` with the active `analysisId`. Resolve failed checks before publishing.

## Report Contract

Call `data_publish` with the active `analysisId` to render `analysis-report.md`. The report must contain:

1. Executive conclusion
2. Objective and scope
3. Sources and data quality
4. Methods and assumptions
5. Findings with embedded charts
6. Limitations
7. Recommendations
8. Reproducibility details

Return a shorter conclusion in chat and link the report. Do not duplicate the entire report in the conversation.
