
import { z } from 'zod';
import { supabase } from '../db/index.js';
import type { SessionState } from '../db/types.js';

export const TTL_PRESETS = {
  QUICK: 5,
  WORKFLOW: 30,
  SESSION: 60,
  WORKDAY: 480,
  ESCALATION: 1440,
  PERMANENT: null,
} as const;

export const STATE_KEYS = {
  WORKFLOW_STEP: 'workflow:current_step',
  WORKFLOW_DATA: 'workflow:data',
  WORKFLOW_STARTED_AT: 'workflow:started_at',
  CLIENT_ID: 'client:id',
  CLIENT_CONTRACT: 'client:contract',
  CLIENT_NAME: 'client:name',
  CLIENT_VERIFIED: 'client:verified',
  ESCALATION_REASON: 'escalation:reason',
  ESCALATION_PRIORITY: 'escalation:priority',
  ESCALATION_CONTEXT: 'escalation:context',
  AWAITING_CONFIRMATION: 'flag:awaiting_confirmation',
  RETRY_COUNT: 'flag:retry_count',
  LAST_ERROR: 'flag:last_error',
  CACHED_ONU_DATA: 'cache:onu_data',
  CACHED_CLIENT_DATA: 'cache:client_data',
} as const;

export const setStateSchema = z.object({
  sessionId: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
  expiresInMinutes: z.number().min(1).nullable().optional(),
});

export const getStateSchema = z.object({
  sessionId: z.string().min(1),
  key: z.string().min(1),
});

export const deleteStateSchema = z.object({
  sessionId: z.string().min(1),
  key: z.string().min(1),
});

export const setMultipleStatesSchema = z.object({
  sessionId: z.string().min(1),
  states: z.array(z.object({
    key: z.string().min(1),
    value: z.unknown(),
    expiresInMinutes: z.number().min(1).nullable().optional(),
  })),
});

export const incrementStateSchema = z.object({
  sessionId: z.string().min(1),
  key: z.string().min(1),
  delta: z.number().default(1),
  initialValue: z.number().default(0),
  expiresInMinutes: z.number().min(1).nullable().optional(),
});

export type SetStateInput = z.infer<typeof setStateSchema>;
export type GetStateInput = z.infer<typeof getStateSchema>;
export type DeleteStateInput = z.infer<typeof deleteStateSchema>;
export type SetMultipleStatesInput = z.infer<typeof setMultipleStatesSchema>;
export type IncrementStateInput = z.infer<typeof incrementStateSchema>;

export interface StateWithMeta {
  value: unknown;
  key: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  ttlRemainingSeconds: number | null;
}

export interface SessionStatesSummary {
  sessionId: string;
  totalStates: number;
  states: Record<string, unknown>;
  statesWithMeta: StateWithMeta[];
}

export async function setSessionState(input: SetStateInput): Promise<SessionState> {
  const { sessionId, key, value, expiresInMinutes } = setStateSchema.parse(input);
  
  const expiresAt = expiresInMinutes 
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
    : null;
  
  const { data, error } = await supabase
    .from('session_state')
    .upsert({
      session_id: sessionId,
      state_key: key,
      state_value: value,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'session_id,state_key'
    })
    .select()
    .single();

  if (error) throw error;
  return data as unknown as SessionState;
}

export async function setMultipleSessionStates(input: SetMultipleStatesInput): Promise<number> {
  const { sessionId, states } = setMultipleStatesSchema.parse(input);
  
  if (states.length === 0) return 0;
  
  const rows = states.map(state => ({
    session_id: sessionId,
    state_key: state.key,
    state_value: state.value,
    expires_at: state.expiresInMinutes 
      ? new Date(Date.now() + state.expiresInMinutes * 60 * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('session_state')
    .upsert(rows, { onConflict: 'session_id,state_key' });
  
  if (error) throw error;
  return states.length;
}

export async function getSessionState(input: GetStateInput): Promise<unknown | null> {
  const { sessionId, key } = getStateSchema.parse(input);
  
  await cleanupExpiredStates();
  
  const { data, error } = await supabase
    .from('session_state')
    .select('state_value')
    .eq('session_id', sessionId)
    .eq('state_key', key)
    .maybeSingle();
  
  if (error) return null;
  return data?.state_value ?? null;
}

export async function getSessionStateWithMeta(input: GetStateInput): Promise<StateWithMeta | null> {
  const { sessionId, key } = getStateSchema.parse(input);
  
  await cleanupExpiredStates();
  
  const { data, error } = await supabase
    .from('session_state')
    .select('*')
    .eq('session_id', sessionId)
    .eq('state_key', key)
    .maybeSingle();

  if (error || !data) return null;

  const row = data;
  let ttlRemaining = null;
  if (row.expires_at) {
    ttlRemaining = Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
  }

  return {
    value: row.state_value,
    key: row.state_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    ttlRemainingSeconds: ttlRemaining,
  };
}

export async function deleteSessionState(input: DeleteStateInput): Promise<boolean> {
  const { sessionId, key } = deleteStateSchema.parse(input);
  
  const { error, count } = await supabase
    .from('session_state')
    .delete({ count: 'exact' })
    .eq('session_id', sessionId)
    .eq('state_key', key);
  
  if (error) throw error;
  return (count || 0) > 0;
}

export async function deleteSessionStatesByPattern(sessionId: string, keyPattern: string): Promise<number> {
  // Translate SQL LIKE to Supabase filter
  const filterPattern = keyPattern.replace(/%/g, '*');
  
  const { error, count } = await supabase
    .from('session_state')
    .delete({ count: 'exact' })
    .eq('session_id', sessionId)
    .like('state_key', filterPattern);
  
  if (error) throw error;
  return count || 0;
}

export async function getAllSessionStates(sessionId: string): Promise<Record<string, unknown>> {
  await cleanupExpiredStates();
  
  const { data, error } = await supabase
    .from('session_state')
    .select('state_key, state_value')
    .eq('session_id', sessionId)
    .order('state_key');
  
  if (error) throw error;
  
  const states: Record<string, unknown> = {};
  for (const row of data || []) {
    states[row.state_key] = row.state_value;
  }
  
  return states;
}

export async function getSessionStatesSummary(sessionId: string): Promise<SessionStatesSummary> {
  await cleanupExpiredStates();
  
  const { data, error } = await supabase
    .from('session_state')
    .select('*')
    .eq('session_id', sessionId)
    .order('state_key');

  if (error) throw error;
  
  const states: Record<string, unknown> = {};
  const statesWithMeta: StateWithMeta[] = [];
  
  for (const row of data || []) {
    states[row.state_key] = row.state_value;
    
    let ttlRemaining = null;
    if (row.expires_at) {
      ttlRemaining = Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
    }

    statesWithMeta.push({
      value: row.state_value,
      key: row.state_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      ttlRemainingSeconds: ttlRemaining,
    });
  }
  
  return {
    sessionId,
    totalStates: (data || []).length,
    states,
    statesWithMeta,
  };
}

export async function clearSessionStates(sessionId: string): Promise<number> {
  const { error, count } = await supabase
    .from('session_state')
    .delete({ count: 'exact' })
    .eq('session_id', sessionId);
  
  if (error) throw error;
  return count || 0;
}

export async function incrementSessionState(input: IncrementStateInput): Promise<number> {
  const { sessionId, key, delta, initialValue, expiresInMinutes } = incrementStateSchema.parse(input);
  
  const { data: current, error: getError } = await supabase
    .from('session_state')
    .select('state_value')
    .eq('session_id', sessionId)
    .eq('state_key', key)
    .maybeSingle();

  if (getError) throw getError;

  const currentValue = current ? Number(current.state_value) : initialValue;
  const newValue = currentValue + delta;
  
  const expiresAt = expiresInMinutes 
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
    : null;

  const { error: upsertError } = await supabase
    .from('session_state')
    .upsert({
      session_id: sessionId,
      state_key: key,
      state_value: newValue,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'session_id,state_key'
    });

  if (upsertError) throw upsertError;
  return newValue;
}

export async function extendStateTTL(sessionId: string, key: string, additionalMinutes: number): Promise<boolean> {
  const { data, error: getError } = await supabase
    .from('session_state')
    .select('expires_at')
    .eq('session_id', sessionId)
    .eq('state_key', key)
    .maybeSingle();

  if (getError || !data) return false;

  const currentExpires = data.expires_at ? new Date(data.expires_at) : new Date();
  const newExpires = new Date(currentExpires.getTime() + additionalMinutes * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from('session_state')
    .update({ expires_at: newExpires, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('state_key', key);
  
  if (updateError) throw updateError;
  return true;
}

export async function stateExists(sessionId: string, key: string): Promise<boolean> {
  await cleanupExpiredStates();
  
  const { count, error } = await supabase
    .from('session_state')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('state_key', key);
  
  if (error) return false;
  return (count || 0) > 0;
}

export async function getStatesByPattern(sessionId: string, keyPattern: string): Promise<Record<string, unknown>> {
  await cleanupExpiredStates();
  const filterPattern = keyPattern.replace(/%/g, '*');

  const { data, error } = await supabase
    .from('session_state')
    .select('state_key, state_value')
    .eq('session_id', sessionId)
    .like('state_key', filterPattern)
    .order('state_key');
  
  if (error) throw error;
  
  const states: Record<string, unknown> = {};
  for (const row of data || []) {
    states[row.state_key] = row.state_value;
  }
  
  return states;
}

export async function cleanupExpiredStates(): Promise<number> {
  const { error, count } = await supabase
    .from('session_state')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());
  
  if (error) {
    console.error('Error cleaning up expired states:', error);
    return 0;
  }
  return count || 0;
}

export async function getSessionStateStats(): Promise<{
  totalStates: number;
  totalSessions: number;
  expiringSoon: number;
  permanent: number;
}> {
  const { data, error } = await supabase
    .from('session_state')
    .select('*');

  if (error) throw error;

  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

  const totalStates = data.length;
  const sessions = new Set(data.map(d => d.session_id));
  const expiringSoon = data.filter(d => d.expires_at && new Date(d.expires_at) < soon).length;
  const permanent = data.filter(d => !d.expires_at).length;

  return {
    totalStates,
    totalSessions: sessions.size,
    expiringSoon,
    permanent
  };
}
