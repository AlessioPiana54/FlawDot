import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { composeCore } from "../src/compose-core.js";
import { composeMcp } from "../src/compose-mcp.js";

// The one test of the whole chain with a real browser: Chromium, axe, the picture with its circles, the shrunk picture
// in the result of the tool. `pnpm browsers` installs Chromium once per machine.

const PAGE = `<!doctype html><html lang="en"><head><title>Spike page</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Hello</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="200" height="100">
<p>A page with a problem that axe can see.</p>
<div style="height: 5000px"></div></main></body></html>`;

// The first test loads the browser driver, the image library and the SDK: more than the default 5 s on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let home: string;
let web: Server;
let url: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "flawdot-e2e-"));
  web = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
  const address = web.address();
  url = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}/`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => web.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

describe("flawdot mcp with a real browser", () => {
  it("analyzes a page and gives back the problems and the shrunk picture", async () => {
    const core = composeCore({ home });
    const server = composeMcp(core, { version: "0.0.0", log: () => undefined, nextWaitMs: 60_000 });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.start(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    try {
      const started = await client.callTool({
        name: "flawdot_analyze",
        arguments: { url, viewports: ["desktop"] },
      });
      const runId = /Run id: (\w+)/.exec(JSON.stringify(started))?.[1];
      expect(runId).toBeDefined();

      const result = await client.callTool({ name: "flawdot_next", arguments: { runId } });

      expect(result.isError).toBeFalsy();
      const blocks = result.content as { type: string; text?: string; data?: string }[];
      const text = blocks.find((block) => block.type === "text")?.text ?? "";
      expect(text).toContain("completed");
      expect(text).toMatch(/\d+\. \[critical\] Image has no text alternative/);
      expect(text).toContain("Verified");

      const image = blocks.find((block) => block.type === "image");
      const metadata = await sharp(Buffer.from(image?.data ?? "", "base64")).metadata();
      expect(metadata.format).toBe("png");
      // the page is about 5000 px high: the picture in the result is cut down to 1568 px on its long edge
      expect(metadata.height).toBe(1568);
      expect(metadata.width).toBeLessThan(1440);

      const file = /Full-size file: (.+)/.exec(text)?.[1] ?? "";
      expect(file.startsWith(join(home, "artifacts", "runs"))).toBe(true);
      expect(existsSync(file)).toBe(true);
    } finally {
      await client.close();
      await server.stop();
      await core.close();
    }
  });
});
