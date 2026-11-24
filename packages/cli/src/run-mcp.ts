import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { composeMcp } from "./compose-mcp.js";
import type { CoreGraph } from "./compose-core.js";
import type { Io } from "./io.js";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * `flawdot mcp`: serves Claude Code on stdin and stdout until the client closes the pipe or the user stops the process.
 * Then it stops in order: the server first (it cancels the run that is going, and what was captured stays saved), the
 * browser after it. Gives the exit code: 0, or 1 if it could not start or could not close cleanly. It writes to stderr
 * only: stdout is the protocol, and one stray line there breaks the client.
 */
export async function runMcp(deps: {
  readonly core: CoreGraph;
  readonly version: string;
  readonly io: Io;
}): Promise<number> {
  const { core, io } = deps;
  const log = (line: string): void => {
    io.err(`${line}\n`);
  };
  const server = composeMcp(core, { version: deps.version, log });

  let stopListening = (): void => undefined;
  const signalled = new Promise<void>((resolve) => {
    stopListening = io.onSignal(resolve);
  });

  let code = 0;
  try {
    await server.start(new StdioServerTransport(io.stdin, io.stdout));
    await Promise.race([server.closed, signalled]);
  } catch (error) {
    log(`FlawDot could not serve: ${describe(error)}`);
    code = 1;
  } finally {
    stopListening();
    for (const [what, close] of [
      ["the server", () => server.stop()],
      ["the browser", () => core.close()],
    ] as const) {
      try {
        await close();
      } catch (error) {
        log(`FlawDot could not close ${what}: ${describe(error)}`);
        code = 1;
      }
    }
  }
  return code;
}
