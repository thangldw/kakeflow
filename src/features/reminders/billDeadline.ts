import { parseJapaneseAmount, parseJapaneseDate } from '../../ingestion/normalize'

/**
 * Finds a payment deadline (and, when it sits near the same wording, an amount) in the text of a scanned bill.
 * A SUGGESTION for the user to confirm: OCR misreads digits, and a bill can carry several dates (issue date,
 * meter reading period). Only a date introduced by deadline wording is considered, never a bare date.
 */
export interface BillDeadlineSuggestion {
  readonly dueOn: string
  /** The amount found beside the deadline or a "total/amount billed" label; null when there is none. */
  readonly amountJpy: number | null
  /** The wording that introduced the date, e.g. "お支払期限". */
  readonly marker: string
}

const MARKERS = ['お支払期限', 'お支払い期限', 'お支払期日', 'お支払い期日', '支払期限', '支払期日', '納付期限', '納期限', '振替日', '引落日', '引き落とし日', 'Payment due', 'Due date', 'Due']
// The invoice date alone is not a deadline, so it is not listed above; 振替日 and 引落日 are the day a card or
// utility is debited, which is what the user needs to have money for.

const ERA_BASE: Readonly<Record<string, number>> = { 令和: 2018, 平成: 1988, 昭和: 1925, R: 2018, H: 1988, S: 1925 }

function eraDate(text: string): string | null {
  const match = text.match(/(令和|平成|昭和|[RHS])\s*(\d{1,2}|元)\s*[年./]\s*(\d{1,2})\s*[月./]\s*(\d{1,2})\s*日?/u)
  if (!match) return null
  const year = (ERA_BASE[match[1]] ?? 0) + (match[2] === '元' ? 1 : Number(match[2]))
  return parseJapaneseDate(`${year}-${match[3]}-${match[4]}`)
}

function westernDate(text: string): string | null {
  const match = text.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/u)
  return match ? parseJapaneseDate(`${match[1]}-${match[2]}-${match[3]}`) : null
}

const AMOUNT_LABELS = /(?:ご請求金額|お支払金額|お支払い金額|請求金額|ご利用金額|合計金額|納付額|Amount due|Total)\s*[:：]?\s*([¥￥]?\s*[\d,]+\s*円?)/iu

export function suggestBillDeadline(text: string): BillDeadlineSuggestion | null {
  const normalized = text.normalize('NFKC')
  let best: { index: number; marker: string; dueOn: string } | null = null
  for (const marker of MARKERS) {
    const needle = marker.normalize('NFKC')
    let from = 0
    for (;;) {
      const index = normalized.toLowerCase().indexOf(needle.toLowerCase(), from)
      if (index < 0) break
      from = index + needle.length
      // The date must follow the wording closely; a date far away belongs to something else.
      const window = normalized.slice(from, from + 24)
      const dueOn = eraDate(window) ?? westernDate(window)
      if (dueOn && (best === null || index < best.index)) best = { index, marker, dueOn }
    }
  }
  if (!best) return null
  const amountMatch = normalized.match(AMOUNT_LABELS)
  const amount = amountMatch ? parseJapaneseAmount(amountMatch[1]) : null
  return { dueOn: best.dueOn, amountJpy: amount !== null && amount > 0 ? amount : null, marker: best.marker }
}
