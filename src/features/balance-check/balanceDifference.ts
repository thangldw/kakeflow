export type BalanceVerdict =
  | { readonly kind: 'MATCH' }
  | { readonly kind: 'BANK_HIGHER'; readonly differenceJpy: number }
  | { readonly kind: 'BANK_LOWER'; readonly differenceJpy: number }

/** Compares the balance the account really shows with the ledger's. `differenceJpy` is always positive. */
export function compareBalance(actualJpy: number, ledgerJpy: number): BalanceVerdict | null {
  if (!Number.isSafeInteger(actualJpy) || !Number.isSafeInteger(ledgerJpy)) return null
  if (actualJpy === ledgerJpy) return { kind: 'MATCH' }
  return actualJpy > ledgerJpy
    ? { kind: 'BANK_HIGHER', differenceJpy: actualJpy - ledgerJpy }
    : { kind: 'BANK_LOWER', differenceJpy: ledgerJpy - actualJpy }
}

/** Parses a typed amount ("1,234,567", full-width commas allowed); null when empty or not a whole number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,，\s¥￥]/gu, '')
  if (cleaned === '' || !/^-?\d+$/u.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isSafeInteger(value) ? value : null
}
