import { handle } from "@/lib/cash/http";
import { run, store } from "@/lib/cash/service";

export async function POST() {
  return handle(() => run(store()));
}
