import { homedir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemIo } from "../src/io.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("systemIo: the one place that reads the process", () => {
  it("gives the environment, the Node version, the home and the standard streams of the process", () => {
    const io = systemIo();

    expect(io.env).toBe(process.env);
    expect(io.nodeVersion).toBe(process.versions.node);
    expect(io.homedir()).toBe(homedir());
    expect(io.stdin).toBe(process.stdin);
    expect(io.stdout).toBe(process.stdout);
  });

  it("writes an error line to stderr and not to stdout", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, "write");

    systemIo().err("a line\n");

    expect(stderr).toHaveBeenCalledWith("a line\n");
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)("calls back on %s, once", (signal) => {
    const callback = vi.fn();
    const stop = systemIo().onSignal(callback);
    try {
      process.emit(signal);
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it("stops calling back when told to stop listening", () => {
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");

    const stop = systemIo().onSignal(() => undefined);
    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(before + 2);
    stop();

    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(before);
  });
});
