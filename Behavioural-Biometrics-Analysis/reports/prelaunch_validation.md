# Prelaunch Validation

- **Generated:** 2026-02-10T16:18:35.600883+00:00
- **Verdict:** **FAIL**
- **Sessions scanned:** 3
- **Participants found:** 1

## Global checks
- PASS: sessions 3 >= 2
- PASS: participants 1 >= 1

## Session checks
- `3be79cb28ce24d35b5b4c16cc51f8aac`: FAIL
  - auth missing columns: ['device_family', 'has_tapping', 'has_typing', 'is_low_activity_window', 'n_key_events', 'n_tap_hits', 'n_tap_misses', 'schemaVersion', 'session_date', 'session_order', 'user_id', 'window_duration_ms']
  - events missing columns: ['schemaVersion']
- `b30211d252ca488692fd9dec68fbf740`: FAIL
  - auth missing columns: ['device_family', 'has_tapping', 'has_typing', 'is_low_activity_window', 'n_key_events', 'n_tap_hits', 'n_tap_misses', 'schemaVersion', 'session_date', 'session_order', 'user_id', 'window_duration_ms']
  - events missing columns: ['schemaVersion']
- `cf7e7dad28b94d1f849c4e5e9eb7bc45`: FAIL
  - auth missing columns: ['device_family', 'has_tapping', 'has_typing', 'is_low_activity_window', 'n_key_events', 'n_tap_hits', 'n_tap_misses', 'schemaVersion', 'session_date', 'session_order', 'user_id', 'window_duration_ms']
  - events missing columns: ['schemaVersion']
