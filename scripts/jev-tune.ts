// Ask Jev about every open line of Sep + Oct (after passes 1 and 2), then pick thresholds against the answer key:
// 0 wrong allocations, most lines settled by Jev. The hold-out is never read.
// usage: npx tsx scripts/jev-tune.ts [--cached=<answers.json>] [--out=<answers.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { pass3Input } from "../lib/cash/agent";
import { candidates } from "../lib/cash/candidates";
import { loadData, TUNING_MONTHS } from "../lib/cash/data";
import { askJev, decide, JEV_T, type JevAnswers } from "../lib/cash/jev";
import { allocate } from "../lib/cash/match";
import { toPence } from "../lib/cash/money";

try { process.loadEnvFile(".env"); } catch { /* none */ }
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const all = loadData();
const truth = new Map(all.truth.map((t) => [t.bank_line_id, t]));
let open = new Map(all.charges.map((c) => [c.id, toPence(c.amount_due)]));
const rows: { month: string; input: ReturnType<typeof pass3Input>; open: [string, number][]; answers?: JevAnswers; ms?: number }[] = [];
for (const month of TUNING_MONTHS) {
  const d = loadData({ months: [month] });
  const r = allocate(all.charges, d.bankLines, [], open);
  open = r.openAmount;
  for (const b of r.leftover) rows.push({ month, input: pass3Input(candidates(b, all.charges, open, all.tenants, [], d.bankLines), all.tenants, all.notes, all.companyLookup), open: [...open] });
  // the month closes as a perfect person would leave it, so October starts from the right open amounts
  for (const b of r.leftover) {
    const t = truth.get(b.id)!;
    (t.true_charge_ids ? t.true_charge_ids.split(";") : []).forEach((id, i) => open.set(id, open.get(id)! - toPence(t.true_amounts.split(";")[i])));
  }
}

const cached = arg("cached");
if (cached) {
  const saved: Record<string, { answers: JevAnswers; ms: number }> = JSON.parse(readFileSync(cached, "utf8"));
  for (const r of rows) Object.assign(r, saved[r.input.bank_line.id]);
} else {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY missing in .env");
  const t0 = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (next < rows.length) {
      const r = rows[next++];
      const t = Date.now();
      r.answers = await askJev(r.input, key);
      r.ms = Date.now() - t;
    }
  }));
  console.log(`Jev: ${rows.length} requests in ${((Date.now() - t0) / 1000).toFixed(1)}s at concurrency 10, median ${rows.map((r) => r.ms!).sort((a, b) => a - b)[rows.length >> 1]} ms each`);
  if (arg("out")) writeFileSync(arg("out")!, JSON.stringify(Object.fromEntries(rows.map((r) => [r.input.bank_line.id, { answers: r.answers, ms: r.ms }])), null, 1));
}

// (a) Jev's reading per case: chosen charge right? shape? any_fits?
const want = (id: string) => truth.get(id)!.true_charge_ids.split(";").filter(Boolean);
console.log("\nline        case                 shape (p)                charge right (p)   any_fits");
for (const r of rows) {
  const id = r.input.bank_line.id, t = truth.get(id)!, a = r.answers!;
  const w = want(id);
  const chargeOk = w.length === 1 ? a.charge.choice === w[0] : w.length === 0 ? a.charge.choice === "none" : w.includes(a.charge.choice) ? "part" : false;
  console.log(`${id}  ${t.case.padEnd(20)} ${`${a.shape.choice} (${(a.shape.probabilities[a.shape.choice] ?? 0).toFixed(2)})`.padEnd(24)} ${String(chargeOk).padEnd(6)} (${(a.charge.probabilities[a.charge.choice] ?? 0).toFixed(2)})      ${a.any_fits.noul.toFixed(2)}`);
}

// (b) thresholds: grid over charge/shape probability; any_fits yes at 0.7, no at 0.3 (the docs' companion-Noul cut-offs)
function run(t: typeof JEV_T) {
  let jev = 0, wrong = 0, person = 0, personMiss = 0, grok = 0;
  const wrongIds: string[] = [];
  for (const r of rows) {
    const id = r.input.bank_line.id, tr = truth.get(id)!;
    const dcs = decide(r.answers!, r.input, new Map(r.open), t);
    if (dcs.route === "grok") { grok++; continue; }
    if (dcs.route === "person") { person++; if (tr.true_charge_ids) personMiss++; continue; }
    jev++;
    const got = dcs.proposal.allocations.map((x) => `${x.charge_id}|${toPence(x.amount)}`).sort().join(";");
    const w = want(id).map((c, i) => `${c}|${toPence(tr.true_amounts.split(";")[i])}`).sort().join(";");
    const ok = got === w && toPence(dcs.proposal.unallocated_amount) === toPence(tr.true_unallocated ?? "0");
    if (!ok) { wrong++; wrongIds.push(`${id}(${tr.case})`); }
  }
  return { jev, wrong, person, personMiss, grok, wrongIds };
}
const grid: { t: typeof JEV_T; res: ReturnType<typeof run> }[] = [];
for (const charge of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) for (const shape of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) for (const personSure of [0.7, 0.8, 0.9, 0.95]) {
  const t = { ...JEV_T, charge, shape, personSure };
  grid.push({ t, res: run(t) });
}
const safe = grid.filter((g) => g.res.wrong === 0 && g.res.personMiss === 0).sort((a, b) => b.res.jev + b.res.person - (a.res.jev + a.res.person) || b.t.charge + b.t.shape - (a.t.charge + a.t.shape));
console.log(`\ncurrent JEV_T ${JSON.stringify(JEV_T)}:`, run(JEV_T));
console.log("best safe thresholds (0 wrong, no line with a right answer sent to a person):", safe[0] ? safe[0] : "none");
const loosest = grid.sort((a, b) => b.res.jev - a.res.jev)[0];
console.log("loosest grid point, for contrast:", loosest);
