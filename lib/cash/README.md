# Cash application engine (`lib/cash`)

Drop in a bank statement; every receipt lands on the right tenant charge, with evidence.

| Pass | Where | What |
|---|---|---|
| 1 code | `lib/cash/match.ts` | exact ref + amount (also normalised: `INV2609033S`), then a 7-day duplicate guard, then payer name (cut-off bank names allowed) + subset sum over that tenant's open charges, oldest first |
| 2 memory | `lib/cash/match.ts` | payer approved before (payer_aliases) -> one charge, or all that tenant's open charges |
| 3 agent | `lib/cash/agent.ts`, xAI API | candidates (`lib/cash/candidates.ts`) + company lookup + tenant notes in; JSON proposal out; `lib/cash/checkSum.ts` rejects anything off by 1p, one retry with the reason, then a person |

Money is integer pence everywhere inside the engine. `lib/cash/score.ts` scores against a truth file (match rate, precision, per case).

## API (Grok Bot calls these; JSON in and out)

| Route | Does |
|---|---|
| `POST /api/statements` | load bank lines: CSV text (`content-type: text/csv`), `{bank_lines: [...]}` or `{csv: "..."}` |
| `POST /api/run` | pass 1 + 2 on open lines; counts by method |
| `GET /api/exceptions` | open lines with candidates (max 15), earlier identical lines, tenants, aliases, and what waits for approval |
| `POST /api/proposals` | `{bank_line_id, allocations: [{charge_id, amount}], unallocated_amount, confidence, reasoning, evidence}`; 422 with the reason if the sum or a charge id is wrong; confidence < 0.7 waits for a person; no allocations = line held open |
| `POST /api/allocations/{id}/approve` · `/reject` | id = bank line id or allocation id; approving teaches the app the payer (alias, source human) |
| `GET /api/allocations/{id}/explain` | method, charges, evidence, reasoning, who decided and when, audit trail |
| `GET /api/arrears` | open amount per tenant, oldest first; `?sort=amount` for most money first |
| `GET /api/metrics` | lines by method, auto-match rate, held, waiting; precision against truth when a truth file is loaded |

Send `x-actor: grok_bot | human | system` on writes; every write lands in the audit log with its actor.
State is in memory in `lib/cash/service.ts` (`Store`); swap it for Supabase tables of the same shape.

## Data

`lib/cash/data.ts` reads the team set in `data/sample/` (Sep + Oct for tuning). `data/sample/holdout/` (November)
is read only with `loadData({ holdout: true })`, once, at the end. Cortile data stays local: `data/private/`
(git-ignored) holds session 1's CSVs for the `match.py` parity check (`CASH_DATA_DIR=data/private`).

## Run

```
npm install
npx vitest run          # unit tests always; data tests run when ./data has the CSVs
npm run score           # pass 1 + 2 on Sep + Oct, per case
npx tsx scripts/pass3.ts          # pass 1-3 per month as the README results table; XAI_API_KEY in .env (git-ignored)
npx tsx scripts/pass3.ts --stub   # same path, answers replayed from the key: proves plumbing, not a model result
CASH_DATA_DIR=data/private npm run compare   # parity with match.py on the local Cortile CSVs
```
