import type { Pence } from "./types";

// "219.61" -> 21961, parsed from the string so no float rounding can creep in.
export function toPence(x: string | number): Pence {
  const s = typeof x === "number" ? x.toFixed(2) : x.trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) throw new Error(`not an amount: ${JSON.stringify(x)}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let p = Number(m[2] || "0") * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) p += 1; // half up, like round(x, 2) on these inputs
  return m[1] ? -p : p;
}

export function fmt(p: Pence): string {
  const sign = p < 0 ? "-" : "";
  const a = Math.abs(p);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
