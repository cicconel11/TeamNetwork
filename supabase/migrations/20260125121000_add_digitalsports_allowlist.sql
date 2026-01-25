insert into public.schedule_domain_rules (pattern, vendor_id)
values
  ('digitalsports.com', 'digitalsports'),
  ('*.digitalsports.com', 'digitalsports')
on conflict (pattern) do nothing;
