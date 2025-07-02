-- Fix the argument order for team-greeting prompt
-- Currently: name (0), department (1)  
-- Should be: department (0), name (1)

UPDATE mcp_prompts 
SET arguments = jsonb_build_object(
  'department', jsonb_build_object(
    'type', 'string',
    'required', true,
    'description', 'Department name'
  ),
  'name', jsonb_build_object(
    'type', 'string', 
    'required', true,
    'description', 'Team member name'
  )
)
WHERE name = 'team-greeting'; 