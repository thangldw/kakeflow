import { parseExactIntegerAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const TOKEN = /<(\/?)([A-Za-z0-9.]+)>([^<]*)/g

interface Token {
  closing: boolean
  tag: string
  value: string
  line: number
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** Tokenizes OFX 1.x (SGML, unclosed leaf tags) and 2.x (XML) with the same scanner. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') lineStarts.push(index + 1)
  const lineOf = (offset: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (lineStarts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
  for (const match of text.matchAll(TOKEN)) {
    tokens.push({
      closing: match[1] === '/', tag: match[2].toUpperCase(),
      value: decodeEntities(match[3]).trim(), line: lineOf(match.index ?? 0),
    })
  }
  return tokens
}

function hasContentSignal(text: string): boolean {
  return /<OFX[\s>]/i.test(text) && /<STMTTRN>/i.test(text)
}

/** OFX DTPOSTED keeps the calendar date exactly as written; time and zone are not converted. */
function ofxDate(value: string | undefined): string | null {
  const match = (value ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:\d{2,6}(?:\.\d+)?)?(?:\[[^\]]*\])?$/)
  return match ? parseJapaneseDate(`${match[1]}-${match[2]}-${match[3]}`) : null
}

/**
 * OFX/QFX bank-statement adapter (STMTRS only). Credit-card and investment
 * statements, multiple accounts in one file, non-JPY currency, fractional yen,
 * correction records and duplicate FITIDs all fail closed.
 */
export const ofxBankStatementAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'ofx-bank-statement-v1',
  detect(input) {
    const found = hasContentSignal(input.text)
    return {
      adapterId: this.id,
      score: found ? 1 : 0,
      reasons: [found ? 'OFX root element and STMTTRN aggregate found' : 'OFX root element with STMTTRN aggregate not found'],
    }
  },
  parse(input) {
    const tokens = tokenize(input.text)
    const issues: ParseIssue[] = []
    const records: BankTransactionCandidate[] = []
    const fitIds = new Set<string>()
    const accounts = new Set<string>()
    const metadata: Record<string, unknown> = {}

    let section: 'STMTRS' | 'CCSTMTRS' | 'INVSTMTRS' | null = null
    let currency: string | null = null
    let bankId = ''
    let accountId = ''
    let inFrom = false
    let inLedgerBalance = false
    let current: { startLine: number; fields: Record<string, string>; raw: string[]; foreign: boolean; inCurrency: boolean } | null = null
    const unsupportedSections = new Set<string>()
    let currencyFlagged = false

    const finishTransaction = (endLine: number) => {
      if (!current) return
      const { fields, raw, startLine, foreign } = current
      current = null
      const row = startLine
      const lineage = { sourceRow: startLine, sourceRowEnd: endLine, rawFields: raw }
      const fitId = fields.FITID ?? ''
      if (!fitId) {
        issues.push({ code: 'OFX_FITID_MISSING', message: 'OFX transaction has no FITID; a durable transaction identity is required.', severity: 'error', row })
        return
      }
      if (fitIds.has(fitId)) {
        issues.push({ code: 'OFX_FITID_DUPLICATE', message: 'OFX FITID is duplicated within this file.', severity: 'error', row, column: 'FITID' })
        return
      }
      fitIds.add(fitId)
      if (foreign) {
        issues.push({ code: 'OFX_FOREIGN_CURRENCY_UNSUPPORTED', message: 'OFX transaction carries its own currency conversion, which is not supported.', severity: 'error', row, column: 'CURRENCY' })
        return
      }
      if (fields.CORRECTFITID || fields.CORRECTACTION) {
        issues.push({ code: 'OFX_CORRECTION_UNSUPPORTED', message: 'OFX correction records (CORRECTFITID/CORRECTACTION) are not supported.', severity: 'error', row })
        return
      }
      const transactionDate = ofxDate(fields.DTPOSTED)
      if (!transactionDate) issues.push({ code: 'OFX_DATE_INVALID', message: 'OFX DTPOSTED must start with a valid YYYYMMDD date.', severity: 'error', row, column: 'DTPOSTED' })
      const amount = parseExactIntegerAmount(fields.TRNAMT)
      if (amount == null || amount === 0) {
        issues.push({ code: 'OFX_AMOUNT_INVALID', message: 'OFX TRNAMT must be a non-zero whole-yen amount.', severity: 'error', row, column: 'TRNAMT' })
      }
      const name = fields.NAME ?? ''
      const memo = fields.MEMO ?? ''
      const scope = [bankId, accountId].filter(Boolean).join(':')
      records.push({
        kind: 'bank-transaction',
        lineage,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        externalTransactionId: `ofx:${scope ? `${scope}:` : ''}${fitId}`,
        transactionDate,
        description: name || memo,
        descriptionDetail: name ? memo : '',
        outgoingAmount: amount != null && amount < 0 ? -amount : null,
        incomingAmount: amount != null && amount > 0 ? amount : null,
        balance: null,
        memo: '',
        fundsAvailabilityCode: '',
        debitCreditCode: amount != null && amount < 0 ? 'OUT' : 'IN',
        suggestedType: 'UNKNOWN',
      })
    }

    for (const token of tokens) {
      const { closing, tag, value, line } = token
      if (tag === 'CCSTMTRS' || tag === 'INVSTMTRS' || tag === 'STMTRS') {
        if (closing) { section = null; inFrom = false; inLedgerBalance = false } else {
          section = tag
          if (tag !== 'STMTRS') unsupportedSections.add(tag)
          currency = null; bankId = ''; accountId = ''
        }
        continue
      }
      if (section !== 'STMTRS') continue
      if (tag === 'BANKACCTFROM') { inFrom = !closing; continue }
      if (tag === 'LEDGERBAL') { inLedgerBalance = !closing; continue }
      if (tag === 'STMTTRN') {
        if (closing) finishTransaction(line)
        else {
          current = { startLine: line, fields: {}, raw: [], foreign: false, inCurrency: false }
          if (currency !== 'JPY' && !currencyFlagged) {
            currencyFlagged = true
            issues.push({ code: 'OFX_CURRENCY_UNSUPPORTED', message: `OFX CURDEF must be JPY (found ${currency ?? 'none'}); foreign-currency statements are not supported.`, severity: 'error', row: line, column: 'CURDEF' })
          }
        }
        continue
      }
      if (closing) { if (tag === 'CURRENCY' || tag === 'ORIGCURRENCY') { if (current) current.inCurrency = false } continue }
      if (current) {
        if (tag === 'CURRENCY' || tag === 'ORIGCURRENCY') { current.foreign = true; current.inCurrency = true; current.raw.push(tag); continue }
        if (!current.inCurrency && value && !(tag in current.fields)) current.fields[tag] = value
        current.raw.push(value ? `${tag}=${value}` : tag)
        continue
      }
      if (tag === 'CURDEF' && value) currency = value.toUpperCase()
      else if (inFrom && tag === 'BANKID') bankId = value
      else if (inFrom && tag === 'ACCTID') { accountId = value; if (value) accounts.add(`${bankId}:${value}`) }
      else if (inLedgerBalance && tag === 'BALAMT') metadata.ledgerBalance = value
      else if (inLedgerBalance && tag === 'DTASOF') metadata.ledgerBalanceAsOf = ofxDate(value)
    }

    if (unsupportedSections.size > 0) {
      issues.push({ code: 'OFX_UNSUPPORTED_STATEMENT_TYPE', message: 'Only OFX bank statements (STMTRS) are supported; credit-card and investment statements must be imported through their own adapters.', severity: 'error' })
    }
    if (accounts.size > 1) {
      issues.push({ code: 'OFX_MULTIPLE_ACCOUNTS', message: 'An OFX file with more than one account cannot be mapped to a single destination account.', severity: 'error' })
    }
    return { adapterId: this.id, records, issues, metadata: { ...metadata, accountCount: accounts.size } }
  },
}
