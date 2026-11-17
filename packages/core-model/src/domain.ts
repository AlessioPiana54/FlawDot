import * as z from "zod";
import { markIdSchema, projectIdSchema, runIdSchema } from "./ids.js";

// Domain types are plain data: every type is derived from its schema (z.infer), so what is
// validated at runtime and what the compiler sees cannot drift apart.

const isoDateTime = z.iso.datetime();
const nonEmpty = z.string().min(1);

/**
 * http(s) URLs only: a file:, ftp: or javascript: URL is never a page we analyze. A URL with a user name or
 * a password ("https://user:secret@host/") is rejected too: URLs are stored, sent in events and exported, and
 * must never carry a credential.
 */
export const httpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((url) => !/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(url), {
    message: "URL must not contain a user name or a password",
  });

export const VIEWPORT_NAMES = ["desktop", "tablet", "mobile"] as const;
export const viewportNameSchema = z.enum(VIEWPORT_NAMES);
export type ViewportName = z.infer<typeof viewportNameSchema>;

export const viewportSchema = z.object({
  name: viewportNameSchema,
  width: z.int().positive(),
  height: z.int().positive(),
  deviceScaleFactor: z.number().positive().max(4),
});
export type Viewport = z.infer<typeof viewportSchema>;

/** Default viewports. The pixel ratio is 1: the AI does not need sharper screenshots. */
export const DEFAULT_VIEWPORTS: Readonly<Record<ViewportName, Viewport>> = {
  desktop: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  tablet: { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 },
  mobile: { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
};

export const CATEGORIES = ["ui", "ux", "accessibility", "conversion"] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

/** Most severe first: numbering and sorting rely on this order. */
export const SEVERITIES = ["critical", "medium", "low"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const REPORT_LANGUAGES = ["en", "it"] as const;
export const reportLanguageSchema = z.enum(REPORT_LANGUAGES);
export type ReportLanguage = z.infer<typeof reportLanguageSchema>;

export const AI_TIERS = ["accurate", "economy"] as const;
export const aiTierSchema = z.enum(AI_TIERS);
export type AiTier = z.infer<typeof aiTierSchema>;

/** Who does the AI analysis: nobody (rules only), the user's API key, or Claude Code through MCP. */
export const aiModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("byok"), model: nonEmpty, tier: aiTierSchema }),
  z.object({ kind: z.literal("subscription") }),
]);
export type AiMode = z.infer<typeof aiModeSchema>;

export const projectSchema = z.object({
  id: projectIdSchema,
  origin: httpUrlSchema, // "http://localhost:3000": the caller passes scheme, host and port only, no path is checked for
  createdAt: isoDateTime,
});
export type Project = z.infer<typeof projectSchema>;

export const pageTargetSchema = z.object({
  url: httpUrlSchema,
  templateKey: nonEmpty, // "/blog/:slug", or the path itself for a single page
  templateSize: z.int().positive(), // pages in the group (1 when alone)
});
export type PageTarget = z.infer<typeof pageTargetSchema>;

export const RUN_STATUSES = ["running", "completed", "cancelled", "partial"] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

const hasNoDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const runSchema = z
  .object({
    id: runIdSchema,
    projectId: projectIdSchema,
    startedAt: isoDateTime,
    finishedAt: isoDateTime.nullable(),
    entry: z.enum(["web", "mcp"]),
    ai: aiModeSchema,
    language: reportLanguageSchema,
    viewports: z.array(viewportSchema).min(1),
    pages: z.array(pageTargetSchema).min(1),
    // "running": still going. "completed": every page done. "cancelled": the user stopped it.
    // "partial": it ended, but some pages failed or were never reached.
    status: runStatusSchema,
  })
  .refine((run) => (run.status === "running") === (run.finishedAt === null), {
    message: "A run has an end time exactly when it is no longer running",
    path: ["finishedAt"],
  })
  .refine((run) => hasNoDuplicates(run.viewports.map((viewport) => viewport.name)), {
    message: "A viewport appears twice",
    path: ["viewports"],
  })
  .refine((run) => hasNoDuplicates(run.pages.map((page) => page.url)), {
    message: "A page appears twice",
    path: ["pages"],
  });
export type Run = z.infer<typeof runSchema>;

/** CSS pixels, coordinates of the whole page (not of the viewport). */
export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Box = z.infer<typeof boxSchema>;

export const ELEMENT_NAME_MAX = 120;
/** A CSS selector is built by the capture code and stored in every finding: a limit keeps it bounded. */
export const SELECTOR_MAX = 2000;

/**
 * Cuts an accessible name to `ELEMENT_NAME_MAX` characters, which `elementSchema` requires. The capture
 * adapter calls this before building an `Element`: the schema rejects a long name instead of cutting it,
 * and one long name must not fail a whole capture. Does not split a surrogate pair (an emoji) at the cut.
 */
export function truncateElementName(name: string): string {
  if (name.length <= ELEMENT_NAME_MAX) return name;
  const cut = name.slice(0, ELEMENT_NAME_MAX);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const endsInsideAPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff; // a high surrogate without its low half
  return endsInsideAPair ? cut.slice(0, -1) : cut;
}

export const elementSchema = z.object({
  mark: markIdSchema,
  selector: nonEmpty.max(SELECTOR_MAX), // unique CSS selector inside the page
  box: boxSchema,
  tag: nonEmpty,
  role: z.string().nullable(), // computed ARIA role
  name: z.string().max(ELEMENT_NAME_MAX).nullable(), // accessible name, at most 120 UTF-16 units (the capture adapter cuts it with truncateElementName)
});
export type Element = z.infer<typeof elementSchema>;

export const captureSchema = z
  .object({
    runId: runIdSchema,
    page: pageTargetSchema,
    viewport: viewportSchema,
    screenshot: z.object({
      path: nonEmpty,
      width: z.int().positive(),
      height: z.int().positive(),
    }),
    marked: z.object({ path: nonEmpty }), // same screenshot with the set-of-marks numbers drawn on it
    elements: z.array(elementSchema),
    title: z.string().nullable(),
    capturedAt: isoDateTime,
  })
  .refine((capture) => hasNoDuplicates(capture.elements.map((element) => String(element.mark))), {
    message: "Two elements have the same mark",
    path: ["elements"],
  });
export type Capture = z.infer<typeof captureSchema>;
