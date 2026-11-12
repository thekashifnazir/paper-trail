// The Live (Supabase) path end to end against an in-memory fake of PostgREST seeded from data/sample: the real
// routes, scoped loads, the batched save and the trace. No network. Counts round trips so the batching stays put.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const dir = join(process.cwd(), "data", "sample");
const j = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const db: Record<string, Row[]> = {
  tenants: j("tenants.json"),
  charges: j("charges.json"),
  tenant_notes: j("tenant_notes.json").map((n: Row, i: number) => ({ id: i + 1, ...n })),
  company_lookup: j("company_lookup.json"),
  bank_lines: [], allocations: [], line_results: [], payer_aliases: [], audit_log: [],
};
const key: Record<string, (r: Row) => string> = {
  bank_lines: (r) => String(r.id), charges: (r) => String(r.id), line_results: (r) => String(r.bank_line_id),
  payer_aliases: (r) => String(r.payer_name_normalised),
};
const calls: { method: string; table: string }[] = [];

function filterOf(url: URL) {
  const conds = [...url.searchParams].filter(([k]) => !["select", "order", "on_conflict"].includes(k));
  return (r: Row) => conds.every(([k, v]) => {
    if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(r[k]));
    if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
    throw new Error(`fake PostgREST: unsupported filter ${k}=${v}`);
  });
}

async function fakeFetch(input: string | URL, init: RequestInit = {}) {
  const url = new URL(String(input));
  const table = url.pathname.split("/").pop()!;
  const method = (init.method ?? "GET").toUpperCase();
  calls.push({ method, table });
  const rows = db[table];
  if (!rows) return new Response(`no table ${table}`, { status: 404 });
  const match = filterOf(url);
  if (method === "GET") {
    const [a, b] = String((init.headers as Record<string, string>)?.Range ?? "0-999").split("-").map(Number);
    return new Response(JSON.stringify(rows.filter(match).slice(a, b + 1)), { status: 200 });
  }
  if (method === "DELETE") { db[table] = rows.filter((r) => !match(r)); return new Response(null, { status: 204 }); }
  if (method === "POST") {
    const add: Row[] = JSON.parse(String(init.body));
    const k = key[table];
    for (const r of add) {
      const hit = k && rows.find((x) => k(x) === k(r));
      if (hit) Object.assign(hit, r);
      else rows.push({ id: rows.length + 1, ...r });
    }
    return new Response(null, { status: 201 });
  }
  throw new Error(`fake PostgREST: ${method}`);
}

let routes: {
  run: typeof import("@/app/api/run/route").POST; lines: typeof import("@/app/api/lines/route").GET;
  approve: typeof import("@/app/api/lines/[id]/approve/route").POST; arrears: typeof import("@/app/api/arrears/route").GET;
  trace: typeof import("@/app/api/trace/route").GET;
};

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  delete process.env.CASH_DB;
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  routes = {
    run: (await import("@/app/api/run/route")).POST, lines: (await import("@/app/api/lines/route")).GET,
    approve: (await import("@/app/api/lines/[id]/approve/route")).POST, arrears: (await import("@/app/api/arrears/route")).GET,
    trace: (await import("@/app/api/trace/route")).GET,
  };
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

const writes = (from: number) => calls.slice(from).filter((c) => c.method !== "GET");
const lines = async () => (await routes.lines(new Request("http://x/api/lines?month=2026-09"))).json();

describe("Live mode on Supabase (fake PostgREST)", () => {
  it("runs September: statement, passes 1-3, one write per table, Server-Timing", async () => {
    const n = calls.length;
    const res = await routes.run(new Request("http://x/api/run?month=2026-09", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(/load;dur=\d+, compute;dur=\d+, save;dur=\d+/);
    const body = await res.json();
    expect(body.total_lines).toBe(200);
    expect(body.agent.waiting_for_approval).toBeGreaterThan(0);
    // bank_lines, then one round (allocations delete, line_results, charges, audit), then the allocations insert
    const w = writes(n).map((c) => `${c.method} ${c.table}`).sort();
    expect(w).toEqual(["DELETE allocations", "POST allocations", "POST audit_log", "POST bank_lines", "POST charges", "POST line_results"]);
    expect(db.line_results).toHaveLength(200);
  });

  it("reads lines for one month only: agent_raw for that month, no audit beyond people's decisions", async () => {
    const n = calls.length;
    const got = await lines();
    expect(got).toHaveLength(200);
    const reads = calls.slice(n);
    expect(reads.every((c) => c.method === "GET")).toBe(true);
    expect(reads.some((c) => c.table === "tenants" || c.table === "charges")).toBe(false); // cached per process
    const premier = got.find((l: { id: string }) => l.id === "B2609-006");
    expect(premier.status).toBe("proposed");
    expect(premier.evidence.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["company_lookup", "lease"]));
  });

  it("flags Fairway and Beacon in arrears while their payments wait", async () => {
    const a = await (await routes.arrears(new Request("http://x/api/arrears"))).json();
    const pending = a.arrears.filter((r: { payment_pending: boolean }) => r.payment_pending).map((r: { tenant_id: string }) => r.tenant_id);
    expect(pending).toEqual(expect.arrayContaining(["T086", "T089"]));
  });

  it("approving PREMIER GROUP PLC learns the payer, clears the sibling, and saves both", async () => {
    const res = await routes.approve(new Request("http://x/api/lines/B2609-001/approve", { method: "POST" }), { params: Promise.resolve({ id: "B2609-001" }) });
    const body = await res.json();
    expect(body.cleared).toEqual(["B2609-006"]);
    expect(db.payer_aliases.map((a) => a.payer_name_normalised)).toContain("PREMIER GROUP PLC");
    expect(db.allocations.filter((a) => a.bank_line_id === "B2609-006").map((a) => [a.method, a.status])).toEqual([["memory", "approved"]]);
    const after = await lines();
    const byId = new Map(after.map((l: { id: string }) => [l.id, l]));
    expect(byId.get("B2609-001")).toMatchObject({ status: "approved", method: "human" });
    expect(byId.get("B2609-006")).toMatchObject({ status: "approved", method: "memory" });
    // other months untouched: nothing but September was ever written
    expect(db.line_results.every((r) => String(r.bank_line_id).startsWith("B2609-"))).toBe(true);
  });

  it("keeps a trace of each request with the engine's decisions", async () => {
    const t = await (await routes.trace(new Request("http://x/api/trace?route=approve"))).json();
    const last = t.traces[0];
    expect(last.ok).toBe(true);
    expect(last.ms).toHaveProperty("save");
    expect(last.decisions.map((d: { action: string }) => d.action)).toEqual(expect.arrayContaining(["approved", "memory_cleared"]));
  });
});
