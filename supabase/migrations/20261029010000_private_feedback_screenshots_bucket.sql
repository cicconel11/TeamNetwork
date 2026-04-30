-- Feedback screenshots can contain PII from the current page. Keep objects
-- private and only expose short-lived signed URLs from trusted server code.
UPDATE storage.buckets
SET public = FALSE
WHERE id = 'feedback-screenshots';

DROP POLICY IF EXISTS "Public read feedback screenshots" ON storage.objects;
