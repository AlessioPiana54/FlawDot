import * as z from "zod";

// ULID: 26 characters of Crockford base32, sortable by creation time. The first character is at most 7
// because the timestamp part has 48 bits.
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** One project per site: a host name, or `localhost-<port>`. Example: "example.com", "localhost-3000". */
export const projectIdSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9][a-z0-9.-]*$/,
    "Project ID must be a lowercase host name such as example.com or localhost-3000",
  )
  .brand<"ProjectId">();
export type ProjectId = z.infer<typeof projectIdSchema>;

/** ULID of an analysis run. */
export const runIdSchema = z.string().regex(ULID, "Run ID must be a ULID").brand<"RunId">();
export type RunId = z.infer<typeof runIdSchema>;

/** ULID of a finding. */
export const findingIdSchema = z
  .string()
  .regex(ULID, "Finding ID must be a ULID")
  .brand<"FindingId">();
export type FindingId = z.infer<typeof findingIdSchema>;

/** Set-of-marks number of an element, unique inside one capture. Starts at 1. */
export const markIdSchema = z.int().positive().brand<"MarkId">();
export type MarkId = z.infer<typeof markIdSchema>;
