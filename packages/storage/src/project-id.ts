import { httpUrlSchema, parseOrThrow, projectIdSchema, type ProjectId } from "@flawdot/core-model";

/**
 * The project of a site: its canonical origin and its id. The id is the host name, and "-<port>" when the port
 * is not the default one of the scheme ("localhost-3000", "example.com-8443"), so http and https of the same
 * host are one project, and two ports are two. Path, query, credentials and letter case play no part.
 * Throws `INVALID_INPUT` for anything that is not an http(s) URL with a host name (an IPv6 address has none).
 */
export function projectFromOrigin(origin: string): { id: ProjectId; origin: string } {
  const valid = parseOrThrow(httpUrlSchema, origin, { what: "origin" });
  const url = new URL(valid);
  const host = url.hostname.replace(/\.+$/, "");
  const id = parseOrThrow(projectIdSchema, url.port === "" ? host : `${host}-${url.port}`, {
    what: "project id",
  });
  return { id, origin: url.origin };
}
