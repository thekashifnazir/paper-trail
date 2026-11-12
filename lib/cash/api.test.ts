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
import { DATA_DIR, hasData, loadData } from "./data";
import { fmt, toPence } from "./money";

const U = "http://app.test";
const json = (method: string, body: unknown, actor = "grok_bot") =>
  new Request(U, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const run = hasData() ? describe : describe.skip;
run("Grok Bot drives the app (local event data)", () => {
  const d = loadData();
  const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
  beforeEach(() => {
    delete (globalThis as { __cashStore?: unknown }).__cashStore;
  });

  it("runs the whole flow and ends at 100% precision with the sum check enforced", async () => {
    const csv = readFileSync(join(DATA_DIR, "bank_lines.csv"), "utf8");
    const st = await (await statements(new Request(U, { method: "POST", headers: { "content-type": "text/csv" }, body: csv }))).json();
    expect(st.added).toBe(d.bankLines.length);

    expect(await (await runPass()).json()).toMatchObject({ lines_exact: 149, lines_memory: 0, left_open: 30 });

    const ex = await (await exceptions()).json();
    expect(ex.open_lines).toHaveLength(30);

    // a proposal 1p off is rejected with the reason, and nothing is written
    const first = ex.open_lines.find((i: { bank_line: { id: string } }) => truth.get(i.bank_line.id)!.true_charge_ids)!;
    const t0 = truth.get(first.bank_line.id)!;
    const bad = await proposals(json("POST", {
      bank_line_id: first.bank_line.id,
      allocations: [{ charge_id: t0.true_charge_ids.split(";")[0], amount: Number(fmt(toPence(t0.true_amounts.split(";")[0]) - 1)) }],
      unallocated_amount: 0, confidence: 0.9, reasoning: "off by a penny", evidence: [],
    }));
    if (t0.true_charge_ids.split(";").length === 1 && toPence(first.bank_line.amount) === toPence(t0.true_amounts)) expect(bad.status).toBe(422);
    expect((await (await exceptions()).json()).open_lines).toHaveLength(30);

    // work every exception from the truth; parent-company payers go in below the threshold so a person approves
    let queued = 0;
    for (const item of ex.open_lines) {
      const t = truth.get(item.bank_line.id)!;
      const ids = t.true_charge_ids ? t.true_charge_ids.split(";") : [];
      const amts = t.true_amounts ? t.true_amounts.split(";") : [];
      const allocated = amts.reduce((s: number, a: string) => s + toPence(a), 0);
      const low = t.case === "parent_company";
      queued += low ? 1 : 0;
      const res = await proposals(json("POST", {
        bank_line_id: item.bank_line.id,
        allocations: ids.map((id, i) => ({ charge_id: id, amount: Number(amts[i]) })),
        unallocated_amount: Number(fmt(toPence(item.bank_line.amount) - allocated)),
        confidence: low ? 0.6 : ids.length ? 0.95 : 0,
        reasoning: ids.length ? `case ${t.case}` : `left open: ${t.case}`,
        evidence: [{ type: "bank_line", ref: item.bank_line.id, quote: item.bank_line.reference }],
      }));
      expect(res.status, `${item.bank_line.id} ${t.case}`).toBe(200);
    }
    expect((await (await metrics()).json()).waiting_for_approval).toBe(queued);

    // a person approves one parent-company line: the app learns the payer
    const parentLine = d.truth.find((t) => t.case === "parent_company")!.bank_line_id;
    const ap = await (await approve(json("POST", {}, "human"), ctx(parentLine))).json();
    expect(ap.status).toBe("approved");
    expect(ap.learned_alias?.source).toBe("human");

    const why = await (await explain(new Request(U), ctx(parentLine))).json();
    expect(why.state).toBe("allocated");
    expect(why.decided_by.actor).toBe("human");
    // the audit trail ends with Grok Bot's proposal and the person's approval (a rejected 1p-off try may precede them)
    expect(why.audit.slice(-2).map((r: { actor: string; action: string }) => `${r.actor}:${r.action}`)).toEqual(["grok_bot:agent_proposed", "human:approved"]);

    for (const t of d.truth.filter((x) => x.case === "parent_company" && x.bank_line_id !== parentLine)) {
      await approve(json("POST", {}, "human"), ctx(t.bank_line_id));
    }
    const m = await (await metrics()).json();
    expect(m.open).toBe(0);
    expect(m.against_truth.wrong).toBe(0);
    expect(m.against_truth.right).toBe(d.truth.filter((t) => t.true_charge_ids).length);

    const ar = await (await arrears(new Request(`${U}/?sort=amount`))).json();
    console.log(`arrears after a perfect run: ${ar.tenants} tenants, £${ar.total_open}`);
    expect(ar.tenants).toBeGreaterThan(0);
  });
});
