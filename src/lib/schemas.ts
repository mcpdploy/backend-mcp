import { z } from "zod";

// Base resource fields without validation
const baseResourceFields = {
  name: z.string().min(1),
  uri: z.string().min(1), // Single field for all URI patterns
  resource_type: z.enum(['static', 'dynamic', 'context_aware']).default('static').optional(),
  parameters: z.record(z.object({
    description: z.string().optional(),
    type: z.string().optional(),
    required: z.boolean().optional()
  })).optional(), // Parameter definitions for dynamic resources
  completion_config: z.record(z.any()).optional(), // Completion configuration for context-aware resources
  static_content: z.string().optional(), // Static content when no api_url
  mime_type: z.string().default('application/json').optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  api_url: z.string().url().optional(),
  headers: z.record(z.string()).optional(), 
};

// Schemas for individual sub-items (Resources, Tools, Prompts)
export const baseResourceSchema = z.object(baseResourceFields);

export const baseToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(), // Human-readable title
  description: z.string().optional(),
  tool_type: z.enum(['static', 'api', 'resource_link']).default('static').optional(), // Tool type for clarity
  parameters: z.record(z.union([
    z.string(), // Legacy: simple string description
    z.object({
      type: z.enum(['string', 'number', 'boolean', 'array', 'object']).default('string').optional(),
      description: z.string().optional(),
      required: z.boolean().default(true).optional(),
      default: z.any().optional()
    })
  ])).optional(),
  // Implementation options (one of these should be provided)
  static_result: z.string().optional(), // Simple tools with static results
  api_url: z.string().url().optional(), // Async tools with API calls
  headers: z.record(z.string()).optional(),
  http_method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").optional(),
  resource_links: z.array(z.object({ // Tools that return resource links
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().optional(),
    description: z.string().optional()
  })).optional(),
  resource_links_header: z.string().optional() // Optional header text for resource links
});

export const basePromptSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(), // Human-readable title
  description: z.string().optional(),
  prompt_type: z.enum(['basic', 'context_aware']).default('basic').optional(), // Prompt type for clarity
  template: z.string().min(1), // Required template
  role: z.enum(['user', 'assistant']).default('user').optional(), // Message role
  // Use 'arguments' for MCP compliance (prompt arguments), keep 'parameters' for backward compatibility
  arguments: z.record(z.union([
    z.string(), // Legacy: simple string description
    z.object({
      type: z.enum(['string', 'number', 'boolean', 'array', 'object']).default('string').optional(),
      description: z.string().optional(),
      required: z.boolean().default(true).optional(),
      default: z.any().optional(),
      completion: z.string().optional() // Completion logic for context-aware prompts
    })
  ])).optional(),
  // Keep parameters for backward compatibility
  parameters: z.record(z.union([
    z.string(), // Legacy: simple string description
    z.object({
      type: z.enum(['string', 'number', 'boolean', 'array', 'object']).default('string').optional(),
      description: z.string().optional(),
      required: z.boolean().default(true).optional(),
      default: z.any().optional(),
      completion: z.string().optional() // Completion logic for context-aware prompts
    })
  ])).optional(),
  completion_config: z.record(z.any()).optional() // Completion configuration for context-aware prompts
});

// Schemas for sub-items when included in project create/update payloads
export const projectSubResourceSchema = z.object({
  ...baseResourceFields,
  id: z.string().uuid().optional(),
});

export const projectSubToolSchema = baseToolSchema.extend({
  id: z.string().uuid().optional(),
});

export const projectSubPromptSchema = basePromptSchema.extend({
  id: z.string().uuid().optional(),
});

// Main MCP Project Schemas including sub-items
export const mcpProjectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  is_private: z.boolean().optional(),
  visible: z.boolean().optional().default(false),
  session_management: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  resources: z.array(baseResourceSchema).optional(),
  tools: z.array(baseToolSchema).optional(),
  prompts: z.array(basePromptSchema).optional(),
});

export const mcpProjectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  is_private: z.boolean().optional(),
  visible: z.boolean().optional(),
  is_active: z.boolean().optional(),
  session_management: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  resources: z.array(projectSubResourceSchema).optional(),
  tools: z.array(projectSubToolSchema).optional(),
  prompts: z.array(projectSubPromptSchema).optional(),
}); 