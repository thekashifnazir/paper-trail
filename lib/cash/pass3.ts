// Pass 3 orchestration. PASS3_MODE=grok (default): every open line goes to Grok.
// PASS3_MODE=jev_then_grok: Jev first (~0.2 s a line); code allocates what Jev is sure of, sends what Jev is sure
// nobody fits (or is a duplicate) to a person, and passes only the rest to Grok.
import { proposeAll, type AgentConfig, type Pass3Input, type Pass3Result } from "./agent";
import { askJev, decide, type JevAnswers } from "./jev";
import type { Pence } from "./types";

export type Pass3Mode = "grok" | "jev_then_grok";
export const pass3Mode = (): Pass3Mode => (process.env.PASS3_MODE === "jev_then_grok" ? "jev_then_grok" : "grok");

export interface RoutedResult extends Pass3Result {
  via: "grok" | "jev" | "jev_person";
  jev?: JevAnswers;
}

export async function runPass3(
  inputs: Pass3Input[], open: Map<string, Pence>, grok: AgentConfig,
  opts: { mode?: Pass3Mode; jevKey?: string; concurrency?: number; jevFetch?: typeof fetch } = {},
): Promise<RoutedResult[]> {
  const mode = opts.mode ?? pass3Mode();
  if (mode === "grok") return (await proposeAll(grok, inputs, open, opts.concurrency)).map((r) => ({ ...r, via: "grok" as const }));
  if (!opts.jevKey) throw new Error("PASS3_MODE=jev_then_grok needs TYPESAFE_API_KEY");

  const out = new Map<string, RoutedResult>();
  const toGrok: Pass3Input[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(10, inputs.length) }, async () => {
    while (next < inputs.length) {
      const input = inputs[next++];
      const id = input.bank_line.id;
      let jev: JevAnswers;
      try {
        jev = await askJev(input, opts.jevKey!, opts.jevFetch);
      } catch (e) {
        toGrok.push(input); // Jev unavailable: Grok decides, as without Jev
        continue;
      }
      const d = decide(jev, input, open);
      if (d.route === "allocate") out.set(id, { bank_line_id: id, proposal: d.proposal, tries: 0, rejected: [], via: "jev", jev });
      else if (d.route === "person") out.set(id, { bank_line_id: id, proposal: null, tries: 0, rejected: [d.reason], via: "jev_person", jev });
      else toGrok.push(input);
    }
  }));
  for (const r of await proposeAll(grok, toGrok, open, opts.concurrency)) out.set(r.bank_line_id, { ...r, via: "grok" });
  return inputs.map((i) => out.get(i.bank_line.id)!);
}
