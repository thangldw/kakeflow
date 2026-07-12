import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type {
  AggregateAssetClass,
  AggregateAssetSnapshotCandidate,
  ImportAdapter,
  ParseIssue,
} from '../types'

const DATE_HEADER = '日付'
const TOTAL_HEADER = '合計(円)'

const ASSET_CLASS_HEADERS: readonly [string, AggregateAssetClass][] = [
  ['預金・現金・暗号資産(円)', 'DEPOSITS_CASH_CRYPTO'],
  ['株式(現物)(円)', 'LISTED_STOCKS'],
  ['投資信託(円)', 'INVESTMENT_TRUSTS'],
  ['債券(円)', 'BONDS'],
  ['FX(円)', 'FX'],
  ['保険(円)', 'INSURANCE'],
  ['不動産(円)', 'REAL_ESTATE'],
  ['年金(円)', 'PENSIONS'],
  ['ポイント(円)', 'POINTS'],
  ['その他の資産(円)', 'OTHER_ASSETS'],
]

const OFFICIAL_HEADERS = new Set([DATE_HEADER, TOTAL_HEADER, ...ASSET_CLASS_HEADERS.map(([header]) => header)])

function integerJpy(value: string | undefined): number | null {
  const parsed = parseJapaneseAmount(value)
  return parsed != null && parsed >= 0 && Number.isSafeInteger(parsed) ? parsed : null
}

function headerEvidence(headers: readonly string[]): { required: boolean; categories: number } {
  return {
    required: headers.includes(DATE_HEADER) && headers.includes(TOTAL_HEADER),
    categories: ASSET_CLASS_HEADERS.filter(([header]) => headers.includes(header)).length,
  }
}

export const moneyForwardAssetTrendAdapter: ImportAdapter<AggregateAssetSnapshotCandidate> = {
  id: 'money-forward-me-asset-trend-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headers = (csv.rows[0]?.fields ?? []).map(normalizeHeader)
    const evidence = headerEvidence(headers)
    const score = !evidence.required
      ? 0
      : evidence.categories === 0
        ? 0.45
        : clampScore(0.72 + evidence.categories * 0.025)
    return {
      adapterId: this.id,
      score,
      reasons: [
        evidence.required ? 'Official date and total headers matched' : 'Official date and total headers missing',
        `${evidence.categories}/${ASSET_CLASS_HEADERS.length} official asset-class headers matched`,
      ],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerRow = csv.rows[0]
    const headers = (headerRow?.fields ?? []).map(normalizeHeader)
    const evidence = headerEvidence(headers)
    if (!headerRow || !evidence.required) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, {
          code: 'MONEY_FORWARD_ASSET_HEADERS_MISSING',
          message: 'Money Forward ME asset-trend date and total headers were not found.',
          severity: 'error',
          row: headerRow?.sourceRow,
        }],
        metadata: {},
      }
    }

    const unknownHeaders = headers.filter((header) => header && !OFFICIAL_HEADERS.has(header))
    const records: AggregateAssetSnapshotCandidate[] = []
    for (const row of csv.rows.slice(1)) {
      const values = rowObject(headers, row)
      const asOf = parseJapaneseDate(values[DATE_HEADER])
      const totalAssetsJpy = integerJpy(values[TOTAL_HEADER])
      let invalid = false
      if (!asOf) {
        issues.push({
          code: 'MONEY_FORWARD_ASSET_DATE_INVALID',
          message: 'Asset-trend row has an invalid or unsupported date.',
          severity: 'error',
          row: row.sourceRow,
          column: DATE_HEADER,
        })
        invalid = true
      }
      if (totalAssetsJpy == null) {
        issues.push({
          code: 'MONEY_FORWARD_ASSET_TOTAL_INVALID',
          message: 'Asset-trend row requires an integer JPY total.',
          severity: 'error',
          row: row.sourceRow,
          column: TOTAL_HEADER,
        })
        invalid = true
      }
      const assetClasses = ASSET_CLASS_HEADERS.flatMap(([officialHeader, assetClass]) => {
        if (!headers.includes(officialHeader)) return []
        const raw = values[officialHeader]
        if (!raw?.trim()) return []
        const valueJpy = integerJpy(raw)
        if (valueJpy == null) {
          issues.push({
            code: 'MONEY_FORWARD_ASSET_CLASS_INVALID',
            message: `${officialHeader} must be an integer JPY value when present.`,
            severity: 'error',
            row: row.sourceRow,
            column: officialHeader,
          })
          invalid = true
          return []
        }
        return [{ assetClass, officialHeader, valueJpy }]
      })
      if (!invalid && asOf && totalAssetsJpy != null) {
        records.push({ kind: 'aggregate-asset-snapshot', lineage: row, asOf, totalAssetsJpy, assetClasses })
      }
    }

    return {
      adapterId: this.id,
      records,
      issues,
      metadata: {
        snapshotKind: 'AGGREGATE_ASSET_HISTORY',
        headerRow: headerRow.sourceRow,
        categoryColumnCount: evidence.categories,
        unknownHeaders,
      },
    }
  },
}
