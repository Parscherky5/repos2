import { Context, Markup } from 'telegraf';
import { orderService } from '../../services/OrderService';
import { userService } from '../../services/UserService';
import { settingsService } from '../../services/SettingsService';
import { escapeMarkdown } from '../../utils/escapeMarkdown';
import { Currency } from '../../types';
import pool from '../../db';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Helper for safe editing
async function safeEdit(ctx: Context, text: string, extra?: any) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
  } catch (e) {
    await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  }
}

// ─── /start ───────────────────────────────────────────────────────────────────
export async function handleStart(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  const user = await userService.getById(userId);
  const balanceUsd = (Number(user?.balanceUsdCents ?? 0) / 100).toFixed(2);

  const isAdmin = (config.bot.adminIds as string[]).includes(userId);
  const keyboard = [
    ['🛒 Ürünler', '👤 Profilim'],
    ['🎧 Destek']
  ];
  if (isAdmin) keyboard.push(['🔐 Admin']);
  const replyMarkup = Markup.keyboard(keyboard).resize();

  const welcomeText = `👋 Kripto Pazaryeri'ne Hoş Geldiniz!\n\n💰 Bakiyeniz: $${balanceUsd}\n\nBaşlamak için aşağıdaki butonları kullanın.`;

  const bannerFileId = await settingsService.get('menu_image_file_id');
  if (bannerFileId) {
    await ctx.replyWithPhoto(bannerFileId, { caption: welcomeText, ...replyMarkup });
  } else {
    await ctx.reply(welcomeText, replyMarkup);
  }
}

// ─── /products ────────────────────────────────────────────────────────────────
export async function handleProducts(ctx: Context): Promise<void> {
  const [rows] = await pool.execute('SELECT * FROM products WHERE is_active = 1 ORDER BY id');
  const products = rows as any[];

  if (products.length === 0) {
    await ctx.reply('😔 Şu an aktif ürün bulunmamaktadır.');
    return;
  }

  const buttons = products.map((p) => [
    Markup.button.callback(`${p.name} — $${(Number(p.price_usd_cents) / 100).toFixed(2)}`, `product:${p.id}`)
  ]);

  await ctx.reply('🛒 Mevcut Ürünler:', Markup.inlineKeyboard(buttons));
}

// ─── Callback: product:<id> ───────────────────────────────────────────────────
export async function handleProductSelect(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const productId = parseInt(ctx.callbackQuery.data.split(':')[1], 10);

  const [rows] = await pool.execute('SELECT * FROM products WHERE id = ? AND is_active = 1', [productId]);
  const product = (rows as any[])[0];
  if (!product) { await ctx.answerCbQuery('❌ Ürün bulunamadı.'); return; }

  const [stockTR] = await pool.execute(`SELECT COUNT(*) AS cnt FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE' AND region = 'TR'`, [productId]);
  const [stockEU] = await pool.execute(`SELECT COUNT(*) AS cnt FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE' AND region = 'EU'`, [productId]);
  
  const trCount = Number((stockTR as any[])[0].cnt);
  const euCount = Number((stockEU as any[])[0].cnt);

  const [labelTR, labelEU] = await Promise.all([
    settingsService.getRegionLabel('TR'),
    settingsService.getRegionLabel('EU'),
  ]);

  const text = `*${product.name}*\n${product.description || ''}\n\n` +
               `💵 Fiyat: $${(Number(product.price_usd_cents) / 100).toFixed(2)}\n` +
               `${labelTR} Stok: ${trCount}\n${labelEU} Stok: ${euCount}\n\n` +
               `Lütfen bölge seçiniz:`;

  const buttons = [
    ...(trCount > 0 ? [[Markup.button.callback(`${labelTR} Satın Al (${trCount})`, `region:${productId}:TR`)]] : []),
    ...(euCount > 0 ? [[Markup.button.callback(`${labelEU} Satın Al (${euCount})`, `region:${productId}:EU`)]] : []),
    [Markup.button.callback('⬅️ Geri', 'back_to_products')]
  ];

  if (product.image_file_id) {
    await ctx.replyWithPhoto(product.image_file_id, { caption: text, parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    await ctx.deleteMessage().catch(() => {});
  } else {
    await safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
  }
  await ctx.answerCbQuery();
}

// ─── Callback: region:<productId>:<region> ───────────────────────────────
export async function handleRegionSelect(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const parts = ctx.callbackQuery.data.split(':');
  const productId = parseInt(parts[1], 10);
  const region = parts[2];
  
  const currencyButtons = Object.values(Currency).map((c) => [
    Markup.button.callback(c, `order_init:${productId}:${region}:${c}`),
  ]);
  currencyButtons.push([Markup.button.callback('⬅️ Geri', `product:${productId}`)]);

  await safeEdit(ctx, `🌍 Seçilen Bölge: *${region}*\n\nÖdeme yöntemi seçiniz:`, Markup.inlineKeyboard(currencyButtons));
  await ctx.answerCbQuery();
}

// ─── Callback: order_init:<productId>:<region>:<currency> ───────────────────────────────
export async function handleOrderInit(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const parts = ctx.callbackQuery.data.split(':');
  const productId = parseInt(parts[1], 10);
  const region = parts[2] as 'TR' | 'EU';
  const currency = parts[3] as Currency;
  const userId = String(ctx.from!.id);

  await ctx.answerCbQuery('⏳ Rezervasyon oluşturuluyor...');

  try {
    const order = await orderService.createReservation(userId, productId, currency, region);
    if (!order) throw new Error('FAILED');

    const amount = order.cryptoAmountSnapshot ?? order.requiredAmount;
    await safeEdit(ctx, 
      `✅ *Rezervasyon Oluşturuldu!*\n\n` +
      `🆔 Sipariş ID: \`${order.id}\`\n` +
      `🌍 Bölge: *${region}*\n` +
      `💱 Para Birimi: ${order.currency}\n` +
      `💰 Tutar: \`${amount} ${order.currency}\`\n` +
      `📬 Ödeme Adresi:\n\`${order.depositAddress}\`\n\n` +
      `⚠️ Lütfen tam tutarı gönderdiğinizden emin olun.\n\n` +
      `📝 Ödeme yaptıktan sonra **TXID kodunu direkt buraya mesaj olarak gönderin.**`,
      Markup.inlineKeyboard([[Markup.button.callback('❌ İptal Et', 'cancel_order')]])
    );
  } catch (err: any) {
    const msg = err.message;
    if (msg === 'USER_HAS_ACTIVE_ORDER') {
      await safeEdit(ctx, '⚠️ Zaten aktif bir siparişiniz var. Lütfen önce onu tamamlayın veya iptal edin.');
    } else {
      await safeEdit(ctx, '❌ Sipariş oluşturulamadı. Stok bitmiş olabilir.');
    }
  }
}

// ─── Text Handler: Handle TXID / Support ───────────────────────────────────────
export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;
  const text = ctx.message.text.trim();
  const userId = String(ctx.from!.id);

  // Keyboard butonlarını / komutları geçir
  if (text.startsWith('/') || ['🛒 Ürünler', '👤 Profilim', '🎧 Destek', '🔐 Admin'].includes(text)) return;

  // Aktif sipariş var mı?
  const order = await orderService.getUserActiveOrder(userId);

  // TXID yakalama: status RESERVED olmalı, henüz TXID gönderilmemiş olmalı
  if (order && order.status === 'RESERVED' && !order.txid && text.length >= 10) {
    // TXID format doğrulama: sadece hex/alfanümerik, 10-128 karakter
    if (!/^[a-fA-F0-9]{10,128}$/.test(text)) {
      await ctx.reply('⚠️ Geçersiz TXID formatı. Lütfen işlem hash\'inizi doğru girin (sadece harfler ve rakamlar, 10-128 karakter).');
      return;
    }

    try {
      await orderService.submitTxid(order.id, userId, text);
      await ctx.reply('✅ TXID alındı! Admin onayı bekleniyor. Onaylandığında ürününüz teslim edilecektir.');

      // Admin'e bildir
      for (const adminId of config.bot.adminIds as string[]) {
        await ctx.telegram.sendMessage(
          adminId,
          `🔔 *Yeni Ödeme Bildirimi!*\nSipariş: #${order.id}\nKullanıcı: ${escapeMarkdown(ctx.from!.first_name)} (@${escapeMarkdown(ctx.from!.username || 'yok')})\nTXID: \`${text}\``,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err: any) {
      const msg = err.message;
      if (msg === 'TXID_ALREADY_USED') {
        await ctx.reply('❌ Bu TXID daha önce kullanılmış.');
      } else if (msg === 'ORDER_EXPIRED') {
        await ctx.reply('⏰ Siparişiniz süresi dolmuş. Lütfen yeni bir sipariş oluşturun.');
      } else {
        await ctx.reply('❌ TXID kaydedilirken bir hata oluştu. Lütfen tekrar deneyin.');
      }
    }
    return;
  }

  // Destek mesajı
  await ctx.reply('🎧 Destek talebiniz admin panelimize iletildi.');
  for (const adminId of config.bot.adminIds as string[]) {
    await ctx.telegram.sendMessage(
      adminId,
      `🎧 *Yeni Destek Mesajı*\nKimden: ${escapeMarkdown(ctx.from!.first_name)} (@${escapeMarkdown(ctx.from!.username || 'yok')})\nID: \`${userId}\`\n\nMesaj: ${escapeMarkdown(text)}`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ─── Profil / Siparişlerim ─────────────────────────────────────────────────────
export async function handleProfile(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  const order = await orderService.getUserActiveOrder(userId);

  if (!order) {
    await ctx.reply('👤 *Profiliniz*\n\nAktif bir siparişiniz bulunmamaktadır.', { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(
      `👤 *Profiliniz & Aktif Sipariş*\n\n` +
      `🆔 Sipariş ID: \`${order.id}\`\n` +
      `📊 Durum: ${order.status}\n` +
      `🌍 Bölge: ${order.region || 'Belirtilmemiş'}\n` +
      `⏰ Bitiş: ${order.expiresAt.toLocaleString('tr-TR')}\n` +
      (order.txid ? `✅ TXID: \`${order.txid}\`` : '⏳ TXID bekleniyor...'),
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleBackToProducts(ctx: Context): Promise<void> {
  await handleProducts(ctx);
  await ctx.answerCbQuery();
}

export async function handleCancelOrder(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  const order = await orderService.getUserActiveOrder(userId);
  if (order) {
    await orderService.cancelOrder(order.id, userId);
    await ctx.reply('🗑️ Siparişiniz iptal edildi.');
  } else {
    await ctx.reply('⚠️ İptal edilecek aktif sipariş bulunamadı.');
  }
  if (ctx.callbackQuery) await ctx.answerCbQuery();
}

