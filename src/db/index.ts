
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

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  
  try {
    const { error } = await supabase.from('conversations').select('count', { count: 'exact', head: true }).limit(1);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error connecting to Supabase:', error);
    return false;
  }
}

export default supabase;
