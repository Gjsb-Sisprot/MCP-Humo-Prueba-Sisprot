
export type ConversationStatus = 'active' | 'paused' | 'waiting_specialist' | 'handed_over' | 'closed';

export type MessageRole = 'user' | 'model' | 'assistant' | 'system' | 'tool';

export interface Conversation {
  id: string;
  session_id: string;
  user_id: string | null;
  status: ConversationStatus;
  summary: string | null;
  identification: string | null;
  contract: string | null;
  sector: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  context_cache_id: string | null;
  context_cache_model: string | null;
  specialist_id: string | null;
  specialist_name: string | null;
  escalation_reason: string | null;
  glpi_ticket_id: number | null;
  priority: string | null;
  escalated_at: string | null;
  taken_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  inactivity_warned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatLog {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: string;
}

export interface KnowledgeBase {
  id: number;
  content: string;
  title: string | null;
  source: string | null;
  embedding: number[] | null;
  parent_id: number | null;
  chunk_index: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionState {
  id: number;
  session_id: string;
  state_key: string;
  state_value: unknown;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: number;
  key_hash: string;
  key_prefix: string;
  name: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface ConversationArchive {
  id: number;
  original_session_id: string;
  user_id: string | null;
  summary: string | null;
  message_count: number;
  sector: string | null;
  identification: string | null;
  contract: string | null;
  archived_at: string;
  original_created_at: string;
  original_closed_at: string | null;
}
