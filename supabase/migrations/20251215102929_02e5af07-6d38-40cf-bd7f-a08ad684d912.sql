-- Create RLS policies for dm-audio bucket
CREATE POLICY "Anyone can upload dm audio"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can view dm audio"
ON storage.objects
FOR SELECT
USING (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can delete dm audio"
ON storage.objects
FOR DELETE
USING (bucket_id = 'dm-audio');

-- Create RLS policies for dm-images bucket
CREATE POLICY "Anyone can upload dm images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'dm-images');

CREATE POLICY "Anyone can view dm images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'dm-images');

CREATE POLICY "Anyone can delete dm images"
ON storage.objects
FOR DELETE
USING (bucket_id = 'dm-images');

-- Create RLS policies for post-images bucket (if missing)
CREATE POLICY "Anyone can upload post images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Anyone can view post images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Anyone can delete post images"
ON storage.objects
FOR DELETE
USING (bucket_id = 'post-images');