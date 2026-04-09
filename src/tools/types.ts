
import { z, ZodObject, ZodRawShape } from 'zod';

export interface ToolDefinition {
  
  description: string;
  
  schema: ZodObject<ZodRawShape>;
  
  execute: (args: any) => Promise<unknown>;
  
  category?: ToolCategory;
  
  requiresAuth?: boolean;
  
  tags?: string[];
}

export type ToolCategory = 
  | 'memory'     
  | 'rag'        
  | 'search'     
  | 'handover'   
  | 'support'    
  | 'cache'      
  | 'client'     
  | 'system';    

export type ToolRegistry = Record<string, ToolDefinition>;

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    executionTime?: number;
    cached?: boolean;
    [key: string]: unknown;
  };
}

export function defineTool<TShape extends ZodRawShape>(
  schema: ZodObject<TShape>,
  config: {
    description: string;
    execute: (args: z.infer<ZodObject<TShape>>) => Promise<unknown>;
    tags?: string[];
    requiresAuth?: boolean;
  }
): ToolDefinition {
  return {
    schema: schema as ZodObject<ZodRawShape>,
    description: config.description,
    execute: config.execute,
    tags: config.tags,
    requiresAuth: config.requiresAuth,
  };
}

export function defineToolGroup<T extends ToolRegistry>(
  category: ToolCategory,
  tools: T
): T {
  
  Object.values(tools).forEach(tool => {
    tool.category = category;
  });
  return tools;
}

export interface McpToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface RestToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
