
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
}

export const sql = postgres(DATABASE_URL || '', {
  ssl: { rejectUnauthorized: false },
  max: 20,               
  idle_timeout: 60,       
  connect_timeout: 10,    
  prepare: true,          
  fetch_types: false,     
  onnotice: () => {},     
});

sql`SET hnsw.ef_search = 40`.catch(() => {
  
});

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!DATABASE_URL) {
    return false;
  }
  
  try {
    await sql`SELECT 1 as connected`;
    return true;
  } catch (error) {
    return false;
  }
}

export default sql;
