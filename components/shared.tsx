"use client";

import type { Evidence, Method } from "@/lib/types";
import { gbp, pct } from "@/lib/format";

export function Money({
  value,
  large,
  danger,
}: {
  value: number;
  large?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={`money tabular ${large ? "text-[22px] font-medium leading-none" : "text-[13px]"} ${
        danger ? "text-danger" : ""
      }`}
    >
      {gbp(value)}
    </span>
  );
}

const methodStyle: Record<
  Method | "queue" | "pending",
  { label: string; fg: string; bg: string }
> = {
  exact: { label: "Exact", fg: "text-exact", bg: "bg-exact-wash" },
  memory: { label: "Memory", fg: "text-memory", bg: "bg-memory-wash" },
  agent: { label: "Agent", fg: "text-agent", bg: "bg-agent-wash" },
  human: { label: "Human", fg: "text-ink", bg: "bg-fill" },
  queue: { label: "In queue", fg: "text-queue", bg: "bg-queue-wash" },
  pending: { label: "Pending", fg: "text-muted", bg: "bg-fill" },
};

export function MethodBadge({
  method,
  status,
}: {
  method: Method | null;
  status?: string | null;
}) {
  const key =
    status === "proposed" ? "queue" : method ? method : "pending";
  const s = methodStyle[key];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium tracking-[0.04em] ${s.fg} ${s.bg}`}
    >
      {s.label}
    </span>
  );
}

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <div className="flex min-w-[72px] items-center gap-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-hairline">
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="money tabular text-[11px] text-muted">{pct(value)}</span>
    </div>
  );
}

/** Metric strip cell — API kept as KpiCard; visual is strip cells, not cards. */
export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "amber" | "red" | "teal";
}) {
  const rule =
    accent === "amber"
      ? "border-l-queue"
      : accent === "red"
        ? "border-l-danger"
        : accent === "teal"
          ? "border-l-memory"
          : "border-l-transparent";
  return (
    <div
      className={`min-w-0 flex-1 border-l-2 px-3 py-2.5 first:pl-3 ${rule}`}
    >
      <div className="text-[12px] font-medium tracking-[0.04em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-medium leading-tight tracking-[-0.02em]">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-muted">{hint}</div> : null}
    </div>
  );
}

export function KpiStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap divide-x divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-sheet">
      {children}
    </div>
  );
}

export function AllocationBar({
  exact,
  memory,
  agent,
  queue,
}: {
  exact: number;
  memory: number;
  agent: number;
  queue: number;
}) {
  const total = Math.max(exact + memory + agent + queue, 1);
  const seg = [
    { n: exact, className: "bg-exact", label: "Exact" },
    { n: memory, className: "bg-memory", label: "Memory" },
    { n: agent, className: "bg-agent", label: "Agent" },
    { n: queue, className: "bg-queue", label: "In queue" },
  ];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-hairline">
        {seg.map((s) =>
          s.n > 0 ? (
            <div
              key={s.label}
              className={`${s.className} motion-safe:transition-[width] motion-safe:duration-500`}
              style={{ width: `${(s.n / total) * 100}%` }}
              title={`${s.label}: ${s.n}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-muted">
            <span className={`h-2 w-2 rounded-full ${s.className}`} />
            {s.label} · {s.n}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EvidenceCard({ item }: { item: Evidence }) {
  return (
    <figure className="rounded-lg border border-hairline bg-sheet px-3 py-2">
      <blockquote className="border-l-2 border-ink pl-2.5 text-[13px] leading-snug text-ink">
        “{item.quote}”
      </blockquote>
      <figcaption className="mt-1.5 font-mono text-[11px] text-muted">
        {item.type.replace("_", " ")} · {item.ref}
      </figcaption>
    </figure>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[12px] border border-dashed border-hairline bg-sheet px-5 py-10 text-center">
      <div className="text-[22px] font-medium tracking-[-0.02em] text-ink">
        {title}
      </div>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-muted">{body}</p>
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-11 animate-pulse rounded-md bg-fill"
          style={{ opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}
