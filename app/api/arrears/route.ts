import { handle } from "@/lib/cash/http";
import { arrears, store } from "@/lib/cash/service";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const sort = new URL(req.url).searchParams.get("sort") === "amount" ? "amount" : "oldest";
  return handle(() => arrears(store(), sort));
}
