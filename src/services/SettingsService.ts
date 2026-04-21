import pool from '../db';

export class SettingsService {
  async get(key: string): Promise<string | null> {
    const [rows] = await pool.execute('SELECT `value` FROM settings WHERE `key` = ?', [key]);
    return (rows as any[])[0]?.value ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    await pool.execute(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?, updated_at = NOW()',
      [key, value, value]
    );
  }

  async getMenuBannerFileId(): Promise<string | null> {
    return this.get('menu_image_file_id');
  }

  async getRegionLabel(region: 'TR' | 'EU'): Promise<string> {
    const label = await this.get(`region_label_${region}`);
    return label ?? (region === 'TR' ? '🇹🇷 Türkiye' : '🇪🇺 Avrupa');
  }
}

export const settingsService = new SettingsService();
