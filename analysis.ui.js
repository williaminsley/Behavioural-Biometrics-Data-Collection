// analysis.ui.js
// Human-readable session report

import {
  computeSummary,
  computeSessionFeatures,
  computeSessionFlags
} from "./analysis.features.js";

export function renderSessionReport(containerEl, session) {
  containerEl.innerHTML = "";

  const summary = computeSummary(session);
  const features = computeSessionFeatures(session);
  const { valid } = computeSessionFlags(session, features);

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify({ summary, features, valid }, null, 2);
  containerEl.appendChild(pre);
}