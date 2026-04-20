import { Telegraf } from 'telegraf';
import { config } from '../config';
import { logger } from '../utils/logger';

import {
  userRegistrationMiddleware,
  bannedUserMiddleware,
  rateLimitMiddleware,
} from './middleware';

import {
  handleStart,
  handleProducts,
  handleProductSelect,
  handleRegionSelect,
  handleOrderInit,
  handleBackToProducts,
  handleProfile,
  handleTextMessage,
  handleCancelOrder,
} from './handlers/user';

import {
  handleAdminDashboard,
  handleAdminPendingReviews,
  handleAdminApprovePayment,
  handleAdminRejectPayment,
  handleAdminListProducts,
  handleAdminEmergencyStop,
} from './handlers/admin';

export const bot = new Telegraf(config.bot.token);

// ── Middleware ─────────────────────────────────────────────────────────────────
bot.use(userRegistrationMiddleware());
bot.use(rateLimitMiddleware());
bot.use(bannedUserMiddleware());

// ── User commands ──────────────────────────────────────────────────────────────
bot.command('start',       (ctx) => handleStart(ctx));
bot.command('products',    (ctx) => handleProducts(ctx));
bot.command('orders',      (ctx) => handleProfile(ctx));
bot.command('cancel',      (ctx) => handleCancelOrder(ctx));

bot.hears('🛒 Ürünler', (ctx) => handleProducts(ctx));
bot.hears('👤 Profilim', (ctx) => handleProfile(ctx));
bot.hears('🎧 Destek', (ctx) => ctx.reply('🎧 Destek için lütfen mesajınızı yazın ve gönderin. Admin ekibimiz en kısa sürede size ulaşacaktır.'));
bot.hears('🔐 Admin', (ctx) => handleAdminDashboard(ctx));

// ── Admin commands ─────────────────────────────────────────────────────────────
bot.command('admin',       (ctx) => handleAdminDashboard(ctx));

// ── Inline-keyboard callbacks — user flow ─────────────────────────────────────
bot.action(/^product:(\d+)$/,           (ctx) => handleProductSelect(ctx));
bot.action(/^region:(\d+):(.+)$/,       (ctx) => handleRegionSelect(ctx));
bot.action(/^order_init:(\d+):(.+):(.+)$/, (ctx) => handleOrderInit(ctx));
bot.action('back_to_products',          (ctx) => handleBackToProducts(ctx));
bot.action('cancel_order',              (ctx) => handleCancelOrder(ctx));

// ── Inline-keyboard callbacks — admin dashboard ─────────────────────────────
bot.action('admin_dashboard',           (ctx) => handleAdminDashboard(ctx));
bot.action('admin_toggle_emergency',    async (ctx) => {
  await handleAdminEmergencyStop(ctx);
  await handleAdminDashboard(ctx);
});
bot.action('admin_pending_list',        (ctx) => handleAdminPendingReviews(ctx));
bot.action('admin_products_list',       (ctx) => handleAdminListProducts(ctx));
bot.action('admin_add_stock_info',      (ctx) => ctx.reply('📥 Stok eklemek için `/addstock <ID> <Bölge> <Açıklama>` komutunu kullanın.\n\nFotoğraflı stok eklemek için lütfen bizzat dosyaları hazırlayın veya admin panelinden geliştirme isteyin.'));
bot.action('admin_users_list',          (ctx) => ctx.reply('👥 Kullanıcı yönetimi için `/ban <ID>` veya `/unban <ID>` komutlarını kullanabilirsiniz.'));
bot.action('admin_back_to_user',        (ctx) => ctx.editMessageText('👋 Kullanıcı moduna dönüldü. /start yazarak menüyü görebilirsiniz.'));

// ── Inline-keyboard callbacks — admin manual payment review ───────────────────
bot.action(/^admin_approve:(.+)$/,      (ctx) => handleAdminApprovePayment(ctx));
bot.action(/^admin_reject:(.+)$/,       (ctx) => handleAdminRejectPayment(ctx));

// ── Global Text Handler ───────────────────────────────────────────────────────
bot.on('text', (ctx) => handleTextMessage(ctx));

// ── Global error handler ───────────────────────────────────────────────────────
bot.catch((err: unknown) => {
  logger.error('Telegraf unhandled error', {
    error: err instanceof Error ? err.message : String(err),
  });
});

export async function launchBot(): Promise<void> {
  // Clear Webhook before polling as per instructions
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  await bot.launch();
  logger.info('Telegram bot launched (Polling mode)');
}
