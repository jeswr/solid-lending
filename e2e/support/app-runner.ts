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
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Every PID (transitively) descended from `pid`, read straight from
 * `/proc/*\/stat` — Next.js 16's dev server spawns its ACTUAL `next-server`
 * as a further, effectively-detached child of the `pnpm`/`next` CLI process
 * this module spawns (see `stopAll`'s header note). A plain `child.kill()`
 * only reaches the immediate `pnpm` process; the `next-server` grandchild
 * survives, keeps its bound port + `.next/dev/` lock alive, and makes every
 * SUBSEQUENT `next dev` for that same app directory in this checkout refuse
 * to start ("Another next dev server is already running") — a real,
 * reproduced harness bug, not merely theoretical. Linux-only (`/proc`); this
 * suite only ever runs in a Linux CI/dev-container.
 */
async function descendantPids(pid: number): Promise<number[]> {
  const entries = await readdir("/proc").catch(() => []);
  const childrenByParent = new Map<number, number[]>();
  await Promise.all(
    entries.map(async (entry) => {
      if (!/^\d+$/.test(entry)) return;
      try {
        const stat = await readFile(`/proc/${entry}/stat`, "utf8");
        // Format: `pid (comm) state ppid ...` — comm may itself contain
        // spaces/parens, so split on the LAST ")".
        const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
        const ppid = Number(afterComm.split(" ")[1]);
        const childPid = Number(entry);
        if (!Number.isInteger(ppid) || !Number.isInteger(childPid)) return;
        const siblings = childrenByParent.get(ppid) ?? [];
        siblings.push(childPid);
        childrenByParent.set(ppid, siblings);
      } catch {
        // The process exited mid-scan (or /proc/<pid>/stat is unreadable) —
        // it is not a live descendant either way.
      }
    }),
  );
  const collect = (parent: number): number[] => {
    const kids = childrenByParent.get(parent) ?? [];
    return kids.flatMap((kid) => [kid, ...collect(kid)]);
  };
  return collect(pid);
}

function killIfAlive(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH (already dead) or EPERM — either way there is nothing more this
    // teardown can or needs to do for that pid.
  }
}

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
    child.stdout?.on("data", (chunk: Buffer) => {
      logs.push(chunk.toString());
      if (process.env.LENDING_E2E_DEBUG_LOGS === "1") process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs.push(chunk.toString());
      if (process.env.LENDING_E2E_DEBUG_LOGS === "1") process.stderr.write(chunk);
    });

    await waitUntilReady(`${origin}${readyPath}`, child, logs);
    return { origin };
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.children.map(async (child) => {
        if (child.pid === undefined) return;
        // Snapshot descendants (the real `next-server`, plus anything IT
        // spawned) BEFORE killing anything — once the immediate `pnpm`/`next`
        // process dies, `next-server` reparents to the nearest subreaper and
        // this process tree walk can no longer find it by `child.pid`.
        const descendants = await descendantPids(child.pid);

        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
          // Give the process tree a short grace period to exit on its own
          // before this promise settles.
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }, 5_000);
        });

        // Unconditionally SIGKILL every descendant collected above — the
        // detached `next-server` never receives the parent's SIGTERM/SIGKILL
        // (that is the whole reason it survives), so it must be signalled
        // directly by pid. Idempotent/harmless if it already exited.
        for (const pid of descendants) killIfAlive(pid, "SIGKILL");
      }),
    );
  }
}

export function repoPath(...segments: readonly string[]): string {
  return path.join(REPO_ROOT, ...segments);
}
