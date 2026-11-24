import { homedir } from "node:os";
import type { Readable, Writable } from "node:stream";

/**
 * What the command line needs of the process it runs in. `systemIo()` is the one place that reads `process`, so a test
 * gives pipes and a fake environment and runs `main` inside the test process.
 */
export interface Io {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion: string;
  homedir(): string;
  /** The channel of the protocol in `flawdot mcp`: Claude Code writes to stdin and reads stdout. */
  readonly stdin: Readable;
  readonly stdout: Writable;
  /** A line for the user (the log, and the errors). It goes to stderr: stdout is for the protocol. */
  err(text: string): void;
  /** Calls `callback` at the first Ctrl+C or termination signal. Gives back what stops listening. */
  onSignal(callback: () => void): () => void;
}

export function systemIo(): Io {
  return {
    env: process.env,
    nodeVersion: process.versions.node,
    homedir,
    stdin: process.stdin,
    stdout: process.stdout,
    err: (text) => {
      process.stderr.write(text);
    },
    onSignal(callback) {
      process.once("SIGINT", callback);
      process.once("SIGTERM", callback);
      return () => {
        process.off("SIGINT", callback);
        process.off("SIGTERM", callback);
      };
    },
  };
}
