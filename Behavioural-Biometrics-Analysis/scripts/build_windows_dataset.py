#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd


DEFAULT_FEATURES = [
    "schemaVersion",
    "user_id",
    "session_order",
    "session_date",
    "device_family",
    "window_duration_ms",
    "n_key_events",
    "n_tap_hits",
    "n_tap_misses",
    "is_low_activity_window",
    "typing_ikt_global_mean",
    "typing_ikt_global_std",
    "typing_ikt_within_mean",
    "typing_ikt_within_std",
    "tap_rt_mean",
    "tap_rt_std",
    "typing_drift_ikt",
    "tap_drift_rt",
    "tap_miss_rate_pct",
    "coupling_var_ikt",
    "coupling_var_rt",
    "coupling_var_ratio",
]

PRESENCE = ["has_typing", "has_tapping"]
IDS = ["participantId", "sessionId", "windowIndex"]
REQUIRED_SCHEMA_COLUMNS = [
    "schemaVersion",
    "user_id",
    "session_order",
    "session_date",
    "device_family",
    "window_duration_ms",
    "n_key_events",
    "n_tap_hits",
    "n_tap_misses",
    "is_low_activity_window",
    "has_typing",
    "has_tapping",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--raw-sessions-dir", type=str, default="data/raw/sessions")
    p.add_argument("--out-dir", type=str, default="data/processed")
    p.add_argument("--out-parquet", type=str, default="windows.parquet")
    p.add_argument("--write-csv", action="store_true")
    p.add_argument("--features", type=str, default=",".join(DEFAULT_FEATURES))
    p.add_argument("--required-schema-version", type=int, default=2)
    return p.parse_args()


def fit_slope(x: np.ndarray, y: np.ndarray) -> Optional[float]:
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    if len(x) < 2 or np.allclose(x, x[0]):
        return None
    vx = np.var(x)
    if vx <= 0:
        return None
    return float(np.cov(x, y, bias=True)[0, 1] / vx)


def compute_session_slopes(df: pd.DataFrame) -> Tuple[Optional[float], Optional[float]]:
    x = pd.to_numeric(df["windowIndex"], errors="coerce").to_numpy(dtype=float)
    t_slope = None
    p_slope = None
    typing_col = "typing_ikt_global_mean" if "typing_ikt_global_mean" in df.columns else "ikt_mean"
    if typing_col in df.columns:
        y = pd.to_numeric(df[typing_col], errors="coerce").to_numpy(dtype=float)
        t_slope = fit_slope(x, y)
    if "tap_rt_mean" in df.columns:
        y = pd.to_numeric(df["tap_rt_mean"], errors="coerce").to_numpy(dtype=float)
        p_slope = fit_slope(x, y)
    return t_slope, p_slope


def coerce_presence(df: pd.DataFrame) -> pd.DataFrame:
    if "has_typing" not in df.columns:
        typing_col = "typing_ikt_global_mean" if "typing_ikt_global_mean" in df.columns else "ikt_mean"
        if typing_col in df.columns:
            df["has_typing"] = pd.to_numeric(df[typing_col], errors="coerce").notna()
        else:
            df["has_typing"] = False
    else:
        df["has_typing"] = df["has_typing"].map(
            lambda v: str(v).strip().lower() in ("1", "true", "t", "yes", "y")
        ).fillna(False)

    if "has_tapping" not in df.columns:
        if "tap_rt_mean" in df.columns:
            df["has_tapping"] = pd.to_numeric(df["tap_rt_mean"], errors="coerce").notna()
        else:
            df["has_tapping"] = False
    else:
        df["has_tapping"] = df["has_tapping"].map(
            lambda v: str(v).strip().lower() in ("1", "true", "t", "yes", "y")
        ).fillna(False)
    return df


def build_session(session_dir: Path, keep_features: List[str], required_schema_version: int) -> Optional[pd.DataFrame]:
    auth = session_dir / "auth_windows.csv"
    if not auth.exists():
        return None

    df = pd.read_csv(auth)
    sid = session_dir.name

    missing_required = [c for c in REQUIRED_SCHEMA_COLUMNS if c not in df.columns]
    if missing_required:
        raise ValueError(f"{sid}: missing required schema columns: {missing_required}")
    schema_v = pd.to_numeric(df["schemaVersion"], errors="coerce")
    if schema_v.isna().any() or not (schema_v == required_schema_version).all():
        raise ValueError(f"{sid}: schemaVersion must be {required_schema_version}")

    if "sessionId" not in df.columns:
        df["sessionId"] = sid
    df["sessionId"] = df["sessionId"].fillna(sid).astype(str)

    if "windowIndex" not in df.columns:
        df["windowIndex"] = np.arange(len(df), dtype=int)

    if "participantId" not in df.columns:
        df["participantId"] = pd.NA

    df = coerce_presence(df)

    t_slope, p_slope = compute_session_slopes(df)
    df["typing_fatigue_slope"] = t_slope
    df["tapping_fatigue_slope"] = p_slope

    keep = [c for c in IDS if c in df.columns] + [c for c in PRESENCE if c in df.columns]
    keep += [c for c in keep_features if c in df.columns and c not in keep]
    keep += ["typing_fatigue_slope", "tapping_fatigue_slope"]

    out = df[keep].copy()
    out["windowIndex"] = pd.to_numeric(out["windowIndex"], errors="coerce").astype("Int64")
    out["schemaVersion"] = pd.to_numeric(out["schemaVersion"], errors="coerce").astype("Int64")
    out["session_order"] = pd.to_numeric(out["session_order"], errors="coerce").astype("Int64")
    for c in ["n_key_events", "n_tap_hits", "n_tap_misses", "window_duration_ms"]:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce").astype("Int64")
    return out


def main() -> int:
    args = parse_args()
    raw = Path(args.raw_sessions_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    keep_features = [c.strip() for c in args.features.split(",") if c.strip()]

    session_dirs = sorted([p for p in raw.iterdir() if p.is_dir()]) if raw.exists() else []
    frames = []

    for sdir in session_dirs:
        df = build_session(sdir, keep_features, args.required_schema_version)
        if df is not None and len(df) > 0:
            frames.append(df)

    if not frames:
        print("No windows built (no auth_windows.csv found).")
        return 1

    windows = pd.concat(frames, ignore_index=True)
    sort_cols = [c for c in ["participantId", "sessionId", "windowIndex"] if c in windows.columns]
    if sort_cols:
        windows = windows.sort_values(sort_cols, kind="mergesort").reset_index(drop=True)

    parquet_ok = True
    out_parquet = out_dir / args.out_parquet
    try:
        windows.to_parquet(out_parquet, index=False)
        print(f"Wrote {out_parquet} ({len(windows)} rows)")
    except ImportError as e:
        parquet_ok = False
        print(f"Parquet skipped: {e}")

    if args.write_csv:
        out_csv = out_dir / "windows.csv"
        windows.to_csv(out_csv, index=False)
        print(f"Wrote {out_csv}")

    if not parquet_ok and not args.write_csv:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
