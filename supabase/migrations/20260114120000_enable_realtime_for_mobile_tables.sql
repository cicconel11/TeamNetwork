-- =====================================================
-- Enable Realtime for mobile app tables
-- =====================================================
-- This migration enables Supabase Realtime replication for tables
-- used by the mobile app hooks to provide live updates without manual refresh.
--
-- Tables enabled:
-- - events: For real-time event updates
-- - announcements: For real-time announcement updates
-- - alumni: For real-time alumni directory updates
-- - user_organization_roles: For real-time membership/role changes
-- - organizations: For real-time org metadata updates

-- Set REPLICA IDENTITY FULL so Realtime broadcasts all columns
ALTER TABLE public.events REPLICA IDENTITY FULL;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;
ALTER TABLE public.alumni REPLICA IDENTITY FULL;
ALTER TABLE public.user_organization_roles REPLICA IDENTITY FULL;
ALTER TABLE public.organizations REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alumni;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_organization_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.organizations;
