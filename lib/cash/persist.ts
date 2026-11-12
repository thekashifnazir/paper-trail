// Payer memory and the audit log, saved to Supabase so they survive a restart (Builder 2).
// Tables come from supabase/schema.sql: payer_aliases and audit_log.
// Server-only: uses the secret key. With SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing, or CASH_PERSIST=0,
// every call is a no-op, so tests and offline runs never touch the network.
import type { PayerAlias } from "./types";

export interface PersistedAudit {
  at: string;
  actor: string;
  action: string;
  bank_line_id?: string;
  detail: unknown;
}

const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export const persistEnabled = () => Boolean(base() && key()) && process.env.CASH_PERSIST !== "0";

async function rest(method: string, path: string, body?: unknown, prefer?: string): Promise<unknown> {
  const k = key()!;
  const headers: Record<string, string> = { apikey: k, "Content-Type": "application/json" };
  if (k.startsWith("eyJ")) headers.Authorization = `Bearer ${k}`; // legacy JWT keys also go in Authorization
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${base()}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Writes are queued in order and never block a request. A failed write is logged, not thrown:
// the in-memory store stays the source of truth for the running process.
let queue: Promise<unknown> = Promise.resolve();
function enqueue(job: () => Promise<unknown>) {
  if (!persistEnabled()) return;
  queue = queue.then(job).catch((e) => console.error("[persist]", e instanceof Error ? e.message : e));
}

/** Wait for queued writes (tests, reset, shutdown). */
export const flush = () => queue;

export function saveAlias(a: PayerAlias) {
  enqueue(() =>
    rest(
      "POST",
      "payer_aliases",
      [{ payer_name_normalised: a.payer_name.toUpperCase(), tenant_id: a.tenant_id, source: a.source, approved_at: a.approved_at }],
      "resolution=merge-duplicates,return=minimal",
    ),
  );
}

export function saveAudit(row: PersistedAudit) {
  enqueue(() =>
    rest(
      "POST",
      "audit_log",
      [{ ts: row.at, actor: row.actor, action: row.action, object_id: row.bank_line_id ?? null, detail: row.detail ?? null }],
      "return=minimal",
    ),
  );
}

/** Aliases approved in earlier sessions. The engine matches on the upper-cased payer name, so that is what is stored. */
export async function loadAliases(): Promise<PayerAlias[]> {
  if (!persistEnabled()) return [];
  const rows = (await rest("GET", "payer_aliases?select=*")) as {
    payer_name_normalised: string;
    tenant_id: string;
    source: string | null;
    approved_at: string | null;
  }[];
  return rows.map((r) => ({
    payer_name: r.payer_name_normalised,
    tenant_id: r.tenant_id,
    source: r.source === "seed" ? "seed" : "human",
    approved_at: r.approved_at ?? new Date().toISOString(),
  }));
}

/** Forget every learned payer and the audit log (demo reset). */
export async function clearMemory() {
  if (!persistEnabled()) return;
  await flush();
  await rest("DELETE", "payer_aliases?payer_name_normalised=not.is.null", undefined, "return=minimal");
  await rest("DELETE", "audit_log?id=gte.0", undefined, "return=minimal");
}
