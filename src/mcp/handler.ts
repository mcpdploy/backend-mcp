import { z } from 'zod'; // For paramSchema construction
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  isInitializeRequest,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { supabase } from "../lib/supabaseClient"; // Path to supabase client
import { checkAndIncrementUsage } from '../routes/management';
import { randomUUID } from "node:crypto";

// Safe evaluation of completion logic without using eval() or new Function()
function evaluateCompletionLogic(logic: string, value: string, context: any): string[] {
  console.log(`[evaluateCompletionLogic] Called with:`, {
    logic: logic,
    value: value,
    context: context
  });
  
  try {
    // Parse common patterns from the logic string
    // This is a safe subset that handles the most common completion patterns
    
    // Pattern 1: if (context?.arguments?.["owner"] === "org1") { return ["project1", "project2", "project3"].filter(r => r.startsWith(value)); }
    const conditionalMatch = logic.match(/if\s*\(\s*context\?\.\s*arguments\?\.\s*\[\s*["']([^"']+)["']\s*\]\s*===\s*["']([^"']+)["']\s*\)\s*{\s*return\s*\[(.*?)\]\.filter\([^)]+\)\s*;\s*}/);
    if (conditionalMatch) {
      const [, paramName, paramValue, itemsStr] = conditionalMatch;
      const contextValue = context?.arguments?.[paramName];
      
      console.log(`[evaluateCompletionLogic] Conditional match found:`, {
        paramName,
        paramValue,
        contextValue,
        itemsStr
      });
      
      if (contextValue === paramValue) {
        // Parse the array items
        const items = itemsStr.split(',').map(item => item.trim().replace(/["']/g, ''));
        const filtered = items.filter(item => item.toLowerCase().startsWith(value.toLowerCase()));
        console.log(`[evaluateCompletionLogic] Returning filtered items:`, filtered);
        return filtered;
      }
    }
    
    // Pattern 2: return ["default-repo"].filter(r => r.startsWith(value));
    // Also handle simpler patterns like: return ["item1", "item2"]
    const returnArrayMatch = logic.match(/return\s*\[(.*?)\]/);
    if (returnArrayMatch) {
      const [, itemsStr] = returnArrayMatch;
      const items = itemsStr.split(',').map(item => item.trim().replace(/["']/g, ''));
      
      // Check if there's a filter clause
      const hasFilter = logic.includes('.filter(');
      if (hasFilter) {
        const filtered = items.filter(item => item.toLowerCase().startsWith(value.toLowerCase()));
        console.log(`[evaluateCompletionLogic] Return array with filter - returning filtered items:`, filtered);
        return filtered;
      } else {
        // No filter, return all items
        console.log(`[evaluateCompletionLogic] Return array without filter - returning all items:`, items);
        return items;
      }
    }
    
    // Pattern 3: Multiple conditions (with or without else)
    // This handles patterns like: if (...) { return [...] } return [...]
    const hasConditional = logic.includes('if (') || logic.includes('if(');
    const hasReturn = logic.includes('return');
    
    if (hasConditional && hasReturn) {
      // First, try to match all if conditions
      const ifMatches = [...logic.matchAll(/if\s*\(\s*context\?\.\s*arguments\?\.\s*\[\s*["']([^"']+)["']\s*\]\s*===\s*["']([^"']+)["']\s*\)\s*{\s*return\s*\[(.*?)\](?:\.filter\([^)]+\))?\s*;\s*}/g)];
      
      console.log(`[evaluateCompletionLogic] Found ${ifMatches.length} if conditions`);
      
      for (const match of ifMatches) {
        const [fullMatch, paramName, paramValue, itemsStr] = match;
        const contextValue = context?.arguments?.[paramName];
        
        console.log(`[evaluateCompletionLogic] Checking condition: ${paramName} === ${paramValue}, actual value: ${contextValue}`);
        
        if (contextValue === paramValue) {
          const items = itemsStr.split(',').map(item => item.trim().replace(/["']/g, ''));
          
          // Check if this specific return has a filter
          const hasFilter = fullMatch.includes('.filter(');
          if (hasFilter) {
            const filtered = items.filter(item => item.toLowerCase().startsWith(value.toLowerCase()));
            console.log(`[evaluateCompletionLogic] Condition matched with filter - returning filtered items:`, filtered);
            return filtered;
          } else {
            console.log(`[evaluateCompletionLogic] Condition matched without filter - returning all items:`, items);
            return items;
          }
        }
      }
      
      // No conditions matched, look for a final return statement
      // This matches returns that come after all if blocks
      const finalReturnMatch = logic.match(/}\s*return\s*\[(.*?)\](?:\.filter\([^)]+\))?\s*;?\s*$/);
      if (finalReturnMatch) {
        const [fullMatch, itemsStr] = finalReturnMatch;
        const items = itemsStr.split(',').map(item => item.trim().replace(/["']/g, ''));
        
        // Check if there's a filter clause
        const hasFilter = fullMatch.includes('.filter(');
        if (hasFilter) {
          const filtered = items.filter(item => item.toLowerCase().startsWith(value.toLowerCase()));
          console.log(`[evaluateCompletionLogic] Final return with filter - returning filtered items:`, filtered);
          return filtered;
        } else {
          console.log(`[evaluateCompletionLogic] Final return without filter - returning all items:`, items);
          return items;
        }
      }
    }
    
    console.warn(`[evaluateCompletionLogic] Unsupported logic pattern: ${logic}`);
    console.log(`[evaluateCompletionLogic] Returning empty array`);
    return [];
  } catch (error) {
    console.error(`[evaluateCompletionLogic] Error evaluating logic:`, error);
    console.log(`[evaluateCompletionLogic] Returning empty array due to error`);
    return [];
  }
}

// Global map to store active session transports
const sessionTransports: Record<string, StreamableHTTPServerTransport> = {};

// Global server cache to prevent recreation on every request
const serverCache = new Map<string, { mcpServer: any, lastUpdated: number }>();

// Cache timeout (5 minutes)
const CACHE_TIMEOUT = 5 * 60 * 1000;

// Helper function to clean up expired cache entries
function cleanupExpiredCacheEntries(): void {
  const now = Date.now();
  const beforeSize = serverCache.size;
  let cleanedCount = 0;
  
  for (const [key, entry] of serverCache.entries()) {
    if (now - entry.lastUpdated >= CACHE_TIMEOUT) {
      try {
        entry.mcpServer.close();
      } catch (e) {
        console.log(`[Cache Cleanup] Error closing expired server ${key}:`, e);
      }
      serverCache.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[Cache Cleanup] Cleaned ${cleanedCount} expired entries. Cache size: ${beforeSize} -> ${serverCache.size}`);
  }
}

// Helper: Generate HTML Info Page (Copied from index.ts)
function generateInfoPage(
  mcpIdentifier: string,
  project: any, // Consider defining a more specific type for project if possible
  resources: any[] = [],
  tools: any[] = [],
  prompts: any[] = [],
  baseUrl: string,
) {
  const projectBaseUrl = `${baseUrl}/mcp/${mcpIdentifier}`;
  const sseEndpoint = `${projectBaseUrl}/sse`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Server: ${project.name}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.6; padding: 20px; background-color: #f4f4f4; color: #333; }
    .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    h1, h2 { color: #333; }
    pre { background: #eee; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .api-key { font-family: monospace; background: #eee; padding: 2px 5px; border-radius: 3px; }
    .badge { display: inline-block; padding: 0.25em 0.5em; font-size: 75%; font-weight: 700; line-height: 1; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: 0.25rem; }
    .badge-active { color: #fff; background-color: #28a745; }
    .badge-inactive { color: #fff; background-color: #dc3545; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MCP Server: ${project.name} <span class="badge ${project.is_active ? 'badge-active' : 'badge-inactive'}">${project.is_active ? 'Active' : 'Inactive'}</span></h1>
    <p><strong>Version:</strong> ${project.version || "N/A"}</p>
    <p><strong>Description:</strong> ${project.description || "N/A"}</p>
    <p><strong>Project ID (Instance ID):</strong> ${project.id}</p>
    ${project.api_key ? `<p><strong>API Key:</strong> <span class="api-key">******** (Set in headers)</span></p>` : ''}

    <h2>Endpoints</h2>
    <p>Base URL: <code>${projectBaseUrl}</code></p>
    <p>SSE URL: <code>${sseEndpoint}</code> (if applicable)</p>
    
    <h2>Resources (${resources.length})</h2>
    ${resources.length > 0 ? '<ul>' + resources.map(r => {
      const pattern = r.uri_pattern || r.template_pattern || r.uri;
      const resourceType = r.resource_type || 'static';
      const typeLabel = resourceType === 'static' ? '' : ` (${resourceType})`;
      return `<li><strong>${r.name}</strong>${typeLabel}: <code>${pattern}</code> ${r.api_url ? '(Proxies: ' + r.api_url + ')' : ''}</li>`;
    }).join('') + '</ul>' : '<p>No resources configured.</p>'}
    
    <h2>Tools (${tools.length})</h2>
    ${tools.length > 0 ? '<ul>' + tools.map(t => `<li><strong>${t.name}</strong> ${t.api_url ? '(Calls: ' + t.api_url + ')' : ''}</li>`).join('') + '</ul>' : '<p>No tools configured.</p>'}
    
    <h2>Prompts (${prompts.length})</h2>
    ${prompts.length > 0 ? '<ul>' + prompts.map(p => `<li><strong>${p.name}</strong> ${p.api_url ? '(Calls: ' + p.api_url + ')' : ''}</li>`).join('') + '</ul>' : '<p>No prompts configured.</p>'}
  </div>
</body>
</html>`;
}

// Dynamic MCP Server Handler (Copied and adapted from index.ts)
export const mcpDynamicHandler = async (c: any) => { // c should be typed with Hono Context, e.g., Context<Env>
  console.log(`[mcpDynamicHandler] ENTERED. Path: ${c.req.path}, Method: ${c.req.method}`);

  const path = c.req.path;
  const pathSegments = path.split('/').filter(Boolean);
  if (pathSegments.length < 2 || pathSegments[0] !== 'mcp') {
    console.log(`[mcpDynamicHandler] Invalid path structure: ${path}`);
    return c.json({ error: 'Invalid MCP path structure. Expected /mcp/<identifier>' }, 400);
  }
  
  const mcpIdentifier = pathSegments[1];
  console.log(`[mcpDynamicHandler] Received mcpIdentifier from param: "${mcpIdentifier}"`);

  if (!mcpIdentifier || mcpIdentifier === 'undefined') {
    console.log(`[mcpDynamicHandler] Missing or invalid mcpIdentifier: "${mcpIdentifier}"`);
    return c.json({ error: 'Missing mcpIdentifier parameter' }, 400);
  }

  // Extract project ID by finding a UUID pattern in the identifier
  // This handles any format like: name-uuid, prefix-uuid, etc.
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const uuidMatch = mcpIdentifier.match(uuidPattern);
  const projectId = uuidMatch ? uuidMatch[0] : mcpIdentifier;
  
  console.log(`[mcpDynamicHandler] Extracted projectId: "${projectId}" from mcpIdentifier: "${mcpIdentifier}"`);

  console.log(`[mcpDynamicHandler] Attempting to fetch project from Supabase with id: "${projectId}"`);
  const { data: project, error: fetchError } = await supabase
    .from('mcp_servers')
    .select(`
      *,
      mcp_resources (*),
      mcp_tools (*),
      mcp_prompts (*)
    `)
    .eq('id', projectId)
      .single();

  if (fetchError || !project) {
    console.error(`[mcpDynamicHandler] Error fetching project:`, fetchError);
    return c.json({ error: 'Project not found' }, 404);
  }

  console.log(`[mcpDynamicHandler] Successfully fetched project: "${project.name}" (ID: ${project.id})`);

  // --- API Key Enforcement for private projects ---
  if (project.is_private) {
    const apiKeyHeader = c.req.header("X-API-Key");
    if (!apiKeyHeader || apiKeyHeader !== project.api_key) {
      console.warn(`[mcpDynamicHandler] Invalid or missing API key for private project ${project.id}`);
      return c.json({ error: "Unauthorized: Invalid or missing API key" }, 401);
    }
  }
  // --- End API Key Enforcement ---

  if (!project.is_active) {
    console.log(`[mcpDynamicHandler] Project "${project.name}" (ID: ${project.id}) is not active. Returning 503.`);
    return c.json({ error: "MCP project is not active." }, 503);
  }
  
  // --- USAGE TRACKING & LIMITING (per project owner) ---
  console.log(`[mcpDynamicHandler] ==================== USAGE TRACKING ====================`);
  const projectOwnerId = project.user_id;
  if (!projectOwnerId) {
    console.error(`[mcpDynamicHandler] Project ${project.id} has no user_id (owner). Cannot track usage.`);
    return c.json({ error: "Project misconfigured: missing owner." }, 500);
  }
  
  console.log(`[mcpDynamicHandler] Tracking usage for project ${project.id} (owner: ${projectOwnerId})`);
  console.log(`[mcpDynamicHandler] Request: ${c.req.method} ${c.req.path}`);
  console.log(`[mcpDynamicHandler] User-Agent: ${c.req.header('user-agent') || 'Not provided'}`);
  
  // Daily limit
  console.log(`[mcpDynamicHandler] Checking daily usage limit...`);
  const { allowed: allowedDay, error: errorDay, status: statusDay, usage: dailyUsage, plan: dailyPlan } = await checkAndIncrementUsage({ userId: projectOwnerId, usageType: 'requests_today' });
  console.log(`[mcpDynamicHandler] Daily usage check result: allowed=${allowedDay}, error="${errorDay}"`);
  if (dailyUsage && dailyPlan) {
    console.log(`[mcpDynamicHandler] 📊 DAILY USAGE: ${dailyUsage.requests_today || 0}/${dailyPlan.max_requests_per_day || 'unlimited'} requests (${dailyUsage.requests_today_date})`);
  }
  if (!allowedDay) {
    console.warn(`[mcpDynamicHandler] Daily quota exceeded for project ${project.id} (owner ${projectOwnerId}): ${errorDay}`);
    return c.json({ error: errorDay }, statusDay ?? 429);
  }
  
  // Monthly limit
  console.log(`[mcpDynamicHandler] Checking monthly usage limit...`);
  const { allowed: allowedMonth, error: errorMonth, status: statusMonth, usage: monthlyUsage, plan: monthlyPlan } = await checkAndIncrementUsage({ userId: projectOwnerId, usageType: 'requests_this_month' });
  console.log(`[mcpDynamicHandler] Monthly usage check result: allowed=${allowedMonth}, error="${errorMonth}"`);
  if (monthlyUsage && monthlyPlan) {
    console.log(`[mcpDynamicHandler] 📊 MONTHLY USAGE: ${monthlyUsage.requests_this_month || 0}/${monthlyPlan.max_requests_per_month || 'unlimited'} requests (${monthlyUsage.requests_this_month_date})`);
  }
  if (!allowedMonth) {
    console.warn(`[mcpDynamicHandler] Monthly quota exceeded for project ${project.id} (owner ${projectOwnerId}): ${errorMonth}`);
    return c.json({ error: errorMonth }, statusMonth ?? 429);
  }
  console.log(`[mcpDynamicHandler] ==================== END USAGE TRACKING ====================`);
  // --- END USAGE TRACKING & LIMITING ---

  // Check cache first and clean up expired entries
  const cacheKey = projectId;
  
  console.log(`[mcpDynamicHandler] ==================== CACHE CHECK ====================`);
  console.log(`[mcpDynamicHandler] Cache key: ${cacheKey}`);
  console.log(`[mcpDynamicHandler] Cache size before cleanup: ${serverCache.size}`);
  
  // Clean up expired entries on each request to prevent memory leaks
  cleanupExpiredCacheEntries();
  
  const cached = serverCache.get(cacheKey);
  let mcpServer: any;
  
  console.log(`[mcpDynamicHandler] Cache size after cleanup: ${serverCache.size}`);
  console.log(`[mcpDynamicHandler] All cache keys: [${Array.from(serverCache.keys()).join(', ')}]`);
  console.log(`[mcpDynamicHandler] Cached entry exists: ${!!cached}`);
  
  if (cached) {
    const age = Date.now() - cached.lastUpdated;
    const isExpired = age >= CACHE_TIMEOUT;
    console.log(`[mcpDynamicHandler] Cache entry age: ${age}ms (${Math.round(age/1000)}s)`);
    console.log(`[mcpDynamicHandler] Cache timeout: ${CACHE_TIMEOUT}ms (${CACHE_TIMEOUT/1000}s)`);
    console.log(`[mcpDynamicHandler] Cache expired: ${isExpired}`);
  }
  
  if (cached && (Date.now() - cached.lastUpdated) < CACHE_TIMEOUT) {
    console.log(`[mcpDynamicHandler] ✅ CACHE HIT - Using cached MCP server for project ${projectId}`);
    mcpServer = cached.mcpServer;
  } else {
    console.log(`[mcpDynamicHandler] ❌ CACHE MISS - Creating new MCP server for project ${projectId}`);
    
    // Clean up old cache entry if it exists
    if (cached) {
      console.log(`[mcpDynamicHandler] Cleaning up expired cached server`);
      try {
        cached.mcpServer.close();
      } catch (e) {
        console.log(`[mcpDynamicHandler] Error closing old server:`, e);
      }
    }
    
    mcpServer = new McpServer(
      {
        name: project.name || "Dynamic MCP Server",
        version: "1.0.0",
        description: project.description || "Dynamically configured MCP server",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {},
        },
      }
    );

    console.log(`[mcpDynamicHandler] Registering capabilities...`);
    
    for (const resConfig of (project.mcp_resources || [])) {
      console.log(`[mcpDynamicHandler] Registering resource: ${resConfig.name}`, {
        resource_type: resConfig.resource_type,
        uri: resConfig.uri,
        uri_pattern: resConfig.uri_pattern,
        template_pattern: resConfig.template_pattern,
        api_url: resConfig.api_url,
        static_content: resConfig.static_content ? 'Present' : 'Not present'
      });
      
      const resourceType = resConfig.resource_type || 'static';
      const resourceMetadata = {
        mimeType: resConfig.mime_type || "application/json",
        description: resConfig.description,
        title: resConfig.title
      };

      // Determine if this is a static or dynamic resource
      // Check for 'uri' first (new field), then fall back to old field names
      const uriPattern = resConfig.uri || resConfig.uri_pattern || resConfig.template_pattern || `/${resConfig.name.toLowerCase().replace(/\s+/g, '-')}`;
      
      console.log(`[mcpDynamicHandler] Final URI pattern for resource "${resConfig.name}": "${uriPattern}"`);
      
      // Check if this is a dynamic resource that needs template registration
      if ((resourceType === 'dynamic' || resourceType === 'context_aware') && (resConfig.uri || resConfig.template_pattern)) {
        // For dynamic resources, we need to use the ResourceTemplate API
        // Convert our template format to RFC 6570 format
        // e.g., "weather://{city}" is already in the correct format
        const templatePattern = resConfig.uri || resConfig.template_pattern;
        
        // Build the template options
        const templateOptions: any = { list: undefined };
        
        // For context-aware resources, add the complete functions
        if (resourceType === 'context_aware' && resConfig.completion_config?.complete) {
          templateOptions.complete = {};
          
          console.log(`[mcpDynamicHandler] Processing completion config for resource "${resConfig.name}":`, resConfig.completion_config.complete);
          
          // Add default completion for owner parameter if this is the GitHub repos resource
          if (templatePattern === 'github://repos/{owner}/{repo}') {
            // Add owner completion with common organizations
            templateOptions.complete['owner'] = (value: string, context: any) => {
              console.log(`[mcpDynamicHandler] Owner completion for value "${value}"`);
              const owners = ['org1', 'microsoft', 'facebook', 'google', 'modelcontextprotocol', 'anthropics', 'openai'];
              const filtered = owners.filter(owner => owner.toLowerCase().startsWith(value.toLowerCase()));
              console.log(`[mcpDynamicHandler] Returning owner completions:`, filtered);
              return filtered;
            };
            console.log(`[mcpDynamicHandler] Added default owner completion for GitHub repos resource`);
          }
          
          // Process each parameter's completion function
          for (const [param, config] of Object.entries(resConfig.completion_config.complete)) {
            if (typeof config === 'object' && config !== null) {
              const completionConfig = config as any;
              
              // Create completion function based on configuration
              if (completionConfig.type === 'static' && Array.isArray(completionConfig.values)) {
                // Static list of completions
                templateOptions.complete[param] = (value: string, context: any) => {
                  console.log(`[mcpDynamicHandler] Static completion for param "${param}" with value "${value}"`);
                  const filtered = completionConfig.values.filter((item: string) => 
                    item.toLowerCase().startsWith(value.toLowerCase())
                  );
                  console.log(`[mcpDynamicHandler] Returning static completions:`, filtered);
                  return filtered;
                };
                console.log(`[mcpDynamicHandler] Added static completion for parameter "${param}" with values:`, completionConfig.values);
              } else if (completionConfig.type === 'conditional' && completionConfig.conditions) {
                // Conditional completions based on other parameters
                templateOptions.complete[param] = (value: string, context: any) => {
                  console.log(`[mcpDynamicHandler] Conditional completion for param "${param}" with value "${value}", context:`, context);
                  
                  // Check each condition
                  for (const condition of completionConfig.conditions) {
                    if (condition.when && condition.values) {
                      // Check if all conditions match
                      let allMatch = true;
                      for (const [key, expectedValue] of Object.entries(condition.when)) {
                        if (context?.arguments?.[key] !== expectedValue) {
                          allMatch = false;
                          break;
                        }
                      }
                      
                      if (allMatch) {
                        const filtered = condition.values.filter((item: string) => 
                          item.toLowerCase().startsWith(value.toLowerCase())
                        );
                        console.log(`[mcpDynamicHandler] Condition matched, returning completions:`, filtered);
                        return filtered;
                      }
                    }
                  }
                  
                  // Default values if no conditions match
                  if (completionConfig.default && Array.isArray(completionConfig.default)) {
                    const filtered = completionConfig.default.filter((item: string) => 
                      item.toLowerCase().startsWith(value.toLowerCase())
                    );
                    console.log(`[mcpDynamicHandler] No conditions matched, returning default completions:`, filtered);
                    return filtered;
                  }
                  
                  console.log(`[mcpDynamicHandler] No completions found`);
                  return [];
                };
                console.log(`[mcpDynamicHandler] Added conditional completion for parameter "${param}"`);
              } else if (completionConfig.type === 'function' && completionConfig.logic) {
                // Legacy support for function strings (with security warning)
                console.warn(`[mcpDynamicHandler] Using legacy function string completion for parameter "${param}". Consider using static or conditional completion instead.`);
                const logic = completionConfig.logic;
                templateOptions.complete[param] = (value: string, context: any) => {
                  console.log(`[mcpDynamicHandler] Legacy completion function called for param "${param}" with value "${value}"`);
                  const result = evaluateCompletionLogic(logic, value, context);
                  console.log(`[mcpDynamicHandler] Legacy completion function returning:`, result);
                  return result;
                };
              }
            }
          }
          
          console.log(`[mcpDynamicHandler] Final templateOptions.complete:`, Object.keys(templateOptions.complete));
        }
        
        const resourceTemplate = new ResourceTemplate(templatePattern, templateOptions);
        
        console.log(`[mcpDynamicHandler] Registering ${resourceType} resource with template:`, templatePattern);
        if (templateOptions.complete) {
          console.log(`[mcpDynamicHandler] Resource has completion functions for parameters:`, Object.keys(templateOptions.complete));
        }
        
        mcpServer.registerResource(
      resConfig.name, 
          resourceTemplate, // Pass the ResourceTemplate instance
          resourceMetadata,
          async (uri: URL, variables: any): Promise<ReadResourceResult> => {
            console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL START ====================`);
            console.log(`[MCP Resource: ${resConfig.name}] Called for URI: ${uri.toString()}`);
            console.log(`[MCP Resource: ${resConfig.name}] Template variables:`, variables);
            console.log(`[MCP Resource: ${resConfig.name}] Resource type: ${resourceType}`);
            console.log(`[MCP Resource: ${resConfig.name}] Template pattern: ${templatePattern}`);
            console.log(`[MCP Resource: ${resConfig.name}] API URL: ${resConfig.api_url || 'Not set'}`);
            console.log(`[MCP Resource: ${resConfig.name}] Static content: ${resConfig.static_content ? 'Present' : 'Not present'}`);
            
            // Extract the city parameter for weather resource
            const city = variables.city || '';
            
            // If static_content is provided, return it directly (with parameter substitution)
            if (resConfig.static_content) {
              console.log(`[MCP Resource: ${resConfig.name}] Using static content`);
              let content = resConfig.static_content;
              
              // Replace template variables with actual values
              if (variables && Object.keys(variables).length > 0) {
                console.log(`[MCP Resource: ${resConfig.name}] Replacing template variables in static content`);
                for (const [key, value] of Object.entries(variables)) {
                  const beforeReplace = content;
                  const stringValue = Array.isArray(value) ? (value as any[])[0] : value;
                  content = content.replace(new RegExp(`{{${key}}}`, 'g'), String(stringValue));
                  console.log(`[MCP Resource: ${resConfig.name}] Replaced {{${key}}} with "${stringValue}": "${beforeReplace}" -> "${content}"`);
                }
              }
              
              console.log(`[MCP Resource: ${resConfig.name}] Final static content:`, content);
              console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (STATIC CONTENT) ====================`);
              return { 
                contents: [{
                  type: "text", 
                  text: content, 
                  uri: uri.toString()
                }] 
              };
            }
            
            // If api_url is provided, fetch from external API
            if (resConfig.api_url) {
              console.log(`[MCP Resource: ${resConfig.name}] Using API URL: ${resConfig.api_url}`);
              try {
                let url = resConfig.api_url;
                
                // Replace URL parameters
                if (variables && Object.keys(variables).length > 0) {
                  console.log(`[MCP Resource: ${resConfig.name}] Replacing URL parameters`);
                  for (const [key, value] of Object.entries(variables)) {
                    const beforeReplace = url;
                    const stringValue = Array.isArray(value) ? (value as any[])[0] : value;
                    url = url.replace(new RegExp(`{${key}}`, 'g'), String(stringValue));
                    console.log(`[MCP Resource: ${resConfig.name}] Replaced {${key}} with "${stringValue}": "${beforeReplace}" -> "${url}"`);
                  }
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Final URL to fetch:`, url);
                console.log(`[MCP Resource: ${resConfig.name}] Request headers:`, resConfig.headers || {});
                
                const fetchOptions: RequestInit = {
                  method: 'GET',
                  headers: resConfig.headers || {},
                };
                
                console.log(`[MCP Resource: ${resConfig.name}] Making fetch request...`);
                const response = await fetch(url, fetchOptions);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response status: ${response.status} ${response.statusText}`);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response headers:`, Object.fromEntries(response.headers.entries()));
                
                const text = await response.text();
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response body length: ${text.length} characters`);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response body preview: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
                
                if (!response.ok) {
                  console.error(`[MCP Resource: ${resConfig.name}] Fetch failed with status ${response.status}`);
                  console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (FETCH ERROR) ====================`);
                  return {
                    contents: [],
                    error: { 
                      code: "FETCH_ERROR", 
                      message: `Failed to fetch resource: ${response.status} ${response.statusText}` 
                    }
                  };
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Successfully fetched data`);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (API SUCCESS) ====================`);
                return { 
                  contents: [{
                    type: "text", 
                    text: text, 
                    uri: uri.toString()
                  }] 
                };
              } catch (error: any) {
                console.error(`[MCP Resource: ${resConfig.name}] Fetch error:`, error);
                console.error(`[MCP Resource: ${resConfig.name}] Error stack:`, error.stack);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (FETCH EXCEPTION) ====================`);
                return {
                  contents: [],
                  error: { 
                    code: "FETCH_ERROR", 
                    message: `Error fetching resource: ${error.message}` 
                  }
                };
              }
            }
            
            // Default response
            const paramInfo = variables ? Object.entries(variables)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ') : 'No parameters';
            
            console.log(`[MCP Resource: ${resConfig.name}] Returning default response with parameters: ${paramInfo}`);
            console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (DEFAULT WITH PARAMS) ====================`);
            return { 
              contents: [{
                type: "text", 
                text: `Resource ${resConfig.name} with parameters: ${paramInfo}`, 
                uri: uri.toString()
              }] 
            };
          }
        );
      } else {
        // Static resource registration (existing code)
        mcpServer.registerResource(
        resConfig.name, 
          uriPattern,
          resourceMetadata,
      async (mcpUri: URL, opts?: { headers?: Record<string, string>, signal?: AbortSignal }): Promise<ReadResourceResult> => { 
            console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL START ====================`);
        console.log(`[MCP Resource: ${resConfig.name}] Called for URI: ${mcpUri.toString()}`);
            console.log(`[MCP Resource: ${resConfig.name}] Resource type: ${resourceType}`);
            console.log(`[MCP Resource: ${resConfig.name}] URI pattern: ${uriPattern}`);
            console.log(`[MCP Resource: ${resConfig.name}] Template pattern: ${resConfig.template_pattern || 'Not set'}`);
            console.log(`[MCP Resource: ${resConfig.name}] API URL: ${resConfig.api_url || 'Not set'}`);
            console.log(`[MCP Resource: ${resConfig.name}] Static content: ${resConfig.static_content ? 'Present' : 'Not present'}`);
            console.log(`[MCP Resource: ${resConfig.name}] Options:`, opts);
            
            // Extract parameters from the URI if it's a dynamic resource
            const params: Record<string, string> = {};
            if (resourceType === 'dynamic' || resourceType === 'context_aware') {
              const templatePattern = resConfig.uri || resConfig.template_pattern || resConfig.uri_pattern;
              if (!templatePattern) {
                console.error(`[MCP Resource: ${resConfig.name}] No template pattern found for dynamic resource`);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (ERROR) ====================`);
                return {
                  contents: [],
                  error: {
                    code: "CONFIGURATION_ERROR",
                    message: "No template pattern configured for dynamic resource"
                  }
                };
              }
              
              // Convert the incoming URI to a string for matching
              const incomingUri = mcpUri.toString();
              console.log(`[MCP Resource: ${resConfig.name}] Matching URI "${incomingUri}" against template "${templatePattern}"`);
              
              // Create a regex pattern from the template pattern
              // Replace {param} with capturing groups
              let regexPattern = templatePattern
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except {}
                .replace(/\\{([^}]+)\\}/g, '([^/]+)'); // Replace {param} with capturing group
              
              // Handle the scheme:// part properly
              regexPattern = '^' + regexPattern + '$';
              
              console.log(`[MCP Resource: ${resConfig.name}] Generated regex pattern: ${regexPattern}`);
              
              const regex = new RegExp(regexPattern);
              const matchResult = incomingUri.match(regex);
              
              console.log(`[MCP Resource: ${resConfig.name}] Regex match result:`, matchResult);
              
              if (matchResult) {
                // Extract parameter names from template
                const paramNames: string[] = [];
                const paramRegex = /{([^}]+)}/g;
                let match;
                while ((match = paramRegex.exec(templatePattern)) !== null) {
                  paramNames.push(match[1]);
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Parameter names from template:`, paramNames);
                
                // Map captured values to parameter names
                for (let i = 0; i < paramNames.length; i++) {
                  if (matchResult[i + 1]) {
                    params[paramNames[i]] = matchResult[i + 1];
                  }
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Successfully extracted params:`, params);
              } else {
                console.log(`[MCP Resource: ${resConfig.name}] URI "${incomingUri}" does not match template "${templatePattern}"`);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (URI MISMATCH) ====================`);
                return {
                  contents: [],
                  error: {
                    code: "URI_MISMATCH",
                    message: `URI "${incomingUri}" does not match expected pattern "${templatePattern}"`
                  }
                };
              }
            }
            
            // If static_content is provided, return it directly (with parameter substitution for dynamic resources)
            if (resConfig.static_content) {
              console.log(`[MCP Resource: ${resConfig.name}] Using static content`);
              let content = resConfig.static_content;
              
              // Replace template variables with actual values for dynamic resources
              if (Object.keys(params).length > 0) {
                console.log(`[MCP Resource: ${resConfig.name}] Replacing template variables in static content`);
                for (const [key, value] of Object.entries(params)) {
                  const beforeReplace = content;
                  const stringValue = Array.isArray(value) ? value[0] : value; // Use first value if array
                  content = content.replace(new RegExp(`{{${key}}}`, 'g'), stringValue);
                  console.log(`[MCP Resource: ${resConfig.name}] Replaced {{${key}}} with "${stringValue}": "${beforeReplace}" -> "${content}"`);
                }
              }
              
              console.log(`[MCP Resource: ${resConfig.name}] Final static content:`, content);
              console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (STATIC CONTENT) ====================`);
              return { 
                contents: [{
                  type: "text", 
                  text: content, 
                  uri: mcpUri.toString() 
                }] 
              };
            }
            
            // If api_url is provided, fetch from external API
        if (resConfig.api_url) {
              console.log(`[MCP Resource: ${resConfig.name}] Using API URL: ${resConfig.api_url}`);
              try {
                let url = resConfig.api_url;
                
                // Replace URL parameters for dynamic resources
                if (Object.keys(params).length > 0) {
                  console.log(`[MCP Resource: ${resConfig.name}] Replacing URL parameters`);
                  for (const [key, value] of Object.entries(params)) {
                    const beforeReplace = url;
                    url = url.replace(new RegExp(`{${key}}`, 'g'), value);
                    console.log(`[MCP Resource: ${resConfig.name}] Replaced {${key}} with "${value}": "${beforeReplace}" -> "${url}"`);
                  }
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Final URL to fetch:`, url);
                console.log(`[MCP Resource: ${resConfig.name}] Request headers:`, resConfig.headers || {});
                
                const fetchOptions: RequestInit = {
                  method: 'GET',
                  headers: resConfig.headers || {},
                  signal: opts?.signal
                };
                
                console.log(`[MCP Resource: ${resConfig.name}] Making fetch request...`);
                const response = await fetch(url, fetchOptions);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response status: ${response.status} ${response.statusText}`);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response headers:`, Object.fromEntries(response.headers.entries()));
                
                const text = await response.text();
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response body length: ${text.length} characters`);
                console.log(`[MCP Resource: ${resConfig.name}] Fetch response body preview: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
                
                if (!response.ok) {
                  console.error(`[MCP Resource: ${resConfig.name}] Fetch failed with status ${response.status}`);
                  console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (FETCH ERROR) ====================`);
                  return {
                    contents: [],
                    error: { 
                      code: "FETCH_ERROR", 
                      message: `Failed to fetch resource: ${response.status} ${response.statusText}` 
                    }
                  };
                }
                
                console.log(`[MCP Resource: ${resConfig.name}] Successfully fetched data`);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (API SUCCESS) ====================`);
                return { 
                  contents: [{
                    type: "text", 
                    text: text, 
                    uri: mcpUri.toString() 
                  }] 
                };
              } catch (error: any) {
                console.error(`[MCP Resource: ${resConfig.name}] Fetch error:`, error);
                console.error(`[MCP Resource: ${resConfig.name}] Error stack:`, error.stack);
                console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (FETCH EXCEPTION) ====================`);
                return {
                  contents: [],
                  error: { 
                    code: "FETCH_ERROR", 
                    message: `Error fetching resource: ${error.message}` 
                  }
                };
              }
            }
            
            // If neither static_content nor api_url is provided, generate a default response
            if (Object.keys(params).length > 0) {
              const paramInfo = Object.entries(params)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
              
              console.log(`[MCP Resource: ${resConfig.name}] Returning default response with parameters: ${paramInfo}`);
              console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (DEFAULT WITH PARAMS) ====================`);
              return { 
                contents: [{
                  type: "text", 
                  text: `Resource ${resConfig.name} with parameters: ${paramInfo}`, 
                  uri: mcpUri.toString() 
                }] 
              };
            }
            
            console.log(`[MCP Resource: ${resConfig.name}] No static_content or api_url defined, returning error`);
            console.log(`[MCP Resource: ${resConfig.name}] ==================== RESOURCE CALL END (NOT IMPLEMENTED) ====================`);
            return { 
              contents: [], 
              error: { 
                code: "NOT_IMPLEMENTED", 
                message: "Resource has no static_content or api_url defined."
              }
            };
          }
        );
      }
      
      console.log(`[mcpDynamicHandler] Successfully registered resource: ${resConfig.name}`);
    }

    console.log(`[mcpDynamicHandler] ==================== RESOURCE REGISTRATION SUMMARY ====================`);
    console.log(`[mcpDynamicHandler] Total resources registered: ${(project.mcp_resources || []).length}`);
    (project.mcp_resources || []).forEach((res: any, index: number) => {
      const resourceType = res.resource_type || 'static';
      const pattern = res.uri || res.uri_pattern || res.template_pattern || `/${res.name.toLowerCase().replace(/\s+/g, '-')}`;
      const registrationType = (resourceType === 'dynamic' || resourceType === 'context_aware') && (res.uri || res.template_pattern) ? 'template' : 'static';
      console.log(`[mcpDynamicHandler] Resource ${index + 1}: "${res.name}" -> Pattern: "${pattern}" -> Type: ${resourceType} (registered as ${registrationType})`);
    });
    console.log(`[mcpDynamicHandler] ==================== END RESOURCE REGISTRATION SUMMARY ====================`);

  (project.mcp_tools || []).forEach((toolConfig: any) => { 
    console.log(`[mcpDynamicHandler] Registering tool: ${toolConfig.name}`, toolConfig);
      
      // Build input schema from parameters
      const inputSchema: Record<string, z.ZodTypeAny> = {};
    if (toolConfig.parameters) { 
        Object.entries(toolConfig.parameters).forEach(([key, paramConfig]) => {
          if (typeof paramConfig === 'object' && paramConfig !== null) {
            // Handle structured parameter definitions
            const config = paramConfig as any;
            let schema: z.ZodTypeAny;
            
            // Determine the Zod type based on the parameter type
            switch (config.type) {
              case 'number':
                schema = z.number();
                break;
              case 'boolean':
                schema = z.boolean();
                break;
              case 'array':
                schema = z.array(z.string());
                break;
              case 'object':
                schema = z.object({});
                break;
              default:
                schema = z.string();
            }
            
            // Add description if available
            if (config.description) {
              schema = schema.describe(config.description);
            }
            
            // Handle optional parameters
            if (config.required === false) {
              schema = schema.optional();
            }
            
            inputSchema[key] = schema;
          } else {
            // Legacy support: if parameter is just a string description
            inputSchema[key] = z.string().describe(String(paramConfig));
          }
        }); 
      }
      
      // Use the newer registerTool method
      mcpServer.registerTool(
      toolConfig.name, 
        {
          title: toolConfig.title || toolConfig.name,
          description: toolConfig.description || '',
          inputSchema: inputSchema
        },
      async (params: any): Promise<CallToolResult> => { 
        console.log(`[MCP Tool: ${toolConfig.name}] Called with params:`, params);
        console.log(`[MCP Tool: ${toolConfig.name}] Tool Config:`, toolConfig);
          
          // Handle simple tools with static_result
          if (toolConfig.static_result) {
            console.log(`[MCP Tool: ${toolConfig.name}] Using static result`);
            let result = toolConfig.static_result;
            
            // Replace template variables with actual parameter values
            if (typeof result === 'string' && params) {
              for (const [key, value] of Object.entries(params)) {
                result = result.replace(new RegExp(`{${key}}`, 'g'), String(value));
              }
            }
            
            return {
              content: [{ type: 'text', text: String(result) }]
            };
          }
          
          // Handle tools that return resource links
          if (toolConfig.resource_links) {
            console.log(`[MCP Tool: ${toolConfig.name}] Returning resource links`);
            const content: any[] = [];
            
            // Add optional header text
            if (toolConfig.resource_links_header) {
              let header = toolConfig.resource_links_header;
              // Replace template variables
              if (params) {
                for (const [key, value] of Object.entries(params)) {
                  header = header.replace(new RegExp(`{${key}}`, 'g'), String(value));
                }
              }
              content.push({ type: 'text', text: header });
            }
            
            // Add resource links
            for (const link of toolConfig.resource_links) {
              content.push({
                type: 'resource_link',
                uri: link.uri,
                name: link.name,
                mimeType: link.mimeType,
                description: link.description
              });
            }
            
            return { content };
          }
          
          // Handle async tools with external API calls
        if (toolConfig.api_url) {
            console.log(`[MCP Tool: ${toolConfig.name}] Making API call`);
          try {
              const method = (toolConfig.http_method || 'GET').toUpperCase();
            let url = toolConfig.api_url;
            let fetchOptions: RequestInit = { method };
              
              // Replace URL path parameters first (e.g., {city} in https://api.weather.com/{city})
              if (params) {
                for (const [key, value] of Object.entries(params)) {
                  url = url.replace(new RegExp(`{${key}}`, 'g'), String(value));
                }
              }
              
            // Set headers
              fetchOptions.headers = { ...(toolConfig.headers || {}) };
              
              // Handle request body for POST/PUT/PATCH
              if (['POST', 'PUT', 'PATCH'].includes(method) && params) {
                fetchOptions.headers = { ...fetchOptions.headers, 'Content-Type': 'application/json' };
              fetchOptions.body = JSON.stringify(params);
            }
              // Note: For GET/DELETE, we only use path parameters, not query string
              // This matches the MCP docs pattern where parameters are embedded in the URL path
              
              console.log(`[MCP Tool: ${toolConfig.name}] Fetching from: ${url}`);
            const response = await fetch(url, fetchOptions);
              const text = await response.text();
              
            if (!response.ok) {
                console.error(`[MCP Tool: ${toolConfig.name}] API call failed: ${response.status}`);
              return {
                content: [{ type: 'text', text: `Error: ${response.status} ${response.statusText}\n${text}` }],
                isError: true
              };
            }
              
              console.log(`[MCP Tool: ${toolConfig.name}] API call successful`);
            return { content: [{ type: 'text', text }] };
          } catch (error: any) {
              console.error(`[MCP Tool: ${toolConfig.name}] API call error:`, error);
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
              isError: true
            };
          }
        }
          
          // Default error if no handler is defined
          console.error(`[MCP Tool: ${toolConfig.name}] No handler defined`);
          return { 
            content: [{ type: 'text', text: `Tool ${toolConfig.name} has no implementation defined.` }],
            isError: true
          };
        }
      );
      
      console.log(`[mcpDynamicHandler] Successfully registered tool: ${toolConfig.name}`);
  });

  (project.mcp_prompts || []).forEach((promptConfig: any) => { 
    console.log(`[mcpDynamicHandler] Registering prompt: ${promptConfig.name}`, promptConfig);
      
      // Build args schema from arguments (preferred) or parameters (backward compatibility)
      const argsSchema: Record<string, z.ZodTypeAny> = {};
      const argumentsSource = promptConfig.arguments || promptConfig.parameters;
      
      // Create a mapping between positional argument names and named arguments
      const argNameMapping: Record<string, string> = {};
      let argIndex = 0;
      
    if (argumentsSource) { 
        Object.entries(argumentsSource).forEach(([key, paramConfig]) => {
          const positionalKey = argIndex.toString();
          argNameMapping[positionalKey] = key;
          argIndex++;
          
          if (typeof paramConfig === 'object' && paramConfig !== null) {
            // Handle structured parameter definitions
            const config = paramConfig as any;
            let schema: z.ZodTypeAny;
            
            // Determine the Zod type based on the parameter type
            switch (config.type) {
              case 'number':
                schema = z.number();
                break;
              case 'boolean':
                schema = z.boolean();
                break;
              case 'array':
                schema = z.array(z.string());
                break;
              case 'object':
                schema = z.object({});
                break;
              default:
                schema = z.string();
            }
            
            // Add description if available
            if (config.description) {
              schema = schema.describe(config.description);
            }
            
            // Handle optional parameters
            if (config.required === false) {
              schema = schema.optional();
            }
            
            // Handle context-aware completion from completion_config
            if (promptConfig.completion_config?.complete?.[key]) {
              const completionConfig = promptConfig.completion_config.complete[key];
              // Wrap schema with completable and provide completion function
              schema = completable(schema, (value: string, context: any) => {
                console.log(`[mcpDynamicHandler] Completable function called for prompt "${promptConfig.name}", parameter "${key}" (positional: "${positionalKey}"), value "${value}"`);
                console.log(`[mcpDynamicHandler] Context received:`, context);
                
                let completions: string[] = [];
                
                if (completionConfig.type === 'static' && Array.isArray(completionConfig.values)) {
                  // Static list of completions
                  completions = completionConfig.values.filter((item: string) => 
                    item.toLowerCase().startsWith(value.toLowerCase())
                  );
                } else if (completionConfig.type === 'conditional' && completionConfig.conditions) {
                  // Conditional completions based on other parameters
                  // Convert positional context arguments back to named arguments for condition checking
                  const namedContext: Record<string, string> = {};
                  if (context?.arguments) {
                    for (const [posKey, val] of Object.entries(context.arguments)) {
                      const namedKey = argNameMapping[posKey];
                      if (namedKey) {
                        namedContext[namedKey] = val as string;
                      }
                    }
                  }
                  
                  for (const condition of completionConfig.conditions) {
                    if (condition.when && condition.values) {
                      // Check if all conditions match using named arguments
                      let allMatch = true;
                      for (const [condKey, expectedValue] of Object.entries(condition.when)) {
                        if (namedContext[condKey] !== expectedValue) {
                          allMatch = false;
                          break;
                        }
                      }
                      
                      if (allMatch) {
                        completions = condition.values.filter((item: string) => 
                          item.toLowerCase().startsWith(value.toLowerCase())
                        );
                        break;
                      }
                    }
                  }
                  
                  // Use default values if no conditions match
                  if (completions.length === 0 && completionConfig.default && Array.isArray(completionConfig.default)) {
                    completions = completionConfig.default.filter((item: string) => 
                      item.toLowerCase().startsWith(value.toLowerCase())
                    );
                  }
                }
                
                console.log(`[mcpDynamicHandler] Completable function returning:`, completions);
                return completions;
              });
            } else if (config.completion) {
              // Legacy support for completion logic in parameter config
              schema = completable(schema, (value: string, context: any) => {
                // Use the safe evaluation function for completion logic
                return evaluateCompletionLogic(config.completion, value, context);
              });
            }
            
            // Use positional key for the schema
            argsSchema[positionalKey] = schema;
          } else {
            // Legacy support: if parameter is just a string description
            argsSchema[positionalKey] = z.string().describe(String(paramConfig));
          }
        }); 
      }
      
      // Use the newer registerPrompt method
      mcpServer.registerPrompt(
      promptConfig.name, 
        {
          title: promptConfig.title || promptConfig.name,
          description: promptConfig.description || '',
          argsSchema: argsSchema
        },
      async (args: any): Promise<GetPromptResult> => { 
        console.log(`[MCP Prompt: ${promptConfig.name}] Called with positional args:`, args);
        console.log(`[MCP Prompt: ${promptConfig.name}] Prompt Config:`, promptConfig);
          
          // Convert positional arguments back to named arguments
          const namedArgs: Record<string, any> = {};
          if (args) {
            for (const [posKey, value] of Object.entries(args)) {
              const namedKey = argNameMapping[posKey];
              if (namedKey) {
                namedArgs[namedKey] = value;
              }
            }
          }
          
          console.log(`[MCP Prompt: ${promptConfig.name}] Converted to named args:`, namedArgs);
          
          // Determine the role and content based on prompt configuration
          let role: "user" | "assistant" = promptConfig.role || "user";
          let content: string = promptConfig.template || '';
          
          // Replace template variables with actual argument values using named arguments
          if (content && namedArgs) {
            for (const [key, value] of Object.entries(namedArgs)) {
              content = content.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
            }
          }
          
          return { 
            messages: [{ 
              role: role, 
              content: { 
                type: "text", 
                text: content 
              } 
            }] 
          };
        }
      );
      
      console.log(`[mcpDynamicHandler] Successfully registered prompt: ${promptConfig.name}`);
  });
  
  console.log("[mcpDynamicHandler] Capabilities registration phase complete.");

    // Add completion handler for URI completions BEFORE connecting to transport
    console.log("[mcpDynamicHandler] Setting up completion handler...");
    
    // Access the underlying server's completion handler
    const server = (mcpServer as any).server;
    let originalHandler: any = null;
    
    // Try to get the original completion handler if it exists
    try {
      originalHandler = server.getRequestHandler?.(CompleteRequestSchema) || 
                       server._requestHandlers?.get?.(CompleteRequestSchema) ||
                       server.requestHandlers?.get?.(CompleteRequestSchema);
      console.log("[mcpDynamicHandler] Original completion handler found:", !!originalHandler);
    } catch (e) {
      console.log("[mcpDynamicHandler] Could not access original completion handler:", e);
    }
    
    server.setRequestHandler(CompleteRequestSchema, async (request: any) => {
      console.log("[mcpDynamicHandler] Completion request received:", JSON.stringify(request, null, 2));
      
      const { ref, argument, context } = request.params;
      
      // Handle resource URI completions
      if (ref?.type === "ref/resource" && argument?.name === "uri") {
        const partialUri = argument.value || "";
        console.log(`[mcpDynamicHandler] Handling URI completion for: "${partialUri}"`);
        
        const completions: string[] = [];
        
        // Get all registered resources with their URI patterns
        for (const resConfig of (project.mcp_resources || [])) {
          const resourceType = resConfig.resource_type || 'static';
          const uriPattern = resConfig.uri || resConfig.uri_pattern || resConfig.template_pattern || `/${resConfig.name.toLowerCase().replace(/\s+/g, '-')}`;
          
          console.log(`[mcpDynamicHandler] Checking resource "${resConfig.name}" with pattern "${uriPattern}"`);
          
          if (resourceType === 'static') {
            // For static resources, just check if the URI starts with the partial
            if (uriPattern.toLowerCase().startsWith(partialUri.toLowerCase())) {
              completions.push(uriPattern);
            }
                    } else if (resourceType === 'dynamic' || resourceType === 'context_aware') {
            // For dynamic resources, provide example completions based on the pattern
            // Check if the pattern could match this partial URI
            if (uriPattern === 'github://repos/{owner}/{repo}') {
              // Handle GitHub repository pattern specifically
              if (partialUri === 'github:' || partialUri === 'github://' || partialUri === 'github://r' || partialUri === 'github://re' || partialUri === 'github://rep' || partialUri === 'github://repo' || partialUri === 'github://repos') {
                completions.push('github://repos/');
              } else if (partialUri.startsWith('github://repos/')) {
                // Extract what comes after github://repos/
                const afterRepos = partialUri.substring('github://repos/'.length);
                if (!afterRepos.includes('/')) {
                  // User is typing owner name
                  const exampleOwners = ['org1', 'microsoft', 'facebook', 'google', 'modelcontextprotocol'];
                  for (const owner of exampleOwners) {
                    if (owner.startsWith(afterRepos)) {
                      completions.push(`github://repos/${owner}/`);
                    }
                  }
                } else {
                  // User has typed owner and is typing repo
                  const parts = afterRepos.split('/');
                  const owner = parts[0];
                  const partialRepo = parts[1] || '';
                  
                  // Use the completion config if available
                  if (resConfig.completion_config?.complete?.repo) {
                    const repoConfig = resConfig.completion_config.complete.repo as any;
                    let repos: string[] = [];
                    
                    if (repoConfig.type === 'conditional' && repoConfig.conditions) {
                      // Find matching condition
                      for (const condition of repoConfig.conditions) {
                        if (condition.when?.owner === owner) {
                          repos = condition.values || [];
                          break;
                        }
                      }
                      // Use default if no match
                      if (repos.length === 0 && repoConfig.default) {
                        repos = repoConfig.default;
                      }
                    }
                    
                    // Filter repos by partial match
                    for (const repo of repos) {
                      if (repo.toLowerCase().startsWith(partialRepo.toLowerCase())) {
                        completions.push(`github://repos/${owner}/${repo}`);
                      }
                    }
                  }
                }
              }
            } else {
              // For other patterns, check if they could match
              const staticPart = uriPattern.split('{')[0]; // Get the part before first parameter
              if (partialUri.toLowerCase().startsWith(staticPart.toLowerCase()) || staticPart.toLowerCase().startsWith(partialUri.toLowerCase())) {
                const exampleUri = uriPattern.replace(/{[^}]+}/g, 'example');
                completions.push(exampleUri);
              }
            }
          }
        }
        
        console.log(`[mcpDynamicHandler] Returning ${completions.length} URI completions:`, completions);
        
        return {
          completion: {
            values: completions.slice(0, 100), // Limit to 100 results
            total: completions.length,
            hasMore: completions.length > 100
          }
        };
      }
      
      // Handle prompt parameter completions
      if (ref?.type === "ref/prompt" && ref?.name && argument?.name) {
        const promptName = ref.name;
        const paramName = argument.name;
        const partialValue = argument.value || "";
        
        console.log(`[mcpDynamicHandler] Handling prompt completion for prompt "${promptName}", parameter "${paramName}", value "${partialValue}"`);
        
        // Find the prompt configuration
        const promptConfig = (project.mcp_prompts || []).find((p: any) => p.name === promptName);
        if (!promptConfig) {
          console.log(`[mcpDynamicHandler] Prompt "${promptName}" not found`);
          return {
            completion: {
              values: [],
              total: 0,
              hasMore: false
            }
          };
        }
        
        console.log(`[mcpDynamicHandler] Found prompt config:`, promptConfig);
        
        // Map positional argument name to named argument
        const argumentsSource = promptConfig.arguments || promptConfig.parameters;
        let namedParamName = paramName;
        
        if (argumentsSource) {
          const argNames = Object.keys(argumentsSource);
          const argIndex = parseInt(paramName);
          if (!isNaN(argIndex) && argIndex >= 0 && argIndex < argNames.length) {
            namedParamName = argNames[argIndex];
            console.log(`[mcpDynamicHandler] Mapped positional argument "${paramName}" to named argument "${namedParamName}"`);
          }
        }
        
        // Check if the prompt has completion configuration
        if (promptConfig.completion_config?.complete?.[namedParamName]) {
          const completionConfig = promptConfig.completion_config.complete[namedParamName];
          console.log(`[mcpDynamicHandler] Found completion config for parameter "${namedParamName}" (positional: "${paramName}"):`, completionConfig);
          
          let completions: string[] = [];
          
          if (completionConfig.type === 'static' && Array.isArray(completionConfig.values)) {
            // Static list of completions
            completions = completionConfig.values.filter((item: string) => 
              item.toLowerCase().startsWith(partialValue.toLowerCase())
            );
                              console.log(`[mcpDynamicHandler] Static completions for "${namedParamName}" (positional: "${paramName}"):`, completions);
          } else if (completionConfig.type === 'conditional' && completionConfig.conditions) {
            // Conditional completions based on other parameters
            console.log(`[mcpDynamicHandler] Processing conditional completions, context:`, context);
            
            // Convert positional context arguments back to named arguments for condition checking
            const namedContext: Record<string, string> = {};
            if (context?.arguments && argumentsSource) {
              const argNames = Object.keys(argumentsSource);
              for (const [posKey, val] of Object.entries(context.arguments)) {
                const posIndex = parseInt(posKey);
                if (!isNaN(posIndex) && posIndex >= 0 && posIndex < argNames.length) {
                  const namedKey = argNames[posIndex];
                  namedContext[namedKey] = val as string;
                }
              }
            }
            console.log(`[mcpDynamicHandler] Converted context to named arguments:`, namedContext);
            
            // Check each condition
            for (const condition of completionConfig.conditions) {
              if (condition.when && condition.values) {
                // Check if all conditions match using named arguments
                let allMatch = true;
                for (const [key, expectedValue] of Object.entries(condition.when)) {
                  if (namedContext[key] !== expectedValue) {
                    allMatch = false;
                    break;
                  }
                }
                
                if (allMatch) {
                  completions = condition.values.filter((item: string) => 
                    item.toLowerCase().startsWith(partialValue.toLowerCase())
                  );
                                      console.log(`[mcpDynamicHandler] Condition matched for "${namedParamName}" (positional: "${paramName}"):`, completions);
                  break;
                }
              }
            }
            
            // Use default values if no conditions match
            if (completions.length === 0 && completionConfig.default && Array.isArray(completionConfig.default)) {
              completions = completionConfig.default.filter((item: string) => 
                item.toLowerCase().startsWith(partialValue.toLowerCase())
              );
                              console.log(`[mcpDynamicHandler] Using default completions for "${namedParamName}" (positional: "${paramName}"):`, completions);
            }
          }
          
          console.log(`[mcpDynamicHandler] Returning ${completions.length} prompt completions:`, completions);
          
          return {
            completion: {
              values: completions.slice(0, 100), // Limit to 100 results
              total: completions.length,
              hasMore: completions.length > 100
            }
          };
        }
        
        console.log(`[mcpDynamicHandler] No completion config found for prompt "${promptName}", parameter "${namedParamName}" (positional: "${paramName}")`);
        return {
          completion: {
            values: [],
            total: 0,
            hasMore: false
          }
        };
      }
      
      // For other types of completions, delegate to the SDK or return empty
      console.log("[mcpDynamicHandler] Unhandled completion request - delegating to SDK");
      console.log(`[mcpDynamicHandler] Request details - ref.type: ${ref?.type}, ref.name: ${ref?.name}, ref.uri: ${ref?.uri}, argument.name: ${argument?.name}, argument.value: "${argument?.value}"`);
      
      // The SDK should automatically handle parameter completions for registered prompts with completable() schemas
      // If we reach here, it means either the SDK didn't handle it or there's no completion configured
      return {
        completion: {
          values: [],
          total: 0,
          hasMore: false
        }
      };
    });
    
    console.log("[mcpDynamicHandler] Completion handler setup complete.");
    
    // Store the newly created server in cache
    const now = Date.now();
    serverCache.set(cacheKey, { mcpServer, lastUpdated: now });
    console.log(`[mcpDynamicHandler] ✅ CACHED - Stored new MCP server in cache for project ${projectId}`);
    console.log(`[mcpDynamicHandler] Cache size after storing: ${serverCache.size}`);
    console.log(`[mcpDynamicHandler] Cache entry timestamp: ${now}`);
    console.log(`[mcpDynamicHandler] ==================== END CACHE OPERATIONS ====================`);
  }
  
  // Log cache status for both hit and miss cases
  if (cached && (Date.now() - cached.lastUpdated) < CACHE_TIMEOUT) {
    console.log(`[mcpDynamicHandler] ==================== END CACHE OPERATIONS (CACHE HIT) ====================`);
  }

  // Session management branch: stateful handling if enabled
  if ((project as any).session_management) {
      const sessionIdHeader = c.req.header("mcp-session-id");
      console.log("line 264: Session management enabled; mcp-session-id header:", sessionIdHeader);
      const { req, res } = toReqRes(c.req.raw);

      // Streaming via GET/DELETE: reuse transport without awaiting
      if (c.req.method === 'GET' || c.req.method === 'DELETE') {
        if (!sessionIdHeader || !sessionTransports[sessionIdHeader]) {
          console.error(`[mcpDynamicHandler] Invalid or missing session ID for ${c.req.method}; header: ${sessionIdHeader}`);
          return c.json(
            { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null },
            400
          );
        }
        const transport = sessionTransports[sessionIdHeader];
        console.log(`[mcpDynamicHandler] Reusing session transport for ${c.req.method} with ID: ${sessionIdHeader}`);
        transport.handleRequest(req, res).catch(err => {
          console.error("[mcpDynamicHandler] transport.handleRequest error:", err);
        });
        return toFetchResponse(res);
      }

      // JSON-RPC via POST/others: parse JSON payload
      let mcpPayload: any = null;
      if (c.req.header('content-type')?.includes('application/json')) {
        try {
          mcpPayload = await c.req.json();
          console.log("[mcpDynamicHandler] Session payload:", JSON.stringify(mcpPayload));
          if (mcpPayload) {
              console.log("[mcpDynamicHandler] ==================== MCP REQUEST PAYLOAD (SESSION) ====================");
              console.log("[mcpDynamicHandler] MCP Payload to be handled (from c.req.json()):", JSON.stringify(mcpPayload, null, 2));
              
              // Log the specific MCP method being called
              if (mcpPayload.method) {
                console.log(`[mcpDynamicHandler] 🔄 SESSION MCP METHOD: ${mcpPayload.method}`);
                console.log(`[mcpDynamicHandler] 🔄 SESSION MCP ID: ${mcpPayload.id || 'No ID'}`);
                if (mcpPayload.params) {
                  console.log(`[mcpDynamicHandler] 🔄 SESSION MCP PARAMS:`, JSON.stringify(mcpPayload.params, null, 2));
                }
              }
              
              console.log("[mcpDynamicHandler] ==================== END MCP REQUEST PAYLOAD (SESSION) ====================");
          }
        } catch (e) {
          console.error("[mcpDynamicHandler] Error parsing JSON payload for session:", e);
          return c.json(
            { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
            400
          );
        }
      }

      let transport: StreamableHTTPServerTransport;
      if (sessionIdHeader && sessionTransports[sessionIdHeader]) {
        transport = sessionTransports[sessionIdHeader];
        console.log(`[mcpDynamicHandler] Reusing existing session transport with ID: ${sessionIdHeader}`);
      } else if (!sessionIdHeader && isInitializeRequest(mcpPayload)) {
        console.log("[mcpDynamicHandler] Initializing new session");
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (sessionId) => {
            console.log(`[mcpDynamicHandler] New session initialized with ID: ${sessionId}`);
            sessionTransports[sessionId] = transport;
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            console.log(`[mcpDynamicHandler] Session closed, cleaning up transport with ID: ${transport.sessionId}`);
            delete sessionTransports[transport.sessionId];
          }
        };
        await mcpServer.connect(transport);
      } else {
        console.error(`[mcpDynamicHandler] Bad request for session management: missing or invalid session ID; header: ${sessionIdHeader}`);
        return c.json(
          { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null },
          400
        );
      }

      try {
        console.log("[mcpDynamicHandler] Handling session request");
        await transport.handleRequest(req, res, mcpPayload);
        return toFetchResponse(res);
      } catch (transportError) {
        console.error("[mcpDynamicHandler] Error during session transport handleRequest:", transportError);
        return c.json(
          { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error during MCP transport." }, id: null },
          500
        );
      }
    }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  
  try {
    console.log("[mcpDynamicHandler] Connecting McpServer to transport...");
    await mcpServer.connect(transport);
    console.log("[mcpDynamicHandler] McpServer connected to transport.");

    transport.onerror = console.error.bind(console);
    mcpServer.server.onerror = console.error.bind(console);

    const mcpBasePath = `/mcp/${mcpIdentifier}`;
    if (c.req.method === 'GET' && (path === mcpBasePath || path === `${mcpBasePath}/`) && (c.req.header("accept") || "").includes("text/html")) {
      console.log(`[mcpDynamicHandler] Serving HTML info page for project "${project.name}"`);
       // const requestUrl = new URL(c.req.url);
        const baseUrl = process.env.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'; 
        //|| 'http://localhost:3001';
        //`${requestUrl.protocol}//${requestUrl.host}`;
      // Ensure generateInfoPage uses project.mcp_resources etc directly
      const htmlContent = generateInfoPage(mcpIdentifier, project, project.mcp_resources || [], project.mcp_tools || [], project.mcp_prompts || [], baseUrl);
      mcpServer.close();
      transport.close();
      return c.html(htmlContent);
    }

    if (c.req.method === 'GET') {
      console.log(`[mcpDynamicHandler] Received GET request for MCP endpoint (not HTML). Returning 405 Method Not Allowed.`);
      mcpServer.close(); 
      transport.close();
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. MCP expects POST for RPC calls." }, id: null }, 
        405
      );
    }
    
    const { req, res } = toReqRes(c.req.raw);
    let mcpPayload: any;
    if (c.req.header('content-type')?.includes('application/json')) {
        try {
            mcpPayload = await c.req.json();
            if (mcpPayload) {
                  console.log("[mcpDynamicHandler] ==================== MCP REQUEST PAYLOAD ====================");
                console.log("[mcpDynamicHandler] MCP Payload to be handled (from c.req.json()):", JSON.stringify(mcpPayload, null, 2));
                
                // Log the specific MCP method being called
                if (mcpPayload.method) {
                  console.log(`[mcpDynamicHandler] 🔄 MCP METHOD: ${mcpPayload.method}`);
                  console.log(`[mcpDynamicHandler] 🔄 MCP ID: ${mcpPayload.id || 'No ID'}`);
                  if (mcpPayload.params) {
                    console.log(`[mcpDynamicHandler] 🔄 MCP PARAMS:`, JSON.stringify(mcpPayload.params, null, 2));
                  }
                }
                
                  console.log("[mcpDynamicHandler] ==================== END MCP REQUEST PAYLOAD ====================");
            }
        } catch (e) {
              console.error("[mcpDynamicHandler] Error parsing JSON payload for session:", e);
            mcpServer.close();
            transport.close();
            return c.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
        }
    } else if (c.req.method !== "GET") {
         console.log("[mcpDynamicHandler] MCP request with non-JSON content type or GET method, passing null payload.");
         mcpPayload = null;
    } else {
        mcpPayload = undefined; 
    }

    if (c.req.method === 'POST' && !mcpPayload && c.req.header('content-length') && c.req.header('content-length') !== '0') {
        console.warn("[mcpDynamicHandler] POST request with Content-Length but mcpPayload is not set. Body parsing might have failed silently or was not JSON.");
    }

    try {
      console.log(`[mcpDynamicHandler] Forwarding to transport.handleRequest. Method: ${req.method}, Payload defined: ${mcpPayload !== undefined}`);
      await transport.handleRequest(req, res, mcpPayload);
      console.log("[mcpDynamicHandler] transport.handleRequest completed. Converting to FetchResponse.");
      return toFetchResponse(res);
    } catch (transportError: any) {
      console.error("[mcpDynamicHandler] CRITICAL ERROR during transport.handleRequest:", transportError.message, transportError.stack, transportError);
      mcpServer.close();
      transport.close();
      const requestId = (typeof mcpPayload === 'object' && mcpPayload !== null && 'id' in mcpPayload) ? mcpPayload.id : null;
      return c.json(
          { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error during MCP transport." }, id: requestId },
          500
      );
    }

  } catch (e: any) {
    console.error("[mcpDynamicHandler] Outer error during MCP processing or response generation:", e);
    // Ensure server/transport are closed if an error occurs before or outside transport.handleRequest
    if (mcpServer) mcpServer.close();
    if (transport) transport.close();
    return c.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 }
    );
  }
}; 