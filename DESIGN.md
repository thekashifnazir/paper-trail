# Paper Trail — Design System

An operations product for credit controllers: the density and restraint of a modern fintech back office, built for a 2-minute recording at 1440×900 and 1920×1080. Light canvas, dark sidebar, ink actions, method colour only where it carries meaning.

Every colour lives in `app/globals.css` as a CSS variable mapped into Tailwind via `@theme`. No hex values in components.

---

## 1. Tokens

### Surfaces and text

| Token | Value | Tailwind | Use |
|---|---|---|---|
| `--canvas` | `#F7F7F5` | `bg-canvas` | Page background, hover, selected rows, table sub-headers |
| `--surface` | `#FFFFFF` | `bg-surface` | Cards, tables, top bar |
| `--line` | `#E7E5E0` | `border-line` | Every 1px border and row hairline |
| `--ink` | `#111312` | `text-ink`, `bg-ink` | Body text, primary button, selected rule |
| `--muted` | `#6B7270` | `text-muted` | Secondary text, labels |
| `--quote` | `#FAFAF8` | `bg-quote` | Evidence quote block |

### Sidebar

| Token | Value |
|---|---|
| `--side` | `#0F1211` |
| `--side-ink` | `#E7EAE8` |
| `--side-muted` | `#8A918E` |
| `--side-active` | `#1C2220` |

### Highlight

`--lime` `#C8F250` — **only** the active nav indicator and "matched from memory" moments (October banner rule, Remembered toast). Nowhere else.

### Method pairs (text / tint)

Always shown with a word label, never as colour alone.

| Method | Text | Tint |
|---|---|---|
| Exact | `#52525B` | `#F4F4F5` |
| Memory | `#0F7B55` | `#E3F6EC` |
| Agent | `#5B3FE0` | `#EEEAFE` |
| In queue | `#A15C07` | `#FEF3D6` |
| Risk | `#B42318` | `#FEE4E2` |

Tailwind: `text-exact bg-exact-tint`, `text-memory bg-memory-tint`, `text-agent bg-agent-tint`, `text-queue bg-queue-tint`, `text-risk bg-risk-tint`.

### Actions and shape

- Primary button: `bg-ink text-surface`. Approve: `bg-approve` (`#0F7B55`). Secondary/ghost: `border-line bg-surface`.
- Radius 8px on cards, buttons and inputs; 6px on badges and small controls.
- 1px borders. **No shadows** except popovers and toasts (`--shadow-pop`).

### Layout

| Token | Value |
|---|---|
| `--sidebar-w` | 232px |
| `--topbar-h` | 52px |
| Page gutter | 24px horizontal, 20px vertical |
| Exceptions queue | 380px |
| Run table rows | 44px |
| Exceptions allocation rows | 40px |
| Queue items | 56px |

---

## 2. Type rule

**Raw bank data is Geist Mono. Everything we produce is Geist Sans.**

| Mono (`.mono` / `.money`) | Sans |
|---|---|
| Payer names, references, amounts, invoice/charge ids, dates in tables, evidence quotes, counts | Tenant names, labels, headings, reasoning, buttons, hints |

| Role | Spec |
|---|---|
| Body | Sans 14px / 1.45 |
| Labels and table headers | `.label` — 12px, 500, uppercase, 0.04em tracking, muted |
| Payer in tables and queue | Mono 13px / 500 (never bold display text) |
| KPI figures and detail amount | Mono 32px, −0.03em |
| Reasoning (exceptions) | Sans 16px / 1.55 |

**Money:** one formatter, `gbp()` in `lib/format.ts`, wrapped by `<Money>` in `components/shared.tsx`: `£` + thousands separators + two decimals. Free text that contains raw amounts (evidence quotes, reasoning) passes through `moneyText()` so `£5341.19` renders as `£5,341.19`.

---

## 3. Shell (`components/AppShell.tsx`)

**Sidebar** — dark, 232px, full height, sticky.
- Logo mark (24px rounded square, side-ink) + "Paper Trail" 15px semibold.
- Property row: building icon, "Wharfside Quarter", chevrons, 1px `side-active` border.
- "Workspace" label, then nav with lucide icons: Cash application, Exceptions, Arrears. 32px items, 6px radius. Active: `side-active` background and a 2px lime indicator on the left edge.
- Exceptions shows the queue count as an amber pill (`queue-tint` / `queue`, mono).
- "Synthetic data" pill pinned to the bottom.

**Top bar** — 52px, white, hairline bottom. Page title, divider, month segmented control (Sep 2026 / Oct 2026), Reset on the right. No native `<select>`.

---

## 4. Cash application (`components/run/*`)

1. **Stepper row** (one line, 56px): Statement month · Exact rules → Memory → Agent · Upload CSV (before first run) · Run allocation. Dots: hollow (future), ink ring (running), method colour + mono count (done). The row accepts a dropped CSV before the first run.
2. **KPI row**: five equal cards, identical anatomy — label, 32px mono figure, one line of context.
   - Receipts · `£… received`
   - Auto-allocated · `90%` · `180 of 200, no human touch`
   - In queue · `£… awaiting review`
   - Unallocated value · figure in `text-risk` at full size · `Across N receipts`
   - Precision · `N wrong allocations`
   Before a run, figures show `—` with a muted hint.
3. **Allocation bar**: 12px, rounded, 2px gaps, four method colours. Legend: label, count, value.
4. **October banner** (memory moment): white card, 3px lime left rule, `{N} receipts matched from memory — payers you approved last month.`
5. **Table**: sticky label header, 44px rows, hairline row borders, hover `bg-canvas`, no zebra, sorted by date.
   Columns: Date · Payer · Reference · Allocated to (tenant over invoice id in mono muted, id never truncated) · Method (badge, plus a confidence meter only below 100%) · Amount (right-aligned, last).
   No status column; queued and rejected lines say so in the badge.

---

## 5. Exceptions (`components/exceptions/*`)

**Queue (380px)** — header with count and total; sticky group labels on `bg-canvas`. Items are 56px, two lines: payer + amount; reference + confidence %. No bars. Selected: `bg-canvas` + 2px ink left rule.

**Detail header** — one row: payer (mono 17px) over reference · date on the left; review-reason pill and amount (mono 32px) on the right.

**Proposed allocation** — fixed-column table, 40px rows: Tenant (+ unit) · Charge id (+ type · period) · Before · Allocated · After. Below it a 32px check row on `memory-tint`: `Balances: £X allocated of £Y received` (risk tint and warning icon when it does not balance).

**Why** — method badge, 5-segment confidence meter (violet for Agent, ink otherwise) with the percentage, then reasoning at 16px.

**Evidence** — two-column grid. Each card: 1px border, 3px left rule and icon by type, 12px uppercase type label, quote in mono on `bg-quote`, source reference in muted text beneath.

| Type | Rule / icon colour | Icon |
|---|---|---|
| Company lookup, alias | Agent violet | Building / link |
| Tenant note | Queue amber | Sticky note |
| Charge, lease, rule | Exact grey | Receipt / file / list |
| Bank line | Ink | Landmark |

Company lookups, aliases and tenant notes sort first and span both columns — they are the decisive evidence.

**Action bar** (56px): Approve (green, `A` keycap) · Reject (ghost, `R` keycap) · `J` `K` next / previous on the right.

---

## 6. Arrears (`components/arrears/ArrearsPage.tsx`)

Three KPI cards (same anatomy), open balances table with label headers and mono money, Disputed in `queue` tint, audit log with violet dot for agent/system actors and ink dot for humans. Chaser dialog: hairline, no shadow, evidence cards as citations.

---

## 7. Motion

Framer Motion, 150–250ms, ease-out. `MotionConfig reducedMotion="user"` in the shell; hooks also check `useReducedMotion`.

| Moment | Motion |
|---|---|
| Run | KPI figures count up (250ms); bar segments fill from 0 (250ms) |
| Approve / reject | Queue item slides left and fades (160ms), then the row collapses (150ms) |
| Remembered | Toast on sidebar dark, 3px lime left rule, lime icon. Copy: `Remembered: {PAYER} pays for {TENANT}` / `Next month this matches automatically.` |

Nothing else animates: no hover transitions, no pulsing skeletons, no row flashes.

---

## 8. States

Every panel has loading, empty and error states.
- Loading: static `<Skeleton>` rows (not animated).
- Empty: `<EmptyState>` — dashed hairline card, 15px title, muted body, optional action.
- Error: `<ErrorNote>` — risk tint, message, Retry.

---

## 9. Do not

- Hard-code colours in components, or introduce a colour outside §1.
- Use lime outside the active nav indicator and memory moments.
- Set payer names, references or amounts in sans, or tenant names and reasoning in mono.
- Format money any way other than `gbp()` / `<Money>` / `moneyText()`.
- Add shadows to cards, zebra-stripe tables, or colour whole rows by method.
- Show a confidence meter at 100%.
- Show `case_type` or `true_allocations`.
- Add floating buttons or new routes.
