import { handle } from "@/lib/cash/http";
import { metrics, store } from "@/lib/cash/service";

export const dynamic = "force-dynamic";
export async function GET() {
  return handle(() => metrics(store()));
}
