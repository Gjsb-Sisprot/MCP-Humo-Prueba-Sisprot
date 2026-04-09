
import { z } from 'zod';
import { supabase } from '../db/index.js';
import type { Conversation, ChatLog, ConversationStatus, MessageRole } from '../db/types.js';
import { resetInactivityWarning } from './inactivity.js';

export const saveInteractionSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  role: z.enum(['user', 'model', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  identification: z.string().optional(),
  contract: z.string().optional(),
  sector: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
});

export const getHistorySchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(50),
});

export const updateClientInfoSchema = z.object({
  sessionId: z.string().min(1),
  identification: z.string().optional(),
  contract: z.string().optional(),
  sector: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
});

export type SaveInteractionInput = z.infer<typeof saveInteractionSchema>;
export type GetHistoryInput = z.infer<typeof getHistorySchema>;
export type UpdateClientInfoInput = z.infer<typeof updateClientInfoSchema>;

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  createdAt: string;
}

export async function getOrCreateConversation(sessionId: string, userId?: string): Promise<Conversation> {
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  
  if (findError) throw findError;
  
  if (existing) {
    if (userId && !existing.user_id) {
      const { data: updated, error: updateError } = await supabase
        .from('conversations')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      
      if (updateError) throw updateError;
      return updated as unknown as Conversation;
    }
    return existing as unknown as Conversation;
  }
  
  const { data: created, error: insertError } = await supabase
    .from('conversations')
    .insert({ session_id: sessionId, user_id: userId || null, status: 'active' })
    .select()
    .single();
  
  if (insertError) throw insertError;
  return created as unknown as Conversation;
}

export async function saveInteraction(input: SaveInteractionInput): Promise<ChatLog> {
  const {
    sessionId,
    userId,
    role,
    content,
    toolName,
    toolCallId,
    identification,
    contract,
    sector,
    contactName,
    contactEmail,
    contactPhone,
  } = saveInteractionSchema.parse(input);
  
  const conversation = await getOrCreateConversation(sessionId, userId);
  
  const { data: log, error: logError } = await supabase
    .from('chat_logs')
    .insert({
      conversation_id: conversation.id, 
      role, 
      content, 
      tool_name: toolName || null,
      tool_call_id: toolCallId || null
    })
    .select()
    .single();
  
  if (logError) throw logError;
  
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (identification !== undefined) updates.identification = identification;
  if (contract !== undefined) updates.contract = contract;
  if (sector !== undefined) updates.sector = sector;
  if (contactName !== undefined) updates.contact_name = contactName;
  if (contactEmail !== undefined) updates.contact_email = contactEmail;
  if (contactPhone !== undefined) updates.contact_phone = contactPhone;

  const { error: convError } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', conversation.id);

  if (convError) throw convError;

  if (role === 'user') {
    await resetInactivityWarning(conversation.id);
  }
  
  return log as unknown as ChatLog;
}

export async function getConversationHistory(input: GetHistoryInput): Promise<{
  conversation: Conversation | null;
  messages: ConversationMessage[];
}> {
  const { sessionId, limit } = getHistorySchema.parse(input);
  
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  
  if (convError || !conversation) {
    return { conversation: null, messages: [] };
  }
  
  const { data: logs, error: logsError } = await supabase
    .from('chat_logs')
    .select('*')
    .eq('conversation_id', conversation.id)
    .neq('role', 'tool')
    .order('created_at', { ascending: true })
    .limit(limit);
  
  if (logsError) throw logsError;
  
  const messages: ConversationMessage[] = (logs || []).map(log => ({
    role: log.role as MessageRole,
    content: log.content,
    toolName: log.tool_name || undefined,
    createdAt: log.created_at,
  }));
  
  return { conversation: conversation as unknown as Conversation, messages };
}

export async function updateClientInfo(input: UpdateClientInfoInput): Promise<Conversation> {
  const { sessionId, identification, contract, sector, contactName, contactEmail, contactPhone } = 
    updateClientInfoSchema.parse(input);
  
  const conversation = await getOrCreateConversation(sessionId);
  
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (identification !== undefined) updates.identification = identification;
  if (contract !== undefined) updates.contract = contract;
  if (sector !== undefined) updates.sector = sector;
  if (contactName !== undefined) updates.contact_name = contactName;
  if (contactEmail !== undefined) updates.contact_email = contactEmail;
  if (contactPhone !== undefined) updates.contact_phone = contactPhone;

  const { data, error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', conversation.id)
    .select()
    .single();
  
  if (error) throw error;
  return data as unknown as Conversation;
}

export async function updateSummary(sessionId: string, summary: string): Promise<Conversation> {
  const conversation = await getOrCreateConversation(sessionId);
  
  const { data, error } = await supabase
    .from('conversations')
    .update({ summary, updated_at: new Date().toISOString() })
    .eq('id', conversation.id)
    .select()
    .single();
  
  if (error) throw error;
  return data as unknown as Conversation;
}

export async function updateStatus(sessionId: string, status: ConversationStatus): Promise<Conversation> {
  const conversation = await getOrCreateConversation(sessionId);
  
  const { data, error } = await supabase
    .from('conversations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', conversation.id)
    .select()
    .single();
  
  if (error) throw error;
  return data as unknown as Conversation;
}

export async function getConversation(sessionId: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  
  if (error) throw error;
  return data as unknown as Conversation | null;
}
