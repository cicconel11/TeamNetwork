export const meta = {
  name: 'outreach-fanout-research',
  description: 'Fanout-And-Synthesize outreach research: one research agent per look-alike segment in parallel, adversarially verify each contact is on an official source, then dedup+synthesize into one combined prospect list. Grounded in real TeamNetwork customer anchors.',
  phases: [
    { title: 'Research', detail: 'one agent per segment, parallel, trusted-source priority' },
    { title: 'Verify', detail: 'adversarially re-check each contact is official + adult' },
    { title: 'Synthesize', detail: 'dedup across segments, combined prospect list' },
  ],
}

// Real segments derived from live paying-customer anchors (queried from the DB).
// Each is a look-alike pool of an actual TeamNetwork customer.
const SEGMENTS = (args && args.segments) ? args.segments : [
  {
    key: 'mac-freedom-baseball',
    anchor: 'FDU-Florham Baseball (NCAA D-III, MAC Freedom)',
    channel: 'email',
    brief: 'MAC Freedom Conference baseball programs (NCAA D-III, NJ/PA). Members per the official conference site: DeSales, Delaware Valley, King\'s College (PA), Lebanon Valley, Misericordia, Stevens Institute of Technology. EXCLUDE FDU-Florham (already a customer). For each, the decision-maker is the Head Baseball Coach. Collegiate Sidearm athletics directories (athletics.<school>.edu) usually expose coach emails — primary channel is EMAIL, but also capture the official phone.',
  },
  {
    key: 'chsaa-nyc-catholic-hs',
    anchor: 'Fordham Prep Football + St. Raymond Basketball (CHSAA, NYC Catholic HS)',
    channel: 'phone',
    brief: 'CHSAA NYC Catholic high schools, Bronx/Manhattan boys schools playing football/basketball. Members: Cardinal Hayes, Cardinal Spellman, Mount Saint Michael, All Hallows, Monsignor Scanlan (Bronx); La Salle Academy, Regis, Xavier (Manhattan). EXCLUDE St. Raymond and Fordham Prep (already customers). Decision-maker is the Athletic Director. These run Finalsite CMS that GATES email and often 403s bots — primary channel is PHONE (main athletics line + AD name are usually public on the /athletics or staff page). Capture email only if literally shown.',
  },
  {
    key: 'penn-collegiate-club-alumni',
    anchor: 'Penn Sprint Football / Penn MMA / Penn Masala Alumni / Wharton Sports Business Club',
    channel: 'email',
    brief: 'University of Pennsylvania and Ivy/peer collegiate club-sport & student-org alumni networks similar to the Penn customer cluster (sprint football, club martial arts, cultural performance alumni, undergrad sports-business clubs). Look-alikes: peer Ivy/NESCAC club programs and similar cultural/alumni student orgs. Decision-maker: club president or alumni-relations officer who is an ADULT (never a current student officer who may be under a relevant threshold — but these are college, so adult is typical; still prefer staff alumni-relations contacts). Capture email + phone from official .edu/club pages only.',
  },
]

const TRUSTED_RULES = `
TRUSTED SOURCES (use in this priority order, highest contact-yield first):
1. Collegiate athletics CMS (Sidearm: athletics.<school>.edu / <mascot>.com) — best for college coach emails.
2. Official conference/league site + NCAA/NAIA — authoritative for current roster.
3. Diocese / state HS athletic-association directories — best for HS athletic-director contacts.
4. MaxPreps + the school's own /athletics page — AD name + main athletics phone, even when email gated.
Trust extends to a member org's OWN primary domain and the league's OWN platform once membership is verified on the league's official site — NOT to data brokers/aggregators (ZoomInfo/RocketReach/Wiza) or any site merely claiming a partnership.

HARD RULES (Tier B — absolute):
- Report an email/phone ONLY if you fetched the official page THIS run and saw the value literally on it. Otherwise the value is empty and status is "lookup_needed" (give the URL).
- NEVER fabricate, guess, or pattern-fill an address (no firstname@domain, no assumed info@/athletics@).
- EMAIL and PHONE are both top priority — capture both when shown; a phone-only row is a valid phone-first prospect, not a dead row.
- Targets must be ADULT staff/coaches/ADs — never students/minors.
- Mark each row's channel (email for collegiate, phone for HS) per the segment.
`

const PROSPECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segment', 'prospects'],
  properties: {
    segment: { type: 'string' },
    recommended_channel: { type: 'string', enum: ['email', 'phone', 'mixed'] },
    roster_source_url: { type: 'string', description: 'official league/conference page used to enumerate members, with season year if shown' },
    prospects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['institution', 'person', 'role', 'email', 'phone', 'source_url', 'confidence', 'status'],
        properties: {
          institution: { type: 'string' },
          location: { type: 'string' },
          person: { type: 'string', description: 'decision-maker name, or note if not found' },
          role: { type: 'string' },
          email: { type: 'string', description: 'EXACT email literally seen on official page, else empty string' },
          phone: { type: 'string', description: 'official phone literally seen, else empty string' },
          source_url: { type: 'string', description: 'the official page where the contact/role was seen' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          status: { type: 'string', enum: ['ready_email', 'ready_phone', 'lookup_needed', 'not_researched'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['institution', 'verdict', 'reason'],
  properties: {
    institution: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'downgrade', 'reject'] },
    corrected_email: { type: 'string', description: 'empty unless the email was wrong/unverifiable, in which case empty it' },
    corrected_status: { type: 'string', enum: ['ready_email', 'ready_phone', 'lookup_needed', 'not_researched', 'rejected'] },
    reason: { type: 'string', description: 'why — esp. if a contact could not be confirmed on an official source or role is non-adult' },
  },
}

// ---- Phase 1 (Research) + Phase 2 (Verify): pipeline, each segment verifies as soon as its research lands ----
const researched = await pipeline(
  SEGMENTS,
  // Stage 1 — RESEARCH this segment
  (seg) => agent(
    `Research outreach prospects for ONE segment, autonomously.

SEGMENT: ${seg.anchor}
BRIEF: ${seg.brief}
PRIMARY CHANNEL: ${seg.channel}

${TRUSTED_RULES}

Enumerate the segment's member institutions from the official league/conference page (cite it + season year). For each non-customer member, find the decision-maker and their official email and/or phone, following the trusted-source priority order. Return structured prospects. Be honest: many rows will be phone-only or lookup_needed — that is correct, do not invent emails to fill gaps.`,
    { label: `research:${seg.key}`, phase: 'Research', schema: PROSPECT_SCHEMA, agentType: 'general-purpose' }
  ),
  // Stage 2 — VERIFY each contact in this segment (adversarial #3, as a sub-step)
  (res, seg) => {
    if (!res || !res.prospects || res.prospects.length === 0) return { segment: seg.key, recommended_channel: seg.channel, prospects: [] }
    const withEmail = res.prospects.filter(p => p.email && p.email.includes('@'))
    if (withEmail.length === 0) return res // nothing to verify (phone-only/lookup rows pass through)
    return parallel(withEmail.map(p => () =>
      agent(
        `Adversarially verify ONE outreach contact. Default to skepticism: only "confirmed" if you can re-confirm the email is on the org's OWN official domain.

CONTACT: ${p.person} (${p.role}) at ${p.institution}
CLAIMED EMAIL: ${p.email}
CLAIMED SOURCE: ${p.source_url}

Re-fetch the source URL (or the org's official staff/athletics directory). Confirm: (1) the email literally appears there, (2) it's on the org's own primary domain (not a broker/aggregator/cache), (3) the person is an ADULT staff/coach/AD (not a student/minor). If you cannot re-confirm the email on an official page, verdict=downgrade and empty the email (status ready_phone if a phone exists, else lookup_needed). If the contact looks fabricated or non-adult, verdict=reject. Otherwise verdict=confirmed.`,
        { label: `verify:${p.institution.slice(0, 24)}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'general-purpose' }
      ).then(v => ({ prospect: p, verdict: v }))
    )).then(verdicts => {
      // apply verdicts back onto this segment's prospects
      const vByInst = new Map(verdicts.filter(Boolean).map(x => [x.prospect.institution + x.prospect.person, x.verdict]))
      const merged = res.prospects.map(p => {
        const v = vByInst.get(p.institution + p.person)
        if (!v) return p
        if (v.verdict === 'reject') return null
        if (v.verdict === 'downgrade') return { ...p, email: '', status: v.corrected_status || (p.phone ? 'ready_phone' : 'lookup_needed') }
        return p
      }).filter(Boolean)
      return { ...res, prospects: merged }
    })
  }
)

const segResults = researched.filter(Boolean)
const allProspects = segResults.flatMap(s => (s.prospects || []).map(p => ({ ...p, segment: s.segment, channel: s.recommended_channel })))
log(`Research+verify done: ${allProspects.length} prospects across ${segResults.length} segments`)

// ---- Phase 3 (Synthesize): dedup across ALL segments — genuine barrier (needs everything at once) ----
phase('Synthesize')

// Code-level dedup by normalized institution+person (the agent's dedup key analog)
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '')
const seen = new Set()
const deduped = []
let dupes = 0
for (const p of allProspects) {
  const key = norm(p.institution) + '|' + norm(p.person || p.role)
  if (seen.has(key)) { dupes++; continue }
  seen.add(key); deduped.push(p)
}

const summary = await agent(
  `You are synthesizing the final outreach prospect list from ${segResults.length} segments (${deduped.length} deduplicated prospects; ${dupes} cross-segment duplicates removed).

Produce a tight markdown summary: a scoreboard line (total, ready_email, ready_phone, lookup_needed by segment), the channel recommendation per segment, and an honest note on data gaps (lookup_needed rows, any rejected/downgraded contacts from verification). Do NOT list every row — the CSV has those. Lead with what's actionable today.

PROSPECTS (JSON):
${JSON.stringify(deduped, null, 2)}`,
  { label: 'synthesize:summary', phase: 'Synthesize' }
)

return {
  segment_count: segResults.length,
  prospect_count: deduped.length,
  duplicates_removed: dupes,
  prospects: deduped,
  summary,
}