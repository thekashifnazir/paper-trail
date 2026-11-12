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

const useMock =
  process.env.NEXT_PUBLIC_USE_MOCK === "1" ||
  process.env.NEXT_PUBLIC_USE_MOCK === undefined;

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
  if (useMock) return mockApi.getLines(month);
  return json(`/api/lines?month=${month}`);
}

export async function getSummary(month: string): Promise<RunSummary> {
  if (useMock) return mockApi.getSummary(month);
  return json(`/api/summary?month=${month}`);
}

export async function runStatement(
  month: string,
  onProgress?: (p: RunProgress) => void,
): Promise<RunSummary> {
  if (useMock) return mockApi.runStatement(month, onProgress);
  return json(`/api/run?month=${month}`, { method: "POST" });
}

export async function approveLine(
  id: string,
): Promise<{ remembered?: string }> {
  if (useMock) return mockApi.approveLine(id);
  return json(`/api/lines/${id}/approve`, { method: "POST" });
}

export async function rejectLine(id: string): Promise<void> {
  if (useMock) return mockApi.rejectLine(id);
  await json(`/api/lines/${id}/reject`, { method: "POST" });
}

export async function getArrears(): Promise<ArrearsRow[]> {
  if (useMock) return mockApi.getArrears();
  const data = await json<{ arrears: ArrearsRow[] }>("/api/arrears");
  return data.arrears ?? (data as unknown as ArrearsRow[]);
}

/** Every charge with something still owed, for matching a receipt by hand. */
export async function getOpenCharges(month: string): Promise<OpenCharge[]> {
  if (useMock) return mockApi.getOpenCharges(month);
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
  if (useMock) return mockApi.manualAllocate(lineId, allocations);
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
  if (useMock) return mockApi.getAudit();
  return json("/api/audit");
}

export async function reset(): Promise<void> {
  if (useMock) return mockApi.reset();
  await json("/api/reset", { method: "POST" });
}

export function getProgress(): RunProgress {
  if (useMock) return mockApi.getProgress();
  return { stage: "idle", percent: 0 };
}
