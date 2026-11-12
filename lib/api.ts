import { mockApi } from "@/lib/mock";
import type {
  ArrearsRow,
  AuditRow,
  LineView,
  ManualAllocation,
  OpenCharge,
  RunProgress,
  RunSummary,
} from "@/lib/types";

export type DataMode = "demo" | "live";

/**
 * Default is Live: the engine on data/sample with the saved agent runs. NEXT_PUBLIC_DEFAULT_MODE=demo
 * starts in the in-browser fixtures instead. Viewers switch in the top bar or with ?mode=demo|live.
 */
export const DEFAULT_MODE: DataMode = process.env.NEXT_PUBLIC_DEFAULT_MODE === "live" ? "live" : "demo";
const MODE_KEY = "pt.dataMode.v2";

let mode: DataMode | null = null;

/** ?mode=live|demo wins, else the build default (Demo). */
export function getMode(): DataMode {
  if (mode) return mode;
  mode = DEFAULT_MODE;
  if (typeof window !== "undefined") {
    try {
      // Demo only on screen; ?mode=live still reaches the engine for the team.
      const pick = new URLSearchParams(window.location.search).get("mode");
      if (pick === "demo" || pick === "live") mode = pick;
    } catch {
      /* storage unavailable */
    }
  }
  return mode;
}

export function setMode(next: DataMode) {
  mode = next;
  try {
    window.localStorage.setItem(MODE_KEY, next);
  } catch {
    /* storage unavailable */
  }
}

const isMock = () => getMode() === "demo";

const TIMEOUT_MS = 45_000;

// Live mode. A failed call is logged and thrown: never a silent fallback to the mock.
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-actor": "human",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      console.error(`[api] ${method} ${url} timed out after ${TIMEOUT_MS / 1000}s`);
      throw new Error(`The engine did not answer in ${TIMEOUT_MS / 1000} s (${method} ${url}). Try again.`);
    }
    console.error(`[api] ${method} ${url} network error`, e);
    throw new Error(`${method} ${url}: network error`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      msg = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {}
    console.error(`[api] ${method} ${url} → HTTP ${res.status}: ${msg}`);
    throw new Error(`${method} ${url} failed (HTTP ${res.status}): ${msg}`);
  }
  return res.json() as Promise<T>;
}

export async function getLines(month: string): Promise<LineView[]> {
  if (isMock()) return mockApi.getLines(month);
  return json(`/api/lines?month=${month}`);
}

export async function getSummary(month: string): Promise<RunSummary> {
  if (isMock()) return mockApi.getSummary(month);
  return json(`/api/summary?month=${month}`);
}

export async function runStatement(
  month: string,
  onProgress?: (p: RunProgress) => void,
): Promise<RunSummary> {
  if (isMock()) return mockApi.runStatement(month, onProgress);
  return json(`/api/run?month=${month}`, { method: "POST" });
}

export async function approveLine(
  id: string,
): Promise<{ remembered?: string }> {
  if (isMock()) return mockApi.approveLine(id);
  return json(`/api/lines/${id}/approve`, { method: "POST" });
}

export async function rejectLine(id: string): Promise<void> {
  if (isMock()) return mockApi.rejectLine(id);
  await json(`/api/lines/${id}/reject`, { method: "POST" });
}

export async function getArrears(): Promise<ArrearsRow[]> {
  if (isMock()) return mockApi.getArrears();
  const data = await json<{ arrears: ArrearsRow[] }>("/api/arrears");
  return data.arrears ?? (data as unknown as ArrearsRow[]);
}

/** Every charge with something still owed, for matching a receipt by hand. */
export async function getOpenCharges(month: string): Promise<OpenCharge[]> {
  if (isMock()) return mockApi.getOpenCharges(month);
  const data = await json<{ arrears: ArrearsRow[] }>("/api/arrears");
  const rows = data.arrears ?? (data as unknown as ArrearsRow[]);
  return rows.flatMap((row) =>
    row.open_charges.map((c) => ({
      charge_id: c.charge_id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      unit: row.unit,
      charge_type: c.charge_type,
      period: c.period,
      due_date: null,
      outstanding: c.outstanding,
    })),
  );
}

/**
 * Allocate a receipt by hand. Real engine: a human proposal at full confidence,
 * then an approval if the engine still holds it for a person (new payer).
 */
export async function manualAllocate(
  lineId: string,
  allocations: ManualAllocation[],
  unallocated: number,
  reasoning: string,
): Promise<{ remembered?: string }> {
  if (isMock()) return mockApi.manualAllocate(lineId, allocations);
  const res = await json<{ waits_for_person?: boolean }>("/api/proposals", {
    method: "POST",
    body: JSON.stringify({
      bank_line_id: lineId,
      allocations: allocations.map((a) => ({ charge_id: a.charge_id, amount: a.amount.toFixed(2) })),
      unallocated_amount: unallocated.toFixed(2),
      confidence: 1,
      reasoning,
      evidence: [],
    }),
  });
  if (res.waits_for_person) return approveLine(lineId);
  return {};
}

export async function getAudit(): Promise<AuditRow[]> {
  if (isMock()) return mockApi.getAudit();
  return json("/api/audit");
}

export async function reset(): Promise<void> {
  if (isMock()) return mockApi.reset();
  await json("/api/reset", { method: "POST" });
}

export function getProgress(): RunProgress {
  if (isMock()) return mockApi.getProgress();
  return { stage: "idle", percent: 0 };
}
