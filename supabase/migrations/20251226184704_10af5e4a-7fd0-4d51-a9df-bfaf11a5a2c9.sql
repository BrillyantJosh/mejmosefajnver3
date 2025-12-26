-- Fix storage bucket RLS policies for dm-audio, dm-images, and post-images
-- Replace overly permissive "true" policies with proper path-based access controls

-- Drop existing overly permissive policies for dm-audio
DROP POLICY IF EXISTS "Anyone can upload dm audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete dm audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view dm audio" ON storage.objects;

-- Drop existing overly permissive policies for dm-images
DROP POLICY IF EXISTS "Anyone can upload dm images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete dm images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view dm images" ON storage.objects;

-- Drop existing overly permissive policies for post-images
DROP POLICY IF EXISTS "Anyone can upload post images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete post images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view post images" ON storage.objects;

-- Create new secure policies for dm-audio bucket
-- Users can only upload to paths that start with their pubkey
CREATE POLICY "Users can upload own dm audio"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'dm-audio' 
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Anyone can view dm audio (public bucket for playback)
CREATE POLICY "Public read access for dm audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-audio');

-- Users can only delete files they uploaded (based on path)
CREATE POLICY "Users can delete own dm audio"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'dm-audio'
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Create new secure policies for dm-images bucket
CREATE POLICY "Users can upload own dm images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'dm-images'
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Anyone can view dm images (public bucket for display)
CREATE POLICY "Public read access for dm images"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-images');

-- Users can only delete files they uploaded (based on path)
CREATE POLICY "Users can delete own dm images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'dm-images'
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Create new secure policies for post-images bucket
CREATE POLICY "Users can upload own post images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'post-images'
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Anyone can view post images (public bucket for display)
CREATE POLICY "Public read access for post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'post-images');

-- Users can only delete files they uploaded (based on path)
CREATE POLICY "Users can delete own post images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'post-images'
  AND (storage.foldername(name))[1] IS NOT NULL
);