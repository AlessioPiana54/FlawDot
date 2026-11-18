import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/site");

export interface FixtureServer {
  /** "http://127.0.0.1:<port>": the fixtures are served over HTTP, never from file:// */
  origin: string;
  close(): Promise<void>;
}

/** Serves the HTML pages of test/fixtures/site on 127.0.0.1, on a port the system picks. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = join(ROOT, path);
    // A path that leaves the folder of the fixtures is never served.
    if (!file.startsWith(ROOT + sep) || !file.endsWith(".html")) {
      response.writeHead(404).end();
      return;
    }
    readFile(file).then(
      (body) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body),
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error === undefined ? done() : fail(error)));
      }),
  };
}
