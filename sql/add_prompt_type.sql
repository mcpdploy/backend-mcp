-- Add prompt_type column to prompts table
ALTER TABLE mcp_prompts
ADD COLUMN IF NOT EXISTS prompt_type TEXT DEFAULT 'basic' CHECK (prompt_type IN ('basic', 'context_aware'));

-- Update existing prompts based on whether they have completion_config
UPDATE mcp_prompts 
SET prompt_type = 'context_aware' 
WHERE completion_config IS NOT NULL 
  AND completion_config != '{}'::jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN mcp_prompts.prompt_type IS 'Type of prompt: basic (simple template) or context_aware (with completion configuration)'; 