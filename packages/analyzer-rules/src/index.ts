// Public API of @flawdot/analyzer-rules: only what is exported here is contract.
export { createAxeAnalyzer, type AxeAnalyzerDeps } from "./analyzer.js";
export { emptyCatalog, type RuleCatalog, type RuleText } from "./catalog.js";
export { defaultCatalog } from "./default-catalog.js";
export { WCAG_CRITERIA, type WcagCriteriaTable } from "./wcag-criteria.js";
