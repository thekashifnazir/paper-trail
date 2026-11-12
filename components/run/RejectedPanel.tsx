"use client";

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Money, moneyText } from "@/components/shared";
import { shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { AuditRow, LineView } from "@/lib/types";

const STORAGE_KEY = "pt.rejectReasons";

const REASONS = [
  "Wrong tenant",
  "Payer relationship not confirmed",
  "Wrong charge or amount",
  "Duplicate payment",
  "Other",
] as const;

type ReasonMap = Record<string, string>;

function readReasons(): ReasonMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: ReasonMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return {};
}

function writeReasons(map: ReasonMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable; keep in memory only */
  }
}

/** Charge ids from an audit detail like { allocations: ["B2609-001:INV-…"] }. */
function chargeIds(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const allocs = (detail as { allocations?: unknown }).allocations;
  if (!Array.isArray(allocs)) return [];
  const ids: string[] = [];
  for (const a of allocs) {
    if (typeof a !== "string") continue;
    const i = a.indexOf(":");
    const id = i >= 0 ? a.slice(i + 1) : a;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

type Row = { line: LineView; audit: AuditRow | null; charges: string[] };

export function RejectedPanel(): JSX.Element | null {
  const { month, lines, audit, run, progress } = useStore();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<ReasonMap>({});

  useEffect(() => {
    setReasons(readReasons());
  }, []);

  const rows = useMemo<Row[]>(() => {
    const rejected = lines.filter(
      (l) => l.status === "rejected" && l.statement_month === month,
    );
    if (rejected.length === 0) return [];
    // Latest "rejected" audit row per line id.
    const latest = new Map<string, AuditRow>();
    for (const a of audit) {
      if (a.action !== "rejected") continue;
      const prev = latest.get(a.object_id);
      if (!prev || a.ts > prev.ts) latest.set(a.object_id, a);
    }
    return rejected
      .map((line) => {
        const a = latest.get(line.id) ?? null;
        const fromAudit = a ? chargeIds(a.detail) : [];
        const charges =
          fromAudit.length > 0 ? fromAudit : line.allocations.map((x) => x.charge_id);
        return { line, audit: a, charges };
      })
      .sort((x, y) => (y.audit?.ts ?? "").localeCompare(x.audit?.ts ?? ""));
  }, [lines, audit, month]);

  const running =
    busy ||
    progress.stage === "exact" ||
    progress.stage === "memory" ||
    progress.stage === "agent";

  const returnAll = useCallback(() => {
    if (running) return;
    const n = rows.length;
    setBusy(true);
    void run()
      .then(() => {
        toast(
          `Returned ${n} rejected receipt${n === 1 ? "" : "s"} to the review queue`,
        );
      })
      .catch(() => {
        toast.error("Could not return receipts to review");
      })
      .finally(() => setBusy(false));
  }, [run, rows.length, running]);

  const setReason = useCallback((id: string, value: string) => {
    setReasons((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      writeReasons(next);
      return next;
    });
  }, []);

  if (rows.length === 0) return null;

  const ghost =
    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
  const TH = "label h-9 border-b border-line bg-surface px-3 text-left align-middle";
  const TD = "border-b border-line px-3 py-3 align-top";

  return (
    <section
      aria-labelledby="rejected-panel-title"
      className="overflow-hidden rounded-[8px] border border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 id="rejected-panel-title" className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            Rejected
            <span className="money rounded-full bg-risk-tint px-1.5 text-[11px] leading-[18px] font-medium text-risk">
              {rows.length}
            </span>
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Proposals you turned down. They post nothing to tenant ledgers.
          </p>
        </div>
        <button
          type="button"
          className={ghost}
          onClick={returnAll}
          disabled={running}
          title="Re-running the month puts every rejected receipt back in the review queue"
        >
          <RotateCcw className="h-3.5 w-3.5 text-muted" aria-hidden />
          {running ? "Returning…" : "Return all to review"}
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px] [&>tbody>tr:last-child>td]:border-b-0">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Payer</th>
              <th className={`${TH} text-right`}>Amount</th>
              <th className={TH}>Proposed</th>
              <th className={TH}>Rejected</th>
              <th className={TH}>Reason</th>
              <th className={TH} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, audit: a, charges }) => {
              const chosen = reasons[line.id] ?? "";
              return (
                <tr key={line.id}>
                  <td className={`${TD} mono whitespace-nowrap text-[12px] text-muted`}>
                    {shortDate(line.date)}
                  </td>
                  <td className={TD}>
                    <div className="mono text-[13px] font-medium text-ink">{line.payer_name}</div>
                    <div className="mono mt-0.5 text-[12px] text-muted">{line.reference}</div>
                  </td>
                  <td className={`${TD} text-right`}>
                    <Money value={line.amount} className="font-medium" />
                  </td>
                  <td className={TD}>
                    {charges.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {charges.map((c) => (
                          <span key={c} className="mono whitespace-nowrap text-[12px] text-ink">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {a ? (
                      <>
                        <span className="mono text-[12px] text-ink">{hhmm(a.ts)}</span>
                        <div className="text-[12px] text-muted">
                          by {a.actor === "human" ? "You" : a.actor}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className={`${TD} min-w-[280px] max-w-[460px]`}>
                    <div className="label">Agent&apos;s reasoning</div>
                    <p className="mt-1 text-[13px] leading-snug text-ink">
                      {line.reasoning ? moneyText(line.reasoning) : "No reasoning recorded."}
                    </p>
                    {line.review_reason ? (
                      <span className="mt-1.5 inline-flex h-5 items-center rounded-full bg-queue-tint px-2 text-[11px] font-medium text-queue">
                        {line.review_reason}
                      </span>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-[12px] text-muted" htmlFor={`reject-reason-${line.id}`}>
                        Your reason
                      </label>
                      <select
                        id={`reject-reason-${line.id}`}
                        value={chosen}
                        onChange={(e) => setReason(line.id, e.target.value)}
                        className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink"
                      >
                        <option value="">Not chosen</option>
                        {REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {chosen ? (
                        <span className="inline-flex h-5 items-center rounded-full bg-risk-tint px-2 text-[11px] font-medium text-risk">
                          {chosen}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <button
                      type="button"
                      className={ghost}
                      onClick={returnAll}
                      disabled={running}
                      title={`Re-runs ${line.statement_month}: all ${rows.length} rejected receipt${rows.length === 1 ? "" : "s"} go back to review`}
                    >
                      Return to review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
