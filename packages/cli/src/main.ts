import { parseArgs } from "node:util";
import { checkNode, resolveHome } from "./env.js";
import type { Io } from "./io.js";

const USAGE = [
  "Usage:",
  "  flawdot mcp         Serve Claude Code over MCP, on stdin and stdout",
  "  flawdot --version   Print the version",
  "  flawdot --help      Print this help",
  "",
].join("\n");

/**
 * The command line. Gives the exit code and never calls `process.exit`: whoever runs it decides. Everything heavy (the
 * browser, the image library, the MCP SDK) is loaded only when a command needs it, so `--help` is quick and a Node that is
 * too old gets its message before anything is loaded that it could not run.
 */
export async function main(argv: readonly string[], io: Io, version: string): Promise<number> {
  const tooOld = checkNode(io.nodeVersion);
  if (tooOld !== null) {
    io.err(`${tooOld}\n`);
    return 1;
  }

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    io.stdout.write(`${version}\n`);
    return 0;
  }
  if (values.help) {
    io.stdout.write(USAGE);
    return 0;
  }

  const [command, ...rest] = positionals;
  if (command === undefined) {
    io.err(`The web app is not available yet. Use \`flawdot mcp\`.\n\n${USAGE}`);
    return 1;
  }
  if (command !== "mcp" || rest.length > 0) {
    io.err(`Unknown command: ${[command, ...rest].join(" ")}\n\n${USAGE}`);
    return 1;
  }

  const { composeCore } = await import("./compose-core.js");
  const { runMcp } = await import("./run-mcp.js");
  return runMcp({
    core: composeCore({ home: resolveHome(io.env, io.homedir()) }),
    version,
    io,
  });
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}
