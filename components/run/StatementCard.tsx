"use client";

import { useRef, useState } from "react";
import type { RunProgress } from "@/lib/types";

const STEPS = [
  ["exact", "Exact rules"],
  ["memory", "Memory"],
  ["agent", "Agent"],
] as const;

type StepKey = (typeof STEPS)[number][0];

function stepState(
  key: StepKey,
  stage: RunProgress["stage"],
): "current" | "lit" | "future" {
  if (stage === "done") return "lit";
  if (stage === "idle") return "future";
  if (stage === key) return "current";
  const order = STEPS.map(([id]) => id);
  const stageIndex = order.indexOf(stage as StepKey);
  const keyIndex = order.indexOf(key);
  if (stageIndex > keyIndex) return "lit";
  return "future";
}

export function StatementCard({
  monthLabel,
  running,
  hasRun,
  stage,
  error,
  onRun,
}: {
  monthLabel: string;
  running: boolean;
  hasRun: boolean;
  stage: RunProgress["stage"];
  error: string | null;
  onRun: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const showDrop = !hasRun && !running;
  const visualStage = !running && hasRun && stage === "idle" ? "done" : stage;

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChosen() {
    if (inputRef.current) inputRef.current.value = "";
    onRun();
  }

  return (
    <section className="rounded-[12px] border border-hairline bg-sheet px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showDrop ? (
          <div
            role="button"
            tabIndex={0}
            onClick={pickFile}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRun();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              onRun();
            }}
            className={`flex min-h-[48px] min-w-0 flex-1 cursor-pointer items-center rounded-lg border border-dashed px-3 text-[14px] outline-none focus-visible:border-ink ${
              dragOver
                ? "border-ink bg-fill text-ink"
                : "border-hairline bg-paper text-ink"
            }`}
          >
            Drop the {monthLabel} bank statement, or use the sample
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onChange={onFileChosen}
            />
          </div>
        ) : (
          <div className="grid min-h-12 min-w-0 flex-1 gap-2 sm:grid-cols-3" role="status">
            {STEPS.map(([key, label]) => {
              const state = stepState(key, visualStage);
              const className =
                state === "current"
                  ? "border-brand bg-brand-wash text-brand"
                  : state === "lit"
                    ? "border-brand text-brand"
                    : "border-hairline text-muted";
              return (
                <div
                  key={key}
                  className={`flex items-center rounded-md border px-3 text-[13px] font-medium ${className}`}
                >
                  {label}
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className="shrink-0 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-60"
        >
          {running ? "Running…" : "Run allocation"}
        </button>
      </div>
      {error ? (
        <div className="mt-2.5 rounded-lg border border-danger/30 bg-danger-wash px-3 py-2 text-[13px] text-danger">
          {error}{" "}
          <button type="button" className="font-medium underline" onClick={onRun}>
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}
