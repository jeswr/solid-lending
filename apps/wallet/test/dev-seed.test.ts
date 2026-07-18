/**
 * The dev-gated Mode-1 seed route's fail-closed contract, exercised through the REAL
 * route module (no mocked handler):
 *  - production ⇒ 404, never seeds anything;
 *  - unconfigured seed target ⇒ 503 (fails closed, never picks a default pod).
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  vi.unstubAllEnvs();
});

test("production always refuses, even with a seed target configured", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LENDING_SEED_POD_URL", "http://127.0.0.1:1/");
  vi.stubEnv("LENDING_SEED_WEBID", "http://127.0.0.1:1/profile/card#me");
  const { POST } = await import("../app/api/dev/seed/route");
  const response = await POST();
  expect(response.status).toBe(404);
});

test("unconfigured seed target fails closed with 503", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LENDING_SEED_POD_URL", "");
  vi.stubEnv("LENDING_SEED_WEBID", "");
  const { POST } = await import("../app/api/dev/seed/route");
  const response = await POST();
  expect(response.status).toBe(503);
});
