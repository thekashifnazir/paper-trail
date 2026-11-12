// Runs the TS engine and cashgen/match.py on the same CSVs and compares them row by row.
// usage: CASH_DATA_DIR=<folder> MATCH_PY=<path to match.py> npx tsx scripts/compare.ts
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseCsv } from "../lib/cash/csv";
import { DATA_DIR, loadData } from "../lib/cash/data";
import { allocate } from "../lib/cash/match";
import { fmt, toPence } from "../lib/cash/money";
import { formatScore, score } from "../lib/cash/score";

const py = process.env.MATCH_PY ?? join(process.env.HOME ?? "", "second-brain/agent/reports/hackathon/cashgen/match.py");
const d = loadData();
const r = allocate(d.charges, d.bankLines, d.aliases);
const leftIds = new Set(r.leftover.map((b) => b.id));
// TS rows in match.py's order: lines by date, allocations within, "none" for leftovers
const ts: string[] = [];
const sorted = [...d.bankLines].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
for (const b of sorted) {
  if (leftIds.has(b.id)) ts.push([b.id, "", fmt(toPence(b.amount)), "none"].join(","));
  else for (const a of r.allocations.filter((a) => a.bank_line_id === b.id)) ts.push([b.id, a.charge_id, fmt(a.amount), a.method].join(","));
}
const pyOut = parseCsv(execFileSync("python3", [py, join(DATA_DIR, "charges.csv"), join(DATA_DIR, "bank_lines.csv"), ...(d.aliases.length ? [join(DATA_DIR, "aliases.csv")] : [])], { encoding: "utf8" }));
const pyRows = pyOut.map((a) => [a.bank_line_id, a.charge_id, a.amount, a.method].join(","));
let diff = 0;
for (let i = 0; i < Math.max(ts.length, pyRows.length); i++) {
  if (ts[i] !== pyRows[i]) { diff++; if (diff <= 10) console.log(`row ${i}: ts=${ts[i]} py=${pyRows[i]}`); }
}
console.log(`rows ts=${ts.length} py=${pyRows.length} differences=${diff}`);
const scored = [
  ...r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
  ...r.leftover.map((b) => ({ bank_line_id: b.id, charge_id: "", amount: toPence(b.amount), method: "none" })),
];
if (d.truth.length) console.log(formatScore(score(d.truth, scored)));
process.exit(diff ? 1 : 0);
