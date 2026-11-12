// POST /api/lines/:id/approve: a person approves what waits on this line. Returns { remembered } when the approval
// taught the app a payer ("Remembered: <payer> pays for <tenant>"). With Supabase configured, the approval, the
// payer alias, charges.amount_paid and the audit row are written to the database before the response.
import { actorOf, handle } from "@/lib/cash/http";
import { decide, decideHold, store, type Actor, type Store } from "@/lib/cash/service";
import { dbEnabled, withDb } from "@/lib/supabase-store";

function approve(s: Store, id: string, actor: Actor) {
  if (!s.allocations.some((a) => a.bank_line_id === id && a.status === "proposed")) return decideHold(s, id, true, actor);
  const res = decide(s, id, true, actor);
  const a = res.learned_alias;
  const tenant = a ? s.tenants.find((t) => t.tenant_id === a.tenant_id)?.tenant_name ?? a.tenant_id : null;
  return { ...res, remembered: a ? `Remembered: ${a.payer_name} pays for ${tenant}` : undefined };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbEnabled()) return withDb("POST /api/lines/:id/approve", (s) => approve(s, id, actorOf(req)), { write: true });
  return handle(() => approve(store(), id, actorOf(req)));
}
