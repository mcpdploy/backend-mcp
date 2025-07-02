-- Fix the completion config to match the current argument order
-- Current argument order: name (0), department (1)
-- So we need to swap the completion configs

UPDATE mcp_prompts 
SET completion_config = jsonb_build_object(
  'complete', jsonb_build_object(
    'name', jsonb_build_object(
      'type', 'conditional',
      'default', jsonb_build_array('Guest'),
      'conditions', jsonb_build_array(
        jsonb_build_object(
          'when', jsonb_build_object('department', 'engineering'),
          'values', jsonb_build_array('Alice', 'Bob', 'Charlie')
        ),
        jsonb_build_object(
          'when', jsonb_build_object('department', 'sales'),
          'values', jsonb_build_array('David', 'Emma', 'Frank')
        ),
        jsonb_build_object(
          'when', jsonb_build_object('department', 'marketing'),
          'values', jsonb_build_array('Henry', 'Iris', 'Jack', 'Kate')
        ),
        jsonb_build_object(
          'when', jsonb_build_object('department', 'support'),
          'values', jsonb_build_array('Liam', 'Maya', 'Noah')
        )
      )
    ),
    'department', jsonb_build_object(
      'type', 'static',
      'values', jsonb_build_array('engineering', 'sales', 'marketing', 'support')
    )
  )
)
WHERE name = 'team-greeting'; 