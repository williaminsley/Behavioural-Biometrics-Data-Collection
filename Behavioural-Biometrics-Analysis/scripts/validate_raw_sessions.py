#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


AUTH_REQUIRED = {
    "schemaVersion",
    "sessionId",
    "participantId",
    "user_id",
    "session_order",
    "session_date",
    "device_family",
    "windowIndex",
    "windowStartMs",
    "windowEndMs",
    "window_duration_ms",
    "n_key_events",
    "n_tap_hits",
    "n_tap_misses",
    "is_low_activity_window",
    "has_typing",
    "has_tapping",
    "typing_ikt_global_mean",
    "tap_rt_mean",
}

EVENTS_REQUIRED = {"schemaVersion", "sessionId", "participantId", "t", "ms", "tISO"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--raw-sessions-dir", type=str, default="data/raw/sessions")
    p.add_argument("--reports-dir", type=str, default="reports")
    p.add_argument("--out-json", type=str, default="prelaunch_validation.json")
    p.add_argument("--out-md", type=str, default="prelaunch_validation.md")
    p.add_argument("--min-sessions", type=int, default=2)
    p.add_argument("--min-participants", type=int, default=1)
    p.add_argument("--min-windows-per-session", type=int, default=4)
    p.add_argument("--min-events-per-session", type=int, default=200)
    p.add_argument("--min-typing-submits", type=int, default=10)
    p.add_argument("--min-tap-hits", type=int, default=20)
    p.add_argument("--required-schema-version", type=int, default=2)
    return p.parse_args()


def check_session(
    session_dir: Path,
    min_windows: int,
    min_events: int,
    min_typing_submits: int,
    min_tap_hits: int,
    required_schema_version: int,
) -> Tuple[Dict[str, int], List[str], str]:
    sid = session_dir.name
    issues: List[str] = []

    auth_path = session_dir / "auth_windows.csv"
    events_path = session_dir / "events.csv"

    if not auth_path.exists():
        issues.append("missing auth_windows.csv")
    if not events_path.exists():
        issues.append("missing events.csv")
    if issues:
        return {"windows": 0, "events": 0, "typing_submits": 0, "tap_hits": 0}, issues, ""

    auth = pd.read_csv(auth_path)
    events = pd.read_csv(events_path)

    missing_auth = sorted(AUTH_REQUIRED - set(auth.columns))
    missing_events = sorted(EVENTS_REQUIRED - set(events.columns))
    if missing_auth:
        issues.append(f"auth missing columns: {missing_auth}")
    if missing_events:
        issues.append(f"events missing columns: {missing_events}")

    if "sessionId" in auth.columns and (auth["sessionId"].astype(str) != sid).any():
        issues.append("auth sessionId differs from folder name")
    if "sessionId" in events.columns and (events["sessionId"].astype(str) != sid).any():
        issues.append("events sessionId differs from folder name")
    if "schemaVersion" in auth.columns:
        versions = pd.to_numeric(auth["schemaVersion"], errors="coerce")
        bad = versions.isna() | (versions != required_schema_version)
        if bad.any():
            issues.append(f"auth schemaVersion must be {required_schema_version}")
    if "schemaVersion" in events.columns:
        versions = pd.to_numeric(events["schemaVersion"], errors="coerce")
        bad = versions.isna() | (versions != required_schema_version)
        if bad.any():
            issues.append(f"events schemaVersion must be {required_schema_version}")

    pid = ""
    if "participantId" in auth.columns:
        pids = sorted(auth["participantId"].dropna().astype(str).unique().tolist())
        if len(pids) > 1:
            issues.append("multiple participantId values in auth")
        elif pids:
            pid = pids[0]
    if "participantId" in events.columns:
        pids_e = sorted(events["participantId"].dropna().astype(str).unique().tolist())
        if len(pids_e) > 1:
            issues.append("multiple participantId values in events")
        if pid and pids_e and pid not in pids_e:
            issues.append("participantId mismatch between auth and events")

    if {"windowStartMs", "windowEndMs"}.issubset(auth.columns):
        dur = pd.to_numeric(auth["windowEndMs"], errors="coerce") - pd.to_numeric(
            auth["windowStartMs"], errors="coerce"
        )
        if not (dur == 30000).all():
            issues.append("window durations are not all 30000 ms")
    if "window_duration_ms" in auth.columns:
        wd = pd.to_numeric(auth["window_duration_ms"], errors="coerce")
        if wd.isna().any() or not (wd == 30000).all():
            issues.append("window_duration_ms must be 30000 for all windows")

    for c in ["n_key_events", "n_tap_hits", "n_tap_misses"]:
        if c in auth.columns:
            x = pd.to_numeric(auth[c], errors="coerce")
            if x.isna().any() or (x < 0).any():
                issues.append(f"{c} must be non-negative numeric")

    for c in ["has_typing", "has_tapping", "is_low_activity_window"]:
        if c in auth.columns:
            vals = auth[c].astype(str).str.strip().str.lower()
            ok = vals.isin({"1", "0", "true", "false", "t", "f", "yes", "no", "y", "n"})
            if not ok.all():
                issues.append(f"{c} has non-boolean values")

    if {"windowIndex", "windowStartMs"}.issubset(auth.columns):
        sorted_auth = auth.sort_values("windowIndex")
        if sorted_auth["windowIndex"].duplicated().any():
            issues.append("duplicate windowIndex values")
        if len(sorted_auth) > 1:
            steps = pd.to_numeric(sorted_auth["windowStartMs"], errors="coerce").diff().dropna().to_numpy()
            if not np.all(steps == 15000):
                issues.append("window starts are not all 15000 ms apart")

    if "ms" in events.columns:
        ms = pd.to_numeric(events["ms"], errors="coerce")
        if ms.isna().any():
            issues.append("events has non-numeric ms values")
        elif (ms.diff().dropna() < 0).any():
            issues.append("events ms is not monotonic nondecreasing")

    if "tISO" in events.columns:
        parsed = pd.to_datetime(events["tISO"], errors="coerce", utc=True)
        if len(parsed) and float(parsed.isna().mean()) > 0.02:
            issues.append("more than 2% invalid tISO values")

    typing_submits = int((events["t"] == "typing_submit").sum()) if "t" in events.columns else 0
    tap_hits = int((events["t"] == "tap_hit").sum()) if "t" in events.columns else 0
    windows = int(len(auth))
    event_rows = int(len(events))

    if windows < min_windows:
        issues.append(f"too few windows: {windows} < {min_windows}")
    if event_rows < min_events:
        issues.append(f"too few events: {event_rows} < {min_events}")
    if typing_submits < min_typing_submits:
        issues.append(f"too few typing_submit events: {typing_submits} < {min_typing_submits}")
    if tap_hits < min_tap_hits:
        issues.append(f"too few tap_hit events: {tap_hits} < {min_tap_hits}")

    stats = {
        "windows": windows,
        "events": event_rows,
        "typing_submits": typing_submits,
        "tap_hits": tap_hits,
    }
    return stats, issues, pid


def render_md(summary: dict) -> str:
    lines = [
        "# Prelaunch Validation",
        "",
        f"- **Generated:** {summary['generated_at_utc']}",
        f"- **Verdict:** **{summary['verdict']}**",
        f"- **Sessions scanned:** {summary['sessions_scanned']}",
        f"- **Participants found:** {summary['participants_found']}",
        "",
        "## Global checks",
    ]
    for c in summary["global_checks"]:
        lines.append(f"- {c}")
    lines.append("")

    lines.append("## Session checks")
    for sid, info in summary["sessions"].items():
        lines.append(f"- `{sid}`: {'PASS' if not info['issues'] else 'FAIL'}")
        if info["issues"]:
            for issue in info["issues"]:
                lines.append(f"  - {issue}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    raw = Path(args.raw_sessions_dir)
    reports = Path(args.reports_dir)
    reports.mkdir(parents=True, exist_ok=True)

    session_dirs = sorted([p for p in raw.iterdir() if p.is_dir()]) if raw.exists() else []

    session_summary: Dict[str, dict] = {}
    participants = set()
    global_checks: List[str] = []
    has_fail = False

    for sdir in session_dirs:
        stats, issues, pid = check_session(
            sdir,
            min_windows=args.min_windows_per_session,
            min_events=args.min_events_per_session,
            min_typing_submits=args.min_typing_submits,
            min_tap_hits=args.min_tap_hits,
            required_schema_version=args.required_schema_version,
        )
        if pid:
            participants.add(pid)
        session_summary[sdir.name] = {
            **stats,
            "issues": issues,
        }
        if issues:
            has_fail = True

    sessions_count = len(session_dirs)
    participants_count = len(participants)

    if sessions_count < args.min_sessions:
        global_checks.append(f"FAIL: sessions {sessions_count} < {args.min_sessions}")
        has_fail = True
    else:
        global_checks.append(f"PASS: sessions {sessions_count} >= {args.min_sessions}")

    if participants_count < args.min_participants:
        global_checks.append(f"FAIL: participants {participants_count} < {args.min_participants}")
        has_fail = True
    else:
        global_checks.append(f"PASS: participants {participants_count} >= {args.min_participants}")

    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "raw_sessions_dir": str(raw),
        "verdict": "FAIL" if has_fail else "PASS",
        "sessions_scanned": sessions_count,
        "participants_found": participants_count,
        "thresholds": {
            "required_schema_version": args.required_schema_version,
            "min_sessions": args.min_sessions,
            "min_participants": args.min_participants,
            "min_windows_per_session": args.min_windows_per_session,
            "min_events_per_session": args.min_events_per_session,
            "min_typing_submits": args.min_typing_submits,
            "min_tap_hits": args.min_tap_hits,
        },
        "global_checks": global_checks,
        "sessions": session_summary,
    }

    out_json = reports / args.out_json
    out_md = reports / args.out_md
    out_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    out_md.write_text(render_md(summary), encoding="utf-8")

    print(f"Wrote {out_json}")
    print(f"Wrote {out_md}")
    print(f"Verdict: {summary['verdict']}")
    return 1 if has_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
