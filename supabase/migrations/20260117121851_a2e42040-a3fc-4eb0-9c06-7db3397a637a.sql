-- Add cost columns to ai_usage_logs table
ALTER TABLE public.ai_usage_logs 
ADD COLUMN cost_usd DECIMAL(12, 8) DEFAULT 0,
ADD COLUMN cost_lana DECIMAL(12, 4) DEFAULT 0;