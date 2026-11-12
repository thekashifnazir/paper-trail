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

  it("never sends the answer key to the model: no case_type or true_* in any request body", async () => {
    const bodies: string[] = [];
    const spy = stubFetch(d.truth);
    const capture = (async (url: string, init?: RequestInit) => { bodies.push(String(init?.body)); return spy(url, init); }) as typeof fetch;
    await proposeAll({ apiKey: "k", model: "m", fetch: capture }, inputs, r.openAmount);
    expect(bodies.length).toBe(inputs.length);
    for (const b of bodies) expect(b).not.toMatch(/case_type|true_allocations|true_unallocated|true_charge|"case"/);
  });

  it("gives the agent the dispute notes for short-pays and the company lookup for parent payers", () => {
    const sp = inputs.find((i) => d.truth.find((t) => t.bank_line_id === i.bank_line.id)!.case === "short_pay")!;
    expect(sp.tenant_notes.length).toBeGreaterThan(0);
    expect(inputs[0].company_lookup.length).toBe(d.companyLookup.length);
  });
});

describe("POST /api/agent (xAI stubbed)", () => {
  it("runs pass 3 on the month's open lines through the same proposal check", async () => {
    const { vi } = await import("vitest");
    const { POST: statements } = await import("@/app/api/statements/route");
    const { POST: runPass } = await import("@/app/api/run/route");
    const { POST: agent } = await import("@/app/api/agent/route");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { SAMPLE_DIR } = await import("./data");
    delete (globalThis as { __cashStore?: unknown }).__cashStore;
    vi.stubEnv("XAI_API_KEY", "test");
    vi.stubGlobal("fetch", stubFetch(d.truth));
    try {
      const U = "http://app.test";
      await statements(new Request(U, { method: "POST", headers: { "content-type": "text/csv" }, body: readFileSync(join(SAMPLE_DIR, "bank_2026_09.csv"), "utf8") }));
      // plain /api/run is passes 1 and 2 only; /api/run?month= would also run pass 3
      expect(await (await runPass(new Request(U, { method: "POST" }))).json()).toMatchObject({ left_open: 20 });
      const out = await (await agent(new Request(`${U}/?month=2026-09`, { method: "POST" }))).json();
      // 20 open: 8 parent payers wait (stub confidence 0.6), 5 short-pays + 3 overpayments allocated, 2 duplicates + 2 unidentifiable held
      expect(out).toMatchObject({ lines: 20, allocated: 8, waiting_for_approval: 8, held: 4 });
      expect(out.to_a_person).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe("POST /api/agent?replay= (saved run, no xAI)", () => {
  it("answers from results/2026-09.json through propose(), with evidence counts", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync("results/2026-09.json")) return;
    const { join } = await import("node:path");
    const { POST: statements } = await import("@/app/api/statements/route");
    const { POST: runPass } = await import("@/app/api/run/route");
    const { POST: agent } = await import("@/app/api/agent/route");
    const { SAMPLE_DIR } = await import("./data");
    delete (globalThis as { __cashStore?: unknown }).__cashStore;
    const U = "http://app.test";
    await statements(new Request(U, { method: "POST", headers: { "content-type": "text/csv" }, body: readFileSync(join(SAMPLE_DIR, "bank_2026_09.csv"), "utf8") }));
    await runPass(new Request(U, { method: "POST" }));
    const out = await (await agent(new Request(`${U}/?month=2026-09&replay=results/2026-09.json`, { method: "POST" }))).json();
    expect(out.source).toBe("replay results/2026-09.json");
    expect(out.lines).toBe(20);
    expect(out.allocated + out.waiting_for_approval + out.held + out.to_a_person.length).toBe(20);
    expect(out.evidence_checked).toBeGreaterThan(0);
    expect(out.seconds).toBeLessThan(2);
    const bad = await agent(new Request(`${U}/?month=2026-09&replay=../.env`, { method: "POST" }));
    expect(bad.status).toBe(500);
  });
});
