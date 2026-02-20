-- Stripe-hosted pages cannot be rendered in iframes due to frame-ancestors policy.
-- Convert legacy Stripe iframe embeds to links and block future inserts/updates.

update public.org_philanthropy_embeds
set embed_type = 'link'
where embed_type = 'iframe'
  and lower(url) ~ '^https://([a-z0-9-]+\.)*stripe\.com([/:?#]|$)';

update public.org_donation_embeds
set embed_type = 'link'
where embed_type = 'iframe'
  and lower(url) ~ '^https://([a-z0-9-]+\.)*stripe\.com([/:?#]|$)';

alter table public.org_philanthropy_embeds
drop constraint if exists org_philanthropy_embeds_no_stripe_iframe;

alter table public.org_philanthropy_embeds
add constraint org_philanthropy_embeds_no_stripe_iframe
check (
  not (
    embed_type = 'iframe'
    and lower(url) ~ '^https://([a-z0-9-]+\.)*stripe\.com([/:?#]|$)'
  )
);

alter table public.org_donation_embeds
drop constraint if exists org_donation_embeds_no_stripe_iframe;

alter table public.org_donation_embeds
add constraint org_donation_embeds_no_stripe_iframe
check (
  not (
    embed_type = 'iframe'
    and lower(url) ~ '^https://([a-z0-9-]+\.)*stripe\.com([/:?#]|$)'
  )
);
