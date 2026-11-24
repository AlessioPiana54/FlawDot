import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import pkg from "../package.json" with { type: "json" };

// The built file, started the way `npx flawdot` starts it: a real process, real pipes, another working folder.
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const PAGE = `<!doctype html><html lang="en"><head><title>Dist page</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Hello</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="200" height="100"></main></body></html>`;

let folder: string;
let web: Server;
let url: string;

beforeEach(async () => {
  expect(existsSync(CLI), "build first: pnpm --filter @flawdot/cli build").toBe(true);
  folder = mkdtempSync(join(tmpdir(), "flawdot-dist-"));
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
  rmSync(folder, { recursive: true, force: true });
});

const env = (): Record<string, string> => ({
  ...(Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ) as Record<string, string>),
  FLAWDOT_HOME: join(folder, "home"),
});

describe("the built flawdot", () => {
  it("prints its version", () => {
    const run = spawnSync(process.execPath, [CLI, "--version"], { cwd: folder, encoding: "utf8" });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${pkg.version}\n`);
  });

  it("refuses an unknown command, with the usage on stderr and nothing on stdout", () => {
    const run = spawnSync(process.execPath, [CLI, "serve"], { cwd: folder, encoding: "utf8" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Usage:");
    expect(run.stdout).toBe("");
  });

  it("serves a client over stdio, analyzes a page and gives the picture", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp"],
      cwd: folder,
      env: env(),
      stderr: "pipe",
    });
    const client = new Client({ name: "dist-test", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["flawdot_analyze", "flawdot_next"]);

      const started = await client.callTool({
        name: "flawdot_analyze",
        arguments: { url, viewports: ["desktop"] },
      });
      const runId = /Run id: (\w+)/.exec(JSON.stringify(started))?.[1];
      const result = await client.callTool({ name: "flawdot_next", arguments: { runId } });

      expect(result.isError).toBeFalsy();
      const blocks = result.content as { type: string; text?: string }[];
      expect(blocks.find((block) => block.type === "text")?.text).toMatch(
        /\d+\. \[critical\] Image has no text alternative/,
      );
      expect(blocks.some((block) => block.type === "image")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("writes only protocol messages to stdout, and ends with 0 when the client closes its end", async () => {
    const child = spawn(process.execPath, [CLI, "mcp"], { cwd: folder, env: env() });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "raw", version: "0" },
        },
      })}\n`,
    );
    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (out.includes("\n")) {
          clearInterval(wait);
          resolve();
        }
      }, 20);
    });
    child.stdin.end();

    expect(await exited).toBe(0);
    for (const line of out.split("\n").filter((text) => text.trim() !== "")) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    }
  });
});
