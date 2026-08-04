#!/usr/bin/env python3
"""Validate the portable analysis-manifest.json contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REQUIRED_KEYS = ("version", "title", "objective", "inputs", "methods", "findings", "charts", "validation")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    return parser.parse_args()


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def validate(manifest: dict[str, Any], base: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for key in REQUIRED_KEYS:
        if key not in manifest:
            fail(errors, f"missing required key: {key}")
    if manifest.get("version") not in {1, 2}:
        fail(errors, "version must be 1 or 2")
    for key in ("title", "objective"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            fail(errors, f"{key} must be a non-empty string")
    for key in ("inputs", "methods", "findings", "charts", "validation"):
        if not isinstance(manifest.get(key), list):
            fail(errors, f"{key} must be an array")
    for index, finding in enumerate(manifest.get("findings", [])):
        if not isinstance(finding, dict):
            fail(errors, f"findings[{index}] must be an object")
            continue
        for key in ("title", "statement", "evidence"):
            if not finding.get(key):
                fail(errors, f"findings[{index}] missing {key}")
    for index, chart in enumerate(manifest.get("charts", [])):
        if not isinstance(chart, dict) or not isinstance(chart.get("path"), str):
            fail(errors, f"charts[{index}] must contain a relative path")
            continue
        chart_path = Path(chart["path"])
        if chart_path.is_absolute() or ".." in chart_path.parts:
            fail(errors, f"charts[{index}] path must stay inside the report directory")
        elif not (base / chart_path).is_file():
            fail(errors, f"charts[{index}] file does not exist: {chart_path}")
    for index, check in enumerate(manifest.get("validation", [])):
        if not isinstance(check, dict) or check.get("status") not in {"passed", "warning", "failed"}:
            fail(errors, f"validation[{index}] has an invalid status")
        elif check.get("status") == "failed":
            fail(errors, f"validation[{index}] failed: {check.get('detail', 'no detail')}")
        elif check.get("status") == "warning":
            warnings.append(str(check.get("detail", f"validation[{index}] warning")))
    if not manifest.get("findings"):
        warnings.append("No findings were recorded")
    research_path = base / "research" / "evidence.json"
    research = manifest.get("research")
    if research is not None and not isinstance(research, dict):
        fail(errors, "research must be an object")
    if isinstance(research, dict) and research.get("evidencePath"):
        candidate = Path(str(research["evidencePath"]))
        if candidate.is_absolute() or ".." in candidate.parts:
            fail(errors, "research.evidencePath must stay inside the report directory")
        else:
            research_path = base / candidate
    if research_path.is_file():
        validate_research_evidence(research_path, base, errors, warnings)
    return errors, warnings


def validate_research_evidence(path: Path, base: Path, errors: list[str], warnings: list[str]) -> None:
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(errors, f"research evidence could not be read: {error}")
        return
    if not isinstance(evidence, dict):
        fail(errors, "research evidence root must be an object")
        return
    sources = evidence.get("sources")
    claims = evidence.get("claims")
    dimensions = evidence.get("dimensions")
    if not isinstance(sources, list) or not isinstance(claims, list) or not isinstance(dimensions, list):
        fail(errors, "research evidence must contain sources, claims, and dimensions arrays")
        return
    source_ids: set[str] = set()
    for index, source in enumerate(sources):
        if not isinstance(source, dict) or not isinstance(source.get("id"), str) or not isinstance(source.get("url"), str):
            fail(errors, f"research sources[{index}] is invalid")
            continue
        source_ids.add(source["id"])
        snapshot = Path(str(source.get("snapshotPath", "")))
        if not snapshot.parts or snapshot.is_absolute() or ".." in snapshot.parts or not (base / snapshot).is_file():
            fail(errors, f"research source {source['id']} has no valid snapshot")
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict) or not claim.get("statement") or not isinstance(claim.get("evidenceRefs"), list) or not claim["evidenceRefs"]:
            fail(errors, f"research claims[{index}] is invalid")
            continue
        unknown = [reference for reference in claim["evidenceRefs"] if reference not in source_ids]
        if unknown:
            fail(errors, f"research claim {claim.get('id', index)} has unknown references: {', '.join(unknown)}")
    mode = evidence.get("mode")
    for dimension in dimensions:
        if not isinstance(dimension, dict) or dimension.get("status") != "ready":
            fail(errors, "every research dimension must be ready")
        elif mode != "quick" and (not isinstance(dimension.get("review"), dict) or dimension["review"].get("verdict") != "pass"):
            fail(errors, f"research dimension {dimension.get('id', '?')} has no passing review")
    if evidence.get("conflicts"):
        fail(errors, "research evidence contains unresolved conflicts")
    if not sources:
        warnings.append("Research contains no sources")


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.expanduser().resolve()
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("manifest root must be an object")
    errors, warnings = validate(value, manifest_path.parent)
    result = {"valid": not errors, "errors": errors, "warnings": warnings, "manifest": str(manifest_path)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"valid": False, "errors": [str(error)], "warnings": []}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
