// POST /api/lines/:id/reject: a person rejects what waits on this line; the line goes back to open.
import { actorOf, handle } from "@/lib/cash/http";
import { decide, decideHold, store } from "@/lib/cash/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => {
    const s = store();
    if (!s.allocations.some((a) => a.bank_line_id === id && a.status === "proposed")) return decideHold(s, id, false, actorOf(req));
    return decide(s, id, false, actorOf(req));
  });
}
