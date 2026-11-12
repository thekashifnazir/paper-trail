// Jev's decision rules in code, with fixed Jev answers (no network).
import { describe, expect, it } from "vitest";
import { pass3Input, stubFetch } from "./agent";
import { candidates } from "./candidates";
import { loadData } from "./data";
import { decide, jevRequest, type JevAnswers } from "./jev";
import { allocate } from "./match";
import { runPass3 } from "./pass3";

const d = loadData({ months: ["2026-09"] });
const r = allocate(d.charges, d.bankLines);
const input = (id: string) => pass3Input(candidates(r.leftover.find((b) => b.id === id)!, d.charges, r.openAmount, d.tenants, [], d.bankLines), d.tenants, d.notes, d.companyLookup);
const ans = (charge: string, cp: number, shape: JevAnswers["shape"]["choice"], sp: number, fits: number): JevAnswers => ({
  charge: { choice: charge, confidence: cp, probabilities: { [charge]: cp } },
  shape: { choice: shape, confidence: sp, probabilities: { [shape]: sp } },
  any_fits: { noul: fits },
});

describe("Jev first: code decides from Jev's judgment", () => {
  it("one sure charge: code allocates the open amount and leaves an overpayment's excess as credit", () => {
    // B2609-038 overpays rent INV-2609-103-R (open 4687.50) by 250.00
    const dec = decide(ans("INV-2609-103-R", 0.97, "one_charge", 0.95, 0.95), input("B2609-038"), r.openAmount);
    expect(dec.route).toBe("allocate");
    if (dec.route !== "allocate") return;
    expect(dec.proposal.allocations).toEqual([{ charge_id: "INV-2609-103-R", amount: 4687.5 }]);
    expect(dec.proposal.unallocated_amount).toBe(250);
  });

  it("a payer that fits nobody goes to a person, without Grok", () => {
    expect(decide(ans("none", 1, "unknown", 0.95, 0.04), input("B2609-057"), r.openAmount).route).toBe("person");
  });

  it("anything Jev is unsure of falls through to Grok", () => {
    expect(decide(ans("INV-2609-095-R", 0.51, "several_charges", 0.67, 0.95), input("B2609-107"), r.openAmount).route).toBe("grok");
    expect(decide(ans("INV-2609-103-R", 0.97, "one_charge", 0.6, 0.95), input("B2609-038"), r.openAmount).route).toBe("grok");
  });

  it("never sends the answer key to Jev", () => {
    for (const b of r.leftover) expect(JSON.stringify(jevRequest(input(b.id)))).not.toMatch(/case_type|true_allocations|true_unallocated|"case"/);
  });

  it("jev_then_grok: Jev's sure lines skip Grok; the rest go to Grok; Jev down means Grok decides", async () => {
    const inputs = ["B2609-038", "B2609-057", "B2609-107"].map(input);
    const fixed: Record<string, JevAnswers> = {
      "B2609-038": ans("INV-2609-103-R", 0.97, "one_charge", 0.95, 0.95),
      "B2609-057": ans("none", 1, "unknown", 0.95, 0.04),
      "B2609-107": ans("INV-2609-095-R", 0.5, "several_charges", 0.6, 0.95),
    };
    const jevFetch = (async (_u: string, init?: RequestInit) => new Response(JSON.stringify({ answers: fixed[JSON.parse(String(init?.body)).state.bank_line.id] }))) as typeof fetch;
    const grokCalls: string[] = [];
    const grok = stubFetch(d.truth);
    const grokFetch = (async (u: string, init?: RequestInit) => { grokCalls.push(JSON.parse(JSON.parse(String(init?.body)).messages[1].content).bank_line.id); return grok(u, init); }) as typeof fetch;
    const res = await runPass3(inputs, r.openAmount, { apiKey: "k", model: "m", fetch: grokFetch }, { mode: "jev_then_grok", jevKey: "j", jevFetch });
    expect(res.map((x) => x.via)).toEqual(["jev", "jev_person", "grok"]);
    expect(grokCalls).toEqual(["B2609-107"]);

    const down = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    const res2 = await runPass3(inputs, r.openAmount, { apiKey: "k", model: "m", fetch: stubFetch(d.truth) }, { mode: "jev_then_grok", jevKey: "j", jevFetch: down });
    expect(res2.every((x) => x.via === "grok")).toBe(true);
  });
});
