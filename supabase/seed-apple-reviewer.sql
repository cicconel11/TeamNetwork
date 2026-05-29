-- =====================================================
-- Seed Script: Apple App Review Tester Account
--
-- Purpose: Give an App Store reviewer a fully populated, multi-org account so
-- they can demo every feature surface in TeamNetwork.
--
-- The reviewer is granted membership in three orgs:
--   1. "Apple Review Test Org"  — created here, donation_eligible_ios = true
--      (so the native Apple Pay donation flow is reachable per Guideline
--      3.2.1(vi)). Reviewer is admin. This org is fully populated below: every
--      feature tab (calendar, feed, discussions, announcements, alumni,
--      workouts, jobs, forms, media, expenses, records, philanthropy,
--      donations, parents, competition, chat, mentorship) has demo data.
--   2. "CHSFL - Test Organization" — REAL production org, looked up by slug,
--      never created/modified by this script. Reviewer is added as admin so a
--      large, realistic roster is demoable.
--   3. The TeamNetwork founders org — REAL production org, looked up by slug,
--      never created/modified by this script. Reviewer is added read-only-ish
--      (active_member) so live founder data is exposed.
--
-- PREREQUISITES (do these first, in order):
--   1. The reviewer account must already exist in auth.users. Create it in the
--      Supabase Dashboard -> Authentication -> Users -> "Add user" -> "Create
--      new user", set email + password, and CHECK "Auto Confirm User". This
--      lands the user in auth.users with email_confirmed_at set and sends NO
--      confirmation email -- so you do NOT need access to the mailbox. Do not
--      use the app signup flow (it emails a confirmation link you cannot
--      receive). This script does NOT create the auth user (password hashing
--      belongs to Supabase Auth).
--   2. Set the CONFIG values below before running.
--
-- USAGE (Supabase SQL Editor against PRODUCTION):
--   1. Edit the placeholders in the CONFIG block.
--   2. Run. It is idempotent — safe to re-run (all inserts guarded on natural
--      keys; member top-up respects the existing count).
--
-- ROLLBACK: see the commented block at the bottom.
-- =====================================================

DO $$
DECLARE
  -- ============ CONFIG — EDIT THESE ============
  v_reviewer_email text := 'test-reviewer@myteamnetwork.com';
  -- Slug of the REAL founders org in production (confirmed live 2026-05-29).
  v_founders_slug  text := 'teamnetwork-founders';
  -- Role granted in the founders org.
  v_founders_role  public.user_role := 'active_member';
  -- Slug of the REAL CHSFL org in production (confirmed live 2026-05-29).
  v_chsfl_slug     text := 'upenn-sprint-football';
  -- =============================================

  v_user_id        uuid;
  org              uuid;  -- the seeded review org
  v_founders_id    uuid;
  v_chsfl_id       uuid;
  v_member_count   int;
  comp uuid; tA uuid; tB uuid; grp uuid;
  m1 uuid; m2 uuid; m3 uuid;
BEGIN
  -- ---- Resolve reviewer user ----
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_reviewer_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'Reviewer % not found in auth.users. Create it via the Supabase Auth dashboard (Auto Confirm User) first, then re-run.',
      v_reviewer_email;
  END IF;
  RAISE NOTICE 'Reviewer user: % (%)', v_reviewer_email, v_user_id;

  -- ---- Org 1: Apple Review Test Org (donation_eligible_ios = true) ----
  SELECT id INTO org FROM organizations WHERE slug = 'apple-review-test-org';
  IF org IS NULL THEN
    INSERT INTO organizations (name, slug, description, donation_eligible_ios)
    VALUES (
      'Apple Review Test Org',
      'apple-review-test-org',
      'Populated org for Apple App Store review. donation_eligible_ios = true.',
      true
    )
    RETURNING id INTO org;
    RAISE NOTICE 'Created Apple Review Test Org: %', org;
  ELSE
    UPDATE organizations SET donation_eligible_ios = true WHERE id = org;
    RAISE NOTICE 'Apple Review Test Org already existed: % (flag ensured true)', org;
  END IF;

  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, org, 'admin')
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin';

  -- ---- Org 2: CHSFL (REAL — look up only) ----
  SELECT id INTO v_chsfl_id FROM organizations WHERE slug = v_chsfl_slug;
  IF v_chsfl_id IS NULL THEN
    RAISE EXCEPTION 'CHSFL org slug "%" not found.', v_chsfl_slug;
  END IF;
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, v_chsfl_id, 'admin')
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin';
  RAISE NOTICE 'Added reviewer to CHSFL % as admin', v_chsfl_slug;

  -- ---- Org 3: TeamNetwork founders org (REAL — look up only) ----
  SELECT id INTO v_founders_id FROM organizations WHERE slug = v_founders_slug;
  IF v_founders_id IS NULL THEN
    RAISE EXCEPTION 'Founders org slug "%" not found.', v_founders_slug;
  END IF;
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, v_founders_id, v_founders_role)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
  RAISE NOTICE 'Added reviewer to founders org % as %', v_founders_slug, v_founders_role;

  -- ============================================================
  -- Demo content for the SEEDED review org only. Every feature tab is
  -- populated so the reviewer sees a realistic org. The real CHSFL and
  -- founders orgs are never touched. All inserts guarded on natural keys.
  -- ============================================================

  -- MEMBERS: top up to 10 active (reviewer's synced row counts).
  SELECT count(*) INTO v_member_count FROM members WHERE organization_id = org AND deleted_at IS NULL;
  INSERT INTO members (organization_id, first_name, last_name, email, role, status)
  SELECT org, m.fn, m.ln, m.em, 'member', 'active'::member_status
  FROM (VALUES
    ('Jordan','Avery','jordan.avery@example.com'),
    ('Riley','Brooks','riley.brooks@example.com'),
    ('Casey','Morgan','casey.morgan@example.com'),
    ('Taylor','Quinn','taylor.quinn@example.com'),
    ('Drew','Parker','drew.parker@example.com'),
    ('Sam','Reyes','sam.reyes@example.com'),
    ('Alex','Bennett','alex.bennett@example.com'),
    ('Jamie','Carter','jamie.carter@example.com'),
    ('Morgan','Hayes','morgan.hayes@example.com'),
    ('Cameron','Diaz','cameron.diaz@example.com')
  ) AS m(fn,ln,em)
  WHERE NOT EXISTS (SELECT 1 FROM members WHERE organization_id = org AND email = m.em)
  LIMIT GREATEST(0, 10 - v_member_count);

  -- EVENTS / CALENDAR
  INSERT INTO events (organization_id, title, description, start_date, end_date, location, event_type, audience, created_by_user_id)
  SELECT org, e.t, e.d, now()+e.s, now()+e.s+interval '2 hours', e.loc, e.et::event_type, 'both', v_user_id
  FROM (VALUES
    ('Spring Practice','Field drills and conditioning', interval '2 days','Main Field','practice'),
    ('Team Meeting','Weekly sync', interval '5 days','Clubhouse','meeting'),
    ('Charity 5K','Fundraiser run', interval '12 days','City Park','fundraiser'),
    ('Alumni Mixer','Social gathering', interval '20 days','Downtown Hall','social'),
    ('Season Opener','First game', interval '30 days','Stadium','game'),
    ('Strength Workshop','Workout clinic', interval '45 days','Gym','workout')
  ) AS e(t,d,s,loc,et)
  WHERE NOT EXISTS (SELECT 1 FROM events WHERE organization_id = org AND title = e.t);

  -- FEED
  INSERT INTO feed_posts (organization_id, author_id, body, post_type)
  SELECT org, v_user_id, b, 'text'
  FROM (VALUES
    ('Welcome to the team feed! Excited for the season ahead.'),
    ('Great turnout at practice today — keep it up everyone.'),
    ('Reminder: charity 5K signups close Friday.'),
    ('Congrats to our seniors on a fantastic year!')
  ) AS f(b)
  WHERE NOT EXISTS (SELECT 1 FROM feed_posts WHERE organization_id = org AND body = f.b);

  -- DISCUSSIONS
  INSERT INTO discussion_threads (organization_id, title, body, author_id)
  SELECT org, t.title, t.body, v_user_id
  FROM (VALUES
    ('Carpool to away games?','Anyone organizing rides for the season opener?'),
    ('Best post-workout meals','Share your go-to recovery food.')
  ) AS t(title,body)
  WHERE NOT EXISTS (SELECT 1 FROM discussion_threads WHERE organization_id = org AND title = t.title);

  INSERT INTO discussion_replies (thread_id, organization_id, author_id, body)
  SELECT dt.id, org, v_user_id, 'I can drive 3 people — leaving at 9am.'
  FROM discussion_threads dt
  WHERE dt.organization_id = org AND dt.title = 'Carpool to away games?'
    AND NOT EXISTS (SELECT 1 FROM discussion_replies WHERE thread_id = dt.id AND body = 'I can drive 3 people — leaving at 9am.');

  -- ANNOUNCEMENTS
  INSERT INTO announcements (organization_id, title, body, created_by_user_id, published_at)
  SELECT org, a.t, a.b, v_user_id, now()
  FROM (VALUES
    ('Uniform pickup this week','Stop by the clubhouse to grab your kit.'),
    ('New training schedule posted','Check the calendar for updated times.')
  ) AS a(t,b)
  WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE organization_id = org AND title = a.t);

  -- ALUMNI
  INSERT INTO alumni (organization_id, first_name, last_name, email, graduation_year, current_company, job_title)
  SELECT org, al.fn, al.ln, al.em, al.gy, al.co, al.jt
  FROM (VALUES
    ('Pat','Sullivan','pat.sullivan@example.com',2018,'Acme Corp','Engineer'),
    ('Robin','Chen','robin.chen@example.com',2015,'Globex','Analyst'),
    ('Lee','Nguyen','lee.nguyen@example.com',2020,'Initech','Designer')
  ) AS al(fn,ln,em,gy,co,jt)
  WHERE NOT EXISTS (SELECT 1 FROM alumni WHERE organization_id = org AND email = al.em);

  -- WORKOUTS
  INSERT INTO workouts (organization_id, title, description, workout_date, created_by)
  SELECT org, w.t, w.d, current_date+w.off, v_user_id
  FROM (VALUES
    ('Lower Body Strength','Squats, lunges, deadlifts',3),
    ('Speed & Agility','Ladder drills and sprints',7)
  ) AS w(t,d,off)
  WHERE NOT EXISTS (SELECT 1 FROM workouts WHERE organization_id = org AND title = w.t);

  -- JOBS
  INSERT INTO job_postings (organization_id, posted_by, title, company, location, description, is_active)
  SELECT org, v_user_id, j.t, j.co, j.loc, j.d, true
  FROM (VALUES
    ('Software Intern','Acme Corp','Remote','Summer internship for current students.'),
    ('Marketing Associate','Globex','New York, NY','Entry-level role for recent grads.')
  ) AS j(t,co,loc,d)
  WHERE NOT EXISTS (SELECT 1 FROM job_postings WHERE organization_id = org AND title = j.t);

  -- FORMS
  INSERT INTO forms (organization_id, title, description, fields, is_active, created_by)
  SELECT org, f.t, f.d, '[]'::jsonb, true, v_user_id
  FROM (VALUES
    ('Travel Consent','Permission form for away trips.'),
    ('Gear Order','Order additional team gear.')
  ) AS f(t,d)
  WHERE NOT EXISTS (SELECT 1 FROM forms WHERE organization_id = org AND title = f.t);

  -- MEDIA (external picsum URLs — Storage is not SQL-seedable)
  INSERT INTO media_items (organization_id, uploaded_by, title, media_type, external_url, status)
  SELECT org, v_user_id, m.t, 'image', m.url, 'approved'::media_status
  FROM (VALUES
    ('Game Day','https://picsum.photos/seed/teamnet1/800/600'),
    ('Team Huddle','https://picsum.photos/seed/teamnet2/800/600'),
    ('Trophy Ceremony','https://picsum.photos/seed/teamnet3/800/600')
  ) AS m(t,url)
  WHERE NOT EXISTS (SELECT 1 FROM media_items WHERE organization_id = org AND title = m.t);

  -- EXPENSES
  INSERT INTO expenses (organization_id, user_id, name, expense_type, amount)
  SELECT org, v_user_id, e.n, e.ty, e.amt
  FROM (VALUES
    ('Team Dinner','social',250.00),
    ('Travel Bus','travel',800.00)
  ) AS e(n,ty,amt)
  WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE organization_id = org AND name = e.n);

  -- RECORDS
  INSERT INTO records (organization_id, title, category, value, holder_name, year)
  SELECT org, r.t, r.cat, r.val, r.h, r.yr
  FROM (VALUES
    ('Fastest 40-yard dash','Sprint','4.5s','Jordan Avery',2024),
    ('Most points in a season','Scoring','312','Riley Brooks',2023),
    ('Longest field goal','Kicking','58 yds','Casey Morgan',2022)
  ) AS r(t,cat,val,h,yr)
  WHERE NOT EXISTS (SELECT 1 FROM records WHERE organization_id = org AND title = r.t);

  -- PHILANTHROPY
  INSERT INTO philanthropy_events (organization_id, title, description, date, location, slots_available)
  SELECT org, p.t, p.d, now()+p.off, p.loc, p.slots
  FROM (VALUES
    ('Food Bank Volunteering','Help sort donations.', interval '10 days','Community Center',20),
    ('Beach Cleanup','Morning cleanup event.', interval '25 days','Shoreline Park',30)
  ) AS p(t,d,off,loc,slots)
  WHERE NOT EXISTS (SELECT 1 FROM philanthropy_events WHERE organization_id = org AND title = p.t);

  -- DONATIONS (historical succeeded rows; also makes philanthropy totals nonzero)
  INSERT INTO organization_donations (organization_id, amount_cents, donor_name, status, currency)
  SELECT org, d.amt, d.dn, 'succeeded', 'usd'
  FROM (VALUES
    (5000,'Pat Sullivan'),
    (10000,'Robin Chen'),
    (2500,'Anonymous Booster'),
    (7500,'Lee Nguyen')
  ) AS d(amt,dn)
  WHERE NOT EXISTS (SELECT 1 FROM organization_donations WHERE organization_id = org AND donor_name = d.dn AND amount_cents = d.amt);

  -- PARENTS
  INSERT INTO parents (organization_id, first_name, last_name, email, relationship, student_name)
  SELECT org, pr.fn, pr.ln, pr.em, pr.rel, pr.sn
  FROM (VALUES
    ('Maria','Avery','maria.avery@example.com','Mother','Jordan Avery'),
    ('David','Brooks','david.brooks@example.com','Father','Riley Brooks')
  ) AS pr(fn,ln,em,rel,sn)
  WHERE NOT EXISTS (SELECT 1 FROM parents WHERE organization_id = org AND email = pr.em);

  -- MENTORSHIP (reviewer as available mentor; no pair — needs a 2nd real user)
  INSERT INTO mentor_profiles (organization_id, user_id, is_active, bio, accepting_new)
  SELECT org, v_user_id, true, 'Happy to mentor on career and recruiting questions.', true
  WHERE NOT EXISTS (SELECT 1 FROM mentor_profiles WHERE organization_id = org AND user_id = v_user_id);

  -- COMPETITION: 1 competition -> 2 teams -> 3 points attributed to members
  SELECT id INTO comp FROM competitions WHERE organization_id = org AND name = 'Spring Cup';
  IF comp IS NULL THEN
    INSERT INTO competitions (organization_id, name, description, season)
    VALUES (org,'Spring Cup','Intra-squad points competition','Spring 2026')
    RETURNING id INTO comp;
  END IF;

  SELECT id INTO tA FROM competition_teams WHERE competition_id = comp AND name = 'Team Red';
  IF tA IS NULL THEN
    INSERT INTO competition_teams (organization_id, competition_id, name)
    VALUES (org,comp,'Team Red') RETURNING id INTO tA;
  END IF;
  SELECT id INTO tB FROM competition_teams WHERE competition_id = comp AND name = 'Team Blue';
  IF tB IS NULL THEN
    INSERT INTO competition_teams (organization_id, competition_id, name)
    VALUES (org,comp,'Team Blue') RETURNING id INTO tB;
  END IF;

  SELECT id INTO m1 FROM members WHERE organization_id = org AND email = 'jordan.avery@example.com';
  SELECT id INTO m2 FROM members WHERE organization_id = org AND email = 'riley.brooks@example.com';
  SELECT id INTO m3 FROM members WHERE organization_id = org AND email = 'casey.morgan@example.com';

  INSERT INTO competition_points (competition_id, organization_id, team_id, team_name, member_id, points, reason)
  SELECT comp, org, p.tid, p.tn, p.mid, p.pts, p.rsn
  FROM (VALUES
    (tA,'Team Red',m1,10,'Won sprint relay'),
    (tA,'Team Red',m2,15,'Top fundraiser'),
    (tB,'Team Blue',m3,12,'Best attendance')
  ) AS p(tid,tn,mid,pts,rsn)
  WHERE NOT EXISTS (
    SELECT 1 FROM competition_points cp
    WHERE cp.competition_id = comp AND cp.member_id = p.mid AND cp.reason = p.rsn);

  -- CHAT: 1 group -> reviewer member -> 3 approved messages
  SELECT id INTO grp FROM chat_groups WHERE organization_id = org AND name = 'Team Chat';
  IF grp IS NULL THEN
    INSERT INTO chat_groups (organization_id, name, description, is_default, created_by)
    VALUES (org,'Team Chat','Main team channel',true,v_user_id) RETURNING id INTO grp;
  END IF;

  INSERT INTO chat_group_members (chat_group_id, user_id, organization_id, role)
  SELECT grp, v_user_id, org, 'admin'::chat_group_role
  WHERE NOT EXISTS (SELECT 1 FROM chat_group_members WHERE chat_group_id = grp AND user_id = v_user_id);

  INSERT INTO chat_messages (chat_group_id, organization_id, author_id, body, status)
  SELECT grp, org, v_user_id, b, 'approved'::chat_message_status
  FROM (VALUES
    ('Welcome everyone to the team chat!'),
    ('Practice moved to 4pm tomorrow.'),
    ('Don''t forget gear pickup this week.')
  ) AS c(b)
  WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE chat_group_id = grp AND body = c.b);

  RAISE NOTICE 'SUCCESS: % is in 3 orgs (Apple Review Test Org=admin, CHSFL=admin, %=%)',
    v_reviewer_email, v_founders_slug, v_founders_role;
END
$$;

-- ---- Verify ----
SELECT
  o.name,
  o.slug,
  o.donation_eligible_ios,
  uor.role
FROM user_organization_roles uor
JOIN organizations o ON o.id = uor.organization_id
JOIN auth.users u ON u.id = uor.user_id
WHERE u.email = 'test-reviewer@myteamnetwork.com'  -- keep in sync with v_reviewer_email
ORDER BY o.name;

-- =====================================================
-- ROLLBACK (removes reviewer's memberships and the seeded review org + its
-- demo content; never touches the real CHSFL or founders org data).
--
-- The review org's child tables are mostly ON DELETE CASCADE, but these are
-- NO ACTION and must be cleared before deleting the org row:
--   academic_schedules, ai_pending_actions, discussion_replies,
--   discussion_threads, dsr_requests, form_documents,
--   form_document_submissions, form_submissions, forms, job_postings,
--   mentor_profiles, payment_attempts, schedule_files.
--
--   DO $$
--   DECLARE org uuid := (SELECT id FROM organizations WHERE slug = 'apple-review-test-org');
--   BEGIN
--     DELETE FROM form_submissions          WHERE organization_id = org;
--     DELETE FROM form_document_submissions WHERE organization_id = org;
--     DELETE FROM form_documents            WHERE organization_id = org;
--     DELETE FROM forms                     WHERE organization_id = org;
--     DELETE FROM discussion_replies        WHERE organization_id = org;
--     DELETE FROM discussion_threads        WHERE organization_id = org;
--     DELETE FROM job_postings              WHERE organization_id = org;
--     DELETE FROM mentor_profiles           WHERE organization_id = org;
--     DELETE FROM ai_pending_actions        WHERE organization_id = org;
--     DELETE FROM payment_attempts          WHERE organization_id = org;
--     DELETE FROM schedule_files            WHERE organization_id = org;
--     DELETE FROM academic_schedules        WHERE organization_id = org;
--     DELETE FROM dsr_requests              WHERE organization_id = org;
--     DELETE FROM members                   WHERE organization_id = org;
--     DELETE FROM user_organization_roles   WHERE organization_id = org;
--     DELETE FROM organizations             WHERE id = org;
--   END $$;
--   -- Also drop the reviewer's CHSFL + founders memberships (orgs untouched):
--   DELETE FROM user_organization_roles
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'test-reviewer@myteamnetwork.com')
--     AND organization_id IN (SELECT id FROM organizations WHERE slug IN ('upenn-sprint-football','teamnetwork-founders'));
--
-- To also remove the auth user, delete it from the Supabase Auth dashboard.
-- =====================================================
