import pg from 'pg';
import { config } from '../config.js';

export const pgPool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000
});

// Comprobar estado de PostgreSQL sin bloquear
export async function checkPostgresHealth(): Promise<boolean> {
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}
