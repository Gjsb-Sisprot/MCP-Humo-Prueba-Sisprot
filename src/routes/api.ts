
import { Hono } from 'hono';
import { 
  restToolHandler, 
  restListToolsHandler,
  restGetToolSchemaHandler,
  listTools,
} from '../tools/index.js';
import { listConversations as listConversationsService } from '../services/search.js';
import { getOrCreateConversation, getConversationHistory as getHistoryService } from '../services/conversation.js';
import { validateAuthInline, REQUIRE_AUTH } from '../middleware/auth.js';
import { TOOLS } from '../tools/index.js';
import { subscribe, subscribeAll, type ConversationEvent } from '../lib/event-bus.js';

const VERSION = '1.3.0';

const apiRouter = new Hono();

apiRouter.get('/api/tools', restListToolsHandler);

apiRouter.get('/api/tools/:toolName/schema', restGetToolSchemaHandler);

apiRouter.post('/api/tools/:toolName', restToolHandler);

apiRouter.get('/tools', async (c) => {
  const authError = await validateAuthInline(c);
  if (authError) return authError;
  
  const tools = listTools();
  return c.json({
    version: VERSION,
    toolCount: tools.length,
    tools: tools.map(t => ({
      name: t.name,
      description: t.description?.substring(0, 100) + '...',
      category: t.category,
    })),
  });
});

apiRouter.get('/api/conversations', async (c) => {
  const userId = c.req.query('userId');
  
  if (!userId) {
    return c.json({ error: 'userId es requerido' }, 400);
  }
  
  const status = c.req.query('status') as 'active' | 'paused' | 'waiting_specialist' | 'handed_over' | 'closed' | undefined;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  
  try {
    const result = await listConversationsService({
      userId,
      status,
      limit,
      offset,
      orderBy: 'updated_at',
      order: 'desc',
    });
    
    return c.json({ success: true, ...result });
  } catch (error) {
    return c.json({ error: 'Error interno', details: String(error) }, 500);
  }
});

apiRouter.post('/api/conversations', async (c) => {
  try {
    const body = await c.req.json<{ sessionId?: string; userId?: string }>();
    
    if (!body.sessionId) {
      return c.json({ error: 'sessionId es requerido' }, 400);
    }
    if (!body.userId) {
      return c.json({ error: 'userId es requerido' }, 400);
    }
    
    const conversation = await getOrCreateConversation(body.sessionId, body.userId);
    
    return c.json({
      success: true,
      conversation: {
        id: conversation.id,
        sessionId: conversation.session_id,
        userId: conversation.user_id,
        status: conversation.status,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
    }, 201);
  } catch (error) {
    return c.json({ error: 'Error interno', details: String(error) }, 500);
  }
});

apiRouter.get('/api/conversations/events', async (c) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: ConversationEvent) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify({ ...event.data, sessionId: event.sessionId })}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          
        }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      const unsubscribe = subscribeAll(send);

      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch {  }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

apiRouter.get('/api/conversations/:sessionId/events', async (c) => {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId requerido' }, 400);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: ConversationEvent) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          
        }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      const unsubscribe = subscribe(sessionId, send);

      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch {  }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

apiRouter.get('/api/conversations/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const userId = c.req.query('userId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  
  if (!userId) {
    return c.json({ error: 'userId es requerido' }, 400);
  }
  
  try {
    const result = await getHistoryService({ sessionId, limit });
    
    if (!result.conversation) {
      return c.json({ error: 'Conversación no encontrada' }, 404);
    }
    
    if (result.conversation.user_id && result.conversation.user_id !== userId) {
      return c.json({ error: 'No autorizado' }, 403);
    }
    
    return c.json({
      success: true,
      conversation: {
        id: result.conversation.id,
        sessionId: result.conversation.session_id,
        userId: result.conversation.user_id,
        status: result.conversation.status,
        summary: result.conversation.summary,
        identification: result.conversation.identification,
        contract: result.conversation.contract,
        sector: result.conversation.sector,
        contactName: result.conversation.contact_name,
        contactEmail: result.conversation.contact_email,
        contactPhone: result.conversation.contact_phone,
        createdAt: result.conversation.created_at,
        updatedAt: result.conversation.updated_at,
      },
      messages: result.messages,
      messageCount: result.messages.length,
    });
  } catch (error) {
    return c.json({ error: 'Error interno', details: String(error) }, 500);
  }
});

apiRouter.get('/', async (c) => {
  const authError = await validateAuthInline(c);
  if (authError) return authError;

  const { getActiveSessionCount } = await import('./mcp.js');

  return c.json({
    name: 'SISPROT MCP Server',
    version: VERSION,
    description: 'MCP Server para soporte al cliente de ISP',
    toolCount: Object.keys(TOOLS).length,
    activeSessions: getActiveSessionCount(),
    endpoints: {
      health: '/health',
      mcp: {
        url: '/mcp',
        methods: {
          POST: 'Mensajes JSON-RPC (initialize, tools/call, etc.)',
          GET: 'SSE stream para notificaciones server→client',
          DELETE: 'Terminación de sesión',
        },
        protocol: 'MCP Streamable HTTP (2025-03-26)',
      },
      tools: '/tools',
      rest_api: {
        list: '/api/tools',
        schema: '/api/tools/:name/schema',
        execute: '/api/tools/:name (POST)',
      },
      conversations: {
        list: 'GET /api/conversations?userId=X',
        create: 'POST /api/conversations',
        get: 'GET /api/conversations/:sessionId?userId=X',
      },
      debug: '/debug',
    },
    middlewares: {
      secureHeaders: 'enabled',
      timeout: { api: '30s', mcp: '120s' },
      bodyLimit: '1MB',
    },
  });
});

export { apiRouter };
