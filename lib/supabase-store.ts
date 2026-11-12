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
import { dbEnabled, inList, insertRows, sb, selectAll } from "@/lib/supabase-server";

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

async function loadStore(): Promise<{ s: Store; ctx: DbCtx; before: Snapshot }> {
  g.__sbRef ??= loadRef().catch((e) => { g.__sbRef = undefined; throw e; });
  const [ref, lines, allocs, results, aliases, audit] = await Promise.all([
    g.__sbRef,
    selectAll<{ id: string; statement_month: string; date: string; amount: number; payer_name: string; reference: string; case_type: string | null; true_allocations: { charge_id: string; amount: number }[] | null; true_unallocated: number | null }>("bank_lines", "select=*&order=id"),
    selectAll<{ bank_line_id: string; charge_id: string; amount: number; method: Allocation["method"]; status: Allocation["status"] }>("allocations", "select=bank_line_id,charge_id,amount,method,status&order=bank_line_id"),
    selectAll<{ bank_line_id: string; agent_raw: Raw | null }>("line_results", "select=bank_line_id,agent_raw"),
    selectAll<{ payer_name_normalised: string; tenant_id: string; source: string | null; approved_at: string | null }>("payer_aliases", "select=*&order=approved_at"),
    selectAll<{ ts: string; actor: AuditRow["actor"]; action: string; object_id: string | null; detail: unknown }>("audit_log", "select=ts,actor,action,object_id,detail&order=id"),
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
  s.audit = audit.map((r): AuditRow => ({ at: r.ts, actor: r.actor, action: r.action, bank_line_id: r.object_id ?? undefined, detail: r.detail }));

  const monthById = new Map(s.bankLines.map((b) => [b.id, monthOf(b)]));
  const loaded = new Set([...raw.keys()].map((id) => monthById.get(id)).filter((m): m is string => Boolean(m)));
  const forced = new Set<string>();
  const ctx: DbCtx = {
    loaded,
    view: () => ({ ...s, bankLines: s.bankLines.filter((b) => loaded.has(monthOf(b))) }),
    touchMonth: (m) => { forced.add(m); loaded.add(m); },
  };
  return { s, ctx, before: snapshot(s, forced) };
}

interface Snapshot { lines: Map<string, string>; bankIds: Set<string>; aliases: number; audit: number; forced: Set<string> }

function lineState(s: Store, id: string) {
  return JSON.stringify({
    a: s.allocations.filter((a) => a.bank_line_id === id).map((a) => [a.charge_id, a.amount, a.method, a.status, a.confidence, a.evidence]),
    h: s.holds.find((h) => h.bank_line_id === id) ?? null,
    r: s.reasoning.get(id) ?? null,
    q: s.reviewReason.get(id) ?? null,
  });
}

function snapshot(s: Store, forced: Set<string>): Snapshot {
  return { lines: new Map(s.bankLines.map((b) => [b.id, lineState(s, b.id)])), bankIds: new Set(s.bankLines.map((b) => b.id)), aliases: s.aliases.length, audit: s.audit.length, forced };
}

async function saveStore(s: Store, before: Snapshot) {
  const changed = s.bankLines.filter((b) => before.forced.has(monthOf(b)) || before.lines.get(b.id) !== lineState(s, b.id)).map((b) => b.id);

  const newLines = s.bankLines.filter((b) => !before.bankIds.has(b.id));
  if (newLines.length) await insertRows("bank_lines", newLines.map((b) => ({ id: b.id, statement_month: monthOf(b), date: b.date, amount: Number(b.amount), payer_name: b.payer_name, reference: b.reference })), true);

  if (changed.length) {
    const ids = new Set(changed);
    for (let i = 0; i < changed.length; i += 150) await sb("DELETE", `allocations?bank_line_id=${inList(changed.slice(i, i + 150))}`, undefined, "return=minimal");
    const rows = s.allocations.filter((a) => ids.has(a.bank_line_id));
    await insertRows("allocations", rows.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: Number(fmt(a.amount)), method: a.method, status: a.status })));
    const views = new Map(lineViews(s).filter((v) => ids.has(v.id)).map((v) => [v.id, v]));
    await insertRows("line_results", changed.map((id) => {
      const v = views.get(id)!;
      const raw: Raw = {
        allocations: s.allocations.filter((a) => a.bank_line_id === id).map((a) => ({ charge_id: a.charge_id, confidence: a.confidence, evidence: a.evidence })),
        hold: s.holds.find((h) => h.bank_line_id === id) ?? null,
        reasoning: s.reasoning.get(id) ?? null,
        review_reason_raw: s.reviewReason.get(id) ?? null,
      };
      return { bank_line_id: id, method: v.method, status: v.status, confidence: v.confidence, unallocated_amount: v.unallocated_amount, review_reason: v.review_reason, reasoning: v.reasoning, evidence: v.evidence, agent_raw: raw };
    }), true);

    // charges.amount_paid = approved allocations, for every charge a changed line touches (now or before)
    const touched = new Set(rows.map((a) => a.charge_id));
    for (const id of changed) for (const [cid] of JSON.parse(before.lines.get(id) ?? '{"a":[]}').a as [string][]) touched.add(cid);
    if (touched.size) {
      const paid = new Map([...touched].map((c) => [c, 0]));
      for (const a of s.allocations) if (a.status === "approved" && paid.has(a.charge_id)) paid.set(a.charge_id, paid.get(a.charge_id)! + a.amount);
      await insertRows("charges", [...paid].map(([id, p]) => ({ id, amount_paid: Number(fmt(p)) })), true);
    }
  }

  const aliases = s.aliases.slice(before.aliases);
  if (aliases.length) await insertRows("payer_aliases", aliases.map((a) => ({ payer_name_normalised: a.payer_name.toUpperCase(), tenant_id: a.tenant_id, source: a.source, approved_at: a.approved_at })), true);

  const audit = s.audit.slice(before.audit);
  if (audit.length) await insertRows("audit_log", audit.map((r) => ({ ts: r.at, actor: r.actor, action: r.action, object_id: r.bank_line_id ?? null, detail: r.detail ?? null })));
}

/**
 * Route wrapper in DB mode: load the store from Supabase, run fn, save what changed (awaited), answer JSON.
 * Writes are serialised within a process. Errors are logged with the route and returned as { error }.
 */
export async function withDb(route: string, fn: (s: Store, ctx: DbCtx) => unknown | Promise<unknown>, opts: { write?: boolean } = {}): Promise<Response> {
  const work = async () => {
    const { s, ctx, before } = await loadStore();
    const out = await fn(s, ctx);
    if (opts.write) await saveStore(s, before);
    return out;
  };
  try {
    const p = opts.write ? (g.__sbLock = (g.__sbLock ?? Promise.resolve()).catch(() => undefined).then(work)) : work();
    return Response.json(await p);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof HttpError) return Response.json({ error: msg }, { status: e.status });
    console.error(`[db] ${route}: ${msg}`);
    return Response.json({ error: msg }, { status: 500 });
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
