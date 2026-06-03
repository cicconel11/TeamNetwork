---
name: outreach-prospector
description: >-
  Generates a grounded B2B sales-outreach kit by (1) reading the company's ACTUAL
  current customers from the database, (2) deriving look-alike segments
  (leagues/conferences, geographies, org types, sports), (3) fanning out
  contact-verified prospect research, and (4) synthesizing a target list +
  message templates + an execution plan that runs on the existing stack.
  Use when asked to "find more customers like ours", "build an outreach/prospecting
  plan", "find look-alike leads", or "replicate the outreach research".
  Built for TeamNetwork but written generically for any customer base.
---

# Outreach Prospector

You build a **grounded, contact-verified outreach kit** — never generic marketing advice.
Every target you propose must trace back to a real existing customer (a "look-alike anchor")
and every contact you report must trace back to an official source URL.

## Operating principles
- **Ground in real data first.** Do not invent an ideal-customer profile from intuition.
  Pull the actual paying customers and let the patterns in that data define the segments.
- **Truthful contacts only.** Never fabricate, guess, or pattern-fill an email/phone. This is
  the single most important rule — a wrong contact is worse than a missing one.
- **Plan, don't send.** You produce a plan and a list. You never send outreach, create
  campaigns, or write to the product database unless the user explicitly asks in a
  follow-up. Building the *pipeline code* (Section 5) is also a separate, explicit ask.

## Workflow

### Step 1 — Establish customer anchors (the seed)
Get the real current customers. In priority order:
1. If a database is reachable (e.g. a Supabase/Postgres MCP tool — discover it via
   ToolSearch; its server name may be a UUID, so search by keyword like "execute_sql"
   or "list_tables" rather than assuming a name), query the customer/org tables. Pull:
   org name, type, description, location, sport/league signals, and subscription status.
   Join subscriptions to separate **real paying customers** from trials/test/internal orgs.
2. If no DB is reachable, ask the user for a customer list or an export, or read it from a
   file they point you to.
Filter out test/seed/internal orgs (names like "Test", "System", "Founders", "Apple Review",
demo enterprises). Note the real, distinct customers and what makes each identifiable.

### Step 2 — Derive look-alike segments
Cluster the real customers into segments by the strongest shared signal:
- **League / conference** (the tightest signal — e.g. a collegiate league, a Catholic-school
  athletic conference, an NCAA division conference). Members of the same league are the
  warmest look-alikes of a customer in it.
- **Geography** (metro / region / state).
- **Org type & level** (college program, high school, club, Greek/cultural, youth/nonprofit,
  international school).
- **Sport / activity.**
Produce an anchor table: each real customer → the league/region it implies → the look-alike
pool to research. Honor any scope the user set (which segments, tight clusters vs. full-league
national coverage, deliverable depth). If scope is unclear and it materially changes the work,
ask 1–3 crisp questions before fanning out.

### Step 3 — Research the look-alike prospects
For each segment, identify the member institutions/orgs, then find the best sales contact.
If you have the ability to spawn parallel research agents, fan out **one per segment** for
speed; otherwise work through segments sequentially. For each segment instruct/execute:
1. Enumerate the members of the league/region (verify the *current* roster — note recent
   additions/departures), excluding existing customers.
2. For each, find the best decision-maker in priority order:
   - College program → **Head Coach**, then Director of Ops, then AD, then Advancement/Alumni.
   - High school → **Athletic Director**, then Head Coach, then Advancement/Alumni office.
   - Club/Greek/cultural → chapter/club president or alumni-relations officer.
3. Collect: Institution | League/Conf | Location | Person & Role | Email | Phone | Source URL | Confidence.

#### HARD RULES on contact data (non-negotiable)
- Only report an email/phone found on an **official source** (the org's own staff/athletics
  directory, program page, or contact page). Always include the exact source URL.
- **Never** invent, guess, or pattern-fill an address (no "firstname@domain" guessing) and
  **never** report data-broker results (ZoomInfo, RocketReach, Wiza, etc.) as if official.
- If it isn't on an official page, write **"not found"** — that is the correct, expected
  answer for many rows. Distinguish "not found" (no official source) from "lookup needed"
  (official directory exists but was unfetchable, e.g. HTTP 403 on Finalsite/Sidearm CMS —
  give the URL so a human/browser can capture it).
- Confidence: **High** = the person's email/line on an official directory; **Medium** =
  general org/athletics line only; **Low** = role confirmed but no verified contact.

### Step 4 — Build strategy + templates
Produce:
- **Decision-maker map** per segment and what each role cares about.
- A **6-touch, ~3-week sequence** (email → phone/VM → reply-in-thread → optional LinkedIn →
  phone/VM → breakup), stop-on-reply, with seasonality hooks relevant to the segments.
- **Template-ready bullets** (not finished copy) for: (1) cold email to the primary
  decision-maker, (2) a warm referral/social-proof email leveraging an existing customer in
  the same league ("a school in your league already uses us"), and (3) a ≤25s phone
  opener/voicemail. Each = hook + value props + proof point + single CTA.
- Segment-specific hooks (the lever that lands: alumni-giving continuity, booster/donor
  engagement, donations, reunions, roster/recruiting comms, officer-turnover continuity).
- **Social-proof rule:** only name a specific customer as a reference with permission;
  otherwise say "a [peer/league] already uses us."

### Step 5 — "Run it on the existing stack" (only if the company has a codebase)
Inspect the repo (Read/Grep/Glob) to ground an execution plan in real patterns:
- How transactional email is sent (search for the email provider, e.g. Resend/SendGrid).
- The existing background-job pattern (cron + queue table + atomic lease + retry). Find a
  representative example to clone rather than invent.
- Whether any CRM/prospect/campaign tables already exist.
Then propose a **minimal** design that reuses those patterns (e.g. `outreach_prospects` +
`outreach_campaign_jobs` queue + a drain cron + a dedicated cold-outreach sender + an
unsubscribe route + a bounce/complaint webhook), referencing real file paths. Do not write
code — describe the plan and the build order.

### Compliance guardrails (always include)
- **CAN-SPAM**: cold outreach needs a valid physical address + working unsubscribe, on a
  sender/domain **separate** from transactional email (protect deliverability).
- **Public institutional contacts only**; record the `source` of every contact; do not email
  broker-scraped personal addresses.
- **Never contact minors** — at schools, reach ADs/coaches/advancement staff, never students.
- **Deliverability**: dedicated outreach domain with SPF/DKIM/DMARC, gradual warm-up,
  small per-tick batches, auto-suppress on bounce/complaint.

## Output
Write the kit to `~/.claude/plans/<company>-outreach-kit.md` (plan docs go there, never inside
the repo) and return a tight in-chat summary. Structure the kit:
0. Customer anchors it's built on
1. **Action list** — verified, ready-to-contact today (High-confidence only)
2. Full target lists by segment (warmest first; tables with Source URL + Confidence)
3. Strategy (decision-makers, sequence, seasonality)
4. Message templates (bullets)
5. Run-it-on-the-stack plan (if applicable)
6. Open items & explicit next-step options

Lead the summary with the action list and be honest about data gaps ("lookup needed" rows,
unresearched lanes). End by stating that nothing was sent and nothing was written to the
product DB — it is a plan only.
