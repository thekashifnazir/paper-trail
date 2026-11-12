// GET /api/audit: the audit log, newest first, in the UI's AuditRow shape.
import { handle } from "@/lib/cash/http";
import { store } from "@/lib/cash/service";
import { auditRows } from "@/lib/cash/view";

export const dynamic = "force-dynamic";
export async function GET() {
  return handle(() => auditRows(store()));
}
