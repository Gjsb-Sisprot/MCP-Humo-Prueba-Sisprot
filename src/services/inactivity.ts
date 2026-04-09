
import { sql } from '../db/index.js';
import type { Conversation } from '../db/types.js';
import { closeConversation } from './handover.js';
import { emit } from '../lib/event-bus.js';

const WARN_MINUTES = parseInt(process.env.INACTIVITY_WARN_MINUTES || '15', 10);
const CLOSE_MINUTES = parseInt(process.env.INACTIVITY_CLOSE_MINUTES || '15', 10);
const CHECK_INTERVAL_MS = parseInt(process.env.INACTIVITY_CHECK_INTERVAL_MS || '120000', 10); 

const WARNING_MESSAGE = process.env.INACTIVITY_WARNING_MESSAGE
  || 'Hemos notado que no hay actividad en esta conversación. Si no recibimos respuesta en 15 minutos, se cerrará automáticamente.';

const CLOSE_MESSAGE = 'Esta conversación fue cerrada automáticamente por inactividad del cliente. '
  + 'Si necesitas ayuda nuevamente, no dudes en contactarnos.';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
let stats = { warned: 0, closed: 0, errors: 0, runs: 0 };

export function startInactivityScheduler(): void {
  if (schedulerInterval) {
    return;
  }

  processInactiveConversations().catch(err => {
  });

  schedulerInterval = setInterval(() => {
    processInactiveConversations().catch(err => {
      stats.errors++;
    });
  }, CHECK_INTERVAL_MS);
}

export function stopInactivityScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

export function getInactivityStats() {
  return {
    running: schedulerInterval !== null,
    lastRunAt: lastRunAt?.toISOString() || null,
    config: {
      warnMinutes: WARN_MINUTES,
      closeMinutes: CLOSE_MINUTES,
      checkIntervalMs: CHECK_INTERVAL_MS,
    },
    stats: { ...stats },
  };
}

export async function resetInactivityWarning(conversationId: string): Promise<void> {
  await sql`
    UPDATE conversations
    SET inactivity_warned_at = NULL
    WHERE id = ${conversationId}
    AND inactivity_warned_at IS NOT NULL
  `;
}

async function processInactiveConversations(): Promise<void> {
  if (isRunning) return; 
  isRunning = true;

  try {
    const warnedCount = await warnInactiveConversations();
    const closedCount = await closeTimedOutConversations();

    stats.runs++;
    lastRunAt = new Date();

    if (warnedCount > 0 || closedCount > 0) {
    }
  } finally {
    isRunning = false;
  }
}

async function warnInactiveConversations(): Promise<number> {
  const conversations = await sql<(Conversation & { last_message_at: string })[]>`
    SELECT c.*, sub.last_message_at
    FROM conversations c
    INNER JOIN LATERAL (
      SELECT 
        cl.role AS last_role,
        cl.created_at AS last_message_at
      FROM chat_logs cl
      WHERE cl.conversation_id = c.id
      ORDER BY cl.created_at DESC
      LIMIT 1
    ) sub ON sub.last_role IN ('model', 'assistant', 'system')
    WHERE c.status = 'active'
      AND c.inactivity_warned_at IS NULL
      AND sub.last_message_at < NOW() - make_interval(mins => ${WARN_MINUTES})
  `;

  for (const conv of conversations) {
    try {
      
      await sql`
        INSERT INTO chat_logs (conversation_id, role, content)
        VALUES (${conv.id}, 'system', ${WARNING_MESSAGE})
      `;

      await sql`
        UPDATE conversations
        SET inactivity_warned_at = NOW(), updated_at = NOW()
        WHERE id = ${conv.id}
      `;

      stats.warned++;

      emit({
        type: 'new_message',
        sessionId: conv.session_id,
        data: { role: 'system', content: WARNING_MESSAGE },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      stats.errors++;
    }
  }

  return conversations.length;
}

async function closeTimedOutConversations(): Promise<number> {
  const conversations = await sql<Conversation[]>`
    SELECT c.*
    FROM conversations c
    WHERE c.status = 'active'
      AND c.inactivity_warned_at IS NOT NULL
      AND c.inactivity_warned_at < NOW() - make_interval(mins => ${CLOSE_MINUTES})
      AND NOT EXISTS (
        SELECT 1 FROM chat_logs cl
        WHERE cl.conversation_id = c.id
          AND cl.role = 'user'
          AND cl.created_at > c.inactivity_warned_at
      )
  `;

  for (const conv of conversations) {
    try {
      
      await sql`
        INSERT INTO chat_logs (conversation_id, role, content)
        VALUES (${conv.id}, 'system', ${CLOSE_MESSAGE})
      `;

      await closeConversation({
        sessionId: conv.session_id,
        resolution: 'Conversación cerrada automáticamente por inactividad del cliente.',
        closedBy: 'system',
        createTicket: true,
      });

      stats.closed++;
    } catch (err) {
      stats.errors++;
    }
  }

  return conversations.length;
}
