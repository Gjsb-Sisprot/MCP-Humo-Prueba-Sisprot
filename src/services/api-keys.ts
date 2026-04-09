
import { createHash } from 'node:crypto';
import { sql } from '../db/index.js';

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit_per_minute: number;
  rate_limit_per_day: number;
  is_active: boolean;
  last_used_at: string | null;
  request_count: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyValidation {
  valid: boolean;
  keyId?: string;
  name?: string;
  permissions?: string[];
  error?: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function validateApiKey(key: string): Promise<ApiKeyValidation> {
  if (!key) {
    return { valid: false, error: 'API key requerida' };
  }

  const keyHash = hashApiKey(key);

  const results = await sql<ApiKey[]>`
    SELECT id, name, key_prefix, permissions, 
           rate_limit_per_minute, rate_limit_per_day,
           is_active, expires_at, revoked_at
    FROM api_keys
    WHERE key_hash = ${keyHash}
    LIMIT 1
  `;

  if (results.length === 0) {
    return { valid: false, error: 'API key inválida' };
  }

  const apiKey = results[0];

  if (!apiKey.is_active) {
    return { valid: false, error: 'API key desactivada' };
  }

  if (apiKey.revoked_at) {
    return { valid: false, error: 'API key revocada' };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, error: 'API key expirada' };
  }

  sql`
    UPDATE api_keys 
    SET last_used_at = NOW(), request_count = request_count + 1
    WHERE id = ${apiKey.id}
  `.catch(() => {});

  return {
    valid: true,
    keyId: apiKey.id,
    name: apiKey.name,
    permissions: apiKey.permissions,
  };
}

export async function createApiKey(params: {
  name: string;
  description?: string;
  createdBy?: string;
  permissions?: string[];
  rateLimitPerMinute?: number;
  rateLimitPerDay?: number;
  expiresAt?: Date;
}): Promise<{ key: string; keyId: string; prefix: string }> {
  
  const randomBytes = createHash('sha256')
    .update(crypto.randomUUID() + Date.now().toString())
    .digest('hex')
    .substring(0, 32);
  const key = `sk-sisprot-${randomBytes}`;
  const prefix = key.substring(0, 16);
  const keyHash = hashApiKey(key);

  const result = await sql<{ id: string }[]>`
    INSERT INTO api_keys (name, key_hash, key_prefix, description, created_by, 
                          permissions, rate_limit_per_minute, rate_limit_per_day, expires_at)
    VALUES (
      ${params.name},
      ${keyHash},
      ${prefix},
      ${params.description || null},
      ${params.createdBy || null},
      ${JSON.stringify(params.permissions || ['read', 'write'])}::jsonb,
      ${params.rateLimitPerMinute || 60},
      ${params.rateLimitPerDay || 10000},
      ${params.expiresAt?.toISOString() || null}
    )
    RETURNING id
  `;

  return {
    key, 
    keyId: result[0].id,
    prefix,
  };
}
