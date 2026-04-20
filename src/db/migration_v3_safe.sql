-- ============================================================
-- migration_v3_safe.sql
-- ============================================================

-- image_file_id check
SET @dbname = 'tg_marketplace';
SET @tablename = 'products';
SET @columnname = 'image_file_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE products ADD COLUMN image_file_id VARCHAR(255) NULL AFTER price_usd_cents'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- region check in stock_items
SET @tablename = 'stock_items';
SET @columnname = 'region';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE stock_items ADD COLUMN region ENUM(\'TR\', \'EU\') NOT NULL DEFAULT \'TR\' AFTER status'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- images check in stock_items
SET @columnname = 'images';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE stock_items ADD COLUMN images TEXT NULL AFTER content'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- region check in orders
SET @tablename = 'orders';
SET @columnname = 'region';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE orders ADD COLUMN region ENUM(\'TR\', \'EU\') NULL AFTER currency'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Modify status enum
ALTER TABLE orders MODIFY COLUMN status ENUM(
    'INITIATED','RESERVED','PENDING_VERIFICATION','PENDING_REVIEW',
    'PAYMENT_CONFIRMED','PAYMENT_FAILED',
    'COMPLETED','EXPIRED','ADMIN_CANCELLED','SYSTEM_CANCELLED'
) NOT NULL DEFAULT 'INITIATED';

-- Index check
SET @indexname = 'idx_stock_product_region_status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'stock_items' AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_stock_product_region_status ON stock_items(product_id, region, status)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @indexname = 'idx_orders_status_created';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'orders' AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_orders_status_created ON orders(status, created_at)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
