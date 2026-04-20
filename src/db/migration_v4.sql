-- ============================================================
-- migration_v4.sql — Settings, USER_CANCELLED, indexes
-- Idempotent: güvenle tekrar çalıştırılabilir
-- ============================================================
SET NAMES utf8mb4;

-- settings tablosu (banner foto, region labels, vb.)
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(64)  NOT NULL,
  `value`     TEXT         NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Varsayılan ayarlar
INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('menu_image_file_id', NULL),
  ('region_label_TR', '🇹🇷 Türkiye'),
  ('region_label_EU', '🇪🇺 Avrupa');

-- USER_CANCELLED ve PENDING_REVIEW enum ekle (idempotent: MODIFY her zaman çalışır)
ALTER TABLE orders MODIFY COLUMN status ENUM(
  'INITIATED','RESERVED','PENDING_VERIFICATION','PENDING_REVIEW',
  'PAYMENT_CONFIRMED','PAYMENT_FAILED',
  'COMPLETED','EXPIRED','ADMIN_CANCELLED','SYSTEM_CANCELLED','USER_CANCELLED'
) NOT NULL DEFAULT 'INITIATED';

-- PENDING_REVIEW status için index
SET @idx = 'idx_orders_pending_review';
SET @tbl = 'orders';
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx) > 0,
  'SELECT 1',
  'CREATE INDEX idx_orders_pending_review ON orders(status, created_at)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
