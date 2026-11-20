/** Income-tax marginal rate (as a fraction) for a taxable income in yen, using the national brackets. */
export function incomeTaxRate(taxableIncomeJpy: number): number {
  if (taxableIncomeJpy <= 1_950_000) return 0.05
  if (taxableIncomeJpy <= 3_300_000) return 0.10
  if (taxableIncomeJpy <= 6_950_000) return 0.20
  if (taxableIncomeJpy <= 9_000_000) return 0.23
  if (taxableIncomeJpy <= 18_000_000) return 0.33
  if (taxableIncomeJpy <= 40_000_000) return 0.40
  return 0.45
}

export interface FurusatoEstimate {
  readonly rate: number
  /** Donation total after which the ¥2,000 self-pay no longer covers the full deduction. */
  readonly limitJpy: number
  readonly remainingJpy: number | null
}

/**
 * Rough yearly limit for furusato nozei with the full deduction, using the published approximation
 * `resident tax income portion × 20% ÷ (90% − income tax rate × 1.021) + ¥2,000`. It is an ESTIMATE: the real
 * limit depends on the exact deductions and the municipality, so the result must be confirmed before donating.
 * Returns null for inputs that cannot be used.
 */
export function estimateFurusatoLimit(taxableIncomeJpy: number, residentIncomePortionJpy: number, donatedJpy: number | null): FurusatoEstimate | null {
  if (![taxableIncomeJpy, residentIncomePortionJpy].every((value) => Number.isFinite(value) && value >= 0)) return null
  if (residentIncomePortionJpy === 0) return null
  if (donatedJpy !== null && (!Number.isFinite(donatedJpy) || donatedJpy < 0)) return null
  const rate = incomeTaxRate(taxableIncomeJpy)
  const limitJpy = Math.floor((residentIncomePortionJpy * 0.2) / (0.9 - rate * 1.021) + 2000)
  return { rate, limitJpy, remainingJpy: donatedJpy === null ? null : Math.max(0, limitJpy - donatedJpy) }
}
