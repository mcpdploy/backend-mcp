-- Add tool_type column to mcp_tools table
-- This column clarifies the type of tool: static, api, or resource_link

ALTER TABLE mcp_tools 
ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'static';

-- Add constraint to ensure valid tool types
ALTER TABLE mcp_tools 
ADD CONSTRAINT check_tool_type 
CHECK (tool_type IN ('static', 'api', 'resource_link'));

-- Update existing tools based on their configuration
UPDATE mcp_tools 
SET tool_type = CASE
    WHEN api_url IS NOT NULL THEN 'api'
    WHEN resource_links IS NOT NULL THEN 'resource_link'
    ELSE 'static'
END
WHERE tool_type = 'static';

-- Add comment for documentation
COMMENT ON COLUMN mcp_tools.tool_type IS 'Type of tool: static (simple calculations with static_result), api (external API calls with api_url), or resource_link (returns resource links)'; 