// MCP endpoint so the Grok Bot desktop app can work the cash queue as a tool user (custom connector, Remote HTTPS).
// Stateless JSON-RPC over HTTP POST: initialize, tools/list, tools/call. Same in-process store as the UI routes, so
// whatever Grok Bot proposes shows up in the app's Exceptions queue.
//
// Grok Bot can run a month, read the queue, propose an allocation (code checks it) and explain a line.
// It can NOT approve: approving stays with a person in the app. Every write is audited as actor "grok_bot".
// The answer key (case types, true allocations, scores against truth) is never returned.
//
// Auth: MCP_TOKEN in .env, as "Authorization: Bearer <token>", "?key=<token>", or the path /api/mcp/<token>
// (Grok Bot's custom connector drops query strings, so use the path form there).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arrears, exceptions, explain, hydrate, HttpError, loadStatement, metrics, propose, QUEUE_BELOW, run, store } from "@/lib/cash/service";
import { saveAudit } from "@/lib/cash/persist";
import { chaseSplit, draftChaser } from "@/lib/chaser";
import type { ArrearsRow } from "@/lib/types";
import { agentRun } from "@/lib/cash/agentRun";
import { existsSync } from "node:fs";
import type { Store } from "@/lib/cash/service";
import { dbEnabled, withDb } from "@/lib/supabase-store";

// The store this request works on: Supabase-backed (same as the UI routes) when configured, else in memory.
let current: Store | null = null;
const cur = () => current ?? store();
const WRITE_TOOLS = new Set(["run_month", "propose_allocation", "review_line", "draft_chasers"]);

const MONTHS = ["2026-09", "2026-10"] as const;
const PROTOCOL = "2025-06-18";

const tools = [
  {
    name: "run_month",
    description:
      "Load the bank statement for a month and run the rule and memory passes (exact reference, duplicate guard, name and sum, remembered payers). Returns how many lines each pass settled and how many are left for review.",
    inputSchema: { type: "object", properties: { month: { type: "string", enum: MONTHS } }, required: ["month"] },
  },
  {
    name: "list_exceptions",
    description:
      "Bank lines no rule could settle, each with up to 15 candidate open charges, plus tenant notes (disputes), company group lookups and remembered payers. Use this before proposing.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "max lines, default 5" } } },
  },
  {
    name: "propose_allocation",
    description:
      "Propose how one bank line should be allocated. Amounts in pounds. allocations plus unallocated_amount must equal the receipt exactly; code rejects anything else. Confidence under 0.7 waits for a person. A payer who isn't the tenant always needs a person's approval in the app. Every claim in reasoning needs an evidence quote copied from the inputs.",
    inputSchema: {
      type: "object",
      properties: {
        bank_line_id: { type: "string" },
        allocations: {
          type: "array",
          items: { type: "object", properties: { charge_id: { type: "string" }, amount: { type: "number" } }, required: ["charge_id", "amount"] },
        },
        unallocated_amount: { type: "number" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string" }, ref: { type: "string" }, quote: { type: "string" } },
            required: ["type", "ref", "quote"],
          },
        },
      },
      required: ["bank_line_id", "allocations", "unallocated_amount", "confidence", "reasoning", "evidence"],
    },
  },
  {
    name: "list_review_queue",
    description:
      "Lines waiting for a person (proposed but not approved) and lines held open, each with its proposal, reasoning, evidence and audit trail, plus the tenant notes, company group lookups and remembered payers you need to review them.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "review_line",
    description:
      "Record your review of one waiting or held line for the person who approves it: recommend approve, reject or needs_info, with a short note and supporting quotes copied word for word from the line's data (bank line, charges, lease citation, tenant notes, company lookup). Quotes that aren't found in the data are refused. You can't approve; the person does, in the app.",
    inputSchema: {
      type: "object",
      properties: {
        bank_line_id: { type: "string" },
        recommendation: { type: "string", enum: ["approve", "reject", "needs_info"] },
        note: { type: "string", description: "one or two sentences a credit controller can read" },
        quotes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string", enum: ["bank_line", "charge", "lease", "tenant_note", "company_lookup", "alias"] },
              ref: { type: "string" },
              quote: { type: "string" },
            },
            required: ["source", "ref", "quote"],
          },
        },
      },
      required: ["bank_line_id", "recommendation", "note", "quotes"],
    },
  },
  {
    name: "explain_line",
    description: "Why a bank line was allocated the way it was: method, charges, evidence, reasoning, who decided and when, and its audit trail.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "bank line id, e.g. B2609-006" } }, required: ["id"] },
  },
  {
    name: "arrears",
    description: "Open amount per tenant after allocation, oldest due first (or most money first).",
    inputSchema: { type: "object", properties: { sort: { type: "string", enum: ["oldest", "amount"] }, limit: { type: "number" } } },
  },
  {
    name: "draft_chasers",
    description:
      "Chaser emails for tenants still in arrears after allocation, one per tenant: subject and body, written by the app's own chaser template (the same text as the Arrears screen's Draft chaser). Disputed service charge is held back, not demanded. Use these to create email drafts for the person to review; never send without asking. Tenants have no email address on file, so leave the To line for the person.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "max tenants, default 5, most money first" } } },
  },
  {
    name: "summary",
    description: "Lines by method (exact, memory, agent, human), held, waiting for approval, still open, and the auto-match rate.",
    inputSchema: { type: "object", properties: {} },
  },
];

type Args = Record<string, unknown>;

// A payer who isn't the tenant and isn't remembered yet is a new payer relationship: it always waits for one
// person's approval in the app (Handoff 2), and that approval is what teaches memory for next month.
const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normName = (x: string) => norm(x).replace(/(LTD|LIMITED|PLC|LLP|UK)+$/, "");
const nameMatch = (a: string, b: string) => {
  const x = normName(a), y = normName(b);
  return x === y || (Math.min(x.length, y.length) >= 8 && (x.startsWith(y) || y.startsWith(x)));
};
function isNewPayerRelationship(args: Args): boolean {
  const s = cur();
  const line = s.bankLines.find((b) => b.id === args.bank_line_id);
  const allocs = Array.isArray(args.allocations) ? (args.allocations as { charge_id: string }[]) : [];
  if (!line || !allocs.length) return false;
  if (s.aliases.some((a) => a.payer_name.toUpperCase() === line.payer_name.toUpperCase())) return false;
  const tids = new Set(allocs.map((a) => s.charges.find((c) => c.id === a.charge_id)?.tenant_id));
  return [...tids].some((tid) => {
    const t = s.tenants.find((x) => x.tenant_id === tid);
    return !t || !nameMatch(line.payer_name, t.tenant_name);
  });
}

const squash = (x: string) => x.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();

// The company group lookup (which group pays for which tenant), from the team sample. The reviewer needs it to tie a
// parent company's payment to its subsidiary.
function companyLookup(): unknown[] {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", "sample", "company_lookup.json"), "utf8"));
  } catch {
    return [];
  }
}

// Everything a reviewer could legitimately quote for one line: its explain payload plus the reference data.
function reviewContext(id: string) {
  const s = cur();
  const e = exceptions(s);
  return { line: explain(s, id), tenant_notes: e.tenant_notes, company_lookup: companyLookup(), aliases: e.aliases, tenants: e.tenants };
}

function reviewQueue() {
  const s = cur();
  const e = exceptions(s);
  const held = s.holds.map((h) => h.bank_line_id).filter((id, i, a) => a.indexOf(id) === i);
  // Tenants behind every waiting or held line, with their parent company from the lookup.
  const ids = new Set([...e.waiting_for_approval.map((w) => (w as { bank_line: { id: string } }).bank_line.id), ...held]);
  const tids = new Set(s.allocations.filter((a) => ids.has(a.bank_line_id)).map((a) => s.charges.find((c) => c.id === a.charge_id)?.tenant_id));
  return {
    waiting_for_approval: e.waiting_for_approval,
    held: held.map((id) => explain(s, id)),
    company_lookup: companyLookup(),
    tenants: s.tenants.filter((t) => tids.has(t.tenant_id)).map(({ tenant_id, tenant_name, parent_company, unit }) => ({ tenant_id, tenant_name, parent_company, unit })),
    tenant_notes: e.tenant_notes,
    aliases: e.aliases,
  };
}

function reviewLine(args: Args) {
  const s = cur();
  const id = String(args.bank_line_id);
  const rec = String(args.recommendation);
  if (!["approve", "reject", "needs_info"].includes(rec)) throw new HttpError(400, "recommendation must be approve, reject or needs_info");
  const proposed = s.allocations.filter((a) => a.bank_line_id === id && a.status === "proposed");
  const holds = s.holds.filter((h) => h.bank_line_id === id);
  if (!proposed.length && !holds.length) throw new HttpError(409, `${id} isn't waiting for a person or held`);
  // No source, no figure: every quote must appear in the data for this line.
  const haystack = squash(JSON.stringify(reviewContext(id)) + JSON.stringify(exceptions(s)) + JSON.stringify(reviewQueue()));
  const quotes = Array.isArray(args.quotes) ? (args.quotes as { source: string; ref: string; quote: string }[]) : [];
  const missing = quotes.filter((q) => !q.quote || !haystack.includes(squash(q.quote)));
  if (!quotes.length || missing.length) {
    throw new HttpError(422, missing.length ? `quote not found in the data: "${missing[0].quote}". Copy quotes word for word.` : "add at least one supporting quote");
  }
  const label = rec === "approve" ? "RECOMMEND APPROVE" : rec === "reject" ? "RECOMMEND REJECT" : "NEEDS MORE INFO";
  const items = [
    { type: "grok_bot", ref: `Grok Bot review: ${label}`, quote: String(args.note ?? "") },
    ...quotes.map((q) => ({ type: q.source, ref: q.ref, quote: q.quote })),
  ] as unknown as (typeof proposed)[number]["evidence"];
  for (const a of proposed) a.evidence = [...items, ...a.evidence.filter((x) => (x as { type: string }).type !== "grok_bot")];
  for (const h of holds) h.evidence = [...items, ...h.evidence.filter((x) => (x as { type: string }).type !== "grok_bot")];
  const row = { at: new Date().toISOString(), actor: "grok_bot" as const, action: "grok_bot_review", bank_line_id: id, detail: { recommendation: rec, note: args.note, quotes } };
  s.audit.push(row);
  saveAudit(row);
  return { bank_line_id: id, recorded: label, quotes_checked: quotes.length, shown_to_person_in: "Exceptions, evidence panel" };
}

function statementCsv(month: string) {
  if (!MONTHS.includes(month as (typeof MONTHS)[number])) throw new HttpError(400, `month must be one of ${MONTHS.join(", ")}`);
  return readFileSync(join(process.cwd(), "data", "sample", `bank_${month.replace("-", "_")}.csv`), "utf8");
}

async function runMonth(s: Store, month: string, touch?: (m: string) => void) {
  touch?.(month);
  const csv = statementCsv(month);
  const loaded = s.bankLines.some((b) => (b.statement_month ?? b.date.slice(0, 7)) === month) ? { added: 0 } : loadStatement(s, csv, "grok_bot");
  const passes = run(s, month);
  // Same as the app's Run: pass 3 replayed from the saved grok-4.7 run, so Grok Bot and the screens see one queue.
  const replay = `results/${month}.json`;
  const agent = passes.left_open && existsSync(join(process.cwd(), replay)) ? await agentRun(s, { month, replay }) : null;
  return { month, ...loaded, ...passes, pass3_replayed: Boolean(agent) };
}

async function callTool(name: string, args: Args, runStore?: Store, touch?: (m: string) => void): Promise<unknown> {
  const s = cur();
  switch (name) {
    case "run_month":
      return runMonth(runStore ?? s, String(args.month), touch);
    case "list_exceptions": {
      const e = exceptions(s);
      const limit = Number(args.limit ?? 5);
      return { total_open: e.open_lines.length, open_lines: e.open_lines.slice(0, limit), waiting_for_approval: e.waiting_for_approval.length, tenants: e.tenants, tenant_notes: e.tenant_notes, aliases: e.aliases };
    }
    case "propose_allocation": {
      // The engine itself sends a payer who isn't the tenant (and isn't remembered) to a person, with review_reason.
      return propose(s, args as unknown as Parameters<typeof propose>[1], "grok_bot");
    }
    case "list_review_queue":
      return reviewQueue();
    case "review_line":
      return reviewLine(args);
    case "explain_line":
      return explain(s, String(args.id));
    case "arrears": {
      const a = arrears(s, args.sort === "amount" ? "amount" : "oldest") as Record<string, unknown> & { arrears?: unknown[] };
      const limit = Number(args.limit ?? 10);
      return Array.isArray(a.arrears) ? { ...a, arrears: a.arrears.slice(0, limit) } : a;
    }
    case "draft_chasers": {
      const a = arrears(s, "amount") as unknown as { arrears?: ArrearsRow[] };
      const rows = (a.arrears ?? []).slice(0, Number(args.limit ?? 5));
      const drafts = rows.map((row) => {
        const { subject, body } = draftChaser(row);
        const held = chaseSplit(row).heldBack.reduce((sum, c) => sum + c.outstanding, 0);
        return { tenant_id: row.tenant_id, tenant: row.tenant_name, unit: row.unit, outstanding: row.outstanding, held_back_disputed: Math.round(held * 100) / 100, subject, body };
      });
      const audit = { at: new Date().toISOString(), actor: "grok_bot" as const, action: "chasers_drafted", detail: { tenants: drafts.map((d) => d.tenant_id) } };
      s.audit.push(audit);
      saveAudit(audit);
      return { drafts, note: "Drafts only. Nothing is sent. A person reviews and sends." };
    }
    case "summary": {
      const { against_truth: _hidden, ...m } = metrics(s) as Record<string, unknown>; // never show the answer key
      return m;
    }
    default:
      throw new HttpError(404, `unknown tool ${name}`);
  }
}

function authorised(req: Request, pathKey?: string) {
  const token = process.env.MCP_TOKEN;
  if (!token) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = new URL(req.url).searchParams.get("key");
  return bearer === token || key === token || pathKey === token;
}

const rpc = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleMcp(req: Request, pathKey?: string) {
  if (!authorised(req, pathKey)) return Response.json({ error: "unauthorised" }, { status: 401 });
  let msg: { id?: unknown; method?: string; params?: { name?: string; arguments?: Args; protocolVersion?: string } };
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications, e.g. notifications/initialized
  await hydrate();
  switch (msg.method) {
    case "initialize":
      return rpc(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "paper-trail-cash", version: "1.0.0" },
        instructions:
          "Cash application for a UK property manager. Run a month, read the exceptions, propose allocations with evidence quoted from the inputs. Never guess: leaving a receipt unallocated is a correct answer. A person approves in the app.",
      });
    case "ping":
      return rpc(msg.id, {});
    case "tools/list":
      return rpc(msg.id, { tools });
    case "tools/call": {
      try {
        const name = String(msg.params?.name);
        const args = msg.params?.arguments ?? {};
        let out: unknown;
        if (dbEnabled()) {
          // Load from Supabase, run the tool, save back (writes only), exactly like the UI routes.
          const res = await withDb(`MCP ${name}`, async (s, ctx) => {
            current = ctx.view();
            try {
              return await callTool(name, args, s, ctx.touchMonth);
            } finally {
              current = null;
            }
          }, { write: WRITE_TOOLS.has(name) });
          out = await res.json();
          if (!res.ok) throw new Error((out as { error?: string })?.error ?? `HTTP ${res.status}`);
        } else {
          out = await callTool(name, args);
        }
        return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return rpc(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

