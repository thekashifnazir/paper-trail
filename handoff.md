# Handoff — Paper Trail front end

Paste this into the next coding agent. Owners: Luca and Alice. Hackathon code freeze 23:00; submission is a 2-minute screen recording.

Read `context.md` for product, data, and the real engine API. This file is the operational handoff: what exists, what is live, and what to do next.

---

## 0 — Do this first: the actual design

There is **no `DESIGN.md` yet**. The UI works, but it is a functional first pass (paper background, teal brand, Source Sans + Fraunces + IBM Plex Mono, method colours). It is not yet a deliberate credit-controller desk.

**Your first job is the design system, then apply it to the existing screens. Do not rebuild the product from scratch.**

### Write `DESIGN.md`

Research real cash-application / ledger UIs (HighRadius, BlackLine, Tesorio, Upflow, dense bank reconciliation tools). Commit to one calm, light, dense finance aesthetic that reads clearly at 1080p. Avoid purple gradients, card grids, and generic AI SaaS looks.

Specify precisely enough to implement:

1. **Audience and feeling** — credit controller plus judges on a 2-minute recording. Trusted ledger, not a startup dashboard.
2. **Typography** — named fonts (next/font or Google), sizes, weights. Body ≥ 15px. Tabular / mono numerals for money. Do not default to Inter / Roboto / Arial.
3. **Colour tokens in oklch** as CSS variables: paper, ink, muted, hairline, brand, danger, and method pairs (Exact grey, Memory teal, Agent orange, In queue amber) — always with a text label.
4. **Layout tokens** — sidebar width, exceptions queue 380px, 44px table rows, sticky headers, radii, almost no shadow.
5. **Shell** — sidebar + top bar contents (product name, month, Synthetic data, Reset, Exceptions queue count).
6. **Shared components** — anatomy for Money, MethodBadge, ConfidenceMeter, KpiCard, AllocationBar, EvidenceCard (most important: quotes must look quoted), EmptyState, Skeleton.
7. **Motion** — KPI count-up, allocation bar fill by segment, Pending → resolved in waves. Respect `prefers-reduced-motion`. No bounce.
8. **Copy patterns**
   - Toast: `Remembered: {PAYER} pays for {TENANT}` + `Next month this matches automatically.`
   - October banner: `{N} receipts matched from memory — payers you approved last month.`
9. **Audit log** — violet dot for agent, brand for human.
10. **What not to do** — so later agents do not drift.

Also save an always-applied Cursor rule at `.cursor/rules/design.mdc` that points agents at `DESIGN.md`.

### Then restyle the existing UI

Apply the tokens to:

- `app/globals.css`, `app/layout.tsx`
- `components/AppShell.tsx`, `components/shared.tsx`
- `components/RunPage.tsx`, `ExceptionsPage.tsx`, `ArrearsPage.tsx`

Do **not** rewrite mock data or the store unless the design needs a small presentation hook. Keep the demo flow intact.

---

## What already works

Live production (CLI deploy, mock on): **https://paper-trail-smoky.vercel.app**

Local: `npm run dev` → http://localhost:3000 (`NEXT_PUBLIC_USE_MOCK=1` in `.env.local`).

| Surface | Status |
|---|---|
| `/` Cash application | Run allocation, 3-stage progress, KPIs, method bar, 200-line table, filters, detail drawer with evidence |
| `/exceptions` | Queue grouped by review reason, ledger allocation, evidence grid, Approve / Reject, A/R/J/K, Remembered toast |
| `/arrears` | KPIs, table, disputed badge, draft chaser modal (copy only), audit log |
| Mock data | Deterministic Wharfside Quarter; featured T087 Harbour & Finch + T096 Kestrel Physio; October memory after September parent-payer approve |
| Engine | Still in repo: `lib/cash/**`, `app/api/**` — do not edit |

Repo: `https://github.com/thekashifnazir/paper-trail`  
`main` tip when this was written: `bb72b69` (UI + `.env.example`). Engine + MCP + sample data are already on `main`.

### Demo path (must stay green)

1. Month **2026-09** → **Run allocation** → see ~200 lines, mostly Exact.
2. **Exceptions** → open **NORTHGATE HOSPITALITY GRP** / Harbour & Finch → read evidence → **Approve** → Remembered toast.
3. Month **2026-10** → Run → memory callout for remembered payers.
4. **Arrears** → tenants still owing; Draft chaser copies, nothing sent.

---

## Boundaries

- Own: `app/layout.tsx`, `app/page.tsx`, `app/exceptions`, `app/arrears`, `app/globals.css`, `components/**`, `lib/api.ts`, `lib/mock.ts`, `lib/store.tsx`, `lib/chaser.ts`, `lib/types.ts`, `lib/format.ts`, `DESIGN.md`, `.cursor/rules/**`.
- Do **not** edit: `app/api/**`, `lib/cash/**`, `data/**`.
- Do **not** commit: `data/private/`, `data/seed/`, `.env.local`, secrets.
- Do **not** show `case_type` or `true_allocations` in the UI.
- Prefer working on **`main`** (Luca asked to stop branching for this hackathon). Deploy with Vercel CLI if Git is still wrong (see below).

---

## Vercel / Git gotchas (important)

1. The Vercel project `solarolo-technologies/paper-trail` was originally linked to **`lpoli6/paper-trail`** (empty “Created from vercel.com/new”). That caused production 404s.
2. That bad Git link was **disconnected**. Connecting **`thekashifnazir/paper-trail`** via CLI **failed** (Vercel GitHub app likely lacks access to that org). Production was fixed with **`vercel deploy --prod`** from the local tree.
3. Project is now set to **framework: nextjs**. `NEXT_PUBLIC_USE_MOCK=1` is set for Production / Preview / Development.
4. `vercel.json` may exist locally (framework nextjs) — commit it if not already on `main`.
5. Until Git is reconnected in the Vercel dashboard to `thekashifnazir/paper-trail`, **pushes to GitHub will not auto-deploy**. After UI changes: `npx vercel deploy --prod --scope solarolo-technologies`.
6. Production URL: **https://paper-trail-smoky.vercel.app**

---

## After design — remaining product work (priority order)

1. **Design pass** (section 0) — ship `DESIGN.md` + restyle. Redeploy.
2. **Polish the recording** — first-load mock can feel slow (generating 200×2 lines on the client); consider precomputing or deferring so the first paint is not “Loading statement…”.
3. **Wire real API (optional)** — `lib/api.ts` still has fictional `/api/lines` / `/api/summary` fallbacks. Real engine routes are in `context.md` (`/api/statements`, `/api/run`, `/api/exceptions`, `/api/allocations/:id/approve`, etc.). Keep mock as default for the demo.
4. **Alice** — chaser wording, review-reason labels, minutes-saved claim. Do not invent the minutes figure.
5. **Cut first if late** — keyboard shortcuts (already in), filter chips (already in), audit log polish, editable chaser.

---

## Files to open first

```
handoff.md          ← you are here
context.md          ← product + engine contract
components/RunPage.tsx
components/ExceptionsPage.tsx
components/ArrearsPage.tsx
components/shared.tsx
lib/mock.ts
lib/store.tsx
app/globals.css
```

## Done when

- `DESIGN.md` exists and the three screens match it at 1440×900 and 1920×1080.
- Demo path above still works on mock.
- Production redeployed and reachable at https://paper-trail-smoky.vercel.app.
