# Paper Trail — Design System

Cool white ledger desk. Credit-controller tool for a 2-minute demo: dense, calm, checkable. Not a startup dashboard.

**Sources:** ElevenLabs product chrome (ink CTAs, hairline sheets, cool white) + Anthropic restraint (clay as Agent spark, cited evidence) + Payment Allocation Tool UI mockup (split reconcile workspace, KPI strip, underline tabs). Hard product constraints win over mockup IA.

---

## 1. Audience and feeling

- **Users:** credit controllers allocating bank receipts; judges watching a recording.
- **Feeling:** trusted ledger on a cool white sheet — black figures, hairline rules, method colour only in badges/bars, clay wherever the agent touched a line.
- **Density:** legible at 1080p with ~200 table rows. Prefer rules and type hierarchy over cards and shadows.

---

## 2. Typography

| Role | Spec |
|---|---|
| UI / body / nav / tables | **Geist Sans** (`geist/font/sans`) — 15px / 400, line-height 1.45 |
| Product name / page titles | Geist 22–28px / 500 / letter-spacing −0.02em (**no serif**) |
| Labels / badges / thead | Geist 12px / 500 / +0.04em, **sentence case** (avoid shouty uppercase where possible) |
| Money / refs / citation sources | **IBM Plex Mono** — tabular-nums, right-aligned GBP |

Do not use Inter, Fraunces, Waldenburg, Source Sans, or Anthropic marketing serif.

---

## 3. Colour tokens (oklch → CSS vars)

```css
--paper:        oklch(0.976 0.001 106); /* cool canvas */
--sheet:        oklch(1 0 0);           /* tables, sidebar, drawers */
--ink:          oklch(0.191 0.002 107);
--muted:        oklch(0.538 0.008 97);
--hairline:     oklch(0.918 0.004 107); /* was --line */
--fill:         oklch(0.964 0.003 106); /* hover, active nav, sticky header */

--brand:        var(--ink);             /* primary CTA = ink fill, paper text */
--brand-wash:   var(--fill);

--danger:       oklch(0.505 0.19 27);
--danger-wash:  oklch(0.96 0.02 25);

--exact:        oklch(0.45 0.01 100);   /* stone */
--exact-wash:   oklch(0.96 0.005 100);
--memory:       oklch(0.45 0.08 180);   /* quiet teal */
--memory-wash:  oklch(0.95 0.03 180);
--agent:        oklch(0.62 0.12 55);    /* Anthropic clay — not violet */
--agent-wash:   oklch(0.95 0.04 70);
--queue:        oklch(0.55 0.14 70);    /* amber */
--queue-wash:   oklch(0.96 0.05 90);
```

Map legacy `--line` → `--hairline`, `--panel` → `--sheet`. Prefer Tailwind `border-hairline`, `bg-sheet`, `bg-fill`.

**Method colours always pair with a text label** (Exact / Memory / Agent / In queue). Never colour a whole row.

---

## 4. Layout tokens

| Token | Value |
|---|---|
| Sidebar | 220–224px, `--sheet` + right hairline |
| Top bar | sticky ~48px |
| Exceptions queue | **380px** |
| Table rows | **44px** (`h-11`) |
| Sticky headers | background `--fill` |
| Radii | controls **8px**, sheets **12px**, badges **pill** |
| Shadow | **almost none** — drawers/modals use hairline + dim overlay, not `shadow-xl` |

---

## 5. Shell

**Sidebar (left)**
- Product name **Paper Trail** (Geist 22–24 / 500) — brand-level signal
- Subline: `Cash application · Wharfside Quarter` (muted 13px)
- Nav: Cash application / Exceptions / Arrears
- Active nav: `--fill` background, 8px radius, **ink text** (not teal wash)
- Exceptions badge: queue count in `--queue-wash` / `--queue`

**Top bar**
- Statement month select
- `Synthetic data` chip (hairline border, muted)
- Reset (secondary outline)
- Optional: queue count mirror on Exceptions route only if already present — do not invent new chrome

**Adaptation from mockup:** mockup uses a dark navy top nav + horizontal IA (Reconcile / Suspense / Rules / Audit). We keep the existing **light sidebar + three routes**. Do not add navy chrome or new routes.

---

## 6. Shared components

### Money
- IBM Plex Mono, tabular-nums, right-aligned
- Optional muted `£` prefix is fine if the formatter already includes it
- Negatives / unallocated danger → `--danger`

### MethodBadge
- Wash + darker text; **full word** always: Exact / Memory / Agent / Human / In queue / Pending
- Pill or 8px radius; never colour the whole row
- Queue when `status === "proposed"`

### ConfidenceMeter
- 4px track `--hairline`, fill `--ink`
- Mono % label muted

### KpiCard → metric strip
- Keep API (`label`, `value`, `hint`, `accent`)
- Visual: **single bordered strip** — cells separated by vertical hairlines, not a 4-card grid
- Label: 12px sentence case muted; value: 22px Geist medium / Money mono
- Accent = left rule or bottom hairline tint (amber/red/memory), not a loud border box

### AllocationBar
- Segment colours only (exact / memory / agent / queue)
- Legend outside the bar

### EvidenceCard (signature)
- Cited passage: **2px ink left rule**
- Quote upright (not italic) in curly quotes: `“…”`
- Mono source line: type + `ref` (no teal type chip)
- Sheet background, hairline outer optional

### EmptyState / Skeleton
- EmptyState: Geist title, dashed hairline box, muted body
- Skeleton: minimal pulse rows on `--fill` / `--hairline` (add if missing)

### Primary / secondary buttons
- Primary: `--ink` fill, `--paper` text, 8px radius
- Secondary: hairline border, transparent/sheet, ink text
- Ghost links: ink underline or muted hover fill

---

## 7. Motion

- KPI count-up on settle (subtle)
- Allocation bar fill by segment
- Pending → resolved in waves after Run
- Respect `prefers-reduced-motion: reduce` — no bounce, no ornamental spring

---

## 8. Copy patterns (do not change wording)

- Toast: `Remembered: {PAYER} pays for {TENANT}` + description `Next month this matches automatically.`
- October banner: `{N} receipts matched from memory — payers you approved last month.`
  - Restyle: **sheet + left `--memory` rule** (not ink+lime bar)

---

## 9. Audit log

- Agent actions: `--agent` clay dot
- Human actions: `--ink` dot
- Mono timestamp + object id; sentence-case action text
- **Intentional change from handoff’s violet** — clay replaces violet

---

## 10. What not to do

- Cream / warm paper (`#f4f1ea`), Fraunces / display serif, teal as brand chrome
- Purple / violet accents, gradient orbs, glow
- Inter / Roboto / Arial defaults
- Card grids for KPIs; zebra striping; heavy shadows
- Colouring entire table rows by method
- Showing `case_type` or `true_allocations`
- Rebuilding product flow, mock store, or inventing routes to match mockup IA
- Navy marketing header as the live shell (mockup-only cue — adapted away)

---

## Screen mapping (mockup → Paper Trail)

Mockup is a single **Reconcile** workspace. Map structure onto existing screens; do not rename routes.

### Cash application (`RunPage`) ← mockup Reconcile list + filters

| Mockup | Paper Trail |
|---|---|
| KPI cards (balance / allocated / lines) | Metric **strip** via `KpiCard` (Receipts, Auto-allocated, In queue, Unallocated) |
| Underline tabs (Reconcile / Auto-reconciled / …) | Underline filter tabs: All / Exact / Memory / Agent / In queue |
| Filter row + search | Keep search; underline tabs replace pill chips |
| Statement↔Match split cards | Keep dense **table** of 200 lines (demo density); row click → detail drawer |
| OK / Enter confirm | Run allocation primary; approve lives on Exceptions |
| “Why this match” + Balanced footer | Drawer: reasoning + EvidenceCards + allocations |
| Reference clay chips | Optional later; method badge + EvidenceCard carry the agent cue |

Progress stages (Exact → Memory → Agent): hairline pills; active = ink underline or `--fill`, not teal wash.

October memory banner: sheet + memory left rule (see §8).

### Exceptions (`ExceptionsPage`) ← mockup Match panel + Suspense queue

| Mockup | Paper Trail |
|---|---|
| Left queue of open lines | **380px** grouped queue (review reason headers sticky on `--fill`) |
| Match panel + charge table | Detail: proposed allocation table, balance check, reasoning |
| Evidence / why | EvidenceCard grid — cited passages |
| OK / Suspense actions | Approve / Reject (ink primary / hairline secondary); shortcuts A/R/J/K |
| Balanced pill | Keep green/check balance affordance if already present — mute to ink/muted if it fights palette |

Selected queue row: ink left rule + `--fill` (not brand-wash teal).

### Arrears (`ArrearsPage`) ← mockup Audit + held-back amounts

| Mockup | Paper Trail |
|---|---|
| Audit log nav item | Audit section on Arrears (clay/ink dots) |
| Suspense / held items | Disputed badge (`queue` wash) + held-back KPI |
| Dense open-charge list | Expandable tenant rows; Draft chaser modal (hairline, no shadow-xl) |

---

## Implementation checklist

1. `app/globals.css` — tokens above; `@theme` maps for Tailwind
2. `app/layout.tsx` — Geist Sans + IBM Plex Mono; Sonner toward ink (drop loud `richColors` if it fights)
3. `components/shared.tsx` — Money, badges, meter, KPI strip, EvidenceCard, EmptyState, Skeleton
4. `components/AppShell.tsx` — sidebar/top bar per §5
5. Surgical class updates: `RunPage`, `ExceptionsPage`, `ArrearsPage`
6. Verify demo path; no edits to `app/api/**`, `lib/cash/**`, `data/**`

---

## Done when

Three screens match this file at ~1440×900: cool paper, ink CTAs, hairlines, method labels with colour, EvidenceCard as quoted citation, KPI strip, underline filters on Run, clay audit dots for agent.
