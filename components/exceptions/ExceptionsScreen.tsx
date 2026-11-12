"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useFindMatch } from "@/components/match/FindMatch";
import { EmptyState, ErrorNote, Skeleton } from "@/components/shared";
import { lineMatchesQuery } from "@/lib/filter";
import { useStore } from "@/lib/store";
import type { LineView, ReviewReason } from "@/lib/types";
import { DetailPane } from "./DetailPane";
import { QueuePane, type QueueGroup } from "./QueuePane";

const GROUP_ORDER: Exclude<ReviewReason, null>[] = [
  "New payer relationship",
  "Short payment",
  "Overpayment",
  "Possible duplicate payment",
  "Unidentified receipt",
  "Low confidence",
];

export function ExceptionsScreen() {
  const { lines, loading, error, approve, reject, refresh } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [inflight, setInflight] = useState(false);
  const [query, setQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const { openFindMatch } = useFindMatch();
  const lock = useRef(false);
  const mounted = useRef(true);

  const queue = useMemo(
    () => lines.filter((line) => line.status === "proposed"),
    [lines],
  );

  const searched = useMemo(
    () => queue.filter((line) => lineMatchesQuery(line, query)),
    [queue, query],
  );

  const reasonCounts = useMemo(
    () =>
      GROUP_ORDER.map((reason) => ({
        reason,
        count: searched.filter((line) => line.review_reason === reason).length,
      })).filter((r) => queue.some((line) => line.review_reason === r.reason)),
    [queue, searched],
  );

  const groups = useMemo<QueueGroup[]>(
    () =>
      GROUP_ORDER.filter((reason) => !reasonFilter || reason === reasonFilter)
        .map((reason) => ({
          reason,
          items: searched.filter((line) => line.review_reason === reason),
        }))
        .filter((group) => group.items.length > 0),
    [searched, reasonFilter],
  );

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (inflight) return;
    if (selectedId && flat.some((line) => line.id === selectedId)) return;
    setSelectedId(flat[0]?.id ?? null);
  }, [flat, inflight, selectedId]);

  const settle = useCallback(
    async (action: "approve" | "reject", line: LineView) => {
      if (lock.current) return;
      const index = flat.findIndex((item) => item.id === line.id);
      if (index < 0) return;
      const nextId = flat[index + 1]?.id ?? flat[index - 1]?.id ?? null;
      lock.current = true;
      setInflight(true);
      setLeavingId(line.id);
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        await new Promise((resolve) => window.setTimeout(resolve, 160));
      }
      try {
        if (action === "approve") {
          const remembered = await approve(line.id);
          if (remembered) {
            toast.success(remembered, {
              description: "Next month this matches automatically.",
            });
          }
        } else {
          await reject(line.id);
        }
        if (mounted.current) setSelectedId(nextId);
      } finally {
        lock.current = false;
        if (mounted.current) {
          setLeavingId(null);
          setInflight(false);
        }
      }
    },
    [approve, flat, reject],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (lock.current) return;
      if (document.querySelector('[role="dialog"]')) return;
      const index = flat.findIndex((line) => line.id === selectedId);
      if (index < 0) return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        void settle("approve", flat[index]);
        return;
      }
      if (key === "r") {
        event.preventDefault();
        void settle("reject", flat[index]);
        return;
      }
      if (key === "f") {
        event.preventDefault();
        openFindMatch(flat[index]);
        return;
      }
      if (key === "j") {
        event.preventDefault();
        const next = flat[index + 1];
        if (next) setSelectedId(next.id);
        return;
      }
      if (key === "k") {
        event.preventDefault();
        const prev = flat[index - 1];
        if (prev) setSelectedId(prev.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedId, settle, openFindMatch]);

  if (queue.length === 0) {
    if (error) {
      return <ErrorNote message={error} onRetry={() => void refresh()} />;
    }
    if (lines.length === 0 && loading) {
      return (
        <div className="grid h-[calc(100dvh-var(--topbar-h)-40px)] grid-cols-[380px_minmax(0,1fr)] gap-4">
          <div className="overflow-hidden rounded-[8px] border border-line bg-surface">
            <Skeleton rows={9} height={56} />
          </div>
          <div className="rounded-[8px] border border-line bg-surface" />
        </div>
      );
    }
    const notRun = lines.length === 0 || lines.every((line) => line.status === null);
    if (notRun) {
      return (
        <EmptyState
          title="Run allocation first"
          body="Run allocation on Cash application. Receipts that need a decision will queue here."
          action={
            <Link
              href="/"
              className="inline-flex h-8 items-center rounded-[8px] bg-ink px-3 text-[13px] font-medium text-surface"
            >
              Go to Cash application
            </Link>
          }
        />
      );
    }
    const resolved = lines.filter(
      (line) => line.status === "approved" || line.status === "rejected",
    ).length;
    return (
      <EmptyState
        title="Queue clear"
        body={`${resolved} of ${lines.length} receipts resolved. Nothing needs a decision.`}
      />
    );
  }

  const selected = flat.find((line) => line.id === selectedId) ?? null;
  const total = queue.reduce((sum, line) => sum + line.amount, 0);

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h)-40px)] min-h-0 flex-col gap-3">
      {error ? <ErrorNote message={error} onRetry={() => void refresh()} /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-4">
      <QueuePane
        count={queue.length}
        shown={flat.length}
        total={total}
        groups={groups}
        query={query}
        onQuery={setQuery}
        reasons={reasonCounts}
        reasonFilter={reasonFilter}
        onReasonFilter={setReasonFilter}
        selectedId={selected?.id ?? null}
        leavingId={leavingId}
        onSelect={(id) => {
          if (lock.current) return;
          setSelectedId(id);
        }}
      />
      {selected ? (
        <DetailPane
          line={selected}
          busy={inflight}
          onApprove={() => void settle("approve", selected)}
          onReject={() => void settle("reject", selected)}
          onFindMatch={() => openFindMatch(selected)}
        />
      ) : (
        <section className="flex h-full min-h-0 items-center justify-center rounded-[8px] border border-line bg-surface text-[13px] text-muted">
          {flat.length === 0 ? "No receipts match the filters" : "Select a receipt to review"}
        </section>
      )}
      </div>
    </div>
  );
}
