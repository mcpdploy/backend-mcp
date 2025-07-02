-- Enhanced Resources Migration
-- Adds support for static, dynamic (with parameters), and context-aware resources

-- Add resource_type column to distinguish between static, dynamic, and context-aware resources
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS resource_type TEXT DEFAULT 'static' CHECK (resource_type IN ('static', 'dynamic', 'context_aware'));

-- Add template pattern for dynamic resources (e.g., "users://{userId}/profile")
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS template_pattern TEXT;

-- Add parameters configuration for dynamic resources
-- This will store parameter definitions as JSON, e.g., {"userId": {"description": "The user ID", "type": "string"}}
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS parameters JSONB;

-- Add completion configuration for context-aware resources
-- This will store completion rules as JSON
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS completion_config JSONB;

-- Add static content for static resources (when no api_url is provided)
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS static_content TEXT;

-- Add mime type for resources
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT 'application/json';

-- Add title for better resource identification
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS title TEXT;

-- Add description for resources
ALTER TABLE mcp_resources
ADD COLUMN IF NOT EXISTS description TEXT;

-- Example data structure for completion_config:
-- {
--   "list": undefined,  // or specific list configuration
--   "complete": {
--     "paramName": {
--       "type": "function",
--       "logic": "if (context?.arguments?.['owner'] === 'org1') { return ['project1', 'project2', 'project3'].filter(r => r.startsWith(value)); }"
--     }
--   }
-- }

-- Comment on the new columns
COMMENT ON COLUMN mcp_resources.resource_type IS 'Type of resource: static, dynamic, or context_aware';
COMMENT ON COLUMN mcp_resources.template_pattern IS 'Template pattern for dynamic resources, e.g., users://{userId}/profile';
COMMENT ON COLUMN mcp_resources.parameters IS 'Parameter definitions for dynamic resources';
COMMENT ON COLUMN mcp_resources.completion_config IS 'Completion configuration for context-aware resources';
COMMENT ON COLUMN mcp_resources.static_content IS 'Static content for resources when no api_url is provided';
COMMENT ON COLUMN mcp_resources.mime_type IS 'MIME type of the resource content';
COMMENT ON COLUMN mcp_resources.title IS 'Human-readable title for the resource';
COMMENT ON COLUMN mcp_resources.description IS 'Description of what the resource provides'; 