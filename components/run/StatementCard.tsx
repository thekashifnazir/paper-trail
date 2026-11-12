"use client";

import { useRef, useState } from "react";
import { ChevronRight, Play, Upload } from "lucide-react";
import { ErrorNote, METHOD_STYLE } from "@/components/shared";
import type { RunProgress } from "@/lib/types";

const STEPS = [
  ["exact", "Exact rules"],
  ["memory", "Memory"],
  ["agent", "Agent"],
] as const;

type StepKey = (typeof STEPS)[number][0];
export type StepCounts = Record<StepKey, number>;

function stepState(
  key: StepKey,
  stage: RunProgress["stage"],
): "current" | "done" | "future" {
  if (stage === "done") return "done";
  if (stage === "idle") return "future";
  if (stage === key) return "current";
  const order = STEPS.map(([id]) => id);
  const stageIndex = order.indexOf(stage as StepKey);
  return stageIndex > order.indexOf(key) ? "done" : "future";
}

function StepDot({ state, keyName }: { state: "current" | "done" | "future"; keyName: StepKey }) {
  if (state === "done") {
    return <span className={`h-2 w-2 rounded-full ${METHOD_STYLE[keyName].dot}`} aria-hidden />;
  }
  if (state === "current") {
    return (
      <span
        className="h-2.5 w-2.5 rounded-full border-2 border-ink bg-surface"
        aria-hidden
      />
    );
  }
  return <span className="h-2 w-2 rounded-full border border-muted/50" aria-hidden />;
}

/** Slim one-line stepper: Exact rules → Memory → Agent, with Run allocation on the right. */
export function StatementCard({
  monthLabel,
  running,
  hasRun,
  stage,
  counts,
  error,
  onRun,
}: {
  monthLabel: string;
  running: boolean;
  hasRun: boolean;
  stage: RunProgress["stage"];
  counts: StepCounts;
  error: string | null;
  onRun: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const canDrop = !hasRun && !running;
  const visualStage = !running && hasRun && stage === "idle" ? "done" : stage;

  return (
    <div className="space-y-2">
      <section
        onDragEnter={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          setDragOver(false);
          onRun();
        }}
        className={`flex h-14 items-center gap-5 rounded-[8px] border bg-surface pl-4 pr-2.5 ${
          dragOver ? "border-dashed border-ink" : "border-line"
        }`}
      >
        <div className="min-w-0 shrink-0">
          <div className="label">Statement</div>
          <div className="text-[13px] font-medium text-ink">{monthLabel} 2026</div>
        </div>
        <span className="h-7 w-px bg-line" aria-hidden />
        <ol className="flex min-w-0 flex-1 items-center gap-3" role="status" aria-live="polite">
          {STEPS.map(([key, label], index) => {
            const state = stepState(key, visualStage);
            return (
              <li key={key} className="flex items-center gap-3">
                {index > 0 ? (
                  <ChevronRight className="h-3.5 w-3.5 text-line" strokeWidth={2} aria-hidden />
                ) : null}
                <span className="flex items-center gap-2 whitespace-nowrap text-[13px]">
                  <StepDot state={state} keyName={key} />
                  <span className={state === "future" ? "text-muted" : "font-medium text-ink"}>
                    {label}
                  </span>
                  {state === "done" ? (
                    <span className="mono text-[12px] text-muted">{counts[key]}</span>
                  ) : state === "current" ? (
                    <span className="text-[12px] text-muted">running</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
        {canDrop ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] text-muted hover:bg-canvas hover:text-ink"
            title={`Drop the ${monthLabel} bank statement, or use the sample`}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload CSV
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onChange={() => {
                if (inputRef.current) inputRef.current.value = "";
                onRun();
              }}
            />
          </button>
        ) : null}
        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-ink px-3.5 text-[13px] font-medium text-surface hover:opacity-90 disabled:opacity-60"
        >
          <Play className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
          {running ? "Running…" : "Run allocation"}
        </button>
      </section>
      {error ? <ErrorNote message={error} onRetry={onRun} /> : null}
    </div>
  );
}
