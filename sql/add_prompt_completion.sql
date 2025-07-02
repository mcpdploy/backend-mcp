-- Add completion_config column to mcp_prompts table
ALTER TABLE mcp_prompts
ADD COLUMN IF NOT EXISTS completion_config JSONB;

-- Comment on the new column
COMMENT ON COLUMN mcp_prompts.completion_config IS 'Completion configuration for context-aware prompts';

-- Update the team-greeting prompt to include completion configuration
UPDATE mcp_prompts
SET completion_config = '{
  "complete": {
    "department": {
      "type": "static",
      "values": ["engineering", "sales", "marketing", "support"]
    },
    "name": {
      "type": "conditional",
      "conditions": [
        {
          "when": { "department": "engineering" },
          "values": ["Alice", "Bob", "Charlie", "Diana"]
        },
        {
          "when": { "department": "sales" },
          "values": ["David", "Eve", "Frank", "Grace"]
        },
        {
          "when": { "department": "marketing" },
          "values": ["Henry", "Iris", "Jack", "Kate"]
        },
        {
          "when": { "department": "support" },
          "values": ["Liam", "Mia", "Noah", "Olivia"]
        }
      ],
      "default": ["Guest", "Visitor"]
    }
  }
}'::jsonb
WHERE name = 'team-greeting'; 