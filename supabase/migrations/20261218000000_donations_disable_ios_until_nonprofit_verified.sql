-- Apple App Store review: the native in-app (Apple Pay / card) donation flow is
-- only permissible for approved, registered nonprofits (Guideline 3.2.1/3.1.1).
-- None of our organizations are verified 501(c)(3) nonprofits today, so iOS must
-- collect donations on the web instead. Setting donation_eligible_ios = false for
-- every org makes the iOS client render its "Donations are managed on the web"
-- notice (and makes the create-donation API reject any native iOS attempt).
--
-- The column default is already false, so future orgs are web-only by default.
-- To re-enable the native iOS flow later, flip this flag back to true for a
-- genuinely verified nonprofit org only.

update public.organizations
set donation_eligible_ios = false
where donation_eligible_ios is distinct from false;
