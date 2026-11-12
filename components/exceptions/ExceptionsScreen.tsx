"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { gbp } from "@/lib/format";
import type { AuditRow, LineView } from "@/lib/types";
import { ReceiptCard, confidenceBand, type Band } from "./ReceiptCard";

type Tab = "reconcile" | "auto" | "reconciled" | "suspense";
type BandFilter = "all" | Band;

const TABS: { id: Tab; label: string }[] = [
  { id: "reconcile", label: "Reconcile" },
  { id: "auto", label: "Auto-reconciled" },
  { id: "reconciled", label: "Reconciled" },
  { id: "suspense", label: "Suspense" },
];

const BAND_RANK: Record<Band, number> = { high: 0, medium: 1, none: 2 };

const GRID = "minmax(0,38%) 110px minmax(0,1fr)";

function pence(n: number): number {
  return Math.round(n * 100);
}

function sumGbp(values: number[]): string {
  return gbp(values.reduce((acc, v) => acc + pence(v), 0) / 100);
}

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function humanDecidedIds(audit: AuditRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of audit) {
    if (row.actor !== "human") continue;
    ids.add(row.object_id);
    const detail = row.detail as { bank_line_id?: unknown } | null;
    if (detail && typeof detail === "object" && typeof detail.bank_line_id === "string") {
      ids.add(detail.bank_line_id);
    }
  }
  return ids;
}

function tabOf(line: LineView, human: Set<string>): Tab | null {
  if (line.status === "proposed") return "reconcile";
  if (line.status !== "approved") return null;
  if (line.allocations.length === 0) return "suspense";
  return human.has(line.id) ? "reconciled" : "auto";
}

function matchesSearch(line: LineView, q: string): boolean {
  if (!q) return true;
  const hay = [
    line.payer_name,
    line.reference,
    ...line.allocations.map((a) => a.tenant_name),
    line.amount.toFixed(2),
    gbp(line.amount),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function toastRemembered(remembered: string[]) {
  if (remembered.length === 0) return;
  if (remembered.length <= 2) {
    for (const r of remembered) {
      toast.success(r, { description: "Next month this matches automatically." });
    }
    return;
  }
  const names = remembered
    .slice(0, 3)
    .map((r) => r.replace(/^Remembered:\s*/, ""))
    .join("; ");
  toast.success(`Remembered ${remembered.length} payer relationships`, {
    description: `${names}${remembered.length > 3 ? "; …" : ""}. Next month these match automatically.`,
  });
}

export function ExceptionsScreen() {
  const { lines, summary, audit, loading, error, approve, reject, month } = useStore();
  const [tab, setTab] = useState<Tab>("reconcile");
  const [band, setBand] = useState<BandFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inflight, setInflight] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const human = useMemo(() => humanDecidedIds(audit), [audit]);

  const byTab = useMemo(() => {
    const out: Record<Tab, LineView[]> = {
      reconcile: [],
      auto: [],
      reconciled: [],
      suspense: [],
    };
    for (const line of lines) {
      const t = tabOf(line, human);
      if (t) out[t].push(line);
    }
    return out;
  }, [lines, human]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = byTab[tab].filter(
      (line) =>
        (band === "all" || confidenceBand(line) === band) && matchesSearch(line, q),
    );
    return list.sort((a, b) => {
      if (tab === "reconcile") {
        const d = BAND_RANK[confidenceBand(a)] - BAND_RANK[confidenceBand(b)];
        if (d !== 0) return d;
      }
      return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    });
  }, [byTab, tab, band, search]);

  const highIds = useMemo(
    () =>
      tab === "reconcile"
        ? visible
            .filter((line) => line.status === "proposed" && confidenceBand(line) === "high")
            .map((line) => line.id)
        : [],
    [tab, visible],
  );

  // Default selection: first visible card; keep current if still visible.
  useEffect(() => {
    if (inflight) return;
    if (selectedId && visible.some((line) => line.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [visible, inflight, selectedId]);

  // Reset selection when the tab changes.
  useEffect(() => {
    setSelectedId(null);
  }, [tab]);

  const stats = useMemo(() => {
    const statementTotal = summary
      ? gbp(summary.total_value)
      : sumGbp(lines.map((l) => l.amount));
    const allocated = sumGbp(
      lines
        .filter((l) => l.status === "approved")
        .flatMap((l) => l.allocations.map((a) => a.allocated)),
    );
    const proposed = lines.filter((l) => l.status === "proposed");
    return {
      statementTotal,
      allocated,
      toReconcileCount: proposed.length,
      toReconcileValue: sumGbp(proposed.map((l) => l.amount)),
    };
  }, [summary, lines]);

  const nextIdAfter = useCallback(
    (id: string) => {
      const index = visible.findIndex((l) => l.id === id);
      if (index < 0) return null;
      return visible[index + 1]?.id ?? visible[index - 1]?.id ?? null;
    },
    [visible],
  );

  const runAction = useCallback(
    async (line: LineView, fn: () => Promise<void>) => {
      if (lock.current) return;
      lock.current = true;
      setInflight(true);
      const nextId = nextIdAfter(line.id);
      try {
        await fn();
        if (mounted.current) setSelectedId(nextId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      } finally {
        lock.current = false;
        if (mounted.current) setInflight(false);
      }
    },
    [nextIdAfter],
  );

  const onOk = useCallback(
    (line: LineView) => {
      if (line.status !== "proposed" || line.allocations.length === 0) return;
      void runAction(line, async () => {
        const remembered = await approve(line.id);
        if (remembered) {
          toast.success(remembered, {
            description: "Next month this matches automatically.",
          });
        }
      });
    },
    [approve, runAction],
  );

  const onSuspense = useCallback(
    (line: LineView) => {
      if (line.status !== "proposed") return;
      void runAction(line, async () => {
        if (line.allocations.length === 0) {
          await approve(line.id);
          toast(`Moved to suspense: ${gbp(line.amount)} kept unallocated`);
        } else {
          await reject(line.id);
          toast("Moved to suspense");
        }
      });
    },
    [approve, reject, runAction],
  );

  const confirmAllHigh = useCallback(async () => {
    if (lock.current || highIds.length === 0) return;
    lock.current = true;
    setInflight(true);
    setBulkRunning(true);
    const remembered: string[] = [];
    let done = 0;
    try {
      for (const id of highIds) {
        const r = await approve(id);
        done += 1;
        if (r) remembered.push(r);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      lock.current = false;
      if (mounted.current) {
        setInflight(false);
        setBulkRunning(false);
      }
    }
    toastRemembered(remembered);
    if (done > 0) toast.success(`Confirmed ${done} receipt${done === 1 ? "" : "s"}`);
  }, [approve, highIds]);

  // Keyboard: ↑ ↓ move, Enter OK, S suspense.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (visible.length === 0) return;
      const index = visible.findIndex((l) => l.id === selectedId);

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          index < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta));
        const next = visible[nextIndex];
        if (!next) return;
        setSelectedId(next.id);
        document
          .querySelector(`[data-line-id="${next.id}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }

      if (event.repeat || lock.current || index < 0) return;
      const line = visible[index];
      if (tab !== "reconcile") return;

      if (event.key === "Enter") {
        const el = event.target as HTMLElement | null;
        const tag = el?.tagName;
        // Let a focused button/link activate natively (the card root itself excepted).
        if ((tag === "BUTTON" || tag === "A") && !el?.hasAttribute("data-line-id")) return;
        if (line.status === "proposed" && line.allocations.length > 0) {
          event.preventDefault();
          onOk(line);
        }
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        onSuspense(line);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, tab, onOk, onSuspense]);

  const readOnly = tab !== "reconcile";
  const noop = () => {};

  return (
    <div className="pb-6" style={{ color: "var(--ink, #111827)" }}>
      {/* 1. Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Reconcile</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted, #6b7280)" }}>
            Statement {monthLabel(month)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <StatCard label="Statement total">
            <span className="text-[20px] font-bold tabular-nums">{stats.statementTotal}</span>
          </StatCard>
          <StatCard label="Allocated in ledgers">
            <span className="text-[20px] font-bold tabular-nums">{stats.allocated}</span>
          </StatCard>
          <StatCard label="Lines to reconcile">
            <span className="text-[20px] font-bold tabular-nums">{stats.toReconcileCount}</span>
            <span
              className="ml-1.5 text-[13px] tabular-nums"
              style={{ color: "var(--muted, #6b7280)" }}
            >
              · {stats.toReconcileValue}
            </span>
          </StatCard>
        </div>
      </header>

      {/* 2. Sub-tabs */}
      <div
        className="tabs mt-5 flex gap-1 border-b"
        role="tablist"
        style={{ borderColor: "var(--hairline, #e5e7eb)" }}
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className="tab -mb-px border-b-2 px-3 py-2 text-[13px] font-medium"
              style={{
                borderColor: active ? "var(--primary, #1d4ed8)" : "transparent",
                color: active ? "var(--ink, #111827)" : "var(--muted, #6b7280)",
              }}
              onClick={() => setTab(t.id)}
            >
              {t.label} ({byTab[t.id].length})
            </button>
          );
        })}
      </div>

      {/* 3. Filter bar */}
      <div
        className="card mt-4 flex flex-wrap items-end gap-3 rounded-lg border p-3"
        style={{ background: "var(--card, #fff)", borderColor: "var(--hairline, #e5e7eb)" }}
      >
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          Confidence
          <select
            value={band}
            onChange={(e) => setBand(e.target.value as BandFilter)}
            className="h-9 min-w-[150px] rounded-md border bg-white px-2 text-[13px] font-normal"
            style={{ borderColor: "var(--hairline, #d1d5db)" }}
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium · review</option>
            <option value="none">No match</option>
          </select>
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] font-medium sm:max-w-[320px]">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Payer, reference, tenant or amount"
            className="h-9 rounded-md border bg-white px-2.5 text-[13px] font-normal"
            style={{ borderColor: "var(--hairline, #d1d5db)" }}
          />
        </label>
        <div className="ml-auto">
          {tab === "reconcile" && (
            <button
              type="button"
              disabled={bulkRunning || inflight || highIds.length === 0}
              onClick={() => void confirmAllHigh()}
              className="h-9 rounded-md border bg-white px-3.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: "var(--primary, #1d4ed8)",
                color: "var(--primary, #1d4ed8)",
              }}
            >
              {bulkRunning ? "Confirming…" : `Confirm all High (${highIds.length})`}
            </button>
          )}
        </div>
      </div>

      {/* 4. Column headers */}
      <div
        className="mt-5 grid gap-4 px-4 text-[12px] font-medium uppercase tracking-wide"
        style={{ gridTemplateColumns: GRID, color: "var(--muted, #6b7280)" }}
      >
        <div>Statement line (bank)</div>
        <div />
        <div>Match (ledger)</div>
      </div>

      {/* 5. List */}
      <div className="mt-2 space-y-3">
        {error ? (
          <div
            className="card rounded-lg border p-4 text-[13px]"
            style={{ background: "var(--card, #fff)", borderColor: "#fecaca", color: "#b91c1c" }}
          >
            {error}
          </div>
        ) : loading && lines.length === 0 ? (
          <div className="space-y-3" aria-busy>
            <p className="text-[13px]" style={{ color: "var(--muted, #6b7280)" }}>
              Loading statement…
            </p>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="card h-40 animate-pulse rounded-lg border"
                style={{
                  background: "var(--card, #fff)",
                  borderColor: "var(--hairline, #e5e7eb)",
                  opacity: 1 - i * 0.2,
                }}
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          tab === "reconcile" && byTab.reconcile.length === 0 ? (
            <div
              className="card rounded-lg border px-5 py-10 text-center"
              style={{ background: "var(--card, #fff)", borderColor: "var(--hairline, #e5e7eb)" }}
            >
              <div className="text-[18px] font-semibold">Nothing to reconcile.</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted, #6b7280)" }}>
                Run the statement first, or everything matched.
              </p>
              <Link
                href="/"
                className="btn-primary mt-4 inline-flex h-9 items-center rounded-md px-4 text-[13px] font-semibold text-white"
                style={{ background: "var(--primary, #1d4ed8)" }}
              >
                Go to Run
              </Link>
            </div>
          ) : (
            <p className="px-1 py-6 text-[13px]" style={{ color: "var(--muted, #6b7280)" }}>
              {byTab[tab].length === 0
                ? "No lines here yet."
                : "No lines match these filters."}
            </p>
          )
        ) : (
          visible.map((line) => (
            <ReceiptCard
              key={line.id}
              line={line}
              selected={line.id === selectedId}
              busy={readOnly || inflight}
              onSelect={() => {
                if (!lock.current) setSelectedId(line.id);
              }}
              onOk={readOnly ? noop : () => onOk(line)}
              onSuspense={readOnly ? noop : () => onSuspense(line)}
            />
          ))
        )}
      </div>

      {/* 6. Footer */}
      <p className="mt-4 px-1 text-[12px]" style={{ color: "var(--muted, #6b7280)" }}>
        Shortcuts: ↑ ↓ move between lines · Enter OK · S suspense
      </p>
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="card min-w-[160px] rounded-lg border px-3.5 py-2.5"
      style={{ background: "var(--card, #fff)", borderColor: "var(--hairline, #e5e7eb)" }}
    >
      <div className="text-[12px]" style={{ color: "var(--muted, #6b7280)" }}>
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline">{children}</div>
    </div>
  );
}
