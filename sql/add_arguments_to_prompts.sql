-- Add arguments column to mcp_prompts table for MCP compliance
ALTER TABLE mcp_prompts
ADD COLUMN IF NOT EXISTS arguments JSONB;

-- Comment on the new column
COMMENT ON COLUMN mcp_prompts.arguments IS 'MCP-compliant prompt arguments (preferred over parameters)';

-- For existing prompts, copy parameters to arguments if arguments is null
UPDATE mcp_prompts 
SET arguments = parameters 
WHERE arguments IS NULL AND parameters IS NOT NULL; 