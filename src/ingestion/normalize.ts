export function normalizeJapaneseText(value: string): string {
  // Keep the Japanese prolonged sound mark (ー): unlike dash variants it is
  // semantically part of words such as カード and レート.
  return value.normalize('NFKC').replace(/[‐‑–—－]/g, '-').replace(/\s+/g, ' ').trim()
}

export function parseJapaneseAmount(value: string | undefined): number | null {
  if (value == null) return null
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized === '-' || normalized === '—') return null
  const negative = /^\(.*\)$/.test(normalized) || normalized.startsWith('-') || normalized.startsWith('△') || normalized.endsWith('△')
  const numeric = normalized.replace(/[¥￥円,\s()+△]/g, '').replace(/^\+/, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(numeric)) return null
  const parsed = Number(numeric)
  return negative ? -Math.abs(parsed) : parsed
}

/** Returns ISO calendar date. Era years are intentionally unsupported. */
export function parseJapaneseDate(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.normalize('NFKC').trim()
  const match = normalized.match(/^(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})日?$/)
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseJapaneseDateTime(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.normalize('NFKC').trim()
  const match = normalized.match(/^(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})日?[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return parseJapaneseDate(normalized)
  const date = parseJapaneseDate(`${match[1]}-${match[2]}-${match[3]}`)
  if (!date) return null
  return `${date}T${String(Number(match[4])).padStart(2, '0')}:${match[5]}:${match[6] ?? '00'}+09:00`
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score))
}
