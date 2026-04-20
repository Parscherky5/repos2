import { BackgroundJob, DeliverStockPayload, OrderStatus } from '../../types';
import { orderService } from '../../services/OrderService';
import { stockService } from '../../services/StockService';
import { withTransaction } from '../../db';
import { logger } from '../../utils/logger';
import { bot } from '../../bot';

export async function handleDeliverStock(job: BackgroundJob): Promise<void> {
  const { orderId, userId } = job.payload as unknown as DeliverStockPayload;

  const order = await orderService.getById(orderId);
  if (order.status !== OrderStatus.PAYMENT_CONFIRMED) {
    logger.info('Order not in PAYMENT_CONFIRMED state — skipping delivery', {
      orderId,
      status: order.status,
    });
    return;
  }

  let stockContent: string | null = null;

  await withTransaction(async (conn) => {
    const soldItem = await stockService.markSold(orderId, conn);
    if (!soldItem) {
      throw new Error(`STOCK_ITEM_NOT_FOUND:${orderId}`);
    }

    stockContent = soldItem.content;

    await conn.execute(
      `UPDATE orders
       SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [orderId]
    );

    await conn.execute(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
       VALUES ('system', 'ORDER_COMPLETED', 'order', ?, ?)`,
      [orderId, JSON.stringify({ stockItemId: soldItem.id, userId })]
    );

    logger.info('Order completed', { orderId, userId, stockItemId: soldItem.id });
  });

  // Deliver product content to the user via Telegram (outside the transaction)
  if (stockContent) {
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ Your order <b>#${orderId}</b> has been completed!\n\n` +
          `Here is your product:\n\n` +
          `<code>${escapeHtml(stockContent)}</code>`,
        { parse_mode: 'HTML' }
      );
      logger.info('Delivery message sent', { orderId, userId });
    } catch (err) {
      // Telegram delivery failure must not fail the job — the order is already COMPLETED
      logger.error('Failed to send delivery message to user', {
        orderId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
