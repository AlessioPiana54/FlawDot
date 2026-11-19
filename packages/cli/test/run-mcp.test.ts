import type { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@flawdot/core-model";
import { runId } from "@flawdot/test-support";
import type { CoreGraph } from "../src/compose-core.js";
import { runMcp } from "../src/run-mcp.js";
import { INITIALIZE, INITIALIZED, fakeIo, rpc, type FakeIo } from "./support/io.js";

// The first test loads the browser driver, the image library and the SDK: more than the default 5 s on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let current: FakeIo | undefined;
afterEach(() => {
  current?.cleanup();
  current = undefined;
});
const setup = (...args: Parameters<typeof fakeIo>): FakeIo => {
  current = fakeIo(...args);
  return current;
};

const forever = (): Promise<never> => new Promise<never>(() => undefined);

/** A core whose kernel starts runs that never end by themselves, and that writes down what is closed and in what order. */
function fakeCore(close: () => Promise<void> = () => Promise.resolve()) {
  const order: string[] = [];
  const core: CoreGraph = {
    settings: { get: () => Promise.resolve(defaultSettings()) },
    createKernel: () => ({
      analyze: () => ({
        runId: runId(1),
        events: { [Symbol.asyncIterator]: () => ({ next: forever }) }, // a stream that never gives an event
        cancel: () => {
          order.push("cancel");
          return Promise.resolve();
        },
        done: forever(),
      }),
      report: () => Promise.reject(new Error("no report here")),
    }),
    close: async () => {
      order.push("close");
      await close();
    },
  };
  return { core, order };
}

async function connected(fake: FakeIo): Promise<void> {
  fake.stdin.write(INITIALIZE);
  await fake.message((message) => message["id"] === 1);
  fake.stdin.write(INITIALIZED);
}

describe("runMcp", () => {
  it("ends with 0 when the client closes the pipe, and closes the browser", async () => {
    const fake = setup();
    const { core, order } = fakeCore();
    const running = runMcp({ core, version: "1.0.0", io: fake.io });
    await connected(fake);

    fake.stdin.end();

    expect(await running).toBe(0);
    expect(order).toEqual(["close"]);
    expect(fake.errors).toEqual([]);
  });

  it("ends with 0 on a signal, and stops listening for signals", async () => {
    const fake = setup();
    const { core } = fakeCore();
    const running = runMcp({ core, version: "1.0.0", io: fake.io });
    await connected(fake);

    fake.signal();

    expect(await running).toBe(0);
    expect(fake.listeners()).toBe(0);
  });

  it("cancels the run that is going before it closes the browser", async () => {
    const fake = setup();
    const { core, order } = fakeCore();
    const running = runMcp({ core, version: "1.0.0", io: fake.io });
    await connected(fake);
    fake.stdin.write(
      rpc({
        id: 5,
        method: "tools/call",
        params: { name: "flawdot_analyze", arguments: { url: "http://localhost:3000/" } },
      }),
    );
    const started = await fake.message((message) => message["id"] === 5);
    expect((started["result"] as { isError?: boolean }).isError).toBeFalsy();

    fake.signal();
    await running;

    expect(order).toEqual(["cancel", "close"]);
  });

  it("ends with 1, and says so on stderr, when the browser cannot be closed", async () => {
    const fake = setup();
    const { core } = fakeCore(() => Promise.reject(new Error("chrome is stuck")));
    const running = runMcp({ core, version: "1.0.0", io: fake.io });
    await connected(fake);

    fake.stdin.end();

    expect(await running).toBe(1);
    expect(fake.errors.join("")).toContain("could not close the browser: chrome is stuck");
    expect(fake.written()).not.toContain("chrome is stuck");
  });

  it("ends with 1, says why on stderr and still closes the browser, when it cannot serve", async () => {
    const broken = {
      on() {
        throw new Error("the pipe is gone");
      },
      off() {
        return broken;
      },
    } as unknown as Readable;
    const fake = setup({ stdin: broken });
    const { core, order } = fakeCore();

    const code = await runMcp({ core, version: "1.0.0", io: fake.io });

    expect(code).toBe(1);
    expect(fake.errors.join("")).toContain("could not serve: the pipe is gone");
    expect(order).toEqual(["close"]);
    expect(fake.written()).toBe("");
  });
});
