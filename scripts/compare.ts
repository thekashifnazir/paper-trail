// Runs the TS engine and cashgen/match.py on the same CSVs and compares them row by row.
// usage: CASH_DATA_DIR=<folder with the Cortile CSVs> MATCH_PY=<path to match.py> npx tsx scripts/compare.ts
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseCsv } from "../lib/cash/csv";
import { loadCsvDir } from "../lib/cash/data";

const DATA_DIR = process.env.CASH_DATA_DIR ?? join(process.cwd(), "data", "private");
import { allocate } from "../lib/cash/match";
import { fmt, toPence } from "../lib/cash/money";
import { formatScore, score } from "../lib/cash/score";

const py = process.env.MATCH_PY ?? join(process.env.HOME ?? "", "second-brain/agent/reports/hackathon/cashgen/match.py");
const d = loadCsvDir(DATA_DIR);
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
// match.py is pass 1a + 2. The TS engine adds 1b-1d, so it must place every line match.py places, identically,
// and may place more; the extra placements are scored against truth below.
const key = (r: string) => r.split(",")[0];
const group = (rows: string[]) => rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) ?? []), r].sort()), new Map<string, string[]>());
const tsBy = group(ts), pyBy = group(pyRows);
let diff = 0, extra = 0;
for (const [id, rows] of pyBy) {
  const placedByPy = !rows[0].endsWith(",none");
  const same = JSON.stringify(rows) === JSON.stringify(tsBy.get(id));
  if (placedByPy && !same) { diff++; if (diff <= 10) console.log(`${id}: py=${rows.join(" ")} ts=${tsBy.get(id)?.join(" ")}`); }
  if (!placedByPy && !tsBy.get(id)![0].endsWith(",none")) extra++;
}
console.log(`lines ${pyBy.size}: match.py placements changed=${diff}, extra lines placed by TS rules 1b-1d=${extra}`);
const scored = [
  ...r.allocations.map((a) => ({ bank_line_id: a.bank_line_id, charge_id: a.charge_id, amount: a.amount, method: a.method })),
  ...r.leftover.map((b) => ({ bank_line_id: b.id, charge_id: "", amount: toPence(b.amount), method: "none" })),
];
if (d.truth.length) console.log(formatScore(score(d.truth, scored)));
process.exit(diff ? 1 : 0);
