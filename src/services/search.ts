
import { z } from 'zod';
import { supabase } from '../db/index.js';
import type { Conversation, ConversationStatus } from '../db/types.js';

export const listConversationsSchema = z.object({
  userId: z.string().optional().describe('Filtrar por usuario propietario'),
  status: z.enum(['active', 'paused', 'waiting_specialist', 'handed_over', 'closed']).optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  orderBy: z.enum(['created_at', 'updated_at']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const searchConversationsSchema = z.object({
  userId: z.string().optional().describe('Filtrar por usuario propietario'),
  identification: z.string().optional(),
  contract: z.string().optional(),
  sector: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(20),
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
export type SearchConversationsInput = z.infer<typeof searchConversationsSchema>;

export interface ConversationSummary {
  sessionId: string;
  userId: string | null;
  status: ConversationStatus;
  summary: string | null;
  identification: string | null;
  contract: string | null;
  sector: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  specialistId: string | null;
  specialistName: string | null;
  escalatedAt: string | null;
  takenAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  glpiTicketId: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export async function listConversations(input: ListConversationsInput): Promise<{
  conversations: ConversationSummary[];
  total: number;
}> {
  const { userId, status, limit, offset, orderBy, order } = listConversationsSchema.parse(input);
  
  let query = supabase
    .from('conversations')
    .select('*, chat_logs(count)', { count: 'exact' });

  if (userId) {
    query = query.eq('user_id', userId);
  }
  if (status) {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query
    .order(orderBy, { ascending: order === 'asc' })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  
  return {
    conversations: (data || []).map(c => ({
      sessionId: c.session_id,
      userId: c.user_id,
      status: c.status,
      summary: c.summary,
      identification: c.identification,
      contract: c.contract,
      sector: c.sector,
      contactName: c.contact_name,
      contactEmail: c.contact_email,
      contactPhone: c.contact_phone,
      specialistId: c.specialist_id,
      specialistName: c.specialist_name,
      escalatedAt: c.escalated_at,
      takenAt: c.taken_at,
      closedAt: c.closed_at,
      closedBy: c.closed_by,
      glpiTicketId: c.glpi_ticket_id,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      messageCount: c.chat_logs?.[0]?.count || 0,
    })),
    total: count || 0,
  };
}

export async function searchConversations(input: SearchConversationsInput): Promise<ConversationSummary[]> {
  const { userId, identification, contract, sector, limit } = searchConversationsSchema.parse(input);
  
  let query = supabase
    .from('conversations')
    .select('*, chat_logs(count)');

  if (userId) {
    query = query.eq('user_id', userId);
  }
  
  if (identification || contract || sector) {
    let orConditions = [];
    if (identification) orConditions.push(`identification.ilike.%${identification}%`);
    if (contract) orConditions.push(`contract.ilike.%${contract}%`);
    if (sector) orConditions.push(`sector.ilike.%${sector}%`);
    query = query.or(orConditions.join(','));
  } else {
    // If no search terms, return empty if no userId either
    if (!userId) return [];
  }
  
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  
  return (data || []).map(c => ({
    sessionId: c.session_id,
    userId: c.user_id,
    status: c.status,
    summary: c.summary,
    identification: c.identification,
    contract: c.contract,
    sector: c.sector,
    contactName: c.contact_name,
    contactEmail: c.contact_email,
    contactPhone: c.contact_phone,
    specialistId: c.specialist_id,
    specialistName: c.specialist_name,
    escalatedAt: c.escalated_at,
    takenAt: c.taken_at,
    closedAt: c.closed_at,
    closedBy: c.closed_by,
    glpiTicketId: c.glpi_ticket_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    messageCount: c.chat_logs?.[0]?.count || 0,
  }));
}

export async function getPendingConversations(): Promise<ConversationSummary[]> {
  return (await listConversations({ status: 'waiting_specialist', limit: 50, offset: 0, orderBy: 'created_at', order: 'desc' })).conversations;
}

export async function getActiveConversations(): Promise<ConversationSummary[]> {
  return (await listConversations({ status: 'active', limit: 50, offset: 0, orderBy: 'created_at', order: 'desc' })).conversations;
}

export async function getSpecialistStats(specialistEmail: string): Promise<{
  activeConversations: number;
  closedToday: number;
  avgResponseTime: number | null;
}> {
  const { count: activeCount, error: activeError } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('specialist_id', specialistEmail)
    .in('status', ['handed_over', 'active']);

  if (activeError) throw activeError;
  
  const today = new Date().toISOString().split('T')[0];
  const { count: closedCount, error: closedError } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('specialist_id', specialistEmail)
    .eq('status', 'closed')
    .gte('updated_at', today);
  
  if (closedError) throw closedError;
  
  return {
    activeConversations: activeCount || 0,
    closedToday: closedCount || 0,
    avgResponseTime: null, 
  };
}
