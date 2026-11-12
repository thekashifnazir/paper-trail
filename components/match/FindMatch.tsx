"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Money } from "@/components/shared";
import { getOpenCharges } from "@/lib/api";
import { amountMatches, parseAmountQuery } from "@/lib/filter";
import { gbp, shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { LineView, OpenCharge } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Context: any screen can open the Find match dialog for a receipt    */
/* ------------------------------------------------------------------ */

type Ctx = { openFindMatch: (line: LineView) => void };
const FindMatchCtx = createContext<Ctx | null>(null);

export function FindMatchProvider({ children }: { children: ReactNode }) {
  const [line, setLine] = useState<LineView | null>(null);
  const openFindMatch = useCallback((l: LineView) => setLine(l), []);
  const close = useCallback(() => setLine(null), []);
  const value = useMemo(() => ({ openFindMatch }), [openFindMatch]);
  return (
    <FindMatchCtx.Provider value={value}>
      {children}
      {line ? <FindMatchDialog key={line.id} line={line} onClose={close} /> : null}
    </FindMatchCtx.Provider>
  );
}

export function useFindMatch(): Ctx {
  const ctx = useContext(FindMatchCtx);
  if (!ctx) throw new Error("useFindMatch must be used within FindMatchProvider");
  return ctx;
}

/** Lines a person can still match by hand. */
export function canFindMatch(line: LineView): boolean {
  return line.status === "proposed" || line.status === "rejected";
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

const pence = (n: number) => Math.round(n * 100);

/** First meaningful word of the payer name, as a starting search. */
function seedQuery(payer: string): string {
  const stop = new Set(["THE", "LTD", "LIMITED", "PLC", "CO", "GRP", "GROUP", "AND", "&", "MR", "MRS", "MS"]);
  const word = payer
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .find((w) => w.length > 2 && !stop.has(w.toUpperCase()));
  return word ? word.toLowerCase() : "";
}

function chargeMatches(c: OpenCharge, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const amount = parseAmountQuery(needle);
  if (amount && amountMatches(c.outstanding, amount)) return true;
  if (amount && amount.op !== "=") return false;
  return [c.tenant_name, c.unit, c.charge_id, c.tenant_id, c.period, c.charge_type.replaceAll("_", " ")]
    .some((s) => s.toLowerCase().includes(needle));
}

type Picked = { charge: OpenCharge; amount: string };

function FindMatchDialog({ line, onClose }: { line: LineView; onClose: () => void }) {
  const { manualMatch } = useStore();
  const [charges, setCharges] = useState<OpenCharge[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState(() => seedQuery(line.payer_name));
  const [picked, setPicked] = useState<Picked[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    setCharges(null);
    getOpenCharges(line.statement_month)
      .then(setCharges)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Could not load charges"));
  }, [line.statement_month]);

  useEffect(() => {
    load();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const results = useMemo(() => {
    if (!charges) return [];
    const exact = (c: OpenCharge) => pence(c.outstanding) === pence(line.amount);
    return charges
      .filter((c) => chargeMatches(c, query))
      .sort((a, b) => {
        const e = Number(exact(b)) - Number(exact(a));
        if (e) return e;
        if (a.tenant_name !== b.tenant_name) return a.tenant_name.localeCompare(b.tenant_name);
        return a.charge_id.localeCompare(b.charge_id);
      })
      .slice(0, 200);
  }, [charges, query, line.amount]);

  const pickedIds = new Set(picked.map((p) => p.charge.charge_id));
  const amounts = picked.map((p) => Number(p.amount));
  const allocatedP = amounts.reduce((s, n) => s + (Number.isFinite(n) ? pence(n) : 0), 0);
  const remainingP = pence(line.amount) - allocatedP;
  const rowErrors = picked.map((p) => {
    const n = Number(p.amount);
    if (!p.amount.trim() || !Number.isFinite(n) || pence(n) <= 0) return "Enter an amount";
    if (pence(n) > pence(p.charge.outstanding)) return `Max ${gbp(p.charge.outstanding)}`;
    return null;
  });
  const overAllocated = remainingP < 0;
  const valid = picked.length > 0 && rowErrors.every((e) => !e) && !overAllocated;

  function toggle(c: OpenCharge) {
    setSaveError(null);
    setPicked((prev) => {
      if (prev.some((p) => p.charge.charge_id === c.charge_id)) {
        return prev.filter((p) => p.charge.charge_id !== c.charge_id);
      }
      const used = prev.reduce((s, p) => s + (Number.isFinite(Number(p.amount)) ? pence(Number(p.amount)) : 0), 0);
      const left = Math.max(0, pence(line.amount) - used);
      const amount = Math.min(left, pence(c.outstanding)) / 100;
      return [...prev, { charge: c, amount: amount.toFixed(2) }];
    });
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    const tenants = [...new Set(picked.map((p) => p.charge.tenant_name))];
    try {
      const remembered = await manualMatch(
        line.id,
        picked.map((p) => ({ charge_id: p.charge.charge_id, amount: Number(p.amount) })),
        remainingP / 100,
        `Matched by hand to ${tenants.join(" and ")}.`,
      );
      toast.success(`Matched by hand: ${line.payer_name} → ${tenants.join(", ")}`, {
        description: remembered ?? undefined,
      });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not allocate");
      setSaving(false);
    }
  }

  const amountChip = line.amount.toFixed(2);
  const TH = "label sticky top-0 z-10 h-8 border-b border-line bg-surface px-3 text-left align-middle";
  const TD = "h-11 border-b border-line px-3 align-middle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-match-title"
        className="flex h-[min(760px,calc(100vh-2rem))] w-full max-w-[960px] flex-col overflow-hidden rounded-[8px] border border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Receipt */}
        <header className="flex shrink-0 items-start justify-between gap-6 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div id="find-match-title" className="label">
              Find match
            </div>
            <div className="mono mt-1 truncate text-[16px] font-medium text-ink">{line.payer_name}</div>
            <div className="mono mt-0.5 flex gap-2 truncate text-[12px] text-muted">
              <span className="truncate">{line.reference}</span>
              <span aria-hidden>·</span>
              <span className="whitespace-nowrap">{shortDate(line.date)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <Money value={line.amount} size="kpi" />
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              className="rounded-[6px] p-1 text-muted hover:bg-canvas hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Search */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
          <label className="flex h-9 min-w-[280px] flex-1 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-ink">
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tenant, unit, invoice ref or amount (e.g. 4850, >1000)"
              aria-label="Search open charges"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            />
          </label>
          <button
            type="button"
            onClick={() => setQuery(amountChip)}
            className="mono h-7 rounded-full border border-line px-2.5 text-[12px] text-ink hover:bg-canvas"
          >
            Amount = {gbp(line.amount)}
          </button>
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="h-7 rounded-full px-2.5 text-[12px] text-muted hover:text-ink"
            >
              Clear
            </button>
          ) : null}
          <span className="mono ml-auto text-[12px] text-muted">
            {charges ? `${results.length} open charge${results.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loadError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-[13px]">
              <span className="text-risk">{loadError}</span>
              <button type="button" onClick={load} className="rounded-[8px] border border-line px-3 py-1.5 text-ink hover:bg-canvas">
                Retry
              </button>
            </div>
          ) : !charges ? (
            <div className="px-4 py-12 text-center text-[13px] text-muted">Loading open charges…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-[14px] font-medium text-ink">No open charges match</div>
              <p className="mt-1 text-[13px] text-muted">Try a tenant name, unit, invoice ref or amount.</p>
            </div>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: "38%" }} />
                <col />
                <col style={{ width: 150 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH} aria-label="Select" />
                  <th className={TH}>Tenant</th>
                  <th className={TH}>Charge</th>
                  <th className={`${TH} text-right`}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => {
                  const on = pickedIds.has(c.charge_id);
                  const exact = pence(c.outstanding) === pence(line.amount);
                  return (
                    <tr
                      key={c.charge_id}
                      onClick={() => toggle(c)}
                      className={`cursor-pointer ${on ? "bg-canvas" : "hover:bg-canvas"}`}
                    >
                      <td className={TD}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(c)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${c.charge_id}`}
                          className="h-4 w-4 accent-[var(--color-ink)]"
                        />
                      </td>
                      <td className={`${TD} truncate`} title={`${c.tenant_name} · ${c.unit}`}>
                        <span className="font-medium text-ink">{c.tenant_name}</span>
                        <span className="ml-2 text-[12px] text-muted">{c.unit}</span>
                      </td>
                      <td className={TD}>
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="mono shrink-0 text-[12px] text-ink">{c.charge_id}</span>
                          <span className="truncate text-[12px] text-muted">
                            {c.charge_type.replaceAll("_", " ")} · {c.period}
                          </span>
                          {exact ? (
                            <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded-full bg-memory-tint px-2 text-[11px] font-medium text-memory">
                              Exact amount
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`${TD} text-right`}>
                        <Money value={c.outstanding} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Allocation */}
        <div className="shrink-0 border-t border-line bg-canvas px-5 py-3">
          <div className="label mb-2">Allocation</div>
          {picked.length === 0 ? (
            <p className="text-[13px] text-muted">Tick one or more charges above. Any remainder stays unallocated.</p>
          ) : (
            <ul className="max-h-[140px] space-y-1.5 overflow-auto">
              {picked.map((p, i) => (
                <li key={p.charge.charge_id} className="flex items-center gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-ink">{p.charge.tenant_name}</span>
                    <span className="mono ml-2 text-[12px] text-muted">{p.charge.charge_id}</span>
                  </span>
                  {rowErrors[i] ? <span className="text-[12px] text-risk">{rowErrors[i]}</span> : null}
                  <span className="text-[12px] text-muted">of {gbp(p.charge.outstanding)}</span>
                  <label className="flex h-8 w-[130px] items-center gap-1 rounded-[6px] border border-line bg-surface px-2 focus-within:border-ink">
                    <span className="text-muted">£</span>
                    <input
                      inputMode="decimal"
                      value={p.amount}
                      aria-label={`Amount for ${p.charge.charge_id}`}
                      onChange={(event) => {
                        const v = event.target.value;
                        setSaveError(null);
                        setPicked((prev) => prev.map((x, j) => (j === i ? { ...x, amount: v } : x)));
                      }}
                      className="money w-full bg-transparent text-right outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => toggle(p.charge)}
                    aria-label={`Remove ${p.charge.charge_id}`}
                    className="rounded-[6px] p-1 text-muted hover:bg-surface hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div
            className={`mt-2 flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-[12px] ${
              overAllocated ? "bg-risk-tint text-risk" : "bg-memory-tint text-memory"
            }`}
          >
            {overAllocated ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            )}
            <span className="money">
              {gbp(allocatedP / 100)} allocated
              {overAllocated
                ? ` — ${gbp(-remainingP / 100)} more than received`
                : ` + ${gbp(remainingP / 100)} unallocated`}{" "}
              of {gbp(line.amount)} received
            </span>
          </div>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-5">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-approve px-3.5 text-[13px] font-medium text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            {saving ? "Allocating…" : "Allocate"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-canvas"
          >
            Cancel
          </button>
          {saveError ? <span className="text-[12px] text-risk">{saveError}</span> : null}
          <span className="ml-auto text-[12px] text-muted">Posts to tenant ledgers as a manual allocation.</span>
        </footer>
      </div>
    </div>
  );
}
