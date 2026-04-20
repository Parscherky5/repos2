import axios from 'axios';
import { Currency } from '../types';
import { logger } from '../utils/logger';

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

export interface CryptoAmountResult {
  /** Amount in the smallest on-chain unit (sun, wei, satoshi-equivalent, etc.) */
  cryptoAmountSmallest: string;
  /** USD price per 1 whole token at time of calculation, 8 decimal places */
  usdPerCrypto: string;
  /** Human-readable amount string (e.g. "0.03330000") */
  humanReadableAmount: string;
}

/** CoinGecko coin IDs for each supported currency */
const COINGECKO_IDS: Record<Currency, string> = {
  [Currency.TRX]: 'tron',
  [Currency.USDT_TRC20]: 'tether',
  [Currency.USDT_ERC20]: 'tether',
  [Currency.USDT_BEP20]: 'tether',
  [Currency.BNB]: 'binancecoin',
  [Currency.ETH]: 'ethereum',
};

/**
 * Number of decimal places (smallest-unit exponent) for each currency.
 * TRX / USDT-TRC20 / USDT-ERC20: 6
 * ETH / BNB: 18
 * USDT-BEP20: 18  (BSC USDT uses 18 decimals)
 */
const CURRENCY_DECIMALS: Record<Currency, number> = {
  [Currency.TRX]: 6,
  [Currency.USDT_TRC20]: 6,
  [Currency.USDT_ERC20]: 6,
  [Currency.USDT_BEP20]: 18,
  [Currency.BNB]: 18,
  [Currency.ETH]: 18,
};

export class CurrencyRateService {
  private cache: RateCache | null = null;
  private readonly cacheDurationMs = 5 * 60 * 1000; // 5 minutes

  /** Get the current USD price for one whole unit of the given currency. */
  async getUsdRate(currency: Currency): Promise<number> {
    const rates = await this.fetchRates();
    const id = COINGECKO_IDS[currency];
    const rate = rates[id];
    if (!rate || rate <= 0) throw new Error(`RATE_NOT_AVAILABLE:${currency}`);
    return rate;
  }

  /**
   * Calculate the on-chain amount (in smallest units) required to pay the
   * given USD price (expressed in cents).
   *
   * Uses ceiling arithmetic via BigInt to guarantee the buyer is never
   * short-changed by rounding.
   */
  async calculateCryptoAmount(
    priceUsdCents: bigint,
    currency: Currency
  ): Promise<CryptoAmountResult> {
    const usdPerCrypto = await this.getUsdRate(currency);
    const decimals = CURRENCY_DECIMALS[currency];
    const multiplier = 10n ** BigInt(decimals);

    // Represent the floating-point rate as a fixed-point integer with 8 d.p.
    // to keep all arithmetic in BigInt and avoid IEEE-754 precision loss.
    const PRECISION = 100_000_000n; // 10^8
    const rateFixed = BigInt(Math.round(usdPerCrypto * Number(PRECISION)));

    // cryptoSmallest = ceil( priceUsdCents * multiplier * PRECISION / (100 * rateFixed) )
    const numerator = priceUsdCents * multiplier * PRECISION;
    const denominator = 100n * rateFixed;
    const cryptoAmountSmallest = (numerator + denominator - 1n) / denominator;

    const humanReadableAmount = this.formatWithDecimals(
      cryptoAmountSmallest,
      decimals,
      Math.min(decimals, 8)
    );

    return {
      cryptoAmountSmallest: cryptoAmountSmallest.toString(),
      usdPerCrypto: usdPerCrypto.toFixed(8),
      humanReadableAmount,
    };
  }

  /** Format a BigInt smallest-unit value as a decimal string. */
  private formatWithDecimals(
    value: bigint,
    decimals: number,
    displayDecimals: number
  ): string {
    const str = value.toString().padStart(decimals + 1, '0');
    const intPart = str.slice(0, str.length - decimals) || '0';
    const fracFull = str.slice(str.length - decimals);
    const fracPart = fracFull.slice(0, displayDecimals).padEnd(displayDecimals, '0');
    return `${intPart}.${fracPart}`;
  }

  private async fetchRates(): Promise<Record<string, number>> {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.cacheDurationMs) {
      return this.cache.rates;
    }

    const uniqueIds = [...new Set(Object.values(COINGECKO_IDS))].join(',');
    try {
      const response = await axios.get<Record<string, { usd: number }>>(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: { ids: uniqueIds, vs_currencies: 'usd' },
          timeout: 10_000,
        }
      );

      const rates: Record<string, number> = {};
      for (const [id, val] of Object.entries(response.data)) {
        rates[id] = val.usd;
      }

      this.cache = { rates, fetchedAt: Date.now() };
      logger.debug('Currency rates refreshed from CoinGecko', { rates });
      return rates;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to fetch currency rates from CoinGecko', { error: msg });

      if (this.cache) {
        logger.warn('Using stale rate cache due to fetch failure');
        return this.cache.rates;
      }
      throw new Error('CURRENCY_RATE_UNAVAILABLE');
    }
  }
}

export const currencyRateService = new CurrencyRateService();
