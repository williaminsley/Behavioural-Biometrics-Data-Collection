#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p reports data/processed

echo "1) Syncing Firebase Storage sessions"
python3 scripts/sync_storage_sessions.py

echo "2) Running prelaunch session validation"
python3 scripts/validate_raw_sessions.py --raw-sessions-dir data/raw/sessions --reports-dir reports

echo "3) Running QC checks"
python3 scripts/run_qc.py --raw-sessions-dir data/raw/sessions --reports-dir reports

echo "4) Building modelling dataset"
python3 scripts/build_windows_dataset.py --raw-sessions-dir data/raw/sessions --out-dir data/processed --write-csv

echo "Pipeline complete."
