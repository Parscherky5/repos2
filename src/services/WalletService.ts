import { PoolConnection } from 'mysql2/promise';
import pool from '../db';
import { Currency } from '../types';
import { logger } from '../utils/logger';

export interface Wallet {
  id: number;
  currency: Currency;
  address: string;
  isActive: boolean;
  label: string | null;
  createdAt: Date;
}

export class WalletService {
  /**
   * Pick the least-loaded active wallet for the given currency.
   * "Least-loaded" = fewest open/pending orders currently using it.
   */
  async assignWalletForOrder(
    currency: Currency,
    _orderId: string,
    conn: PoolConnection
  ): Promise<{ id: number; address: string }> {
    const [rows] = await conn.execute(
      `SELECT w.id, w.address
       FROM wallets w
       LEFT JOIN orders o
         ON o.wallet_id = w.id
         AND o.status IN ('RESERVED','PENDING_VERIFICATION','PAYMENT_FAILED')
       WHERE w.currency = ? AND w.is_active = 1
       GROUP BY w.id, w.address
       ORDER BY COUNT(o.id) ASC, w.id ASC
       LIMIT 1`,
      [currency]
    );
    const wallet = (rows as any[])[0];
    if (!wallet) throw new Error(`NO_WALLET_AVAILABLE:${currency}`);
    logger.debug('Wallet assigned', { walletId: wallet.id, currency });
    return { id: Number(wallet.id), address: String(wallet.address) };
  }

  async getAll(): Promise<Wallet[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM wallets ORDER BY currency, id'
    );
    return (rows as any[]).map((r) => this.mapRow(r));
  }

  async getByCurrency(currency: Currency): Promise<Wallet[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM wallets WHERE currency = ? AND is_active = 1 ORDER BY id',
      [currency]
    );
    return (rows as any[]).map((r) => this.mapRow(r));
  }

  async setActive(walletId: number, active: boolean): Promise<void> {
    await pool.execute(
      'UPDATE wallets SET is_active = ? WHERE id = ?',
      [active ? 1 : 0, walletId]
    );
  }

  private mapRow(row: any): Wallet {
    return {
      id: Number(row.id),
      currency: row.currency as Currency,
      address: String(row.address),
      isActive: Boolean(row.is_active),
      label: row.label ?? null,
      createdAt: new Date(row.created_at),
    };
  }
}

export const walletService = new WalletService();
