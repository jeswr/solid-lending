/**
 * Status-list gates: the hosted list is a genuinely signed VC 2.0 document;
 * revoke/reinstate are read-verify-modify-resign cycles; concurrent and
 * tampered states are refused (fail-closed); index allocation is
 * deterministic with collision probing.
 */
import { expect, test } from "vitest";
import {
  checkCredentialStatus,
  deriveStatusIndex,
  StatusIndexAllocator,
  StatusListError,
} from "../src/index.ts";
import {
  hostedStatusList,
  issueEmployment,
  LIST_URL,
  NOW,
  resolveIssuerKey,
  stubHost,
} from "./support.ts";

test("create + revoke + reinstate round-trip on the hosted list", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  expect(await list.readBit(42, { now: NOW })).toBe(false);
  await list.revoke(42, { now: NOW });
  expect(await list.readBit(42, { now: NOW })).toBe(true);
  await list.reinstate(42, { now: NOW });
  expect(await list.readBit(42, { now: NOW })).toBe(false);
});

test("create never overwrites an existing hosted list (If-None-Match: *)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(list.create({ now: NOW })).rejects.toThrow(StatusListError);
});

test("a tampered hosted list is refused for mutation (never silently re-signed)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const hosted = host.resources.get(LIST_URL);
  if (hosted === undefined) throw new Error("list not hosted");
  const doc = JSON.parse(hosted.body) as { credentialSubject: { encodedList: string } };
  doc.credentialSubject.encodedList = `${doc.credentialSubject.encodedList.slice(0, -2)}zz`;
  host.resources.set(LIST_URL, { ...hosted, body: JSON.stringify(doc) });
  await expect(list.revoke(1, { now: NOW })).rejects.toThrow(/failed verification/);
});

test("checkCredentialStatus resolves a credential's hosted bit (and fails closed)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list, 42);

  const options = { now: NOW, resolveKey: resolveIssuerKey, statusFetch: host.fetch };
  expect((await checkCredentialStatus(issued.body, options)).status).toBe("valid");
  await list.revoke(42, { now: NOW });
  expect((await checkCredentialStatus(issued.body, options)).status).toBe("revoked");
  host.resources.clear();
  expect((await checkCredentialStatus(issued.body, options)).status).toBe("unreachable");
});

test("deriveStatusIndex is deterministic and probes past occupied indices", () => {
  const first = deriveStatusIndex("credential-a");
  expect(deriveStatusIndex("credential-a")).toBe(first);
  const probed = deriveStatusIndex("credential-a", { isTaken: (index) => index === first });
  expect(probed).not.toBe(first);

  const allocator = new StatusIndexAllocator();
  const a = allocator.allocate("credential-a");
  const b = allocator.allocate("credential-a");
  expect(a).not.toBe(b); // same seed, second call probes past the taken index
  expect(() => allocator.reserve(-1)).toThrow(StatusListError);
});
