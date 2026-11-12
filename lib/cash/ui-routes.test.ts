// The UI's routes (lib/api.ts with mock mode off) over the real engine: the demo flow, replaying the saved run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approve } from "@/app/api/lines/[id]/approve/route";
import { GET as arrears } from "@/app/api/arrears/route";
import { GET as audit } from "@/app/api/audit/route";
import { GET as lines } from "@/app/api/lines/route";
import { POST as reset } from "@/app/api/reset/route";
import { POST as runMonth } from "@/app/api/run/route";
import { GET as summary } from "@/app/api/summary/route";
import type { ArrearsRow, LineView, RunSummary } from "@/lib/types";

const U = "http://app.test";
const human = { method: "POST", headers: { "x-actor": "human" } };
const get = async <T>(h: (r: Request) => Promise<Response>, q = "") => (await h(new Request(`${U}/${q}`))).json() as Promise<T>;

describe("UI routes over the real engine (replayed pass 3)", () => {
  beforeEach(() => { vi.stubEnv("CASH_AGENT_REPLAY", "1"); vi.stubEnv("CASH_AS_OF", "2026-11-12"); delete (globalThis as { __cashStore?: unknown }).__cashStore; });
  afterEach(() => vi.unstubAllEnvs());

  it("reset, run September, approve a parent payer, run October from memory, arrears, audit", async () => {
    await reset();
    const sep = (await (await runMonth(new Request(`${U}/?month=2026-09`, { method: "POST" }))).json()) as RunSummary & { agent: { source: string } };
    expect(sep.total_lines).toBe(200);
    expect(sep.agent.source).toBe("replay results/2026-09.json");
    expect(sep.in_queue).toBe(12); // 8 parent payers, 2 duplicates, 2 unidentifiable
    expect(sep.score?.wrong_allocations).toBe(0);

    const sepLines = await get<LineView[]>(lines, "?month=2026-09");
    const queue = sepLines.filter((l) => l.status === "proposed");
    expect(queue.filter((l) => l.review_reason === "New payer relationship")).toHaveLength(8);
    expect(queue.filter((l) => l.review_reason === "Possible duplicate payment" || l.review_reason === "Unidentified receipt")).toHaveLength(4);
    const parent = queue.find((l) => l.review_reason === "New payer relationship")!;
    expect(parent.allocations[0].tenant_name).toBeTruthy();
    expect(parent.evidence.length).toBeGreaterThan(0);

    const ap = await (await approve(new Request(U, human), { params: Promise.resolve({ id: parent.id }) })).json();
    expect(ap.remembered).toBe(`Remembered: ${parent.payer_name} pays for ${parent.allocations[0].tenant_name}`);
    for (const l of queue.filter((x) => x.review_reason === "New payer relationship" && x.id !== parent.id)) await approve(new Request(U, human), { params: Promise.resolve({ id: l.id }) });

    const oct = (await (await runMonth(new Request(`${U}/?month=2026-10`, { method: "POST" }))).json()) as RunSummary & { lines_memory: number };
    expect(oct.lines_memory).toBe(8);
    expect(oct.in_queue).toBe(4);
    expect(oct.score?.wrong_allocations).toBe(0);
    const octLines = await get<LineView[]>(lines, "?month=2026-10");
    expect(octLines.filter((l) => l.method === "memory" && l.status === "approved")).toHaveLength(8);

    const ar = await get<{ arrears: ArrearsRow[] }>(arrears);
    expect(ar.arrears.length).toBeGreaterThan(0);
    const row = ar.arrears[0];
    for (const k of ["outstanding", "oldest_due_date", "days_overdue", "disputed", "dispute_note", "lease_citation", "open_charges"]) expect(row).toHaveProperty(k);
    expect(ar.arrears.some((r) => r.disputed && r.dispute_note)).toBe(true);

    const au = await get<{ actor: string; action: string }[]>(audit);
    expect(au.some((r) => r.actor === "human" && r.action === "approved")).toBe(true);
    expect(await get<RunSummary>(summary, "?month=2026-10")).toMatchObject({ month: "2026-10", total_lines: 200 });
  });

  it("never returns the answer key in a line", async () => {
    await runMonth(new Request(`${U}/?month=2026-09`, { method: "POST" }));
    expect(JSON.stringify(await get(lines, "?month=2026-09"))).not.toMatch(/case_type|true_allocations|true_unallocated/);
  });
});
