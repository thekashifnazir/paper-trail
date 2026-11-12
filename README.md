# Paper Trail: Cash Application Agent

Built at the Grok Bot Real Estate Hackathon London, 12 Nov 2026, Track 4 (operations and property management).

You upload a bank statement and each receipt gets allocated to the right tenant charge, with evidence. Lines the agent isn't sure about go to a one-click exceptions queue. When a person approves one, that payer is remembered for next month. The output is an arrears list you can trust, chaser drafts and an audit log.

## Results

All numbers come from the synthetic test data described below, where we tuned on September and October. November is a hold-out and gets scored once, at the end.

| Month | Lines | Auto-approved | Precision of approved | Wrong allocations | To a person |
|---|---|---|---|---|---|
| 2026-09 (tuning) | 200 | pending | pending | pending | pending |
| 2026-10 (tuning, from memory) | 200 | pending | pending | pending | pending |
| 2026-11 (hold-out, scored once) | 200 | pending | pending | pending | pending |

For context, the APQC benchmark puts the median at 45% of receipts auto-applied, across 851 companies (as cited by creditpulse.com).

## How it works

1. **Pass 1, code.** Exact reference and amount, then a duplicate guard, then payer name plus a subset sum over that tenant's open charges.
2. **Pass 2, memory.** Payer aliases learned from earlier approvals.
3. **Pass 3, agent.** Grok proposes a split with evidence and code checks that it adds up.
4. **Exceptions.** Anything low confidence goes to a person. Approving creates an alias, so next month the line matches in pass 2.

Stack: Next.js (App Router) and TypeScript, Supabase (Postgres), the xAI API for the agent. Grok Bot explains allocations through an MCP connector.

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
