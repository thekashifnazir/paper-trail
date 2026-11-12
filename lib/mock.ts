import type {
  AllocationView,
  ArrearsRow,
  AuditRow,
  LineView,
  Method,
  RunProgress,
  RunSummary,
} from "@/lib/types";

type Tenant = {
  id: string;
  name: string;
  unit: string;
  lease: string;
  rent: number;
  sc: number;
  parent?: string;
  note?: string;
};

type Charge = {
  id: string;
  tenant_id: string;
  charge_type: "rent" | "service_charge";
  period: string;
  amount_due: number;
  due_date: string;
};

type Alias = { payer: string; tenant_id: string };

const NAMES = [
  "Oakmere Cafe Ltd",
  "Canal Basin Studio",
  "Quay House Clinic",
  "Sterling Print Co",
  "Swift Agency Ltd",
  "Merlin Court Design",
  "Cedar House Bakery",
  "Lark Gardens Shop",
  "Teal Court Architects",
  "Mill Building Gym",
  "Riverside Wharf Bar",
  "Gorse House Tailors",
  "Southbank Dental",
  "Harbour Gate Gallery",
  "Wharf Lane Opticians",
  "Basin Walk Books",
  "Pier House Pilates",
  "Dockside Florist",
  "Anchor Yard Kitchen",
  "Crescent Atelier",
];

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function bankName(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 18).trim();
}

function buildTenants(): Tenant[] {
  const rnd = mulberry32(42);
  const out: Tenant[] = [];
  for (let i = 1; i <= 108; i++) {
    const id = `T${String(i).padStart(3, "0")}`;
    const base = NAMES[(i - 1) % NAMES.length];
    const name =
      i === 87
        ? "Harbour & Finch Coffee Ltd"
        : i === 96
          ? "Kestrel Physio Ltd"
          : `${base}${i > 20 ? ` ${Math.ceil(i / 20)}` : ""}`;
    const block = String.fromCharCode(65 + ((i - 1) % 6));
    const unit =
      i === 87 ? "Unit 7, Block A" : `Unit ${(i % 24) + 1}, Block ${block}`;
    const rent =
      i === 87 ? 4850 : i === 96 ? 3200 : round2(1200 + rnd() * 8600);
    const sc =
      i === 87 ? 582 : i === 96 ? 416 : round2(rent * (0.08 + rnd() * 0.07));
    const parent =
      i >= 86 && i <= 89
        ? i === 87
          ? "NORTHGATE HOSPITALITY GRP"
          : bankName(`PARENT GROUP ${i}`)
        : undefined;
    const note =
      i >= 95 && i <= 99
        ? i === 96
          ? "14 Sep 2026 — disputing £150.00 of September service charge (lift repair)"
          : `Disputing part of September service charge, email of ${i} September 2026.`
        : undefined;
    out.push({
      id,
      name,
      unit,
      lease: `Lease L-${String(i).padStart(4, "0")} · rent monthly in advance, due 1st`,
      rent,
      sc,
      parent,
      note,
    });
  }
  return out;
}

const TENANTS = buildTenants();

function chargesFor(period: string): Charge[] {
  const mm = period.slice(5);
  const yy = period.slice(2, 4);
  const due = `${period}-01`;
  return TENANTS.flatMap((t) => {
    const n = t.id.slice(1);
    return [
      {
        id: `INV-${yy}${mm}-${n}-R`,
        tenant_id: t.id,
        charge_type: "rent" as const,
        period,
        amount_due: t.rent,
        due_date: due,
      },
      {
        id: `INV-${yy}${mm}-${n}-S`,
        tenant_id: t.id,
        charge_type: "service_charge" as const,
        period,
        amount_due: t.sc,
        due_date: due,
      },
    ];
  });
}

function alloc(
  charge: Charge,
  tenant: Tenant,
  allocated: number,
  before = charge.amount_due,
): AllocationView {
  return {
    charge_id: charge.id,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    unit: tenant.unit,
    charge_type: charge.charge_type,
    period: charge.period,
    amount_due: charge.amount_due,
    outstanding_before: before,
    allocated,
    outstanding_after: round2(before - allocated),
  };
}

function dateFor(month: string, i: number) {
  const [y, m] = month.split("-").map(Number);
  const prior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  if (i % 5 === 0) return `${prior}-28`;
  if (i % 5 === 1) return `${prior}-29`;
  if (i % 5 === 2) return `${month}-01`;
  if (i % 5 === 3) return `${month}-05`;
  return `${month}-12`;
}

function finalLines(month: string): LineView[] {
  const charges = chargesFor(month);
  const byTenant = new Map<string, Charge[]>();
  for (const c of charges) {
    const list = byTenant.get(c.tenant_id) ?? [];
    list.push(c);
    byTenant.set(c.tenant_id, list);
  }
  const lines: LineView[] = [];
  let seq = 1;
  const id = () =>
    `B${month.slice(2, 4)}${month.slice(5)}-${String(seq++).padStart(3, "0")}`;

  // 170 exact: T001–T085 rent and SC separately
  for (let i = 1; i <= 85; i++) {
    const t = TENANTS[i - 1];
    const [rent, sc] = byTenant.get(t.id)!;
    for (const c of [rent, sc]) {
      lines.push({
        id: id(),
        statement_month: month,
        date: dateFor(month, seq),
        amount: c.amount_due,
        payer_name: bankName(t.name),
        reference: c.id,
        method: "exact",
        status: "approved",
        confidence: 1,
        review_reason: null,
        reasoning: null,
        unallocated_amount: 0,
        allocations: [alloc(c, t, c.amount_due)],
        evidence: [
          {
            type: "rule",
            ref: c.id,
            quote: `Reference and amount match ${c.id}`,
          },
        ],
      });
    }
  }

  // 5 exact combined: T090–T094
  for (let i = 90; i <= 94; i++) {
    const t = TENANTS[i - 1];
    const [rent, sc] = byTenant.get(t.id)!;
    const amount = round2(rent.amount_due + sc.amount_due);
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount,
      payer_name: bankName(t.name),
      reference: `${rent.id} + ${sc.id}`,
      method: "exact",
      status: "approved",
      confidence: 1,
      review_reason: null,
      reasoning: null,
      unallocated_amount: 0,
      allocations: [alloc(rent, t, rent.amount_due), alloc(sc, t, sc.amount_due)],
      evidence: [
        {
          type: "rule",
          ref: t.id,
          quote: "Single payment equals rent plus service charge for the period",
        },
      ],
    });
  }

  // 2 duplicates
  for (let i = 0; i < 2; i++) {
    const t = TENANTS[i];
    const [rent] = byTenant.get(t.id)!;
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount: rent.amount_due,
      payer_name: bankName(t.name),
      reference: rent.id,
      method: "exact",
      status: "proposed",
      confidence: 0.55,
      review_reason: "Possible duplicate payment",
      reasoning:
        "An identical payer, amount and reference already allocated earlier this month.",
      unallocated_amount: rent.amount_due,
      allocations: [],
      evidence: [
        {
          type: "bank_line",
          ref: rent.id,
          quote: `${bankName(t.name)} · ${rent.id} · already matched earlier`,
        },
      ],
    });
  }

  // 8 parent payers: T086–T089 × 2 (rent + SC). Featured T087 rent.
  for (let i = 86; i <= 89; i++) {
    const t = TENANTS[i - 1];
    const [rent, sc] = byTenant.get(t.id)!;
    for (const c of [rent, sc]) {
      const featured = i === 87 && c.charge_type === "rent";
      const payer = t.parent!;
      lines.push({
        id: id(),
        statement_month: month,
        date: dateFor(month, seq),
        amount: c.amount_due,
        payer_name: payer,
        reference: featured ? "RENT SEPT" : `RENT ${month.slice(5)}`,
        method: "agent",
        status: "proposed",
        confidence: featured ? 0.93 : 0.9,
        review_reason: "New payer relationship",
        reasoning: featured
          ? "Payer is the parent company of Harbour & Finch Coffee Ltd, and the amount equals September rent exactly."
          : `Payer ${payer} appears to be the parent of ${t.name}; amount equals the open ${c.charge_type.replace("_", " ")}.`,
        unallocated_amount: 0,
        allocations: [alloc(c, t, c.amount_due)],
        evidence: featured
          ? [
              {
                type: "company_lookup",
                ref: "Northgate Hospitality Group Ltd",
                quote:
                  "Northgate Hospitality Group Ltd — group member: Harbour & Finch Coffee Ltd",
              },
              {
                type: "charge",
                ref: c.id,
                quote: `${c.id} · rent · £4,850.00 outstanding`,
              },
              {
                type: "lease",
                ref: "Lease L-0087",
                quote: "Lease L-0087 · rent monthly in advance, due 1st",
              },
              {
                type: "bank_line",
                ref: "RENT SEPT",
                quote: "NORTHGATE HOSPITALITY GRP · RENT SEPT · £4,850.00",
              },
            ]
          : [
              {
                type: "company_lookup",
                ref: payer,
                quote: `${payer} — group member: ${t.name}`,
              },
              {
                type: "charge",
                ref: c.id,
                quote: `${c.id} · ${c.charge_type} · £${c.amount_due.toFixed(2)} outstanding`,
              },
              {
                type: "lease",
                ref: t.lease,
                quote: t.lease,
              },
              {
                type: "bank_line",
                ref: c.id,
                quote: `${payer} · £${c.amount_due.toFixed(2)}`,
              },
            ],
      });
    }
  }

  // 5 short payments T095–T099. Featured T096.
  for (let i = 95; i <= 99; i++) {
    const t = TENANTS[i - 1];
    const [rent, sc] = byTenant.get(t.id)!;
    const withhold = i === 96 ? 150 : round2(sc.amount_due * 0.3);
    const scPaid = round2(sc.amount_due - withhold);
    const amount = round2(rent.amount_due + scPaid);
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount,
      payer_name: bankName(t.name),
      reference: rent.id,
      method: "agent",
      status: "proposed",
      confidence: i === 96 ? 0.88 : 0.86,
      review_reason: "Short payment",
      reasoning:
        i === 96
          ? "Payment covers rent in full and service charge less £150.00, which matches the amount the tenant disputed on 14 September."
          : `Payment covers rent in full and service charge less £${withhold.toFixed(2)}, matching the open dispute note.`,
      unallocated_amount: 0,
      allocations: [
        alloc(rent, t, rent.amount_due),
        alloc(sc, t, scPaid, sc.amount_due),
      ],
      evidence: [
        {
          type: "tenant_note",
          ref: t.id,
          quote:
            t.note ??
            `Disputing £${withhold.toFixed(2)} of September service charge`,
        },
        {
          type: "charge",
          ref: rent.id,
          quote: `${rent.id} · rent · £${rent.amount_due.toFixed(2)} outstanding`,
        },
        {
          type: "charge",
          ref: sc.id,
          quote: `${sc.id} · service charge · £${sc.amount_due.toFixed(2)} outstanding`,
        },
        {
          type: "bank_line",
          ref: rent.id,
          quote: `${bankName(t.name)} · ${rent.id} · £${amount.toFixed(2)}`,
        },
      ],
    });
  }

  // 5 agent approved bad references: T100–T102 (rent+sc mix → 5 lines)
  const bad = [
    TENANTS[99],
    TENANTS[100],
    TENANTS[101],
    TENANTS[99],
    TENANTS[100],
  ];
  bad.forEach((t, idx) => {
    const [rent, sc] = byTenant.get(t.id)!;
    const c = idx % 2 === 0 ? rent : sc;
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount: c.amount_due,
      payer_name: bankName(t.name),
      reference: idx % 2 === 0 ? "RENT PAYMENT" : "SC SEPT",
      method: "agent",
      status: "approved",
      confidence: 0.9 + idx * 0.01,
      review_reason: null,
      reasoning: `Reference is incomplete, but payer name and amount match open ${c.charge_type.replace("_", " ")} for ${t.name}.`,
      unallocated_amount: 0,
      allocations: [alloc(c, t, c.amount_due)],
      evidence: [
        {
          type: "charge",
          ref: c.id,
          quote: `${c.id} · £${c.amount_due.toFixed(2)} outstanding`,
        },
        {
          type: "bank_line",
          ref: "bad-ref",
          quote: `${bankName(t.name)} · incomplete reference · £${c.amount_due.toFixed(2)}`,
        },
      ],
    });
  });

  // 3 overpayments T103–T105
  for (let i = 103; i <= 105; i++) {
    const t = TENANTS[i - 1];
    const [rent] = byTenant.get(t.id)!;
    const amount = round2(rent.amount_due + 250);
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount,
      payer_name: bankName(t.name),
      reference: rent.id,
      method: "agent",
      status: "proposed",
      confidence: 0.84,
      review_reason: "Overpayment",
      reasoning: `Payment exceeds open rent by £250.00 with no matching open charge for the surplus.`,
      unallocated_amount: 250,
      allocations: [alloc(rent, t, rent.amount_due)],
      evidence: [
        {
          type: "charge",
          ref: rent.id,
          quote: `${rent.id} · rent · £${rent.amount_due.toFixed(2)} outstanding`,
        },
        {
          type: "bank_line",
          ref: rent.id,
          quote: `${bankName(t.name)} · ${rent.id} · £${amount.toFixed(2)}`,
        },
      ],
    });
  }

  // 2 unidentified
  for (let i = 0; i < 2; i++) {
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount: round2(1200 + i * 340),
      payer_name: bankName(`UNKNOWN PAYER ${i + 1}`),
      reference: "PAYMENT",
      method: "agent",
      status: "proposed",
      confidence: 0.4,
      review_reason: "Unidentified receipt",
      reasoning:
        "No tenant, lease or open charge matches this payer name, reference or amount.",
      unallocated_amount: round2(1200 + i * 340),
      allocations: [],
      evidence: [
        {
          type: "bank_line",
          ref: "PAYMENT",
          quote: `UNKNOWN PAYER ${i + 1} · PAYMENT · no candidate charges`,
        },
      ],
    });
  }

  // Pad/truncate to 200
  while (lines.length > 200) lines.pop();
  while (lines.length < 200) {
    const t = TENANTS[0];
    const [rent] = byTenant.get(t.id)!;
    lines.push({
      id: id(),
      statement_month: month,
      date: dateFor(month, seq),
      amount: rent.amount_due,
      payer_name: bankName(t.name),
      reference: rent.id,
      method: "exact",
      status: "approved",
      confidence: 1,
      review_reason: null,
      reasoning: null,
      unallocated_amount: 0,
      allocations: [alloc(rent, t, rent.amount_due)],
      evidence: [
        { type: "rule", ref: rent.id, quote: `Reference and amount match ${rent.id}` },
      ],
    });
  }

  return lines;
}

const FINALS: Record<string, LineView[]> = {
  "2026-09": finalLines("2026-09"),
  "2026-10": finalLines("2026-10"),
};

type Store = {
  lines: Record<string, LineView[]>;
  ran: Record<string, boolean>;
  aliases: Alias[];
  audit: AuditRow[];
  progress: RunProgress;
};

function pristineLines(month: string): LineView[] {
  return FINALS[month].map((l) => ({
    ...l,
    method: null,
    status: null,
    confidence: null,
    review_reason: null,
    reasoning: null,
    unallocated_amount: l.amount,
    allocations: [],
    evidence: [],
  }));
}

function cloneStore(): Store {
  return {
    lines: {
      "2026-09": pristineLines("2026-09"),
      "2026-10": pristineLines("2026-10"),
    },
    ran: { "2026-09": false, "2026-10": false },
    aliases: [],
    audit: [],
    progress: { stage: "idle", percent: 0 },
  };
}

let store = cloneStore();

function summarize(month: string): RunSummary {
  const lines = store.lines[month];
  const total_value = round2(lines.reduce((s, l) => s + l.amount, 0));
  const methods: Method[] = ["exact", "memory", "agent", "human"];
  const by_method = methods.map((method) => {
    const subset = lines.filter(
      (l) => l.method === method && l.status === "approved",
    );
    return {
      method,
      lines: subset.length,
      value: round2(subset.reduce((s, l) => s + l.amount, 0)),
    };
  });
  const in_queue = lines.filter((l) => l.status === "proposed").length;
  const unallocated_value = round2(
    lines
      .filter((l) => l.status === "proposed" || l.status === null)
      .reduce((s, l) => s + (l.unallocated_amount || (l.status === null ? l.amount : 0)), 0),
  );
  const approved = lines.filter((l) => l.status === "approved").length;
  return {
    month,
    total_lines: lines.length,
    total_value,
    by_method,
    in_queue,
    unallocated_value,
    score: store.ran[month]
      ? {
          auto_rate: approved / lines.length,
          precision: 0.99,
          wrong_allocations: 0,
        }
      : undefined,
  };
}

export const mockApi = {
  getProgress(): RunProgress {
    return store.progress;
  },

  async getLines(month: string): Promise<LineView[]> {
    return store.lines[month]?.map((l) => ({ ...l, allocations: [...l.allocations], evidence: [...l.evidence] })) ?? [];
  },

  async getSummary(month: string): Promise<RunSummary> {
    return summarize(month);
  },

  async runStatement(
    month: string,
    onProgress?: (p: RunProgress) => void,
  ): Promise<RunSummary> {
    const emit = (stage: RunProgress["stage"], percent: number) => {
      store.progress = { stage, percent };
      onProgress?.(store.progress);
    };

    const resolve = (f: LineView): LineView => {
      if (
        month === "2026-10" &&
        f.review_reason === "New payer relationship" &&
        store.aliases.some((a) => a.payer === f.payer_name)
      ) {
        return {
          ...f,
          method: "memory",
          status: "approved",
          confidence: 1,
          review_reason: null,
          reasoning: `Matched from memory: ${f.payer_name} pays for ${f.allocations[0]?.tenant_name}.`,
          evidence: [
            {
              type: "alias",
              ref: f.payer_name,
              quote: `${f.payer_name} → ${f.allocations[0]?.tenant_id} (approved last month)`,
            },
            ...f.evidence.filter((e) => e.type !== "company_lookup"),
          ],
        };
      }
      return { ...f };
    };

    emit("exact", 20);
    await wait(400);
    store.lines[month] = FINALS[month].map((f, i) =>
      f.method === "exact" ? resolve(f) : store.lines[month][i],
    );

    emit("memory", 55);
    await wait(400);
    store.lines[month] = FINALS[month].map((f, i) => {
      const resolved = resolve(f);
      if (resolved.method === "memory") return resolved;
      if (f.method === "exact") return resolve(f);
      return store.lines[month][i];
    });

    emit("agent", 85);
    await wait(600);
    store.lines[month] = FINALS[month].map((f) => resolve(f));
    store.ran[month] = true;
    emit("done", 100);
    store.audit.unshift({
      ts: new Date().toISOString(),
      actor: "system",
      action: "run",
      object_id: month,
      detail: summarize(month),
    });
    return summarize(month);
  },

  async approveLine(id: string): Promise<{ remembered?: string }> {
    let remembered: string | undefined;
    for (const month of Object.keys(store.lines)) {
      const line = store.lines[month].find((l) => l.id === id);
      if (!line) continue;
      line.status = "approved";
      if (line.method === null) line.method = "human";
      if (
        line.review_reason === "New payer relationship" &&
        line.allocations[0]
      ) {
        const tenant = line.allocations[0];
        if (!store.aliases.some((a) => a.payer === line.payer_name)) {
          store.aliases.push({
            payer: line.payer_name,
            tenant_id: tenant.tenant_id,
          });
        }
        remembered = `Remembered: ${line.payer_name} pays for ${tenant.tenant_name}`;
      }
      line.review_reason = null;
      store.audit.unshift({
        ts: new Date().toISOString(),
        actor: "human",
        action: "approved",
        object_id: id,
        detail: { remembered: remembered ?? null },
      });
      break;
    }
    return { remembered };
  },

  async rejectLine(id: string): Promise<void> {
    for (const month of Object.keys(store.lines)) {
      const line = store.lines[month].find((l) => l.id === id);
      if (!line) continue;
      line.status = "rejected";
      store.audit.unshift({
        ts: new Date().toISOString(),
        actor: "human",
        action: "rejected",
        object_id: id,
        detail: {},
      });
      break;
    }
  },

  async getArrears(month = "2026-09"): Promise<ArrearsRow[]> {
    const charges = chargesFor(month);
    const paid = new Map<string, number>();
    for (const line of store.lines[month] ?? []) {
      if (line.status !== "approved") continue;
      for (const a of line.allocations) {
        paid.set(a.charge_id, round2((paid.get(a.charge_id) ?? 0) + a.allocated));
      }
    }
    const asOf = new Date("2026-11-12T00:00:00Z");
    const rows = new Map<string, ArrearsRow>();
    for (const c of charges) {
      const outstanding = round2(c.amount_due - (paid.get(c.id) ?? 0));
      if (outstanding <= 0) continue;
      const t = TENANTS.find((x) => x.id === c.tenant_id)!;
      const row =
        rows.get(t.id) ??
        ({
          tenant_id: t.id,
          tenant_name: t.name,
          unit: t.unit,
          outstanding: 0,
          oldest_due_date: c.due_date,
          days_overdue: 0,
          disputed: Boolean(t.note),
          dispute_note: t.note ?? null,
          lease_citation: t.lease,
          open_charges: [],
        } satisfies ArrearsRow);
      row.outstanding = round2(row.outstanding + outstanding);
      if (c.due_date < row.oldest_due_date) row.oldest_due_date = c.due_date;
      row.open_charges.push({
        charge_id: c.id,
        charge_type: c.charge_type,
        period: c.period,
        outstanding,
      });
      rows.set(t.id, row);
    }
    return [...rows.values()]
      .map((r) => {
        const due = new Date(`${r.oldest_due_date}T00:00:00Z`);
        r.days_overdue = Math.max(
          0,
          Math.floor((asOf.getTime() - due.getTime()) / 86400000),
        );
        return r;
      })
      .sort((a, b) => b.outstanding - a.outstanding);
  },

  async getAudit(): Promise<AuditRow[]> {
    return [...store.audit];
  },

  async reset(): Promise<void> {
    store = cloneStore();
  },
};

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
