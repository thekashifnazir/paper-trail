"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { chaseSplit, draftChaser } from "@/lib/chaser";
import { shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ArrearsRow, AuditRow } from "@/lib/types";
import {
  EmptyState,
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
        className="inline-flex items-center rounded-full bg-queue-wash px-2 py-0.5 text-[12px] font-medium text-queue"
      >
        Disputed
      </span>
      {note && tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-30 w-72 rounded-lg border border-hairline bg-sheet px-3 py-2 text-left text-[12px] font-normal tracking-normal text-ink"
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
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-wash px-3 py-2.5 text-[13px] text-danger">
      {message}
    </div>
  );
}

export function ArrearsPage() {
  const { arrears, audit, lines, loading, error } = useStore();
  const [openRow, setOpenRow] = useState<ArrearsRow | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const ran = lines.some((line) => line.method != null);
  const sorted = useMemo(
    () => [...arrears].sort((a, b) => b.outstanding - a.outstanding),
    [arrears],
  );
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
        <header>
          <h1 className="text-[24px] font-medium tracking-[-0.02em] text-ink">
            Arrears
          </h1>
        </header>
        <EmptyState
          title="No arrears yet"
          body="Arrears appear once a statement has been allocated."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-[24px] font-medium tracking-[-0.02em] text-ink">
          Arrears
        </h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Disputed amounts are held back from the chaser.
        </p>
      </header>

      {ran || sorted.length > 0 ? (
        <KpiStrip>
          <KpiCard label="Total arrears" value={<Money value={total} />} />
          <KpiCard label="Tenants in arrears" value={sorted.length} />
          <KpiCard
            label="Disputed and held back"
            value={<Money value={held} />}
            hint="not chased"
            accent="amber"
          />
        </KpiStrip>
      ) : null}

      <section className="overflow-hidden rounded-[12px] border border-hairline bg-sheet">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
          <h2 className="text-[16px] font-medium tracking-[-0.02em] text-ink">
            Open balances
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
              <thead className="sticky top-0 z-10 bg-fill text-[12px] font-medium tracking-[0.04em] text-muted">
                <tr className="border-b border-hairline">
                  <th className="px-3 py-2 font-medium">Tenant and unit</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2 font-medium">Oldest due date</th>
                  <th className="px-3 py-2 font-medium">Days overdue</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Draft chaser</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <Fragment key={row.tenant_id}>
                    <tr
                      className="cursor-pointer border-b border-hairline hover:bg-fill"
                      onClick={() =>
                        setExpanded(
                          expanded === row.tenant_id ? null : row.tenant_id,
                        )
                      }
                    >
                      <td className="h-11 px-3 align-middle">
                        <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
                          <span className="font-medium text-ink">
                            {row.tenant_name}
                          </span>
                          <span className="text-[12px] text-muted">{row.unit}</span>
                        </span>
                      </td>
                      <td className="h-11 px-3 text-right align-middle">
                        <Money value={row.outstanding} />
                      </td>
                      <td className="h-11 px-3 align-middle text-[13px]">
                        {shortDate(row.oldest_due_date)}
                      </td>
                      <td className="h-11 px-3 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-hairline">
                            <div
                              className="h-full bg-queue"
                              style={{
                                width: `${(row.days_overdue / maxDays) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="font-mono text-[13px] tabular-nums">
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
                            className="rounded-lg border border-hairline bg-sheet px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-fill"
                          >
                            Draft chaser
                          </button>
                        ) : (
                          <span className="text-[12px] text-muted">Nothing to chase</span>
                        )}
                      </td>
                    </tr>
                    {expanded === row.tenant_id ? (
                      <tr className="border-b border-hairline bg-paper">
                        <td colSpan={6} className="px-3 py-2.5">
                          <ul className="space-y-1">
                            {row.open_charges.map((charge) => (
                              <li
                                key={charge.charge_id}
                                className="flex items-baseline justify-between gap-4 text-[13px]"
                              >
                                <span className="text-muted">
                                  <span className="font-mono text-ink">
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
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-sheet">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <h2 className="text-[16px] font-medium tracking-[-0.02em] text-ink">
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
            <thead className="sticky top-0 bg-fill text-[12px] font-medium tracking-[0.04em] text-muted">
              <tr className="border-b border-hairline">
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
                  className="border-b border-hairline"
                >
                  <td className="px-3 py-1.5 align-middle font-mono text-[11px] text-muted">
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
                  <td className="px-3 py-1.5 align-middle font-mono text-[11px] text-muted">
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
        className="flex h-[min(720px,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-[12px] border border-hairline bg-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid min-h-0 flex-1 md:grid-cols-2">
          <div className="flex min-h-0 flex-col border-b border-hairline p-4 md:border-b-0 md:border-r">
            <div
              id="chaser-title"
              className="text-[12px] font-medium tracking-[0.04em] text-muted"
            >
              Draft chaser
            </div>
            <input
              value={subject}
              onChange={(event) => onSubject(event.target.value)}
              aria-label="Subject"
              className="mt-1.5 rounded-lg border border-hairline bg-paper px-2.5 py-1.5 font-medium text-ink"
            />
            <textarea
              value={body}
              onChange={(event) => onBody(event.target.value)}
              aria-label="Letter"
              className="mt-2 min-h-0 flex-1 resize-none rounded-lg border border-hairline bg-paper px-2.5 py-2 leading-relaxed text-ink"
            />
          </div>
          <div className="min-h-0 overflow-auto p-4">
            <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
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
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper"
          >
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-hairline bg-sheet px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Close
          </button>
          <p className="text-[11px] text-muted">Nothing is sent. Copy only.</p>
        </div>
      </div>
    </div>
  );
}
