"use client";

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { toast } from "sonner";
import { gbp, shortDate } from "@/lib/format";
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
        return { line, audit: a, charges: a ? chargeIds(a.detail) : [] };
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

  const btnOutline =
    "inline-flex items-center justify-center whitespace-nowrap rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const btnStyle = {
    borderColor: "var(--primary, #1d4ed8)",
    color: "var(--primary, #1d4ed8)",
    background: "transparent",
  } as const;

  return (
    <section
      className="card"
      aria-labelledby="rejected-panel-title"
      style={{
        background: "var(--card, #ffffff)",
        border: "1px solid var(--hairline, #e5e7eb)",
        borderRadius: 8,
        fontSize: 14,
        color: "var(--ink, #111827)",
      }}
    >
      <header
        className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
        style={{ borderBottom: "1px solid var(--hairline, #e5e7eb)" }}
      >
        <div>
          <h2
            id="rejected-panel-title"
            className="text-[15px] font-semibold"
            style={{ color: "var(--nav, #0f1b33)" }}
          >
            Rejected ({rows.length})
          </h2>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted, #6b7280)" }}>
            Proposals you turned down. They post nothing to tenant ledgers.
          </p>
        </div>
        <button
          type="button"
          className={btnOutline}
          style={btnStyle}
          onClick={returnAll}
          disabled={running}
          title="Re-running the month puts every rejected receipt back in the review queue"
        >
          {running ? "Returning…" : "Return all to review"}
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr
              className="text-[12px] font-medium uppercase tracking-wide"
              style={{ color: "var(--muted, #6b7280)" }}
            >
              <th className="px-5 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Payer</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Proposed</th>
              <th className="px-3 py-2 font-medium">Rejected</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-5 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, audit: a, charges }) => {
              const chosen = reasons[line.id] ?? "";
              return (
                <tr
                  key={line.id}
                  className="align-top"
                  style={{ borderTop: "1px solid var(--hairline, #e5e7eb)" }}
                >
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                    {shortDate(line.date)}
                  </td>
                  <td className="px-3 py-3 font-medium uppercase" style={{ color: "var(--nav, #0f1b33)" }}>
                    {line.payer_name}
                    <div
                      className="mt-0.5 font-mono text-[12px] font-normal normal-case"
                      style={{ color: "var(--muted, #6b7280)" }}
                    >
                      {line.id}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {gbp(line.amount)}
                  </td>
                  <td className="px-3 py-3">
                    {charges.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {charges.map((c) => (
                          <span key={c} className="font-mono text-[12px]">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted, #6b7280)" }}>—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {a ? (
                      <>
                        <span className="tabular-nums">{hhmm(a.ts)}</span>
                        <div className="text-[12px]" style={{ color: "var(--muted, #6b7280)" }}>
                          by {a.actor === "human" ? "You" : a.actor}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "var(--muted, #6b7280)" }}>—</span>
                    )}
                  </td>
                  <td className="min-w-[260px] max-w-[420px] px-3 py-3">
                    <div className="text-[12px]" style={{ color: "var(--muted, #6b7280)" }}>
                      Agent&apos;s reasoning (Jev/Grok)
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug" style={{ color: "var(--muted-dark, #4b5563)" }}>
                      {line.reasoning ?? "No reasoning recorded."}
                    </p>
                    {line.review_reason ? (
                      <span className="pill pill-med mt-1">{line.review_reason}</span>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label
                        className="text-[12px]"
                        style={{ color: "var(--muted, #6b7280)" }}
                        htmlFor={`reject-reason-${line.id}`}
                      >
                        Your reason
                      </label>
                      <select
                        id={`reject-reason-${line.id}`}
                        value={chosen}
                        onChange={(e) => setReason(line.id, e.target.value)}
                        className="rounded-md border bg-white px-2 py-1 text-[13px]"
                        style={{ borderColor: "var(--hairline, #e5e7eb)" }}
                      >
                        <option value="">Not chosen</option>
                        {REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {chosen ? (
                        <span
                          className="pill"
                          style={{
                            background: "var(--danger-wash, #fdecec)",
                            color: "var(--danger, #b91c1c)",
                          }}
                        >
                          {chosen}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <button
                      type="button"
                      className={btnOutline}
                      style={btnStyle}
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
