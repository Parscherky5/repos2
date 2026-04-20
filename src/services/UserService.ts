import pool from '../db';
import { User } from '../types';
import { logger } from '../utils/logger';

export class UserService {
  async getOrCreate(
    userId: string,
    username: string | null,
    firstName: string
  ): Promise<User> {
    await pool.execute(
      `INSERT INTO users (id, username, first_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username   = VALUES(username),
         first_name = VALUES(first_name)`,
      [userId, username ?? null, firstName]
    );
    const user = await this.getById(userId);
    if (!user) throw new Error(`Failed to get/create user: ${userId}`);
    return user;
  }

  async getById(userId: string): Promise<User | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    const row = (rows as any[])[0];
    return row ? this.mapRow(row) : null;
  }

  async isBanned(userId: string): Promise<boolean> {
    const [rows] = await pool.execute(
      'SELECT is_banned FROM users WHERE id = ?',
      [userId]
    );
    const row = (rows as any[])[0];
    return row ? Boolean(row.is_banned) : false;
  }

  async ban(userId: string): Promise<void> {
    await pool.execute('UPDATE users SET is_banned = 1 WHERE id = ?', [userId]);
    logger.info('User banned', { userId });
  }

  async unban(userId: string): Promise<void> {
    await pool.execute('UPDATE users SET is_banned = 0 WHERE id = ?', [userId]);
    logger.info('User unbanned', { userId });
  }

  async addBalance(userId: string, amountCents: bigint): Promise<void> {
    await pool.execute(
      'UPDATE users SET balance_usd_cents = balance_usd_cents + ? WHERE id = ?',
      [amountCents.toString(), userId]
    );
  }

  async list(limit = 50, offset = 0): Promise<User[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return (rows as any[]).map((r) => this.mapRow(r));
  }

  private mapRow(row: any): User {
    return {
      id: String(row.id),
      username: row.username ?? null,
      firstName: row.first_name,
      balanceUsdCents: String(row.balance_usd_cents),
      isBanned: Boolean(row.is_banned),
      createdAt: new Date(row.created_at),
    };
  }
}

export const userService = new UserService();
