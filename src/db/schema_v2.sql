-- ============================================================
-- schema_v2.sql  —  Incremental migration (v1 → v2)
-- ============================================================
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- Apply with:  mysql -u <user> -p <database> < schema_v2.sql
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── 1. Track how much crypto was actually received (for auditing) ─────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS received_amount VARCHAR(78) NULL
  AFTER failure_reason;

-- ── 2. Store the admin who manually approved / rejected a payment ─────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(32) NULL
  AFTER received_amount;

-- ── 3. Index on pending manual reviews (ETH/BNB PENDING_VERIFICATION) ─────────
-- Needed by /pendingreviews admin command.
ALTER TABLE orders
  ADD INDEX IF NOT EXISTS idx_orders_manual_review (status, currency);

-- ── 4. Soft-delete for products ───────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER is_active;

-- ── 5. user_notifications table — optional push-delivery tracking ─────────────
CREATE TABLE IF NOT EXISTS user_notifications (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(32)      NOT NULL,
  order_id   VARCHAR(20)      NULL,
  message    TEXT             NOT NULL,
  sent       TINYINT(1)       NOT NULL DEFAULT 0,
  created_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_notifications_user   (user_id),
  INDEX idx_notifications_unsent (sent, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
