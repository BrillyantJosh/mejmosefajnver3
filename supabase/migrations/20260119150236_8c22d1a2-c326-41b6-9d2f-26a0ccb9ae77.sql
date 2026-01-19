-- Allow anyone to insert knowledge entries (admin check done in frontend via AdminContext)
CREATE POLICY "Anyone can insert knowledge"
ON public.ai_knowledge
FOR INSERT
WITH CHECK (true);

-- Allow anyone to update knowledge entries
CREATE POLICY "Anyone can update knowledge"
ON public.ai_knowledge
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Allow anyone to delete knowledge entries
CREATE POLICY "Anyone can delete knowledge"
ON public.ai_knowledge
FOR DELETE
USING (true);