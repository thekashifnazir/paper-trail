// The demo flow through the real route handlers: load, run, work exceptions as Grok Bot would, approve, explain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/allocations/[id]/approve/route";
import { GET as explain } from "@/app/api/allocations/[id]/explain/route";
import { GET as arrears } from "@/app/api/arrears/route";
import { GET as exceptions } from "@/app/api/exceptions/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { POST as proposals } from "@/app/api/proposals/route";
import { POST as runPass } from "@/app/api/run/route";
import { POST as statements } from "@/app/api/statements/route";
import { SAMPLE_DIR, loadData } from "./data";
import { fmt, toPence } from "./money";

const U = "http://app.test";
const json = (method: string, body: unknown, actor = "grok_bot") =>
  new Request(U, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const csvOf = (m: string) => readFileSync(join(SAMPLE_DIR, `bank_${m}.csv`), "utf8");
const upload = (m: string) => statements(new Request(U, { method: "POST", headers: { "content-type": "text/csv", "x-actor": "grok_bot" }, body: csvOf(m) }));

describe("Grok Bot drives the app on the team sample (Sep, then Oct from memory)", () => {
  const d = loadData();
  const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
  beforeEach(() => {
    delete (globalThis as { __cashStore?: unknown }).__cashStore;
  });

  // a perfect agent: answers every open line from the answer key; parent payers go in below the threshold
  async function workExceptions() {
    const ex = await (await exceptions(new Request(U))).json();
    let queued = 0;
    for (const item of ex.open_lines) {
      const t = truth.get(item.bank_line.id)!;
      const ids = t.true_charge_ids ? t.true_charge_ids.split(";") : [];
      const amts = t.true_amounts ? t.true_amounts.split(";") : [];
      const low = t.case === "parent_payer";
      queued += low && ids.length ? 1 : 0;
      const res = await proposals(json("POST", {
        bank_line_id: item.bank_line.id,
        allocations: ids.map((id, i) => ({ charge_id: id, amount: Number(amts[i]) })),
        unallocated_amount: Number(t.true_unallocated),
        confidence: low ? 0.6 : ids.length ? 0.95 : 0,
        reasoning: ids.length ? `case ${t.case}` : `left open: ${t.case}`,
        evidence: [{ type: "bank_line", ref: item.bank_line.id, quote: item.bank_line.reference }],
      }));
      expect(res.status, `${item.bank_line.id} ${t.case}: ${JSON.stringify(await res.clone().json())}`).toBe(200);
    }
    return { open: ex.open_lines.length, queued };
  }

  it("runs the flow with the sum check enforced and ends at 100% precision", async () => {
    expect((await (await upload("2026_09")).json()).added).toBe(200);
    // pass 1 settles clean, bad_reference and combined (180); the agent gets parents, short-pays, overpayments,
    // duplicates and unidentifiable payers (20)
    expect(await (await runPass(new Request(U, { method: "POST" }))).json()).toMatchObject({ lines_exact: 180, lines_memory: 0, left_open: 20 });

    // a proposal 1p off is rejected with the reason, and nothing is written
    const sp = d.truth.find((t) => t.case === "overpayment" && t.bank_line_id.startsWith("B2609"))!;
    const bad = await proposals(json("POST", {
      bank_line_id: sp.bank_line_id, allocations: [{ charge_id: sp.true_charge_ids, amount: Number(sp.true_amounts) }],
      unallocated_amount: Number(fmt(toPence(sp.true_unallocated!) - 1)), confidence: 0.9, reasoning: "off by a penny", evidence: [],
    }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/does not equal/);

    const sep = await workExceptions();
    expect(sep.open).toBe(20);
    expect((await (await metrics()).json()).waiting_for_approval).toBe(sep.queued);

    // a person approves the parent payers: the app learns each payer
    const parents = d.truth.filter((t) => t.case === "parent_payer" && t.bank_line_id.startsWith("B2609"));
    const first = await (await approve(json("POST", {}, "human"), ctx(parents[0].bank_line_id))).json();
    expect(first.learned_alias?.source).toBe("human");
    for (const t of parents.slice(1)) await approve(json("POST", {}, "human"), ctx(t.bank_line_id));

    const why = await (await explain(new Request(U), ctx(parents[0].bank_line_id))).json();
    expect(why.state).toBe("allocated");
    expect(why.audit.slice(-2).map((r: { actor: string; action: string }) => `${r.actor}:${r.action}`)).toEqual(["grok_bot:agent_proposed", "human:approved"]);

    // October: the parent payers now match in pass 2, without the agent
    await upload("2026_10");
    const oct = await (await runPass(new Request(U, { method: "POST" }))).json();
    const octParents = d.truth.filter((t) => t.case === "parent_payer" && t.bank_line_id.startsWith("B2610")).length;
    expect(oct.lines_memory).toBe(octParents);
    await workExceptions();
    for (const t of d.truth.filter((x) => x.case === "parent_payer" && x.bank_line_id.startsWith("B2610"))) await approve(json("POST", {}, "human"), ctx(t.bank_line_id)).catch(() => undefined);

    const m = await (await metrics()).json();
    expect(m.open).toBe(0);
    expect(m.against_truth.wrong).toBe(0);
    expect(m.against_truth.right).toBe(d.truth.filter((t) => t.true_charge_ids).length);
    console.log(`Sep+Oct: ${JSON.stringify(m.lines_by_method)}, held ${m.held}, auto-match ${(m.auto_match_rate * 100).toFixed(1)}%`);

    const ar = await (await arrears(new Request(`${U}/?sort=amount`))).json();
    console.log(`arrears after a perfect run: ${ar.tenants} tenants, £${ar.total_open}`);
    expect(ar.tenants).toBeGreaterThan(0);
  });
});
