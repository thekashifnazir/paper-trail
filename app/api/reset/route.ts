import { handle } from "@/lib/cash/http";
import { resetStore } from "@/lib/cash/service";
import { dbEnabled, resetDb, withDb } from "@/lib/supabase-store";

// Demo reset. Supabase mode: clears allocations, line_results, learned payers and the audit log, zeroes
// charges.amount_paid (reference data and bank lines stay). In-memory mode: fresh store as before.
export async function POST() {
  if (dbEnabled()) return withDb("POST /api/reset", () => resetDb());
  return handle(() => resetStore());
}
