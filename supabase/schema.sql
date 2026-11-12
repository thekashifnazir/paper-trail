-- Paper Trail: Cash Application Agent schema (Handoff 1), plus company_lookup.
-- Run once in the Supabase SQL editor. Safe to re-run: drops and recreates.

drop table if exists audit_log, tenant_notes, payer_aliases, line_results, allocations,
  bank_lines, charges, tenants, company_lookup cascade;

create table tenants (
  id text primary key,            -- T001..T108
  name text not null,
  unit text,
  lease_id text,
  lease_citation text
);
create table charges (
  id text primary key,            -- same as invoice_ref
  tenant_id text references tenants(id),
  type text check (type in ('rent','service_charge')),
  period text,                    -- '2026-09'
  amount_due numeric(12,2),
  amount_paid numeric(12,2) default 0,
  due_date date,
  invoice_ref text unique
);
create table bank_lines (
  id text primary key,
  statement_month text,
  date date,
  amount numeric(12,2),
  payer_name text,
  reference text,
  case_type text,                 -- ground truth, never sent to the engine
  true_allocations jsonb,         -- [{charge_id, amount}]
  true_unallocated numeric(12,2)
);
create table allocations (
  id uuid primary key default gen_random_uuid(),
  bank_line_id text references bank_lines(id),
  charge_id text references charges(id),
  amount numeric(12,2),
  method text check (method in ('exact','memory','agent','human')),
  status text check (status in ('proposed','approved','rejected'))
);
create table line_results (
  bank_line_id text primary key references bank_lines(id),
  method text, status text, confidence numeric,
  unallocated_amount numeric(12,2),
  review_reason text, reasoning text,
  evidence jsonb, agent_raw jsonb
);
create table payer_aliases (
  payer_name_normalised text primary key,
  tenant_id text references tenants(id),
  source text, approved_at timestamptz default now()
);
create table tenant_notes (id serial primary key, tenant_id text, date date, note text);
create table audit_log (id serial primary key, ts timestamptz default now(),
  actor text, action text, object_id text, detail jsonb);

-- Not in Handoff 1's schema but the engine takes companyLookup as input.
create table company_lookup (
  payer_name text primary key,
  group_members jsonb not null,   -- ["Harbour Estates Ltd"]
  source text
);
