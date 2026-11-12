import { toPence } from "./money";
import type { Pence } from "./types";

// Code, not the model, decides: allocations + unallocated must equal the bank amount to the penny.
export function checkSum(bankAmount: Pence, allocations: { amount: Pence }[], unallocated: Pence = 0): boolean {
  return allocations.reduce((s, a) => s + a.amount, 0) + unallocated === bankAmount;
}

export interface ProposalCheck {
  ok: boolean;
  reason?: string;
}

// Pass 3 gate: every charge id must be a known open charge, no negative amounts, no charge over-allocated,
// and the sum must hold to the penny.
export function checkProposal(
  bankAmount: Pence,
  proposal: { allocations: { charge_id: string; amount: number | string }[]; unallocated_amount: number | string },
  openAmount: Map<string, Pence>,
): ProposalCheck {
  const allocs = proposal.allocations.map((a) => ({ charge_id: a.charge_id, amount: toPence(a.amount) }));
  const unallocated = toPence(proposal.unallocated_amount);
  const perCharge = new Map<string, Pence>();
  for (const a of allocs) {
    if (!openAmount.has(a.charge_id)) return { ok: false, reason: `unknown charge id ${a.charge_id}` };
    if (a.amount <= 0) return { ok: false, reason: `non-positive amount on ${a.charge_id}` };
    perCharge.set(a.charge_id, (perCharge.get(a.charge_id) ?? 0) + a.amount);
    if (perCharge.get(a.charge_id)! > openAmount.get(a.charge_id)!) return { ok: false, reason: `${a.charge_id} allocated more than its open amount` };
  }
  if (unallocated < 0) return { ok: false, reason: "negative unallocated_amount" };
  if (!checkSum(bankAmount, allocs, unallocated)) {
    const got = allocs.reduce((s, a) => s + a.amount, 0) + unallocated;
    return { ok: false, reason: `sum ${got}p does not equal bank amount ${bankAmount}p` };
  }
  return { ok: true };
}
