import { PoolConnection } from 'mysql2/promise';
import pool from '../db';
import { StockItem, StockItemStatus } from '../types';
import { logger } from '../utils/logger';

export class StockService {
  /**
   * Reserve the first available stock item for the given product.
   * Uses FOR UPDATE SKIP LOCKED to prevent race conditions.
   * Returns null if no stock is available.
   */
  async reserveItem(
    productId: number,
    orderId: string,
    conn: PoolConnection,
    region: 'TR' | 'EU'
  ): Promise<StockItem | null> {
    const [rows] = await conn.execute(
      `SELECT * FROM stock_items
       WHERE product_id = ? AND region = ? AND status = 'AVAILABLE'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [productId, region]
    );
    const row = (rows as any[])[0];
    if (!row) return null;

    await conn.execute(
      `UPDATE stock_items
       SET status = 'RESERVED', reserved_by_order = ?, reserved_at = NOW()
       WHERE id = ?`,
      [orderId, row.id]
    );

    return this.mapRow({
      ...row,
      status: StockItemStatus.RESERVED,
      reserved_by_order: orderId,
      reserved_at: new Date(),
    });
  }

  /**
   * Release a stock item reservation (e.g. when order expires or is cancelled).
   */
  async releaseReservation(orderId: string, conn: PoolConnection): Promise<void> {
    await conn.execute(
      `UPDATE stock_items
       SET status = 'AVAILABLE', reserved_by_order = NULL, reserved_at = NULL
       WHERE reserved_by_order = ? AND status = 'RESERVED'`,
      [orderId]
    );
    logger.debug('Stock reservation released', { orderId });
  }

  /**
   * Mark a reserved stock item as SOLD (called when payment is confirmed and delivered).
   */
  async markSold(orderId: string, conn: PoolConnection): Promise<StockItem | null> {
    await conn.execute(
      `UPDATE stock_items
       SET status = 'SOLD', sold_at = NOW()
       WHERE reserved_by_order = ? AND status = 'RESERVED'`,
      [orderId]
    );
    const [rows] = await conn.execute(
      `SELECT * FROM stock_items WHERE reserved_by_order = ? LIMIT 1`,
      [orderId]
    );
    const row = (rows as any[])[0];
    return row ? this.mapRow(row) : null;
  }

  /** Count available items for a product. */
  async getAvailableCount(productId: number): Promise<number> {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM stock_items
       WHERE product_id = ? AND status = 'AVAILABLE'`,
      [productId]
    );
    return Number((rows as any[])[0].cnt);
  }

  /** Retrieve the content of a sold stock item linked to an order. */
  async getContentForOrder(orderId: string): Promise<string | null> {
    const [rows] = await pool.execute(
      `SELECT content FROM stock_items WHERE reserved_by_order = ? LIMIT 1`,
      [orderId]
    );
    return (rows as any[])[0]?.content ?? null;
  }

  /** Bulk-insert new stock items for a product. */
  async addItems(productId: number, contents: string[], region: 'TR' | 'EU', images?: string[]): Promise<number> {
    if (contents.length === 0) return 0;
    const placeholders = contents.map(() => '(?, ?, ?, ?)').join(', ');
    const imagesJson = images && images.length > 0 ? JSON.stringify(images) : null;
    const values = contents.flatMap((c) => [productId, c, region, imagesJson]);
    await pool.execute(
      `INSERT INTO stock_items (product_id, content, region, images) VALUES ${placeholders}`,
      values
    );
    logger.info('Stock items added', { productId, region, count: contents.length });
    return contents.length;
  }

  private mapRow(row: any): StockItem {
    return {
      id: String(row.id),
      productId: row.product_id,
      content: row.content,
      status: row.status as StockItemStatus,
      reservedByOrder: row.reserved_by_order ? String(row.reserved_by_order) : null,
      reservedAt: row.reserved_at ? new Date(row.reserved_at) : null,
      soldAt: row.sold_at ? new Date(row.sold_at) : null,
    };
  }
}

export const stockService = new StockService();
