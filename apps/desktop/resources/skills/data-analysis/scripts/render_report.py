#!/usr/bin/env python3
"""Render a validated analysis manifest as a Markdown report."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def text(value: Any, fallback: str = "Not provided") -> str:
    if isinstance(value, str):
        return value.strip() or fallback
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or fallback
    return fallback if value is None else str(value)


def render(manifest: dict[str, Any], manifest_path: Path) -> str:
    localized_text = " ".join(str(manifest.get(key, "")) for key in ("title", "objective", "conclusion"))
    chinese = bool(re.search(r"[\u3400-\u9fff]", localized_text))
    labels = {
        "analysis": "数据分析报告" if chinese else "Data analysis",
        "conclusion": "核心结论" if chinese else "Executive conclusion",
        "scope": "目标与范围" if chinese else "Objective and scope",
        "objective": "分析目标" if chinese else "Objective",
        "scope_label": "分析边界" if chinese else "Scope",
        "sources": "数据来源与质量" if chinese else "Sources and data quality",
        "source": "数据源" if chinese else "Source",
        "format": "格式" if chinese else "Format",
        "rows": "行数" if chinese else "Rows",
        "grain": "数据粒度" if chinese else "Grain",
        "quality": "质量结论" if chinese else "Quality summary",
        "warning": "注意" if chinese else "Warning",
        "methods": "方法与假设" if chinese else "Methods and assumptions",
        "purpose": "用途" if chinese else "Purpose",
        "parameters": "参数" if chinese else "Parameters",
        "assumptions": "关键假设" if chinese else "Assumptions",
        "findings": "关键发现" if chinese else "Key findings",
        "evidence": "证据" if chinese else "Evidence",
        "boundary": "解释边界" if chinese else "Interpretation boundary",
        "charts": "图表" if chinese else "Charts",
        "validation": "结果校验" if chinese else "Validation",
        "check": "检查项" if chinese else "Check",
        "status": "状态" if chinese else "Status",
        "detail": "说明" if chinese else "Detail",
        "recommendations": "建议" if chinese else "Recommendations",
        "limitations": "局限" if chinese else "Limitations",
        "reproducibility": "复现信息" if chinese else "Reproducibility",
        "research": "深度研究与外部证据" if chinese else "Deep research and external evidence",
        "research_objective": "研究目标" if chinese else "Research objective",
        "confidence": "置信度" if chinese else "Confidence",
        "references": "参考文献" if chinese else "References",
        "not_recorded": "未记录" if chinese else "Not recorded",
    }
    lines = [f"# {text(manifest.get('title'), labels['analysis'])}", "", f"> {text(manifest.get('conclusion'), labels['not_recorded'])}", "", "---", "", f"## {labels['scope']}", "", f"**{labels['objective']}**  ", text(manifest.get("objective"), labels["not_recorded"]), "", f"**{labels['scope_label']}**  ", text(manifest.get("scope"), labels["not_recorded"]), "", f"## {labels['sources']}", "", f"| {labels['source']} | {labels['format']} | {labels['rows']} | {labels['grain']} |", "| --- | --- | ---: | --- |"]
    for source in manifest.get("inputs", []):
        if isinstance(source, dict):
            lines.append(f"| `{text(source.get('path'))}` | {text(source.get('format'), labels['not_recorded'])} | {text(source.get('rows'), labels['not_recorded'])} | {text(source.get('grain'), labels['not_recorded'])} |")
    quality = manifest.get("quality")
    if isinstance(quality, dict):
        lines.extend(["", f"**{labels['quality']}**  ", text(quality.get("summary"), labels["not_recorded"])])
        for warning in quality.get("warnings", []):
            lines.append(f"- **{labels['warning']}**: {warning}")
    lines.extend(["", f"## {labels['methods']}", ""])
    for index, method in enumerate(manifest.get("methods", []), start=1):
        if isinstance(method, dict):
            lines.extend([f"### {index}. {text(method.get('name'))}", "", f"- **{labels['purpose']}**: {text(method.get('purpose'), labels['not_recorded'])}"])
            if method.get("parameters"):
                lines.append(f"- **{labels['parameters']}**: {text(method.get('parameters'))}")
            lines.extend([f"- **{labels['assumptions']}**: {text(method.get('assumptions'), labels['not_recorded'])}", ""])
    lines.extend([f"## {labels['findings']}", ""])
    for index, finding in enumerate(manifest.get("findings", []), start=1):
        if not isinstance(finding, dict):
            continue
        lines.extend([f"### {index}. {text(finding.get('title'))}", "", text(finding.get("statement")), "", f"**{labels['evidence']}**: {text(finding.get('evidence'))}"])
        if finding.get("limitations"):
            lines.append(f"**{labels['boundary']}**: {text(finding.get('limitations'))}")
        lines.append("")
    if manifest.get("charts"):
        lines.extend([f"## {labels['charts']}", ""])
        for chart in manifest["charts"]:
            if isinstance(chart, dict):
                chart_path = Path(str(chart.get("path", "")))
                lines.extend([f"### {text(chart.get('title'))}", "", f"![{text(chart.get('alt'), 'Analysis chart')}]({chart_path.as_posix()})", ""])
    evidence_path = manifest_path.parent / "research" / "evidence.json"
    research_meta = manifest.get("research")
    if isinstance(research_meta, dict) and research_meta.get("evidencePath"):
        evidence_path = manifest_path.parent / Path(str(research_meta["evidencePath"]))
    if evidence_path.is_file():
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        sources = [source for source in evidence.get("sources", []) if isinstance(source, dict)]
        source_numbers = {source.get("id"): index for index, source in enumerate(sources, start=1)}
        dimensions = {dimension.get("id"): dimension for dimension in evidence.get("dimensions", []) if isinstance(dimension, dict)}
        lines.extend([f"## {labels['research']}", "", f"**{labels['research_objective']}**  ", text(evidence.get("objective"), labels["not_recorded"]), ""])
        current_dimension = None
        for claim in evidence.get("claims", []):
            if not isinstance(claim, dict):
                continue
            dimension_id = claim.get("dimensionId")
            if dimension_id != current_dimension:
                current_dimension = dimension_id
                dimension = dimensions.get(dimension_id, {})
                lines.extend([f"### {text(dimension.get('name'), str(dimension_id or 'Research'))}", ""])
            citations = " ".join(f"[[{source_numbers[reference]}]]({next((source.get('url') for source in sources if source.get('id') == reference), '')})" for reference in claim.get("evidenceRefs", []) if reference in source_numbers)
            lines.append(f"- {text(claim.get('statement'))} {citations}  ")
            lines.append(f"  **{labels['confidence']}**: {text(claim.get('confidence'), labels['not_recorded'])}")
            for caveat in claim.get("caveats", []):
                lines.append(f"  - {text(caveat)}")
        lines.extend(["", f"## {labels['references']}", ""])
        for index, source in enumerate(sources, start=1):
            publisher = f" — {text(source.get('publisher'))}" if source.get("publisher") else ""
            lines.append(f"{index}. [{text(source.get('title'), text(source.get('url')))}]({text(source.get('url'))}){publisher}")
        lines.append("")
    if manifest.get("validation"):
        lines.extend([f"## {labels['validation']}", "", f"| {labels['check']} | {labels['status']} | {labels['detail']} |", "| --- | --- | --- |"])
        for check in manifest["validation"]:
            if isinstance(check, dict):
                lines.append(f"| {text(check.get('name'))} | {text(check.get('status'))} | {text(check.get('detail'), labels['not_recorded'])} |")
        lines.append("")
    lines.extend([f"## {labels['recommendations']}", ""])
    for index, recommendation in enumerate(manifest.get("recommendations", []) or [labels["not_recorded"]], start=1):
        lines.append(f"{index}. {recommendation}")
    lines.extend(["", f"## {labels['limitations']}", ""])
    for limitation in manifest.get("limitations", []) or [labels["not_recorded"]]:
        lines.append(f"- {limitation}")
    lines.extend(["", f"## {labels['reproducibility']}", "", f"Manifest: `{manifest_path.name}`"])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest root must be an object")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render(manifest, manifest_path), encoding="utf-8")
    print(json.dumps({"output": str(output_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
