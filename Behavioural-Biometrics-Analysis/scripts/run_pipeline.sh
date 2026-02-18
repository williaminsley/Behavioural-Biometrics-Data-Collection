#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="python3"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  if "$ROOT/.venv/bin/python" - <<'PY' >/dev/null 2>&1
import importlib
for m in ("numpy", "pandas", "google.cloud.storage"):
    importlib.import_module(m)
PY
  then
    PYTHON_BIN="$ROOT/.venv/bin/python"
  fi
fi

mkdir -p reports data/processed
echo "Using Python: $PYTHON_BIN"

echo "1) Syncing Firebase Storage sessions (optional)"
if "$PYTHON_BIN" scripts/sync_storage_sessions.py; then
  echo "Sync complete."
else
  echo "WARNING: Storage sync failed; continuing with local data."
fi

echo "2) Running prelaunch session validation"
"$PYTHON_BIN" scripts/validate_raw_sessions.py --raw-sessions-dir data/raw/sessions --reports-dir reports

echo "3) Running QC checks"
"$PYTHON_BIN" scripts/run_qc.py --raw-sessions-dir data/raw/sessions --reports-dir reports

echo "4) Building modelling dataset"
"$PYTHON_BIN" scripts/build_windows_dataset.py --raw-sessions-dir data/raw/sessions --out-dir data/processed --write-csv

echo "Pipeline complete."
