## 🔗 Live Demo
👉 https://williaminsley.github.io/Behavioural-Biometrics-Data-Collection/

# Behavioural Typing & Tapping Game

Browser-based behavioural data collection game built for MSc dissertation research.

## Purpose
To collect high-level behavioural metrics (reaction time, accuracy, inter-key timing, tapping performance)
in a controlled, ethical, browser-based environment.

## Data Collected
- Session metadata (timestamp, device info)
- Contextual variables (time of day, fatigue, input device, vibration, alcohol)
- Typing metrics (accuracy, score, mean inter-key time, backspaces)
- Tapping metrics (hits, misses, reaction time)
- Aggregate session scores

No raw typed text or personally identifiable information is stored.

## Tech Stack
- HTML / CSS / JavaScript (ES Modules)
- Client-side only (GitHub Pages compatible)

## Ethics
- Explicit user consent required before participation
- No keystroke content stored
- All data exportable by participant

## Using Codex with this project

You can use Codex as a coding teammate for this repository by giving it focused tasks and asking it to validate changes before committing.

### 1) Open Codex in the repo root
- Set your working directory to this repository root (`Behavioural-Biometrics-Data-Collection/`).
- Ask Codex to inspect the codebase first (for example: "Summarize project structure and data flow").

### 2) Typical prompts that work well
- "Add a short onboarding section to README for new contributors."
- "Refactor `docs/app.js` to reduce duplicated event binding logic without changing behavior."
- "Add input validation for contextual form fields and explain edge cases."
- "Run checks and show me exactly what changed with file citations."

### 3) Ask for safe, reviewable edits
- Request small, single-purpose commits.
- Ask Codex to explain tradeoffs before implementing larger refactors.
- Ask for a patch summary with file/line citations so review is quick.

### 4) Validate before merge
- Ask Codex to run any available checks (for this project, static inspection and browser smoke checks are most relevant).
- Ask it to summarize manual test steps for desktop and mobile interaction paths.

### 5) Good workflow pattern
1. "Plan the change in 3-5 steps."
2. "Implement step 1 only."
3. "Run checks and show diff summary."
4. "Proceed to next step."
5. "Prepare commit and PR message."

### 6) Repository-specific tips
- This is a client-side JavaScript app in `docs/`, so most changes are HTML/CSS/JS edits.
- Keep privacy constraints intact: do not introduce raw keystroke content capture or personal identifiers.
- Preserve GitHub Pages compatibility (static assets and relative paths).
