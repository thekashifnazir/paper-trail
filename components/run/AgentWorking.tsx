"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Loader2 } from "lucide-react";
import { METHOD_STYLE } from "@/components/shared";
import { gbp } from "@/lib/format";
import type { LineView, RunProgress } from "@/lib/types";

type Stage = RunProgress["stage"];
type LogLine = { id: number; tone: "step" | "think" | "done"; text: string };

const PASSES = [
  { key: "exact", title: "Exact rules", detail: "Invoice refs, tenant names and amounts" },
  { key: "memory", title: "Payer memory", detail: "Payers you approved before" },
  { key: "agent", title: "Agent", detail: "Reads the leftovers with the evidence" },
] as const;

const ORDER: Stage[] = ["exact", "memory", "agent", "done"];

const EXACT_THOUGHTS = [
  "Scanning references for invoice numbers…",
  "Matching payer names against the tenant list…",
  "Checking amount = open charge, to the penny…",
  "Combined payments: does the sum fit two charges?",
  "Duplicate guard: same payer, amount and reference within 7 days?",
];

const MEMORY_THOUGHTS = [
  "Loading payer memory from earlier approvals…",
  "Known parent companies → their tenants' open charges…",
];

const AGENT_CHECKS = [
  "candidates: open charges for this payer and amount",
  "company lookup: is this a parent paying for a group member?",
  "tenant notes: any dispute that explains a short payment?",
  "sum check: allocations + unallocated must equal the receipt",
  "evidence: every quote must be found in its source",
  "confidence below 0.7 or a new payer → send to a person",
];

function stateOf(key: string, stage: Stage): "done" | "current" | "future" {
  const i = ORDER.indexOf(stage);
  const k = ORDER.indexOf(key as Stage);
  if (stage === "done" || i > k) return "done";
  return i === k ? "current" : "future";
}

/** The panel that shows the engine working while a run is in flight. */
export function AgentWorking({
  running,
  stage,
  monthLabel,
  lines,
  live,
  result,
}: {
  running: boolean;
  stage: Stage;
  monthLabel: string;
  lines: LineView[];
  live: boolean;
  result: { exact: number; memory: number; agent: number; queue: number } | null;
}) {
  // Stay up briefly after the run so the result can be read.
  const [lingering, setLingering] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      setLingering(false);
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    setLingering(true);
    const t = window.setTimeout(() => setLingering(false), 1800);
    return () => window.clearTimeout(t);
  }, [running]);
  const visible = running || lingering;
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const counter = useRef(0);
  const cursor = useRef({ exact: 0, memory: 0, agent: 0, check: 0 });
  const lastStage = useRef<Stage>("idle");
  const started = useRef(0);
  const logRef = useRef<HTMLOListElement>(null);

  // Receipts still waiting for a pass: real payers and amounts from the statement when we have them.
  const open = useMemo(
    () => lines.filter((l) => l.status === null || l.method === null).slice(0, 40),
    [lines],
  );
  const openRef = useRef(open);
  openRef.current = open;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const total = lines.length;

  useEffect(() => {
    if (!running) return;
    started.current = performance.now();
    counter.current = 0;
    cursor.current = { exact: 0, memory: 0, agent: 0, check: 0 };
    lastStage.current = "idle";
    setElapsed(0);
    setLog([
      {
        id: counter.current++,
        tone: "step",
        text: total
          ? `Reading ${total} receipts from the ${monthLabel} statement`
          : `Loading the ${monthLabel} statement`,
      },
    ]);
  }, [running, monthLabel, total]);

  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => {
      setElapsed((performance.now() - started.current) / 1000);
    }, 100);
    return () => window.clearInterval(tick);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const push = (tone: LogLine["tone"], text: string) =>
      setLog((prev) => [...prev.slice(-11), { id: counter.current++, tone, text }]);

    const think = () => {
      const s = stageRef.current;
      if (s !== lastStage.current) {
        const prev = lastStage.current;
        lastStage.current = s;
        const count = (m: string) => linesRef.current.filter((l) => l.method === m && l.status === "approved").length;
        if (prev === "exact" && linesRef.current.length) push("done", `✓ ${count("exact")} matched on exact rules`);
        if (prev === "memory" && linesRef.current.length) push("done", `✓ ${count("memory")} matched from payer memory`);
        if (s === "exact") push("step", "Pass 1 · Exact rules");
        if (s === "memory") push("step", "Pass 2 · Payer memory");
        if (s === "agent") {
          const n = openRef.current.length;
          push("step", n ? `Pass 3 · Agent — ${n} receipts left to reason about` : "Pass 3 · Agent");
        }
        return;
      }
      const c = cursor.current;
      if (s === "exact") push("think", EXACT_THOUGHTS[c.exact++ % EXACT_THOUGHTS.length]);
      else if (s === "memory") push("think", MEMORY_THOUGHTS[c.memory++ % MEMORY_THOUGHTS.length]);
      else if (s === "agent") {
        const pool = openRef.current;
        if (pool.length && c.agent % 2 === 0) {
          const l = pool[(c.agent / 2) % pool.length];
          push("think", `→ ${l.payer_name} · ${gbp(l.amount)} · “${l.reference}”`);
        } else {
          push("think", `   ${AGENT_CHECKS[c.check++ % AGENT_CHECKS.length]}`);
        }
        c.agent++;
      }
    };
    const id = window.setInterval(think, 260);
    return () => window.clearInterval(id);
  }, [running]);

  const stageRef = useRef(stage);
  stageRef.current = stage;

  const resultKey = result ? `${result.exact}-${result.memory}-${result.agent}-${result.queue}` : "";
  const logged = useRef(false);
  useEffect(() => {
    if (!lingering) logged.current = false;
    if (!lingering || !result || logged.current) return;
    logged.current = true;
    const secs = ((performance.now() - started.current) / 1000).toFixed(1);
    setLog((prev) => [
      ...prev.slice(-10),
      {
        id: counter.current++,
        tone: "done",
        text: `Done in ${secs} s — ${result.exact} exact · ${result.memory} memory · ${result.agent} agent · ${result.queue} waiting for you`,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lingering, resultKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const shownStage: Stage = lingering ? "done" : stage;
  const pct = { idle: 4, exact: 22, memory: 50, agent: 80, done: 100 }[shownStage];

  return (
    <AnimatePresence>
      {visible ? (
        <motion.section
          key="agent-working"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          aria-live="polite"
          aria-label="Allocation in progress"
          className="overflow-hidden rounded-[8px] border border-line bg-surface"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-agent-tint">
              <motion.span
                className="absolute inset-0 rounded-full border-2 border-agent/40"
                animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                aria-hidden
              />
              <Bot className="h-4 w-4 text-agent" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink">
                {lingering ? `${monthLabel} statement allocated` : `Allocating the ${monthLabel} statement`}
              </div>
              <div className="text-[12px] text-muted">
                {live ? "Live engine" : "Demo"} · three passes, cheapest first · nothing is posted until it balances
              </div>
            </div>
            <span className="mono text-[12px] text-muted">
              {running ? `${elapsed.toFixed(1)} s · working` : `${elapsed.toFixed(1)} s`}
            </span>
          </header>

          <div className="h-1 bg-canvas">
            <motion.div
              className="h-full bg-agent"
              initial={{ width: "2%" }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>

          <div className="grid grid-cols-[260px_minmax(0,1fr)]">
            <ol className="space-y-3 border-r border-line px-4 py-3">
              {PASSES.map((p) => {
                const st = stateOf(p.key, shownStage);
                return (
                  <li key={p.key} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {st === "done" ? (
                        <Check className={`h-4 w-4 ${METHOD_STYLE[p.key].fg}`} strokeWidth={2.5} aria-hidden />
                      ) : st === "current" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-agent" aria-hidden />
                      ) : (
                        <span className="h-2 w-2 rounded-full border border-muted/50" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] font-medium ${st === "future" ? "text-muted" : "text-ink"}`}>
                        {p.title}
                      </span>
                      <span className="block text-[12px] text-muted">{p.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <ol
              ref={logRef}
              className="mono h-[150px] overflow-hidden bg-quote px-4 py-3 text-[12px] leading-[19px]"
              aria-label="What the engine is doing"
            >
              <AnimatePresence initial={false}>
                {log.map((l) => (
                  <motion.li
                    key={l.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`whitespace-pre truncate ${
                      l.tone === "step"
                        ? "font-medium text-agent"
                        : l.tone === "done"
                          ? "font-medium text-memory"
                          : "text-ink"
                    }`}
                  >
                    {l.text}
                  </motion.li>
                ))}
              </AnimatePresence>
              <li className="text-muted">
                <motion.span
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  ▍
                </motion.span>
              </li>
            </ol>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
