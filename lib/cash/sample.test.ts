// On the team's committed synthetic data (data/sample, Sep + Oct). The November hold-out is never read here.
import { describe, expect, it } from "vitest";
import { candidates } from "./candidates";
import { allocate } from "./match";
import { toPence } from "./money";
import { loadData } from "./data";
import { score } from "./score";

const d = loadData();
const r = allocate(d.charges, d.bankLines);
const s = score(d.truth, [
  ...r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
  ...r.leftover.map((b) => ({ bank_line_id: b.id, charge_id: "", amount: toPence(b.amount), method: "none" })),
], new Map(d.bankLines.map((b) => [b.id, toPence(b.amount)])));

describe("pass 1 on the team sample (Sep + Oct)", () => {
  it("answer key is consistent: true allocations + true_unallocated = bank amount, to the penny", () => {
    const amt = new Map(d.bankLines.map((b) => [b.id, toPence(b.amount)]));
    const bad = d.truth.filter((t) => {
      const sum = (t.true_amounts ? t.true_amounts.split(";") : []).reduce((x, a) => x + toPence(a), 0);
      return sum + toPence(t.true_unallocated ?? "0") !== amt.get(t.bank_line_id);
    });
    expect(bad.map((t) => t.bank_line_id)).toEqual([]);
  });

  it("never allocates a line wrongly", () => expect(s.wrong).toBe(0));

  // the README's "Settled by: Pass 1" cases: messy refs, cut-off payer names, one payment for rent + service charge
  it.each(["clean", "bad_reference", "combined"])("settles every %s line", (c) => {
    expect(s.perCase[c].right).toBe(s.perCase[c].n);
  });

  it("leaves duplicates and unidentifiable payers open", () => {
    const placed = new Set(r.allocations.map((a) => a.bank_line_id));
    for (const t of d.truth.filter((x) => x.case === "duplicate" || x.case === "unidentifiable")) expect(placed.has(t.bank_line_id)).toBe(false);
  });

  it("hands the agent every true charge among the candidates of the lines it must decide", () => {
    const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
    const missing = r.leftover.flatMap((b) => {
      const got = new Set(candidates(b, d.charges, r.openAmount, d.tenants, [], d.bankLines).candidates.map((c) => c.id));
      return truth.get(b.id)!.true_charge_ids.split(";").filter(Boolean).filter((id) => !got.has(id)).map((id) => `${b.id} needs ${id}`);
    });
    expect(missing).toEqual([]);
  });
});
