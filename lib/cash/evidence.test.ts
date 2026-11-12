import { describe, expect, it } from "vitest";
import { loadData } from "./data";
import { checkEvidence } from "./evidence";
import { propose, emptyStore } from "./service";

const d = loadData();
const lease = new Map(d.charges.map((c) => [c.tenant_id, c.lease_citation]));
const src = { bankLines: d.bankLines, charges: d.charges, tenants: d.tenants.map((t) => ({ ...t, lease_citation: lease.get(t.tenant_id) ?? "" })), notes: d.notes, lookup: d.companyLookup };
const ok = (e: { type: "bank_line" | "charge" | "tenant" | "lease" | "alias" | "note"; ref: string; quote: string }) => checkEvidence([e as never], src).rejected.length === 0;

describe("no source, no figure", () => {
  it("passes real quotes the model wrote (labels around field values, a note sentence, JSON-style amounts)", () => {
    expect(ok({ type: "bank_line", ref: "B2609-063", quote: "payer_name BEACON GRP PLC, reference RENT SEPT, amount 4158.34" })).toBe(true);
    expect(ok({ type: "tenant", ref: "T088", quote: "Premier Ventures Ltd parent_company PREMIER GROUP PLC; lookup group_members Premier Ventures Ltd" })).toBe(true);
    expect(ok({ type: "note", ref: "T095 2026-09-02", quote: "Disputing £71.75 of September service charge, email of 2 September 2026." })).toBe(true);
    expect(ok({ type: "charge", ref: "INV-2609-104-R", quote: "Liberty Developments Ltd rent 2026-09 amount_open 6525" })).toBe(true);
  });

  it("fails a paraphrase", () => {
    expect(ok({ type: "note", ref: "T095", quote: "Tenant is holding back money because the elevator broke" })).toBe(false);
  });

  it("fails an invented ref", () => {
    expect(ok({ type: "tenant", ref: "T999", quote: "Liberty Lettings Ltd" })).toBe(false);
    expect(ok({ type: "charge", ref: "INV-2609-999-R", quote: "rent 2026-09" })).toBe(false);
  });

  it("fails an amount the source does not hold", () => {
    expect(ok({ type: "bank_line", ref: "B2609-063", quote: "BEACON GRP PLC amount 4158.35" })).toBe(false);
  });

  it("a high-confidence proposal with an unfound quote waits for a person, with the reason", () => {
    const s = Object.assign(emptyStore(), { charges: d.charges, tenants: d.tenants, notes: d.notes, lookup: d.companyLookup, bankLines: d.bankLines.filter((b) => b.id === "B2609-063") });
    const res = propose(s, {
      bank_line_id: "B2609-063", allocations: [{ charge_id: "INV-2609-089-R", amount: 4158.34 }], unallocated_amount: 0, confidence: 0.95, reasoning: "parent pays",
      evidence: [{ type: "tenant", ref: "T089", quote: "Beacon Property Holdings Ltd confirmed by phone that the group pays" }],
    }, "grok_bot") as { status: string; review_reason: string; evidence_checked: number };
    expect(res.status).toBe("proposed");
    expect(res.review_reason).toBe("evidence not found: T089");
    expect(res.evidence_checked).toBe(1);
  });
});
