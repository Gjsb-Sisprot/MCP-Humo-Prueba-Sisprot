
import { z } from 'zod';
import { sql } from '../db/index.js';
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
  
  const result = await sql<SessionState[]>`
    INSERT INTO session_state (session_id, state_key, state_value, expires_at)
    VALUES (${sessionId}, ${key}, ${JSON.stringify(value)}, ${expiresAt})
    ON CONFLICT (session_id, state_key) 
    DO UPDATE SET 
      state_value = ${JSON.stringify(value)},
      expires_at = ${expiresAt},
      updated_at = NOW()
    RETURNING *
  `;
  
  return result[0];
}

export async function setMultipleSessionStates(input: SetMultipleStatesInput): Promise<number> {
  const { sessionId, states } = setMultipleStatesSchema.parse(input);
  
  if (states.length === 0) return 0;
  
  let count = 0;
  for (const state of states) {
    const expiresAt = state.expiresInMinutes 
      ? new Date(Date.now() + state.expiresInMinutes * 60 * 1000).toISOString()
      : null;
    
    await sql`
      INSERT INTO session_state (session_id, state_key, state_value, expires_at)
      VALUES (${sessionId}, ${state.key}, ${JSON.stringify(state.value)}, ${expiresAt})
      ON CONFLICT (session_id, state_key) 
      DO UPDATE SET 
        state_value = ${JSON.stringify(state.value)},
        expires_at = ${expiresAt},
        updated_at = NOW()
    `;
    count++;
  }
  
  return count;
}

export async function getSessionState(input: GetStateInput): Promise<unknown | null> {
  const { sessionId, key } = getStateSchema.parse(input);
  
  await cleanupExpiredStates();
  
  const result = await sql<SessionState[]>`
    SELECT * FROM session_state
    WHERE session_id = ${sessionId} AND state_key = ${key}
    LIMIT 1
  `;
  
  if (!result[0]) {
    return null;
  }
  
  return result[0].state_value;
}

export async function getSessionStateWithMeta(input: GetStateInput): Promise<StateWithMeta | null> {
  const { sessionId, key } = getStateSchema.parse(input);
  
  await cleanupExpiredStates();
  
  const result = await sql<(SessionState & { ttl_remaining: number | null })[]>`
    SELECT *,
      CASE 
        WHEN expires_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (expires_at - NOW()))::integer
        ELSE NULL 
      END as ttl_remaining
    FROM session_state
    WHERE session_id = ${sessionId} AND state_key = ${key}
    LIMIT 1
  `;
  
  if (!result[0]) {
    return null;
  }
  
  const row = result[0];
  return {
    value: row.state_value,
    key: row.state_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    ttlRemainingSeconds: row.ttl_remaining,
  };
}

export async function deleteSessionState(input: DeleteStateInput): Promise<boolean> {
  const { sessionId, key } = deleteStateSchema.parse(input);
  
  const result = await sql`
    DELETE FROM session_state
    WHERE session_id = ${sessionId} AND state_key = ${key}
  `;
  
  return result.count > 0;
}

export async function deleteSessionStatesByPattern(sessionId: string, keyPattern: string): Promise<number> {
  const result = await sql`
    DELETE FROM session_state
    WHERE session_id = ${sessionId} AND state_key LIKE ${keyPattern}
  `;
  
  return result.count;
}

export async function getAllSessionStates(sessionId: string): Promise<Record<string, unknown>> {
  await cleanupExpiredStates();
  
  const results = await sql<SessionState[]>`
    SELECT * FROM session_state
    WHERE session_id = ${sessionId}
    ORDER BY state_key
  `;
  
  const states: Record<string, unknown> = {};
  for (const row of results) {
    states[row.state_key] = row.state_value;
  }
  
  return states;
}

export async function getSessionStatesSummary(sessionId: string): Promise<SessionStatesSummary> {
  await cleanupExpiredStates();
  
  const results = await sql<(SessionState & { ttl_remaining: number | null })[]>`
    SELECT *,
      CASE 
        WHEN expires_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (expires_at - NOW()))::integer
        ELSE NULL 
      END as ttl_remaining
    FROM session_state
    WHERE session_id = ${sessionId}
    ORDER BY state_key
  `;
  
  const states: Record<string, unknown> = {};
  const statesWithMeta: StateWithMeta[] = [];
  
  for (const row of results) {
    states[row.state_key] = row.state_value;
    statesWithMeta.push({
      value: row.state_value,
      key: row.state_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      ttlRemainingSeconds: row.ttl_remaining,
    });
  }
  
  return {
    sessionId,
    totalStates: results.length,
    states,
    statesWithMeta,
  };
}

export async function clearSessionStates(sessionId: string): Promise<number> {
  const result = await sql`
    DELETE FROM session_state
    WHERE session_id = ${sessionId}
  `;
  
  return result.count;
}

export async function incrementSessionState(input: IncrementStateInput): Promise<number> {
  const { sessionId, key, delta, initialValue, expiresInMinutes } = incrementStateSchema.parse(input);
  
  const expiresAt = expiresInMinutes 
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
    : null;
  
  const result = await sql<{ new_value: number }[]>`
    INSERT INTO session_state (session_id, state_key, state_value, expires_at)
    VALUES (${sessionId}, ${key}, to_jsonb(${initialValue + delta}::numeric), ${expiresAt})
    ON CONFLICT (session_id, state_key) 
    DO UPDATE SET 
      state_value = to_jsonb(COALESCE((session_state.state_value #>> '{}')::numeric, ${initialValue}) + ${delta}),
      expires_at = COALESCE(${expiresAt}, session_state.expires_at),
      updated_at = NOW()
    RETURNING (state_value #>> '{}')::numeric as new_value
  `;
  
  const rawValue = result[0]?.new_value;
  return rawValue != null ? Number(rawValue) : initialValue + delta;
}

export async function extendStateTTL(sessionId: string, key: string, additionalMinutes: number): Promise<boolean> {
  const result = await sql`
    UPDATE session_state
    SET expires_at = CASE 
      WHEN expires_at IS NOT NULL 
      THEN expires_at + (${additionalMinutes} || ' minutes')::interval
      ELSE NOW() + (${additionalMinutes} || ' minutes')::interval
    END,
    updated_at = NOW()
    WHERE session_id = ${sessionId} AND state_key = ${key}
  `;
  
  return result.count > 0;
}

export async function stateExists(sessionId: string, key: string): Promise<boolean> {
  await cleanupExpiredStates();
  
  const result = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count FROM session_state
    WHERE session_id = ${sessionId} AND state_key = ${key}
  `;
  
  return parseInt(result[0]?.count ?? '0', 10) > 0;
}

export async function getStatesByPattern(sessionId: string, keyPattern: string): Promise<Record<string, unknown>> {
  await cleanupExpiredStates();
  
  const results = await sql<SessionState[]>`
    SELECT * FROM session_state
    WHERE session_id = ${sessionId} AND state_key LIKE ${keyPattern}
    ORDER BY state_key
  `;
  
  const states: Record<string, unknown> = {};
  for (const row of results) {
    states[row.state_key] = row.state_value;
  }
  
  return states;
}

export async function cleanupExpiredStates(): Promise<number> {
  const result = await sql`
    DELETE FROM session_state 
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
  `;
  
  return result.count;
}

export async function getSessionStateStats(): Promise<{
  totalStates: number;
  totalSessions: number;
  expiringSoon: number;
  permanent: number;
}> {
  const result = await sql<{
    total_states: string;
    total_sessions: string;
    expiring_soon: string;
    permanent: string;
  }[]>`
    SELECT 
      COUNT(*)::text as total_states,
      COUNT(DISTINCT session_id)::text as total_sessions,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW() + INTERVAL '1 hour')::text as expiring_soon,
      COUNT(*) FILTER (WHERE expires_at IS NULL)::text as permanent
    FROM session_state
    WHERE expires_at IS NULL OR expires_at > NOW()
  `;
  
  const row = result[0];
  return {
    totalStates: parseInt(row?.total_states ?? '0', 10),
    totalSessions: parseInt(row?.total_sessions ?? '0', 10),
    expiringSoon: parseInt(row?.expiring_soon ?? '0', 10),
    permanent: parseInt(row?.permanent ?? '0', 10),
  };
}
