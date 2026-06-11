/**
 * @statok/shared — public surface.
 *
 * Money/decimal helpers (CRR-3), pgEnum mirrors, and API DTO types.
 * No build step: consumed directly as TypeScript by both backend (Bun) and
 * frontend (Vite). main = this file.
 */

export * from './money';
export * from './decimal';
export * from './enums';
export * from './dto';
