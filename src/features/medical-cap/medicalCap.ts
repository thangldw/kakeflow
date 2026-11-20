export type IncomeBand = 'TOP' | 'HIGH' | 'MIDDLE' | 'LOW' | 'EXEMPT'

interface BandRule { readonly base: number; readonly threshold: number; readonly repeatCap: number }

// Monthly self-pay caps for people under 70 (a published schedule; verify it is still current before relying on it).
// Above `threshold` of total medical cost, 1% of the excess is added to `base`.
const RULES: Readonly<Record<Exclude<IncomeBand, 'LOW' | 'EXEMPT'>, BandRule>> = {
  TOP: { base: 252_600, threshold: 842_000, repeatCap: 140_100 },
  HIGH: { base: 167_400, threshold: 558_000, repeatCap: 93_000 },
  MIDDLE: { base: 80_100, threshold: 267_000, repeatCap: 44_400 },
}
const FLAT: Readonly<Record<'LOW' | 'EXEMPT', { readonly cap: number; readonly repeatCap: number }>> = {
  LOW: { cap: 57_600, repeatCap: 44_400 },
  EXEMPT: { cap: 35_400, repeatCap: 24_600 },
}

export interface MedicalCapEstimate {
  readonly totalCostJpy: number
  readonly capJpy: number
  readonly refundJpy: number
}

/**
 * Estimates the 高額療養費 cap for one month and what could come back, from the amount paid at the counter
 * (assumed to be the usual 30%). It is an ESTIMATE: meals, bed-difference charges and uncovered treatment do not
 * count, and the insurer decides the real figure. Returns null for unusable input.
 */
export function estimateMedicalCap(band: IncomeBand, paidJpy: number, repeat: boolean): MedicalCapEstimate | null {
  if (!Number.isFinite(paidJpy) || paidJpy < 0) return null
  const totalCostJpy = Math.round(paidJpy / 0.3)
  let capJpy: number
  if (band === 'LOW' || band === 'EXEMPT') {
    const flat = FLAT[band]
    capJpy = repeat ? flat.repeatCap : flat.cap
  } else {
    const rule = RULES[band]
    capJpy = repeat ? rule.repeatCap : rule.base + Math.max(0, Math.floor((totalCostJpy - rule.threshold) / 100))
  }
  return { totalCostJpy, capJpy, refundJpy: Math.max(0, paidJpy - capJpy) }
}
