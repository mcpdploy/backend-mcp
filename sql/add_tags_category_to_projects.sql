-- Add tags and category columns to mcp_servers table
-- These columns help with project organization and discoverability

-- Add tags column to store array of string tags
ALTER TABLE mcp_servers 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT NULL;

-- Add category column to store main project category
ALTER TABLE mcp_servers 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN mcp_servers.tags IS 'Array of tags for categorizing and organizing projects (e.g., ["AI", "Automation", "API"])';
COMMENT ON COLUMN mcp_servers.category IS 'Main category or domain of the project (e.g., "Development", "Machine Learning", "Data Analysis")';

-- Create index for better performance on tag searches
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tags 
ON mcp_servers USING GIN (tags);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_mcp_servers_category 
ON mcp_servers (category) 
WHERE category IS NOT NULL; 