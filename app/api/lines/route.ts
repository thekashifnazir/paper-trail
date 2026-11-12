// GET /api/lines?month=2026-09: every bank line of the month in the UI's LineView shape (lib/types.ts).
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";
import { lineViews } from "@/lib/cash/view";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return handle(() => lineViews(store(), month));
}
