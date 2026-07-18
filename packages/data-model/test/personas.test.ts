/**
 * Persona gates: the Maya Torres fixture is deterministic (same now + seed
 * => byte-identical Turtle), pinned ABOVE the scene-2 ZK thresholds (the
 * persona-card footnote's promise), internally consistent (streams sum to
 * the verified income; disclosure arithmetic holds), and every resource
 * validates root-bound against its shape.
 */
import { expect, test } from "vitest";
import {
  PERSONA_VALUES,
  PERSONA_ZK_FIELD_VALUES,
  personas,
  RESOURCE_POD_PATHS,
  validate,
  ZK_PREQUAL_THRESHOLDS,
  zkBudgetFor,
  LEND,
  fitsZkBudget,
} from "../src/index.ts";
import { NOW } from "./support.ts";

test("persona values are pinned above the scene-2 thresholds", () => {
  const maya = PERSONA_VALUES[0];
  expect(maya).toBeDefined();
  if (maya === undefined) return;
  expect(maya.name).toBe("Maya Torres");
  expect(maya.identifier).toBe("MT-0001");
  expect(maya.netMonthlyIncomeUsd).toBeGreaterThanOrEqual(
    ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd,
  );
  expect(maya.cashFlowScoreValue).toBeGreaterThanOrEqual(ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue);
  expect(maya.nsf90Count).toBe(ZK_PREQUAL_THRESHOLDS.nsf90Count);
  // The thin-file contrast: the bureau score alone would price her out.
  expect(maya.creditScoreValue).toBeLessThan(660);
});

test("every ZK field value fits its digit budget", () => {
  for (const [field, value] of Object.entries(PERSONA_ZK_FIELD_VALUES)) {
    expect(zkBudgetFor(field), `${field} must have a budget`).toBeDefined();
    expect(fitsZkBudget(field, value), `${field}=${value} must fit its budget`).toBe(true);
  }
  expect(Object.keys(PERSONA_ZK_FIELD_VALUES).sort()).toEqual(
    [LEND.netMonthlyIncomeUsd, LEND.cashFlowScoreValue, LEND.nsf90Count].sort(),
  );
});

test("deposit streams sum to the verified net monthly income", () => {
  const maya = PERSONA_VALUES[0];
  if (maya === undefined) throw new Error("persona values missing");
  const sum = maya.depositStreams.reduce((total, stream) => total + stream.monthlyAmountUsd, 0);
  expect(sum).toBe(maya.netMonthlyIncomeUsd);
});

test("offer arithmetic satisfies the Reg Z identity to the cent", () => {
  const maya = PERSONA_VALUES[0];
  if (maya === undefined) throw new Error("persona values missing");
  expect(Math.round(maya.paymentAmountUsd * maya.loanTermMonths * 100)).toBe(
    Math.round(maya.totalOfPaymentsUsd * 100),
  );
  expect(Math.round((maya.totalOfPaymentsUsd - maya.principalUsd) * 100)).toBe(
    Math.round(maya.financeChargeUsd * 100),
  );
  expect(maya.aprPercent).toBeLessThan(36); // the target-APR beat (MAPR ceiling)
});

test("personas() is deterministic and every resource validates root-bound", async () => {
  const [first, second] = await Promise.all([personas({ now: NOW }), personas({ now: NOW })]);
  expect(first).toHaveLength(1);
  const persona = first?.[0];
  const rerun = second?.[0];
  if (persona === undefined || rerun === undefined) throw new Error("persona missing");

  expect(persona.resources.map((resource) => resource.turtle)).toEqual(
    rerun.resources.map((resource) => resource.turtle),
  );
  expect(persona.resources).toHaveLength(Object.keys(RESOURCE_POD_PATHS).length);

  for (const resource of persona.resources) {
    expect(resource.iri).toBe(`${persona.podBase}${resource.path.slice(1)}`);
    const report = await validate(resource.turtle, {
      expect: resource.kind,
      focusNode: resource.focusNode,
    });
    expect(report.conforms, `${resource.kind}: ${JSON.stringify(report.violations)}`).toBe(true);
  }
});

test("credentialSubject follows the webId override (subject binding)", async () => {
  const webId = "https://idp.example/maya#me";
  const [persona] = await personas({ now: NOW, webIds: { "maya-torres": webId } });
  if (persona === undefined) throw new Error("persona missing");
  expect(persona.webId).toBe(webId);
  for (const resource of persona.resources) {
    expect(resource.turtle).toContain(webId);
  }
});

test("the employment credential is seeded near-expiry (freshness beat)", async () => {
  const [persona] = await personas({ now: NOW });
  const income = persona?.byPath.get("/lending/credentials/income");
  if (income === undefined) throw new Error("income resource missing");
  expect(income.turtle).toContain("2026-07-29T12:00:00"); // validUntil = now + 14d
});
