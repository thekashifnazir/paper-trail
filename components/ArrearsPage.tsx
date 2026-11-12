"use client";

import { Fragment, useMemo, useState } from "react";
import { draftChaser } from "@/lib/chaser";
import { shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ArrearsRow } from "@/lib/types";
import {
  EmptyState,
  EvidenceCard,
  KpiCard,
  Money,
} from "@/components/shared";

export function ArrearsPage() {
  const { arrears, audit, lines, loading } = useStore();
  const [open, setOpen] = useState<ArrearsRow | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const ran = lines.some((l) => l.method != null);
  const disputedValue = useMemo(
    () =>
      arrears
        .filter((r) => r.disputed)
        .reduce((s, r) => s + r.open_charges
          .filter((c) => c.charge_type === "service_charge")
          .reduce((x, c) => x + c.outstanding, 0), 0),
    [arrears],
  );
  const total = arrears.reduce((s, r) => s + r.outstanding, 0);
  const maxDays = Math.max(...arrears.map((r) => r.days_overdue), 1);

  function openChaser(row: ArrearsRow) {
    setDraft(draftChaser(row));
    setOpen(row);
  }

  async function copy() {
    await navigator.clipboard.writeText(
      `Subject: ${draft.subject}\n\n${draft.body}`,
    );
  }

  if (loading) {
    return <EmptyState title="Loading arrears…" body="Computing open balances." />;
  }

  if (!ran) {
    return (
      <EmptyState
        title="No arrears yet"
        body="Run a statement on Cash application. Once receipts are allocated, this list shows what is still owed."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] tracking-tight">
          Arrears
        </h1>
        <p className="mt-1 text-muted">
          Trusted because cash is allocated. Disputed amounts are held back from
          chase.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Total arrears" value={<Money value={total} />} />
        <KpiCard label="Tenants in arrears" value={arrears.length} />
        <KpiCard
          label="Disputed and held back"
          value={<Money value={disputedValue} />}
          hint="not chased"
          accent="amber"
        />
      </div>

      <section className="overflow-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[900px] text-left">
          <thead className="border-b border-line text-[12px] uppercase tracking-[0.06em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium text-right">Outstanding</th>
              <th className="px-4 py-3 font-medium">Oldest due</th>
              <th className="px-4 py-3 font-medium">Days overdue</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {arrears.map((r) => (
              <Fragment key={r.tenant_id}>
                <tr className="border-b border-line/80 hover:bg-brand-wash/30">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() =>
                        setExpanded(expanded === r.tenant_id ? null : r.tenant_id)
                      }
                    >
                      <div className="font-medium">{r.tenant_name}</div>
                      <div className="text-[13px] text-muted">{r.unit}</div>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold">
                      <Money value={r.outstanding} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {shortDate(r.oldest_due_date)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full bg-queue"
                          style={{
                            width: `${(r.days_overdue / maxDays) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="tabular text-[13px]">{r.days_overdue}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.disputed ? (
                      <span
                        title={r.dispute_note ?? undefined}
                        className="rounded-full bg-queue-wash px-2 py-0.5 text-[12px] font-semibold text-queue"
                      >
                        Disputed
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">Overdue</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openChaser(r)}
                      className="rounded-md border border-line px-3 py-1.5 text-[13px] font-medium hover:bg-line/50"
                    >
                      Draft chaser
                    </button>
                  </td>
                </tr>
                {expanded === r.tenant_id ? (
                  <tr className="border-b border-line bg-paper">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {r.open_charges.map((c) => (
                          <div
                            key={c.charge_id}
                            className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px]"
                          >
                            <span>
                              {c.charge_id} · {c.charge_type.replace("_", " ")} ·{" "}
                              {c.period}
                            </span>
                            <Money value={c.outstanding} />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="font-[family-name:var(--font-display)] text-[20px]">
          Audit log
        </h2>
        <div className="mt-3 max-h-64 overflow-auto">
          {audit.length === 0 ? (
            <p className="text-muted">No actions yet.</p>
          ) : (
            <ul className="space-y-2">
              {audit.map((a, i) => (
                <li
                  key={`${a.ts}-${i}`}
                  className="flex items-start gap-3 border-b border-line/70 py-2 text-[13px]"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 rounded-full ${
                      a.actor === "human" ? "bg-brand" : "bg-[var(--violet)]"
                    }`}
                  />
                  <span className="font-mono text-muted">
                    {new Date(a.ts).toLocaleTimeString("en-GB")}
                  </span>
                  <span className="font-medium">{a.actor}</span>
                  <span>{a.action}</span>
                  <span className="font-mono text-muted">{a.object_id}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="grid max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-panel shadow-xl md:grid-cols-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col border-b border-line p-5 md:border-b-0 md:border-r">
              <div className="text-[12px] uppercase tracking-[0.06em] text-muted">
                Draft chaser
              </div>
              <input
                value={draft.subject}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, subject: e.target.value }))
                }
                className="mt-2 rounded-md border border-line bg-paper px-3 py-2 font-medium"
              />
              <textarea
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
                className="mt-3 min-h-[320px] flex-1 rounded-md border border-line bg-paper px-3 py-2 leading-relaxed"
              />
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="rounded-md bg-brand px-4 py-2 text-[14px] font-semibold text-white"
                >
                  Copy to clipboard
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="rounded-md border border-line px-4 py-2 text-[14px]"
                >
                  Close
                </button>
              </div>
              <p className="mt-2 text-[12px] text-muted">
                Nothing is sent. Copy only.
              </p>
            </div>
            <div className="overflow-auto p-5">
              <div className="text-[12px] uppercase tracking-[0.06em] text-muted">
                Based on
              </div>
              <div className="mt-3 space-y-3">
                {open.open_charges.map((c) => (
                  <EvidenceCard
                    key={c.charge_id}
                    item={{
                      type: "charge",
                      ref: c.charge_id,
                      quote: `${c.charge_type.replace("_", " ")} · ${c.period} · outstanding`,
                    }}
                  />
                ))}
                <EvidenceCard
                  item={{
                    type: "lease",
                    ref: open.tenant_id,
                    quote: open.lease_citation,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
