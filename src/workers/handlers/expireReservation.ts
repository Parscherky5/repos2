import { BackgroundJob, ExpireReservationPayload, OrderStatus } from '../../types';
import { stockService } from '../../services/StockService';
import { withTransaction } from '../../db';
import { logger } from '../../utils/logger';

export async function handleExpireReservation(job: BackgroundJob): Promise<void> {
  const { orderId } = job.payload as unknown as ExpireReservationPayload;

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    const order = (rows as any[])[0];

    if (!order) {
      logger.warn('Order not found during expiration check', { orderId });
      return;
    }

    // Only expire orders that are still in a cancellable state
    if (
      order.status !== OrderStatus.RESERVED &&
      order.status !== OrderStatus.PAYMENT_FAILED
    ) {
      logger.info('Order not in expirable state — skipping', {
        orderId,
        status: order.status,
      });
      return;
    }

    // Double-check the expiry timestamp
    if (new Date(order.expires_at) > new Date()) {
      logger.info('Order has not yet expired — skipping', {
        orderId,
        expiresAt: order.expires_at,
      });
      return;
    }

    await conn.execute(
      `UPDATE orders SET status = 'EXPIRED', updated_at = NOW() WHERE id = ?`,
      [orderId]
    );

    await stockService.releaseReservation(orderId, conn);

    await conn.execute(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
       VALUES ('system', 'ORDER_EXPIRED', 'order', ?, ?)`,
      [orderId, JSON.stringify({ expiredAt: new Date().toISOString() })]
    );

    logger.info('Order expired and stock released', { orderId });
  });
}
