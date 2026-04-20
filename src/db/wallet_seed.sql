-- ============================================================
-- wallet_seed.sql  —  Seed deposit wallets
-- ============================================================
-- Replace the placeholder addresses with your real wallet
-- addresses before running this script.
--
-- IMPORTANT:
--   - Use a DIFFERENT address for each currency on the same chain
--     (or the same address with a different currency row if you
--     intentionally share an address — e.g. TRX & USDT_TRC20).
--   - Never reuse a hot-wallet private key across chains.
--   - TRX & USDT_TRC20 → Tron network  (address starts with T)
--   - ETH & USDT_ERC20 → Ethereum      (0x address)
--   - BNB & USDT_BEP20 → BNB Smart Chain (0x address)
-- ============================================================

INSERT INTO wallets (currency, address, is_active, label) VALUES
-- ── Tron ──────────────────────────────────────────────────────────────────────
('TRX',        'REPLACE_WITH_YOUR_TRX_ADDRESS_1',        1, 'TRX Wallet #1'),
('TRX',        'REPLACE_WITH_YOUR_TRX_ADDRESS_2',        1, 'TRX Wallet #2'),
('USDT_TRC20', 'REPLACE_WITH_YOUR_USDT_TRC20_ADDRESS_1', 1, 'USDT-TRC20 Wallet #1'),
('USDT_TRC20', 'REPLACE_WITH_YOUR_USDT_TRC20_ADDRESS_2', 1, 'USDT-TRC20 Wallet #2'),

-- ── Ethereum ──────────────────────────────────────────────────────────────────
('ETH',        'REPLACE_WITH_YOUR_ETH_ADDRESS_1',        1, 'ETH Wallet #1'),
('USDT_ERC20', 'REPLACE_WITH_YOUR_USDT_ERC20_ADDRESS_1', 1, 'USDT-ERC20 Wallet #1'),

-- ── BNB Smart Chain ───────────────────────────────────────────────────────────
('BNB',        'REPLACE_WITH_YOUR_BNB_ADDRESS_1',        1, 'BNB Wallet #1'),
('USDT_BEP20', 'REPLACE_WITH_YOUR_USDT_BEP20_ADDRESS_1', 1, 'USDT-BEP20 Wallet #1')

ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  label     = VALUES(label);
