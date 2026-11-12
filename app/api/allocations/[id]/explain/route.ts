import { handle } from "@/lib/cash/http";
import { explain, store } from "@/lib/cash/service";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => explain(store(), id));
}
