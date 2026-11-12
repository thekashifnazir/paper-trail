import type { ArrearsRow } from "@/lib/types";
import { gbp } from "@/lib/format";

export function draftChaser(row: ArrearsRow): { subject: string; body: string } {
  const asOf = "12 November 2026";
  const disputed = row.disputed
    ? row.open_charges.filter((c) => c.charge_type === "service_charge")
    : [];
  const demand = row.disputed
    ? row.open_charges.filter((c) => c.charge_type !== "service_charge")
    : row.open_charges;
  const demandTotal = demand.reduce((s, c) => s + c.outstanding, 0);
  const disputedTotal = disputed.reduce((s, c) => s + c.outstanding, 0);

  const chargeLines = demand
    .map(
      (c) =>
        `• ${c.charge_id} (${c.charge_type.replace("_", " ")}, ${c.period}): ${gbp(c.outstanding)}`,
    )
    .join("\n");

  const disputedBlock =
    row.disputed && disputedTotal > 0
      ? `\n\nUnder review, not requested in this letter:\n${disputed
          .map((c) => `• ${c.charge_id}: ${gbp(c.outstanding)}`)
          .join("\n")}${row.dispute_note ? `\nNote: ${row.dispute_note}` : ""}`
      : "";

  const body = `Dear ${row.tenant_name},

Our records show an outstanding balance of ${gbp(demandTotal)} as at ${asOf} for ${row.unit}.

${chargeLines}

Payment terms: ${row.lease_citation}

Please arrange payment within 7 days, or get in touch if you need to discuss this further.${disputedBlock}

Kind regards,
Wharfside Quarter Property Management`;

  return {
    subject: `Outstanding balance — ${row.unit}, Wharfside Quarter`,
    body,
  };
}
