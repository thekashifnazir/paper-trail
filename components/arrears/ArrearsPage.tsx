"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { chaseSplit, draftChaser } from "@/lib/chaser";
import { Search, X } from "lucide-react";
import { gbp, shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ArrearsRow, AuditRow } from "@/lib/types";
import {
  EmptyState,
  ErrorNote,
  EvidenceCard,
  KpiCard,
  KpiStrip,
  Money,
} from "@/components/shared";

function sentenceCase(action: string) {
  const spaced = action.replaceAll("_", " ").trim();
  if (!spaced) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isAgentActor(actor: string) {
  const key = actor.toLowerCase();
  return key === "system" || key === "grok_bot" || key === "agent";
}

function heldBackTotal(rows: ArrearsRow[]) {
  return rows.reduce((sum, row) => {
    const held = chaseSplit(row).heldBack.reduce(
      (part, charge) => part + charge.outstanding,
      0,
    );
    return sum + held;
  }, 0);
}

function DisputeStatus({ note }: { note: string | null }) {
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(
    null,
  );

  return (
    <span
      className="inline-flex"
      onMouseEnter={(event) => {
        if (!note) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const below = rect.bottom + 6;
        const above = below + 96 > window.innerHeight;
        setTip({
          x: Math.max(8, Math.min(rect.left, window.innerWidth - 304)),
          y: above ? rect.top - 6 : below,
          above,
        });
      }}
      onMouseLeave={() => setTip(null)}
    >
      <span
        title={note ?? undefined}
        className="inline-flex items-center rounded-full bg-queue-tint px-2 py-0.5 text-[12px] font-medium text-queue"
      >
        Disputed
      </span>
      {note && tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-30 w-72 rounded-[8px] border border-line bg-surface shadow-[var(--shadow-pop)] px-3 py-2 text-left text-[12px] font-normal tracking-normal text-ink"
          style={{
            left: tip.x,
            top: tip.y,
            transform: tip.above ? "translateY(-100%)" : undefined,
          }}
        >
          {note}
        </span>
      ) : null}
    </span>
  );
}

function DangerNote({ message }: { message: string }) {
  return <ErrorNote message={message} />;
}

export function ArrearsPage() {
  const { arrears, audit, lines, loading, error } = useStore();
  const [openRow, setOpenRow] = useState<ArrearsRow | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [minOutstanding, setMinOutstanding] = useState("");
  const [minDays, setMinDays] = useState(0);
  const [sortBy, setSortBy] = useState<"amount" | "oldest">("amount");

  const ran = lines.some((line) => line.method != null);
  const sorted = useMemo(
    () => [...arrears].sort((a, b) => b.outstanding - a.outstanding),
    [arrears],
  );
  const filtering = query.trim() !== "" || disputedOnly || minOutstanding.trim() !== "" || minDays > 0;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const min = Number(minOutstanding);
    return sorted
      .filter((row) => {
        if (disputedOnly && !row.disputed) return false;
        if (minDays > 0 && row.days_overdue < minDays) return false;
        if (minOutstanding.trim() && Number.isFinite(min) && row.outstanding < min) return false;
        if (!needle) return true;
        return [row.tenant_name, row.unit, row.tenant_id, ...row.open_charges.map((c) => c.charge_id)]
          .some((s) => s.toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        sortBy === "oldest"
          ? a.oldest_due_date.localeCompare(b.oldest_due_date) || b.outstanding - a.outstanding
          : b.outstanding - a.outstanding,
      );
  }, [sorted, query, disputedOnly, minOutstanding, minDays, sortBy]);
  const visibleTotal = visible.reduce((sum, row) => sum + row.outstanding, 0);
  function clearFilters() {
    setQuery("");
    setDisputedOnly(false);
    setMinOutstanding("");
    setMinDays(0);
  }
  const sortedAudit = useMemo(
    () => [...audit].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    [audit],
  );
  const total = sorted.reduce((sum, row) => sum + row.outstanding, 0);
  const held = heldBackTotal(sorted);
  const maxDays = Math.max(1, ...sorted.map((row) => row.days_overdue));
  const updating = loading && (sorted.length > 0 || audit.length > 0);

  useEffect(() => {
    if (!openRow) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenRow(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRow]);

  function openChaser(row: ArrearsRow) {
    setDraft(draftChaser(row));
    setCopied(false);
    setOpenRow(row);
  }

  async function copyDraft() {
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!loading && !error && !ran) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="No arrears yet"
          body="Arrears appear once a statement has been allocated."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Disputed amounts are held back from the chaser.</p>

      {ran || sorted.length > 0 ? (
        <KpiStrip cols={3}>
          <KpiCard label="Total arrears" value={<Money value={total} size="kpi" />} />
          <KpiCard
            label="Tenants in arrears"
            value={<span className="money tracking-[-0.03em]">{sorted.length}</span>}
          />
          <KpiCard
            label="Disputed and held back"
            value={<Money value={held} size="kpi" />}
            hint="not chased"
          />
        </KpiStrip>
      ) : null}

      <section className="overflow-hidden rounded-[8px] border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="text-[14px] font-semibold text-ink">
            Open balances
          </h2>
          {updating ? (
            <p className="text-[12px] text-muted">Updating…</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-canvas px-3 py-2 text-[12px]">
          <label className="flex h-8 w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-ink">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tenant, unit or invoice ref"
              aria-label="Search arrears"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
          </label>
          <label className="flex items-center gap-1.5 text-ink">
            <input
              type="checkbox"
              checked={disputedOnly}
              onChange={(event) => setDisputedOnly(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            Disputed only
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Min outstanding £</span>
            <input
              inputMode="decimal"
              value={minOutstanding}
              onChange={(event) => setMinOutstanding(event.target.value)}
              aria-label="Minimum outstanding"
              className="mono h-7 w-20 rounded-[6px] border border-line bg-surface px-1.5 text-right text-[12px] text-ink"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Overdue</span>
            <select
              value={minDays}
              onChange={(event) => setMinDays(Number(event.target.value))}
              className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink"
            >
              <option value={0}>Any</option>
              <option value={30}>30+ days</option>
              <option value={60}>60+ days</option>
              <option value={90}>90+ days</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Sort</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "amount" | "oldest")}
              className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink"
            >
              <option value="amount">Most owed</option>
              <option value="oldest">Oldest due</option>
            </select>
          </label>
          <span className="mono ml-auto text-muted">
            {visible.length} of {sorted.length}
            {filtering ? <> · {gbp(visibleTotal)}</> : null}
          </span>
          {filtering ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-medium text-ink hover:bg-surface"
            >
              <X className="h-3.5 w-3.5 text-muted" aria-hidden />
              Clear
            </button>
          ) : null}
        </div>
        {error ? (
          <div className="px-3 pt-3">
            <DangerNote message={error} />
          </div>
        ) : null}
        {loading && sorted.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title="Loading arrears…"
              body="Computing open balances."
            />
          </div>
        ) : (
          <div className="max-h-[min(560px,56vh)] overflow-auto">
            <table className="w-full text-left">
              <thead className="label sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Tenant and unit</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2 font-medium">Oldest due date</th>
                  <th className="px-3 py-2 font-medium">Days overdue</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Draft chaser</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-[13px] text-muted">
                      No tenants match.{" "}
                      <button type="button" onClick={clearFilters} className="font-medium text-ink underline">
                        Clear filters
                      </button>
                    </td>
                  </tr>
                ) : null}
                {visible.map((row) => (
                  <Fragment key={row.tenant_id}>
                    <tr
                      className="cursor-pointer border-b border-line hover:bg-canvas"
                      onClick={() =>
                        setExpanded(
                          expanded === row.tenant_id ? null : row.tenant_id,
                        )
                      }
                    >
                      <td className="h-11 px-3 align-middle">
                        <button
                          type="button"
                          className="inline-flex items-baseline gap-2 whitespace-nowrap text-left"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpanded(
                              expanded === row.tenant_id ? null : row.tenant_id,
                            );
                          }}
                        >
                          <span className="font-medium text-ink">
                            {row.tenant_name}
                          </span>
                          <span className="text-[12px] text-muted">{row.unit}</span>
                        </button>
                      </td>
                      <td className="h-11 px-3 text-right align-middle">
                        <Money value={row.outstanding} className="font-medium" />
                      </td>
                      <td className="h-11 px-3 align-middle text-[13px]">
                        {shortDate(row.oldest_due_date)}
                      </td>
                      <td className="h-11 px-3 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full bg-queue"
                              style={{
                                width: `${(row.days_overdue / maxDays) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="mono text-[13px]">
                            {row.days_overdue}
                          </span>
                        </div>
                      </td>
                      <td className="h-11 px-3 align-middle">
                        {row.disputed ? (
                          <DisputeStatus note={row.dispute_note} />
                        ) : (
                          <span className="text-[13px] text-muted">Overdue</span>
                        )}
                      </td>
                      <td className="h-11 px-3 text-right align-middle">
                        {chaseSplit(row).demanded.reduce((sum, c) => sum + c.outstanding, 0) > 0 ? (
                        <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openChaser(row);
                            }}
                            className="rounded-[8px] border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-canvas"
                          >
                            Draft chaser
                          </button>
                        ) : (
                          <span className="text-[12px] text-muted">Nothing to chase</span>
                        )}
                      </td>
                    </tr>
                    {expanded === row.tenant_id ? (
                      <tr className="border-b border-line bg-canvas">
                        <td colSpan={6} className="px-3 py-2.5">
                          <ul className="space-y-1">
                            {row.open_charges.map((charge) => (
                              <li
                                key={charge.charge_id}
                                className="flex items-baseline justify-between gap-4 text-[13px]"
                              >
                                <span className="text-muted">
                                  <span className="mono text-ink">
                                    {charge.charge_id}
                                  </span>
                                  {" · "}
                                  {charge.charge_type.replaceAll("_", " ")}
                                  {" · "}
                                  {charge.period}
                                </span>
                                <Money value={charge.outstanding} />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AuditLog
        audit={sortedAudit}
        loading={loading}
        error={error}
        updating={updating}
      />

      {openRow ? (
        <ChaserDialog
          row={openRow}
          subject={draft.subject}
          body={draft.body}
          copied={copied}
          onSubject={(subject) => {
            setCopied(false);
            setDraft((current) => ({ ...current, subject }));
          }}
          onBody={(body) => {
            setCopied(false);
            setDraft((current) => ({ ...current, body }));
          }}
          onCopy={() => void copyDraft()}
          onClose={() => setOpenRow(null)}
        />
      ) : null}
    </div>
  );
}

function AuditLog({
  audit,
  loading,
  error,
  updating,
}: {
  audit: AuditRow[];
  loading: boolean;
  error: string | null;
  updating: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <h2 className="text-[14px] font-semibold text-ink">
          Audit log
        </h2>
        {updating ? (
          <p className="text-[12px] text-muted">Updating…</p>
        ) : null}
      </div>
      {error ? (
        <div className="px-3 pt-3">
          <DangerNote message={error} />
        </div>
      ) : null}
      {loading && audit.length === 0 ? (
        <div className="p-3">
          <EmptyState title="Loading audit…" body="Fetching the action log." />
        </div>
      ) : audit.length === 0 ? (
        <p className="px-3 py-5 text-[13px] text-muted">No actions yet.</p>
      ) : (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="label sticky top-0 bg-surface">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 font-medium">Time</th>
                <th className="px-3 py-1.5 font-medium">Actor</th>
                <th className="px-3 py-1.5 font-medium">Action</th>
                <th className="px-3 py-1.5 font-medium">Object</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry, index) => (
                <tr
                  key={`${entry.ts}-${entry.object_id}-${index}`}
                  className="border-b border-line"
                >
                  <td className="px-3 py-1.5 align-middle mono text-[11px] text-muted">
                    <span
                      className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
                        isAgentActor(entry.actor) ? "bg-agent" : "bg-ink"
                      }`}
                      aria-hidden
                    />
                    {new Date(entry.ts).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-1.5 align-middle">{entry.actor}</td>
                  <td className="px-3 py-1.5 align-middle">
                    {sentenceCase(entry.action)}
                  </td>
                  <td className="px-3 py-1.5 align-middle mono text-[11px] text-muted">
                    {entry.object_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChaserDialog({
  row,
  subject,
  body,
  copied,
  onSubject,
  onBody,
  onCopy,
  onClose,
}: {
  row: ArrearsRow;
  subject: string;
  body: string;
  copied: boolean;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chaser-title"
        className="flex h-[min(720px,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid min-h-0 flex-1 md:grid-cols-2">
          <div className="flex min-h-0 flex-col border-b border-line p-4 md:border-b-0 md:border-r">
            <div
              id="chaser-title"
              className="label"
            >
              Draft chaser
            </div>
            <input
              value={subject}
              onChange={(event) => onSubject(event.target.value)}
              aria-label="Subject"
              className="mt-1.5 rounded-[8px] border border-line bg-canvas px-2.5 py-1.5 font-medium text-ink"
            />
            <textarea
              value={body}
              onChange={(event) => onBody(event.target.value)}
              aria-label="Letter"
              className="mt-2 min-h-0 flex-1 resize-none rounded-[8px] border border-line bg-canvas px-2.5 py-2 leading-relaxed text-ink"
            />
          </div>
          <div className="min-h-0 overflow-auto p-4">
            <div className="label">
              Based on
            </div>
            <div className="mt-2 space-y-2">
              {row.open_charges.map((charge) => (
                <EvidenceCard
                  key={charge.charge_id}
                  item={{
                    type: "charge",
                    ref: charge.charge_id,
                    quote: `${charge.charge_type.replaceAll("_", " ")} · ${charge.period} · outstanding`,
                  }}
                />
              ))}
              <EvidenceCard
                item={{
                  type: "lease",
                  ref: row.tenant_id,
                  quote: row.lease_citation,
                }}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-[8px] bg-ink px-3.5 py-2 text-[13px] font-medium text-canvas"
          >
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-canvas"
          >
            Close
          </button>
          <p className="text-[11px] text-muted">Nothing is sent. Copy only.</p>
        </div>
      </div>
    </div>
  );
}
