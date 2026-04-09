import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { timeout } from 'hono/timeout';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import { TOOLS } from './tools/index.js';
import { mcpAuthMiddleware, restAuthMiddleware } from './middleware/auth.js';
import { mcpRouter, closeAllSessions } from './routes/mcp.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { startInactivityScheduler, stopInactivityScheduler } from './services/inactivity.js';

const PORT = parseInt(process.env.PORT || '3002', 10);

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type', 'Authorization', 'mcp-session-id',
    'mcp-protocol-version', 'Last-Event-ID', 'Accept',
  ],
  exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
}));
app.use('*', logger());

app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(1);
  c.res.headers.set('X-Response-Time', `${ms}ms`);
});

app.use('*', secureHeaders());
app.use('/api/*', timeout(30000));
app.use('/mcp', timeout(120000));
app.use(bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.json({ error: 'Payload too large', maxSize: '1MB' }, 413),
}));

app.use('/mcp', mcpAuthMiddleware);
app.use('/api/*', restAuthMiddleware);

app.route('', mcpRouter);
app.route('', apiRouter);
app.route('', adminRouter);


const isTest = process.env.VITEST === 'true' || !!process.env.VITEST;

if (!isTest) {
  startInactivityScheduler();
}

process.on('SIGINT', async () => {
  stopInactivityScheduler();
  await closeAllSessions();
  process.exit(0);
});

export { app };

export default isTest ? app : {
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};
