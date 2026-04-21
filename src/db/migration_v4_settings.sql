-- ============================================================
-- migration_v4_settings.sql — Settings table
-- Idempotent: güvenle tekrar çalıştırılabilir
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  `key`        VARCHAR(128)  NOT NULL,
  `value`      TEXT          NOT NULL,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
