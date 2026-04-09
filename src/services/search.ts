
import { z } from 'zod';
import { sql } from '../db/index.js';
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
  
  const conditions: string[] = [];
  if (userId) {
    conditions.push(`c.user_id = '${userId}'`);
  }
  if (status) {
    conditions.push(`c.status = '${status}'`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const countResult = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count FROM conversations c ${sql.unsafe(whereClause)}
  `;
  const total = parseInt(countResult[0]?.count || '0', 10);
  
  const orderClause = `ORDER BY c.${orderBy} ${order.toUpperCase()}`;
  
  const conversations = await sql<(Conversation & { message_count: string })[]>`
    SELECT 
      c.*,
      (SELECT COUNT(*)::text FROM chat_logs WHERE conversation_id = c.id) as message_count
    FROM conversations c
    ${sql.unsafe(whereClause)}
    ${sql.unsafe(orderClause)}
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  
  return {
    conversations: conversations.map(c => ({
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
      messageCount: parseInt(c.message_count || '0', 10),
    })),
    total,
  };
}

export async function searchConversations(input: SearchConversationsInput): Promise<ConversationSummary[]> {
  const { userId, identification, contract, sector, limit } = searchConversationsSchema.parse(input);
  
  const conditions: string[] = [];
  
  if (userId) {
    conditions.push(`user_id = '${userId}'`);
  }
  
  const searchConditions: string[] = [];
  if (identification) {
    searchConditions.push(`identification ILIKE '%${identification}%'`);
  }
  if (contract) {
    searchConditions.push(`contract ILIKE '%${contract}%'`);
  }
  if (sector) {
    searchConditions.push(`sector ILIKE '%${sector}%'`);
  }
  
  if (searchConditions.length > 0) {
    conditions.push(`(${searchConditions.join(' OR ')})`);
  }
  
  if (conditions.length === 0) {
    return [];
  }
  
  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  
  const conversations = await sql<(Conversation & { message_count: string })[]>`
    SELECT 
      c.*,
      (SELECT COUNT(*)::text FROM chat_logs WHERE conversation_id = c.id) as message_count
    FROM conversations c
    ${sql.unsafe(whereClause)}
    ORDER BY c.updated_at DESC
    LIMIT ${limit}
  `;
  
  return conversations.map(c => ({
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
    messageCount: parseInt(c.message_count || '0', 10),
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
  
  const activeResult = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count 
    FROM conversations 
    WHERE specialist_id = ${specialistEmail} 
    AND status IN ('handed_over', 'active')
  `;
  
  const today = new Date().toISOString().split('T')[0];
  const closedResult = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count 
    FROM conversations 
    WHERE specialist_id = ${specialistEmail} 
    AND status = 'closed'
    AND DATE(updated_at) = ${today}
  `;
  
  return {
    activeConversations: parseInt(activeResult[0]?.count || '0', 10),
    closedToday: parseInt(closedResult[0]?.count || '0', 10),
    avgResponseTime: null, 
  };
}
