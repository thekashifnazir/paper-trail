# Paper Trail

Read `context.md` for product, data, and the engine API.  
Read `handoff.md` for what is live and what to do next. **Start with the design section in `handoff.md`.**

Work on `main`. Do not edit `app/api/**`, `lib/cash/**`, or `data/**`. Do not commit `data/private/` or `data/seed/`. Do not show `case_type` or `true_allocations` in the UI.

Frontend owns `components/**`, `app/layout.tsx`, `app/page.tsx`, `app/exceptions`, `app/arrears`, `lib/api.ts`, `lib/mock.ts`, `lib/store.tsx`, `lib/chaser.ts`, `lib/types.ts`. Production: https://paper-trail-smoky.vercel.app — Git auto-deploy may be broken; use `vercel deploy --prod` if needed.
