import * as z from "zod";
import { aiTierSchema, reportLanguageSchema, viewportNameSchema } from "./domain.js";
import { DEFAULT_WEIGHTS, categoryWeightsSchema } from "./scoring.js";

// Settings are domain data that both the plugins (capture limits) and the ports (the settings repository)
// need, so they live here and not in either of them.

/** How much of a page is captured. The user can raise these, at a cost in time and money. */
export const captureLimitsSchema = z.strictObject({
  maxElements: z.int().min(20).max(1000),
  maxHeight: z.int().min(1000).max(50000), // CSS pixels
});
export type CaptureLimits = z.infer<typeof captureLimitsSchema>;

/** The settings of the whole app (one set, not one per project). Strict: an unknown key is an error. */
export const settingsSchema = z.strictObject({
  weights: categoryWeightsSchema,
  defaultLanguage: reportLanguageSchema,
  aiTier: aiTierSchema,
  viewports: z
    .array(viewportNameSchema)
    .min(1)
    .refine((names) => new Set(names).size === names.length, {
      message: "A viewport appears twice",
    }),
  captureLimits: captureLimitsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

/** A new, mutable copy of the default settings: what a repository returns before the user has changed anything. */
export function defaultSettings(): Settings {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    defaultLanguage: "en",
    aiTier: "accurate",
    viewports: ["desktop", "mobile"],
    captureLimits: { maxElements: 300, maxHeight: 15000 },
  };
}

/** The defaults, frozen all the way down so that nobody can change them by accident. */
export const DEFAULT_SETTINGS: Readonly<Settings> = (() => {
  const settings = defaultSettings();
  Object.freeze(settings.weights);
  Object.freeze(settings.viewports);
  Object.freeze(settings.captureLimits);
  return Object.freeze(settings);
})();
