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
- Record jurisdiction, lawful basis for non-US contacts, verified_on, verify_method, priority, and source URL per channel. Empty string is better than missing metadata.
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
        required: [
          'institution',
          'league_conf',
          'location',
          'org_domain',
          'person',
          'role',
          'email',
          'phone',
          'email_source_url',
          'phone_source_url',
          'source_url',
          'jurisdiction',
          'lawful_basis',
          'verified_on',
          'verify_method',
          'confidence',
          'priority',
          'status',
        ],
        properties: {
          institution: { type: 'string' },
          league_conf: { type: 'string' },
          location: { type: 'string' },
          org_domain: { type: 'string', description: 'normalized official org domain, without protocol, when known; else empty string' },
          person: { type: 'string', description: 'decision-maker name, or note if not found' },
          role: { type: 'string' },
          email: { type: 'string', description: 'EXACT email literally seen on official page, else empty string' },
          phone: { type: 'string', description: 'official phone literally seen, else empty string' },
          email_source_url: { type: 'string', description: 'official page where email was literally seen, else empty string' },
          phone_source_url: { type: 'string', description: 'official page where phone was literally seen, else empty string' },
          source_url: { type: 'string', description: 'official page where the contact/role was seen; may equal email_source_url or phone_source_url' },
          jurisdiction: { type: 'string', description: 'US, Canada, EU/UK/EEA, non-US, or unknown' },
          lawful_basis: { type: 'string', description: 'required for non-US ready rows; empty string for US or unresolved rows' },
          verified_on: { type: 'string', description: 'YYYY-MM-DD date this row was fetched/verified, else empty string' },
          verify_method: { type: 'string', description: 'how the contact was confirmed, e.g. fetched staff page and value present' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          status: { type: 'string', enum: ['ready_email', 'ready_phone', 'lookup_needed', 'not_researched', 'held_jurisdiction', 'held_minor'] },
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
    corrected_phone: { type: 'string', description: 'empty unless the phone was wrong/unverifiable, in which case empty it' },
    corrected_email_source_url: { type: 'string', description: 'official email source if changed, else empty string' },
    corrected_phone_source_url: { type: 'string', description: 'official phone source if changed, else empty string' },
    corrected_source_url: { type: 'string', description: 'official role/contact source if changed, else empty string' },
    corrected_jurisdiction: { type: 'string', description: 'jurisdiction if corrected, else empty string' },
    corrected_lawful_basis: { type: 'string', description: 'lawful basis if corrected, else empty string' },
    corrected_status: { type: 'string', enum: ['ready_email', 'ready_phone', 'lookup_needed', 'not_researched', 'held_jurisdiction', 'held_minor', 'rejected'] },
    reason: { type: 'string', description: 'why — esp. if a contact channel could not be confirmed on an official source, legal basis is missing, or role is non-adult' },
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

Enumerate the segment's member institutions from the official league/conference page (cite it + season year). For each non-customer member, find the decision-maker and their official email and/or phone, following the trusted-source priority order. Return structured prospects with every schema field populated. Be honest: many rows will be phone-only or lookup_needed — that is correct, do not invent emails to fill gaps.`,
    { label: `research:${seg.key}`, phase: 'Research', schema: PROSPECT_SCHEMA, agentType: 'general-purpose' }
  ),
  // Stage 2 — VERIFY each contact/source claim in this segment (adversarial #3, as a sub-step)
  (res, seg) => {
    if (!res || !res.prospects || res.prospects.length === 0) return { segment: seg.key, recommended_channel: seg.channel, prospects: [] }
    const withContactOrSource = res.prospects.filter(p => p.email || p.phone || p.source_url || p.email_source_url || p.phone_source_url)
    if (withContactOrSource.length === 0) return res
    return parallel(withContactOrSource.map(p => () =>
      agent(
        `Adversarially verify ONE outreach contact. Default to skepticism: only "confirmed" if you can re-confirm every non-empty contact channel on an official source.

CONTACT: ${p.person} (${p.role}) at ${p.institution}
CLAIMED EMAIL: ${p.email}
CLAIMED PHONE: ${p.phone}
CLAIMED EMAIL SOURCE: ${p.email_source_url}
CLAIMED PHONE SOURCE: ${p.phone_source_url}
CLAIMED ROLE/CONTACT SOURCE: ${p.source_url}
CLAIMED JURISDICTION: ${p.jurisdiction}
CLAIMED LAWFUL BASIS: ${p.lawful_basis}

Re-fetch the source URLs (or the org's official staff/athletics directory). Confirm: (1) each non-empty email/phone literally appears on an official page, (2) the source is the org's own primary domain or the league's own official platform, not a broker/aggregator/cache, (3) the person is an ADULT staff/coach/AD, not a student/minor, and (4) non-US rows have a recorded lawful basis before ready status. If a channel cannot be re-confirmed, verdict=downgrade and empty only that channel. If both channels fail, status=lookup_needed unless the row should be held for jurisdiction. If the contact looks fabricated or non-adult, verdict=reject (or held_minor when the row should remain as a non-actionable note). Otherwise verdict=confirmed.`,
        { label: `verify:${p.institution.slice(0, 24)}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'general-purpose' }
      ).then(v => ({ prospect: p, verdict: v }))
    )).then(verdicts => {
      // apply verdicts back onto this segment's prospects
      const vByInst = new Map(verdicts.filter(Boolean).map(x => [x.prospect.institution + x.prospect.person, x.verdict]))
      const merged = res.prospects.map(p => {
        const v = vByInst.get(p.institution + p.person)
        if (!v) return p
        if (v.verdict === 'reject') return null
        if (v.verdict === 'downgrade') {
          const updated = { ...p }
          if (typeof v.corrected_email === 'string') updated.email = v.corrected_email
          if (typeof v.corrected_phone === 'string') updated.phone = v.corrected_phone
          if (v.corrected_email_source_url) updated.email_source_url = v.corrected_email_source_url
          if (v.corrected_phone_source_url) updated.phone_source_url = v.corrected_phone_source_url
          if (v.corrected_source_url) updated.source_url = v.corrected_source_url
          if (v.corrected_jurisdiction) updated.jurisdiction = v.corrected_jurisdiction
          if (v.corrected_lawful_basis) updated.lawful_basis = v.corrected_lawful_basis
          updated.status = v.corrected_status || (updated.email ? 'ready_email' : (updated.phone ? 'ready_phone' : 'lookup_needed'))
          return updated
        }
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

// Code-level dedup by durable prospect key when possible, with institution+role fallback.
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '')
const seen = new Set()
const deduped = []
let dupes = 0
for (const p of allProspects) {
  const key = p.email
    ? `${norm(p.org_domain || p.institution)}|${norm(p.email)}`
    : `${norm(p.org_domain || p.institution)}|${norm(p.role || p.person)}`
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
