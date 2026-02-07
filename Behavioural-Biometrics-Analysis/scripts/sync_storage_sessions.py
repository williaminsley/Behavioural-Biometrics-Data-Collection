from pathlib import Path
from google.cloud import storage

# ---------------- CONFIG ----------------
BUCKET_NAME = "behavioural-biometrics-b52e4.firebasestorage.app"
REMOTE_PREFIX = "sessions/"
LOCAL_ROOT = Path("../data/raw/sessions")  # relative to scripts/
REQUIRED_FILES = ["auth_windows.csv", "events.csv"]
# ----------------------------------------

def main():
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)

    print("Listing sessions in bucket...")

    blobs = list(client.list_blobs(bucket, prefix=REMOTE_PREFIX))

    session_ids = set()
    for b in blobs:
        parts = b.name.split("/")
        if len(parts) >= 3:
            session_ids.add(parts[1])

    print(f"Found {len(session_ids)} session(s)")

    for sid in sorted(session_ids):
        local_dir = LOCAL_ROOT / sid
        local_dir.mkdir(parents=True, exist_ok=True)

        for fname in REQUIRED_FILES:
            blob_path = f"{REMOTE_PREFIX}{sid}/{fname}"
            local_path = local_dir / fname

            if local_path.exists():
                continue

            blob = bucket.blob(blob_path)
            if blob.exists():
                blob.download_to_filename(local_path)
                print(f"Downloaded {blob_path}")
            else:
                print(f"Missing {blob_path}")

    print("Done.")

if __name__ == "__main__":
    main()