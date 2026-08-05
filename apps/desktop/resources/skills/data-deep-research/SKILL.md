---
name: data-deep-research
description: Extend verified local data analysis with source-grounded external research when the user needs causes, context, outlook, scenarios, or decision recommendations. Use after data analysis for deep research, industry research, competitor analysis, policy impact, fact checking, or questions that require multiple current external sources. Do not use for purely descriptive statistics, transformations, charting, or conclusions already fully supported by the local dataset.
---

# Data Deep Research

Turn verified data findings into a traceable answer to: what happened, why it happened, what may happen next, and what the audience should do.

## Hard Rules

- Finish and publish the local data analysis before external research. The data report remains a valid fallback if research is declined or blocked.
- Never use model memory as external evidence. Every external or synthesis claim must cite source ids returned by `research_snapshot`.
- Do not start network research without one user confirmation covering the recommended mode, research objective, questions, dimensions, expected source types, and report form.
- Researcher and research-reviewer subagents must not request user input. Delegated tasks must be self-contained; return a concise blocker to the parent agent when required information is missing.
- Use only a ready Web Search Connector for discovery. If `research_start` returns `blocked`, explain how to configure the connector and stop the research branch without weakening the data result.
- Distinguish observed data facts, external explanations, and synthesis. Do not turn association into causation.
- Prefer primary, official, regulatory, filing, academic, or directly accountable sources. Use news and commentary to triangulate, not as the sole support for high-confidence claims.
- Reconcile conflicting numbers or label the claim `contested`. Do not hide conflicts in general limitations.

## Mode Selection

- `quick`: one narrow fact or explanation that one authoritative source can settle. One dimension; validation required; review optional.
- `normal`: multiple dimensions or a why/impact question needing independent sources. Research dimensions in parallel, then review every dimension.
- `heavy`: decision-critical industry, investment, policy, competitor, or trend work. Add competing explanations, downstream scenarios, conflict reconciliation, and targeted supplement research after review.

Choose mode by workflow complexity, not a fixed number of searches. Recommend at least `normal` for explaining a data anomaly or inflection point.

## Workflow

1. Read the published analysis findings and identify which conclusions are proven by local data and which explanatory questions remain open.
2. Call `research_prepare` and present one confirmation request containing mode, objective, research questions, dimensions, source categories, report audience, and intended report form. Use `request_user_input` and do not start network work while it is pending.
3. After the user confirms, call `research_start` with the one-time confirmationToken returned by `research_prepare` and stable short dimension ids.
4. For independent dimensions call `research_delegate` in parallel with one `researcher` task per dimension. Each task must search, snapshot every used source, and submit structured dimension claims.
5. For `normal` and `heavy`, call `research_delegate` with one `research-reviewer` task per dimension. A revise verdict requires supplement research for only that dimension, followed by another review.
6. Call `research_validate`. Resolve every reported missing reference, failed review, incomplete dimension, and unresolved conflict.
7. Update `analysis-manifest.json` to version 2. Preserve existing data findings and add a `research` object with the confirmed mode, objective, questions, and the generated `research/evidence.json` path. Write a unified conclusion and recommendations that cite both data facts and external evidence.
8. Call `data_publish` to produce the unified `analysis-report.md`.

## Researcher Task Contract

Every researcher task must be self-contained and include the analysis id, dimension id, question, time/geography scope, source preferences, and relevant data findings. The researcher must:

1. Use a search Connector to discover candidate URLs.
2. Call `research_snapshot` for each source actually relied upon.
3. Compare source scope, date, definitions, and incentives.
4. Call `research_submit_dimension` once with concise claims, evidenceRefs, confidence, caveats, and explicit unresolved conflicts.

## Review Contract

Reviewers verify source-to-claim entailment, source independence, freshness, scope consistency, conflict treatment, and whether the dimension answers its question. `pass` means the evidence can support publication; `revise` must include concrete missing evidence or corrections.

## Unified Report Contract

The final report should contain an executive conclusion, verified data facts, external drivers/context, integrated interpretation, scenarios and risks when relevant, audience-specific actions, limitations, reproducibility, and numbered references. Recommendations must name the finding they depend on and state the intended decision or action.

This workflow is a Wordless-native adaptation of evidence DAG, source snapshot, review, supplement, and citation patterns described by OpenSenseNova SenseNova-Skills. It does not require or invoke the upstream Research Workbench or search scripts.
