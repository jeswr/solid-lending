/**
 * Boots a zone app's REAL Next.js dev server as a child process on a
 * dynamically-assigned loopback port, waits for `/api/health` (every zone
 * app exposes one via `@jeswr/solid-showcase/next`'s `healthRoute` — see
 * each app's own `app/api/health/route.ts`), and tears every started app
 * down together. One `AppRunner` per journey run; apps are booted ONCE per
 * suite (never per test) — a fresh `next dev` cold start is seconds, too
 * slow to pay per scene.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("failed to reserve a free TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

async function waitUntilReady(url: string, child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App server exited early (${child.exitCode})\n${logs.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`GET ${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `App server never became ready at ${url}: ${String(lastError)}\n${logs.join("")}`,
  );
}

export interface StartAppOptions {
  /** Workspace package name, e.g. `@lending/app-bank-lender`. */
  readonly packageName: string;
  /** The app's own `basePath` (`next.config.ts`), e.g. `/bank-lender`. */
  readonly basePath: string;
  readonly env: NodeJS.ProcessEnv;
}

export class AppRunner {
  private readonly children: ChildProcess[] = [];
  readonly logsByPackage = new Map<string, string[]>();

  /** Boot one zone app; resolves once its `/api/health` route answers 200. */
  async start(options: StartAppOptions): Promise<{ origin: string }> {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const readyPath = `${options.basePath}/api/health`;

    const logs: string[] = [];
    this.logsByPackage.set(options.packageName, logs);

    const child = spawn(
      "pnpm",
      ["--filter", options.packageName, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.children.push(child);
    child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

    await waitUntilReady(`${origin}${readyPath}`, child, logs);
    return { origin };
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
            // Next.js 16's dev server spawns a detached child of its own —
            // give it a short grace period before this promise settles so
            // the port is genuinely free for the NEXT run in the same process.
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            }, 5_000);
          }),
      ),
    );
  }
}

export function repoPath(...segments: readonly string[]): string {
  return path.join(REPO_ROOT, ...segments);
}
