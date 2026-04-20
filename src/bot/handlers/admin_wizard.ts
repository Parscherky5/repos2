import { Context, Markup } from 'telegraf';
import pool from '../../db';
import { stockService } from '../../services/StockService';
import { userService } from '../../services/UserService';
import { settingsService } from '../../services/SettingsService';
import { config } from '../../config';
import { logger } from '../../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type WizardStep =
  | 'IDLE'
  | 'ADD_STOCK_PRODUCT'
  | 'ADD_STOCK_REGION'
  | 'ADD_STOCK_CONTENT'
  | 'ADD_STOCK_PHOTOS'
  | 'ADD_PRODUCT_NAME'
  | 'ADD_PRODUCT_PRICE'
  | 'ADD_PRODUCT_DESC'
  | 'ADD_PRODUCT_PHOTO'
  | 'SET_REGION_LABEL'
  | 'SET_BANNER'
  | 'SET_COVER';

interface WizardState {
  step: WizardStep;
  data: Record<string, any>;
}

const sessions = new Map<string, WizardState>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAdminUser(userId: string): boolean {
  return (config.bot.adminIds as string[]).includes(userId);
}

function hasActiveWizardSession(userId: string): boolean {
  const s = sessions.get(userId);
  return !!s && s.step !== 'IDLE';
}

function getSession(userId: string): WizardState {
  return sessions.get(userId) ?? { step: 'IDLE', data: {} };
}

function setSession(userId: string, state: WizardState): void {
  sessions.set(userId, state);
}

function clearSession(userId: string): void {
  sessions.delete(userId);
}

async function adminDashboardBack(ctx: Context): Promise<void> {
  clearSession(String(ctx.from!.id));
  await ctx.reply('✅ İşlem iptal edildi. /admin yazarak panele dönebilirsiniz.');
}

// ─── Stok Ekle Wizard ────────────────────────────────────────────────────────

export async function handleAdminAddStockStart(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Yetkiniz yok.');
    return;
  }

  const [rows] = await pool.execute('SELECT id, name FROM products WHERE is_active = 1 ORDER BY id');
  const products = rows as any[];

  if (products.length === 0) {
    await ctx.reply('❌ Aktif ürün bulunamadı. Önce ürün ekleyin.');
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    return;
  }

  setSession(userId, { step: 'ADD_STOCK_PRODUCT', data: {} });

  const buttons = products.map(p => [Markup.button.callback(p.name, `stock_product:${p.id}`)]);
  buttons.push([Markup.button.callback('❌ İptal', 'wizard_cancel')]);

  const text = '📦 *Stok Ekle*\n\nHangi ürüne stok eklemek istiyorsunuz?';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Ürün Yönetimi Panel ─────────────────────────────────────────────────────

export async function handleAdminProductsPanel(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Yetkiniz yok.');
    return;
  }

  const [rows] = await pool.execute('SELECT * FROM products ORDER BY id');
  const products = rows as any[];

  let text = '📦 *Ürün Yönetimi*\n\n';
  if (products.length === 0) {
    text += 'Henüz ürün bulunmamaktadır.';
  } else {
    products.forEach(p => {
      text += `\`${p.id}\` | ${p.name} | $${(p.price_usd_cents / 100).toFixed(2)} | ${p.is_active ? '✅' : '❌'}\n`;
    });
  }

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('➕ Yeni Ürün Ekle', 'admin_add_product')],
  ];
  products.forEach(p => {
    buttons.push([
      Markup.button.callback(`📸 Kapak: ${p.name}`, `product_cover:${p.id}`),
      Markup.button.callback(p.is_active ? '🔴 Pasif Yap' : '🟢 Aktif Yap', `toggle_product:${p.id}`),
    ]);
  });
  buttons.push([Markup.button.callback('◀️ Geri', 'admin_dashboard')]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Kullanıcı Listesi ───────────────────────────────────────────────────────

export async function handleAdminUsersList(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Yetkiniz yok.');
    return;
  }

  const users = await userService.list(20, 0);

  let text = '👥 *Kullanıcı Listesi* (Son 20)\n\n';
  if (users.length === 0) {
    text += 'Henüz kullanıcı bulunmamaktadır.';
  } else {
    users.forEach(u => {
      text += `\`${u.id}\` | @${u.username || 'yok'} | ${u.firstName} | ${u.isBanned ? '🚫 Banlı' : '✅ Aktif'}\n`;
    });
  }

  const buttons: ReturnType<typeof Markup.button.callback>[][] = users.map(u => [
    u.isBanned
      ? Markup.button.callback(`✅ Unban: @${u.username || u.id}`, `unban_user:${u.id}`)
      : Markup.button.callback(`🚫 Ban: @${u.username || u.id}`, `ban_user:${u.id}`)
  ]);
  buttons.push([Markup.button.callback('◀️ Geri', 'admin_dashboard')]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Region Labels ───────────────────────────────────────────────────────────

export async function handleAdminRegionLabels(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Yetkiniz yok.');
    return;
  }

  const [labelTR, labelEU] = await Promise.all([
    settingsService.getRegionLabel('TR'),
    settingsService.getRegionLabel('EU'),
  ]);

  const text = `🌍 *Bölge Etiketleri*\n\nMevcut etiketler:\n🇹🇷 TR: ${labelTR}\n🇪🇺 EU: ${labelEU}\n\nDüzenlemek için bir bölge seçin:`;
  const buttons = [
    [Markup.button.callback(`🇹🇷 TR Etiketini Düzenle`, 'edit_label_TR')],
    [Markup.button.callback(`🇪🇺 EU Etiketini Düzenle`, 'edit_label_EU')],
    [Markup.button.callback('◀️ Geri', 'admin_dashboard')],
  ];

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Banner Set ──────────────────────────────────────────────────────────────

export async function handleAdminSetBanner(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Yetkiniz yok.');
    return;
  }

  setSession(userId, { step: 'SET_BANNER', data: {} });

  const text = '🖼️ *Banner Fotoğrafı*\n\nLütfen menü banner fotoğrafını gönderin.\n(İptal için /admin yazın)';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown' }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
}

// ─── Ban / Unban ──────────────────────────────────────────────────────────────

export async function handleBanUser(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) { await ctx.answerCbQuery('⛔ Yetkiniz yok.'); return; }

  const targetId = ctx.callbackQuery.data.split(':')[1];
  await userService.ban(targetId);
  await ctx.answerCbQuery(`✅ Kullanıcı ${targetId} banlandı.`);
  await handleAdminUsersList(ctx);
}

export async function handleUnbanUser(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) { await ctx.answerCbQuery('⛔ Yetkiniz yok.'); return; }

  const targetId = ctx.callbackQuery.data.split(':')[1];
  await userService.unban(targetId);
  await ctx.answerCbQuery(`✅ Kullanıcı ${targetId} ban kaldırıldı.`);
  await handleAdminUsersList(ctx);
}

// ─── Toggle Product ──────────────────────────────────────────────────────────

export async function handleToggleProduct(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) { await ctx.answerCbQuery('⛔ Yetkiniz yok.'); return; }

  const productId = parseInt(ctx.callbackQuery.data.split(':')[1], 10);
  const [rows] = await pool.execute('SELECT is_active FROM products WHERE id = ?', [productId]);
  const product = (rows as any[])[0];
  if (!product) { await ctx.answerCbQuery('❌ Ürün bulunamadı.'); return; }

  const newActive = product.is_active ? 0 : 1;
  await pool.execute('UPDATE products SET is_active = ? WHERE id = ?', [newActive, productId]);
  await ctx.answerCbQuery(newActive ? '✅ Ürün aktif edildi.' : '🔴 Ürün pasif edildi.');
  await handleAdminProductsPanel(ctx);
}

// ─── Wizard Cancel ────────────────────────────────────────────────────────────

export async function handleWizardCancel(ctx: Context): Promise<void> {
  const userId = String(ctx.from!.id);
  clearSession(userId);
  if (ctx.callbackQuery) await ctx.answerCbQuery('❌ İptal edildi.');
  await ctx.reply('❌ İşlem iptal edildi.', Markup.removeKeyboard());
}

// ─── Wizard Callback Handler ──────────────────────────────────────────────────

export async function handleWizardCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) { await ctx.answerCbQuery('⛔ Yetkiniz yok.'); return; }

  const data = ctx.callbackQuery.data;
  const session = getSession(userId);

  // ── stock_product:<id> ──
  if (data.startsWith('stock_product:')) {
    const productId = parseInt(data.split(':')[1], 10);
    setSession(userId, { step: 'ADD_STOCK_REGION', data: { productId } });

    const buttons = [
      [Markup.button.callback('🇹🇷 TR', 'stock_region:TR'), Markup.button.callback('🇪🇺 EU', 'stock_region:EU')],
      [Markup.button.callback('❌ İptal', 'wizard_cancel')],
    ];
    await ctx.editMessageText('🌍 Bölge seçin:', { ...Markup.inlineKeyboard(buttons) }).catch(async () => {
      await ctx.reply('🌍 Bölge seçin:', Markup.inlineKeyboard(buttons));
    });
    await ctx.answerCbQuery();
    return;
  }

  // ── stock_region:<TR|EU> ──
  if (data.startsWith('stock_region:')) {
    const region = data.split(':')[1] as 'TR' | 'EU';
    setSession(userId, { step: 'ADD_STOCK_CONTENT', data: { ...session.data, region } });
    await ctx.editMessageText('📝 Stok içeriğini yazın (ürün bilgileri, hesap bilgileri vb.):').catch(async () => {
      await ctx.reply('📝 Stok içeriğini yazın (ürün bilgileri, hesap bilgileri vb.):');
    });
    await ctx.answerCbQuery();
    return;
  }

  // ── stock_confirm ──
  if (data === 'stock_confirm') {
    const { productId, region, content, photos } = session.data;
    if (!productId || !region || !content) {
      await ctx.answerCbQuery('❌ Eksik bilgi.');
      return;
    }
    try {
      await stockService.addItems(productId, [content], region as 'TR' | 'EU', photos?.length > 0 ? photos : undefined);
      clearSession(userId);
      await ctx.editMessageText('✅ Stok başarıyla eklendi!').catch(async () => {
        await ctx.reply('✅ Stok başarıyla eklendi!');
      });
      logger.info('Stock added via wizard', { adminId: userId, productId, region });
    } catch (err) {
      logger.error('Wizard stock add failed', { err });
      await ctx.answerCbQuery('❌ Stok eklenemedi.');
    }
    await ctx.answerCbQuery();
    return;
  }

  // ── product_cover:<id> ──
  if (data.startsWith('product_cover:')) {
    const productId = parseInt(data.split(':')[1], 10);
    setSession(userId, { step: 'SET_COVER', data: { productId } });
    await ctx.editMessageText('📸 Ürün kapak fotoğrafını gönderin:').catch(async () => {
      await ctx.reply('📸 Ürün kapak fotoğrafını gönderin:');
    });
    await ctx.answerCbQuery();
    return;
  }

  // ── edit_label_TR / edit_label_EU ──
  if (data.startsWith('edit_label_')) {
    const region = data.replace('edit_label_', '') as 'TR' | 'EU';
    setSession(userId, { step: 'SET_REGION_LABEL', data: { region } });
    await ctx.editMessageText(`✏️ Yeni ${region} bölge etiketi metnini gönderin:`).catch(async () => {
      await ctx.reply(`✏️ Yeni ${region} bölge etiketi metnini gönderin:`);
    });
    await ctx.answerCbQuery();
    return;
  }

  // ── admin_add_product ──
  if (data === 'admin_add_product') {
    setSession(userId, { step: 'ADD_PRODUCT_NAME', data: {} });
    await ctx.editMessageText('📦 *Yeni Ürün Ekle*\n\nÜrün adını girin:', { parse_mode: 'Markdown' }).catch(async () => {
      await ctx.reply('📦 *Yeni Ürün Ekle*\n\nÜrün adını girin:', { parse_mode: 'Markdown' });
    });
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
}

// ─── Wizard Text Handler ──────────────────────────────────────────────────────

export async function handleWizardText(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) return;

  const text = ctx.message.text.trim();
  const session = getSession(userId);

  switch (session.step) {
    case 'ADD_STOCK_CONTENT': {
      setSession(userId, {
        step: 'ADD_STOCK_PHOTOS',
        data: { ...session.data, content: text, photos: [] },
      });
      const buttons = [
        [Markup.button.callback('✅ Tamamla (Fotoğrafsız)', 'stock_confirm')],
        [Markup.button.callback('❌ İptal', 'wizard_cancel')],
      ];
      await ctx.reply(
        '📸 Fotoğraf gönderin (en fazla 3 adet).\nBitince "Tamamla" butonuna basın.',
        Markup.inlineKeyboard(buttons)
      );
      break;
    }

    case 'ADD_PRODUCT_NAME': {
      setSession(userId, { step: 'ADD_PRODUCT_PRICE', data: { name: text } });
      await ctx.reply('💵 Fiyatı USD olarak girin (örnek: 29.99):');
      break;
    }

    case 'ADD_PRODUCT_PRICE': {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        await ctx.reply('❌ Geçersiz fiyat. Lütfen sayısal bir değer girin (örnek: 29.99):');
        return;
      }
      setSession(userId, { step: 'ADD_PRODUCT_DESC', data: { ...session.data, price } });
      const buttons = [[Markup.button.callback('⏭️ Atla', 'skip_desc')]];
      await ctx.reply('📄 Ürün açıklamasını girin (veya "Atla" butonuna basın):', Markup.inlineKeyboard(buttons));
      break;
    }

    case 'ADD_PRODUCT_DESC': {
      setSession(userId, { step: 'ADD_PRODUCT_PHOTO', data: { ...session.data, description: text } });
      const buttons = [[Markup.button.callback('⏭️ Atla', 'skip_photo')]];
      await ctx.reply('🖼️ Kapak fotoğrafını gönderin (veya "Atla" butonuna basın):', Markup.inlineKeyboard(buttons));
      break;
    }

    case 'SET_REGION_LABEL': {
      const { region } = session.data;
      await settingsService.set(`region_label_${region}`, text);
      clearSession(userId);
      await ctx.reply(`✅ ${region} bölge etiketi güncellendi: ${text}`);
      break;
    }

    default: {
      // Not in an active wizard step, pass through
      break;
    }
  }
}

// ─── Wizard Photo Handler ─────────────────────────────────────────────────────

export async function handleWizardPhoto(ctx: Context): Promise<void> {
  if (!ctx.message || !('photo' in ctx.message)) return;
  const userId = String(ctx.from!.id);
  if (!isAdminUser(userId)) return;

  const session = getSession(userId);
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1]?.file_id;
  if (!fileId) return;

  switch (session.step) {
    case 'ADD_STOCK_PHOTOS': {
      const currentPhotos: string[] = session.data.photos ?? [];
      currentPhotos.push(fileId);

      if (currentPhotos.length >= 3) {
        // Auto-complete at 3 photos
        setSession(userId, { ...session, data: { ...session.data, photos: currentPhotos } });
        await ctx.reply('✅ 3 fotoğraf alındı. Stok ekleniyor...');
        // Simulate stock_confirm callback
        await completeStockAdd(ctx, userId);
      } else {
        setSession(userId, { ...session, data: { ...session.data, photos: currentPhotos } });
        const buttons = [
          [Markup.button.callback('✅ Tamamla', 'stock_confirm')],
          [Markup.button.callback('❌ İptal', 'wizard_cancel')],
        ];
        await ctx.reply(
          `📸 ${currentPhotos.length} fotoğraf alındı. Daha fazla gönderin veya tamamlayın.`,
          Markup.inlineKeyboard(buttons)
        );
      }
      break;
    }

    case 'ADD_PRODUCT_PHOTO': {
      const { name, price, description } = session.data;
      const priceUsdCents = Math.round(price * 100);
      await pool.execute(
        'INSERT INTO products (name, description, price_usd_cents, image_file_id, is_active) VALUES (?, ?, ?, ?, 1)',
        [name, description ?? null, priceUsdCents, fileId]
      );
      clearSession(userId);
      await ctx.reply(`✅ Ürün eklendi!\n\n📦 *${name}*\n💵 $${price.toFixed(2)}\n📄 ${description ?? 'Açıklama yok'}\n📸 Kapak fotoğrafı: ✅`, { parse_mode: 'Markdown' });
      break;
    }

    case 'SET_COVER': {
      const { productId } = session.data;
      await pool.execute('UPDATE products SET image_file_id = ? WHERE id = ?', [fileId, productId]);
      clearSession(userId);
      await ctx.reply('✅ Kapak fotoğrafı güncellendi!');
      break;
    }

    case 'SET_BANNER': {
      await settingsService.set('menu_image_file_id', fileId);
      clearSession(userId);
      await ctx.reply('✅ Menü banner fotoğrafı güncellendi!');
      break;
    }

    default:
      break;
  }
}

async function completeStockAdd(ctx: Context, userId: string): Promise<void> {
  const session = getSession(userId);
  const { productId, region, content, photos } = session.data;
  if (!productId || !region || !content) return;
  try {
    await stockService.addItems(productId, [content], region as 'TR' | 'EU', photos?.length > 0 ? photos : undefined);
    clearSession(userId);
    await ctx.reply('✅ Stok başarıyla eklendi!');
    logger.info('Stock added via wizard (photo auto-complete)', { adminId: userId, productId, region });
  } catch (err) {
    logger.error('Wizard stock add failed (auto-complete)', { err });
    await ctx.reply('❌ Stok eklenirken bir hata oluştu.');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { isAdminUser, hasActiveWizardSession };
