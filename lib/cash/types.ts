// Shared contract (team plan). Money in the CSVs and API is pounds as decimal strings or numbers;
// the engine works in pence (integers) and never in floats.

export type Pence = number;

export interface Charge {
  id: string;
  tenant_id: string;
  tenant_name: string;
  unit: string;
  type: string;
  period: string;
  amount_due: string;
  due_date: string;
  invoice_ref: string;
  lease_citation: string;
}

export interface BankLine {
  id: string;
  date: string;
  amount: string;
  payer_name: string;
  reference: string;
}

export interface Tenant {
  tenant_id: string;
  tenant_name: string;
  leaseholder_type?: string;
  parent_company: string;
  unit?: string;
}

export type Method = "exact" | "memory" | "agent" | "human";
export type Status = "proposed" | "approved" | "rejected";

export interface Evidence {
  type: "bank_line" | "charge" | "tenant" | "lease" | "alias";
  ref: string;
  quote: string;
}

export interface Allocation {
  id: string;
  bank_line_id: string;
  charge_id: string;
  amount: Pence;
  method: Method;
  confidence: number;
  evidence: Evidence[];
  status: Status;
}

export interface PayerAlias {
  payer_name: string;
  tenant_id: string;
  source: "human" | "seed";
  approved_at: string;
}

// What Grok Bot returns for one line in pass 3 (amounts in pounds, as in pass3_prompt.md).
export interface AgentProposal {
  allocations: { charge_id: string; amount: number }[];
  unallocated_amount: number;
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
}

export interface OpenCharge extends Omit<Charge, "amount_due"> {
  amount_open: Pence;
}
