
import { z } from 'zod';
import { supabase } from '../db/index.js';
import type { Conversation, ConversationStatus, ChatLog } from '../db/types.js';
import { repairMojibake } from '../lib/text.js';
import { getOrCreateConversation, updateSummary, updateStatus } from './conversation.js';
import { emitStatusChange, emit } from '../lib/event-bus.js';
import {
  createConversationTicket,
  closeTicket,
  createAndCloseTicket,
  type GLPITicketResult,
  type GLPICloseResult,
  priorityToUrgency,
} from './glpi.js';

export const escalateSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1),
  summary: z.string().optional(),
});

export const takeoverSchema = z.object({
  sessionId: z.string().min(1),
  specialistEmail: z.string().min(1),
  specialistName: z.string().min(1),
  createTicket: z.boolean().optional().default(true),
  reason: z.string().optional(),
});

export const closeSchema = z.object({
  sessionId: z.string().min(1),
  resolution: z.string().min(10),
  closedBy: z.enum(['system', 'agent', 'user']).default('system'),
  createTicket: z.boolean().optional().default(true),
  specialistName: z.string().optional(),
  specialistEmail: z.string().optional(),
});

export const pauseSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1),
  createTicket: z.boolean().optional().default(true),
  specialistName: z.string().optional(),
  specialistEmail: z.string().optional(),
});

export type EscalateInput = z.infer<typeof escalateSchema>;
export type TakeoverInput = z.infer<typeof takeoverSchema>;
export type CloseInput = z.infer<typeof closeSchema>;
export type PauseInput = z.infer<typeof pauseSchema>;

export interface TakeoverResult {
  success: boolean;
  conversation: Conversation;
  message: string;
  ticket?: GLPITicketResult;
}

export interface EscalationResult {
  success: boolean;
  conversation: Conversation;
  message: string;
  missingInfo?: string[];
}

export interface PauseResult {
  success: boolean;
  conversation: Conversation;
  message: string;
  ticket?: GLPITicketResult;
}

export interface CloseResult {
  success: boolean;
  conversation: Conversation;
  message: string;
  ticket?: GLPITicketResult | GLPICloseResult;
}

async function getConversationMessages(conversationId: string, limit = 50): Promise<ChatLog[]> {
  const { data, error } = await supabase
    .from('chat_logs')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  
  if (error) throw error;
  return (data || []) as unknown as ChatLog[];
}

async function saveGlpiTicketId(conversationId: string, ticketId: number): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ glpi_ticket_id: ticketId, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  
  if (error) throw error;
}

export async function escalateToSpecialist(input: EscalateInput): Promise<EscalationResult> {
  const { sessionId, reason, summary } = escalateSchema.parse(input);

  const conversation = await getOrCreateConversation(sessionId);

  const missingInfo: string[] = [];
  if (!conversation.contact_name) missingInfo.push('contact_name');
  if (!conversation.contact_phone && !conversation.contact_email) {
    missingInfo.push('contact_phone o contact_email');
  }

  if (missingInfo.length > 0) {
    return {
      success: false,
      conversation,
      message: 'Se requiere información de contacto para escalar',
      missingInfo,
    };
  }

  if (summary) {
    await updateSummary(sessionId, summary);
  }

  const { data: updated, error: updateError } = await supabase
    .from('conversations')
    .update({
      status: 'waiting_specialist',
      escalation_reason: reason,
      escalated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', conversation.id)
    .select()
    .single();

  if (updateError) throw updateError;

  const { error: logError } = await supabase
    .from('chat_logs')
    .insert({
      conversation_id: conversation.id,
      role: 'system',
      content: `Escalado a especialista: ${reason}`
    });

  if (logError) throw logError;

  emitStatusChange(sessionId, 'waiting_specialist', { reason });

  return {
    success: true,
    conversation: updated as unknown as Conversation,
    message: `Conversación escalada. Un especialista la atenderá pronto.`,
  };
}

export async function takeoverConversation(input: TakeoverInput): Promise<TakeoverResult> {
  const { sessionId, specialistEmail, specialistName, createTicket, reason } = takeoverSchema.parse(input);

  const conversation = await getOrCreateConversation(sessionId);

  const { data: updated, error: updateError } = await supabase
    .from('conversations')
    .update({
      status: 'handed_over',
      specialist_id: specialistEmail,
      specialist_name: specialistName,
      taken_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', conversation.id)
    .select()
    .single();

  if (updateError) throw updateError;

  const { error: logError } = await supabase
    .from('chat_logs')
    .insert({
      conversation_id: conversation.id,
      role: 'system',
      content: `Especialista ${specialistName} tomó la conversación`
    });

  if (logError) throw logError;

  emitStatusChange(sessionId, 'handed_over', { specialistName, specialistEmail });

  let ticket: GLPITicketResult | undefined;
  let finalConv = updated as unknown as Conversation;

  if (createTicket) {
    const messages = await getConversationMessages(conversation.id);
    const ticketReason = reason || conversation.escalation_reason || `Tomada por ${specialistName}`;

    ticket = await createConversationTicket({
      conversation: finalConv,
      messages,
      reason: ticketReason,
    });

    if (ticket.success && ticket.ticketId) {
      await saveGlpiTicketId(conversation.id, ticket.ticketId);
      finalConv.glpi_ticket_id = ticket.ticketId;

      const customerTicketMessage = `Tu caso fue registrado con el número de ticket #${ticket.ticketId}.`; 

      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: customerTicketMessage
        });

      emit({
        type: 'new_message',
        sessionId: conversation.session_id,
        data: { role: 'system', content: customerTicketMessage },
        timestamp: new Date().toISOString(),
      });
    } else if (ticket && !ticket.success) {
      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'tool',
          content: `Error creando ticket al tomar: ${ticket.error}`
        });
    }
  }

  return {
    success: true,
    conversation: finalConv,
    message: ticket?.success
      ? `Especialista ${specialistName} tomó la conversación. Ticket #${ticket.ticketId} creado.`
      : `Especialista ${specialistName} tomó la conversación`,
    ticket,
  };
}

export async function pauseConversation(input: PauseInput): Promise<PauseResult> {
  const { sessionId, reason, createTicket, specialistName, specialistEmail } = pauseSchema.parse(input);

  const conversation = await getOrCreateConversation(sessionId);

  if (specialistName && !conversation.specialist_name) {
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        specialist_name: specialistName,
        specialist_id: specialistEmail || conversation.specialist_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversation.id);
    
    if (updateError) throw updateError;
    conversation.specialist_name = specialistName;
    if (specialistEmail) conversation.specialist_id = specialistEmail;
  }

  const { data: updated, error: statusError } = await supabase
    .from('conversations')
    .update({
      status: 'paused',
      escalation_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversation.id)
    .select()
    .single();

  if (statusError) throw statusError;

  const pausedByLabel = conversation.specialist_name || 'Sistema';
  const { error: logError } = await supabase
    .from('chat_logs')
    .insert({
      conversation_id: conversation.id,
      role: 'system',
      content: `Conversación pausada por ${pausedByLabel}: ${reason}`
    });

  if (logError) throw logError;

  emitStatusChange(sessionId, 'paused', { reason, pausedBy: pausedByLabel });

  let ticket: GLPITicketResult | undefined;
  let finalConv = updated as unknown as Conversation;

  if (createTicket) {
    const messages = await getConversationMessages(conversation.id);

    ticket = await createConversationTicket({
      conversation: finalConv,
      messages,
      reason,
    });

    if (ticket.success && ticket.ticketId) {
      await saveGlpiTicketId(conversation.id, ticket.ticketId);
      finalConv.glpi_ticket_id = ticket.ticketId;

      const customerTicketMessage = `Tu caso fue registrado con el número de ticket #${ticket.ticketId}.`;

      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: customerTicketMessage
        });

      emit({
        type: 'new_message',
        sessionId: conversation.session_id,
        data: { role: 'system', content: customerTicketMessage },
        timestamp: new Date().toISOString(),
      });
    } else if (!ticket.success) {
      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'tool',
          content: `Error creando ticket: ${ticket.error}`
        });
    }
  }

  return {
    success: true,
    conversation: finalConv,
    message: ticket?.success
      ? `Conversación pausada. Ticket #${ticket.ticketId} creado.`
      : `Conversación pausada: ${reason}`,
    ticket,
  };
}

export async function closeConversation(input: CloseInput): Promise<CloseResult> {
  const { sessionId, resolution, closedBy, createTicket, specialistName, specialistEmail } = closeSchema.parse(input);

  const conversation = await getOrCreateConversation(sessionId);

  if (specialistName && !conversation.specialist_name) {
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        specialist_name: specialistName,
        specialist_id: specialistEmail || conversation.specialist_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversation.id);
    
    if (updateError) throw updateError;
    conversation.specialist_name = specialistName;
    if (specialistEmail) conversation.specialist_id = specialistEmail;
  }

  const { data: updated, error: statusError } = await supabase
    .from('conversations')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversation.id)
    .select()
    .single();

  if (statusError) throw statusError;

  const finalConv = updated as unknown as Conversation;
  const closedByClientLabel = closedBy === 'agent'
    ? (conversation.specialist_name || 'un especialista')
    : closedBy === 'user' ? 'el usuario' : 'el sistema';
  const closedMessage = `La conversación fue cerrada por ${closedByClientLabel}.`;

  const { error: logError } = await supabase
    .from('chat_logs')
    .insert({
      conversation_id: conversation.id,
      role: 'system',
      content: closedMessage
    });

  if (logError) throw logError;

  emitStatusChange(sessionId, 'closed', { closedBy, resolution });
  emit({
    type: 'new_message',
    sessionId: conversation.session_id,
    data: { role: 'system', content: closedMessage },
    timestamp: new Date().toISOString(),
  });

  let ticket: GLPITicketResult | GLPICloseResult | undefined;

  if (conversation.glpi_ticket_id) {
    const messages = await getConversationMessages(conversation.id);
    const solutionHtml = buildCloseResolution(resolution, finalConv, messages, conversation.status);

    ticket = await closeTicket({
      ticketId: conversation.glpi_ticket_id,
      resolution: solutionHtml,
    });

    if (ticket.success) {
      const customerTicketMessage = `Tu caso quedó registrado con el número de ticket #${conversation.glpi_ticket_id}.`;

      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: customerTicketMessage
        });

      emit({
        type: 'new_message',
        sessionId: conversation.session_id,
        data: { role: 'system', content: customerTicketMessage },
        timestamp: new Date().toISOString(),
      });
    } else {
      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'tool',
          content: `Error cerrando ticket #${conversation.glpi_ticket_id}: ${ticket.error}`
        });
    }
  } else if (createTicket) {
    const messages = await getConversationMessages(conversation.id);
    const reason = conversation.escalation_reason || resolution;

    const result = await createAndCloseTicket(
      {
        conversation: finalConv,
        messages,
        reason,
        previousStatus: conversation.status,
      },
      resolution
    );

    ticket = result;

    if (result.success && result.ticketId) {
      await saveGlpiTicketId(conversation.id, result.ticketId);
      finalConv.glpi_ticket_id = result.ticketId;

      const customerTicketMessage = `Tu caso quedó registrado con el número de ticket #${result.ticketId}.`;

      await supabase
        .from('chat_logs')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: customerTicketMessage
        });

      emit({
        type: 'new_message',
        sessionId: conversation.session_id,
        data: { role: 'system', content: customerTicketMessage },
        timestamp: new Date().toISOString(),
      });
    }
  }
  
  return {
    success: true,
    conversation: finalConv,
    message: ticket?.success
      ? `Conversación cerrada. Ticket ${ticket.ticketId ? `#${ticket.ticketId}` : ''} procesado.`
      : `Conversación cerrada: ${resolution}`,
    ticket,
  };
}

export async function getConversationStatus(sessionId: string): Promise<{
  status: ConversationStatus;
  specialistId: string | null;
  specialistName: string | null;
  escalationReason: string | null;
  summary: string | null;
  glpiTicketId: number | null;
  closedBy: string | null;
  contactInfo: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
} | null> {
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error || !conv) return null;

  return {
    status: conv.status,
    specialistId: conv.specialist_id,
    specialistName: conv.specialist_name,
    escalationReason: conv.escalation_reason,
    summary: conv.summary,
    glpiTicketId: conv.glpi_ticket_id,
    closedBy: conv.closed_by,
    contactInfo: {
      name: conv.contact_name,
      email: conv.contact_email,
      phone: conv.contact_phone,
    },
  };
}

function buildCloseResolution(
  resolution: string,
  conversation: Conversation,
  messages: ChatLog[],
  previousStatus?: ConversationStatus
): string {
  const sections: string[] = [];

  sections.push(`<h3>Resolución</h3>\n<p>${esc(resolution)}</p>`);

  if (conversation.escalation_reason) {
    let escalationText = conversation.escalation_reason;
    if (previousStatus === 'paused') {
      escalationText = conversation.specialist_name
        ? `Pausado por ${conversation.specialist_name} debido a: ${conversation.escalation_reason}`
        : `Pausado debido a: ${conversation.escalation_reason}`;
    } else if (previousStatus === 'waiting_specialist' || previousStatus === 'handed_over') {
      escalationText = `Incapacidad del asistente o por petición del usuario: ${conversation.escalation_reason}`;
    }
    sections.push(`<h3>Razón de Escalación</h3>\n<p>${esc(escalationText)}</p>`);
  }
  if (conversation.closed_by) {
    let closedByLabel: string;
    if (conversation.closed_by === 'system') {
      closedByLabel = 'Sistema (inactividad)';
    } else if (conversation.closed_by === 'agent') {
      closedByLabel = conversation.specialist_name || 'Agente';
    } else if (conversation.closed_by === 'user') {
      closedByLabel = 'Usuario';
    } else {
      closedByLabel = conversation.closed_by;
    }
    sections.push(`<p><b>Cerrada por:</b> ${esc(closedByLabel)}</p>`);
  }

  if (conversation.summary) {
    sections.push(`<h3>Resumen</h3>\n<p>${esc(conversation.summary)}</p>`);
  }

  const recent = messages
    .filter(m => m.role === 'user' || m.role === 'model' || m.role === 'assistant')
    .slice(-10);

  if (recent.length > 0) {
    const rows = recent.map(m => {
      const role = m.role === 'user' ? 'Cliente' : 'Asistente';
      const text = esc(m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content);
      return `<tr><td><b>${role}</b></td><td>${text}</td></tr>`;
    }).join('\n');

    sections.push(`<h3>Últimos Mensajes</h3>
<table border="1" cellpadding="4" cellspacing="0">
<tr><th>Rol</th><th>Mensaje</th></tr>
${rows}
</table>`);
  }

  sections.push(`<p><i>Sesión: ${esc(conversation.session_id)}</i></p>`);

  return sections.join('\n\n');
}

function esc(text: string): string {
  return repairMojibake(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
