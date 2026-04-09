
import { createHash } from 'node:crypto';
import { supabase } from '../db/index.js';

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

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, permissions, rate_limit_per_minute, rate_limit_per_day, is_active, expires_at, revoked_at')
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) {
    return { valid: false, error: 'API key inválida' };
  }

  const apiKey = data as unknown as ApiKey;

  if (!apiKey.is_active) {
    return { valid: false, error: 'API key desactivada' };
  }

  if (apiKey.revoked_at) {
    return { valid: false, error: 'API key revocada' };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, error: 'API key expirada' };
  }

  // Update last used info asynchronously
  supabase
    .from('api_keys')
    .update({ 
      last_used_at: new Date().toISOString(), 
      request_count: (apiKey.request_count || 0) + 1 
    })
    .eq('id', apiKey.id)
    .then();

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

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      name: params.name,
      key_hash: keyHash,
      key_prefix: prefix,
      description: params.description || null,
      created_by: params.createdBy || null,
      permissions: params.permissions || ['read', 'write'],
      rate_limit_per_minute: params.rateLimitPerMinute || 60,
      rate_limit_per_day: params.rateLimitPerDay || 10000,
      expires_at: params.expiresAt?.toISOString() || null
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Error creando API key: ${error.message}`);
  }

  return {
    key, 
    keyId: data.id,
    prefix,
  };
}
