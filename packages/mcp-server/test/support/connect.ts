import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { defaultSettings, type AnalysisPlan, type ReportData } from "@flawdot/core-model";
import { runId } from "@flawdot/test-support";
import { createMcpServer, type McpServerDeps } from "../../src/index.js";
import { fakeHandle, type FakeHandle } from "./fake-handle.js";
import { makeReport } from "./report.js";

// A 1x1 picture. The server does not look into it: it goes through as the reader gave it.
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const R1 = runId(1);
export const R2 = runId(2);

export interface Connected {
  readonly client: Client;
  readonly server: ReturnType<typeof createMcpServer>;
  /** The run that the next `analyze` hands out. Tests drive it by hand. */
  readonly handles: FakeHandle[];
  readonly analyze: ReturnType<typeof vi.fn<(plan: AnalysisPlan) => FakeHandle>>;
  readonly report: ReturnType<typeof vi.fn<(id: string) => Promise<ReportData>>>;
  readonly logs: string[];
  close(): Promise<void>;
}

/** A server wired to a client through memory, with a scripted kernel: no browser, no disk, no network. */
export async function connect(override: Partial<McpServerDeps> = {}): Promise<Connected> {
  const ids = [R1, R2];
  const handles: FakeHandle[] = [];
  const analyze = vi.fn((_plan: AnalysisPlan): FakeHandle => {
    const handle = fakeHandle(ids[handles.length] ?? R2);
    handles.push(handle);
    return handle;
  });
  const report = vi.fn((_id: string): Promise<ReportData> => Promise.resolve(makeReport()));
  const logs: string[] = [];

  const server = createMcpServer({
    flawdot: { analyze, report: (id) => report(id) },
    settings: { get: () => Promise.resolve(defaultSettings()) },
    images: () => Promise.resolve({ data: PNG_BASE64, mimeType: "image/png" }),
    ai: { kind: "none" },
    version: "1.2.3",
    log: (line) => logs.push(line),
    nextWaitMs: 30,
    ...override,
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.start(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);

  return {
    client,
    server,
    handles,
    analyze,
    report,
    logs,
    close: async () => {
      await client.close();
      await server.stop();
    },
  };
}

type Block = { type: string; text?: string; data?: string; mimeType?: string };

/** The text blocks of a result, joined. */
export const textOf = (result: { content?: unknown }): string =>
  (result.content as Block[])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

export const imagesOf = (result: { content?: unknown }): Block[] =>
  (result.content as Block[]).filter((block) => block.type === "image");
