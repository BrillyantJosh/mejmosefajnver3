-- Create table for caching room latest posts
CREATE TABLE public.room_latest_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_slug TEXT NOT NULL,
  post_event_id TEXT NOT NULL,
  content TEXT NOT NULL,
  author_pubkey TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  image_url TEXT,
  post_count INTEGER DEFAULT 0,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_slug)
);

-- Enable RLS
ALTER TABLE public.room_latest_posts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can read room posts" 
ON public.room_latest_posts 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage room posts" 
ON public.room_latest_posts 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Indexes for faster queries
CREATE INDEX idx_room_latest_posts_slug ON public.room_latest_posts(room_slug);
CREATE INDEX idx_room_latest_posts_created ON public.room_latest_posts(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_room_latest_posts_updated_at
BEFORE UPDATE ON public.room_latest_posts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();