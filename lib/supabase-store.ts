// The engine's Store, loaded from and saved to Supabase per request, so state survives serverless instances.
// The engine (lib/cash) is untouched: every service function takes a Store, and the routes hand it this one.
//
// Table mapping (supabase/schema.sql, no schema changes):
//   tenants, charges, tenant_notes, company_lookup  -> reference data (cached per process)
//   bank_lines                                      -> bankLines; case_type/true_* only feed the score (never the UI)
//   allocations                                     -> allocations (engine id = "<bank_line_id>:<charge_id>")
//   line_results                                    -> one row per processed line: the UI view columns, plus
//                                                      agent_raw = { allocations: [{charge_id, confidence, evidence}],
//                                                      hold, reasoning, review_reason_raw } so the engine state rebuilds exactly
//   payer_aliases, audit_log                        -> aliases, audit
//   charges.amount_paid                             -> sum of approved allocations, written for every touched charge
import { emptyStore, HttpError, type AuditRow, type Hold, type Store } from "@/lib/cash/service";
import type { CompanyLookup, TenantNote } from "@/lib/cash/data";
import { fmt, toPence } from "@/lib/cash/money";
import type { TruthRow } from "@/lib/cash/score";
import type { Allocation, BankLine, Charge, PayerAlias, Tenant } from "@/lib/cash/types";
import { lineViews } from "@/lib/cash/view";
import { dbEnabled, inList, insertRows, sb, sbStats, selectAll } from "@/lib/supabase-server";

// In DB mode this layer owns every write; stop the engine's own fire-and-forget alias/audit writes (lib/cash/persist.ts).
if (dbEnabled()) process.env.CASH_PERSIST = "0";

const monthOf = (b: { statement_month?: string; date: string }) => b.statement_month ?? b.date.slice(0, 7);

interface Ref { tenants: Tenant[]; charges: Charge[]; notes: TenantNote[]; lookup: CompanyLookup[] }
const g = globalThis as unknown as { __sbRef?: Promise<Ref>; __sbLock?: Promise<unknown> };

async function loadRef(): Promise<Ref> {
  const [tenants, charges, notes, lookup] = await Promise.all([
    selectAll<{ id: string; name: string; unit: string | null; lease_citation: string | null }>("tenants", "select=id,name,unit,lease_citation&order=id"),
    selectAll<{ id: string; tenant_id: string; type: string; period: string; amount_due: number; due_date: string; invoice_ref: string }>("charges", "select=id,tenant_id,type,period,amount_due,due_date,invoice_ref&order=id"),
    selectAll<{ tenant_id: string; date: string; note: string }>("tenant_notes", "select=tenant_id,date,note&order=id"),
    selectAll<CompanyLookup>("company_lookup", "select=payer_name,group_members,source"),
  ]);
  const parentOf = new Map(lookup.flatMap((l) => l.group_members.map((m) => [m.toUpperCase(), l.payer_name] as const)));
  const byId = new Map(tenants.map((t) => [t.id, t]));
  return {
    tenants: tenants.map((t) => ({ tenant_id: t.id, tenant_name: t.name, unit: t.unit ?? "", parent_company: parentOf.get(t.name.toUpperCase()) ?? "" })),
    charges: charges.map((c) => {
      const t = byId.get(c.tenant_id);
      return { id: c.id, tenant_id: c.tenant_id, tenant_name: t?.name ?? "", unit: t?.unit ?? "", type: c.type, period: c.period, amount_due: Number(c.amount_due).toFixed(2), due_date: c.due_date, invoice_ref: c.invoice_ref, lease_citation: t?.lease_citation ?? "" };
    }),
    notes,
    lookup,
  };
}

interface Raw { allocations?: { charge_id: string; confidence: number; evidence: Allocation["evidence"] }[]; hold?: Hold | null; reasoning?: string | null; review_reason_raw?: string | null }

export interface DbCtx {
  /** Months with at least one processed line: the UI sees a statement once it has been run. */
  loaded: Set<string>;
  /** The store limited to loaded months, for the read views (lines, summary). */
  view: () => Store;
  /** Force line_results rows for every line of this month on save (marks the month loaded). */
  touchMonth: (m: string) => void;
}

/**
 * What a request reads. Default (no scope, audit "full") is the whole store, as every route had before.
 * - month / lineId: agent_raw (confidence, evidence, holds, reasoning) only for that month's lines; other months keep
 *   their allocations (openAmounts needs every month) but with empty evidence, identical before and after, so the
 *   save diff never rewrites them.
 * - raw: false reads no agent_raw at all (routes that only need amounts and statuses).
 * - audit: "none" skips the log; "decisions" reads only people's decisions (lineViews' method "human"); "full" all.
 *   saveStore appends only rows added after the ones loaded, so a partial log stays correct.
 */
export interface DbScope { month?: string; lineId?: string; audit?: "full" | "decisions" | "none"; /** false: no agent_raw at all (arrears) */ raw?: boolean }

type LineRow = { id: string; statement_month: string; date: string; amount: number; payer_name: string; reference: string; case_type: string | null; true_allocations: { charge_id: string; amount: number }[] | null; true_unallocated: number | null };
const gl = globalThis as unknown as { __sbLines?: Promise<LineRow[]> };

// bank_lines only ever grow (statements loaded from data/sample, same rows on every instance): cached per process,
// appended to when this process inserts, refetched when a scope names a month or line the cache does not have.
async function bankLines(want?: { month?: string; lineId?: string }): Promise<LineRow[]> {
  const fetchAll = () => selectAll<LineRow>("bank_lines", "select=*&order=id");
  gl.__sbLines ??= fetchAll().catch((e) => { gl.__sbLines = undefined; throw e; });
  let rows = await gl.__sbLines;
  const has = (r: LineRow[]) => (!want?.month || r.some((b) => monthOf(b) === want.month)) && (!want?.lineId || r.some((b) => b.id === want.lineId));
  if (!has(rows)) { gl.__sbLines = fetchAll(); rows = await gl.__sbLines; }
  return rows;
}

const DECISIONS = "actor=eq.human&action=in.(approved,hold_confirmed,manual_match)";

async function loadStore(scope: DbScope): Promise<{ s: Store; ctx: DbCtx; before: Snapshot }> {
  g.__sbRef ??= loadRef().catch((e) => { g.__sbRef = undefined; throw e; });
  const [ref, lines] = await Promise.all([g.__sbRef, bankLines(scope)]);
  const scopeMonth = scope.month ?? (scope.lineId ? lines.find((b) => b.id === scope.lineId)?.statement_month : undefined);
  const scopedIds = scope.raw === false ? [] : scopeMonth ? lines.filter((b) => monthOf(b) === scopeMonth).map((b) => b.id) : null;
  const audit = scope.audit ?? "full";
  const [allocs, resultIds, results, aliases, auditRows] = await Promise.all([
    selectAll<{ bank_line_id: string; charge_id: string; amount: number; method: Allocation["method"]; status: Allocation["status"] }>("allocations", "select=bank_line_id,charge_id,amount,method,status&order=bank_line_id"),
    scopedIds ? selectAll<{ bank_line_id: string }>("line_results", "select=bank_line_id") : Promise.resolve(null),
    scopedIds && !scopedIds.length ? Promise.resolve([])
      : selectAll<{ bank_line_id: string; agent_raw: Raw | null }>("line_results", `select=bank_line_id,agent_raw${scopedIds ? `&bank_line_id=${inList(scopedIds)}` : ""}`),
    selectAll<{ payer_name_normalised: string; tenant_id: string; source: string | null; approved_at: string | null }>("payer_aliases", "select=*&order=approved_at"),
    audit === "none" ? Promise.resolve([])
      : selectAll<{ ts: string; actor: AuditRow["actor"]; action: string; object_id: string | null; detail: unknown }>("audit_log", `select=ts,actor,action,object_id,detail${audit === "decisions" ? `&${DECISIONS}` : ""}&order=id`),
  ]);
  const s = emptyStore();
  Object.assign(s, { tenants: ref.tenants, charges: ref.charges, notes: ref.notes, lookup: ref.lookup });
  s.bankLines = lines.map((b): BankLine => ({ id: b.id, statement_month: b.statement_month, date: b.date, amount: Number(b.amount).toFixed(2), payer_name: b.payer_name ?? "", reference: b.reference ?? "" }));
  s.truth = lines.filter((b) => b.case_type).map((b): TruthRow => {
    const want = b.true_allocations ?? [];
    return { bank_line_id: b.id, case: b.case_type!, true_charge_ids: want.map((w) => w.charge_id).join(";"), true_amounts: want.map((w) => Number(w.amount).toFixed(2)).join(";"), true_unallocated: Number(b.true_unallocated ?? 0).toFixed(2) };
  });
  const raw = new Map(results.map((r) => [r.bank_line_id, r.agent_raw ?? {}]));
  s.allocations = allocs.map((a): Allocation => {
    const extra = raw.get(a.bank_line_id)?.allocations?.find((x) => x.charge_id === a.charge_id);
    return { id: `${a.bank_line_id}:${a.charge_id}`, bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: toPence(a.amount), method: a.method, status: a.status, confidence: extra?.confidence ?? 1, evidence: extra?.evidence ?? [] };
  });
  for (const [id, r] of raw) {
    if (r.hold) s.holds.push(r.hold);
    if (r.reasoning) s.reasoning.set(id, r.reasoning);
    if (r.review_reason_raw) s.reviewReason.set(id, r.review_reason_raw);
  }
  s.aliases = aliases.map((r): PayerAlias => ({ payer_name: r.payer_name_normalised, tenant_id: r.tenant_id, source: r.source === "seed" ? "seed" : "human", approved_at: r.approved_at ?? new Date().toISOString() }));
  s.audit = auditRows.map((r): AuditRow => ({ at: r.ts, actor: r.actor, action: r.action, bank_line_id: r.object_id ?? undefined, detail: r.detail }));

  const monthById = new Map(s.bankLines.map((b) => [b.id, monthOf(b)]));
  const processed = resultIds ? resultIds.map((r) => r.bank_line_id) : [...raw.keys()];
  const loaded = new Set(processed.map((id) => monthById.get(id)).filter((m): m is string => Boolean(m)));
  const forced = new Set<string>();
  const ctx: DbCtx = {
    loaded,
    view: () => ({ ...s, bankLines: s.bankLines.filter((b) => loaded.has(monthOf(b))) }),
    touchMonth: (m) => { forced.add(m); loaded.add(m); },
  };
  return { s, ctx, before: snapshot(s, forced) };
}

interface Snapshot { lines: Map<string, string>; bankIds: Set<string>; aliases: number; audit: number; forced: Set<string> }

function lineState(s: Store, id: string, allocs = s.allocations.filter((a) => a.bank_line_id === id)) {
  return JSON.stringify({
    a: allocs.map((a) => [a.charge_id, a.amount, a.method, a.status, a.confidence, a.evidence]),
    h: s.holds.find((h) => h.bank_line_id === id) ?? null,
    r: s.reasoning.get(id) ?? null,
    q: s.reviewReason.get(id) ?? null,
  });
}

const byLine = (s: Store) => {
  const m = new Map<string, Allocation[]>();
  for (const a of s.allocations) m.set(a.bank_line_id, [...(m.get(a.bank_line_id) ?? []), a]);
  return m;
};

function snapshot(s: Store, forced: Set<string>): Snapshot {
  const allocs = byLine(s);
  return { lines: new Map(s.bankLines.map((b) => [b.id, lineState(s, b.id, allocs.get(b.id) ?? [])])), bankIds: new Set(s.bankLines.map((b) => b.id)), aliases: s.aliases.length, audit: s.audit.length, forced };
}

/**
 * Write what changed, in two rounds of parallel requests (three when a new statement arrived):
 *   [new bank_lines] -> [DELETE changed lines' allocations | line_results | charges.amount_paid | aliases | audit]
 *   -> [INSERT their allocations]. allocations has a surrogate uuid key, so its delete must land before the insert.
 */
async function saveStore(s: Store, before: Snapshot) {
  const allocs = byLine(s);
  const changed = s.bankLines.filter((b) => before.forced.has(monthOf(b)) || before.lines.get(b.id) !== lineState(s, b.id, allocs.get(b.id) ?? [])).map((b) => b.id);

  const newLines = s.bankLines.filter((b) => !before.bankIds.has(b.id));
  if (newLines.length) {
    await insertRows("bank_lines", newLines.map((b) => ({ id: b.id, statement_month: monthOf(b), date: b.date, amount: Number(b.amount), payer_name: b.payer_name, reference: b.reference })), true);
    gl.__sbLines = undefined; // next request refetches, with case_type for the score
  }

  const round: Promise<unknown>[] = [];
  let rows: Allocation[] = [];
  if (changed.length) {
    const ids = new Set(changed);
    for (let i = 0; i < changed.length; i += 250) round.push(sb("DELETE", `allocations?bank_line_id=${inList(changed.slice(i, i + 250))}`, undefined, "return=minimal"));
    rows = s.allocations.filter((a) => ids.has(a.bank_line_id));
    const views = new Map(lineViews(s).filter((v) => ids.has(v.id)).map((v) => [v.id, v]));
    round.push(insertRows("line_results", changed.map((id) => {
      const v = views.get(id)!;
      const mine = allocs.get(id) ?? [];
      const raw: Raw = {
        allocations: mine.map((a) => ({ charge_id: a.charge_id, confidence: a.confidence, evidence: a.evidence })),
        hold: s.holds.find((h) => h.bank_line_id === id) ?? null,
        reasoning: s.reasoning.get(id) ?? null,
        review_reason_raw: s.reviewReason.get(id) ?? null,
      };
      return { bank_line_id: id, method: v.method, status: v.status, confidence: v.confidence, unallocated_amount: v.unallocated_amount, review_reason: v.review_reason, reasoning: v.reasoning, evidence: v.evidence, agent_raw: raw };
    }), true));

    // charges.amount_paid = approved allocations, for every charge a changed line touches (now or before)
    const touched = new Set(rows.map((a) => a.charge_id));
    for (const id of changed) for (const [cid] of JSON.parse(before.lines.get(id) ?? '{"a":[]}').a as [string][]) touched.add(cid);
    if (touched.size) {
      const paid = new Map([...touched].map((c) => [c, 0]));
      for (const a of s.allocations) if (a.status === "approved" && paid.has(a.charge_id)) paid.set(a.charge_id, paid.get(a.charge_id)! + a.amount);
      round.push(insertRows("charges", [...paid].map(([id, p]) => ({ id, amount_paid: Number(fmt(p)) })), true));
    }
  }

  const aliases = s.aliases.slice(before.aliases);
  if (aliases.length) round.push(insertRows("payer_aliases", aliases.map((a) => ({ payer_name_normalised: a.payer_name.toUpperCase(), tenant_id: a.tenant_id, source: a.source, approved_at: a.approved_at })), true));

  const audit = s.audit.slice(before.audit);
  if (audit.length) round.push(insertRows("audit_log", audit.map((r) => ({ ts: r.at, actor: r.actor, action: r.action, object_id: r.bank_line_id ?? null, detail: r.detail ?? null }))));

  await Promise.all(round);
  if (rows.length) await insertRows("allocations", rows.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: Number(fmt(a.amount)), method: a.method, status: a.status })));
}

// ---- Trace: what a Live request did, for GET /api/trace and the Vercel logs -------------------------------------

export interface Trace {
  at: string;
  route: string;
  ms: Record<string, number>;
  requests: { load: number; save: number };
  ok: boolean;
  error?: string;
  /** The engine's own record of this request (audit rows it added): passes, agent proposals with confidence,
   *  reasoning and rejected evidence, lines sent to a person and why, approvals, learned payers. */
  decisions: { actor: string; action: string; line?: string; detail: unknown }[];
}
const gt = globalThis as unknown as { __sbTraces?: Trace[] };
export const recentTraces = () => [...(gt.__sbTraces ?? [])].reverse();
function keepTrace(t: Trace) {
  (gt.__sbTraces ??= []).push(t);
  if (gt.__sbTraces.length > 50) gt.__sbTraces.shift();
}

/**
 * Route wrapper in DB mode: load the store from Supabase, run fn, save what changed (awaited), answer JSON.
 * Writes are serialised within a process. Errors are logged with the route and returned as { error }.
 * Every response carries Server-Timing (wait, load, compute, save, total) and is kept in the trace buffer.
 */
export async function withDb(route: string, fn: (s: Store, ctx: DbCtx) => unknown | Promise<unknown>, opts: { write?: boolean } & DbScope = {}): Promise<Response> {
  const t: Record<string, number> = {};
  const req = { load: 0, save: 0 };
  let decisions: Trace["decisions"] = [];
  const t0 = performance.now();
  const work = async () => {
    t.wait = performance.now() - t0;
    const r0 = sbStats.requests;
    let m = performance.now();
    const { s, ctx, before } = await loadStore(opts);
    t.load = performance.now() - m; req.load = sbStats.requests - r0;
    m = performance.now();
    const out = await fn(s, ctx);
    t.compute = performance.now() - m;
    decisions = s.audit.slice(before.audit).map((a) => ({ actor: a.actor, action: a.action, line: a.bank_line_id, detail: a.detail }));
    if (opts.write) {
      const r1 = sbStats.requests;
      m = performance.now();
      await saveStore(s, before);
      t.save = performance.now() - m; req.save = sbStats.requests - r1;
    }
    return out;
  };
  const finish = (ok: boolean, error?: string) => {
    t.total = performance.now() - t0;
    const ms = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
    keepTrace({ at: new Date().toISOString(), route, ms, requests: req, ok, error, decisions });
    console.info(`[db] ${route} ${ok ? "ok" : "FAILED"} total=${ms.total}ms wait=${ms.wait ?? "-"} load=${ms.load ?? "-"} (${req.load} req) compute=${ms.compute ?? "-"}${opts.write ? ` save=${ms.save ?? "-"} (${req.save} req)` : ""} decisions=${decisions.length}${error ? ` error=${error}` : ""}`);
    return ["wait", "load", "compute", "save", "total"].filter((k) => ms[k] !== undefined).map((k) => `${k};dur=${ms[k]}`).join(", ");
  };
  try {
    const p = opts.write ? (g.__sbLock = (g.__sbLock ?? Promise.resolve()).catch(() => undefined).then(work)) : work();
    const out = await p;
    return Response.json(out, { headers: { "Server-Timing": finish(true) } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timing = finish(false, msg);
    if (e instanceof HttpError) return Response.json({ error: msg }, { status: e.status, headers: { "Server-Timing": timing } });
    console.error(`[db] ${route}: ${msg}`);
    return Response.json({ error: msg }, { status: 500, headers: { "Server-Timing": timing } });
  }
}

/** Demo reset in Supabase: forget processed lines, allocations, learned payers and the audit log; zero amount_paid.
 *  Keeps tenants, charges, bank_lines, tenant_notes, company_lookup. */
export async function resetDb() {
  await sb("DELETE", "allocations?bank_line_id=not.is.null", undefined, "return=minimal");
  await sb("DELETE", "line_results?bank_line_id=not.is.null", undefined, "return=minimal");
  await sb("DELETE", "payer_aliases?payer_name_normalised=not.is.null", undefined, "return=minimal");
  await sb("DELETE", "audit_log?id=gte.0", undefined, "return=minimal");
  await sb("PATCH", "charges?amount_paid=neq.0", { amount_paid: 0 }, "return=minimal");
  await insertRows("audit_log", [{ ts: new Date().toISOString(), actor: "system", action: "reset", object_id: null, detail: { persisted: true, store: "supabase" } }]);
  return { reset: true, persisted: true };
}

export { dbEnabled };
