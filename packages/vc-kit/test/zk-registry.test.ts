/**
 * The committed circuit registry (docs/zk-plan.md). Confirms all FOUR
 * `filter_int_d1..d4` members load, are pinned to the expected toolchain, and
 * that the membership/digit-width lookups fail closed on anything foreign.
 */

import { describe, expect, it } from "vitest";
import {
  asCommittedMember,
  COMMITTED_MEMBERS,
  loadCommittedCircuit,
  memberDigits,
  memberForDigits,
  PINNED_NARGO_VERSION,
} from "../src/index.ts";

describe("circuit registry", () => {
  it("commits exactly the four filter_int members, in digit order", () => {
    expect(COMMITTED_MEMBERS).toEqual([
      "filter_int_d1",
      "filter_int_d2",
      "filter_int_d3",
      "filter_int_d4",
    ]);
  });

  it("asCommittedMember accepts only the exact committed names", () => {
    for (const member of COMMITTED_MEMBERS) {
      expect(asCommittedMember(member)).toBe(member);
    }
    for (const foreign of ["filter_int_d5", "filter_int_d4-no-zk", "", "FILTER_INT_D2"]) {
      expect(asCommittedMember(foreign)).toBeUndefined();
    }
  });

  it("memberForDigits resolves the exact-width member, 1-4", () => {
    expect(memberForDigits(1)).toBe("filter_int_d1");
    expect(memberForDigits(2)).toBe("filter_int_d2");
    expect(memberForDigits(3)).toBe("filter_int_d3");
    expect(memberForDigits(4)).toBe("filter_int_d4");
    expect(memberForDigits(5)).toBeUndefined();
    expect(memberForDigits(0)).toBeUndefined();
  });

  it("memberDigits round-trips memberForDigits", () => {
    for (const d of [1, 2, 3, 4] as const) {
      const member = memberForDigits(d);
      expect(member).toBeDefined();
      expect(memberDigits(member as NonNullable<typeof member>)).toBe(d);
    }
  });

  it("every committed artifact loads, has bytecode, and is pinned to the expected nargo", async () => {
    for (const member of COMMITTED_MEMBERS) {
      const artifact = await loadCommittedCircuit(member);
      expect(artifact.bytecode.length).toBeGreaterThan(0);
      expect(artifact.noir_version.startsWith(PINNED_NARGO_VERSION)).toBe(true);
    }
  });
});
