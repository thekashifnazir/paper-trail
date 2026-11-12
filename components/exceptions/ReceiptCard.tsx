"use client";

import { useState, type JSX, type MouseEvent } from "react";
import { gbp } from "@/lib/format";
import type { Evidence, LineView } from "@/lib/types";
import {
  chargeLabel,
  confidenceBand,
  evidenceLabel,
  highlightReference,
  longDate,
  periodLabel,
  sumPounds,
  toPence,
  type Band,
} from "./receipt-utils";

export { confidenceBand };
export type { Band };

type Tab = "match" | "find" | "create" | "suspense";

const LABEL = "text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--muted,#6b7280)]";
const MUTED = "text-[var(--muted,#6b7280)]";

function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`money tabular tabular-nums ${className}`}>{gbp(value)}</span>;
}

const BAND_PILL: Record<Band, { cls: string; text: string }> = {
  high: { cls: "pill pill-high", text: "High confidence" },
  medium: { cls: "pill pill-med", text: "Medium · review" },
  none: { cls: "pill pill-none", text: "No match" },
};

function Pills({ line }: { line: LineView }) {
  const band = BAND_PILL[confidenceBand(line)];
  const extras: string[] = [];
  if (line.method === "exact") extras.push("Rule applied");
  if (line.method === "memory") extras.push("From memory");
  if (line.allocations.length > 0 && line.unallocated_amount > 0) extras.push("Part payment");
  if (line.review_reason === "New payer relationship") extras.push("New payer");
  if (line.review_reason === "Possible duplicate payment") extras.push("Possible duplicate");
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={band.cls}>{band.text}</span>
      {extras.map((t) => (
        <span key={t} className="pill pill-neutral">
          {t}
        </span>
      ))}
    </div>
  );
}

function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={`${LABEL} mb-1.5`}>Evidence</div>
      <ul className="space-y-2">
        {items.map((e, i) => (
          <li key={`${e.type}-${e.ref}-${i}`} className="text-[14px]">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className={`font-semibold ${MUTED}`}>{evidenceLabel(e.type as string)}</span>
              <span className={`font-mono ${MUTED}`}>{e.ref}</span>
            </div>
            <blockquote className="mt-0.5 border-l-2 border-[var(--hairline,#e5e7eb)] pl-2 font-mono text-[13px] leading-snug text-[var(--ink,#111827)] break-words">
              &ldquo;{e.quote}&rdquo;
            </blockquote>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhyAndEvidence({ line }: { line: LineView }) {
  return (
    <div className="space-y-3">
      {line.reasoning ? (
        <p className="text-[14px] leading-relaxed">
          <span className="font-semibold">Why this match: </span>
          {line.reasoning}
        </p>
      ) : null}
      <EvidenceList items={line.evidence} />
    </div>
  );
}

function BalanceStrip({ line }: { line: LineView }) {
  const selected = sumPounds(line.allocations.map((a) => a.allocated));
  const diffPence = toPence(line.amount) - toPence(selected);
  const balanced = diffPence === 0 && toPence(line.unallocated_amount) === 0;
  const n = line.allocations.length;
  const openAfter = sumPounds(line.allocations.map((a) => a.outstanding_after));
  return (
    <div className="rounded-md bg-[var(--canvas,#f3f4f6)] px-3 py-2 text-[14px]">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          Statement <Money value={line.amount} className="font-semibold" />
        </span>
        <span>
          Selected <Money value={selected} className="font-semibold" />
        </span>
        <span>
          Difference <Money value={diffPence / 100} className="font-semibold" />
        </span>
        {balanced ? (
          <span className="font-semibold text-[var(--ok,#15803d)]">
            Balanced{n > 1 ? ` · ${n} charges` : ""}
          </span>
        ) : null}
      </div>
      {n > 0 && line.unallocated_amount > 0 ? (
        <div className="mt-1 font-semibold text-[var(--warn,#b45309)]">
          {line.review_reason === "Overpayment" ? (
            <>
              Unallocated: <Money value={line.unallocated_amount} /> stays on account
            </>
          ) : (
            <>
              Part payment: <Money value={line.unallocated_amount} /> stays open
            </>
          )}
        </div>
      ) : null}
      {n > 0 && line.unallocated_amount <= 0 && line.review_reason === "Short payment" && openAfter > 0 ? (
        <div className="mt-1 font-semibold text-[var(--warn,#b45309)]">
          Part payment: <Money value={openAfter} /> stays open
        </div>
      ) : null}
    </div>
  );
}

function MatchTab({ line, onGoSuspense }: { line: LineView; onGoSuspense(): void }) {
  if (line.allocations.length === 0) {
    return (
      <div className="space-y-3 text-[14px]">
        <p>
          No ledger match. Move this receipt to suspense.{" "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onGoSuspense();
            }}
            className="font-semibold text-[var(--primary,#1d4ed8)] underline underline-offset-2"
          >
            Go to Suspense
          </button>
        </p>
        <WhyAndEvidence line={line} />
      </div>
    );
  }

  const tenants: { name: string; unit: string }[] = [];
  for (const a of line.allocations) {
    if (!tenants.some((t) => t.name === a.tenant_name && t.unit === a.unit)) {
      tenants.push({ name: a.tenant_name, unit: a.unit });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {tenants.map((t) => (
          <div key={`${t.name}-${t.unit}`}>
            <div className="text-[15px] font-semibold">{t.name}</div>
            <div className={`text-[13px] ${MUTED}`}>{t.unit}</div>
          </div>
        ))}
      </div>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className={`text-[12px] font-semibold ${MUTED}`}>
            <th className="py-1.5 pr-2 font-semibold">Charge</th>
            <th className="py-1.5 pr-2 font-semibold">Due</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Outstanding</th>
            <th className="py-1.5 text-right font-semibold">Amount to apply</th>
          </tr>
        </thead>
        <tbody>
          {line.allocations.map((a) => (
            <tr key={a.charge_id} className="border-t border-[var(--hairline,#e5e7eb)] align-middle">
              <td className="py-2 pr-2">
                <div>{chargeLabel(a)}</div>
                <div className={`font-mono text-[12px] ${MUTED}`}>{a.charge_id}</div>
              </td>
              <td className="py-2 pr-2 whitespace-nowrap">{periodLabel(a.period)}</td>
              <td className="py-2 pr-2 text-right whitespace-nowrap">
                <Money value={a.outstanding_before} />
              </td>
              <td className="py-2 text-right">
                <span
                  aria-readonly="true"
                  className="inline-block min-w-[110px] rounded-md border border-[var(--hairline,#d1d5db)] bg-[var(--card,#fff)] px-2 py-1 text-right"
                >
                  <Money value={a.allocated} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <WhyAndEvidence line={line} />
      <BalanceStrip line={line} />
    </div>
  );
}

function SuspenseTab({
  line,
  busy,
  onSuspense,
}: {
  line: LineView;
  busy: boolean;
  onSuspense(): void;
}) {
  const keep =
    line.allocations.length > 0 && line.unallocated_amount > 0 ? line.unallocated_amount : line.amount;
  const disabled = busy || line.status !== "proposed";
  return (
    <div className="space-y-3 text-[14px]">
      <p>
        Keep <Money value={keep} className="font-semibold" /> unallocated in suspense. It stays visible
        on the Suspense list and nothing is posted to a tenant ledger.
      </p>
      <WhyAndEvidence line={line} />
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onSuspense();
        }}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Move to suspense
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string; enabled: boolean }[] = [
  { id: "match", label: "Match", enabled: true },
  { id: "find", label: "Find & match", enabled: false },
  { id: "create", label: "Create allocation", enabled: false },
  { id: "suspense", label: "Suspense", enabled: true },
];

export function ReceiptCard({
  line,
  selected,
  busy,
  onSelect,
  onOk,
  onSuspense,
}: {
  line: LineView;
  selected: boolean;
  busy: boolean;
  onSelect(): void;
  onOk(): void;
  onSuspense(): void;
}): JSX.Element {
  const hasAlloc = line.allocations.length > 0;
  const [tab, setTab] = useState<Tab>(hasAlloc ? "match" : "suspense");
  const okDisabled = !hasAlloc || busy || line.status !== "proposed";
  const refParts = highlightReference(line);

  const handleOk = (e: MouseEvent) => {
    e.stopPropagation();
    onOk();
  };

  return (
    <article
      data-line-id={line.id}
      onClick={onSelect}
      className="card grid cursor-pointer grid-cols-[38%_110px_1fr] rounded-lg border border-[var(--hairline,#e5e7eb)] bg-[var(--card,#fff)] text-[14px] text-[var(--ink,#111827)]"
      style={
        selected
          ? { outline: "2px solid var(--primary, #1d4ed8)", outlineOffset: "-1px" }
          : undefined
      }
    >
      {/* LEFT: statement line */}
      <section
        aria-label="Statement line (bank)"
        className="flex min-w-0 flex-col gap-2 border-r border-[var(--hairline,#e5e7eb)] p-4"
      >
        <div className="flex items-center justify-between">
          <span className={`text-[13px] ${MUTED}`}>{longDate(line.date)}</span>
          <span className={LABEL}>Received</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words text-[15px] font-bold uppercase">{line.payer_name}</span>
          <Money value={line.amount} className="shrink-0 text-right text-[22px] font-bold leading-tight" />
        </div>
        <div className="text-[13px]">
          <span className={MUTED}>Reference </span>
          <span className="font-mono break-all">
            {refParts.map((p, i) =>
              p.hit ? (
                <mark
                  key={i}
                  className="rounded-sm bg-[var(--warn-wash,#fde9c4)] px-0.5 text-[var(--ink,#111827)]"
                >
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </span>
        </div>
        <div className="mt-auto pt-3">
          <Pills line={line} />
        </div>
      </section>

      {/* MIDDLE: OK */}
      <section className="flex flex-col items-center justify-center gap-1.5 border-r border-[var(--hairline,#e5e7eb)] px-2 py-4 text-center">
        {line.status === "approved" ? (
          <span className="text-[14px] font-semibold text-[var(--ok,#15803d)]">Confirmed</span>
        ) : (
          <>
            <button
              type="button"
              onClick={handleOk}
              disabled={okDisabled}
              className="btn-primary min-w-[64px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              OK
            </button>
            <span className={`text-[12px] leading-tight ${MUTED}`}>
              {hasAlloc ? "Enter to confirm" : "Use Suspense"}
            </span>
          </>
        )}
      </section>

      {/* RIGHT: ledger match */}
      <section aria-label="Match (ledger)" className="min-w-0 p-3">
        <div className="overflow-hidden rounded-md border border-[var(--hairline,#e5e7eb)]">
          <div className="tabs flex" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className={`tab flex-1 ${t.enabled ? "" : "cursor-not-allowed opacity-50"}`}
                aria-selected={tab === t.id ? "true" : "false"}
                aria-disabled={t.enabled ? undefined : "true"}
                title={t.enabled ? undefined : "Coming soon"}
                onClick={() => {
                  if (t.enabled) setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-3" role="tabpanel">
            {tab === "suspense" ? (
              <SuspenseTab line={line} busy={busy} onSuspense={onSuspense} />
            ) : (
              <MatchTab line={line} onGoSuspense={() => setTab("suspense")} />
            )}
          </div>
        </div>
      </section>
    </article>
  );
}
