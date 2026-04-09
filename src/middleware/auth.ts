
import type { Context, Next } from 'hono';
import { validateApiKey } from '../services/api-keys.js';

export function isAuthRequired(): boolean {
  return process.env.MCP_REQUIRE_AUTH === 'true';
}

export const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH === 'true';

export async function mcpAuthMiddleware(c: Context, next: Next) {
  if (!isAuthRequired()) return next();
  
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  
  if (!apiKey) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Authentication required: Bearer token missing' },
      id: null,
    }, 401);
  }
  
  const result = await validateApiKey(apiKey);
  if (!result.valid) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32001, message: `Authentication failed: ${result.error}` },
      id: null,
    }, 401);
  }
  
  return next();
}

export async function restAuthMiddleware(c: Context, next: Next) {
  if (!isAuthRequired()) return next();
  
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  
  if (!apiKey) {
    return c.json({ error: 'Authentication required', message: 'Incluir header: Authorization: Bearer sk-sisprot-...' }, 401);
  }
  
  const result = await validateApiKey(apiKey);
  if (!result.valid) {
    return c.json({ error: 'Authentication failed', message: result.error }, 401);
  }
  
  return next();
}

export async function validateAuthInline(c: Context): Promise<Response | null> {
  if (!isAuthRequired()) return null;
  
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!key) return c.json({ error: 'Authentication required' }, 401);
  
  const result = await validateApiKey(key);
  if (!result.valid) return c.json({ error: result.error }, 401);
  
  return null;
}
