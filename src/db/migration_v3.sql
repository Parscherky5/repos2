-- ============================================================
-- migration_v3.sql — New Requirements Update
-- ============================================================

-- 1. Products Table Update
ALTER TABLE products ADD COLUMN image_file_id VARCHAR(255) NULL AFTER price_usd_cents;

-- 2. Stock Items Table Update
ALTER TABLE stock_items ADD COLUMN region ENUM('TR', 'EU') NOT NULL DEFAULT 'TR' AFTER status;
ALTER TABLE stock_items ADD COLUMN images TEXT NULL AFTER content; -- JSON string for file_ids

-- 3. Orders Table Update
ALTER TABLE orders ADD COLUMN region ENUM('TR', 'EU') NULL AFTER currency;
-- Add PENDING_REVIEW to status enum (MySQL 8 handles this with MODIFY)
ALTER TABLE orders MODIFY COLUMN status ENUM(
    'INITIATED','RESERVED','PENDING_VERIFICATION','PENDING_REVIEW',
    'PAYMENT_CONFIRMED','PAYMENT_FAILED',
    'COMPLETED','EXPIRED','ADMIN_CANCELLED','SYSTEM_CANCELLED'
) NOT NULL DEFAULT 'INITIATED';

-- 4. Indexes for performance
CREATE INDEX idx_stock_product_region_status ON stock_items(product_id, region, status);
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
