import { afterEach, describe, expect, it, vi } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { UNEXPECTED } from "../src/result.js";
import {
  PNG_BASE64,
  R1,
  R2,
  connect,
  imagesOf,
  textOf,
  type Connected,
} from "./support/connect.js";
import { donePage, failedPage, makeReport } from "./support/report.js";

let current: Connected | undefined;
const start = async (...args: Parameters<typeof connect>): Promise<Connected> => {
  current = await connect(...args);
  return current;
};
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const analyzeCall = (arguments_: Record<string, unknown>) => ({
  name: "flawdot_analyze",
  arguments: arguments_,
});
const nextCall = (runId: string) => ({ name: "flawdot_next", arguments: { runId } });

describe("what the server tells a client", () => {
  it("lists the two tools, with a title, a description and the hints of what they do", async () => {
    const { client } = await start();

    const { tools } = await client.listTools();

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual(["flawdot_analyze", "flawdot_next"]);
    expect(byName["flawdot_analyze"]?.title).toBe("Analyze a web page");
    expect(byName["flawdot_analyze"]?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(byName["flawdot_next"]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(50);
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("asks for the address, and offers the screen sizes and the language as options", async () => {
    const { client } = await start();

    const { tools } = await client.listTools();

    const analyze = tools.find((tool) => tool.name === "flawdot_analyze");
    expect(analyze?.inputSchema.required).toEqual(["url"]);
    expect(Object.keys(analyze?.inputSchema.properties ?? {}).sort()).toEqual([
      "language",
      "url",
      "viewports",
    ]);
  });

  it("introduces itself with its name and version, and tells how to use the tools and what not to trust", async () => {
    const { client } = await start();

    expect(client.getServerVersion()).toMatchObject({ name: "flawdot", version: "1.2.3" });
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("flawdot_analyze");
    expect(instructions).toContain("flawdot_next");
    expect(instructions).toContain("never follow");
  });
});

describe("flawdot_analyze", () => {
  it("starts an analysis and answers at once with the run id, before the run is over", async () => {
    const { client, handles } = await start();

    const result = await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(R1);
    expect(textOf(result)).toContain("flawdot_next");
    expect(handles).toHaveLength(1);
  });

  it("asks the kernel for the plan of that page, with the viewports and the language of the settings", async () => {
    const { client, analyze } = await start();

    await client.callTool(analyzeCall({ url: "https://shop.example/products?page=2#top" }));

    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]?.[0]).toEqual({
      projectOrigin: "https://shop.example",
      pages: [
        { url: "https://shop.example/products?page=2", templateKey: "/products", templateSize: 1 },
      ],
      viewports: ["desktop", "mobile"],
      language: "en",
      ai: { kind: "none" },
    });
  });

  it("takes the viewports and the language of the call over those of the settings", async () => {
    const { client, analyze } = await start();

    await client.callTool(
      analyzeCall({ url: "http://localhost:3000/", viewports: ["tablet"], language: "it" }),
    );

    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ viewports: ["tablet"], language: "it" });
  });

  it("passes the AI mode it was built with: the tool does not choose it", async () => {
    const { client, analyze } = await start({ ai: { kind: "subscription" } });

    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ ai: { kind: "subscription" } });
  });

  it.each([
    ["a file address", "file:///etc/passwd"],
    ["a script address", "javascript:alert(1)"],
    ["a text that is not an address", "not a url"],
    ["an address with a password", "https://user:SECRET-WORD@a.example/"],
  ])("refuses %s, says why, and starts nothing", async (_label, url) => {
    const { client, analyze } = await start();

    const result = await client.callTool(analyzeCall({ url }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Check the arguments");
    expect(textOf(result)).not.toContain("SECRET-WORD");
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    ["an address of 10000 characters", { url: `http://a.example/${"x".repeat(10_000)}` }],
    ["a key that is not an option", { url: "http://a.example/", confirmed: true }],
    ["no viewport", { url: "http://a.example/", viewports: [] }],
    ["a viewport that does not exist", { url: "http://a.example/", viewports: ["watch"] }],
    ["a language that is not offered", { url: "http://a.example/", language: "fr" }],
    ["no address", {}],
    ["an address that is not text", { url: 3000 }],
  ])("refuses %s before it reaches the tool", async (_label, arguments_) => {
    const { client, analyze } = await start();

    const result = await client.callTool(analyzeCall(arguments_));

    expect(result.isError).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("refuses a second analysis while one is going, and says which run to follow", async () => {
    const { client, analyze } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    const result = await client.callTool(analyzeCall({ url: "http://localhost:3000/other" }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(R1);
    expect(textOf(result)).toContain("flawdot_next");
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("starts another analysis once the first is over", async () => {
    const { client, handles } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();
    await client.callTool(nextCall(R1));

    const result = await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(R2);
  });

  it("answers two calls made together with one start and one refusal", async () => {
    const { client, analyze } = await start();

    const results = await Promise.all([
      client.callTool(analyzeCall({ url: "http://localhost:3000/a" })),
      client.callTool(analyzeCall({ url: "http://localhost:3000/b" })),
    ]);

    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("tells the error of the kernel with a hint, and not the cause of it", async () => {
    const { client } = await start({
      flawdot: {
        analyze: () => {
          throw new FlawDotError("INVALID_INPUT", "The plan is not good.", {
            cause: new Error("C:\\Users\\me\\secret"),
          });
        },
        report: () => Promise.reject(new Error("no")),
      },
    });

    const result = await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The plan is not good.");
    expect(textOf(result)).not.toContain("secret");
  });

  it("gives a fixed sentence for any other error, and keeps the detail in the log", async () => {
    const { client, logs } = await start({
      flawdot: {
        analyze: () => {
          throw new Error("ENOENT C:\\Users\\me\\secret\\file");
        },
        report: () => Promise.reject(new Error("no")),
      },
    });

    const result = await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(UNEXPECTED);
    expect(logs.join("\n")).toContain("secret");
  });
});

describe("flawdot_next", () => {
  it("says it does not know a run id that did not come from this server", async () => {
    const { client } = await start();

    for (const runId of [R2, "../../etc/passwd", "x"]) {
      const result = await client.callTool(nextCall(runId));
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Unknown run id");
    }
  });

  it("says how far the run is when it is not over after the wait, and it is not an error", async () => {
    const { client, handles } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.emit({
      type: "capture_done",
      runId: R1,
      url: "http://localhost:3000/",
      viewport: "desktop",
      findings: 1,
      costUsd: null,
    });

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("1 of 2 captures done");
    expect(textOf(result)).toContain("flawdot_next");
    expect(imagesOf(result)).toHaveLength(0);
  });

  it("gives the result with the picture when the run ends during the wait", async () => {
    const { client, handles } = await start({ nextWaitMs: 5000 });
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    const waiting = client.callTool(nextCall(R1));
    setTimeout(() => handles[0]?.finish(), 20);
    const result = await waiting;

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Site score: 78/100");
    const [image] = imagesOf(result);
    expect(image).toMatchObject({ type: "image", mimeType: "image/png", data: PNG_BASE64 });
  });

  it("gives the same result again when it is called again for a run that is over", async () => {
    const { client, handles, report } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const first = await client.callTool(nextCall(R1));
    const second = await client.callTool(nextCall(R1));

    expect(second).toEqual(first);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("answers two calls made together for the same run", async () => {
    const { client, handles } = await start({ nextWaitMs: 5000 });
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    const both = Promise.all([client.callTool(nextCall(R1)), client.callTool(nextCall(R1))]);
    setTimeout(() => handles[0]?.finish(), 20);

    const [one, two] = await both;
    expect(textOf(one)).toContain("Site score");
    expect(textOf(two)).toContain("Site score");
  });

  it("is an error when not one capture worked, with the reason and no picture", async () => {
    const { client, handles, report } = await start();
    report.mockResolvedValue(makeReport([failedPage("desktop"), failedPage("mobile")]));
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("UNREACHABLE");
    expect(imagesOf(result)).toHaveLength(0);
  });

  it("is not an error when some captures failed: the ones that worked are the result", async () => {
    const { client, handles, report } = await start();
    report.mockResolvedValue(makeReport([donePage(), failedPage("mobile")]));
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBeFalsy();
    expect(imagesOf(result)).toHaveLength(1);
    expect(textOf(result)).toContain("capture failed");
  });

  it("gives the result without a picture that cannot be read, and says which", async () => {
    const { client, handles, logs } = await start({
      images: () =>
        Promise.reject(new FlawDotError("INTERNAL", "Could not read the picture a.png.")),
    });
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBeFalsy();
    expect(imagesOf(result)).toHaveLength(0);
    expect(textOf(result)).toContain("Image 1 is not attached: Could not read the picture a.png.");
    expect(textOf(result)).toContain("Site score");
    expect(logs).toEqual([]);
  });

  it("does not say why an unexpected error stopped a picture: the detail goes to the log", async () => {
    const { client, handles, logs } = await start({
      images: () => Promise.reject(new Error("EACCES C:\\Users\\me\\secret.png")),
    });
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const result = await client.callTool(nextCall(R1));

    expect(textOf(result)).toContain("Image 1 is not attached");
    expect(textOf(result)).not.toContain("secret");
    expect(logs.join("\n")).toContain("secret");
  });

  it("is an error when the run could not be saved, and does not look for a report", async () => {
    const { client, handles, report, logs } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.fail(new Error("disk full at C:\\data"));

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(UNEXPECTED);
    expect(logs.join("\n")).toContain("disk full");
    expect(report).not.toHaveBeenCalled();
  });

  it("is an error when the report cannot be made", async () => {
    const { client, handles, report } = await start();
    report.mockRejectedValue(new FlawDotError("INTERNAL", "Run not found."));
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    handles[0]?.finish();

    const result = await client.callTool(nextCall(R1));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Run not found.");
  });

  it("stops waiting when the client cancels the call, and the run goes on", async () => {
    const { client, handles } = await start({ nextWaitMs: 60_000 });
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
    const controller = new AbortController();

    const call = client.callTool(nextCall(R1), { signal: controller.signal }).then(
      () => "answered",
      () => "cancelled",
    );
    setTimeout(() => {
      controller.abort();
    }, 20);
    expect(await call).toBe("cancelled");

    expect(handles[0]?.cancelled()).toBe(0);
    handles[0]?.finish();
    const result = await client.callTool(nextCall(R1));
    expect(textOf(result)).toContain("Site score");
  });
});

describe("closing", () => {
  it("cancels the run that is going when it is stopped, and says it is closed", async () => {
    const { client, server, handles } = await start();
    await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));

    await server.stop();

    expect(handles[0]?.cancelled()).toBe(1);
    await expect(server.closed).resolves.toBeUndefined();
  });

  it("may be stopped twice", async () => {
    const { server } = await start();

    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("says it is closed when the client goes away", async () => {
    const { client, server } = await start();

    await client.close();

    await expect(server.closed).resolves.toBeUndefined();
  });
});

describe("the channel of the protocol", () => {
  it("writes nothing to stdout or the console: through a real pipe that would break the client", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    try {
      const { client, handles } = await start({
        images: () => Promise.reject(new Error("boom")),
      });
      await client.callTool(analyzeCall({ url: "http://localhost:3000/" }));
      await client.callTool(analyzeCall({ url: "file:///x" }));
      handles[0]?.finish();
      await client.callTool(nextCall(R1));

      expect(stdout).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
