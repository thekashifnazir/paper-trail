// Payer isn't the tenant and isn't in memory yet -> a person decides; the approval becomes memory for next month.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/allocations/[id]/approve/route";
import { POST as proposals } from "@/app/api/proposals/route";
import { POST as runPass } from "@/app/api/run/route";
import { POST as statements } from "@/app/api/statements/route";
import { loadData, SAMPLE_DIR } from "./data";

const U = "http://app.test";
const upload = (m: string) => statements(new Request(U, { method: "POST", headers: { "content-type": "text/csv" }, body: readFileSync(join(SAMPLE_DIR, `bank_${m}.csv`), "utf8") }));
const post = (body: unknown, actor = "grok_bot") => new Request(U, { method: "POST", headers: { "content-type": "application/json", "x-actor": actor }, body: JSON.stringify(body) });
const d = loadData();
const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
const line = (id: string) => d.bankLines.find((b) => b.id === id)!;
const sure = (id: string) => {
  const t = truth.get(id)!;
  return {
    bank_line_id: id, confidence: 0.97, reasoning: "test",
    allocations: t.true_charge_ids.split(";").map((c, i) => ({ charge_id: c, amount: Number(t.true_amounts.split(";")[i]) })),
    unallocated_amount: Number(t.true_unallocated),
    evidence: [{ type: "bank_line", ref: id, quote: line(id).reference }],
  };
};

describe("payer isn't the tenant and not yet in memory -> a person", () => {
  beforeEach(() => { delete (globalThis as { __cashStore?: unknown }).__cashStore; });

  it("holds a confident parent-company allocation for a person; the approval makes October match from memory", async () => {
    await upload("2026_09");
    await runPass(new Request(`${U}/?month=2026-09`, { method: "POST" }));
    const parent = d.truth.find((t) => t.case === "parent_payer" && t.bank_line_id.startsWith("B2609"))!;
    const payer = line(parent.bank_line_id).payer_name;

    const res = await (await proposals(post(sure(parent.bank_line_id)))).json();
    expect(res.status).toBe("proposed"); // confidence 0.97 alone is not enough
    expect(res.review_reason).toBe("payer is not the tenant and not yet in payer memory");

    const ap = await (await approve(post({}, "human"), { params: Promise.resolve({ id: parent.bank_line_id }) })).json();
    expect(ap.learned_alias.payer_name).toBe(payer);

    await upload("2026_10");
    const oct = await (await runPass(new Request(`${U}/?month=2026-10`, { method: "POST" }))).json();
    const octSamePayer = d.truth.filter((t) => t.case === "parent_payer" && t.bank_line_id.startsWith("B2610") && line(t.bank_line_id).payer_name === payer).length;
    expect(octSamePayer).toBeGreaterThan(0);
    expect(oct.lines_memory).toBe(octSamePayer);
  });

  it("lets a tenant paying under its own (bank-truncated) name through without a person", async () => {
    await upload("2026_09");
    await runPass(new Request(`${U}/?month=2026-09`, { method: "POST" }));
    const over = d.truth.find((t) => t.case === "overpayment" && t.bank_line_id.startsWith("B2609"))!;
    expect(line(over.bank_line_id).payer_name.length).toBeLessThanOrEqual(18);
    const res = await (await proposals(post(sure(over.bank_line_id)))).json();
    expect(res.status).toBe("approved");
  });
});
