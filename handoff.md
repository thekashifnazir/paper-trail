# Handoff — Paper Trail front end

Paste this into the next coding agent. Owners: Luca and Alice. Hackathon code freeze 23:00; submission is a 2-minute screen recording.

Read `context.md` for product, data and the engine API. Read **`DESIGN.md` before touching any UI** — it is the source of truth for tokens, type, layout and motion. This file is the operational handoff: what is live and what to do next.

---

## 0 — State of play

The design pass is **done and live**. `main` at `f975e53` (PR [thekashifnazir/paper-trail#3](https://github.com/thekashifnazir/paper-trail/pull/3)) ships a fintech-ops design system:

- **Tokens** in `app/globals.css` only (canvas `#F7F7F5`, surface, line, ink, muted; dark sidebar; lime highlight; five method text/tint pairs; approve green). No hard-coded colours in components.
- **Type rule:** raw bank data (payer, reference, amounts, invoice ids, evidence quotes) is **Geist Mono**; everything we produce (tenant names, labels, reasoning) is **Geist Sans**.
- **Money:** one formatter — `gbp()` in `lib/format.ts`, rendered via `<Money>`; `moneyText()` re-formats raw `£1234.5` inside quotes and reasoning.
- **Shell:** dark 232px sidebar (lime active indicator, amber queue pill, Synthetic data pill), top bar with Sep/Oct segmented control and Reset.
- **Motion:** Framer Motion only for KPI count-up, bar fill, queue slide-out and the dark Remembered toast. Nothing else animates.

A parallel restyle to Alice's mockup (navy bar, "Reconcile" tabs and receipt cards, commit `a621f8a`) landed on `main` at the same time. **Luca chose the new design system**; Alice's Reconcile layout was dropped in the merge (still in history at `a621f8a` if wanted). Its behaviour was kept and restyled: the Rejected panel, the "matched · need you → Review" line, and "Nothing to chase" in Arrears.

---

## What works

Live production (mock on): **https://paper-trail-smoky.vercel.app**

Local: `npm install && npm run dev` → http://localhost:3000. Opens in **Live** (engine on `data/sample`, agent pass replayed from `results/`). Top-bar switch or `?mode=demo` for in-browser fixtures; `NEXT_PUBLIC_DEFAULT_MODE=demo` changes the default.

| Surface | Status |
|---|---|
| `/` Cash application | One-line stepper (Exact rules → Memory → Agent) with counts, "N matched · N need you → Review", Run allocation. Five KPI cards, 12px allocation bar with count + value legend, October memory banner (lime rule). 200-line virtualised table sorted by date, filters, search, detail drawer. Rejected panel (agent reasoning, controller reason, Return to review) when anything is rejected. |
| `/exceptions` | 380px queue grouped by review reason (56px two-line items), compact detail header, 40px allocation table + green Balances row, Why with 5-segment confidence meter, typed evidence cards (company lookup / tenant note first, full width), Approve / Reject with A/R/J/K keycaps, Remembered toast. Loading, empty, error states. |
| `/arrears` | Three KPI cards, open balances (expand for charges), Disputed pill with tooltip, Draft chaser (copy only) or "Nothing to chase", audit log. |
| Mock data | Deterministic Wharfside Quarter; featured T087 Harbour & Finch + T096 Kestrel Physio; October memory after September parent-payer approve. |
| Real API | Live mode uses `/api/*`. With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set (server only, never `NEXT_PUBLIC_`), routes read and write Supabase via `lib/supabase-store.ts`; `CASH_DB=0` forces the in-memory engine. Real API failures are logged and thrown, never silently mocked. |
| Grok Bot | MCP connector in `lib/mcp/` uses the same Supabase-backed store. Setup notes: `docs/grok-bot-credit-controller.md`. |
| Tests | `npm test` — 35 passed, 5 skipped. |

### Demo path (must stay green)

1. **Sep 2026** → **Run allocation** → 200 receipts, 90% auto-allocated, 20 need you.
2. **Exceptions** → **NORTHGATE HOSPITALITY GRP** (Harbour & Finch) or **PARENT GROUP 86** → read the company lookup → **Approve** → dark "Remembered" toast.
3. **Oct 2026** → **Run allocation** → "N receipts matched from memory — payers you approved last month."
4. **Arrears** → tenants still owing; Draft chaser copies, nothing sent.

Verified end to end on mock in a headless browser at 1440×900 and 1920×1080.

---

## Boundaries

- Own: `app/layout.tsx`, `app/page.tsx`, `app/exceptions`, `app/arrears`, `app/globals.css`, `components/**`, `lib/api.ts`, `lib/mock.ts`, `lib/store.tsx`, `lib/chaser.ts`, `lib/types.ts`, `lib/format.ts`, `DESIGN.md`, `.cursor/rules/**`.
- Do **not** edit: `app/api/**`, `lib/cash/**`, `data/**`.
- Do **not** commit: `data/private/`, `data/seed/`, `.env.local`, secrets.
- Do **not** show `case_type` or `true_allocations` in the UI.
- UI changes follow `DESIGN.md` §9 "Do not": no new colours, no shadows on cards, lime only for the active nav and memory moments, mono/sans split respected.
- Prefer working on **`main`** (Luca asked to stop branching for this hackathon). If your environment forces a branch, open a PR and merge it promptly — two sessions restyling in parallel caused the conflict above.

---

## Deploying (do this after every change Luca wants live)

Production: **https://paper-trail-smoky.vercel.app** — Vercel project `solarolo-technologies/paper-trail`, framework nextjs, not Git-linked (pushes do not deploy); deploy with `npx vercel deploy --prod --scope solarolo-technologies`.

GitHub pushes still **do not auto-deploy**. Two ways that work:

1. **Vercel CLI** from a local checkout: `npx vercel deploy --prod --scope solarolo-technologies`.
2. **Vercel connector (no CLI)**: create a deployment for project `paper-trail`, team slug `solarolo-technologies`, `target: production`, `gitSource: { type: "github", org: "thekashifnazir", repo: "paper-trail", ref: "main", sha: <main tip> }`. This worked for `f975e53`.

Gotcha: a deploy from a **non-`main` branch** builds but only gets a git-branch preview alias, not `paper-trail-smoky`. Deploy `main`. Confirm with the deployment's aliases (`paper-trail-smoky.vercel.app` should be listed).

---

## Remaining work (priority order)

1. **Record the demo** against production using the demo path above.
2. **First-load polish** — the mock generates 200×2 lines on the client; first paint shows skeleton rows briefly. Precompute if it shows on the recording.
3. **Alice** — chaser wording, review-reason labels, minutes-saved claim. Do not invent the minutes figure.
4. **Rejected reasons** are stored in `localStorage` only (`pt.rejectReasons`); persist via the API if it matters for the demo.
5. **Cut first if late** — audit log polish, editable chaser, property switcher (visual only today; one property).

---

## Files to open first

```
handoff.md                     ← you are here
DESIGN.md                      ← design system (tokens, type, screens, motion)
context.md                     ← product + engine contract
app/globals.css                ← every token
components/shared.tsx          ← Money, MethodBadge, meters, KpiCard, AllocationBar, EvidenceCard, states
components/AppShell.tsx        ← sidebar + top bar
components/run/*               ← Cash application (RunScreen, StatementCard stepper, KpiRow, LineTable, RejectedPanel, LineDrawer)
components/exceptions/*        ← ExceptionsScreen, QueuePane, DetailPane
components/arrears/ArrearsPage.tsx
lib/store.tsx, lib/api.ts, lib/mock.ts
```
