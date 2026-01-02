-- Enable extensions for CRON jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Storage RLS Policies for dm-audio bucket
CREATE POLICY "Anyone can upload dm audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can view dm audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can delete dm audio"
ON storage.objects FOR DELETE
USING (bucket_id = 'dm-audio');

-- Storage RLS Policies for dm-images bucket
CREATE POLICY "Anyone can upload dm images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dm-images');

CREATE POLICY "Anyone can view dm images"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-images');

CREATE POLICY "Anyone can delete dm images"
ON storage.objects FOR DELETE
USING (bucket_id = 'dm-images');

-- Storage RLS Policies for post-images bucket
CREATE POLICY "Anyone can upload post images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Anyone can view post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Anyone can delete post images"
ON storage.objects FOR DELETE
USING (bucket_id = 'post-images');