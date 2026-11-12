"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_MODE,
  approveLine,
  getMode,
  setMode as setApiMode,
  type DataMode,
  getArrears,
  getAudit,
  getLines,
  getSummary,
  manualAllocate,
  rejectLine,
  reset as resetApi,
  runStatement,
} from "@/lib/api";
import type {
  ArrearsRow,
  AuditRow,
  LineView,
  ManualAllocation,
  RunProgress,
  RunSummary,
} from "@/lib/types";

type Store = {
  mode: DataMode;
  setMode: (m: DataMode) => void;
  month: string;
  setMonth: (m: string) => void;
  lines: LineView[];
  summary: RunSummary | null;
  arrears: ArrearsRow[];
  audit: AuditRow[];
  progress: RunProgress;
  queueCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  run: () => Promise<void>;
  approve: (id: string) => Promise<string | undefined>;
  reject: (id: string) => Promise<void>;
  manualMatch: (
    id: string,
    allocations: ManualAllocation[],
    unallocated: number,
    reasoning: string,
  ) => Promise<string | undefined>;
  reset: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

const DUPLICATE = /duplicate|already (allocated|matched)/i;
const HUMAN_DECISIONS = new Set(["approved", "hold_confirmed", "manual_match"]);

/**
 * One view of "who decided" for every screen. The engine keeps method "agent" after a person
 * approves and reports duplicate holds as "agent"; evidence quotes carry tenant ids (T088).
 */
export function displayLines(lines: LineView[], audit: AuditRow[]): LineView[] {
  const humanDecided = new Set(
    audit
      .filter((a) => a.actor === "human" && HUMAN_DECISIONS.has(a.action))
      .map((a) => a.object_id),
  );
  const names = new Map<string, string>();
  for (const line of lines) {
    for (const a of line.allocations) names.set(a.tenant_id, a.tenant_name);
  }
  const named = (text: string) => text.replace(/\bT\d{3}\b/g, (id) => names.get(id) ?? id);
  return lines.map((line) => {
    const duplicate =
      line.allocations.length === 0 &&
      (line.review_reason === "Possible duplicate payment" ||
        DUPLICATE.test(line.reasoning ?? "") ||
        line.evidence.some((e) => DUPLICATE.test(e.quote)));
    let method = line.method;
    if (duplicate && line.status !== null) method = "rule";
    else if (line.status === "approved" && humanDecided.has(line.id)) method = "human";
    return {
      ...line,
      method,
      reasoning: line.reasoning ? named(line.reasoning) : line.reasoning,
      evidence: line.evidence.map((e) => ({ ...e, quote: named(e.quote) })),
    };
  });
}

function pause(ms: number) {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [month, setMonth] = useState("2026-09");
  const [mode, setModeState] = useState<DataMode>(DEFAULT_MODE);

  useEffect(() => {
    setModeState(getMode());
  }, []);

  const setMode = useCallback((m: DataMode) => {
    setApiMode(m);
    setLines([]);
    setSummary(null);
    setArrears([]);
    setAudit([]);
    setProgress({ stage: "idle", percent: 0 });
    setModeState(m);
  }, []);
  const [lines, setLines] = useState<LineView[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [arrears, setArrears] = useState<ArrearsRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [progress, setProgress] = useState<RunProgress>({
    stage: "idle",
    percent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, s, a, au] = await Promise.all([
        getLines(month),
        getSummary(month),
        getArrears(),
        getAudit(),
      ]);
      setLines(displayLines(l, au));
      setSummary(s);
      setArrears(a);
      setAudit(au);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month, mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async () => {
    setError(null);
    setProgress({ stage: "exact", percent: 10 });
    try {
      let reported = false;
      const s = await runStatement(month, (p) => {
        reported = true;
        setProgress(p);
      });
      if (!reported) {
        // The real API answers once, so walk the passes the engine just ran.
        await pause(350);
        setProgress({ stage: "memory", percent: 55 });
        await pause(350);
        setProgress({ stage: "agent", percent: 85 });
        await pause(350);
      }
      setProgress({ stage: "done", percent: 100 });
      setSummary(s);
      const [l, a, au] = await Promise.all([
        getLines(month),
        getArrears(),
        getAudit(),
      ]);
      setLines(displayLines(l, au));
      setArrears(a);
      setAudit(au);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
      setProgress({ stage: "idle", percent: 0 });
    }
  }, [month]);

  const approve = useCallback(
    async (id: string) => {
      const res = await approveLine(id);
      await refresh();
      return res.remembered;
    },
    [refresh],
  );

  const reject = useCallback(
    async (id: string) => {
      await rejectLine(id);
      await refresh();
    },
    [refresh],
  );

  const manualMatch = useCallback(
    async (
      id: string,
      allocations: ManualAllocation[],
      unallocated: number,
      reasoning: string,
    ) => {
      const res = await manualAllocate(id, allocations, unallocated, reasoning);
      await refresh();
      return res.remembered;
    },
    [refresh],
  );

  const reset = useCallback(async () => {
    await resetApi();
    setProgress({ stage: "idle", percent: 0 });
    await refresh();
  }, [refresh]);

  const queueCount = useMemo(
    () => lines.filter((l) => l.status === "proposed").length,
    [lines],
  );

  const value: Store = {
    mode,
    setMode,
    month,
    setMonth,
    lines,
    summary,
    arrears,
    audit,
    progress,
    queueCount,
    loading,
    error,
    refresh,
    run,
    approve,
    reject,
    manualMatch,
    reset,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
