// Pass 3 plumbing without a key: the stub answers through the same chat-completion path the xAI call uses.
import { describe, expect, it } from "vitest";
import { proposeAll, proposeLine, pass3Input, stubFetch } from "./agent";
import { candidates } from "./candidates";
import { loadData } from "./data";
import { allocate } from "./match";

const d = loadData({ months: ["2026-09"] });
const r = allocate(d.charges, d.bankLines);
const inputs = r.leftover.map((b) => pass3Input(candidates(b, d.charges, r.openAmount, d.tenants, [], d.bankLines), d.tenants, d.notes, d.companyLookup));

describe("pass 3 through the xAI request path (stub)", () => {
  it("accepts answers that add up and allocate only candidate charges", async () => {
    const res = await proposeAll({ apiKey: "k", model: "m", fetch: stubFetch(d.truth) }, inputs, r.openAmount);
    expect(res.every((x) => x.proposal && x.tries === 1)).toBe(true);
  });

  it("rejects an answer 1p off, sends the reason back, and accepts the corrected retry", async () => {
    const withMoney = inputs.find((i) => d.truth.find((t) => t.bank_line_id === i.bank_line.id)!.true_charge_ids)!;
    const res = await proposeLine({ apiKey: "k", model: "m", fetch: stubFetch(d.truth, 1) }, withMoney, r.openAmount);
    expect(res.tries).toBe(2);
    expect(res.rejected[0]).toMatch(/does not equal/);
    expect(res.proposal).not.toBeNull();
  });

  it("sends a line to a person when the model keeps returning nonsense", async () => {
    const junk = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "sure, here you go" } }] }))) as typeof fetch;
    const res = await proposeLine({ apiKey: "k", model: "m", fetch: junk }, inputs[0], r.openAmount);
    expect(res.proposal).toBeNull();
    expect(res.rejected).toEqual(["not JSON", "not JSON"]);
  });

  it("gives the agent the dispute notes for short-pays and the company lookup for parent payers", () => {
    const sp = inputs.find((i) => d.truth.find((t) => t.bank_line_id === i.bank_line.id)!.case === "short_pay")!;
    expect(sp.tenant_notes.length).toBeGreaterThan(0);
    expect(inputs[0].company_lookup.length).toBe(d.companyLookup.length);
  });
});
