import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/site");

export interface FixtureServer {
  /** "http://127.0.0.1:<port>": the fixtures are served over HTTP, never from file:// */
  origin: string;
  /** Every request the server got, in order. */
  requests: { method: string; url: string }[];
  close(): Promise<void>;
}

/** A page that never answers: it is how a test makes a navigation time out. */
export const HANG_PATH = "/__hang";

/** A page that answers with a status: `/__status/401`. It is a plain page with a button, so it can be captured. */
export const statusPath = (code: number): string => `/__status/${String(code)}`;

/** An answer that sends the browser to another path of this server: `/__redirect?to=%2Flogin.html`. */
export const redirectPath = (to: string, query = ""): string =>
  `/__redirect?to=${encodeURIComponent(to)}${query === "" ? "" : `&${query}`}`;

/** Answers that are not pages: a PDF shown inline, a download, and JSON. */
export const PDF_PATH = "/__pdf";
export const DOWNLOAD_PATH = "/__download";
export const JSON_PATH = "/__json";

const STATUS_PAGE = '<!doctype html><title>Status</title><button id="ok">ok</button>';

/** Answers the special paths above. Returns false for any other path, which is a file. */
function serveSpecial(request: IncomingMessage, response: ServerResponse): boolean {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const status = /^\/__status\/(\d{3})$/.exec(url.pathname);
  if (status?.[1] !== undefined) {
    response
      .writeHead(Number(status[1]), { "content-type": "text/html; charset=utf-8" })
      .end(STATUS_PAGE);
    return true;
  }
  if (url.pathname === "/__redirect") {
    const to = url.searchParams.get("to") ?? "";
    // Only a path of this server: never an address that could send the browser somewhere else.
    if (!to.startsWith("/") || to.startsWith("//")) response.writeHead(400).end();
    else response.writeHead(302, { location: to }).end();
    return true;
  }
  if (url.pathname === PDF_PATH) {
    response.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4\n%%EOF\n");
    return true;
  }
  if (url.pathname === DOWNLOAD_PATH) {
    response
      .writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="report.bin"',
      })
      .end("data");
    return true;
  }
  if (url.pathname === JSON_PATH) {
    response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return true;
  }
  return false;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** The type of a file by its extension; a browser will not draw an image that is served as text. */
function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

async function serveFile(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const target = resolve(join(ROOT, decodeURIComponent(path)));
  // Whatever the URL says, only files inside the fixtures folder are served.
  if (!target.startsWith(ROOT + sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { "content-type": contentTypeOf(target) }).end(body);
  } catch (error) {
    response.writeHead(error instanceof Error && "code" in error ? 404 : 500).end();
  }
}

/** Serves the fixture pages on 127.0.0.1 and a free port. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: FixtureServer["requests"] = [];
  const server: Server = createServer((request, response) => {
    requests.push({ method: request.method ?? "GET", url: request.url ?? "/" });
    if (request.url === HANG_PATH) return; // keep the connection open and say nothing
    if (serveSpecial(request, response)) return;
    void serveFile(request, response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((done, fail) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? done() : fail(error)));
      }),
  };
}

/** A port on which nothing listens: a server was started on it and stopped, so a connection is refused at once. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
