import { actorOf, bodyOf, handle } from "@/lib/cash/http";
import { loadStatement, store } from "@/lib/cash/service";

export async function POST(req: Request) {
  return handle(async () => loadStatement(store(), await bodyOf(req), actorOf(req)));
}
