import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { INITIALIZE, INITIALIZED, fakeIo, rpc, type FakeIo } from "./support/io.js";

// The first test loads the browser driver, the image library and the SDK: more than the default 5 s on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let current: FakeIo | undefined;
const setup = (...args: Parameters<typeof fakeIo>): FakeIo => {
  current = fakeIo(...args);
  return current;
};
afterEach(() => {
  current?.cleanup();
  current = undefined;
});

describe("main: the arguments", () => {
  it.each([["--version"], ["-v"]])("prints the version on stdout for %s", async (flag) => {
    const fake = setup();

    const code = await main([flag], fake.io, "1.2.3");

    expect(code).toBe(0);
    expect(fake.written()).toBe("1.2.3\n");
    expect(fake.errors).toEqual([]);
  });

  it.each([["--help"], ["-h"]])("prints how to use it on stdout for %s", async (flag) => {
    const fake = setup();

    const code = await main([flag], fake.io, "1.2.3");

    expect(code).toBe(0);
    expect(fake.written()).toContain("flawdot mcp");
    expect(fake.written()).toContain("--version");
    expect(fake.errors).toEqual([]);
  });

  it("says the web app is not there yet when there is no command, and points to mcp", async () => {
    const fake = setup();

    const code = await main([], fake.io, "1.2.3");

    expect(code).toBe(1);
    expect(fake.errors.join("")).toContain("not available yet");
    expect(fake.errors.join("")).toContain("flawdot mcp");
    expect(fake.written()).toBe("");
  });

  it.each([
    ["an option it does not know", ["--port", "80"]],
    ["a command it does not know", ["serve"]],
    ["more than the command", ["mcp", "extra"]],
  ])("refuses %s with the usage on stderr, and writes nothing on stdout", async (_label, argv) => {
    const fake = setup();

    const code = await main(argv, fake.io, "1.2.3");

    expect(code).toBe(1);
    expect(fake.errors.join("")).toContain("Usage:");
    expect(fake.written()).toBe("");
  });

  it("refuses an old Node with the message and does not look at the arguments", async () => {
    const fake = setup({ nodeVersion: "22.11.0" });

    const code = await main(["--version"], fake.io, "1.2.3");

    expect(code).toBe(1);
    expect(fake.errors.join("")).toBe(
      "FlawDot needs Node.js 24 or newer (you have 22.11.0). Install the LTS from nodejs.org.\n",
    );
    expect(fake.written()).toBe("");
  });
});

describe("main: flawdot mcp, over real pipes", () => {
  it("answers a client that connects, lists the tools, and ends with 0 when the client closes the pipe", async () => {
    const fake = setup();
    const running = main(["mcp"], fake.io, "1.2.3");

    fake.stdin.write(INITIALIZE);
    const initialized = await fake.message((message) => message["id"] === 1);
    fake.stdin.write(INITIALIZED);
    fake.stdin.write(rpc({ id: 2, method: "tools/list", params: {} }));
    const listed = await fake.message((message) => message["id"] === 2);
    fake.stdin.end();
    const code = await running;

    expect(code).toBe(0);
    const result = initialized["result"] as { serverInfo: { name: string; version: string } };
    expect(result.serverInfo).toMatchObject({ name: "flawdot", version: "1.2.3" });
    const tools = (listed["result"] as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools.sort()).toEqual(["flawdot_analyze", "flawdot_next"]);
  });

  it("writes only protocol messages to stdout, and nothing to stderr, in a whole session", async () => {
    const fake = setup();
    const running = main(["mcp"], fake.io, "1.2.3");

    fake.stdin.write(INITIALIZE);
    await fake.message((message) => message["id"] === 1);
    fake.stdin.write(INITIALIZED);
    fake.stdin.write(
      rpc({
        id: 3,
        method: "tools/call",
        params: { name: "flawdot_analyze", arguments: { url: "file:///etc/passwd" } },
      }),
    );
    const refused = await fake.message((message) => message["id"] === 3);
    fake.stdin.end();
    await running;

    expect((refused["result"] as { isError: boolean }).isError).toBe(true);
    for (const line of fake
      .written()
      .split("\n")
      .filter((text) => text.trim() !== "")) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    }
    expect(fake.errors).toEqual([]);
  });

  it("stops with 0 on a signal, and stops listening for it", async () => {
    const fake = setup();
    const running = main(["mcp"], fake.io, "1.2.3");
    fake.stdin.write(INITIALIZE);
    await fake.message((message) => message["id"] === 1);
    expect(fake.listeners()).toBe(1);

    fake.signal();

    expect(await running).toBe(0);
    expect(fake.listeners()).toBe(0);
  });
});
