// GET /api/audit: the audit log, newest first, in the UI's AuditRow shape.
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";
import { auditRows } from "@/lib/cash/view";
import { dbEnabled, withDb } from "@/lib/supabase-store";

export const dynamic = "force-dynamic";
export async function GET() {
  if (dbEnabled()) return withDb("GET /api/audit", (s) => auditRows(s));
  return handle(() => auditRows(store()));
}
