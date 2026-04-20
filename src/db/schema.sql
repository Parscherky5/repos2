-- ============================================================
-- schema.sql  —  Initial database schema
-- ============================================================
-- Apply with:  mysql -u <user> -p <database> < schema.sql
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               VARCHAR(32)          NOT NULL,
  username         VARCHAR(255)         NULL,
  first_name       VARCHAR(255)         NOT NULL DEFAULT '',
  balance_usd_cents BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  is_banned        TINYINT(1)           NOT NULL DEFAULT 0,
  created_at       DATETIME             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME             NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_users_is_banned (is_banned)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── products ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id               INT UNSIGNED         NOT NULL AUTO_INCREMENT,
  name             VARCHAR(255)         NOT NULL,
  description      TEXT                 NULL,
  price_usd_cents  BIGINT UNSIGNED      NOT NULL,
  image_file_id    VARCHAR(255)         NULL,
  is_active        TINYINT(1)           NOT NULL DEFAULT 1,
  created_at       DATETIME             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_products_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  currency    ENUM('TRX','USDT_TRC20','USDT_ERC20','USDT_BEP20','BNB','ETH')
              NOT NULL,
  address     VARCHAR(255)   NOT NULL,
  is_active   TINYINT(1)     NOT NULL DEFAULT 1,
  label       VARCHAR(255)   NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallets_currency_address (currency, address),
  INDEX idx_wallets_currency_active (currency, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── stock_items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_items (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  product_id        INT UNSIGNED     NOT NULL,
  content           TEXT             NOT NULL,
  status            ENUM('AVAILABLE','RESERVED','SOLD')
                    NOT NULL DEFAULT 'AVAILABLE',
  reserved_by_order VARCHAR(20)      NULL,
  reserved_at       DATETIME         NULL,
  sold_at           DATETIME         NULL,
  created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_stock_product_status (product_id, status),
  INDEX idx_stock_reserved_by    (reserved_by_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── orders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id                 VARCHAR(32)      NOT NULL,
  product_id              INT UNSIGNED     NOT NULL,
  stock_item_id           BIGINT UNSIGNED  NULL,
  status                  ENUM(
    'INITIATED','RESERVED','PENDING_VERIFICATION',
    'PAYMENT_CONFIRMED','PAYMENT_FAILED',
    'COMPLETED','EXPIRED','ADMIN_CANCELLED','SYSTEM_CANCELLED'
  ) NOT NULL DEFAULT 'INITIATED',
  currency                ENUM('TRX','USDT_TRC20','USDT_ERC20','USDT_BEP20','BNB','ETH')
                          NOT NULL,
  required_amount         VARCHAR(78)      NOT NULL,
  crypto_amount_snapshot  VARCHAR(78)      NULL,
  usd_rate_snapshot       VARCHAR(32)      NULL,
  deposit_address         VARCHAR(255)     NOT NULL,
  wallet_id               INT UNSIGNED     NULL,
  txid                    VARCHAR(128)     NULL,
  txid_submitted_at       DATETIME         NULL,
  confirmed_at            DATETIME         NULL,
  completed_at            DATETIME         NULL,
  updated_at              DATETIME         NULL,
  expires_at              DATETIME         NOT NULL,
  failure_reason          VARCHAR(500)     NULL,
  price_snapshot          VARCHAR(78)      NOT NULL,
  created_at              DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_orders_user_status  (user_id, status),
  INDEX idx_orders_status       (status),
  INDEX idx_orders_expires_at   (expires_at),
  INDEX idx_orders_currency     (currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── txid_log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS txid_log (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  txid          VARCHAR(128)      NOT NULL,
  order_id      VARCHAR(20)       NOT NULL,
  currency      ENUM('TRX','USDT_TRC20','USDT_ERC20','USDT_BEP20','BNB','ETH')
                NOT NULL,
  submitted_by  VARCHAR(32)       NOT NULL,
  created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_txid_log_txid (txid),
  INDEX idx_txid_log_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── background_jobs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS background_jobs (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  type         ENUM('VERIFY_PAYMENT','EXPIRE_RESERVATION','DELIVER_STOCK')
               NOT NULL,
  entity_id    VARCHAR(128)      NULL,
  dedup_key    VARCHAR(255)      NULL,
  payload      JSON              NOT NULL,
  status       ENUM('PENDING','PROCESSING','DONE','FAILED')
               NOT NULL DEFAULT 'PENDING',
  attempts     INT               NOT NULL DEFAULT 0,
  max_attempts INT               NOT NULL DEFAULT 5,
  run_after    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until DATETIME          NULL,
  locked_by    VARCHAR(255)      NULL,
  last_error   TEXT              NULL,
  created_at   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dedup (dedup_key),
  INDEX idx_jobs_status_run_after (status, run_after, attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── audit_log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  actor_id     VARCHAR(32)       NOT NULL,
  action       VARCHAR(64)       NOT NULL,
  entity_type  VARCHAR(32)       NOT NULL,
  entity_id    VARCHAR(128)      NOT NULL,
  old_value    JSON              NULL,
  new_value    JSON              NULL,
  created_at   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_audit_entity  (entity_type, entity_id),
  INDEX idx_audit_actor   (actor_id),
  INDEX idx_audit_action  (action),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
