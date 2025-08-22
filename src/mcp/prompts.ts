import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

// Safe evaluation of completion logic without using eval() or new Function()
export function evaluateCompletionLogic(logic: string, value: string, context: any): string[] {
  try {
    // Very small safe subset (arrays, optional .filter startsWith, simple if ===)
    const conditionalMatch = logic.match(
      /if\s*\(\s*context\?\.\s*arguments\?\.\s*\[\s*["']([^"']+)["']\s*\]\s*===\s*["']([^"']+)["']\s*\)\s*{\s*return\s*\[(.*?)\](?:\.filter\([^)]+\))?\s*;\s*}/
    );
    if (conditionalMatch) {
      const [, paramName, paramValue, itemsStr] = conditionalMatch;
      const contextValue = context?.arguments?.[paramName];
      if (contextValue === paramValue) {
        const items = itemsStr.split(",").map((s) => s.trim().replace(/["']/g, ""));
        return items.filter((i) => i.toLowerCase().startsWith(value.toLowerCase()));
      }
    }
    const returnArrayMatch = logic.match(/return\s*\[(.*?)\]/);
    if (returnArrayMatch) {
      const items = returnArrayMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
      return logic.includes(".filter(")
        ? items.filter((i) => i.toLowerCase().startsWith(value.toLowerCase()))
        : items;
    }
  } catch (e) {
    console.log("[evaluateCompletionLogic] error:", e);
  }
  return [];
}

export async function registerPrompts(mcpServer: McpServer, project: any): Promise<void> {
  // ---------- Prompts (simple) ----------
  (project.mcp_prompts || []).forEach((prompt: any) => {
    try {
      if (!prompt.name) {
        console.error(`[MCP] Prompt config missing name:`, prompt);
        return;
      }
      
      const argsSchema: Record<string, z.ZodTypeAny> = {};
      const mapping: Record<string, string> = {};
      let idx = 0;

    const src = prompt.arguments || prompt.parameters;
    if (src) {
      Object.entries(src).forEach(([key, cfg]: any) => {
        const pos = String(idx++);
        mapping[pos] = key;
        
        // MCP SDK PromptArgsRawShape requires string types, but Completable<ZodString> extends ZodType so it's allowed
        let schema: z.ZodTypeAny;
        let description = cfg?.description || '';
        
        // All prompt parameters must be strings (MCP SDK constraint)
        switch (cfg?.type) {
          case "number":
            console.warn(`[MCP] Prompt ${prompt.name}: Converting number parameter '${key}' to string (MCP SDK constraint)`);
            description += description ? ' (enter as number)' : 'Enter as number';
            break;
          case "boolean":
            console.warn(`[MCP] Prompt ${prompt.name}: Converting boolean parameter '${key}' to string (MCP SDK constraint)`);
            description += description ? ' (enter \'true\' or \'false\')' : 'Enter \'true\' or \'false\'';
            break;
          case "array":
            console.warn(`[MCP] Prompt ${prompt.name}: Converting array parameter '${key}' to string (MCP SDK constraint)`);
            description += description ? ' (enter as comma-separated values)' : 'Enter as comma-separated values';
            break;
          case "object":
            console.warn(`[MCP] Prompt ${prompt.name}: Converting object parameter '${key}' to string (MCP SDK constraint)`);
            description += description ? ' (enter as JSON string)' : 'Enter as JSON string';
            break;
        }
        
        schema = z.string().describe(description);
        if (cfg?.required === false) {
          schema = schema.optional();
        }

        // ✅ RESTORED: Completion support for prompt arguments (this is a key MCP feature!)
        if (prompt.completion_config?.complete?.[key]) {
          const cc = prompt.completion_config.complete[key];
          schema = completable(schema, (value: string, context: any) => {
            if (cc.type === "static" && Array.isArray(cc.values)) {
              return cc.values.filter((v: string) => v.toLowerCase().startsWith(value.toLowerCase()));
            }
            if (cc.type === "function" && cc.logic) {
              return evaluateCompletionLogic(cc.logic, value, context);
            }
            return [];
          });
        }
        
        argsSchema[pos] = schema;
      });
    }

    mcpServer.registerPrompt(
      prompt.name,
      {
        title: prompt.title || prompt.name,
        description: prompt.description || "",
        argsSchema,
      },
      async (args: any): Promise<GetPromptResult> => {
        const named: Record<string, any> = {};
        for (const [pos, val] of Object.entries(args || {})) {
          const nk = mapping[pos];
          if (nk) named[nk] = val;
        }
        let content = prompt.template || "";
        for (const [k, v] of Object.entries(named)) {
          content = content.replace(new RegExp(`{{${k}}}`, "g"), String(v));
        }
        const role: "user" | "assistant" = prompt.role || "user";
        return { messages: [{ role, content: { type: "text", text: content } }] };
      }
    );

    console.log(`[MCP] Prompt registered: ${prompt.name}`);
    } catch (err: any) {
      console.error(`[MCP] Error registering prompt ${prompt?.name || 'unknown'}:`, {
        message: err?.message || 'Unknown error',
        stack: err?.stack,
        name: err?.name,
        promptConfig: prompt,
        fullError: err
      });
      // Continue with next prompt instead of failing completely
    }
  });
}
