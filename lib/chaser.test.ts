// A dispute note can name one £ amount per disputed month. The chaser holds back all of them and demands only the
// rest; holding back only the first would put a disputed amount in the letter.
import { describe, expect, it } from "vitest";
import { chaseSplit, draftChaser } from "./chaser";
import type { ArrearsRow } from "./types";

const row: ArrearsRow = {
  tenant_id: "T001", tenant_name: "Harbour Estates Ltd", unit: "Unit 1", outstanding: 327.41,
  oldest_due_date: "2026-09-01", days_overdue: 72, disputed: true, lease_citation: "Clause 4.1",
  dispute_note: "Disputing £108.10 of September service charge, email of 31 August 2026. Disputing £219.31 of October service charge, email of 2 October 2026.",
  open_charges: [
    { charge_id: "INV-2609-001-S", charge_type: "service_charge", period: "2026-09", outstanding: 108.1 },
    { charge_id: "INV-2610-001-S", charge_type: "service_charge", period: "2026-10", outstanding: 219.31 },
  ],
};

describe("chaseSplit", () => {
  it("holds back every disputed amount a note names", () => {
    const s = chaseSplit(row);
    expect(s.demanded).toEqual([]);
    expect(s.heldBack.reduce((x, c) => x + c.outstanding, 0)).toBeCloseTo(327.41, 2);
  });

  it("demands the undisputed rest of a service charge", () => {
    const s = chaseSplit({ ...row, open_charges: [{ ...row.open_charges[0], outstanding: 150 }, row.open_charges[1]] });
    expect(s.demanded.reduce((x, c) => x + c.outstanding, 0)).toBeCloseTo(41.9, 2);
  });

  it("never asks for £0.00", () => {
    expect(draftChaser(row).body).not.toContain("£0.00");
  });
});
