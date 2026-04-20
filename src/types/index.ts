export enum OrderStatus {
  INITIATED = 'INITIATED',
  RESERVED = 'RESERVED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  ADMIN_CANCELLED = 'ADMIN_CANCELLED',
  SYSTEM_CANCELLED = 'SYSTEM_CANCELLED',
  USER_CANCELLED = 'USER_CANCELLED',
}

export enum Currency {
  TRX = 'TRX',
  USDT_TRC20 = 'USDT_TRC20',
  USDT_ERC20 = 'USDT_ERC20',
  USDT_BEP20 = 'USDT_BEP20',
  BNB = 'BNB',
  ETH = 'ETH',
}

export enum StockItemStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  SOLD = 'SOLD',
}

export enum JobType {
  VERIFY_PAYMENT = 'VERIFY_PAYMENT',
  EXPIRE_RESERVATION = 'EXPIRE_RESERVATION',
  DELIVER_STOCK = 'DELIVER_STOCK',
}

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export interface User {
  id: string;
  username: string | null;
  firstName: string;
  balanceUsdCents: string;
  isBanned: boolean;
  createdAt: Date;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  priceUsdCents: string;
  imageFileId: string | null;
  isActive: boolean;
}

export interface StockItem {
  id: string;
  productId: number;
  content: string;
  status: StockItemStatus;
  reservedByOrder: string | null;
  reservedAt: Date | null;
  soldAt: Date | null;
}

export interface Order {
  id: string;
  userId: string;
  productId: number;
  stockItemId: string | null;
  status: OrderStatus;
  currency: Currency;
  region: string | null;
  requiredAmount: string;
  cryptoAmountSnapshot: string | null;
  usdRateSnapshot: string | null;
  depositAddress: string;
  walletId: number | null;
  txid: string | null;
  txidSubmittedAt: Date | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date;
  failureReason: string | null;
  priceSnapshot: string;
  createdAt: Date;
}

export interface BackgroundJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedUntil: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
}

export const VALID_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.INITIATED]: [OrderStatus.RESERVED, OrderStatus.SYSTEM_CANCELLED],
  [OrderStatus.RESERVED]: [OrderStatus.PENDING_VERIFICATION, OrderStatus.PENDING_REVIEW, OrderStatus.EXPIRED, OrderStatus.ADMIN_CANCELLED, OrderStatus.USER_CANCELLED],
  [OrderStatus.PENDING_VERIFICATION]: [OrderStatus.PAYMENT_CONFIRMED, OrderStatus.PAYMENT_FAILED],
  [OrderStatus.PENDING_REVIEW]: [OrderStatus.COMPLETED, OrderStatus.PAYMENT_FAILED],
  [OrderStatus.PAYMENT_FAILED]: [OrderStatus.PENDING_VERIFICATION, OrderStatus.PENDING_REVIEW, OrderStatus.EXPIRED, OrderStatus.USER_CANCELLED],
  [OrderStatus.PAYMENT_CONFIRMED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.ADMIN_CANCELLED]: [],
  [OrderStatus.SYSTEM_CANCELLED]: [],
  [OrderStatus.USER_CANCELLED]: [],
};

export interface VerifyPaymentPayload {
  orderId: string;
  txid: string;
  currency: Currency;
  requiredAmount: string;
  depositAddress: string;
}

export interface ExpireReservationPayload {
  orderId: string;
}

export interface DeliverStockPayload {
  orderId: string;
  userId: string;
}

export interface TxVerificationResult {
  success: boolean;
  confirmed: boolean;
  actualAmount?: string;
  failureReason?: string;
}