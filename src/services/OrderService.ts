import pool, { withTransaction } from '../db';
import { Order, OrderStatus, Currency, JobType, ExpireReservationPayload, DeliverStockPayload } from '../types';
import { assertValidTransition } from '../utils/stateMachine';
import { stockService } from './StockService';
import { jobService } from './JobService';
import { walletService } from './WalletService';
import { currencyRateService } from './CurrencyRateService';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PoolConnection } from 'mysql2/promise';

export class OrderService {
  async createReservation(
    userId: string,
    productId: number,
    currency: Currency,
    region: 'TR' | 'EU'
  ): Promise<Order | null> {
    return withTransaction(async (conn) => {
      // 1. Aktif sipariş kontrolü
      const [activeRows] = await conn.execute(
        `SELECT id FROM orders
         WHERE user_id = ? AND status IN ('RESERVED','PENDING_VERIFICATION','PENDING_REVIEW','PAYMENT_FAILED')
         LIMIT 1
         FOR UPDATE`,
        [userId]
      );
      if ((activeRows as any[]).length > 0) {
        throw new Error('USER_HAS_ACTIVE_ORDER');
      }

      // 2. Ürün bilgisi
      const [productRows] = await conn.execute(
        'SELECT * FROM products WHERE id = ? AND is_active = 1',
        [productId]
      );
      const product = (productRows as any[])[0];
      if (!product) throw new Error('PRODUCT_NOT_FOUND');

      const priceSnapshot = BigInt(product.price_usd_cents);
      const expiresAt = new Date(
        Date.now() + config.app.reservationTimeoutSeconds * 1000
      );

      // 3. ✅ KUR SNAPSHOT — Rezervasyon anında kripto miktar hesapla ve kaydet
      //    Bu sayede "ödeme sırasında kur değişti" problemi ortadan kalkar
      const rateSnapshot = await currencyRateService.calculateCryptoAmount(
        priceSnapshot,
        currency
      );

      // 4. ✅ CÜZDAN ATAMA — En az kullanılan aktif cüzdanı seç
      const wallet = await walletService.assignWalletForOrder(
        currency,
        'pending', // gerçek order ID henüz yok, geçici
        conn
      );

      // 5. Order oluştur (tüm snapshot'larla birlikte)
      const [insertResult] = await conn.execute(
        `INSERT INTO orders
           (user_id, product_id, status, currency,
            required_amount, crypto_amount_snapshot, usd_rate_snapshot,
            deposit_address, wallet_id,
            expires_at, price_snapshot)
         VALUES (?, ?, 'INITIATED', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          productId,
          currency,
          priceSnapshot.toString(),
          rateSnapshot.cryptoAmountSmallest,   // ← snapshot
          rateSnapshot.usdPerCrypto,            // ← snapshot
          wallet.address,
          wallet.id,
          expiresAt.toISOString().slice(0, 19).replace('T', ' '),
          priceSnapshot.toString(),
        ]
      );
      const orderId = String((insertResult as any).insertId);

      // 6. Stok rezervasyonu — region ile
      const stockItem = await stockService.reserveItem(productId, orderId, conn, region);
      if (!stockItem) throw new Error('OUT_OF_STOCK');

      // 7. RESERVED durumuna geç — region'ı da kaydet
      await conn.execute(
        `UPDATE orders SET status = 'RESERVED', stock_item_id = ?, region = ? WHERE id = ?`,
        [stockItem.id, region, orderId]
      );

      // 8. Audit log
      await conn.execute(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
         VALUES (?, 'ORDER_RESERVED', 'order', ?, ?)`,
        [
          userId,
          orderId,
          JSON.stringify({
            productId,
            currency,
            region,
            stockItemId: stockItem.id,
            walletId: wallet.id,
            cryptoAmount: rateSnapshot.humanReadableAmount,
            usdRate: rateSnapshot.usdPerCrypto,
          }),
        ]
      );

      logger.info('Order reserved', {
        orderId, userId, productId, currency, region,
        cryptoAmount: rateSnapshot.humanReadableAmount,
        walletAddress: wallet.address,
      });

      const order = await this.getById(orderId, conn);

      setImmediate(async () => {
        await jobService.enqueue<ExpireReservationPayload>(
          JobType.EXPIRE_RESERVATION,
          { orderId },
          expiresAt,
          3,
          `expire:${orderId}` // ← dedup_key
        );
      });

      return order;
    });
  }

  async submitTxid(orderId: string, userId: string, txid: string): Promise<Order> {
    return withTransaction(async (conn) => {
      const [rows] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = (rows as any[])[0];
      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (String(order.user_id) !== String(userId)) throw new Error('ORDER_NOT_OWNED');
      assertValidTransition(orderId, order.status as OrderStatus, OrderStatus.PENDING_REVIEW);

      if (new Date(order.expires_at) < new Date()) {
        await conn.execute(`UPDATE orders SET status = 'EXPIRED' WHERE id = ?`, [orderId]);
        await stockService.releaseReservation(orderId, conn);
        throw new Error('ORDER_EXPIRED');
      }

      const normalizedTxid = txid.trim().toLowerCase();
      const [dupRows] = await conn.execute(`SELECT id, order_id FROM txid_log WHERE txid = ?`, [normalizedTxid]);
      if ((dupRows as any[]).length > 0) throw new Error('TXID_ALREADY_USED');

      await conn.execute(`INSERT INTO txid_log (txid, order_id, currency, submitted_by) VALUES (?, ?, ?, ?)`, [normalizedTxid, orderId, order.currency, userId]);
      await conn.execute(
        `UPDATE orders SET status = 'PENDING_REVIEW', txid = ?, txid_submitted_at = NOW() WHERE id = ?`,
        [normalizedTxid, orderId]
      );
      await conn.execute(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value) VALUES (?, 'TXID_SUBMITTED', 'order', ?, ?)`,
        [userId, orderId, JSON.stringify({ txid: normalizedTxid })]
      );

      logger.info('TXID submitted', { orderId, userId, txid: normalizedTxid });

      return this.getById(orderId, conn);
    });
  }

  async getById(orderId: string, conn?: PoolConnection): Promise<Order> {
    const execute = conn ? conn.execute.bind(conn) : pool.execute.bind(pool);
    const [rows] = await execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    const row = (rows as any[])[0];
    if (!row) throw new Error(`Order not found: ${orderId}`);
    return this.mapRow(row);
  }

  async getUserActiveOrder(userId: string): Promise<Order | null> {
    const [rows] = await pool.execute(
      `SELECT * FROM orders WHERE user_id = ? AND status IN ('RESERVED','PENDING_REVIEW','PENDING_VERIFICATION','PAYMENT_FAILED') LIMIT 1`,
      [userId]
    );
    const row = (rows as any[])[0];
    return row ? this.mapRow(row) : null;
  }

  async cancelOrder(orderId: string, userId: string): Promise<void> {
    await withTransaction(async (conn) => {
      const [rows] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = (rows as any[])[0];
      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (String(order.user_id) !== String(userId)) throw new Error('ORDER_NOT_OWNED');
      if (!['RESERVED', 'PAYMENT_FAILED'].includes(order.status)) throw new Error('CANNOT_CANCEL');
      await conn.execute(`UPDATE orders SET status = 'USER_CANCELLED' WHERE id = ?`, [orderId]);
      await stockService.releaseReservation(orderId, conn);
      await conn.execute(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value) VALUES (?, 'USER_CANCELLED_ORDER', 'order', ?, ?)`,
        [userId, orderId, JSON.stringify({ status: 'USER_CANCELLED' })]
      );
    });
  }

  private mapRow(row: any): Order {
    return {
      id: String(row.id), userId: String(row.user_id), productId: row.product_id,
      stockItemId: row.stock_item_id ? String(row.stock_item_id) : null,
      status: row.status as OrderStatus, currency: row.currency as Currency,
      region: row.region ?? null,
      requiredAmount: String(row.required_amount),
      cryptoAmountSnapshot: row.crypto_amount_snapshot ?? null,
      usdRateSnapshot: row.usd_rate_snapshot ?? null,
      depositAddress: row.deposit_address, walletId: row.wallet_id ?? null,
      txid: row.txid ?? null,
      txidSubmittedAt: row.txid_submitted_at ? new Date(row.txid_submitted_at) : null,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
      expiresAt: new Date(row.expires_at),
      failureReason: row.failure_reason ?? null,
      priceSnapshot: String(row.price_snapshot), createdAt: new Date(row.created_at),
    };
  }
}

export const orderService = new OrderService();