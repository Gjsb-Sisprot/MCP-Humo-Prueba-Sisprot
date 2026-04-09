
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';

import { createApiKey } from '../services/api-keys.js';
import { deleteKnowledgeBySource } from '../services/knowledge.js';
import { supabase } from '../db/index.js';
import { checkDatabaseConnection } from '../db/index.js';
import { getAllCacheStats, clearAllCaches } from '../lib/cache.js';
import { getActiveSessionCount } from './mcp.js';
import { validateAuthInline, REQUIRE_AUTH } from '../middleware/auth.js';
import { getInactivityStats } from '../services/inactivity.js';

const VERSION = '1.3.0';

export const adminRouter = new Hono();

adminRouter.get('/health', async (c) => {
  const dbStatus = await checkDatabaseConnection();
  const cacheStats = getAllCacheStats();
  const inactivity = getInactivityStats();
  
  return c.json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString(),
    database: dbStatus.connected ? 'connected' : 'disconnected',
    database_details: !dbStatus.connected ? dbStatus : undefined,
    activeSessions: getActiveSessionCount(),
    cache: cacheStats,
    inactivity,
  });
});

adminRouter.get('/cache/stats', (c) => {
  return c.json(getAllCacheStats());
});

adminRouter.post('/cache/clear', (c) => {
  clearAllCaches();
  return c.json({ success: true, message: 'Todos los caches limpiados' });
});

adminRouter.get('/admin/inactivity', (c) => {
  return c.json(getInactivityStats());
});

adminRouter.use('/debug/cleanup/*', async (c, next) => {
  const authError = await validateAuthInline(c);
  if (authError) return authError;
  return next();
});

adminRouter.delete('/debug/cleanup/:type', async (c) => {
  const type = c.req.param('type');
  
  try {
    if (type === 'knowledge') {
      const result = await deleteKnowledgeBySource('test_mcp_debug');
      return c.json({ success: true, deletedCount: result.deletedCount, message: 'Documentos de prueba eliminados' });
    }
    
    if (type === 'conversations') {
      const { data, error, count } = await supabase
        .from('conversations')
        .delete({ count: 'exact' })
        .like('session_id', 'test-debug-%')
        .select('session_id');
      
      if (error) throw error;
      return c.json({ success: true, deletedCount: count, message: 'Conversaciones de prueba eliminadas' });
    }
    
    if (type === 'session_state') {
      const { data, error, count } = await supabase
        .from('session_state')
        .delete({ count: 'exact' })
        .like('session_id', 'test-%')
        .select('id');

      if (error) throw error;
      return c.json({ success: true, deletedCount: count, message: 'Session states de prueba eliminados' });
    }
    
    return c.json({ success: false, error: 'Tipo no válido. use: knowledge, conversations, session_state' }, 400);
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

function serveDebugFile(filePath: string, contentType: string) {
  try {
    const fullPath = join(process.cwd(), 'public', 'debug', filePath);
    const content = readFileSync(fullPath, 'utf-8');
    return new Response(content, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
    });
  } catch {
    return new Response('File not found: ' + filePath, { status: 404 });
  }
}

adminRouter.get('/debug', (c) => serveDebugFile('index.html', 'text/html; charset=utf-8'));
adminRouter.get('/debug/styles.css', (c) => serveDebugFile('styles.css', 'text/css; charset=utf-8'));
adminRouter.get('/debug/mcp-client.js', (c) => serveDebugFile('mcp-client.js', 'application/javascript; charset=utf-8'));
adminRouter.get('/debug/app.js', (c) => serveDebugFile('app.js', 'application/javascript; charset=utf-8'));

adminRouter.post('/admin/api-keys', async (c) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return c.json({ error: 'ADMIN_SECRET no configurado en el servidor' }, 503);
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token !== adminSecret) {
    return c.json({ error: 'Unauthorized: admin secret inválido' }, 401);
  }

  try {
    const body = await c.req.json() as { name: string; description?: string; expiresInDays?: number };
    if (!body.name) {
      return c.json({ error: 'Campo "name" es requerido' }, 400);
    }

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const result = await createApiKey({
      name: body.name,
      description: body.description,
      expiresAt,
    });

    return c.json({
      success: true,
      message: '⚠️ Guarda esta key, no se puede recuperar después',
      apiKey: result.key,
      keyId: result.keyId,
      prefix: result.prefix,
    }, 201);
  } catch (error) {
    return c.json({ error: 'Error creando API key', details: (error as Error).message }, 500);
  }
});

