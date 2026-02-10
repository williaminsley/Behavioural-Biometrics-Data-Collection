#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


DEFAULT_CORE_FEATURES = [
    "participantId",
    "sessionId",
    "windowIndex",
    "typing_ikt_global_mean",
    "typing_ikt_global_std",
    "tap_rt_mean",
    "tap_rt_std",
    "typing_drift_ikt",
    "tap_drift_rt",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--raw-sessions-dir", type=str, default="data/raw/sessions")
    p.add_argument("--reports-dir", type=str, default="reports")
    p.add_argument("--core-features", type=str, default=",".join(DEFAULT_CORE_FEATURES))
    p.add_argument("--strict", action="store_true")
    return p.parse_args()


def find_auth_files(raw_sessions_dir: Path) -> List[Path]:
    return sorted(raw_sessions_dir.glob("*/auth_windows.csv")) if raw_sessions_dir.exists() else []


def load_auth(auth_files: List[Path]) -> pd.DataFrame:
    frames = []
    for f in auth_files:
        sid = f.parent.name
        df = pd.read_csv(f)
        if "sessionId" not in df.columns:
            df["sessionId"] = sid
        df["sessionId"] = df["sessionId"].fillna(sid).astype(str)
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def presence_frac(df: pd.DataFrame, col: str) -> float:
    if len(df) == 0 or col not in df.columns:
        return 0.0
    s = df[col]
    if s.dtype == bool:
        return float(s.mean())
    mapped = s.map(lambda v: str(v).strip().lower() in ("1", "true", "t", "yes", "y")).fillna(False)
    return float(mapped.mean())


def inferred_presence_frac(df: pd.DataFrame, explicit_col: str, fallback_cols: List[str]) -> Tuple[float, str]:
    if explicit_col in df.columns:
        return presence_frac(df, explicit_col), explicit_col
    for c in fallback_cols:
        if c in df.columns:
            s = pd.to_numeric(df[c], errors="coerce")
            return float(s.notna().mean()) if len(s) else 0.0, c
    return 0.0, "none"


def missingness_report(df: pd.DataFrame, cols: List[str]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    n = len(df)
    for c in cols:
        if c not in df.columns:
            out[c] = {"present_in_schema": 0.0, "missing_frac": 1.0}
        else:
            out[c] = {"present_in_schema": 1.0, "missing_frac": float(df[c].isna().mean()) if n else 1.0}
    return out


def windows_per_session(auth_files: List[Path]) -> Dict[str, int]:
    out = {}
    for f in auth_files:
        sid = f.parent.name
        try:
            out[sid] = int(len(pd.read_csv(f)))
        except Exception:
            out[sid] = 0
    return out


def gate(ver: dict, strict: bool) -> Tuple[str, List[str], List[str]]:
    fails, warns = [], []

    sessions = ver["sessions_count"]
    total_windows = ver["total_windows"]
    typing_p = ver["typing_presence"]
    tapping_p = ver["tapping_presence"]

    if sessions < 1:
        fails.append("No sessions found.")
    if total_windows < 20:
        warns.append(f"Low total windows (<20): {total_windows}")

    if typing_p < 0.05:
        fails.append(f"Typing presence too low (<5%): {typing_p:.1%}")
    elif typing_p < 0.20:
        warns.append(f"Typing presence low (<20%): {typing_p:.1%}")

    if tapping_p < 0.05:
        fails.append(f"Tapping presence too low (<5%): {tapping_p:.1%}")
    elif tapping_p < 0.20:
        warns.append(f"Tapping presence low (<20%): {tapping_p:.1%}")

    core = ver["missingness_core"]
    fracs = [v["missing_frac"] for v in core.values() if v["present_in_schema"] >= 1.0]
    if fracs:
        avg = float(np.mean(fracs))
        if avg >= 0.90:
            fails.append(f"Core missingness avg too high (>=90%): {avg:.1%}")
        elif avg >= 0.60:
            warns.append(f"Core missingness avg high (>=60%): {avg:.1%}")
    else:
        warns.append("No core columns present to evaluate missingness.")

    if fails:
        return "FAIL", fails, warns
    if warns:
        return ("FAIL" if strict else "WARN"), fails, warns
    return "PASS", fails, warns


def render_md(summary: dict) -> str:
    lines = [
        "# QC Summary",
        "",
        f"- **Generated:** {summary['generated_at_utc']}",
        f"- **Verdict:** **{summary['verdict']}**",
        "",
        "## Counts",
        f"- Participants: **{summary['participants_count']}**",
        f"- Sessions: **{summary['sessions_count']}**",
        f"- Total windows: **{summary['total_windows']}**",
        "",
        "## Presence",
        f"- % windows with typing: **{summary['typing_presence']:.1%}**",
        f"- % windows with tapping: **{summary['tapping_presence']:.1%}**",
        "",
    ]

    if summary.get("fail_reasons"):
        lines += ["## Fail reasons"] + [f"- {r}" for r in summary["fail_reasons"]] + [""]

    if summary.get("warn_reasons"):
        lines += ["## Warn reasons"] + [f"- {r}" for r in summary["warn_reasons"]] + [""]

    lines.append("## Missingness (core features)")
    lines.append("")
    for col, info in summary["missingness_core"].items():
        present = "present" if info["present_in_schema"] >= 1.0 else "MISSING COLUMN"
        lines.append(f"- `{col}`: {present}, missing={info['missing_frac']:.1%}")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    raw_sessions_dir = Path(args.raw_sessions_dir)
    reports_dir = Path(args.reports_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)

    core_features = [c.strip() for c in args.core_features.split(",") if c.strip()]
    auth_files = find_auth_files(raw_sessions_dir)

    if not auth_files:
        summary = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "raw_sessions_dir": str(raw_sessions_dir),
            "auth_windows_files_found": 0,
            "participants_count": 0,
            "sessions_count": 0,
            "total_windows": 0,
            "windows_per_session": {},
            "typing_presence": 0.0,
            "tapping_presence": 0.0,
            "typing_presence_source": "none",
            "tapping_presence_source": "none",
            "missingness_core": {c: {"present_in_schema": 0.0, "missing_frac": 1.0} for c in core_features},
            "verdict": "FAIL",
            "fail_reasons": ["No auth_windows.csv files found."],
            "warn_reasons": [],
        }
    else:
        df = load_auth(auth_files)
        wps = windows_per_session(auth_files)
        participants = int(df["participantId"].nunique(dropna=True)) if "participantId" in df.columns else 0
        typing_presence, typing_src = inferred_presence_frac(
            df, "has_typing", ["typing_ikt_global_mean", "typing_ikt_within_mean", "ikt_mean"]
        )
        tapping_presence, tapping_src = inferred_presence_frac(
            df, "has_tapping", ["tap_rt_mean"]
        )

        summary = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "raw_sessions_dir": str(raw_sessions_dir),
            "auth_windows_files_found": len(auth_files),
            "participants_count": participants,
            "sessions_count": len(auth_files),
            "total_windows": int(len(df)),
            "windows_per_session": wps,
            "typing_presence": typing_presence,
            "tapping_presence": tapping_presence,
            "typing_presence_source": typing_src,
            "tapping_presence_source": tapping_src,
            "missingness_core": missingness_report(df, core_features),
        }
        verdict, fails, warns = gate(summary, strict=args.strict)
        summary["verdict"] = verdict
        summary["fail_reasons"] = fails
        summary["warn_reasons"] = warns

    (reports_dir / "qc_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (reports_dir / "qc_summary.md").write_text(render_md(summary), encoding="utf-8")

    print(f"Wrote {reports_dir / 'qc_summary.json'}")
    print(f"Wrote {reports_dir / 'qc_summary.md'}")
    print(f"Verdict: {summary['verdict']}")
    return 0 if summary["verdict"] in ("PASS", "WARN") else 1


if __name__ == "__main__":
    raise SystemExit(main())
