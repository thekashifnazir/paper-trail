import { actorOf, handle } from "@/lib/cash/http";
import { decide, store } from "@/lib/cash/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => decide(store(), id, false, actorOf(req)));
}
