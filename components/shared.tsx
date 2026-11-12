"use client";

import {
  Building2,
  FileText,
  Landmark,
  Link2,
  ListChecks,
  Receipt,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import type { Evidence, Method, Status } from "@/lib/types";
import { gbp, pct } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Money: the one formatter. £ + thousands separators + two decimals.  */
/* ------------------------------------------------------------------ */

export const money = gbp;

/** Re-formats any raw "£1234.5" inside free text (quotes, reasoning). */
export function moneyText(text: string): string {
  return text.replace(/£\s?(-?\d[\d,]*(?:\.\d+)?)/g, (_, raw: string) =>
    gbp(Number(raw.replaceAll(",", ""))),
  );
}

export function Money({
  value,
  size = "sm",
  tone,
  className = "",
}: {
  value: number;
  size?: "xs" | "sm" | "md" | "kpi";
  tone?: "risk" | "muted";
  className?: string;
}) {
  const sizes = {
    xs: "text-[12px]",
    sm: "text-[13px]",
    md: "text-[14px]",
    kpi: "text-[32px] leading-none tracking-[-0.03em]",
  } as const;
  const toneClass = tone === "risk" ? "text-risk" : tone === "muted" ? "text-muted" : "";
  return (
    <span className={`money ${sizes[size]} ${toneClass} ${className}`}>{gbp(value)}</span>
  );
}

/* ------------------------------------------------------------------ */
/* Method badge                                                        */
/* ------------------------------------------------------------------ */

export type BadgeKey = Method | "queue" | "pending" | "rejected";

export const METHOD_STYLE: Record<
  BadgeKey,
  { label: string; fg: string; bg: string; dot: string }
> = {
  exact: { label: "Exact", fg: "text-exact", bg: "bg-exact-tint", dot: "bg-exact" },
  memory: { label: "Memory", fg: "text-memory", bg: "bg-memory-tint", dot: "bg-memory" },
  agent: { label: "Agent", fg: "text-agent", bg: "bg-agent-tint", dot: "bg-agent" },
  human: { label: "Human", fg: "text-ink", bg: "bg-canvas", dot: "bg-ink" },
  queue: { label: "In queue", fg: "text-queue", bg: "bg-queue-tint", dot: "bg-queue" },
  rejected: { label: "Rejected", fg: "text-risk", bg: "bg-risk-tint", dot: "bg-risk" },
  pending: { label: "Pending", fg: "text-muted", bg: "bg-canvas", dot: "bg-line" },
};

export function badgeKey(method: Method | null, status?: Status | string | null): BadgeKey {
  if (status === "proposed") return "queue";
  if (status === "rejected") return "rejected";
  return method ?? "pending";
}

export function MethodBadge({
  method,
  status,
}: {
  method: Method | null;
  status?: Status | string | null;
}) {
  const s = METHOD_STYLE[badgeKey(method, status)];
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium ${s.fg} ${s.bg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

/** Slim meter. Renders nothing at 100% (or unknown) — certainty needs no chart. */
export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value == null || value >= 0.995) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence ${pct(value)}`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-ink"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="money text-[11px] text-muted">{pct(value)}</span>
    </span>
  );
}

/** Five-segment meter used where the decision is made (exceptions). */
export function SegmentMeter({
  value,
  tone = "agent",
}: {
  value: number | null;
  tone?: "agent" | "ink";
}) {
  if (value == null) return null;
  const filled = Math.max(0, Math.min(5, Math.round(value * 5)));
  const on = tone === "agent" ? "bg-agent" : "bg-ink";
  const text = tone === "agent" ? "text-agent" : "text-ink";
  return (
    <span className="inline-flex items-center gap-2" title={`Confidence ${pct(value)}`}>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={`h-2 w-4 rounded-[2px] ${i < filled ? on : "bg-line"}`}
          />
        ))}
      </span>
      <span className={`money text-[13px] font-medium ${text}`}>{pct(value)}</span>
      <span className="sr-only">confidence</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* KPI                                                                 */
/* ------------------------------------------------------------------ */

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[8px] border border-line bg-surface px-4 py-3.5">
      <div className="label">{label}</div>
      <div className="mt-2 truncate text-[32px] leading-none">{value}</div>
      <div className="mt-2 truncate text-[12px] text-muted">{hint ?? " "}</div>
    </div>
  );
}

export function KpiStrip({
  children,
  cols = 5,
}: {
  children: React.ReactNode;
  cols?: 3 | 5;
}) {
  return (
    <div className={`grid gap-3 ${cols === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Allocation bar                                                      */
/* ------------------------------------------------------------------ */

export type BarSegment = {
  key: "exact" | "memory" | "agent" | "queue";
  count: number;
  value: number;
};

export function AllocationBar({ segments }: { segments: BarSegment[] }) {
  const total = Math.max(
    segments.reduce((sum, s) => sum + s.count, 0),
    1,
  );
  const visible = segments.filter((s) => s.count > 0);
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-canvas">
        {visible.map((s) => (
          <div
            key={s.key}
            className={`h-full first:rounded-l-full last:rounded-r-full ${METHOD_STYLE[s.key].dot}`}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${METHOD_STYLE[s.key].label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-[2px] ${METHOD_STYLE[s.key].dot}`} aria-hidden />
            <span className="text-ink">{METHOD_STYLE[s.key].label}</span>
            <span className="money text-muted">{s.count}</span>
            <span className="money text-muted">· {gbp(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

type EvidenceType = Evidence["type"];

const EVIDENCE_STYLE: Record<
  EvidenceType,
  { label: string; icon: LucideIcon; rule: string; fg: string }
> = {
  company_lookup: { label: "Company lookup", icon: Building2, rule: "border-l-agent", fg: "text-agent" },
  alias: { label: "Known alias", icon: Link2, rule: "border-l-agent", fg: "text-agent" },
  tenant_note: { label: "Tenant note", icon: StickyNote, rule: "border-l-queue", fg: "text-queue" },
  charge: { label: "Charge", icon: Receipt, rule: "border-l-exact", fg: "text-exact" },
  lease: { label: "Lease", icon: FileText, rule: "border-l-exact", fg: "text-exact" },
  rule: { label: "Rule", icon: ListChecks, rule: "border-l-exact", fg: "text-exact" },
  bank_line: { label: "Bank line", icon: Landmark, rule: "border-l-ink", fg: "text-ink" },
};

const FALLBACK_EVIDENCE = {
  label: "Source",
  icon: FileText,
  rule: "border-l-exact",
  fg: "text-exact",
};

/** Company lookups, aliases and tenant notes are the decisive evidence. */
export function isDecisiveEvidence(type: string) {
  return type === "company_lookup" || type === "alias" || type === "tenant_note";
}

export function EvidenceCard({ item, className = "" }: { item: Evidence; className?: string }) {
  const style = EVIDENCE_STYLE[item.type] ?? {
    ...FALLBACK_EVIDENCE,
    label: String(item.type).replaceAll("_", " "),
  };
  const Icon = style.icon;
  return (
    <figure
      className={`rounded-[8px] border border-l-[3px] border-line bg-surface px-3 py-2.5 ${style.rule} ${className}`}
    >
      <div className="label flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${style.fg}`} strokeWidth={1.75} aria-hidden />
        <span>{style.label}</span>
      </div>
      <blockquote className="mono mt-2 rounded-[6px] bg-quote px-2.5 py-2 text-[12px] leading-[18px] text-ink">
        {moneyText(item.quote)}
      </blockquote>
      <figcaption className="mt-1.5 truncate text-[12px] text-muted" title={item.ref}>
        {item.ref}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-line bg-surface px-5 py-12 text-center">
      <div className="text-[15px] font-medium text-ink">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-[8px] border border-risk/25 bg-risk-tint px-3 py-2 text-[13px] text-risk"
    >
      <span>{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-medium underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Static placeholder rows. Deliberately not animated. */
export function Skeleton({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line px-3"
          style={{ height }}
        >
          <div className="h-2.5 w-14 rounded bg-canvas" />
          <div className="h-2.5 w-40 rounded bg-canvas" />
          <div className="h-2.5 flex-1 rounded bg-canvas" />
          <div className="h-2.5 w-20 rounded bg-canvas" />
        </div>
      ))}
    </div>
  );
}

export function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="keycap">{children}</kbd>;
}
