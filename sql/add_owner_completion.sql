-- Update the repository resource to include owner parameter completion
UPDATE mcp_resources
SET completion_config = jsonb_set(
  COALESCE(completion_config, '{}'::jsonb),
  '{complete,owner}',
  '{
    "type": "static",
    "values": ["org1", "microsoft", "facebook", "google", "modelcontextprotocol", "anthropics", "openai", "vercel", "supabase"]
  }'::jsonb,
  true
)
WHERE name = 'repository' 
  AND uri = 'github://repos/{owner}/{repo}'; 