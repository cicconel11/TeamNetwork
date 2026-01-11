-- Fix security warning: Function search_path mutable for gen_random_bytes
-- This sets a fixed search_path to prevent potential schema injection attacks

-- Check if the function exists before altering
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'gen_random_bytes'
  ) THEN
    ALTER FUNCTION public.gen_random_bytes(integer) SET search_path = public;
  END IF;
END $$;
