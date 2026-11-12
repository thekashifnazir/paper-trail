# Paper Trail

Read `context.md` before editing. It is the source of truth for the product, the branches, the sample data, and the API.

Local `main` has no commits. GitHub `origin/main` holds `data/sample` and the Supabase schema. `origin/engine` holds `lib/cash` and `app/api`. Do not commit the uncommitted Next.js scaffold as a new root of `main`.

Do not edit `app/api/**`, `lib/cash/**`, or `data/**`. Do not commit `data/private/` or `data/seed/`. Do not tune on `data/sample/holdout/`. Do not show `case_type` or `true_allocations` in the UI.

Frontend owns `app/(ui)/**`, `components/**`, `lib/api.ts`, `lib/mock.ts`, and `lib/chaser.ts`. Wire the client to the routes in `context.md`, not to a fictional `GET /api/lines`.
