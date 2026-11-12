import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { candidates } from "./candidates";
import { checkProposal, checkSum } from "./checkSum";
import { loadCsvDir } from "./data";
import { allocate } from "./match";
import { fmt, toPence } from "./money";
import { score } from "./score";

describe("money in pence", () => {
  it("parses decimal strings without float drift", () => {
    expect(toPence("219.61")).toBe(21961); // 219.61 * 100 is 21960.999... as a float
    expect(toPence("0.29")).toBe(29);
    expect(toPence("1370")).toBe(137000);
    expect(toPence("5.5")).toBe(550);
    expect(fmt(21961)).toBe("219.61");
  });
});

describe("checkSum: code decides, not the model", () => {
  it("rejects a 1p gap", () => {
    expect(checkSum(10000, [{ amount: 6000 }, { amount: 3999 }])).toBe(false);
    expect(checkSum(10000, [{ amount: 6000 }, { amount: 3999 }], 1)).toBe(true);
  });
  it("rejects unknown charge ids and over-allocation in a pass 3 proposal", () => {
    const open = new Map([["C1", 5000]]);
    expect(checkProposal(5000, { allocations: [{ charge_id: "C9", amount: 50 }], unallocated_amount: 0 }, open).ok).toBe(false);
    expect(checkProposal(6000, { allocations: [{ charge_id: "C1", amount: 60 }], unallocated_amount: 0 }, open).ok).toBe(false);
    expect(checkProposal(6000, { allocations: [{ charge_id: "C1", amount: 50 }], unallocated_amount: 10 }, open).ok).toBe(true);
    expect(checkProposal(6000, { allocations: [{ charge_id: "C1", amount: 50 }], unallocated_amount: 9.99 }, open).ok).toBe(false);
  });
});

// Parity with session 1's match.py on the Cortile-based CSVs: local only, never committed (CASH_DATA_DIR).
const dir = process.env.CASH_DATA_DIR;
const run = dir && existsSync(dir) ? describe : describe.skip;
run("on the local Cortile CSVs (CASH_DATA_DIR)", () => {
  const d = loadCsvDir(dir!);
  const scoredOf = (r: ReturnType<typeof allocate>) => [
    ...r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
    ...r.leftover.map((b) => ({ bank_line_id: b.id, charge_id: "", amount: toPence(b.amount), method: "none" })),
  ];

  it("pass 1 places every clean line, 100% precision", () => {
    const s = score(d.truth, scoredOf(allocate(d.charges, d.bankLines)));
    expect(s.perCase.clean.right).toBe(s.perCase.clean.n);
    expect(s.wrong).toBe(0);
  });

  it("duplicates and unidentifiable payers stay unallocated", () => {
    const r = allocate(d.charges, d.bankLines, d.aliases);
    const placed = new Set(r.allocations.map((a) => a.bank_line_id));
    const mustStayOpen = d.truth.filter((t) => t.case === "duplicate" || t.case === "unidentifiable");
    expect(mustStayOpen.length).toBeGreaterThan(0);
    for (const t of mustStayOpen) expect(placed.has(t.bank_line_id)).toBe(false);
  });

  it("pass 2 places parent-company payers once a person approved the alias", () => {
    if (!d.aliases.length) return;
    const s = score(d.truth, scoredOf(allocate(d.charges, d.bankLines, d.aliases)));
    expect(s.perCase.parent_company.right).toBe(s.perCase.parent_company.n);
    expect(s.wrong).toBe(0);
  });

  it("every leftover line that has a right answer gets its true charges as candidates", () => {
    const r = allocate(d.charges, d.bankLines);
    const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
    const missing: string[] = [];
    for (const b of r.leftover) {
      const want = truth.get(b.id)!.true_charge_ids.split(";").filter(Boolean);
      const got = new Set(candidates(b, d.charges, r.openAmount, d.tenants, [], d.bankLines).candidates.map((c) => c.id));
      for (const id of want) if (!got.has(id)) missing.push(`${b.id}(${truth.get(b.id)!.case}) needs ${id}`);
    }
    expect(missing).toEqual([]);
  });

  it("duplicate lines point at the earlier identical line", () => {
    const r = allocate(d.charges, d.bankLines);
    const dups = d.truth.filter((t) => t.case === "duplicate").map((t) => t.bank_line_id);
    for (const id of dups) {
      const b = r.leftover.find((x) => x.id === id)!;
      expect(candidates(b, d.charges, r.openAmount, d.tenants, [], d.bankLines).earlier_identical_lines.length).toBeGreaterThan(0);
    }
  });
});
