// Loads the Cortile-based event data from a local folder (CASH_DATA_DIR, default ./data/private, git-ignored).
// Never committed: partner terms.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv";
import type { BankLine, Charge, PayerAlias, Tenant } from "./types";
import type { TruthRow } from "./score";

export const DATA_DIR = process.env.CASH_DATA_DIR ?? join(process.cwd(), "data", "private");

export function hasData(dir = DATA_DIR): boolean {
  return ["charges.csv", "bank_lines.csv"].every((f) => existsSync(join(dir, f)));
}

const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? parseCsv(readFileSync(join(dir, f), "utf8")) : []);

export function loadData(dir = DATA_DIR) {
  return {
    charges: read(dir, "charges.csv") as unknown as Charge[],
    bankLines: read(dir, "bank_lines.csv") as unknown as BankLine[],
    tenants: read(dir, "tenants.csv") as unknown as Tenant[],
    truth: read(dir, "truth.csv") as unknown as TruthRow[],
    aliases: read(dir, "aliases.csv") as unknown as Pick<PayerAlias, "payer_name" | "tenant_id">[],
  };
}
