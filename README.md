# Paper Trail: Cash Application Agent

Built at the Grok Bot Real Estate Hackathon London, 12 Nov 2026, Track 4 (operations and property management).

You upload a bank statement and each receipt gets allocated to the right tenant charge, with evidence. Lines the agent isn't sure about go to a one-click exceptions queue. When a person approves one, that payer is remembered for next month. The output is an arrears list you can trust, chaser drafts and an audit log.

Commercial leases are more complicated, so matching payments takes judgement and slows people down: a parent company pays for its tenant, or a tenant holds back disputed service charge. A payment that looks wrong is often right.

<p align="center">
  <a href="https://youtu.be/evdDjT1mR58"><img src="docs/media/demo-preview.gif" width="720" alt="Silent preview: September's statement runs, 188 of 200 receipts are allocated automatically and 12 go to a person"></a>
  <br>
  <a href="https://youtu.be/evdDjT1mR58"><b>▶ Watch the 2-minute demo</b></a> · <sub>silent preview above</sub>
</p>

## The problem it solves

A property manager's arrears list is only as good as the cash allocation behind it. Receipts arrive with wrong or missing references, one transfer covering several invoices, a parent company paying for its tenant, or a short payment because the tenant is disputing part of the service charge. Until someone matches each line by hand against the ledger, the lease and old emails, the arrears list is wrong: tenants who paid get chased, and real arrears hide in unallocated cash.

Paper Trail takes that matching off the person and keeps them for the judgement calls only:

- **Most lines never need a person.** On our synthetic test set, 188 of 200 lines in September and 196 of 200 in October were allocated automatically, with 0 wrong.
- **Every allocation shows its evidence,** so a credit controller can check it in seconds instead of redoing it.
- **It learns.** Approve a parent-company payer once and next month it matches from memory.
- **It won't guess.** Duplicates and unidentifiable payments stay with a person, and a model can't approve anything.

## Architecture

![Paper Trail architecture: bank lines go through rules, payer memory and grok-4.7, Grok Bot reviews the unsure lines over MCP, a person approves, and Supabase keeps payer memory and the audit log](docs/architecture.png)


## For judges: where to look

| Criterion | What to look at |
|---|---|
| Relevance to a real estate problem | Until cash is allocated, the arrears list is wrong. The test data has the cases that need judgement every month: 8 parent-company payers, 5 combined payments, 5 short payments with service charge withheld, 3 overpayments, 2 duplicates, 2 unidentifiable (`data/sample/`). |
| Quality of execution | `npm test` (vitest). Money is integer pence inside the engine (`lib/cash/money.ts`); a proposal a penny out is refused (`lib/cash/checkSum.ts`). Results below are reproducible with `PASS3_MODE=grok npx tsx scripts/pass3.ts --save`. |
| Effective use of Grok Bot | Grok Bot connects to the app through our MCP connector (`lib/mcp/handler.ts`) with 9 tools: `run_month`, `summary`, `list_exceptions`, `list_review_queue`, `review_line`, `propose_allocation`, `explain_line`, `arrears`, `draft_chasers`. It reviews the lines waiting for a person and recommends with quotes; it can't approve. Bot setup: `docs/grok-bot-credit-controller.md`. |
| Effective use of Cursor | The code was AI-generated under our direction in Cursor, which also reads our Supabase tables through its Supabase connector. |
| Traceable data | Every allocation carries evidence quotes (bank line, charge, lease, company lookup, tenant note) and every quote is checked against its source, so a made-up quote sends the line to a person. Per-line output with reasoning and evidence: `results/2026-09.json`, `results/2026-10.json`. Every decision is in the audit log, with who made it (`human`, `grok_bot`, `system`). |
| Practical usefulness | An arrears list a manager can act on, chaser drafts that hold back disputed amounts, and payer memory in Supabase, so next month's parent-company payments match without anyone. |

## Results

All numbers come from the synthetic test data described below, where we tuned on September and October. November is a hold-out and gets scored once, at the end.

| Month | Lines | Auto-approved | Precision of approved | Wrong allocations | To a person |
|---|---|---|---|---|---|
| 2026-09 (tuning) | 200 | 188 (94%) | 100.0% | 0 | 12 |
| 2026-10 (tuning, from memory) | 200 | 196 (98%) | 100.0% | 0 | 4 |
| 2026-11 (hold-out, scored once, 22:20) | 200 | 196 (98%) | 100.0% | 0 | 4 |

Pass 3: grok-4.7 on the xAI API, concurrency 20. An earlier run with Jev (TypeSafe) first, then grok-4.7, gave the same September and October figures in 134 s. A payer that isn't the tenant and isn't yet in payer memory always goes to a person, however confident the model is. So in September the 8 parent-company payments wait for approval, alongside 2 duplicates and 2 unidentifiable payers. In October the 8 parent payers, approved in September, match from memory, and the 4 lines to a person are the 2 duplicates and 2 unidentifiable payers. Leaving those 4 open is the right answer. With grok-4.20 non-reasoning in place of grok-4.7, 8 allocations were wrong. Per-line output: `results/2026-09.json`, `results/2026-10.json` are a grok-4.7-only run (same figures, 0 wrong, 108 evidence quotes checked, 0 not found), which the app replays; reproduced by `PASS3_MODE=grok npx tsx scripts/pass3.ts --save` (an approval is simulated between the months: a person approves the queued lines that are right). November was scored once with `npx tsx scripts/pass3.ts --holdout`: September and October run first, so November starts with their payer memory. All 8 parent payers matched from memory; the 4 lines to a person are 2 duplicates and 2 unidentifiable payers; 133 evidence quotes checked, 0 not found in their source; 205 s for the three months.

For context, the APQC benchmark puts the median at 45% of receipts auto-applied, across 851 companies (as cited by creditpulse.com).

## Live demo (about 90 seconds)

Reset first (`POST /api/reset`), so September isn't already loaded.

| Step | In the app | Say |
|---|---|---|
| 1 | Run September | "200 bank lines. 188 matched automatically, 0 wrong. 12 need me." |
| 2 | Review 12, open a parent payer (e.g. PREMIER GROUP PLC) | "A group company pays for its tenant. It's a new payer, so a person approves it the first time. The evidence is the lease and the group lookup." |
| 3 | Approve. The toast reads "Remembered: PREMIER GROUP PLC → ..." | "Now it remembers." |
| 4 | Approve the other parent payers: 8 lines from 4 groups, two lines each | |
| 5 | Show the 4 left: 2 duplicates, 2 unidentifiable | "These you should always look at yourself. No guess." |
| 6 | Run October | "196 matched, 8 of them from memory. 4 need me, and those are the right 4." |
| 7 | | "We held out November and scored it once at the end: 98%, 0 wrong." |

Approve all 8 before you run October. Lines you didn't approve don't go into memory, and October will show more than 4. Checked through the API on 12 Nov, 22:30: after the 8 approvals, October showed 8 from memory and 4 in the queue.

## How it works

1. **Pass 1, code.** Exact reference and amount, then a duplicate guard, then payer name plus a subset sum over that tenant's open charges.
2. **Pass 2, memory.** Payer aliases learned from earlier approvals.
3. **Pass 3, agent.** Grok proposes a split with evidence and code checks that it adds up.
4. **Exceptions.** Anything low confidence goes to a person. Approving creates an alias, so next month the line matches in pass 2.

Stack: Next.js (App Router) and TypeScript, Supabase (Postgres) for payer memory and the audit log, the xAI API (grok-4.7) for pass 3. Grok Bot reviews the queue, explains allocations and drafts chasers through our MCP connector.

## Setup

You'll need a Supabase project. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, which is git-ignored, and never commit it. Then run `supabase/schema.sql` in the Supabase SQL editor and load the public sample:

```
python3 data/load_supabase.py --dir data/sample --with-bank
```

Re-running is safe because rows are upserted on their primary key.

## Test data

`data/sample/` is committed and safe to share, because it was made with fully made-up company names:

```
python3 data/generate.py --cortile none --out data/sample
python3 data/check_seed.py --seed-dir data/sample   # 78 checks
```

| File | What's in it |
|---|---|
| `tenants.json` | 108 tenants, each with a unit and a synthetic lease |
| `charges.json` | 432 rent and service charges, Sep and Oct 2026 |
| `bank_2026_09.csv`, `bank_2026_10.csv` | 200 bank lines each, with the answer key in `true_allocations` and `true_unallocated` |
| `tenant_notes.json` | Dispute history, e.g. service charge withheld over a broken lift |
| `company_lookup.json` | Stub lookup of parent companies paying for a tenant |
| `holdout/` | November: charges, 200 bank lines, notes. Don't tune on it |

Each month's 200 lines break down by `case_type` like this:

| Case | Lines | Settled by |
|---|---|---|
| clean | 170 | Pass 1 |
| bad_reference | 5 | Pass 1 (name and sum) |
| combined | 5 | Pass 1 (name and sum) |
| duplicate | 2 | Duplicate guard |
| parent_payer | 8 | Agent |
| short_pay | 5 | Agent |
| overpayment | 3 | Agent |
| unidentifiable | 2 | Agent |

### Cortile data stays local

The generator can also build on Cortile's synthetic portfolio (real unit names and lease ids) if you've claimed it in the event Discord. That output goes to `data/seed/` and the Cortile files go in `data/private/`. Both are git-ignored, because the licence is for this event only and doesn't allow committing it. Please keep it that way:

```
python3 data/generate.py          # reads data/private/cortile-hackathon.sqlite
python3 data/check_seed.py        # checks data/seed/
```

## Team

Two builders (matching engine and agent; app, database and memory), a finance lead (domain checks, chaser wording, time saved) and a data and demo lead. Code is AI-generated under our direction, using Cursor.
