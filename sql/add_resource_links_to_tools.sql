-- Add resource_links and resource_links_header columns to mcp_tools table
-- This supports tools that return resource links (like file listings)

ALTER TABLE mcp_tools 
ADD COLUMN resource_links JSONB NULL,
ADD COLUMN resource_links_header TEXT NULL;

-- Add comments to document the new columns
COMMENT ON COLUMN mcp_tools.resource_links IS 'Array of resource link objects for tools that return file/resource references. Each object should have uri, name, mimeType, and description properties.';
COMMENT ON COLUMN mcp_tools.resource_links_header IS 'Optional header text displayed before resource links. Supports parameter substitution with {paramName} syntax.';

-- Example of resource_links structure:
-- [
--   {
--     "uri": "file:///project/README.md",
--     "name": "README.md", 
--     "mimeType": "text/markdown",
--     "description": "Project documentation"
--   },
--   {
--     "uri": "file:///project/src/index.ts",
--     "name": "index.ts",
--     "mimeType": "text/typescript", 
--     "description": "Main application entry point"
--   }
-- ] 