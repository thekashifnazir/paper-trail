# Paper Trail — agent context

Cash application for property management. Hackathon: Grok Bot Real Estate, London, 12 Nov 2026. Code freeze 23:00. The submission is a 2-minute screen recording.

Read this before editing. The GitHub repo is `thekashifnazir/paper-trail`.

## What the product does

Rent and service charge receipts arrive on the bank statement with bad references, a parent company paying, one payment for two invoices, or a short payment. Until each receipt is matched to a tenant charge, the arrears list is wrong.

Upload a statement. The engine allocates each line in three passes: exact rules, memory of past approvals, then an agent for the rest. Uncertain lines wait for a person, with evidence. An approval is remembered, so next month the same payer matches from memory. Output: an arrears list and chaser drafts. Nothing is sent to a tenant. Copy only.

## What the recording has to show

1. **Scale.** 200 lines allocated in seconds. Most never reach the agent.
2. **Trust.** One hard exception, with plain-English reasoning and quoted evidence, approved in one click.
3. **Learning.** October uploaded, and the payer just approved now matches from memory.

Every allocation on screen must show where it came from. Method colours, always with a text label: Exact grey, Memory teal, Agent orange, In queue amber. Light theme, dense, readable at 1080p. Body text 15px or more. Money is GBP, two decimals, right-aligned, tabular numerals.

## Where the code actually is

Local `main` has **no commits**. The working tree is an uncommitted `create-next-app` scaffold and is not a descendant of GitHub. Do not commit that scaffold as a new root of `main`. Do not let it replace `origin/main`.

| Branch | What is there |
|---|---|
| `origin/main` | README, `data/**`, `supabase/schema.sql`, the UI (`app/` pages, `components/**`, `lib/api.ts`, `lib/mock.ts`, `lib/chaser.ts`), the Grok Bot connector (`/api/mcp`), and the engine as of the last checkpoint merge. |
| `origin/engine` | `lib/cash/**` matching engine, `app/api/**` routes, `results/**`, vitest. Merged into `main` at the team checkpoints; between them it is ahead of `main`. |

Frontend work bases off `origin/main` and takes the engine from `origin/engine`. Own `app/(ui)/**`, `components/**`, `lib/api.ts`, `lib/mock.ts`, `lib/chaser.ts`. Do not edit `app/api/**`, `lib/cash/**`, or `data/**`.

`data/private/` and `data/seed/` are git-ignored Cortile files for the event only. Do not commit them. Do not tune on `data/sample/holdout/` (November). Demo months are `2026-09` and `2026-10`.

## Data to use

`data/sample/` is the dataset. 108 synthetic tenants, 432 charges (Sep and Oct), 200 bank lines per month. Fully made-up names. Regenerate only if asked:

```
python3 data/generate.py --cortile none --out data/sample
python3 data/check_seed.py --seed-dir data/sample
```

Bank CSV columns: `id`, `statement_month`, `date`, `amount`, `payer_name`, `reference`, `case_type`, `true_allocations`, `true_unallocated`. Amounts in the files are pounds.

`case_type`, `true_allocations`, and `true_unallocated` are the answer key. The schema says `case_type` is never sent to the engine. Do not show the answer key in the product UI. Use it to build mocks and to score.

Each month, by `case_type`:

| Case | Lines | Settled by |
|---|---|---|
| clean | 170 | Pass 1, exact |
| bad_reference | 5 | Pass 1, name and sum |
| combined | 5 | Pass 1, name and sum |
| duplicate | 2 | Duplicate guard |
| parent_payer | 8 | Agent, then a person if unsure |
| short_pay | 5 | Agent |
| overpayment | 3 | Agent |
| unidentifiable | 2 | Agent |

`tenants.json` fields: `id` (T001–T108), `name`, `unit`, `lease_id`, `lease_citation`.

`charges.json` fields: `id` (same as `invoice_ref`, e.g. `INV-2609-001-R`), `tenant_id`, `type` (`rent` or `service_charge`), `period`, `amount_due`, `amount_paid`, `due_date`, `invoice_ref`.

`tenant_notes.json`: `{ tenant_id, date, note }`. These are disputes, mostly a withheld slice of service charge. A chaser lists disputed amounts separately and does not demand them.

`company_lookup.json`: `{ payer_name, group_members, source }`. Parent companies paying for a subsidiary. October should match those payers from memory after a September approval.

## Engine contract

Engine code is `lib/cash` on `origin/engine`. Money inside the engine is integer pence. The API speaks pounds, often as decimal strings. Do not do float arithmetic on money. Format for display; keep sums in pence until the edge.

State is in memory in `lib/cash/service.ts`. Payer memory (`payer_aliases`) and the audit log (`audit_log`) are also saved to Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, and payer memory is read back on the first request after a restart (`lib/cash/persist.ts`, 04275be). `CASH_PERSIST=0` turns that off. `POST /api/reset` clears both. Writes take header `x-actor: grok_bot | human | system`.

| Call | Behaviour |
|---|---|
| `POST /api/statements` | CSV text, `{ bank_lines }`, or `{ csv }`. Returns `{ received, added, skipped_known, total_lines }`. |
| `POST /api/run` | Without `?month`: pass 1 and pass 2 on every open line. Returns `{ lines_exact, lines_memory, left_open }`. With `?month`, see the UI routes below. |
| `POST /api/agent?month=` | Pass 3 live: Jev (TypeSafe, `TYPESAFE_API_KEY`) first, then Grok (`XAI_API_KEY`, `grok-4.7`) on the lines Jev is unsure of; `PASS3_MODE=grok` skips Jev. `?concurrency=` (default 20), `?replay=results/<month>.json` to replay instead. Each answer goes through the same checks as `/api/proposals`. |
| `GET /api/exceptions` | Open lines with up to 15 candidates, earlier identical lines, relevant tenants, aliases, and `waiting_for_approval` (each item is an explain payload). |
| `POST /api/proposals` | Pass 3. Body: `{ bank_line_id, allocations: [{ charge_id, amount }], unallocated_amount, confidence, reasoning, evidence }`. 422 if the sum or a charge id is wrong. It stays `proposed` (waits for a person) when confidence is under 0.7, when an evidence quote isn't found in the source it names, or when the payer isn't the tenant and isn't yet in payer memory. No allocations holds the line open. |
| `POST /api/allocations/:id/approve` and `/reject` | `:id` is a bank line id or an allocation id. Approve can learn a payer alias when the payer is not the tenant. |
| `GET /api/allocations/:id/explain` | Bank line, state, allocations, unallocated, reasoning, evidence, who decided, audit trail. |
| `GET /api/arrears` | `{ tenants, total_open, arrears }`. Default sort oldest due. `?sort=amount` for most money first. |
| `GET /api/metrics` | Counts by method, `auto_match_rate`, held, waiting. `against_truth` only when a truth file is loaded. |

Evidence on the wire: `{ type: "bank_line" \| "charge" \| "tenant" \| "note" \| "lease" \| "alias", ref, quote }`. The UI routes rename `note` to `tenant_note` and `tenant` to `company_lookup`.

Grok Bot reaches the engine through `/api/mcp` (also `/api/mcp/<token>`): `run_month`, `list_exceptions`, `propose_allocation`, `explain_line`, `arrears`, `summary`, and for review `list_review_queue` and `review_line` (9c39a7b). Grok Bot can recommend, never approve.

The UI calls these routes (`lib/api.ts` with mock mode off). They are the contract between the UI and the engine: thin adapters over the same service, in the shapes of `lib/types.ts` (Joel, 12 Nov: the engine side adapts, the UI files stay as they are):

| Call | Behaviour |
|---|---|
| `POST /api/run?month=2026-09` | Loads that month's statement from `data/sample` if not loaded, runs passes 1 and 2, then pass 3 replayed from `results/<month>.json` (the saved real run of Jev then grok-4.7; instant, needs no key) when that file exists. Returns `RunSummary` plus `lines_exact`, `lines_memory`, `left_open` and `agent`. Live pass 3 is `POST /api/agent`. |
| `GET /api/lines?month=` | `LineView[]`. The queue is `status: "proposed"`. `review_reason` is one of the UI's labels: "New payer relationship" (payer isn't the tenant and not yet in payer memory), "Possible duplicate payment", "Unidentified receipt", "Overpayment", "Short payment", "Low confidence" (also used when an evidence quote isn't found). |
| `GET /api/summary?month=` | `RunSummary`; `score` only where the answer key covers the lines. |
| `POST /api/lines/:id/approve` and `/reject` | Approve returns `{ remembered: "Remembered: {payer} pays for {tenant}" }` when it teaches a payer. Approving a line with nothing allocated (duplicate, unidentified) confirms leaving it open. |
| `GET /api/audit` | `AuditRow[]`, newest first. |

`GET /api/arrears` also carries the UI's `ArrearsRow` fields (`outstanding`, `oldest_due_date`, `days_overdue`, `disputed`, `dispute_note`, `lease_citation`, `open_charges`) next to the original ones the Grok Bot connector reads. `NEXT_PUBLIC_USE_MOCK=1` may serve fixtures shaped like these responses, built from `data/sample`, so the screens work before the engine is merged. Do not invent a second portfolio.

Approving a parent-company line should toast: `Remembered: {payer_name} pays for {tenant_name}`.

## UI still to build

One page. Header: product name, month `2026-09` / `2026-10`, a "Synthetic data" label, Reset.

- **Run.** Upload, Run with visible progress, summary (lines, value, Exact / Memory / Agent / In queue, auto-match rate and precision when metrics include them), table, filter chips. October shows how many lines matched from memory.
- **Exceptions.** Queue of lines waiting for a person. Detail, top to bottom: bank line, proposed allocation (rows total the receipt, plus Unallocated if needed), method, confidence, reasoning, evidence quotes, Approve and Reject. Shortcuts A, R, J, K are optional.
- **Arrears.** Tenant, unit, outstanding, oldest due date, days overdue, Disputed with the note on hover. Draft chaser from `lib/chaser.ts`, editable, copy button, nothing sent. Audit log underneath.

Empty, loading, and error states on every panel. No dead buttons.

Alice owns the words: chaser template, review-reason labels, evidence a credit controller needs, and the minutes-saved assumption (minutes per line matched by hand, times lines the engine settled). Do not invent that minutes figure. The README cites an APQC median of 45% of receipts auto-applied, across 851 companies, via creditpulse.com. Do not present pending score cells in the README as results.

## Demo order

September run, then one parent-payer exception approved, then October, where that payer is memory. Arrears last.

Must be on screen: run summary, exception with evidence, Remembered toast, memory on October, arrears table. Cut first if late: keyboard shortcuts, filter chips, audit log, editable chaser.
