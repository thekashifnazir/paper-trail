// GET /api/lines?month=2026-09: every bank line of the month in the UI's LineView shape (lib/types.ts).
// Supabase when configured (lib/supabase-store.ts), else the in-memory engine store.
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";
import { lineViews } from "@/lib/cash/view";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  if (dbEnabled()) return withDb("GET /api/lines", (_s, ctx) => lineViews(ctx.view(), month));
  return handle(() => lineViews(store(), month));
}
