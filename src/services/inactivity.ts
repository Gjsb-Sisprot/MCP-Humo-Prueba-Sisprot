
import { supabase } from '../db/index.js';
import type { Conversation, ChatLog } from '../db/types.js';
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
  await supabase
    .from('conversations')
    .update({ inactivity_warned_at: null })
    .eq('id', conversationId)
    .not('inactivity_warned_at', 'is', null);
}

async function processInactiveConversations(): Promise<void> {
  if (isRunning) return; 
  isRunning = true;

  try {
    const warnedCount = await warnInactiveConversations();
    const closedCount = await closeTimedOutConversations();

    stats.runs++;
    lastRunAt = new Date();
  } finally {
    isRunning = false;
  }
}

async function warnInactiveConversations(): Promise<number> {
  const warnThreshold = new Date(Date.now() - WARN_MINUTES * 60 * 1000).toISOString();
  
  // Fetch active conversations that haven't been warned yet
  const { data: convs, error } = await supabase
    .from('conversations')
    .select('*, chat_logs(role, created_at)')
    .eq('status', 'active')
    .is('inactivity_warned_at', null);

  if (error || !convs) return 0;

  let count = 0;
  for (const conv of convs) {
    // Get last message manually because we don't want to use RPC yet
    const logs = conv.chat_logs as any[];
    if (!logs || logs.length === 0) continue;

    const lastLog = logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    
    // Only warn if the last message was from the bot/system and is old
    if (['model', 'assistant', 'system'].includes(lastLog.role) && lastLog.created_at < warnThreshold) {
      try {
        await supabase
          .from('chat_logs')
          .insert({ conversation_id: conv.id, role: 'system', content: WARNING_MESSAGE });

        await supabase
          .from('conversations')
          .update({ inactivity_warned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', conv.id);

        stats.warned++;
        count++;

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
  }

  return count;
}

async function closeTimedOutConversations(): Promise<number> {
  const closeThreshold = new Date(Date.now() - CLOSE_MINUTES * 60 * 1000).toISOString();
  
  const { data: convs, error } = await supabase
    .from('conversations')
    .select('*, chat_logs(role, created_at)')
    .eq('status', 'active')
    .not('inactivity_warned_at', 'is', null)
    .lt('inactivity_warned_at', closeThreshold);

  if (error || !convs) return 0;

  let count = 0;
  for (const conv of convs) {
    try {
      // Check if user has replied since warning
      const logs = conv.chat_logs as any[];
      const userReplied = logs.some(l => l.role === 'user' && l.created_at > conv.inactivity_warned_at);
      
      if (!userReplied) {
        await supabase
          .from('chat_logs')
          .insert({ conversation_id: conv.id, role: 'system', content: CLOSE_MESSAGE });

        await closeConversation({
          sessionId: conv.session_id,
          resolution: 'Conversación cerrada automáticamente por inactividad del cliente.',
          closedBy: 'system',
          createTicket: true,
        });

        stats.closed++;
        count++;
      }
    } catch (err) {
      stats.errors++;
    }
  }

  return count;
}
