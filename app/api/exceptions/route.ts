import { handle } from "@/lib/cash/http";
import { exceptions, store } from "@/lib/cash/service";

export const dynamic = "force-dynamic";
// optional ?month=2026-09
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return handle(() => exceptions(store(), month));
}
