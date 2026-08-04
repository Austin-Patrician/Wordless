#!/usr/bin/env python3
"""Materialize a supported tabular input as Parquet."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sheet", default=0)
    parser.add_argument("--encoding", default="utf-8-sig")
    parser.add_argument("--chunk-size", type=int, default=50_000)
    return parser.parse_args()


def read_chunks(path: Path, sheet: str | int, encoding: str, chunk_size: int) -> Any:
    try:
        import pandas as pd
    except ImportError as error:
        raise RuntimeError("pandas is required to materialize data") from error
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        return pd.read_csv(path, sep=delimiter, encoding=encoding, chunksize=chunk_size)
    if suffix == ".jsonl":
        return pd.read_json(path, lines=True, encoding=encoding, chunksize=chunk_size)
    if suffix == ".json":
        return [pd.read_json(path, encoding=encoding)]
    if suffix in {".xlsx", ".xlsm", ".xltx"}:
        return [pd.read_excel(path, sheet_name=sheet, engine="openpyxl")]
    if suffix == ".parquet":
        return [pd.read_parquet(path)]
    raise ValueError(f"Unsupported data format: {suffix or '(none)'}")


def main() -> int:
    args = parse_args()
    source = args.input.expanduser().resolve()
    target = args.output.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if target.suffix.lower() != ".parquet":
        raise ValueError("The output must use the .parquet extension")
    if args.chunk_size < 1:
        raise ValueError("--chunk-size must be positive")
    try:
        import pyarrow as pa
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise RuntimeError("pyarrow is required to materialize Parquet") from error
    if source.suffix.lower() == ".parquet":
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        print(json.dumps({"input": str(source), "output": str(target), "rows": None, "copied": True}, ensure_ascii=False))
        return 0
    writer = None
    rows = 0
    try:
        for chunk in read_chunks(source, args.sheet, args.encoding, args.chunk_size):
            table = pa.Table.from_pandas(chunk, preserve_index=False)
            if writer is None:
                target.parent.mkdir(parents=True, exist_ok=True)
                writer = parquet.ParquetWriter(target, table.schema, compression="snappy")
            writer.write_table(table)
            rows += len(chunk)
    except Exception:
        if target.exists():
            target.unlink()
        raise
    finally:
        if writer is not None:
            writer.close()
    print(json.dumps({"input": str(source), "output": str(target), "rows": rows, "copied": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
