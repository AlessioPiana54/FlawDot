import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
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
