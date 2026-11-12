// POST /api/lines/:id/approve: a person approves what waits on this line. Returns { remembered } when the approval
// taught the app a payer ("Remembered: <payer> pays for <tenant>").
import { actorOf, handle } from "@/lib/cash/http";
import { decide, decideHold, store } from "@/lib/cash/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => {
    const s = store();
    if (!s.allocations.some((a) => a.bank_line_id === id && a.status === "proposed")) return decideHold(s, id, true, actorOf(req));
    const res = decide(s, id, true, actorOf(req));
    const a = res.learned_alias;
    const tenant = a ? s.tenants.find((t) => t.tenant_id === a.tenant_id)?.tenant_name ?? a.tenant_id : null;
    return { ...res, remembered: a ? `Remembered: ${a.payer_name} pays for ${tenant}` : undefined };
  });
}
