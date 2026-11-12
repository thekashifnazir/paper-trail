// Pass 1 + 2 + 3 per month on the team sample, scored like the README results table.
// usage: npx tsx scripts/pass3.ts            (xAI; needs XAI_API_KEY in .env, optional XAI_MODEL)
//        npx tsx scripts/pass3.ts --stub     (replays the answer key through the same path; proves plumbing only)
// Between months a simulated person approves queued proposals that match the answer key and rejects the rest;
// approvals become aliases, so October runs with September's memory. The November hold-out is never read here.
import { proposeAll, pass3Input, pickModel, stubFetch, type AgentConfig } from "../lib/cash/agent";
import { candidates } from "../lib/cash/candidates";
import { loadData, TUNING_MONTHS } from "../lib/cash/data";
import { allocate, tenantForPayer } from "../lib/cash/match";
import { toPence } from "../lib/cash/money";
import { score, type ScoredAllocation } from "../lib/cash/score";

const stub = process.argv.includes("--stub");
try { process.loadEnvFile(".env"); } catch { /* no .env */ }
const all = loadData();
const key = process.env.XAI_API_KEY;
if (!stub && !key) throw new Error("XAI_API_KEY missing: put it in .env (git-ignored), or run with --stub");
const cfg: AgentConfig = stub ? { apiKey: "stub", model: "stub", fetch: stubFetch(all.truth) } : { apiKey: key!, model: await pickModel(key!) };
console.log(`pass 3: ${stub ? "STUB (answer key replay, not a model result)" : `xAI ${cfg.model}`}\n`);

const aliases: { payer_name: string; tenant_id: string }[] = [];
let open = new Map(all.charges.map((c) => [c.id, toPence(c.amount_due)]));
const rows: string[] = ["| Month | Lines | Auto-approved | Precision of approved | Wrong allocations | To a person |", "|---|---|---|---|---|---|"];
const perCase: Record<string, string> = {};

for (const month of TUNING_MONTHS) {
  const d = loadData({ months: [month] });
  const r = allocate(all.charges, d.bankLines, aliases, open);
  open = r.openAmount;
  const inputs = r.leftover.map((b) => pass3Input(candidates(b, all.charges, open, all.tenants, aliases, d.bankLines), all.tenants, all.notes, all.companyLookup));
  const res = await proposeAll(cfg, inputs, open);

  const truth = new Map(d.truth.map((t) => [t.bank_line_id, t]));
  const auto: ScoredAllocation[] = r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method }));
  const toPerson: typeof res = [];
  for (const x of res) {
    if (!x.proposal || x.proposal.confidence < 0.7) { toPerson.push(x); continue; }
    for (const a of x.proposal.allocations) auto.push({ bank_line_id: x.bank_line_id, charge_id: a.charge_id, amount: toPence(a.amount), method: "agent" });
    if (!x.proposal.allocations.length) auto.push({ bank_line_id: x.bank_line_id, charge_id: "", amount: 0, method: "agent_hold" });
  }
  const amounts = new Map(d.bankLines.map((b) => [b.id, toPence(b.amount)]));
  const placedLines = new Set(auto.map((a) => a.bank_line_id));
  const autoTruth = d.truth.filter((t) => placedLines.has(t.bank_line_id));
  const s = score(autoTruth, auto, amounts);
  for (const a of auto.filter((x) => x.charge_id)) open.set(a.charge_id, open.get(a.charge_id)! - a.amount);
  rows.push(`| ${month} | ${d.bankLines.length} | ${autoTruth.length} (${Math.round((autoTruth.length / d.bankLines.length) * 100)}%) | ${(((autoTruth.length - s.wrong) / Math.max(1, autoTruth.length)) * 100).toFixed(1)}% | ${s.wrong} | ${toPerson.length} |`);
  perCase[month] = Object.entries(s.perCase).map(([c, v]) => `${c} ${v.right}/${v.n}`).join(", ") + ` · to a person: ${toPerson.map((x) => truth.get(x.bank_line_id)!.case).join(", ") || "none"}`;
  const retried = res.filter((x) => x.rejected.length);
  if (retried.length) perCase[month] += ` · code rejected ${retried.length} first answers (${retried.flatMap((x) => x.rejected).slice(0, 3).join("; ")})`;

  // the simulated person: approve queued proposals that match the key (they become memory), reject the rest
  for (const x of toPerson) {
    const t = truth.get(x.bank_line_id)!;
    const want = t.true_charge_ids ? t.true_charge_ids.split(";").sort().join(";") : "";
    const got = (x.proposal?.allocations ?? []).map((a) => a.charge_id).sort().join(";");
    if (!x.proposal || got !== want || !want) continue;
    for (const a of x.proposal.allocations) open.set(a.charge_id, open.get(a.charge_id)! - toPence(a.amount));
    const b = d.bankLines.find((y) => y.id === x.bank_line_id)!;
    const tid = all.charges.find((c) => c.id === x.proposal!.allocations[0].charge_id)!.tenant_id;
    if (!tenantForPayer(b.payer_name, all.charges) && !aliases.some((a) => a.payer_name === b.payer_name)) aliases.push({ payer_name: b.payer_name, tenant_id: tid });
  }
}
console.log(rows.join("\n"));
for (const [m, v] of Object.entries(perCase)) console.log(`\n${m}: ${v}`);
console.log(`\naliases learned from approvals: ${aliases.length}`);
