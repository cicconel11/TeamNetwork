-- Extend AI schedule uploads bucket to allow PDF and common image formats
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg'
]
WHERE id = 'ai-schedule-uploads';
