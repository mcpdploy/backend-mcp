import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Safe mathematical expression evaluator without dynamic code generation
function safeMathEval(expression: string): number {
  // Clean the expression
  const expr = expression.trim();
  
  // For security, only allow numbers, basic operators, and parentheses
  if (!/^[0-9+\-*/.() ]+$/.test(expr)) {
    throw new Error(`Invalid characters in expression: ${expr}`);
  }
  
  // Simple evaluation using a more direct approach
  // Replace division and multiplication first (higher precedence)
  let result = expr;
  
  // Handle parentheses by evaluating them first
  while (result.includes('(')) {
    const match = result.match(/\(([^()]+)\)/);
    if (!match) break;
    
    const innerExpr = match[1];
    const innerResult = evaluateSimple(innerExpr);
    result = result.replace(match[0], String(innerResult));
  }
  
  return evaluateSimple(result);
}

function evaluateSimple(expr: string): number {
  // Remove spaces
  expr = expr.replace(/\s+/g, '');
  
  // Split by + and - (lower precedence), but be careful with negative numbers
  const addSubTokens: { value: string; op: string }[] = [];
  let current = '';
  let lastOp = '+';
  
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if ((char === '+' || char === '-') && current.length > 0) {
      addSubTokens.push({ value: current, op: lastOp });
      current = '';
      lastOp = char;
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    addSubTokens.push({ value: current, op: lastOp });
  }
  
  let result = 0;
  for (const token of addSubTokens) {
    const termResult = evaluateTerm(token.value);
    if (token.op === '+') {
      result += termResult;
    } else {
      result -= termResult;
    }
  }
  
  return result;
}

function evaluateTerm(expr: string): number {
  // Handle multiplication and division
  const mulDivTokens = expr.split(/([*/])/);
  let result = parseFloat(mulDivTokens[0]);
  
  for (let i = 1; i < mulDivTokens.length; i += 2) {
    const op = mulDivTokens[i];
    const operand = parseFloat(mulDivTokens[i + 1]);
    
    if (op === '*') {
      result *= operand;
    } else if (op === '/') {
      result /= operand;
    }
  }
  
  return result;
}

// TODO: refactor
export async function registerTools(mcpServer: McpServer, project: any): Promise<void> {
  
  // ---------- Tools (EXACT style you requested) ----------
  (project.mcp_tools || []).forEach((toolConfig: any) => {
    try {
      if (!toolConfig.name) {
        console.error(`[MCP] Tool config missing name:`, toolConfig);
        return;
      }
      
      console.log(`[MCP] Registering tool: ${toolConfig.name}`, {
        http_method: toolConfig.http_method || null,
        api_url: toolConfig.api_url || null,
      });


    const inputSchema: Record<string, z.ZodTypeAny> = {};
    if (toolConfig.parameters) {
      Object.entries(toolConfig.parameters).forEach(([key, paramConfig]) => {
        if (typeof paramConfig === "object" && paramConfig !== null) {
          const cfg = paramConfig as any;
          let schema: z.ZodTypeAny;
          switch (cfg.type) {
            case "number":
              schema = z.number();
              break;
            case "boolean":
              schema = z.boolean();
              break;
            case "array":
              schema = z.array(z.string());
              break;
            case "object":
              schema = z.object({});
              break;
            default:
              schema = z.string();
          }
          if (cfg.description) schema = schema.describe(cfg.description);
          if (cfg.required === false) schema = schema.optional();
          inputSchema[key] = schema;
        } else {
          inputSchema[key] = z.string().describe(String(paramConfig));
        }
      });
    }

    mcpServer.registerTool(
      toolConfig.name,
      {
        title: toolConfig.title || toolConfig.name,
        description: toolConfig.description || "",
        inputSchema,
      },
      async (params: any): Promise<CallToolResult> => {
        console.log(`[MCP] [TOOL ${toolConfig.name}] called with params:`, params);
        console.log(`[MCP] [TOOL ${toolConfig.name}] config:`, {
          has_static_result: !!toolConfig.static_result,
          has_resource_links: !!toolConfig.resource_links,
          api_url: toolConfig.api_url || null,
          http_method: toolConfig.http_method || null,
        });

        // 1) STATIC
        if (toolConfig.static_result) {
          let result = toolConfig.static_result;
          if (typeof result === "string" && params) {
            // Check if this is a JavaScript expression (contains operators like +, -, *, /, etc.)
            const hasJSOperators = /[\+\-\*\/\(\)\s]/.test(result) && /\{.+\}/.test(result);
            
            if (hasJSOperators) {
              // For expressions like "{weightKg} / ({heightM} * {heightM})", evaluate as JavaScript
              let template = result;
              for (const [key, value] of Object.entries(params)) {
                template = template.replace(new RegExp(`{${key}}`, "g"), String(value));
              }
              try {
                console.log(`[MCP] [TOOL ${toolConfig.name}] Processing template: "${template}"`);
                
                // Look for mathematical expressions to evaluate
                // Pattern: look for sequences like "5 / (3 * 3)" that are clearly mathematical
                const mathExpressions = template.match(/(\b\d+(?:\.\d+)?\s*[\+\-\*\/]\s*\([^)]+\)|\b\d+(?:\.\d+)?\s*[\+\-\*\/]\s*\d+(?:\.\d+)?)/g);
                
                if (mathExpressions && mathExpressions.length === 1) {
                  // If there's exactly one mathematical expression, return just the calculated value
                  const expression = mathExpressions[0].trim();
                  console.log(`[MCP] [TOOL ${toolConfig.name}] Found single math expression: "${expression}"`);
                  const evalResult = safeMathEval(expression);
                  console.log(`[MCP] [TOOL ${toolConfig.name}] Returning just the number: ${evalResult}`);
                  result = String(evalResult);
                } else if (mathExpressions && mathExpressions.length > 1) {
                  // Multiple expressions - replace each within the text
                  result = template.replace(/(\b\d+(?:\.\d+)?\s*[\+\-\*\/]\s*\([^)]+\)|\b\d+(?:\.\d+)?\s*[\+\-\*\/]\s*\d+(?:\.\d+)?)/g, (match) => {
                    try {
                      const cleanMatch = match.trim();
                      console.log(`[MCP] [TOOL ${toolConfig.name}] Found math expression in text: "${cleanMatch}"`);
                      const evalResult = safeMathEval(cleanMatch);
                      console.log(`[MCP] [TOOL ${toolConfig.name}] Evaluated "${cleanMatch}" = ${evalResult}`);
                      return String(evalResult);
                    } catch (err) {
                      console.error(`[MCP] [TOOL ${toolConfig.name}] Math eval failed for "${match}":`, err);
                      return match; // Return original if evaluation fails
                    }
                  });
                  console.log(`[MCP] [TOOL ${toolConfig.name}] Text with multiple expressions: "${result}"`);
                } else {
                  // No mathematical expressions found, return template as-is
                  result = template;
                  console.log(`[MCP] [TOOL ${toolConfig.name}] No math expressions found, returning template: "${result}"`);
                }
              } catch (err) {
                console.error(`[MCP] [TOOL ${toolConfig.name}] Template processing failed:`, err);
                result = `Error processing template: ${template}`;
              }
            } else {
              // Regular string substitution for simple templates
              for (const [key, value] of Object.entries(params)) {
                result = result.replace(new RegExp(`{${key}}`, "g"), String(value));
              }
            }
          }
          console.log(`[MCP] [TOOL ${toolConfig.name}] static_result -> length ${String(result).length}`);
          return { content: [{ type: "text", text: String(result) }] };
        }

        // 2) RESOURCE LINKS
        if (toolConfig.resource_links) {
          const content: any[] = [];
          if (toolConfig.resource_links_header) {
            let header = toolConfig.resource_links_header;
            if (params) {
              for (const [key, value] of Object.entries(params)) {
                header = header.replace(new RegExp(`{${key}}`, "g"), String(value));
              }
            }
            content.push({ type: "text", text: header });
          }
          for (const link of toolConfig.resource_links) {
            content.push({
              type: "resource_link",
              uri: link.uri,
              name: link.name,
              mimeType: link.mimeType,
              description: link.description,
            });
          }
          console.log(
            `[MCP] [TOOL ${toolConfig.name}] resource_links -> count ${toolConfig.resource_links.length}`
          );
          return { content };
        }

        // 3) API
        if (toolConfig.api_url) {
          try {
            let url = toolConfig.api_url as string;
            
            // Substitute parameters in URL like the hardcoded example
            if (params) {
              for (const [key, value] of Object.entries(params)) {
                url = url.replace(new RegExp(`{${key}}`, "g"), String(value));
              }
            }

            console.log(`[MCP] [TOOL ${toolConfig.name}] API fetch -> ${url}`);
            
            // Simple fetch like the hardcoded example - async ({ city }) => { const response = await fetch(`https://api.weather.com/${city}`); const data = await response.text(); }
            const response = await fetch(url);
            const data = await response.text();
            
            console.log(`[MCP] [TOOL ${toolConfig.name}] API success len=${data.length}`);
            return {
              content: [{ type: "text", text: data }]
            };
          } catch (err: any) {
            console.error(`[MCP] [TOOL ${toolConfig.name}] API error:`, err);
            return {
              content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true,
            };
          }
        }

        console.error(`[MCP] [TOOL ${toolConfig.name}] No handler defined`);
        return {
          content: [{ type: "text", text: `Tool ${toolConfig.name} has no implementation defined.` }],
          isError: true,
        };
      }
    );

    console.log(`[MCP] Tool registered: ${toolConfig.name}`);
    } catch (err: any) {
      console.error(`[MCP] Error registering tool ${toolConfig?.name || 'unknown'}:`, {
        message: err?.message || 'Unknown error',
        stack: err?.stack,
        name: err?.name,
        toolConfig,
        fullError: err
      });
      // Continue with next tool instead of failing completely
    }
  });
}
