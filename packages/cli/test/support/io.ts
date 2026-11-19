import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Io } from "../../src/io.js";

export interface FakeIo {
  readonly io: Io;
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  /** What was written to stderr. */
  readonly errors: string[];
  /** Everything written to stdout so far. */
  written(): string;
  /** Pretends the user pressed Ctrl+C: calls what is listening. */
  signal(): void;
  listeners(): number;
  /** Resolves with the first JSON-RPC message that satisfies `matches`, from what was already written or what comes. */
  message(matches: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  /** The folder that stands for the home of the user, taken away by `cleanup`. */
  readonly home: string;
  cleanup(): void;
}

/** An `Io` made of pipes and a temporary folder, for running the command line inside a test. */
export function fakeIo(override: Partial<Io> = {}): FakeIo {
  const home = mkdtempSync(join(tmpdir(), "flawdot-cli-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.setEncoding("utf8");
  const errors: string[] = [];
  const callbacks = new Set<() => void>();
  let buffer = "";
  const waiting = new Set<() => void>();
  stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (const wake of waiting) wake();
  });

  const messages = (): Record<string, unknown>[] =>
    buffer
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  const io: Io = {
    env: { FLAWDOT_HOME: join(home, "flawdot") },
    nodeVersion: "24.0.0",
    homedir: () => home,
    stdin,
    stdout,
    err: (text) => errors.push(text),
    onSignal(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    ...override,
  };

  return {
    io,
    stdin,
    stdout,
    errors,
    written: () => buffer,
    signal: () => {
      for (const callback of callbacks) callback();
    },
    listeners: () => callbacks.size,
    message: (matches) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`no message arrived. Written so far: ${buffer}`));
        }, 15_000);
        const look = (): void => {
          const found = messages().find(matches);
          if (found !== undefined) {
            clearTimeout(timer);
            waiting.delete(look);
            resolve(found);
          }
        };
        waiting.add(look);
        look();
      }),
    home,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export const rpc = (message: Record<string, unknown>): string =>
  `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;

export const INITIALIZE = rpc({
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
});
export const INITIALIZED = rpc({ method: "notifications/initialized" });
