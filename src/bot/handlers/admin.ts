import { Context, Markup } from 'telegraf';
import { config } from '../../config';
import { userService } from '../../services/UserService';
import { stockService } from '../../services/StockService';
import { jobService } from '../../services/JobService';
import { setEmergencyStop, isEmergencyStopActive } from '../../redis';
import { Currency, JobType, DeliverStockPayload, OrderStatus } from '../../types';
import pool, { withTransaction } from '../../db';
import { logger } from '../../utils/logger';

function isAdmin(ctx: Context): boolean {
  const userId = String(ctx.from?.id);
  const adminIds = config.bot.adminIds as readonly string[];
  return adminIds.includes(userId);
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
export async function handleAdminDashboard(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) { await ctx.reply('⛔ Admin yetkiniz bulunmamaktadır.'); return; }

  const [[orderRows], [userRows], [stockRows], [pendingRows]] = await Promise.all([
    pool.execute("SELECT COUNT(*) AS total FROM orders"),
    pool.execute("SELECT COUNT(*) AS total FROM users"),
    pool.execute("SELECT COUNT(*) AS total FROM stock_items WHERE status = 'AVAILABLE'"),
    pool.execute("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'PENDING_REVIEW'"),
  ]);

  const emergencyActive = await isEmergencyStopActive();
  const uCount = (userRows as any[])[0].total;
  const sCount = (stockRows as any[])[0].total;
  const pCount = (pendingRows as any[])[0].cnt;
  const oCount = (orderRows as any[])[0].total;

  const text = `👑 *Admin Dashboard*\n\n` +
               `⚠️ Durum: ${emergencyActive ? '🛑 ACİL DURUM STOP' : '✅ SİSTEM AKTİF'}\n\n` +
               `📊 *İstatistikler:*\n` +
               `👥 Kullanıcı: ${uCount}\n` +
               `📦 Toplam Stok: ${sCount}\n` +
               `⏳ Bekleyen Onay: ${pCount}\n` +
               `🛒 Toplam Sipariş: ${oCount}\n\n` +
               `Lütfen işlem seçin:`;

  const buttons = [
    [Markup.button.callback(emergencyActive ? '✅ SİSTEMİ AÇ' : '🛑 ACİL DURUM STOP', 'admin_toggle_emergency')],
    [Markup.button.callback(`⏳ Bekleyen Siparişler (${pCount})`, 'admin_pending_list')],
    [Markup.button.callback('📦 Ürün Yönetimi', 'admin_products_list')],
    [Markup.button.callback('📸 Stok Ekle', 'admin_add_stock')],
    [Markup.button.callback('👥 Kullanıcılar', 'admin_users_list')],
    [Markup.button.callback('🌍 Bölge Etiketleri', 'admin_region_labels')],
    [Markup.button.callback('🖼️ Menü Banner', 'admin_set_banner')],
    [Markup.button.callback('◀️ Geri', 'admin_back_to_user')]
  ];

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Emergency Stop ───────────────────────────────────────────────────────────
export async function handleAdminEmergencyStop(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) return;
  const active = await isEmergencyStopActive();
  await setEmergencyStop(!active);
  logger.warn('Emergency stop toggled', { adminId: ctx.from!.id, active: !active });
  if (ctx.callbackQuery) await ctx.answerCbQuery(`Acil durum stop ${!active ? 'aktif' : 'pasif'}`);
}

// ─── Pending Reviews ──────────────────────────────────────────────────────────
export async function handleAdminPendingReviews(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) return;
  const [rows] = await pool.execute(
    `SELECT o.*, u.first_name, u.username, p.name as product_name 
     FROM orders o 
     JOIN users u ON o.user_id = u.id 
     JOIN products p ON o.product_id = p.id 
     WHERE o.status = 'PENDING_REVIEW' 
     ORDER BY o.created_at ASC`
  );
  const pending = rows as any[];

  if (pending.length === 0) {
    await ctx.reply('✅ Onay bekleyen sipariş bulunmamaktadır.');
    return;
  }

  for (const order of pending) {
    const text = `⏳ *Bekleyen Sipariş #${order.id}*\n\n` +
                 `👤 Kullanıcı: ${order.first_name} (@${order.username || 'yok'})\n` +
                 `📦 Ürün: ${order.product_name}\n` +
                 `🌍 Bölge: ${order.region}\n` +
                 `💰 Tutar: ${order.crypto_amount_snapshot || order.required_amount} ${order.currency}\n` +
                 `🔖 TXID: \`${order.txid}\`\n\n` +
                 `Lütfen işlemi onaylayın veya reddedin:`;

    const buttons = [
      [Markup.button.callback('✅ Onayla', `admin_approve:${order.id}`)],
      [Markup.button.callback('❌ Reddet', `admin_reject:${order.id}`)]
    ];
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Approve Payment & Deliver ───────────────────────────────────────────────
export async function handleAdminApprovePayment(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔ Yetkiniz yok.'); return; }

  const orderId = ctx.callbackQuery.data.split(':')[1];

  try {
    await withTransaction(async (conn) => {
      // 1. Siparişi kilitle ve kontrol et
      const [rows] = await conn.execute(
        `SELECT o.*, p.name as product_name 
         FROM orders o 
         JOIN products p ON o.product_id = p.id 
         WHERE o.id = ? FOR UPDATE`,
        [orderId]
      );
      const order = (rows as any[])[0];
      if (!order) throw new Error('NOT_FOUND');

      // Idempotency: sadece PENDING_REVIEW ise işlem yap
      if (order.status !== 'PENDING_REVIEW') {
        throw new Error('NOT_PENDING');
      }

      // 2. Mevcut reserved stok item'ı getir (zaten rezerve edilmiş olmalı)
      const [stockRows] = await conn.execute(
        `SELECT * FROM stock_items WHERE reserved_by_order = ? AND status = 'RESERVED' LIMIT 1 FOR UPDATE`,
        [orderId]
      );
      let stock = (stockRows as any[])[0];

      // Eğer reserved stok yoksa (eski siparişler için fallback), yeniden bul
      if (!stock) {
        const [availRows] = await conn.execute(
          `SELECT * FROM stock_items WHERE product_id = ? AND region = ? AND status = 'AVAILABLE' LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [order.product_id, order.region]
        );
        stock = (availRows as any[])[0];
        if (!stock) throw new Error('OUT_OF_STOCK');
        await conn.execute(
          `UPDATE stock_items SET status = 'RESERVED', reserved_by_order = ?, reserved_at = NOW() WHERE id = ?`,
          [orderId, stock.id]
        );
      }

      // 3. DB güncelle
      await conn.execute(`UPDATE orders SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?`, [orderId]);
      await conn.execute(`UPDATE stock_items SET status = 'SOLD', sold_at = NOW() WHERE id = ?`, [stock.id]);
      await conn.execute(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value) VALUES (?, 'ADMIN_APPROVED', 'order', ?, ?)`,
        [String(ctx.from!.id), orderId, JSON.stringify({ stockItemId: stock.id })]
      );

      // 4. Kullanıcıya teslim et
      const userText = `✅ *Siparişiniz Onaylandı!*\n\n` +
                       `📦 *Ürün:* ${order.product_name}\n` +
                       `🆔 *Sipariş ID:* #${orderId}\n\n` +
                       `📝 *Ürün Bilgileri:*\n\n${stock.content}`;

      if (stock.images) {
        const images: string[] = JSON.parse(stock.images);
        if (images.length === 1) {
          await ctx.telegram.sendPhoto(String(order.user_id), images[0], { caption: userText, parse_mode: 'Markdown' });
        } else if (images.length > 1) {
          const mediaGroup = images.map((id: string, idx: number) => ({
            type: 'photo' as const,
            media: id,
            caption: idx === 0 ? userText : undefined,
            parse_mode: 'Markdown' as const,
          }));
          await ctx.telegram.sendMediaGroup(String(order.user_id), mediaGroup);
        } else {
          await ctx.telegram.sendMessage(String(order.user_id), userText, { parse_mode: 'Markdown' });
        }
      } else {
        await ctx.telegram.sendMessage(String(order.user_id), userText, { parse_mode: 'Markdown' });
      }

      await ctx.editMessageText(`✅ Sipariş #${orderId} onaylandı ve teslim edildi.`);
      await ctx.answerCbQuery('Sipariş onaylandı.');
    });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      await ctx.answerCbQuery('❌ Sipariş bulunamadı.');
    } else if (err.message === 'NOT_PENDING') {
      await ctx.answerCbQuery('⚠️ Bu sipariş zaten işleme alınmış.');
      await ctx.editMessageText(`⚠️ Sipariş #${orderId} zaten işleme alınmış.`).catch(() => {});
    } else if (err.message === 'OUT_OF_STOCK') {
      await ctx.reply(`❌ Sipariş #${orderId} onaylanamadı: Bölgede stok yok!`, { parse_mode: 'Markdown' });
      await ctx.answerCbQuery('Stok yetersiz!');
    } else {
      logger.error('Approve failed', { orderId, error: err });
      await ctx.answerCbQuery('❌ Hata oluştu. Loglara bakın.');
    }
  }
}

// ─── Reject Payment ──────────────────────────────────────────────────────────
export async function handleAdminRejectPayment(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  if (!isAdmin(ctx)) return;

  const orderId = ctx.callbackQuery.data.split(':')[1];
  await pool.execute(`UPDATE orders SET status = 'PAYMENT_FAILED', updated_at = NOW() WHERE id = ?`, [orderId]);
  
  const [rows] = await pool.execute('SELECT user_id FROM orders WHERE id = ?', [orderId]);
  const order = (rows as any[])[0];
  if (order) {
    await ctx.telegram.sendMessage(String(order.user_id), `❌ Siparişiniz (#${orderId}) admin tarafından reddedildi. Lütfen bilgilerinizi kontrol edin veya destekle iletişime geçin.`);
  }

  await ctx.editMessageText(`❌ Sipariş #${orderId} reddedildi.`, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery('Sipariş reddedildi.');
}

// ─── Product & Stock Helpers ────────────────────────────────────────────────
export async function handleAdminListProducts(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) return;
  const [rows] = await pool.execute('SELECT * FROM products ORDER BY id');
  const products = rows as any[];
  let text = '📦 *Ürün Listesi:*\n\n';
  products.forEach(p => {
    text += `ID: \`${p.id}\` | ${p.name} | $${(p.price_usd_cents/100).toFixed(2)} | ${p.is_active ? '✅' : '❌'}\n`;
  });

  const buttons = [
    [Markup.button.callback('➕ Yeni Ürün Ekle', 'admin_add_product')],
    ...products.map(p => [
      Markup.button.callback(`📸 Kapak: ${p.name}`, `product_cover:${p.id}`),
      Markup.button.callback(p.is_active ? '🔴 Pasif Yap' : '🟢 Aktif Yap', `toggle_product:${p.id}`),
    ]),
  ];

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
  if (ctx.callbackQuery) await ctx.answerCbQuery();
}

