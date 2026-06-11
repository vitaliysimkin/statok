/**
 * Enum mirrors of the Postgres pgEnum definitions — ТЗ §7.1.
 *
 * Keep these in lockstep with `backend/src/db/schema.ts`. Each is a readonly
 * tuple (usable for runtime validation / iteration) plus a derived union type.
 */

export const ASSET_TYPES = ['stock', 'etf', 'crypto', 'bond', 'cash'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const TRANSACTION_TYPES = [
  'buy',
  'sell',
  'deposit',
  'withdraw',
  'transfer_out',
  'transfer_in',
  'dividend',
  'coupon',
  'interest',
  'split',
  'ticker_change',
  'opening_balance',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_KINDS = ['broker', 'exchange', 'bank', 'wallet', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const PRICE_SOURCES = ['yahoo', 'manual'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const FX_SOURCES = ['frankfurter', 'nbu', 'manual'] as const;
export type FxSource = (typeof FX_SOURCES)[number];

/** Narrowing guards (handy for request validation). */
export const isAssetType = (v: unknown): v is AssetType =>
  typeof v === 'string' && (ASSET_TYPES as readonly string[]).includes(v);

export const isTransactionType = (v: unknown): v is TransactionType =>
  typeof v === 'string' && (TRANSACTION_TYPES as readonly string[]).includes(v);

export const isAccountKind = (v: unknown): v is AccountKind =>
  typeof v === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(v);

export const isPriceSource = (v: unknown): v is PriceSource =>
  typeof v === 'string' && (PRICE_SOURCES as readonly string[]).includes(v);

export const isFxSource = (v: unknown): v is FxSource =>
  typeof v === 'string' && (FX_SOURCES as readonly string[]).includes(v);
