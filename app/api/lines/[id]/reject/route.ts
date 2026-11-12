// POST /api/lines/:id/reject: a person rejects what waits on this line; the line goes back to open.
import { actorOf, handle } from "@/lib/cash/http";
import { decide, decideHold, store, type Actor, type Store } from "@/lib/cash/service";
import { dbEnabled, withDb } from "@/lib/supabase-store";

function reject(s: Store, id: string, actor: Actor) {
  if (!s.allocations.some((a) => a.bank_line_id === id && a.status === "proposed")) return decideHold(s, id, false, actor);
  return decide(s, id, false, actor);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbEnabled()) return withDb("POST /api/lines/:id/reject", (s) => reject(s, id, actorOf(req)), { write: true });
  return handle(() => reject(store(), id, actorOf(req)));
}
