
import { z } from 'zod';
import { sql } from '../db/index.js';
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
  
  const existing = await sql<Conversation[]>`
    SELECT * FROM conversations 
    WHERE session_id = ${sessionId}
    LIMIT 1
  `;
  
  if (existing[0]) {
    
    if (userId && !existing[0].user_id) {
      await sql`UPDATE conversations SET user_id = ${userId} WHERE id = ${existing[0].id}`;
      existing[0].user_id = userId;
    }
    return existing[0];
  }
  
  const created = await sql<Conversation[]>`
    INSERT INTO conversations (session_id, user_id, status)
    VALUES (${sessionId}, ${userId || null}, 'active')
    RETURNING *
  `;
  
  return created[0];
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
  
  const result = await sql<ChatLog[]>`
    INSERT INTO chat_logs (conversation_id, role, content, tool_name, tool_call_id)
    VALUES (
      ${conversation.id}, 
      ${role}, 
      ${content}, 
      ${toolName || null},
      ${toolCallId || null}
    )
    RETURNING *
  `;
  
  await sql`
    UPDATE conversations 
    SET 
      identification = COALESCE(${identification ?? null}, identification),
      contract = COALESCE(${contract ?? null}, contract),
      sector = COALESCE(${sector ?? null}, sector),
      contact_name = COALESCE(${contactName ?? null}, contact_name),
      contact_email = COALESCE(${contactEmail ?? null}, contact_email),
      contact_phone = COALESCE(${contactPhone ?? null}, contact_phone),
      updated_at = NOW() 
    WHERE id = ${conversation.id}
  `;

  if (role === 'user') {
    await resetInactivityWarning(conversation.id);
  }
  
  return result[0];
}

export async function getConversationHistory(input: GetHistoryInput): Promise<{
  conversation: Conversation | null;
  messages: ConversationMessage[];
}> {
  const { sessionId, limit } = getHistorySchema.parse(input);
  
  const conversations = await sql<Conversation[]>`
    SELECT * FROM conversations 
    WHERE session_id = ${sessionId}
    LIMIT 1
  `;
  
  if (!conversations[0]) {
    return { conversation: null, messages: [] };
  }
  
  const conversation = conversations[0];
  
  const logs = await sql<ChatLog[]>`
    SELECT * FROM chat_logs 
    WHERE conversation_id = ${conversation.id}
      AND role != 'tool'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  
  const messages: ConversationMessage[] = logs.map(log => ({
    role: log.role as MessageRole,
    content: log.content,
    toolName: log.tool_name || undefined,
    createdAt: log.created_at,
  }));
  
  return { conversation, messages };
}

export async function updateClientInfo(input: UpdateClientInfoInput): Promise<Conversation> {
  const { sessionId, identification, contract, sector, contactName, contactEmail, contactPhone } = 
    updateClientInfoSchema.parse(input);
  
  const updates: Record<string, unknown> = {};
  if (identification !== undefined) updates.identification = identification;
  if (contract !== undefined) updates.contract = contract;
  if (sector !== undefined) updates.sector = sector;
  if (contactName !== undefined) updates.contact_name = contactName;
  if (contactEmail !== undefined) updates.contact_email = contactEmail;
  if (contactPhone !== undefined) updates.contact_phone = contactPhone;
  
  const conversation = await getOrCreateConversation(sessionId);
  
  const result = await sql<Conversation[]>`
    UPDATE conversations
    SET 
      identification = COALESCE(${identification || null}, identification),
      contract = COALESCE(${contract || null}, contract),
      sector = COALESCE(${sector || null}, sector),
      contact_name = COALESCE(${contactName || null}, contact_name),
      contact_email = COALESCE(${contactEmail || null}, contact_email),
      contact_phone = COALESCE(${contactPhone || null}, contact_phone),
      updated_at = NOW()
    WHERE id = ${conversation.id}
    RETURNING *
  `;
  
  return result[0];
}

export async function updateSummary(sessionId: string, summary: string): Promise<Conversation> {
  const conversation = await getOrCreateConversation(sessionId);
  
  const result = await sql<Conversation[]>`
    UPDATE conversations
    SET summary = ${summary}, updated_at = NOW()
    WHERE id = ${conversation.id}
    RETURNING *
  `;
  
  return result[0];
}

export async function updateStatus(sessionId: string, status: ConversationStatus): Promise<Conversation> {
  const conversation = await getOrCreateConversation(sessionId);
  
  const result = await sql<Conversation[]>`
    UPDATE conversations
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${conversation.id}
    RETURNING *
  `;
  
  return result[0];
}

export async function getConversation(sessionId: string): Promise<Conversation | null> {
  const result = await sql<Conversation[]>`
    SELECT * FROM conversations
    WHERE session_id = ${sessionId}
    LIMIT 1
  `;
  
  return result[0] || null;
}
