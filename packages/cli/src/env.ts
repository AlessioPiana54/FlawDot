import { join, resolve } from "node:path";

const MIN_NODE_MAJOR = 24;

/**
 * Null when this Node can run FlawDot, else the message to show. A version that cannot be read is refused: better a
 * message now than an error from the middle of the code (the built-in SQLite and the other APIs need 24).
 */
export function checkNode(version: string): string | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return null;
  return `FlawDot needs Node.js ${String(MIN_NODE_MAJOR)} or newer (you have ${version}). Install the LTS from nodejs.org.`;
}

/**
 * Where FlawDot keeps what it makes: screenshots and, later, the database and the saved logins. `FLAWDOT_HOME` if it is
 * set, else `.flawdot` in the home of the user. It is read here and nowhere else.
 */
export function resolveHome(
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): string {
  const chosen = env["FLAWDOT_HOME"]?.trim();
  return chosen === undefined || chosen === ""
    ? resolve(join(homedir, ".flawdot"))
    : resolve(chosen);
}
