-- Create ai_knowledge table for storing knowledge entries
CREATE TABLE public.ai_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated')),
  lang TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  topic TEXT CHECK (topic IN ('service', 'concept', 'rule', 'tech', 'faq')),
  keywords TEXT[],
  nostr_event_id TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.ai_knowledge ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can read knowledge" 
ON public.ai_knowledge 
FOR SELECT 
USING (true);

CREATE POLICY "Admin users can manage knowledge" 
ON public.ai_knowledge 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE admin_users.nostr_hex_id = current_setting('request.jwt.claims', true)::json->>'sub'
  )
);

CREATE POLICY "Service role can manage knowledge" 
ON public.ai_knowledge 
FOR ALL 
USING (auth.role() = 'service_role');

-- Create index for slug lookups
CREATE INDEX idx_ai_knowledge_slug ON public.ai_knowledge(slug);
CREATE INDEX idx_ai_knowledge_status ON public.ai_knowledge(status);

-- Create trigger for updated_at
CREATE TRIGGER update_ai_knowledge_updated_at
BEFORE UPDATE ON public.ai_knowledge
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();