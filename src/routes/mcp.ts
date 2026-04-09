import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { 
  WebStandardStreamableHTTPServerTransport 
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, registerToolsToMcp } from '../tools/index.js';

const VERSION = '1.3.0';

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

const SESSION_TTL_MS = 60 * 60 * 1000;
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();

function touchSession(sessionId: string) {
  const existing = sessionTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  
  sessionTimers.set(sessionId, setTimeout(() => {
    const transport = transports.get(sessionId);
    if (transport) {
      transport.close().catch(() => {});
      transports.delete(sessionId);
      sessionTimers.delete(sessionId);
    }
  }, SESSION_TTL_MS));
}

function removeSession(sessionId: string) {
  transports.delete(sessionId);
  const timer = sessionTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    sessionTimers.delete(sessionId);
  }
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'sisprot-mcp',
    version: VERSION,
  });

  registerToolsToMcp(server, TOOLS);

  return server;
}

const mcpRouter = new Hono();

mcpRouter.all('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    touchSession(sessionId);
    return transport.handleRequest(c.req.raw);
  }

  if (c.req.method === 'POST') {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error: invalid JSON' },
        id: null,
      }, 400);
    }

    if (!isInitializeRequest(body)) {
      return c.json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no valid session ID and not an initialization request' },
        id: null,
      }, 400);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
        touchSession(sid);
      },
      onsessionclosed: (sid) => {
        removeSession(sid);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        removeSession(sid);
      }
    };

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    return transport.handleRequest(c.req.raw, { parsedBody: body });
  }

  if (sessionId) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session not found' },
      id: null,
    }, 404);
  }

  return c.json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Bad Request: missing session ID' },
    id: null,
  }, 400);
});

export function getActiveSessionCount(): number {
  return transports.size;
}

export async function closeAllSessions(): Promise<void> {
  for (const [sid, transport] of transports) {
    try {
      await transport.close();
    } catch (error) {
    }
  }
  transports.clear();
  for (const timer of sessionTimers.values()) clearTimeout(timer);
  sessionTimers.clear();
}

export { mcpRouter };
