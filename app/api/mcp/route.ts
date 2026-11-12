// MCP endpoint so the Grok Bot desktop app can work the cash queue as a tool user (custom connector, Remote HTTPS).
// Stateless JSON-RPC over HTTP POST: initialize, tools/list, tools/call. Same in-process store as the UI routes, so
// whatever Grok Bot proposes shows up in the app's Exceptions queue.
//
// Grok Bot can run a month, read the queue, propose an allocation (code checks it) and explain a line.
// It can NOT approve: approving stays with a person in the app. Every write is audited as actor "grok_bot".
// The answer key (case types, true allocations, scores against truth) is never returned.
//
// Auth: MCP_TOKEN in .env, sent as "Authorization: Bearer <token>" or "?key=<token>" on the connector URL.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arrears, exceptions, explain, hydrate, HttpError, loadStatement, metrics, propose, QUEUE_BELOW, run, store } from "@/lib/cash/service";

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
  const s = store();
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

function statementCsv(month: string) {
  if (!MONTHS.includes(month as (typeof MONTHS)[number])) throw new HttpError(400, `month must be one of ${MONTHS.join(", ")}`);
  return readFileSync(join(process.cwd(), "data", "sample", `bank_${month.replace("-", "_")}.csv`), "utf8");
}

function callTool(name: string, args: Args): unknown {
  const s = store();
  switch (name) {
    case "run_month": {
      const loaded = loadStatement(s, statementCsv(String(args.month)), "grok_bot");
      return { month: args.month, ...loaded, ...run(s) };
    }
    case "list_exceptions": {
      const e = exceptions(s);
      const limit = Number(args.limit ?? 5);
      return { total_open: e.open_lines.length, open_lines: e.open_lines.slice(0, limit), waiting_for_approval: e.waiting_for_approval.length, tenants: e.tenants, tenant_notes: e.tenant_notes, aliases: e.aliases };
    }
    case "propose_allocation": {
      const gated = isNewPayerRelationship(args) && Number(args.confidence) >= QUEUE_BELOW;
      const body = gated ? { ...args, confidence: QUEUE_BELOW - 0.01 } : args;
      const out = propose(s, body as unknown as Parameters<typeof propose>[1], "grok_bot") as Record<string, unknown>;
      return gated ? { ...out, review_reason: "New payer relationship: a person approves once, then it's remembered", model_confidence: args.confidence } : out;
    }
    case "explain_line":
      return explain(s, String(args.id));
    case "arrears": {
      const a = arrears(s, args.sort === "amount" ? "amount" : "oldest") as Record<string, unknown> & { arrears?: unknown[] };
      const limit = Number(args.limit ?? 10);
      return Array.isArray(a.arrears) ? { ...a, arrears: a.arrears.slice(0, limit) } : a;
    }
    case "summary": {
      const { against_truth: _hidden, ...m } = metrics(s) as Record<string, unknown>; // never show the answer key
      return m;
    }
    default:
      throw new HttpError(404, `unknown tool ${name}`);
  }
}

function authorised(req: Request) {
  const token = process.env.MCP_TOKEN;
  if (!token) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = new URL(req.url).searchParams.get("key");
  return bearer === token || key === token;
}

const rpc = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
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
        const out = callTool(String(msg.params?.name), msg.params?.arguments ?? {});
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

export async function GET() {
  return new Response("paper-trail MCP endpoint: POST JSON-RPC here", { status: 405 });
}
