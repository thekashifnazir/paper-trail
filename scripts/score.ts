// Scores pass 1 + 2 on the team sample (data/sample). usage: npx tsx scripts/score.ts 2026-09 2026-10
import { candidates } from "../lib/cash/candidates";
import { allocate } from "../lib/cash/match";
import { toPence } from "../lib/cash/money";
import { loadData } from "../lib/cash/data";
import { formatScore, score } from "../lib/cash/score";

const months = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-09", "2026-10"];
if (months.includes("2026-11")) throw new Error("November is the hold-out: score it once at the end, never while tuning");
const d = loadData({ months });
const r = allocate(d.charges, d.bankLines);
console.log(`months ${months.join(", ")}: ${d.bankLines.length} lines, ${d.charges.length} charges, ${d.tenants.length} tenants`);
console.log(formatScore(score(d.truth, [
  ...r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
  ...r.leftover.map((b) => ({ bank_line_id: b.id, charge_id: "", amount: toPence(b.amount), method: "none" })),
], new Map(d.bankLines.map((b) => [b.id, toPence(b.amount)])))));
const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
let have = 0, need = 0;
for (const b of r.leftover) {
  const want = truth.get(b.id)!.true_charge_ids.split(";").filter(Boolean);
  const got = new Set(candidates(b, d.charges, r.openAmount, d.tenants, [], d.bankLines).candidates.map((c) => c.id));
  need += want.length; have += want.filter((id) => got.has(id)).length;
}
console.log(`candidates cover ${have}/${need} true charges of the ${r.leftover.length} leftover lines`);
