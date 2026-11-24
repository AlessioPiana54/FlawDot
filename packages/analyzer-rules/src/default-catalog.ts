import { createRequire } from "node:module";
import { createRuleCatalog, type RuleCatalog } from "./catalog.js";
import en from "./catalog/en.json" with { type: "json" };
import it from "./catalog/it.json" with { type: "json" };

// The only place that loads the data. axe-core has no `exports` field, so its Italian file is reached as a plain
// subpath; it is a pinned dependency of this package (the same axe that runs on the page).
const axeItalian: unknown = createRequire(import.meta.url)("axe-core/locales/it.json");

/**
 * The catalog that FlawDot ships: 30 rules in English and in Italian, then the Italian of axe. It is built when the
 * module is loaded, so a catalog that is wrong stops the program at start, never in the middle of an analysis.
 */
export const defaultCatalog: RuleCatalog = createRuleCatalog({ own: { en, it }, axeItalian });
