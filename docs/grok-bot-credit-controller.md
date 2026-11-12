# Grok Bot: the "Credit Controller" bot

How the demo's Grok Bot is set up. The bot itself lives in the Grok Bot desktop app (not in this repo), so this file
is how anyone recreates it. Tested 12 Nov 2026 about 21:15: it reviewed the 8 parent-company lines in September and
recommended approve on each, quoting the company group lookup; a person then approved in the app.

## 1. Connect Grok Bot to your running app

1. `.env.local`: `MCP_TOKEN=<any random string>` and `NEXT_PUBLIC_USE_MOCK=0` (plus the Supabase keys if you want memory to persist).
2. `npm run dev` (port 3000), then in a second terminal `cloudflared tunnel --url http://localhost:3000`.
3. Grok Bot: Connect apps → Add a custom connector → **Remote HTTPS**, name **Paper Trail**,
   URL `https://<your-tunnel>.trycloudflare.com/api/mcp/<MCP_TOKEN>`. No headers, no client ID.
   (Grok Bot drops `?key=` query strings, so the token goes in the path.)
4. It should show **9 tools**: run_month, list_exceptions, propose_allocation, list_review_queue, review_line,
   explain_line, arrears, draft_chasers, summary. If it shows fewer after a code change, Uninstall and add it again (there is no refresh).

## 2. Create the bot

Left bar **+** → name **Credit Controller** → make sure Paper Trail is switched on for it. Each bot keeps one running
conversation, so make a new bot for a clean take.

## 3. Prompts (demo order)

Run September in the app first (Cash application → 2026-09 → Run allocation): 188 of 200 settle, 12 wait for a person.

**Review the queue**

> You're a credit controller's assistant. Using Paper Trail, list the review queue. For each line waiting for approval, check the company group lookup, the tenant notes and the proposed charge, then record your review with the review_line tool: recommend approve, reject or needs_info, with a one-sentence note and at least two quotes copied word for word from the data (include the company lookup line when a parent company is paying). Don't approve anything yourself. When you're done, give me a short table: line, payer, tenant, amount, your recommendation.

Then in the app: Exceptions → a parent-company line → Grok Bot's review is in the evidence → **Approve** →
"Remembered: PREMIER GROUP PLC pays for Premier Ventures Ltd". October → Run → matched from memory.

**Chasers (step 7)**

> Using Paper Trail, draft chaser emails for the 3 tenants owing the most. Use the draft_chasers tool's subject and body as written, and save each as a draft in my email for me to review. Leave the To line empty. Don't send anything.

**Optional, for the video**

> Explain line B2609-001 in plain English for a credit controller, including your review.

> Show the top 5 arrears, oldest first.

## Rules the connector enforces

- Grok Bot can propose and review, never approve. A person approves in the app.
- A payer who isn't the tenant (and isn't remembered yet) always waits for a person (engine rule).
- Every review quote must appear in that line's data, or review_line refuses it (422 in the tool result).
- The answer key (case types, true allocations) is never returned to Grok Bot.
- Every Grok Bot write is in the audit log as `grok_bot`.

Between takes: `POST /api/reset` (the app's Reset button) clears the run, learned payers and the audit log in Supabase.
