/**
 * Parses text typed into a yen field: full-width digits, commas, spaces and the
 * ¥/円 marks are accepted; anything that is not a whole number returns null.
 * An empty field means 0.
 */
export function parseYenText(text: string, allowNegative = false): number | null {
  const normalized = text.normalize('NFKC').replace(/[,\s¥￥円]/g, '')
  if (normalized === '') return 0
  const match = normalized.match(/^(-?)(\d{1,15})$/)
  if (!match || (match[1] === '-' && !allowNegative)) return null
  const value = Number(match[2])
  return match[1] === '-' ? -value : value
}

export function formatYenText(value: number): string {
  return value.toLocaleString('ja-JP')
}
