import mysql from 'mysql2/promise';
import { config } from '../config';
import { logger } from '../utils/logger';

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00',
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
});

/**
 * Transaction wrapper — READ COMMITTED + FOR UPDATE kullanıyoruz.
 *
 * NEDEN SERIALIZABLE DEĞİL:
 *   - Stok seçimi: tek satır FOR UPDATE SKIP LOCKED → phantom read yok
 *   - TXID insert: UNIQUE constraint DB seviyesinde guard → phantom read yok
 *   - SERIALIZABLE'ın deadlock riski bu use case'de gereksiz yük yaratır
 *
 * NEDEN READ COMMITTED:
 *   - FOR UPDATE ile kritik satırları zaten kilitliyoruz
 *   - MySQL default'u (REPEATABLE READ) ile de çalışır ama
 *     READ COMMITTED daha açık ve anlaşılır niyeti gösterir
 */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();

  await conn.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await conn.beginTransaction();

  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export { pool };
export default pool;
