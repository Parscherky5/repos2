import axios from 'axios';
import { Currency, TxVerificationResult } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

/** On-chain contract addresses for supported stablecoins */
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_ERC20_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDT_BEP20_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';

/** Keccak-256 of "Transfer(address,address,uint256)" — standard ERC-20/BEP-20 event */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class PaymentService {
  async verifyTransaction(
    txid: string,
    currency: Currency,
    requiredAmount: string,
    depositAddress: string
  ): Promise<TxVerificationResult> {
    try {
      switch (currency) {
        case Currency.TRX:
          return await this.verifyTrxTransfer(txid, requiredAmount, depositAddress);
        case Currency.USDT_TRC20:
          return await this.verifyUsdtTrc20Transfer(txid, requiredAmount, depositAddress);
        case Currency.ETH:
          return await this.verifyEthTransfer(txid, requiredAmount, depositAddress);
        case Currency.USDT_ERC20:
          return await this.verifyEvmTokenTransfer(
            txid, requiredAmount, depositAddress,
            USDT_ERC20_CONTRACT, 'etherscan'
          );
        case Currency.BNB:
          return await this.verifyBnbTransfer(txid, requiredAmount, depositAddress);
        case Currency.USDT_BEP20:
          return await this.verifyEvmTokenTransfer(
            txid, requiredAmount, depositAddress,
            USDT_BEP20_CONTRACT, 'bscscan'
          );
        default:
          return {
            success: false,
            confirmed: true,
            failureReason: `Unsupported currency: ${String(currency)}`,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Payment verification threw', { txid, currency, error: msg });
      return { success: false, confirmed: false, failureReason: msg };
    }
  }

  // ─── TRX native transfer ──────────────────────────────────────────────────

  private async verifyTrxTransfer(
    txid: string,
    requiredAmount: string,
    depositAddress: string
  ): Promise<TxVerificationResult> {
    const headers = this.trongridHeaders();
    const res = await axios.get(
      `https://api.trongrid.io/v1/transactions/${txid}?visible=true`,
      { headers, timeout: 15_000 }
    );

    const txData = (res.data?.data as any[])?.[0];
    if (!txData) {
      return { success: false, confirmed: false, failureReason: 'Transaction not found on Trongrid' };
    }

    const contractRet: string = txData.ret?.[0]?.contractRet ?? '';
    if (contractRet !== 'SUCCESS') {
      return { success: false, confirmed: true, failureReason: `Contract result: ${contractRet}` };
    }

    const contract = txData.raw_data?.contract?.[0];
    if (contract?.type !== 'TransferContract') {
      return { success: false, confirmed: true, failureReason: 'Not a TRX TransferContract' };
    }

    const toAddress: string = contract.parameter?.value?.to_address ?? '';
    const amount: number = contract.parameter?.value?.amount ?? 0;

    if (toAddress.toLowerCase() !== depositAddress.toLowerCase()) {
      return {
        success: false,
        confirmed: true,
        failureReason: `Wrong recipient: expected ${depositAddress}, got ${toAddress}`,
      };
    }

    const actualBig = BigInt(amount);
    const requiredBig = BigInt(requiredAmount);

    if (actualBig < requiredBig) {
      return {
        success: false,
        confirmed: true,
        actualAmount: actualBig.toString(),
        failureReason: `Insufficient TRX: ${actualBig} sun < ${requiredBig} sun required`,
      };
    }

    return { success: true, confirmed: true, actualAmount: actualBig.toString() };
  }

  // ─── USDT-TRC20 transfer ─────────────────────────────────────────────────

  private async verifyUsdtTrc20Transfer(
    txid: string,
    requiredAmount: string,
    depositAddress: string
  ): Promise<TxVerificationResult> {
    const headers = this.trongridHeaders();

    // 1. Verify the parent transaction succeeded
    const txRes = await axios.get(
      `https://api.trongrid.io/v1/transactions/${txid}?visible=true`,
      { headers, timeout: 15_000 }
    );
    const txData = (txRes.data?.data as any[])?.[0];
    if (!txData) {
      return { success: false, confirmed: false, failureReason: 'Transaction not found on Trongrid' };
    }
    const contractRet: string = txData.ret?.[0]?.contractRet ?? '';
    if (contractRet !== 'SUCCESS') {
      return { success: false, confirmed: true, failureReason: `Contract result: ${contractRet}` };
    }

    // 2. Parse Transfer events
    const eventsRes = await axios.get(
      `https://api.trongrid.io/v1/transactions/${txid}/events`,
      { headers, timeout: 15_000 }
    );
    const events: any[] = eventsRes.data?.data ?? [];

    for (const ev of events) {
      if (ev.event_name !== 'Transfer') continue;
      const contractAddr: string = ev.contract_address ?? '';
      if (contractAddr.toLowerCase() !== USDT_TRC20_CONTRACT.toLowerCase()) continue;

      // result keys '0'=from, '1'=to, '2'=value
      const toAddr: string = ev.result?.['1'] ?? '';
      const value: string = ev.result?.['2'] ?? '0';

      if (toAddr.toLowerCase() !== depositAddress.toLowerCase()) continue;

      const valueBig = BigInt(value);
      const requiredBig = BigInt(requiredAmount);

      if (valueBig >= requiredBig) {
        return { success: true, confirmed: true, actualAmount: valueBig.toString() };
      }
      return {
        success: false,
        confirmed: true,
        actualAmount: valueBig.toString(),
        failureReason: `Insufficient USDT-TRC20: ${valueBig} < ${requiredBig} (smallest unit)`,
      };
    }

    return { success: false, confirmed: true, failureReason: 'No matching USDT-TRC20 Transfer event' };
  }

  // ─── ETH native transfer ─────────────────────────────────────────────────

  private async verifyEthTransfer(
    txid: string,
    requiredAmount: string,
    depositAddress: string
  ): Promise<TxVerificationResult> {
    const apiKey = config.blockchain.etherscanApiKey;
    const base = 'https://api.etherscan.io/api';

    const [txRes, rcpRes] = await Promise.all([
      axios.get(base, {
        params: { module: 'proxy', action: 'eth_getTransactionByHash', txhash: txid, apikey: apiKey },
        timeout: 15_000,
      }),
      axios.get(base, {
        params: { module: 'proxy', action: 'eth_getTransactionReceipt', txhash: txid, apikey: apiKey },
        timeout: 15_000,
      }),
    ]);

    const tx = txRes.data?.result;
    if (!tx) {
      return { success: false, confirmed: false, failureReason: 'Transaction not found on Etherscan' };
    }

    const receipt = rcpRes.data?.result;
    if (!receipt) {
      return { success: false, confirmed: false, failureReason: 'Transaction not yet confirmed (no receipt)' };
    }
    if (receipt.status === '0x0') {
      return { success: false, confirmed: true, failureReason: 'Transaction reverted on-chain' };
    }

    const toAddr: string = tx.to ?? '';
    if (toAddr.toLowerCase() !== depositAddress.toLowerCase()) {
      return {
        success: false,
        confirmed: true,
        failureReason: `Wrong recipient: expected ${depositAddress}, got ${toAddr}`,
      };
    }

    const valueBig = BigInt(tx.value ?? '0x0');
    const requiredBig = BigInt(requiredAmount);

    if (valueBig < requiredBig) {
      return {
        success: false,
        confirmed: true,
        actualAmount: valueBig.toString(),
        failureReason: `Insufficient ETH: ${valueBig} wei < ${requiredBig} wei required`,
      };
    }

    return { success: true, confirmed: true, actualAmount: valueBig.toString() };
  }

  // ─── BNB native transfer ─────────────────────────────────────────────────

  private async verifyBnbTransfer(
    txid: string,
    requiredAmount: string,
    depositAddress: string
  ): Promise<TxVerificationResult> {
    const apiKey = config.blockchain.bscscanApiKey;
    const base = 'https://api.bscscan.com/api';

    const [txRes, rcpRes] = await Promise.all([
      axios.get(base, {
        params: { module: 'proxy', action: 'eth_getTransactionByHash', txhash: txid, apikey: apiKey },
        timeout: 15_000,
      }),
      axios.get(base, {
        params: { module: 'proxy', action: 'eth_getTransactionReceipt', txhash: txid, apikey: apiKey },
        timeout: 15_000,
      }),
    ]);

    const tx = txRes.data?.result;
    if (!tx) {
      return { success: false, confirmed: false, failureReason: 'Transaction not found on BSCScan' };
    }

    const receipt = rcpRes.data?.result;
    if (!receipt) {
      return { success: false, confirmed: false, failureReason: 'Transaction not yet confirmed (no receipt)' };
    }
    if (receipt.status === '0x0') {
      return { success: false, confirmed: true, failureReason: 'Transaction reverted on BSC' };
    }

    const toAddr: string = tx.to ?? '';
    if (toAddr.toLowerCase() !== depositAddress.toLowerCase()) {
      return {
        success: false,
        confirmed: true,
        failureReason: `Wrong recipient: expected ${depositAddress}, got ${toAddr}`,
      };
    }

    const valueBig = BigInt(tx.value ?? '0x0');
    const requiredBig = BigInt(requiredAmount);

    if (valueBig < requiredBig) {
      return {
        success: false,
        confirmed: true,
        actualAmount: valueBig.toString(),
        failureReason: `Insufficient BNB: ${valueBig} wei < ${requiredBig} wei required`,
      };
    }

    return { success: true, confirmed: true, actualAmount: valueBig.toString() };
  }

  // ─── Generic EVM ERC-20 / BEP-20 token transfer ──────────────────────────

  private async verifyEvmTokenTransfer(
    txid: string,
    requiredAmount: string,
    depositAddress: string,
    contractAddress: string,
    chain: 'etherscan' | 'bscscan'
  ): Promise<TxVerificationResult> {
    const apiKey =
      chain === 'etherscan'
        ? config.blockchain.etherscanApiKey
        : config.blockchain.bscscanApiKey;
    const base =
      chain === 'etherscan'
        ? 'https://api.etherscan.io/api'
        : 'https://api.bscscan.com/api';

    const rcpRes = await axios.get(base, {
      params: {
        module: 'proxy',
        action: 'eth_getTransactionReceipt',
        txhash: txid,
        apikey: apiKey,
      },
      timeout: 15_000,
    });

    const receipt = rcpRes.data?.result;
    if (!receipt) {
      return { success: false, confirmed: false, failureReason: 'Transaction not yet confirmed (no receipt)' };
    }
    if (receipt.status === '0x0') {
      return { success: false, confirmed: true, failureReason: 'Transaction reverted on-chain' };
    }

    for (const log of (receipt.logs as any[]) ?? []) {
      if (log.address?.toLowerCase() !== contractAddress.toLowerCase()) continue;
      if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;

      // topics[2] = to-address padded to 32 bytes
      const toAddressPadded: string = log.topics[2] ?? '';
      const toAddress = '0x' + toAddressPadded.slice(-40);

      if (toAddress.toLowerCase() !== depositAddress.toLowerCase()) continue;

      const valueBig = BigInt(log.data ?? '0x0');
      const requiredBig = BigInt(requiredAmount);

      if (valueBig >= requiredBig) {
        return { success: true, confirmed: true, actualAmount: valueBig.toString() };
      }
      return {
        success: false,
        confirmed: true,
        actualAmount: valueBig.toString(),
        failureReason: `Insufficient token amount: ${valueBig} < ${requiredBig} (smallest unit)`,
      };
    }

    return {
      success: false,
      confirmed: true,
      failureReason: 'No matching token Transfer event found in receipt',
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private trongridHeaders(): Record<string, string> {
    const key = config.blockchain.trongridApiKey;
    return key ? { 'TRON-PRO-API-KEY': key } : {};
  }
}

export const paymentService = new PaymentService();
