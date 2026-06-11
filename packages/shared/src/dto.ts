/**
 * DTO types for the Statok REST API — ТЗ §7.2 (API surface) and §7.1 (data model).
 *
 * Conventions (ТЗ §7.2 "Конвенції"):
 *   - Money amounts: integer minor units, field suffix `*Minor` (TS `number`) + ISO `currency`.
 *   - Numeric values (quantity / price / rate): decimal `string` (drizzle `numeric` default).
 *   - Business dates: `YYYY-MM-DD` strings (TS alias `IsoDate`).
 *   - Timestamps: ISO-8601 strings (TS alias `IsoDateTime`).
 *   - Fields not applicable to a row/type are `null`.
 */

import type { AccountKind, AssetType, FxSource, PriceSource, TransactionType } from './enums';

/** `YYYY-MM-DD` business date. */
export type IsoDate = string;
/** ISO-8601 timestamp (timestamptz). */
export type IsoDateTime = string;
/** ISO-4217 currency code (`char(3)`). */
export type CurrencyCode = string;

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  note: string;
  sortOrder: number;
  /** Optional informational fields for deposit accounts (kind='bank'). */
  interestRatePercent?: string | null;
  termEndDate?: IsoDate | null;
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Per-currency cash balance row for an account (from `?withBalances=true`). */
export interface AccountBalance {
  currency: CurrencyCode;
  cashMinor: number;
}

/** Account enriched with balances/valuation (GET /api/accounts?withBalances=true). */
export interface AccountWithBalances extends Account {
  balances?: AccountBalance[];
  valueBaseMinor?: number;
  /** True if some position lacks a price and is excluded from totals. */
  valuationIncomplete?: boolean;
}

export interface CreateAccountRequest {
  name: string;
  kind?: AccountKind;
  note?: string;
  interestRatePercent?: string | null;
  termEndDate?: IsoDate | null;
}

export interface UpdateAccountRequest {
  name?: string;
  kind?: AccountKind;
  note?: string;
  sortOrder?: number;
  archived?: boolean;
  interestRatePercent?: string | null;
  termEndDate?: IsoDate | null;
}

// ── Assets & bonds ──────────────────────────────────────────────────────────

export interface BondDetails {
  assetId: string;
  /** Face value of one bond, minor units of the asset currency. */
  faceValueMinor: number;
  /** Annual coupon rate, percent — numeric string (e.g. "15.7500"). */
  couponRatePercent: string;
  /** Coupons per year: 1|2|4|12; 0 = zero-coupon. */
  couponFrequency: number;
  issueDate: IsoDate | null;
  maturityDate: IsoDate;
  isin: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Asset {
  id: string;
  type: AssetType;
  symbol: string;
  name: string;
  currency: CurrencyCode;
  priceSource: PriceSource;
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Present (nested) for type='bond'. */
  bond?: BondDetails | null;
}

export interface BondInput {
  faceValueMinor: number;
  couponRatePercent: string;
  couponFrequency: number;
  maturityDate: IsoDate;
  issueDate?: IsoDate | null;
  isin?: string | null;
}

export interface CreateAssetRequest {
  type: AssetType;
  symbol: string;
  name?: string;
  currency: CurrencyCode;
  priceSource?: PriceSource;
  bond?: BondInput;
}

export interface UpdateAssetRequest {
  name?: string;
  currency?: CurrencyCode;
  priceSource?: PriceSource;
  archived?: boolean;
  bond?: BondInput;
}

/** One row of a bond coupon schedule (read-only, computed). */
export interface BondScheduleItem {
  date: IsoDate;
  amountMinor: number;
  isFuture: boolean;
  kind: 'coupon' | 'redemption';
}

export interface BondSchedule {
  items: BondScheduleItem[];
  currency: CurrencyCode;
}

export interface BondMetrics {
  ytmPercent: number;
  currentYieldPercent: number;
  /** Numeric price string actually used. */
  priceUsed: string;
  /** `face` = synthetic fallback nominal, not a `price_source` enum value. */
  priceBasis: PriceSource | 'face';
  asOf: IsoDate;
}

// ── Transactions ──────────────────────────────────────────────────────────────

/**
 * Persisted transaction row (GET /api/transactions/:id `{transaction}`).
 * Fields not applicable to the row's `type` are `null` (matrix — ТЗ §7.1.6).
 */
export interface Transaction {
  id: string;
  accountId: string;
  assetId: string;
  type: TransactionType;
  executedAt: IsoDateTime;
  /** Units of the asset; for `split` this is the multiplier. Numeric string. */
  quantity: string | null;
  /** Price per unit in `currency`. Numeric string. */
  price: string | null;
  amountMinor: number | null;
  currency: CurrencyCode;
  feeMinor: number;
  grossMinor: number | null;
  withholdingTaxMinor: number | null;
  netMinor: number | null;
  transferGroupId: string | null;
  note: string;
  meta: Record<string, unknown> | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * Denormalized list row (GET /api/transactions `{items, total}`) — carries
 * account/asset display fields. Inapplicable fields are `null`. ТЗ §4 (TransactionListItem).
 */
export interface TransactionListItem {
  id: string;
  type: TransactionType;
  executedAt: IsoDateTime;
  accountId: string;
  accountName: string;
  assetId: string;
  assetSymbol: string;
  assetType: AssetType;
  quantity: string | null;
  price: string | null;
  amountMinor: number | null;
  currency: CurrencyCode;
  feeMinor: number;
  grossMinor: number | null;
  withholdingTaxMinor: number | null;
  netMinor: number | null;
  transferGroupId: string | null;
  note: string;
}

export interface TransactionListResponse {
  items: TransactionListItem[];
  total: number;
}

export interface CreateTransactionRequest {
  accountId: string;
  /** Optional for pure-cash types — server resolves via ensureCashAsset(currency). */
  assetId?: string;
  type: TransactionType;
  executedAt: IsoDateTime;
  quantity?: string;
  price?: string;
  amountMinor?: number;
  currency: CurrencyCode;
  feeMinor?: number;
  grossMinor?: number;
  withholdingTaxMinor?: number;
  note?: string;
  meta?: Record<string, unknown>;
}

export interface CreateTransferRequest {
  fromAccountId: string;
  toAccountId: string;
  executedAt: IsoDateTime;
  outAmountMinor: number;
  outCurrency: CurrencyCode;
  inAmountMinor: number;
  inCurrency: CurrencyCode;
  note?: string;
}

export interface TickerChangeRequest {
  assetId: string;
  newSymbol: string;
  executedAt: IsoDateTime;
  note?: string;
}

// ── Portfolio: positions / valuation / pnl ─────────────────────────────────────

/** Minimal asset descriptor embedded in a position. */
export interface PositionAsset {
  id: string;
  type: AssetType;
  symbol: string;
  name: string;
  currency: CurrencyCode;
}

export interface Position {
  accountId: string;
  asset: PositionAsset;
  /** Held quantity — numeric string. */
  quantity: string;
  costBasisMinor: number;
  avgCostMinor: number;
  /** Last price (asset currency) — numeric string, or null if unpriced. */
  lastPrice: string | null;
  priceDate: IsoDate | null;
  /** Null when unpriced (stock/etf/crypto without a quote) — excluded from totals. */
  valueMinor: number | null;
  valueBaseMinor: number | null;
  unrealizedMinor: number | null;
  unrealizedBaseMinor: number | null;
  /** Unrealized / cost basis, as a ratio — numeric string, or null. */
  unrealizedPct: string | null;
  /** True when opening_balance lacked amount and no quote was available. */
  costBasisIncomplete?: boolean;
}

export interface CashBalance {
  accountId: string;
  currency: CurrencyCode;
  balanceMinor: number;
  balanceBaseMinor: number | null;
}

export interface PositionsResponse {
  positions: Position[];
  cash: CashBalance[];
  baseCurrency: CurrencyCode;
  asOf: IsoDate;
}

/** A single aggregation bucket — also the shape used inside snapshot breakdown. */
export interface ValuationByClass {
  class: AssetType;
  valueMinor: number;
}
export interface ValuationByAccount {
  accountId: string;
  name: string;
  valueMinor: number;
}
export interface ValuationByCurrency {
  currency: CurrencyCode;
  valueMinor: number;
}

export interface ValuationResponse {
  totalBaseMinor: number;
  byClass: ValuationByClass[];
  byAccount: ValuationByAccount[];
  byCurrency: ValuationByCurrency[];
  baseCurrency: CurrencyCode;
  asOf: IsoDate;
}

export interface PnlPerAsset {
  assetId: string;
  symbol: string;
  realizedMinor: number;
  incomeMinor: number;
  unrealizedMinor: number;
  currency: CurrencyCode;
  realizedBaseMinor: number;
  incomeBaseMinor: number;
  unrealizedBaseMinor: number;
}

export interface PnlResponse {
  realizedTradingBaseMinor: number;
  income: {
    dividendsBaseMinor: number;
    couponsBaseMinor: number;
    interestBaseMinor: number;
  };
  feesBaseMinor: number;
  unrealizedBaseMinor: number;
  totalBaseMinor: number;
  perAsset: PnlPerAsset[];
}

// ── Prices ─────────────────────────────────────────────────────────────────────

export interface PriceQuote {
  assetId: string;
  quoteDate: IsoDate;
  /** Price per unit (asset currency) — numeric string. */
  price: string;
  currency: CurrencyCode;
  source: PriceSource;
}

// ── FX ───────────────────────────────────────────────────────────────────────

/** Daily FX rate row. Semantics: 1 baseCcy = rate quoteCcy. */
export interface FxRate {
  rateDate: IsoDate;
  baseCcy: CurrencyCode;
  quoteCcy: CurrencyCode;
  /** Rate — numeric string (scale 8). */
  rate: string;
  source: FxSource;
}

/** GET /api/fx/convert response. `rateDate` ≤ requested date reveals a fallback. */
export interface FxConvertResponse {
  amountMinor: number;
  from: CurrencyCode;
  to: CurrencyCode;
  /** Applied rate — numeric string. */
  rateUsed: string;
  rateDate: IsoDate;
}

// ── Net worth snapshots ────────────────────────────────────────────────────────

/** Breakdown JSON stored on a snapshot (all values in base-currency minor units). */
export interface SnapshotBreakdown {
  byAccount: ValuationByAccount[];
  byClass: ValuationByClass[];
  byCurrency: ValuationByCurrency[];
}

export interface NetWorthSnapshot {
  snapshotDate: IsoDate;
  totalMinor: number;
  baseCurrency: CurrencyCode;
  breakdown: SnapshotBreakdown;
}

// ── Dashboards ─────────────────────────────────────────────────────────────────

export interface NetWorthSeriesPoint {
  date: IsoDate;
  totalMinor: number;
}
export interface NetWorthSeriesResponse {
  points: NetWorthSeriesPoint[];
  baseCurrency: CurrencyCode;
}

export interface CashflowPeriod {
  /** e.g. "2026-06" (month), "2026-Q2", "2026". */
  period: string;
  depositsMinor: number;
  withdrawalsMinor: number;
  dividendsMinor: number;
  couponsMinor: number;
  interestMinor: number;
  feesMinor: number;
  netMinor: number;
}
export interface CashflowResponse {
  periods: CashflowPeriod[];
  baseCurrency: CurrencyCode;
}

// ── Auth & settings ────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}
export interface LoginResponse {
  token: string;
  username: string;
}
export interface MeResponse {
  userId: string;
  username: string;
}

export interface JobState {
  lastRunAt: IsoDateTime | null;
  lastSuccessAt: IsoDateTime | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
}

export interface SettingsResponse {
  baseCurrency: CurrencyCode;
  version: string;
  jobs: {
    prices: JobState;
    fx: JobState;
    snapshot: JobState;
  };
}

/** Standard API error envelope — ТЗ §7.2 / CRR-2. */
export interface ApiError {
  error: string;
  message: string;
}
