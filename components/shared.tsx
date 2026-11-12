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
      className={`money tabular ${large ? "text-[24px] font-bold leading-none" : "text-[13px]"} ${
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
  human: { label: "Human", fg: "text-ink", bg: "bg-neutral-wash" },
  queue: { label: "In queue", fg: "text-warn", bg: "bg-warn-wash" },
  pending: { label: "Pending", fg: "text-muted-dark", bg: "bg-neutral-wash" },
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
      className={`pill ${s.fg} ${s.bg}`}
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
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="money tabular text-[11px] text-muted">{pct(value)}</span>
    </div>
  );
}

/** Stat card (mockup): small grey label, large bold figure. */
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
  const dot =
    accent === "amber"
      ? "bg-queue"
      : accent === "red"
        ? "bg-danger"
        : accent === "teal"
          ? "bg-memory"
          : null;
  return (
    <div className="card min-w-[150px] flex-1 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> : null}
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-muted">{hint}</div> : null}
    </div>
  );
}

export function KpiStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-3">
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
    <figure className="card px-3 py-2">
      <blockquote className="border-l-2 border-primary pl-2.5 text-[13px] leading-snug text-ink">
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
    <div className="card px-5 py-10 text-center">
      <div className="text-[18px] font-semibold text-ink">
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
          className="h-11 animate-pulse rounded-md bg-neutral-wash"
          style={{ opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}
