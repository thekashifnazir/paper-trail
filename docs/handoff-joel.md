# Handoff to Joel — engine side (12 Nov 2026)

From Luca. Frontend is on `main` and deployed to https://paper-trail-smoky.vercel.app.

## What shipped on the UI
- Opens in **Live** by default (engine on `data/sample`, pass 3 replayed from `results/`). Top-bar switch Demo | Live engine; `?mode=demo|live`.
- Find match (manual allocation via `POST /api/proposals` as `x-actor: human`, then approve if it waits), search and filters on Run / Exceptions / Arrears, Rejected panel, "agent working" panel during a run.
- UI derives labels the engine doesn't give yet: person-approved → Human, duplicate holds → Rule, `T088` in quotes → tenant name (`displayLines` in `lib/store.tsx`).
- Live: no `/api/lines` polling during a run; API calls time out at 45 s; after a decision only lines + audit reload first.

## Live mode stalls — please look (engine / `lib/supabase-store.ts`)
Every request in DB mode runs `withDb`: loads the whole store from Supabase and, for writes, saves it back under `__sbLock`. `POST /api/run?month=` = load → passes 1–3 → save ~200 `line_results` + allocations + audit. Asks:
1. Time `/api/run?month=2026-09` and `/api/lines` in prod; find where it goes (load vs save).
2. Batch saves: one upsert per table per request, not row-by-row.
3. Cache reference data and bank_lines per process (already cached for reference?), and make `GET /api/lines` read only what `lineViews` needs.
4. `maxDuration` on `/api/run` is 60 s — fine on Vercel, but the UI now gives up at 45 s.

## Engine items from the click-through (section 3)
1. **Parent-payer evidence**: the replay *has* a `tenant` quote with the lookup (e.g. `results/2026-09.json` B2609-001/006/074/077) but the screen shows only Charge and Bank line. Find where it's dropped (`line_results.agent_raw` rebuild in `lib/supabase-store.ts`, or `lib/cash/view.ts` evidence mapping) and add the lease quote.
2. **Re-run memory after an approval teaches a payer**: approving PREMIER's first September line leaves the sibling waiting. After `decide()` learns an alias, run pass 2 on that month's open lines (approve route `app/api/lines/[id]/approve/route.ts`).
3. **Arrears**: Fairway and Beacon top the list though their group payments are only waiting for review. Exclude those tenants or add `payment_pending: true` to the arrears row (`arrears()` in `lib/cash/service.ts`); I'll show "Payment awaiting review — don't chase".
4. Nice to have: set `method` properly in `lib/cash/view.ts` (human after person approval, rule for duplicate holds) so the UI no longer has to derive it.

## Ops
- The Vercel project is **not Git-linked**: pushes don't deploy. Deploy with `npx vercel deploy --prod --scope solarolo-technologies`, or link the repo in Vercel → Project → Settings → Git.
- Live is shared state in Supabase: Reset wipes it for everyone. Agree who drives during the recording.
