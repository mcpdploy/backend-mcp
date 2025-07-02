-- Add visible column to mcp_servers table
-- This column controls whether a project appears in public listings

ALTER TABLE mcp_servers 
ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN mcp_servers.visible IS 'Whether this project is visible in public listings. Only visible=true projects appear in the /public/mcp-projects endpoint.';

-- Create index for performance on public queries
CREATE INDEX IF NOT EXISTS idx_mcp_servers_visible_active 
ON mcp_servers (visible, is_active) 
WHERE visible = true AND is_active = true; 