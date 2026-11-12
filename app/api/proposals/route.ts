// POST /api/proposals: a proposal for one open line (Grok Bot, or a person's "Find match" with x-actor: human).
// With Supabase configured it is loaded from and saved to the database like every other Live write; before, it went
// to this instance's memory only, so the approve that follows (DB) found nothing waiting.
import { actorOf, bodyOf, handle } from "@/lib/cash/http";
import { propose, store } from "@/lib/cash/service";
import type { AgentProposal } from "@/lib/cash/types";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export async function POST(req: Request) {
  const body = (await bodyOf(req)) as AgentProposal & { bank_line_id: string };
  const actor = actorOf(req, "grok_bot");
  if (dbEnabled()) {
    const lineId = typeof body?.bank_line_id === "string" ? body.bank_line_id : undefined;
    return withDb("POST /api/proposals", (s) => propose(s, body, actor), { write: true, lineId, audit: "none" });
  }
  return handle(async () => propose(store(), body, actor));
}
