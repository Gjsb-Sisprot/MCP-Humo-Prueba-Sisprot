
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️ SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados. Las funciones de DB podrían fallar.');
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

export async function checkDatabaseConnection(): Promise<{ connected: boolean; error?: string; missingVars?: string[] }> {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY/ANON_KEY');
  
  if (missing.length > 0) {
    return { connected: false, missingVars: missing };
  }
  
  try {
    // Intentamos una consulta simple que no dependa de políticas RLS complejas si usamos service_role
    const { error, data } = await supabase.from('conversations').select('id').limit(1);
    
    if (error) {
      return { connected: false, error: `${error.code}: ${error.message}` };
    }
    
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default supabase;
