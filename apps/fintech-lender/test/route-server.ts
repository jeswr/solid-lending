/**
 * Bridge a web-standard `(Request) => Promise<Response>` route handler onto a
 * real loopback HTTP server, so integration tests can exercise it through a
 * REAL `fetch()` (and therefore through `SolidTestAccount.authFetch`, which
 * always completes with a genuine network call) instead of calling the
 * handler in-process. This is the ONLY way to get a faithful DPoP `htu`
 * binding in tests: the proof is minted against the ACTUAL request URL.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface RouteServer {
  readonly url: string;
  stop(): Promise<void>;
}

async function toWebRequest(request: IncomingMessage, url: string): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let body: string | undefined;
  if (hasBody) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks).toString("utf8");
  }
  return new Request(url, {
    body,
    headers,
    method: request.method ?? "GET",
  });
}

async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => {
    target.setHeader(key, value);
  });
  const body = await response.text();
  target.end(body);
}

/** Serve `handler` on a fresh loopback port. Every request is dispatched to `handler` regardless of path. */
export async function serveHandler(
  handler: (request: Request) => Promise<Response>,
): Promise<RouteServer> {
  let origin = "";
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://placeholder");
      const target = `${origin}${url.pathname}${url.search}`;
      const webRequest = await toWebRequest(request, target);
      const webResponse = await handler(webRequest);
      await writeWebResponse(webResponse, response);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("route server failed to bind a TCP port");
  }
  const url = `http://localhost:${address.port}`;
  origin = url;
  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
    url,
  };
}
