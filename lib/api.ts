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

/** Build default: NEXT_PUBLIC_USE_MOCK=0 starts in Live (engine), anything else in Demo (in-browser fixtures). */
export const DEFAULT_MODE: DataMode = process.env.NEXT_PUBLIC_USE_MOCK === "0" ? "live" : "demo";
const MODE_KEY = "pt.dataMode";

let mode: DataMode | null = null;

/** ?mode=live|demo wins, then the viewer's last choice, then the build default. */
export function getMode(): DataMode {
  if (mode) return mode;
  mode = DEFAULT_MODE;
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(window.location.search).get("mode");
      const saved = window.localStorage.getItem(MODE_KEY);
      const pick = q ?? saved;
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

// Real API (NEXT_PUBLIC_USE_MOCK=0). A failed call is logged and thrown: never a silent fallback to the mock.
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-actor": "human",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    console.error(`[api] ${method} ${url} network error`, e);
    throw new Error(`${method} ${url}: network error`);
  }
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
