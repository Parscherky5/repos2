import { Telegraf } from 'telegraf';
import { config } from './config';

const bot = new Telegraf(config.bot.token);

async function setCommands() {
  try {
    // Kullanıcı komutları
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Botu başlat ve bakiyeni gör' },
      { command: 'products', description: 'Ürün listesini görüntüle' },
      { command: 'orders', description: 'Aktif siparişini gör' },
      { command: 'submittxid', description: 'Ödeme kanıtı (TXID) gönder' },
      { command: 'cancel', description: 'Aktif siparişi iptal et' },
    ]);

    console.log('✅ User commands set successfully');

    // Admin komutları
    for (const adminId of config.bot.adminIds) {
      try {
        await bot.telegram.setMyCommands([
          { command: 'start', description: 'Botu başlat' },
          { command: 'admin', description: '👑 Admin Dashboard' },
          { command: 'products', description: 'Ürün listesi' },
          { command: 'stats', description: '📊 Sistem İstatistikleri' },
          { command: 'listproducts', description: '📦 Ürün Yönetimi' },
          { command: 'addproduct', description: '➕ Ürün Ekle' },
          { command: 'addstock', description: '📥 Stok Ekle' },
          { command: 'pendingreviews', description: '🔍 Onay Bekleyenler' },
          { command: 'ban', description: '🔨 Kullanıcı Yasakla' },
          { command: 'unban', description: '✅ Yasak Kaldır' },
          { command: 'emergencystop', description: '🛑 Acil Durdurma' },
        ], {
          scope: { type: 'chat', chat_id: Number(adminId) }
        });
        console.log(`✅ Admin commands set for ID: ${adminId}`);
      } catch (e) {
        console.error(`❌ Failed to set admin commands for ${adminId}:`, e);
      }
    }

  } catch (error) {
    console.error('❌ Error setting commands:', error);
  } finally {
    process.exit();
  }
}

setCommands();
