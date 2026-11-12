// The app's cash application service behind the HTTP routes Grok Bot calls.
// State is in memory for the hackathon; Builder 2 can swap `Store` for Supabase tables with the same shape.
import { candidates } from "./candidates";
import { checkProposal } from "./checkSum";
import { parseCsv } from "./csv";
import { hasData, loadData } from "./data";
import { allocate } from "./match";
import { fmt, toPence } from "./money";
import { score, type TruthRow } from "./score";
import type { AgentProposal, Allocation, BankLine, Charge, PayerAlias, Pence, Tenant } from "./types";

export const QUEUE_BELOW = 0.7; // pass 3 proposals under this confidence wait for a person

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
  audit: AuditRow[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const now = () => new Date().toISOString();

export function emptyStore(): Store {
  return { charges: [], tenants: [], truth: [], bankLines: [], allocations: [], aliases: [], holds: [], reasoning: new Map(), audit: [] };
}

// One store per server process; reference data comes from CASH_DATA_DIR when present.
const g = globalThis as unknown as { __cashStore?: Store };
export function store(): Store {
  if (!g.__cashStore) {
    const s = emptyStore();
    if (hasData()) {
      const d = loadData();
      Object.assign(s, { charges: d.charges, tenants: d.tenants, truth: d.truth });
    }
    g.__cashStore = s;
  }
  return g.__cashStore;
}

function audit(s: Store, actor: Actor, action: string, detail: unknown, bank_line_id?: string) {
  s.audit.push({ at: now(), actor, action, bank_line_id, detail });
}

const live = (a: Allocation) => a.status !== "rejected";

export function openAmounts(s: Store): Map<string, Pence> {
  const open = new Map(s.charges.map((c) => [c.id, toPence(c.amount_due)]));
  for (const a of s.allocations.filter(live)) open.set(a.charge_id, (open.get(a.charge_id) ?? 0) - a.amount);
  return open;
}

export function openLines(s: Store): BankLine[] {
  const done = new Set([...s.allocations.filter(live).map((a) => a.bank_line_id), ...s.holds.map((h) => h.bank_line_id)]);
  return s.bankLines.filter((b) => !done.has(b.id));
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
    .map((r) => ({ id: String(r.id), date: String(r.date), amount: fmt(toPence(r.amount)), payer_name: String(r.payer_name ?? ""), reference: String(r.reference ?? "") }))
    .filter((r) => !known.has(r.id));
  s.bankLines.push(...added);
  audit(s, actor, "statement_loaded", { received: rows.length, added: added.length });
  return { received: rows.length, added: added.length, skipped_known: rows.length - added.length, total_lines: s.bankLines.length };
}

// POST /api/run: pass 1 + pass 2 on open lines
export function run(s: Store) {
  const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
  const r = allocate(s.charges, openLines(s), aliases, openAmounts(s));
  s.allocations.push(...r.allocations);
  const by: Record<string, number> = { exact: 0, memory: 0 };
  for (const id of new Set(r.allocations.map((a) => a.bank_line_id))) by[r.allocations.find((a) => a.bank_line_id === id)!.method]++;
  audit(s, "system", "run", { lines_exact: by.exact, lines_memory: by.memory, left_open: r.leftover.length });
  return { lines_exact: by.exact, lines_memory: by.memory, left_open: r.leftover.length };
}

// GET /api/exceptions: open lines with their candidates (amounts in pounds for the agent)
export function exceptions(s: Store) {
  const open = openAmounts(s);
  const aliases = s.aliases.map((a) => ({ payer_name: a.payer_name, tenant_id: a.tenant_id }));
  const proposed = s.allocations.filter((a) => a.status === "proposed");
  const items = openLines(s).map((b) => {
    const c = candidates(b, s.charges, open, s.tenants, aliases, s.bankLines);
    return { ...c, candidates: c.candidates.map((x) => ({ ...x, amount_open: Number(fmt(x.amount_open)) })) };
  });
  const rel = new Set(items.flatMap((i) => i.candidates.map((c) => c.tenant_id)));
  return {
    open_lines: items,
    waiting_for_approval: [...new Set(proposed.map((a) => a.bank_line_id))].map((id) => explain(s, id)),
    tenants: s.tenants.filter((t) => rel.has(t.tenant_id)).map(({ tenant_id, tenant_name, leaseholder_type, parent_company, unit }) => ({ tenant_id, tenant_name, leaseholder_type, parent_company, unit })),
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
  const status = confidence < QUEUE_BELOW ? "proposed" : "approved";
  for (const a of body.allocations) {
    s.allocations.push({ id: `${b.id}:${a.charge_id}`, bank_line_id: b.id, charge_id: a.charge_id, amount: toPence(a.amount), method: "agent", confidence, evidence, status });
  }
  s.reasoning.set(b.id, body.reasoning ?? "");
  audit(s, actor, status === "approved" ? "agent_allocated" : "agent_proposed", { allocations: body.allocations, unallocated_amount: body.unallocated_amount, confidence }, b.id);
  return { bank_line_id: b.id, status, unallocated_amount: Number(body.unallocated_amount ?? 0), waits_for_person: status === "proposed" };
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
    t.charges.push({ charge_id: c.id, type: c.type, period: c.period, due_date: c.due_date, invoice_ref: c.invoice_ref, lease_citation: c.lease_citation, amount_open: fmt(o), part_paid: o < toPence(c.amount_due) });
    per.set(c.tenant_id, t);
  }
  const rows = [...per.values()].sort((a, b) => (sort === "amount" ? b.open - a.open : a.oldest_due.localeCompare(b.oldest_due) || b.open - a.open));
  return { tenants: rows.length, total_open: fmt(rows.reduce((x, r) => x + r.open, 0)), arrears: rows.map((r) => ({ ...r, open: fmt(r.open) })) };
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
    const sc = score(truth, [
      ...s.allocations.filter((a) => a.status === "approved").map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
    ]);
    out.against_truth = { allocated: sc.allocated, right: sc.right, wrong: sc.wrong, precision: sc.precision, per_case: sc.perCase };
  }
  return out;
}
