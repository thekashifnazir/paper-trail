// Server-only Supabase REST client (PostgREST). Uses the service-role / secret key, which must never be
// NEXT_PUBLIC. Every failure throws with the table and HTTP status: no silent fallbacks.
if (typeof window !== "undefined") throw new Error("lib/supabase-server.ts is server-only");

const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The API routes read and write Supabase when both are set (CASH_DB=0 forces the in-memory engine). */
export const dbEnabled = () => Boolean(base() && key()) && process.env.CASH_DB !== "0";

/** Round trips and bytes sent since the process started (for the per-request timing line in withDb). */
export const sbStats = { requests: 0, bytesOut: 0, bytesIn: 0 };

export async function sb<T = unknown>(method: string, path: string, body?: unknown, prefer?: string, extra?: Record<string, string>): Promise<T> {
  const k = key();
  if (!base() || !k) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const headers: Record<string, string> = { apikey: k, "Content-Type": "application/json", ...extra };
  if (k.startsWith("eyJ")) headers.Authorization = `Bearer ${k}`; // legacy JWT keys also go in Authorization
  if (prefer) headers.Prefer = prefer;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  sbStats.requests += 1;
  sbStats.bytesOut += payload?.length ?? 0;
  // A hung request must not hold the write lock (lib/supabase-store.ts) for the rest of the function's life.
  const r = await fetch(`${base()}/rest/v1/${path}`, { method, headers, body: payload, cache: "no-store", signal: AbortSignal.timeout(Number(process.env.SUPABASE_TIMEOUT_MS ?? 20_000)) });
  const text = await r.text();
  sbStats.bytesIn += text.length;
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Every row of a select, paged past PostgREST's 1000-row cap. */
export async function selectAll<T>(table: string, query: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await sb<T[]>("GET", `${table}?${query}`, undefined, undefined, { "Range-Unit": "items", Range: `${from}-${from + 999}` });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Insert or upsert in chunks. */
export async function insertRows(table: string, rows: unknown[], upsert = false, onConflict?: string) {
  const q = onConflict ? `?on_conflict=${onConflict}` : "";
  for (let i = 0; i < rows.length; i += 500) {
    await sb("POST", `${table}${q}`, rows.slice(i, i + 500), `${upsert ? "resolution=merge-duplicates," : ""}return=minimal`);
  }
}

/** PostgREST in.(...) list for text ids. */
export const inList = (ids: string[]) => `in.(${ids.map((i) => `"${i.replace(/"/g, '\\"')}"`).join(",")})`;
