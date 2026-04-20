import {
  BackgroundJob,
  VerifyPaymentPayload,
  OrderStatus,
  Currency,
  JobType,
  DeliverStockPayload,
} from '../../types';
import { paymentService } from '../../services/PaymentService';
import { orderService } from '../../services/OrderService';
import { jobService } from '../../services/JobService';
import { config } from '../../config';
import pool from '../../db';
import { logger } from '../../utils/logger';
import { bot } from '../../bot';

/**
 * Currencies that require manual admin verification instead of automatic
 * on-chain checks.  ETH and BNB on-chain APIs are prone to rate-limiting and
 * explorer quirks — a human double-check is the safest option here.
 */
const MANUAL_REVIEW_CURRENCIES: Currency[] = [Currency.ETH, Currency.BNB];

export async function handleVerifyPayment(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as VerifyPaymentPayload;
  const { orderId, txid, currency, requiredAmount, depositAddress } = payload;

  // Fetch current order state
  const order = await orderService.getById(orderId);

  // Skip if order has moved to a final or irrelevant state
  if (
    order.status !== OrderStatus.PENDING_VERIFICATION &&
    order.status !== OrderStatus.PAYMENT_FAILED
  ) {
    logger.info('Skipping verification — order no longer awaiting payment', {
      orderId,
      status: order.status,
    });
    return;
  }

  // ── Manual admin review for ETH / BNB ────────────────────────────────────
  if (MANUAL_REVIEW_CURRENCIES.includes(currency as Currency)) {
    await notifyAdminsForManualReview(orderId, txid, currency, requiredAmount, depositAddress);
    // Job finishes normally; the order stays in PENDING_VERIFICATION until
    // an admin taps Approve or Reject in the Telegram notification.
    return;
  }

  // ── Automatic on-chain verification for other currencies ─────────────────
  logger.info('Verifying on-chain payment', { orderId, txid, currency });
  const result = await paymentService.verifyTransaction(
    txid,
    currency,
    requiredAmount,
    depositAddress
  );
  logger.info('Verification result', { orderId, ...result });

  if (!result.confirmed) {
    // Transaction exists but not yet confirmed — throw so the job is retried
    throw new Error(`NOT_CONFIRMED_YET: ${result.failureReason ?? 'pending confirmation'}`);
  }

  if (!result.success) {
    // Transaction confirmed but payment invalid (wrong address, short amount, etc.)
    await pool.execute(
      `UPDATE orders
       SET status = 'PAYMENT_FAILED', failure_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [(result.failureReason ?? 'Payment verification failed').slice(0, 500), orderId]
    );
    await pool.execute(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
       VALUES ('system', 'PAYMENT_FAILED', 'order', ?, ?)`,
      [orderId, JSON.stringify({ txid, reason: result.failureReason })]
    );
    logger.warn('Payment verification failed', { orderId, reason: result.failureReason });
    return;
  }

  // Payment is confirmed and valid
  await pool.execute(
    `UPDATE orders
     SET status = 'PAYMENT_CONFIRMED', confirmed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [orderId]
  );
  await pool.execute(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
     VALUES ('system', 'PAYMENT_CONFIRMED', 'order', ?, ?)`,
    [orderId, JSON.stringify({ txid, actualAmount: result.actualAmount })]
  );
  logger.info('Payment confirmed', { orderId, txid, actualAmount: result.actualAmount });

  // Enqueue stock delivery
  const freshOrder = await orderService.getById(orderId);
  await jobService.enqueue<DeliverStockPayload>(
    JobType.DELIVER_STOCK,
    { orderId, userId: freshOrder.userId },
    new Date(),
    3,
    `deliver:${orderId}`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Broadcast a manual-review request to every admin with Approve / Reject
 * inline buttons.  Failures are logged but do not throw — the job must
 * still complete so it is not retried and admins are not spammed.
 */
async function notifyAdminsForManualReview(
  orderId: string,
  txid: string,
  currency: string,
  requiredAmount: string,
  depositAddress: string
): Promise<void> {
  const message =
    `🔍 *Manual Payment Review Required*\n\n` +
    `Order ID: \`${orderId}\`\n` +
    `Currency: *${currency}*\n` +
    `Required amount: \`${requiredAmount}\` (smallest unit)\n` +
    `Deposit address: \`${depositAddress}\`\n` +
    `TXID: \`${txid}\`\n\n` +
    `Please verify the transaction on the blockchain explorer and approve or reject below.`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `admin_approve:${orderId}` },
        { text: '❌ Reject',  callback_data: `admin_reject:${orderId}` },
      ],
    ],
  };

  for (const adminId of config.bot.adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      logger.info('Manual review notification sent', { adminId, orderId });
    } catch (err) {
      logger.error('Failed to notify admin for manual review', {
        adminId,
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
