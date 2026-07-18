/**
 * Bridge a Next.js-shaped Route Handler (`(request: Request) => Promise<Response>`)
 * onto a REAL local TCP listener, so the grant-rail tests exercise it through
 * a genuine HTTP round trip — `SolidTestAccount.authFetch` (real DPoP-bound
 * requests) has no "give me the headers only" seam, so this is what lets the
 * suite drive the route with an actually-transmitted DPoP proof rather than a
 * hand-built `Request` object.
 */
import { createServer, type Server } from "node:http";

export interface FetchServer {
  readonly origin: string;
  stop(): Promise<void>;
}

function headersFromIncoming(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function startFetchServer(
  handler: (request: Request) => Promise<Response>,
): Promise<FetchServer> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const host = request.headers.host ?? "127.0.0.1";
      const url = `http://${host}${request.url ?? "/"}`;
      const hasBody = body !== undefined && request.method !== "GET" && request.method !== "HEAD";
      const built = new Request(url, {
        method: request.method,
        headers: headersFromIncoming(request.headers),
        ...(hasBody ? { body } : {}),
      });
      let result: Response;
      try {
        result = await handler(built);
      } catch (error) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "internal error");
        return;
      }
      response.statusCode = result.status;
      result.headers.forEach((value, key) => {
        response.setHeader(key, value);
      });
      const payload = Buffer.from(await result.arrayBuffer());
      response.end(payload);
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fetch-server failed to bind a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined || error === null ? resolve() : reject(error),
        );
      }),
  };
}
