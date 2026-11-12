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
      className={`money tabular ${large ? "text-[28px] font-semibold leading-none" : ""} ${
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
  human: { label: "Human", fg: "text-ink", bg: "bg-line" },
  queue: { label: "In queue", fg: "text-queue", bg: "bg-queue-wash" },
  pending: { label: "Pending", fg: "text-muted", bg: "bg-line" },
};

export function MethodBadge({
  method,
  status,
}: {
  method: Method | null;
  status?: string | null;
}) {
  const key =
    status === "proposed"
      ? "queue"
      : method
        ? method
        : "pending";
  const s = methodStyle[key];
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[12px] font-semibold tracking-wide ${s.fg} ${s.bg}`}
    >
      {s.label}
    </span>
  );
}

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <div className="flex min-w-[88px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="money tabular text-[12px] text-muted">{pct(value)}</span>
    </div>
  );
}

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
  const border =
    accent === "amber"
      ? "border-queue"
      : accent === "red"
        ? "border-danger"
        : accent === "teal"
          ? "border-brand"
          : "border-line";
  return (
    <div className={`rounded-lg border ${border} bg-panel px-4 py-3`}>
      <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-tight">{value}</div>
      {hint ? <div className="mt-1 text-[13px] text-muted">{hint}</div> : null}
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
      <div className="flex h-3 overflow-hidden rounded-full bg-line">
        {seg.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2 text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${s.className}`} />
            {s.label} · {s.n}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EvidenceCard({ item }: { item: Evidence }) {
  return (
    <figure className="rounded-lg border border-line bg-panel p-3">
      <figcaption className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span className="rounded bg-brand-wash px-1.5 py-0.5 text-brand">
          {item.type.replace("_", " ")}
        </span>
        <span className="font-mono normal-case tracking-normal text-ink">
          {item.ref}
        </span>
      </figcaption>
      <blockquote className="border-l-2 border-brand pl-3 text-[14px] italic leading-relaxed text-ink">
        “{item.quote}”
      </blockquote>
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
    <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-12 text-center">
      <div className="font-[family-name:var(--font-display)] text-[22px] text-ink">
        {title}
      </div>
      <p className="mx-auto mt-2 max-w-md text-muted">{body}</p>
    </div>
  );
}
