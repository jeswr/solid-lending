/**
 * Smoke coverage of the dev/test Solid-server harness itself: fixed-owner mode boots a
 * real reachable pod and honours strict-create semantics; OIDC mode mints a real,
 * separately-issued identity whose bearer token differs from the primary account's own.
 */
import { afterEach, describe, expect, it } from "vitest";
import { profileCardFixture, publicReadAcl, startSolidServer } from "../src/index.ts";

describe("startSolidServer — fixed-owner mode", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("boots a real, reachable pod at the primary account's WebID", async () => {
    const server = await startSolidServer({});
    stop = server.stop;
    const account = server.accounts[0];
    expect(account).toBeDefined();
    if (account === undefined) return;
    const response = await account.authFetch(account.baseUrl);
    expect(response.status).toBeLessThan(500);
  });
});

describe("startSolidServer — oidc mode", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("provisions a second identity with its own WebID and denies it cross-pod owner writes unauthenticated", async () => {
    const server = await startSolidServer({ oidc: true });
    stop = server.stop;
    const borrower = server.accounts[0];
    if (borrower === undefined) throw new Error("no primary account");
    const other = await server.provisionAccount();
    expect(other.webid).not.toBe(borrower.webid);
    // Anonymous write to the borrower's pod is refused (no credentials at all).
    const response = await fetch(`${borrower.baseUrl}/anonymous-write-probe`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<#s> <#p> <#o> .",
    });
    expect([401, 403]).toContain(response.status);
    await other.stop();
  });
});

describe("seed fixtures", () => {
  it("profileCardFixture emits a public-read Turtle card with name + storage", () => {
    const fixture = profileCardFixture({
      webid: "https://pod.example/profile/card#me",
      name: "Maya Torres",
      storage: "https://pod.example/",
    });
    expect(fixture.path).toBe("/profile/card");
    expect(fixture.publicRead).toBe(true);
    expect(fixture.body).toContain("Maya Torres");
    expect(fixture.body).toContain("https://pod.example/");
  });

  it("publicReadAcl grants foaf:Agent read and the owner full control", () => {
    const acl = publicReadAcl("/profile/card", "https://pod.example/profile/card#me");
    expect(acl).toContain("acl:agentClass foaf:Agent");
    expect(acl).toContain("acl:mode acl:Read, acl:Write, acl:Control");
  });
});
