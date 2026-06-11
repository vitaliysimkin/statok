/**
 * Minimal ambient types for bcryptjs ^2.4 (which ships no .d.ts; the published
 * @types/bcryptjs is a deprecated stub that only fits bcryptjs v3). The spec
 * (ТЗ §0) pins `bcryptjs ^2.4`, so we declare the promise-based surface we use.
 */
declare module 'bcryptjs' {
  export function genSalt(rounds?: number): Promise<string>
  export function hash(data: string, saltOrRounds: string | number): Promise<string>
  export function compare(data: string, encrypted: string): Promise<boolean>
  export function getRounds(encrypted: string): number
  export function hashSync(data: string, saltOrRounds?: string | number): string
  export function compareSync(data: string, encrypted: string): boolean
  export function genSaltSync(rounds?: number): string

  const bcrypt: {
    genSalt: typeof genSalt
    hash: typeof hash
    compare: typeof compare
    getRounds: typeof getRounds
    hashSync: typeof hashSync
    compareSync: typeof compareSync
    genSaltSync: typeof genSaltSync
  }
  export default bcrypt
}
