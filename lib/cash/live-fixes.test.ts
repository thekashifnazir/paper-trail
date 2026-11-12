// The September click-through on the committed sample, in memory: passes 1-2, pass 3 replayed from
// results/2026-09.json (the saved real run), then a person's decisions. Covers the Live fixes:
// parent-payer evidence, payer memory clearing siblings, arrears payment_pending, method human / rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { agentRun } from "./agentRun";
import { SAMPLE_DIR, loadData } from "./data";
import { approveLine, arrears, emptyStore, loadStatement, run, type Store } from "./service";
import { lineViews } from "./view";

process.env.CASH_PERSIST = "0";

async function september(): Promise<Store> {
  const d = loadData();
  const s = Object.assign(emptyStore(), { charges: d.charges, tenants: d.tenants, truth: d.truth, notes: d.notes, lookup: d.companyLookup });
  loadStatement(s, readFileSync(join(SAMPLE_DIR, "bank_2026_09.csv"), "utf8"), "system");
  run(s, "2026-09");
  await agentRun(s, { month: "2026-09", replay: "results/2026-09.json" });
  return s;
}
const view = (s: Store, id: string) => lineViews(s, "2026-09").find((l) => l.id === id)!;

let s: Store;
beforeEach(async () => { s = await september(); });

describe("parent-payer evidence", () => {
  it.each(["B2609-001", "B2609-006", "B2609-074", "B2609-077"])("%s shows the company lookup and the tenant's lease", (id) => {
    const types = view(s, id).evidence.map((e) => e.type);
    expect(types).toContain("company_lookup");
    expect(types).toContain("lease");
    expect(types).toContain("charge");
    expect(types).toContain("bank_line");
  });

  it("the lease quote is the allocated tenant's lease citation", () => {
    const l = view(s, "B2609-001");
    const lease = l.evidence.find((e) => e.type === "lease")!;
    expect(lease.quote).toBe(s.charges.find((c) => c.id === "INV-2609-088-S")!.lease_citation);
    expect(lease.ref).toContain("T088");
  });
});

describe("approving a new payer clears its other waiting lines (pass 2 again)", () => {
  it("PREMIER GROUP PLC: approving B2609-001 clears B2609-006 by payer memory", () => {
    expect(view(s, "B2609-006").status).toBe("proposed");
    const res = approveLine(s, "B2609-001", "human");
    expect(res.remembered).toMatch(/PREMIER GROUP PLC pays for Premier Ventures Ltd/);
    expect(res.cleared).toEqual(["B2609-006"]);
    const sib = view(s, "B2609-006");
    expect(sib.status).toBe("approved");
    expect(sib.method).toBe("memory");
    expect(sib.review_reason).toBeNull();
    expect(sib.allocations.map((a) => [a.charge_id, a.allocated])).toEqual([["INV-2609-088-R", 2279.17]]);
    expect(s.audit.some((a) => a.action === "memory_cleared" && a.bank_line_id === "B2609-006")).toBe(true);
  });

  it("leaves other payers' waiting lines alone", () => {
    const waiting = () => lineViews(s, "2026-09").filter((l) => l.status === "proposed").map((l) => l.id).sort();
    const before = waiting().filter((id) => id !== "B2609-001" && id !== "B2609-006");
    approveLine(s, "B2609-001", "human");
    expect(waiting()).toEqual(before);
  });

  it("the next new payer clears its own sibling", () => {
    approveLine(s, "B2609-001", "human");
    const again = approveLine(s, "B2609-074", "human"); // FAIRWAY GROUP PLC: learned now, clears B2609-077
    expect(again.cleared).toEqual(["B2609-077"]);
  });
});

describe("arrears: payments waiting for review are flagged, not chased", () => {
  const row = (id: string) => arrears(s).arrears.find((r) => r.tenant_id === id);

  it("Fairway Lettings (T086) and Beacon Property Holdings (T089) carry payment_pending with the waiting amount", () => {
    const fairway = row("T086");
    const beacon = row("T089");
    // their October charges are still open; the September group payment waits for a person
    expect(fairway?.payment_pending).toBe(true);
    expect(fairway?.pending_amount).toBe(6583.16); // 5995.83 rent + 587.33 service charge
    expect(fairway?.pending_lines.sort()).toEqual(["B2609-074", "B2609-077"]);
    expect(beacon?.payment_pending).toBe(true);
    expect(beacon?.pending_amount).toBe(4725.97); // 4158.34 + 567.63
  });

  it("keeps the existing fields, and tenants with nothing waiting are not pending", () => {
    const rows = arrears(s).arrears;
    for (const r of rows) for (const k of ["tenant_id", "tenant_name", "outstanding", "oldest_due_date", "days_overdue", "disputed", "lease_citation", "open_charges"]) expect(r).toHaveProperty(k);
    const quiet = rows.filter((r) => !r.payment_pending);
    expect(quiet.length).toBeGreaterThan(0);
    for (const r of quiet) expect(r.pending_amount).toBe(0);
  });

  it("the flag drops once the payment is approved", () => {
    approveLine(s, "B2609-074", "human"); // also clears B2609-077 by memory
    expect(row("T086")?.payment_pending).toBe(false);
  });
});

describe("method: who decided", () => {
  it("a person's approval reads human; pass 2 clears read memory", () => {
    approveLine(s, "B2609-001", "human");
    expect(view(s, "B2609-001").method).toBe("human");
    expect(view(s, "B2609-006").method).toBe("memory");
  });

  it("a line held as a possible duplicate reads rule", () => {
    const dup = s.holds.find((h) => /duplicate/i.test(h.reasoning));
    expect(dup).toBeDefined();
    expect(view(s, dup!.bank_line_id).method).toBe("rule");
  });
});
