export type Method = "exact" | "memory" | "agent" | "human";
export type Status = "approved" | "proposed" | "rejected";
export type ReviewReason =
  | "New payer relationship"
  | "Short payment"
  | "Overpayment"
  | "Unidentified receipt"
  | "Possible duplicate payment"
  | "Low confidence"
  | null;

export type Evidence = {
  type:
    | "bank_line"
    | "charge"
    | "lease"
    | "tenant_note"
    | "company_lookup"
    | "alias"
    | "rule";
  ref: string;
  quote: string;
};

export type AllocationView = {
  charge_id: string;
  tenant_id: string;
  tenant_name: string;
  unit: string;
  charge_type: "rent" | "service_charge";
  period: string;
  amount_due: number;
  outstanding_before: number;
  allocated: number;
  outstanding_after: number;
};

export type LineView = {
  id: string;
  statement_month: string;
  date: string;
  amount: number;
  payer_name: string;
  reference: string;
  method: Method | null;
  status: Status | null;
  confidence: number | null;
  review_reason: ReviewReason;
  reasoning: string | null;
  unallocated_amount: number;
  allocations: AllocationView[];
  evidence: Evidence[];
};

export type RunSummary = {
  month: string;
  total_lines: number;
  total_value: number;
  by_method: { method: Method; lines: number; value: number }[];
  in_queue: number;
  unallocated_value: number;
  score?: { auto_rate: number; precision: number; wrong_allocations: number };
};

export type ArrearsRow = {
  tenant_id: string;
  tenant_name: string;
  unit: string;
  outstanding: number;
  oldest_due_date: string;
  days_overdue: number;
  disputed: boolean;
  dispute_note: string | null;
  lease_citation: string;
  open_charges: {
    charge_id: string;
    charge_type: string;
    period: string;
    outstanding: number;
  }[];
};

export type AuditRow = {
  ts: string;
  actor: string;
  action: string;
  object_id: string;
  detail: unknown;
};

export type RunProgress = {
  stage: "idle" | "exact" | "memory" | "agent" | "done";
  percent: number;
};
