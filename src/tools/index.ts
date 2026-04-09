
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Context } from 'hono';
import type { ToolDefinition, ToolRegistry } from './types.js';
import { createSuccessResponse, createErrorResponse } from '../mcp/types.js';

import { ragTools } from './rag.js';
import { memoryTools } from './memory.js';
import { handoverTools } from './handover.js';
import { searchTools } from './search.js';
import { supportTools } from './support.js';
import { clientTools } from './client.js';
import { systemTools } from './system.js';

export const TOOLS: ToolRegistry = {
  ...memoryTools,
  ...ragTools,
  ...handoverTools,
  ...searchTools,
  ...supportTools,
  ...clientTools,
};

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS[name];
}

export function listTools(): { name: string; description: string; category?: string }[] {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    category: tool.category,
  }));
}

export function getToolsByCategory(category: string): ToolRegistry {
  return Object.fromEntries(
    Object.entries(TOOLS).filter(([_, tool]) => tool.category === category)
  );
}

export function getToolsByTag(tag: string): ToolRegistry {
  return Object.fromEntries(
    Object.entries(TOOLS).filter(([_, tool]) => tool.tags?.includes(tag))
  );
}

export function registerToolsToMcp(
  server: McpServer,
  tools: ToolRegistry = TOOLS
): void {
  for (const [name, tool] of Object.entries(tools)) {
    
    const schemaShape = tool.schema.shape as Record<string, unknown>;
    
    server.tool(
      name,
      tool.description,
      schemaShape,
      async (args) => {
        try {
          const result = await tool.execute(args);
          return createSuccessResponse(result as Record<string, unknown>);
        } catch (error) {
          return createErrorResponse(error);
        }
      }
    );
  }
  
}

export async function restToolHandler(c: Context): Promise<Response> {
  const toolName = c.req.param('toolName');
  const tool = getTool(toolName);
  
  if (!tool) {
    return c.json({
      error: 'Tool not found',
      availableTools: Object.keys(TOOLS),
    }, 404);
  }
  
  try {
    const body = await c.req.json();
    
    const parsed = tool.schema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation error',
        details: parsed.error.flatten(),
      }, 400);
    }
    
    const result = await tool.execute(parsed.data);
    
    return c.json({
      success: true,
      tool: toolName,
      result,
    });
  } catch (error) {
    return c.json({
      error: 'Execution error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

export function restListToolsHandler(c: Context): Response {
  return c.json({
    tools: listTools(),
    total: Object.keys(TOOLS).length,
  });
}

export function restGetToolSchemaHandler(c: Context): Response {
  const toolName = c.req.param('toolName');
  const tool = getTool(toolName);
  
  if (!tool) {
    return c.json({ error: 'Tool not found' }, 404);
  }
  
  const shape = tool.schema.shape;
  const properties: Record<string, { type: string; description?: string }> = {};
  
  for (const [key, value] of Object.entries(shape)) {
    const zodField = value as { description?: string; _def?: { typeName?: string } };
    properties[key] = {
      type: zodField._def?.typeName || 'unknown',
      description: zodField.description,
    };
  }
  
  return c.json({
    name: toolName,
    description: tool.description,
    category: tool.category,
    tags: tool.tags,
    parameters: properties,
  });
}
