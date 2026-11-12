import { handle } from "@/lib/cash/http";
import { arrears, store } from "@/lib/cash/service";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const sort = new URL(req.url).searchParams.get("sort") === "amount" ? "amount" : "oldest";
  if (dbEnabled()) return withDb("GET /api/arrears", (s) => arrears(s, sort), { raw: false, audit: "none" });
  return handle(() => arrears(store(), sort));
}
