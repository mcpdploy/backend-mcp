-- Migration: allow api_key to be nullable for non-private projects
ALTER TABLE public.mcp_servers
  ALTER COLUMN api_key DROP NOT NULL; 