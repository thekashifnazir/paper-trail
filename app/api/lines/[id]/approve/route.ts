// POST /api/lines/:id/approve: a person approves what waits on this line. Returns { remembered } when the approval
// taught the app a payer ("Remembered: <payer> pays for <tenant>"), and { cleared } with that payer's other waiting
// lines of the month that payer memory (pass 2) then cleared. With Supabase configured, the approval, the payer
// alias, charges.amount_paid and the audit rows are written to the database before the response.
import { actorOf, handle } from "@/lib/cash/http";
import { approveLine, store } from "@/lib/cash/service";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbEnabled()) return withDb("POST /api/lines/:id/approve", (s) => approveLine(s, id, actorOf(req)), { write: true, lineId: id.split(":")[0], audit: "none" });
  return handle(() => approveLine(store(), id, actorOf(req)));
}
