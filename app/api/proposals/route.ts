import { actorOf, bodyOf, handle } from "@/lib/cash/http";
import { propose, store } from "@/lib/cash/service";
import type { AgentProposal } from "@/lib/cash/types";

export async function POST(req: Request) {
  return handle(async () => propose(store(), (await bodyOf(req)) as AgentProposal & { bank_line_id: string }, actorOf(req, "grok_bot")));
}
