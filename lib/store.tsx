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
  approveLine,
  getArrears,
  getAudit,
  getLines,
  getSummary,
  rejectLine,
  reset as resetApi,
  runStatement,
} from "@/lib/api";
import type {
  ArrearsRow,
  AuditRow,
  LineView,
  RunProgress,
  RunSummary,
} from "@/lib/types";

type Store = {
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
  reset: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [month, setMonth] = useState("2026-09");
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
      setLines(l);
      setSummary(s);
      setArrears(a);
      setAudit(au);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async () => {
    setError(null);
    setProgress({ stage: "exact", percent: 10 });
    try {
      const s = await runStatement(month, setProgress);
      setSummary(s);
      const [l, a, au] = await Promise.all([
        getLines(month),
        getArrears(),
        getAudit(),
      ]);
      setLines(l);
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
    reset,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
