// The app's cash application service behind the HTTP routes Grok Bot calls.
// State is in memory for the hackathon; Builder 2 can swap `Store` for Supabase tables with the same shape.
import { candidates } from "./candidates";
import { checkProposal } from "./checkSum";
import { parseCsv } from "./csv";
import { loadData, type CompanyLookup, type TenantNote } from "./data";
import { checkEvidence, type EvidenceSources } from "./evidence";
import { allocate, payerKnown } from "./match";
import { clearMemory, loadAliases, persistEnabled, saveAlias, saveAudit } from "./persist";
import { fmt, toPence } from "./money";
import { score, type TruthRow } from "./score";
import type { AgentProposal, Allocation, BankLine, Charge, PayerAlias, Pence, Tenant } from "./types";

export const QUEUE_BELOW = 0.7;
export const PAYER_NOT_TENANT = "payer is not the tenant and not yet in payer memory"; // pass 3 proposals under this confidence wait for a person

export type Actor = "grok_bot" | "human" | "system";

export interface AuditRow {
  at: string;
  actor: Actor;
  action: string;
  bank_line_id?: string;
  detail: unknown;
}

// A line the agent decided to leave open (duplicate, unidentifiable, ...), with its reason.
export interface Hold {
  bank_line_id: string;
  reasoning: string;
  confidence: number;
  evidence: AgentProposal["evidence"];
  actor: Actor;
  at: string;
  decided?: { approve: boolean; actor: Actor; at: string }; // a person confirmed (or overruled) leaving it open
}

export interface Store {
  charges: Charge[];
  tenants: Tenant[];
  truth: TruthRow[];
  bankLines: BankLine[];
  allocations: Allocation[];
  aliases: PayerAlias[];
  holds: Hold[];
  reasoning: Map<string, string>; // bank_line_id -> agent reasoning
  notes: TenantNote[]; // dispute history etc., shown to the agent with the candidates
  lookup: CompanyLookup[]; // parent companies paying for group members
  reviewReason: Map<string, string>; // bank_line_id -> why it waits for a person
  audit: AuditRow[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const now = () => new Date().toISOString();

export function emptyStore(): Store {
  return { charges: [], tenants: [], truth: [], bankLines: [], allocations: [], aliases: [], holds: [], reasoning: new Map(), notes: [], lookup: [], reviewReason: new Map(), audit: [] };
}

// One store per server process. Reference data (tenants, charges, notes, answer key for Sep + Oct) comes from
// data/sample; bank lines arrive through POST /api/statements.
const g = globalThis as unknown as { __cashStore?: Store };
export function store(): Store {
  if (!g.__cashStore) {
    const d = loadData();
    g.__cashStore = Object.assign(emptyStore(), { charges: d.charges, tenants: d.tenants, truth: d.truth, notes: d.notes, lookup: d.companyLookup });
  }
  return g.__cashStore;
}

// Payer memory survives a restart: aliases approved in earlier sessions are read back from Supabase once per
// process, before the first request is handled (lib/cash/http.ts). No-op when Supabase isn't configured.
const h = globalThis as unknown as { __cashHydrated?: Promise<void> };
export function hydrate(): Promise<void> {
  if (!persistEnabled()) return Promise.resolve();
  h.__cashHydrated ??= loadAliases()
    .then((rows) => {
      const s = store();
      for (const a of rows) {
        if (!s.aliases.some((x) => x.payer_name.toUpperCase() === a.payer_name.toUpperCase())) s.aliases.push(a);
      }
    })
    .catch((e) => {
      h.__cashHydrated = undefined; // try again on the next request
      console.error("[persist] could not load payer memory:", e instanceof Error ? e.message : e);
    });
  return h.__cashHydrated;
}

/** Demo reset: fresh store from data/sample, and forget learned payers and the audit log in Supabase. */
export async function resetStore() {
  await clearMemory();
  g.__cashStore = undefined;
  h.__cashHydrated = undefined;
  const s = store();
  audit(s, "system", "reset", { persisted: persistEnabled() });
  return { reset: true, persisted: persistEnabled() };
}

function audit(s: Store, actor: Actor, action: string, detail: unknown, bank_line_id?: string) {
  const row = { at: now(), actor, action, bank_line_id, detail };
  s.audit.push(row);
  saveAudit(row);
}

const live = (a: Allocation) => a.status !== "rejected";

export function openAmounts(s: Store): Map<string, Pence> {
  const open = new Map(s.charges.map((c) => [c.id, toPence(c.amount_due)]));
  for (const a of s.allocations.filter(live)) open.set(a.charge_id, (open.get(a.charge_id) ?? 0) - a.amount);
  return open;
}

export function openLines(s: Store, month?: string): BankLine[] {
  const done = new Set([...s.allocations.filter(live).map((a) => a.bank_line_id), ...s.holds.map((h) => h.bank_line_id)]);
  return s.bankLines.filter((b) => !done.has(b.id) && (!month || (b.statement_month ?? b.date.slice(0, 7)) === month));
}

function line(s: Store, id: string): BankLine {
  const b = s.bankLines.find((x) => x.id === id);
  if (!b) throw new HttpError(404, `unknown bank line ${id}`);
  return b;
}

// POST /api/statements: CSV text or {bank_lines: [...]} / {csv: "..."}
export function loadStatement(s: Store, body: unknown, actor: Actor) {
  const rows: BankLine[] =
    typeof body === "string" ? (parseCsv(body) as unknown as BankLine[])
    : Array.isArray((body as { bank_lines?: unknown })?.bank_lines) ? (body as { bank_lines: BankLine[] }).bank_lines
    : typeof (body as { csv?: unknown })?.csv === "string" ? (parseCsv((body as { csv: string }).csv) as unknown as BankLine[])
    : [];
  if (!rows.length) throw new HttpError(400, "send bank_lines as CSV text, {bank_lines: [...]} or {csv: \"...\"}");
  const known = new Set(s.bankLines.map((b) => b.id));
  const added = rows
    .map((r) => ({ id: String(r.id), statement_month: String(r.statement_month || String(r.date).slice(0, 7)), date: String(r.date), amount: fmt(toPence(r.amount)), payer_name: String(r.payer_name ?? ""), reference: String(r.reference ?? "") }))
    .filter((r) => !known.has(r.id));
  s.bankLines.push(...added);
  audit(s, actor, "statement_loaded", { received: rows.length, added: added.length });
  return { received: rows.length, added: added.length, skipped_known: rows.length - added.length, total_lines: s.bankLines.length };
}

// POST /api/run: pass 1 + pass 2 on open lines (one statement month, or all)
export function run(s: Store, month?: string) {
  const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
  const r = allocate(s.charges, openLines(s, month), aliases, openAmounts(s));
  s.allocations.push(...r.allocations);
  const by: Record<string, number> = { exact: 0, memory: 0 };
  for (const id of new Set(r.allocations.map((a) => a.bank_line_id))) by[r.allocations.find((a) => a.bank_line_id === id)!.method]++;
  audit(s, "system", "run", { lines_exact: by.exact, lines_memory: by.memory, left_open: r.leftover.length });
  return { lines_exact: by.exact, lines_memory: by.memory, left_open: r.leftover.length };
}

// GET /api/exceptions: open lines with their candidates (amounts in pounds for the agent)
export function exceptions(s: Store, month?: string) {
  const open = openAmounts(s);
  const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
  const proposed = s.allocations.filter((a) => a.status === "proposed");
  const items = openLines(s, month).map((b) => {
    const c = candidates(b, s.charges, open, s.tenants, aliases, s.bankLines);
    return { ...c, candidates: c.candidates.map((x) => ({ ...x, amount_open: Number(fmt(x.amount_open)) })) };
  });
  const rel = new Set(items.flatMap((i) => i.candidates.map((c) => c.tenant_id)));
  return {
    open_lines: items,
    waiting_for_approval: [...new Set(proposed.map((a) => a.bank_line_id))].map((id) => explain(s, id)),
    tenants: s.tenants.filter((t) => rel.has(t.tenant_id)).map(({ tenant_id, tenant_name, leaseholder_type, parent_company, unit }) => ({ tenant_id, tenant_name, leaseholder_type, parent_company, unit })),
    tenant_notes: s.notes.filter((n) => rel.has(n.tenant_id)),
    aliases,
  };
}

// POST /api/proposals: Grok Bot's pass 3 answer for one line
export function propose(s: Store, body: AgentProposal & { bank_line_id: string }, actor: Actor) {
  if (!body?.bank_line_id) throw new HttpError(400, "bank_line_id is required");
  const b = line(s, body.bank_line_id);
  if (!openLines(s).some((x) => x.id === b.id)) throw new HttpError(409, `${b.id} is not open`);
  if (!Array.isArray(body.allocations)) throw new HttpError(400, "allocations must be an array");
  const confidence = Number(body.confidence ?? 0);
  const check = checkProposal(toPence(b.amount), { allocations: body.allocations, unallocated_amount: body.unallocated_amount ?? 0 }, openAmounts(s));
  if (!check.ok) {
    audit(s, actor, "proposal_rejected", { reason: check.reason, proposal: body }, b.id);
    throw new HttpError(422, check.reason!);
  }
  const evidence = body.evidence ?? [];
  if (!body.allocations.length) {
    s.holds.push({ bank_line_id: b.id, reasoning: body.reasoning ?? "", confidence, evidence, actor, at: now() });
    audit(s, actor, "line_held", { reasoning: body.reasoning }, b.id);
    return { bank_line_id: b.id, status: "held", reasoning: body.reasoning };
  }
  // no source, no figure: a quote that is not in the source it names sends the line to a person
  const ev = checkEvidence(evidence, evidenceSources(s));
  // a payer that is not the tenant and not yet in payer memory waits for a person; the approval teaches the app
  const tids = [...new Set(body.allocations.map((a) => s.charges.find((c) => c.id === a.charge_id)?.tenant_id ?? ""))];
  const payerOk = tids.length === 1 && payerKnown(b.payer_name, tids[0], s.charges, s.aliases);
  const status = ev.rejected.length || !payerOk || confidence < QUEUE_BELOW ? "proposed" : "approved";
  if (ev.rejected.length) s.reviewReason.set(b.id, `evidence not found: ${ev.rejected.map((r) => r.ref).join(", ")}`);
  else if (!payerOk) s.reviewReason.set(b.id, PAYER_NOT_TENANT);
  else if (status === "proposed") s.reviewReason.set(b.id, `confidence ${confidence} below ${QUEUE_BELOW}`);
  for (const a of body.allocations) {
    s.allocations.push({ id: `${b.id}:${a.charge_id}`, bank_line_id: b.id, charge_id: a.charge_id, amount: toPence(a.amount), method: "agent", confidence, evidence, status });
  }
  s.reasoning.set(b.id, body.reasoning ?? "");
  audit(s, actor, status === "approved" ? "agent_allocated" : "agent_proposed", { allocations: body.allocations, unallocated_amount: body.unallocated_amount, confidence, evidence_rejected: ev.rejected }, b.id);
  return {
    bank_line_id: b.id, status, unallocated_amount: Number(body.unallocated_amount ?? 0), waits_for_person: status === "proposed",
    review_reason: s.reviewReason.get(b.id) ?? null, evidence_checked: ev.checked, evidence_rejected: ev.rejected,
  };
}

export function evidenceSources(s: Store): EvidenceSources {
  const lease = new Map(s.charges.map((c) => [c.tenant_id, c.lease_citation]));
  return { bankLines: s.bankLines, charges: s.charges, tenants: s.tenants.map((t) => ({ ...t, lease_citation: lease.get(t.tenant_id) ?? "" })), notes: s.notes, lookup: s.lookup, openAmount: openAmounts(s) };
}

// The allocations an id refers to: one allocation id, or every allocation of a bank line id.
function target(s: Store, id: string): Allocation[] {
  const hit = s.allocations.filter((a) => a.id === id || a.bank_line_id === id);
  if (!hit.length) throw new HttpError(404, `no allocation for ${id}`);
  return hit;
}

// POST /api/allocations/{id}/approve | /reject
export function decide(s: Store, id: string, approve: boolean, actor: Actor) {
  const hit = target(s, id).filter((a) => a.status === "proposed");
  if (!hit.length) throw new HttpError(409, `nothing waiting for approval on ${id}`);
  for (const a of hit) a.status = approve ? "approved" : "rejected";
  let learned: PayerAlias | undefined;
  if (approve) {
    const b = line(s, hit[0].bank_line_id);
    const tids = new Set(hit.map((a) => s.charges.find((c) => c.id === a.charge_id)?.tenant_id));
    const tid = [...tids][0];
    const nameIsTenant = s.tenants.some((t) => t.tenant_id === tid && t.tenant_name.toUpperCase() === b.payer_name.toUpperCase());
    if (tids.size === 1 && tid && !nameIsTenant && !s.aliases.some((x) => x.payer_name.toUpperCase() === b.payer_name.toUpperCase())) {
      learned = { payer_name: b.payer_name, tenant_id: tid, source: "human", approved_at: now() };
      s.aliases.push(learned);
      saveAlias(learned);
    }
  }
  audit(s, actor, approve ? "approved" : "rejected", { allocations: hit.map((a) => a.id), learned_alias: learned }, hit[0].bank_line_id);
  return { bank_line_id: hit[0].bank_line_id, status: approve ? "approved" : "rejected", allocations: hit.length, learned_alias: learned ?? null };
}

// GET /api/allocations/{id}/explain
export function explain(s: Store, id: string) {
  const b = s.bankLines.find((x) => x.id === id) ?? line(s, s.allocations.find((a) => a.id === id)?.bank_line_id ?? id);
  const allocs = s.allocations.filter((a) => a.bank_line_id === b.id);
  const hold = s.holds.find((h) => h.bank_line_id === b.id);
  const trail = s.audit.filter((r) => r.bank_line_id === b.id);
  const decided = [...trail].reverse().find((r) => r.action === "approved" || r.action === "rejected");
  return {
    bank_line: b,
    state: hold ? "held" : allocs.some((a) => a.status === "proposed") ? "waiting_for_approval" : allocs.some(live) ? "allocated" : "open",
    allocations: allocs.map((a) => {
      const c = s.charges.find((x) => x.id === a.charge_id);
      return { charge_id: a.charge_id, tenant_name: c?.tenant_name, type: c?.type, period: c?.period, invoice_ref: c?.invoice_ref, lease_citation: c?.lease_citation, amount: fmt(a.amount), method: a.method, confidence: a.confidence, status: a.status };
    }),
    unallocated_amount: fmt(toPence(b.amount) - allocs.filter(live).reduce((x, a) => x + a.amount, 0)),
    reasoning: hold?.reasoning ?? s.reasoning.get(b.id) ?? null,
    review_reason: s.reviewReason.get(b.id) ?? null,
    evidence: hold?.evidence ?? allocs[0]?.evidence ?? [],
    decided_by: decided ? { actor: decided.actor, action: decided.action, at: decided.at } : null,
    audit: trail,
  };
}

// GET /api/arrears: open amount per tenant, oldest first (sort=amount for most money first)
export function arrears(s: Store, sort: "oldest" | "amount" = "oldest") {
  const open = openAmounts(s);
  const per = new Map<string, { tenant_id: string; tenant_name: string; unit: string; open: Pence; oldest_due: string; charges: unknown[] }>();
  for (const c of s.charges) {
    const o = open.get(c.id) ?? 0;
    if (o <= 0) continue;
    const t = per.get(c.tenant_id) ?? { tenant_id: c.tenant_id, tenant_name: c.tenant_name, unit: c.unit, open: 0, oldest_due: c.due_date, charges: [] };
    t.open += o;
    if (c.due_date < t.oldest_due) t.oldest_due = c.due_date;
    t.charges.push({ charge_id: c.id, type: c.type, period: c.period, due_date: c.due_date, invoice_ref: c.invoice_ref, lease_citation: c.lease_citation, amount_open: fmt(o), part_paid: o < toPence(c.amount_due), outstanding_pence: o });
    per.set(c.tenant_id, t);
  }
  const rows = [...per.values()].sort((a, b) => (sort === "amount" ? b.open - a.open : a.oldest_due.localeCompare(b.oldest_due) || b.open - a.open));
  // the UI's fields (lib/types.ts ArrearsRow) sit next to the original ones, which the Grok Bot connector reads
  const asOf = Date.parse(process.env.CASH_AS_OF ?? new Date().toISOString().slice(0, 10));
  return {
    tenants: rows.length,
    total_open: fmt(rows.reduce((x, r) => x + r.open, 0)),
    arrears: rows.map((r) => {
      const notes = s.notes.filter((n) => n.tenant_id === r.tenant_id);
      const charges = r.charges as { charge_id: string; type: string; period: string; lease_citation: string; amount_open: string; outstanding_pence: Pence }[];
      return {
        ...r, open: fmt(r.open),
        outstanding: Number(fmt(r.open)), oldest_due_date: r.oldest_due, days_overdue: Math.max(0, Math.floor((asOf - Date.parse(r.oldest_due)) / 86_400_000)),
        disputed: notes.length > 0, dispute_note: notes.map((n) => n.note).join(" ") || null, lease_citation: charges[0]?.lease_citation ?? "",
        open_charges: charges.map((c) => ({ charge_id: c.charge_id, charge_type: c.type, period: c.period, outstanding: Number(fmt(c.outstanding_pence)) })),
        charges: charges.map(({ outstanding_pence: _, ...c }) => c),
      };
    }),
  };
}

// GET /api/metrics
export function metrics(s: Store) {
  const byLine = new Map<string, string>();
  for (const a of s.allocations.filter(live)) byLine.set(a.bank_line_id, a.method);
  const counts: Record<string, number> = { exact: 0, memory: 0, agent: 0, human: 0 };
  for (const m of byLine.values()) counts[m] = (counts[m] ?? 0) + 1;
  const waiting = new Set(s.allocations.filter((a) => a.status === "proposed").map((a) => a.bank_line_id)).size;
  const n = s.bankLines.length;
  const auto = counts.exact + counts.memory;
  const out: Record<string, unknown> = {
    lines: n,
    lines_by_method: counts,
    held: s.holds.length,
    waiting_for_approval: waiting,
    open: openLines(s).length,
    auto_match_rate: n ? auto / n : 0,
  };
  const loaded = new Set(s.bankLines.map((b) => b.id));
  const truth = s.truth.filter((t) => loaded.has(t.bank_line_id));
  if (truth.length) {
    const sc = score(
      truth,
      s.allocations.filter((a) => a.status === "approved").map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
      new Map(s.bankLines.map((b) => [b.id, toPence(b.amount)])),
    );
    out.against_truth = { allocated: sc.allocated, right: sc.right, wrong: sc.wrong, precision: sc.precision, per_case: sc.perCase };
  }
  return out;
}

// A line sent to a person with nothing allocated (Jev or Grok found no payer, or a possible duplicate).
export function queueForPerson(s: Store, bankLineId: string, reasoning: string, actor: Actor) {
  if (s.holds.some((h) => h.bank_line_id === bankLineId)) return;
  s.holds.push({ bank_line_id: bankLineId, reasoning, confidence: 0, evidence: [], actor, at: now() });
  audit(s, actor, "queued_for_person", { reasoning }, bankLineId);
}

// A person confirms leaving a held line open (approve), or sends it back to open (reject).
export function decideHold(s: Store, bankLineId: string, approve: boolean, actor: Actor) {
  const h = s.holds.find((x) => x.bank_line_id === bankLineId && !x.decided);
  if (!h) throw new HttpError(409, `nothing waiting for approval on ${bankLineId}`);
  if (approve) h.decided = { approve, actor, at: now() };
  else s.holds = s.holds.filter((x) => x !== h);
  audit(s, actor, approve ? "hold_confirmed" : "hold_rejected", { reasoning: h.reasoning }, bankLineId);
  return { bank_line_id: bankLineId, status: approve ? "approved" : "open" };
}
