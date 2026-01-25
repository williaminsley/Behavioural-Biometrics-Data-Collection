// analysis.js
// Barrel file – keeps app.js imports stable

export {
  computeSummary,
  computeSessionFeatures,
  computeSessionFlags,
  generateWindows
} from "./analysis.features.js";

export {
  summaryToCSVRow,
  downloadCSV,
  flattenFeaturesForAuth,
  authFeaturesToCSVRow
} from "./analysis.export.js";

export {
  renderSessionReport
} from "./analysis.ui.js";