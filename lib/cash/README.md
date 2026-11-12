# Cash application engine (`lib/cash`)

Drop in a bank statement; every receipt lands on the right tenant charge, with evidence.

| Pass | Where | What |
|---|---|---|
| 1 exact | `lib/cash/match.ts` | invoice ref in the bank reference and amount = open amount |
| 2 memory | `lib/cash/match.ts` | payer approved before (payer_aliases) -> one charge, or all that tenant's open charges |
| 3 agent | Grok Bot via the API | reads candidates (`lib/cash/candidates.ts`), proposes; `lib/cash/checkSum.ts` rejects anything off by 1p |

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

## Data: loaded at runtime, never committed

Partner data (Cortile) is for the event only and must not enter this public repo. Put `charges.csv`,
`bank_lines.csv`, `tenants.csv`, optional `truth.csv` and `aliases.csv` in `data/private/` (git-ignored) or point
`CASH_DATA_DIR` at a folder. The committed synthetic set in `data/sample/` loads through `lib/cash/sample.ts`.

## Run

```
npm install
npx vitest run          # unit tests always; data tests run when ./data has the CSVs
npm run compare         # TS engine vs the reference match.py, row by row (MATCH_PY=path)
```
