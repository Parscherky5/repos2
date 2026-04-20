import { Telegraf } from 'telegraf';
import { config } from '../config';
import { logger } from '../utils/logger';

import {
  userRegistrationMiddleware,
  bannedUserMiddleware,
  rateLimitMiddleware,
  emergencyStopMiddleware,
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

import {
  handleAdminAddStockStart,
  handleAdminUsersList,
  handleAdminProductsPanel,
  handleAdminRegionLabels,
  handleAdminSetBanner,
  handleBanUser,
  handleUnbanUser,
  handleToggleProduct,
  handleWizardCallback,
  handleWizardCancel,
  handleWizardText,
  handleWizardPhoto,
  isAdminUser,
  hasActiveWizardSession,
} from './handlers/admin_wizard';

export const bot = new Telegraf(config.bot.token);

// ── Middleware ─────────────────────────────────────────────────────────────────
bot.use(userRegistrationMiddleware());
bot.use(rateLimitMiddleware());
bot.use(bannedUserMiddleware());
bot.use(emergencyStopMiddleware());

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
bot.action('admin_products_list',       (ctx) => handleAdminProductsPanel(ctx));
bot.action('admin_back_to_user',        (ctx) => ctx.editMessageText('👋 Kullanıcı moduna dönüldü. /start yazarak menüyü görebilirsiniz.'));

// ── Inline-keyboard callbacks — admin wizard ──────────────────────────────────
bot.action('admin_add_stock',           (ctx) => handleAdminAddStockStart(ctx));
bot.action('admin_users_list',          (ctx) => handleAdminUsersList(ctx));
bot.action('admin_region_labels',       (ctx) => handleAdminRegionLabels(ctx));
bot.action('admin_set_banner',          (ctx) => handleAdminSetBanner(ctx));
bot.action('admin_add_product',         (ctx) => handleWizardCallback(ctx));
bot.action('wizard_cancel',             (ctx) => handleWizardCancel(ctx));
bot.action(/^stock_product:(\d+)$/,     (ctx) => handleWizardCallback(ctx));
bot.action(/^stock_region:(.+)$/,       (ctx) => handleWizardCallback(ctx));
bot.action('stock_confirm',             (ctx) => handleWizardCallback(ctx));
bot.action(/^ban_user:(.+)$/,           (ctx) => handleBanUser(ctx));
bot.action(/^unban_user:(.+)$/,         (ctx) => handleUnbanUser(ctx));
bot.action(/^product_cover:(\d+)$/,     (ctx) => handleWizardCallback(ctx));
bot.action(/^edit_label_(TR|EU)$/,      (ctx) => handleWizardCallback(ctx));
bot.action(/^toggle_product:(\d+)$/,    (ctx) => handleToggleProduct(ctx));

// ── Inline-keyboard callbacks — admin manual payment review ───────────────────
bot.action(/^admin_approve:(.+)$/,      (ctx) => handleAdminApprovePayment(ctx));
bot.action(/^admin_reject:(.+)$/,       (ctx) => handleAdminRejectPayment(ctx));

// ── Global Text Handler ───────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (isAdminUser(userId) && hasActiveWizardSession(userId)) {
    return handleWizardText(ctx);
  }
  return handleTextMessage(ctx);
});

// ── Global Photo Handler ──────────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (isAdminUser(userId) && hasActiveWizardSession(userId)) {
    return handleWizardPhoto(ctx);
  }
});

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

