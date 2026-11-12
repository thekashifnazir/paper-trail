import { handle } from "@/lib/cash/http";
import { run, store } from "@/lib/cash/service";

// optional ?month=2026-09
export async function POST(req?: Request) {
  const month = req ? new URL(req.url).searchParams.get("month") ?? undefined : undefined;
  return handle(() => run(store(), month));
}
