import { handle } from "@/lib/cash/http";
import { resetStore } from "@/lib/cash/service";

// Demo reset: fresh store, and learned payers plus the audit log cleared in Supabase.
export async function POST() {
  return handle(() => resetStore());
}
