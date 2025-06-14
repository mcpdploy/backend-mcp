import { z } from "zod";

// Schemas for individual sub-items (Resources, Tools, Prompts)
export const baseResourceSchema = z.object({
  name: z.string().min(1),
  uri_pattern: z.string().min(1), 
  api_url: z.string().url().optional(),
  headers: z.record(z.string()).optional(), 
});

export const baseToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  api_url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  parameters: z.record(z.string()).optional(),
  http_method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").optional(),
});

export const basePromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  template: z.string().optional(),
  // api_url: z.string().url().optional(), // Removed as per user request
  parameters: z.record(z.string()).optional(),
  // http_method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").optional(), // Removed as per user request
});

// Schemas for sub-items when included in project create/update payloads
export const projectSubResourceSchema = baseResourceSchema.extend({
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
  resources: z.array(baseResourceSchema).optional(),
  tools: z.array(baseToolSchema).optional(),
  prompts: z.array(basePromptSchema).optional(),
});

export const mcpProjectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  is_active: z.boolean().optional(),
  resources: z.array(projectSubResourceSchema).optional(),
  tools: z.array(projectSubToolSchema).optional(),
  prompts: z.array(projectSubPromptSchema).optional(),
}); 

// Subscription Plan Schema
export const subscriptionPlanSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string(),
  price: z.number(),
  stripe_price_id: z.string(),
  features: z.record(z.any()).optional(),
  max_projects: z.number(),
  max_custom_domains: z.number(),
  max_requests_per_day: z.number(),
  max_requests_per_month: z.number(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// User Subscription Schema
export const userSubscriptionSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string(),
  plan_id: z.string(),
  status: z.enum(["active", "inactive", "canceled", "past_due", "trialing"]).default("inactive"),
  current_period_end: z.string().optional(),
  usage: z.record(z.any()).optional(), // e.g., { projects: 3, custom_domains: 1, requests_today: 100, requests_this_month: 1000 }
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}); 