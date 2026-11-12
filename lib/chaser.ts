import type { ArrearsRow } from "@/lib/types";
import { gbp } from "@/lib/format";

export type ChaseCharge = {
  charge_id: string;
  charge_type: string;
  period: string;
  outstanding: number;
};

export type ChaseSplit = {
  demanded: ChaseCharge[];
  heldBack: ChaseCharge[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isServiceCharge(chargeType: string) {
  return chargeType.replaceAll("_", " ") === "service charge";
}

/** First £ amount in a dispute note, or null when the note names no amount. */
function poundAmount(note: string | null): number | null {
  if (!note) return null;
  const match = note.match(/£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  const pounds = Number(match[1].replaceAll(",", ""));
  const pence = match[2] ? Number(match[2].padEnd(2, "0").slice(0, 2)) / 100 : 0;
  if (!Number.isFinite(pounds + pence)) return null;
  return round2(pounds + pence);
}

function asCharge(
  charge: ArrearsRow["open_charges"][number],
  outstanding = charge.outstanding,
): ChaseCharge {
  return {
    charge_id: charge.charge_id,
    charge_type: charge.charge_type,
    period: charge.period,
    outstanding: round2(outstanding),
  };
}

/**
 * Split open charges into the amount this letter demands and the amount held
 * back. Disputed notes that name a £ amount hold back that much of the open
 * service charge (never more). A dispute with no amount holds back the open
 * service charge in full. Anything else is demanded.
 */
export function chaseSplit(row: ArrearsRow): ChaseSplit {
  const open = row.open_charges.filter((c) => c.outstanding > 0);
  if (!row.disputed) {
    return { demanded: open.map((c) => asCharge(c)), heldBack: [] };
  }

  const stated = poundAmount(row.dispute_note);
  if (stated == null) {
    return {
      demanded: open.filter((c) => !isServiceCharge(c.charge_type)).map((c) => asCharge(c)),
      heldBack: open.filter((c) => isServiceCharge(c.charge_type)).map((c) => asCharge(c)),
    };
  }

  const serviceOutstanding = open
    .filter((c) => isServiceCharge(c.charge_type))
    .reduce((sum, c) => sum + c.outstanding, 0);
  let remaining = round2(Math.min(stated, serviceOutstanding));
  const demanded: ChaseCharge[] = [];
  const heldBack: ChaseCharge[] = [];

  for (const charge of open) {
    if (!isServiceCharge(charge.charge_type) || remaining <= 0) {
      demanded.push(asCharge(charge));
      continue;
    }
    const hold = round2(Math.min(charge.outstanding, remaining));
    const rest = round2(charge.outstanding - hold);
    remaining = round2(remaining - hold);
    if (rest > 0) demanded.push(asCharge(charge, rest));
    if (hold > 0) heldBack.push(asCharge(charge, hold));
  }

  return { demanded, heldBack };
}

function chargeLabel(charge: ChaseCharge) {
  const type = charge.charge_type.replaceAll("_", " ");
  return `• ${charge.charge_id} (${type}, ${charge.period}): ${gbp(charge.outstanding)}`;
}

function asOfLabel(now = new Date()) {
  return now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

export function draftChaser(row: ArrearsRow): { subject: string; body: string } {
  const split = chaseSplit(row);
  const demandedTotal = round2(split.demanded.reduce((sum, c) => sum + c.outstanding, 0));
  const asOf = asOfLabel();

  const lines = [`Dear ${row.tenant_name},`, ""];

  if (demandedTotal > 0) {
    lines.push(`The outstanding balance demanded as at ${asOf} is ${gbp(demandedTotal)}.`);
  } else {
    lines.push(`There is no balance demanded in this letter as at ${asOf}.`);
  }

  if (split.demanded.length > 0) {
    lines.push("", split.demanded.map(chargeLabel).join("\n"));
  }

  if (split.heldBack.length > 0) {
    lines.push(
      "",
      "Under review, not requested in this letter",
      split.heldBack.map(chargeLabel).join("\n"),
    );
  }

  lines.push(
    "",
    `Payment terms: “${row.lease_citation}”.`,
    "",
    demandedTotal > 0
      ? "Please pay this balance within 7 days, or get in touch."
      : "Please get in touch within 7 days about the amount under review.",
    "",
    "Wharfside Quarter Property Management",
  );

  return {
    subject: `Outstanding balance — ${row.unit}, Wharfside Quarter`,
    body: lines.join("\n"),
  };
}
