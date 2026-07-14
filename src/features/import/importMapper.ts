import type {
  AdapterId,
  BankTransactionCandidate,
  CardStatementCandidate,
  CardTransactionCandidate,
  MoneyForwardHouseholdTransactionCandidate,
  ParsedImport,
  SourceLineage,
  WalletEventCandidate,
  WalletEventLegCandidate,
} from '../../ingestion/types'

const MAX_PAYLOAD_JSON_BYTES = 1_048_576
const encoder = new TextEncoder()

export type ImportSourceType = 'LOCAL_FOLDER' | 'ICLOUD_PICKER' | 'MANUAL_UPLOAD' | 'CAMERA_SCAN' | 'OTHER'
export type EvidenceRole = 'PRIMARY' | 'SUPPORTING' | 'FUNDING_LEG' | 'CONTINUATION'

export interface ImportFileMetadata {
  householdId: string
  sourceType: ImportSourceType
  originalFilename: string
  mediaType: string
  byteSize: number
  sha256: string
  sourceModifiedAt?: string | null
  accountId?: string | null
  adapterVersion?: string | null
}

export interface ImportMapperInput {
  file: ImportFileMetadata
  detectedAdapterId: AdapterId
  parsed: ParsedImport<unknown>
  /** Exact source-institution to canonical-account mapping for Money Forward ME household exports. */
  institutionAccountMappings?: Readonly<Record<string, string>>
}

export type ImportIdKind = 'run' | 'document' | 'sourceRecord' | 'candidate' | 'statement'
export interface IdFactory { next(kind: ImportIdKind): string }
export type HashFn = (canonicalRecord: string) => Promise<string>

export interface StartImportSourceRecord {
  id: string
  rowNumber: number
  recordHash: string
  payloadJson: string
}

export interface StartImportEvidence {
  sourceRecordId: string
  role: EvidenceRole
}

export interface StartImportCandidate {
  id: string
  accountId: string | null
  occurredOn: string
  postedOn: string | null
  amountJpy: number
  direction: 'IN' | 'OUT'
  descriptionRaw: string | null
  merchantRaw: string | null
  externalTransactionId: string | null
  externalSource: 'MONEY_FORWARD_ME' | null
  externalFactHash: string | null
  calculationTarget: boolean
  suggestedTransactionType: 'TRANSFER' | null
  institutionRaw: string | null
  categoryMajorRaw: string | null
  categoryMinorRaw: string | null
  memoRaw: string | null
  extractionConfidenceBps: number | null
  normalizationConfidenceBps: number | null
  attributionKind: 'HOUSEHOLD' | 'MEMBER'
  attributedMemberId: string | null
  audienceVisibility: 'SHARED' | 'PERSONAL'
  audienceMemberId: string | null
  reviewStatus: 'PENDING'
  evidence: StartImportEvidence[]
}

/** Camel-case counterpart of Rust's StartImport. Raw bytes stay in the document vault. */
export interface StartImportRequest {
  runId: string
  documentId: string
  householdId: string
  sourceType: ImportSourceType
  originalFilename: string
  mediaType: string
  byteSize: number
  sha256: string
  sourceModifiedAt: string | null
  adapterId: AdapterId | null
  adapterVersion: string | null
  audienceVisibility: 'SHARED' | 'PERSONAL'
  audienceMemberId: string | null
  records: StartImportSourceRecord[]
  candidates: StartImportCandidate[]
  cardStatements: StartImportCardStatement[]
}

export interface StartImportCardStatement {
  id: string
  cardAccountId: string
  issuer: string
  periodStart: string
  periodEnd: string
  paymentDueOn: string | null
  statementAmountJpy: number
  lines: { candidateId: string; statementLineNumber: number; billedAmountJpy: number }[]
}

export interface ImportMapperIssue {
  code: 'ADAPTER_MISMATCH' | 'UNSUPPORTED_RECORD' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'AMBIGUOUS_DIRECTION' | 'PAYLOAD_TOO_LARGE' | 'ACCOUNT_MAPPING_MISSING' | 'ACCOUNT_MAPPING_UNKNOWN'
  message: string
  severity: 'warning' | 'error'
  sourceRow?: number
}

export interface ImportMappingResult {
  request: StartImportRequest
  issues: ImportMapperIssue[]
}

interface MappingContext {
  ids: IdFactory
  hash: HashFn
  accountId: string | null
  institutionAccountMappings: Readonly<Record<string, string>>
  records: StartImportSourceRecord[]
  issues: ImportMapperIssue[]
  lineageRecords: Map<string, StartImportSourceRecord | null>
}

function lineagePayload(lineage: SourceLineage, namedFields?: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    sourceRow: lineage.sourceRow,
    sourceRowEnd: lineage.sourceRowEnd,
    rawFields: lineage.rawFields,
    ...(lineage.sourcePart ? { sourcePart: lineage.sourcePart } : {}),
    ...(namedFields ? { fields: namedFields } : {}),
  })
}

async function sourceRecord(context: MappingContext, lineage: SourceLineage, namedFields?: Readonly<Record<string, string>>): Promise<StartImportSourceRecord | null> {
  const payloadJson = lineagePayload(lineage, namedFields)
  const key = payloadJson
  const existing = context.lineageRecords.get(key)
  if (existing !== undefined || context.lineageRecords.has(key)) return existing ?? null
  if (encoder.encode(payloadJson).byteLength > MAX_PAYLOAD_JSON_BYTES) {
    context.issues.push({ code: 'PAYLOAD_TOO_LARGE', message: `Source row ${lineage.sourceRow} exceeds the 1 MiB JSON payload limit.`, severity: 'error', sourceRow: lineage.sourceRow })
    context.lineageRecords.set(key, null)
    return null
  }
  const record = { id: context.ids.next('sourceRecord'), rowNumber: lineage.sourceRow, recordHash: await context.hash(payloadJson), payloadJson }
  context.records.push(record)
  context.lineageRecords.set(key, record)
  return record
}

function isoDate(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function positiveInteger(value: number | null): number | null {
  if (value == null || !Number.isSafeInteger(value) || value === 0) return null
  return Math.abs(value)
}

function mappedAccountId(mappings: Readonly<Record<string, string>>, institution: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(mappings, institution)) return null
  const value: unknown = mappings[institution]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function issueInvalid(context: MappingContext, code: 'INVALID_DATE' | 'INVALID_AMOUNT' | 'AMBIGUOUS_DIRECTION', message: string, row?: number): void {
  context.issues.push({ code, message, severity: 'error', ...(row === undefined ? {} : { sourceRow: row }) })
}

function candidate(context: MappingContext, values: Omit<StartImportCandidate, 'id' | 'accountId' | 'reviewStatus' | 'extractionConfidenceBps' | 'normalizationConfidenceBps' | 'attributionKind' | 'attributedMemberId' | 'audienceVisibility' | 'audienceMemberId' | 'externalSource' | 'externalFactHash' | 'calculationTarget' | 'suggestedTransactionType' | 'institutionRaw' | 'categoryMajorRaw' | 'categoryMinorRaw' | 'memoRaw'> & Partial<Pick<StartImportCandidate, 'externalSource' | 'externalFactHash' | 'calculationTarget' | 'suggestedTransactionType' | 'institutionRaw' | 'categoryMajorRaw' | 'categoryMinorRaw' | 'memoRaw'>>): StartImportCandidate {
  return {
    id: context.ids.next('candidate'), accountId: context.accountId, reviewStatus: 'PENDING',
    extractionConfidenceBps: null, normalizationConfidenceBps: null,
    attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null,
    externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null,
    institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null,
    ...values,
  }
}

async function mapBank(record: BankTransactionCandidate, context: MappingContext): Promise<StartImportCandidate[]> {
  const evidence = await sourceRecord(context, record.lineage)
  const date = isoDate(record.transactionDate)
  if (!date) issueInvalid(context, 'INVALID_DATE', 'Bank transaction has no valid ISO transaction date.', record.lineage.sourceRow)
  const outgoing = positiveInteger(record.outgoingAmount)
  const incoming = positiveInteger(record.incomingAmount)
  if (outgoing != null && incoming != null) issueInvalid(context, 'AMBIGUOUS_DIRECTION', 'Bank transaction contains both incoming and outgoing amounts.', record.lineage.sourceRow)
  else if (outgoing == null && incoming == null) issueInvalid(context, 'INVALID_AMOUNT', 'Bank transaction has no positive integer JPY amount.', record.lineage.sourceRow)
  if (!evidence || !date || (outgoing == null) === (incoming == null)) return []
  return [candidate(context, {
    occurredOn: date, postedOn: null, amountJpy: outgoing ?? incoming!, direction: outgoing == null ? 'IN' : 'OUT',
    descriptionRaw: [record.description, record.descriptionDetail].filter(Boolean).join(' ') || null,
    merchantRaw: record.description || null, externalTransactionId: record.externalTransactionId || null,
    evidence: [{ sourceRecordId: evidence.id, role: 'PRIMARY' }],
  })]
}

function isSupportingPayPayLeg(leg: WalletEventLegCandidate): boolean {
  return /Point|ポイント|Balance Earned|Balance Removed|Expired/i.test(leg.transactionType)
}

async function mapPayPay(event: WalletEventCandidate, context: MappingContext): Promise<StartImportCandidate[]> {
  const date = isoDate(event.occurredAt)
  if (!date) issueInvalid(context, 'INVALID_DATE', `PayPay event ${event.transactionId} has no valid ISO date.`)
  const mapped = await Promise.all(event.legs.map(async (leg) => ({ leg, record: await sourceRecord(context, leg.lineage) })))
  if (!date) return []
  const supporting = mapped.filter(({ leg, record }) => record && isSupportingPayPayLeg(leg))
  const results: StartImportCandidate[] = []
  for (const { leg, record } of mapped) {
    if (!record || isSupportingPayPayLeg(leg)) continue
    const outgoing = positiveInteger(leg.outgoingAmount)
    const incoming = positiveInteger(leg.incomingAmount)
    if (outgoing != null && incoming != null) {
      issueInvalid(context, 'AMBIGUOUS_DIRECTION', `PayPay leg contains incoming and outgoing amounts for ${event.transactionId}.`, leg.lineage.sourceRow)
      continue
    }
    if (outgoing == null && incoming == null) {
      issueInvalid(context, 'INVALID_AMOUNT', `PayPay leg has no positive integer JPY amount for ${event.transactionId}.`, leg.lineage.sourceRow)
      continue
    }
    // candidate_sources is unique per candidate/source row. A split-funded
    // PayPay payment therefore uses FUNDING_LEG as the row's single role.
    const evidence: StartImportEvidence[] = [{ sourceRecordId: record.id, role: leg.funding.length > 1 ? 'FUNDING_LEG' : 'PRIMARY' }]
    evidence.push(...supporting.map(({ record: item }) => ({ sourceRecordId: item!.id, role: 'SUPPORTING' as const })))
    results.push(candidate(context, {
      occurredOn: date, postedOn: null, amountJpy: outgoing ?? incoming!, direction: outgoing == null ? 'IN' : 'OUT',
      descriptionRaw: leg.transactionType || event.eventType || null, merchantRaw: event.counterparty || null,
      externalTransactionId: event.transactionId || null, evidence,
    }))
  }
  return results
}

async function mapCardTransaction(transaction: CardTransactionCandidate, context: MappingContext): Promise<StartImportCandidate[]> {
  const record = await sourceRecord(context, transaction.lineage)
  const date = isoDate(transaction.usageDate)
  const amount = positiveInteger(transaction.billingAmount)
  if (!date) issueInvalid(context, 'INVALID_DATE', 'Card transaction has no valid ISO usage date.', transaction.lineage.sourceRow)
  if (amount == null) issueInvalid(context, 'INVALID_AMOUNT', 'Card transaction has no positive integer JPY billing amount.', transaction.lineage.sourceRow)
  if (!record || !date || amount == null) return []
  const evidence: StartImportEvidence[] = [{
    sourceRecordId: record.id,
    role: transaction.lineage.sourceRowEnd > transaction.lineage.sourceRow ? 'CONTINUATION' : 'PRIMARY',
  }]
  return [candidate(context, {
    occurredOn: date, postedOn: null, amountJpy: amount,
    direction: transaction.isRefund || (transaction.billingAmount ?? 0) < 0 ? 'IN' : 'OUT',
    descriptionRaw: transaction.isRefund ? ['REFUND', transaction.paymentMethod].filter(Boolean).join(' / ') : transaction.paymentMethod || null,
    merchantRaw: transaction.merchant || null,
    externalTransactionId: null, evidence,
  })]
}

async function mapMoneyForward(record: MoneyForwardHouseholdTransactionCandidate, context: MappingContext): Promise<StartImportCandidate[]> {
  const evidence = await sourceRecord(context, record.lineage, record.sourceFields)
  const date = isoDate(record.transactionDate)
  const amount = positiveInteger(record.signedAmountJpy)
  if (!date) issueInvalid(context, 'INVALID_DATE', 'Money Forward transaction has no valid ISO date.', record.lineage.sourceRow)
  if (amount == null) issueInvalid(context, 'INVALID_AMOUNT', 'Money Forward transaction has no non-zero integer JPY amount.', record.lineage.sourceRow)
  const accountId = mappedAccountId(context.institutionAccountMappings, record.institution)
  if (!evidence || !date || amount == null || !accountId) return []
  const factHash = record.externalTransactionId ? await context.hash(JSON.stringify({
    date, amount, direction: record.signedAmountJpy! < 0 ? 'OUT' : 'IN', content: record.content,
    institution: record.institution, isTransfer: record.isTransfer, calculationTarget: record.calculationTarget,
    majorCategory: record.majorCategory, minorCategory: record.minorCategory, memo: record.memo,
  })) : null
  return [{ ...candidate(context, {
    occurredOn: date, postedOn: null, amountJpy: amount, direction: record.signedAmountJpy! < 0 ? 'OUT' : 'IN',
    descriptionRaw: record.memo || null, merchantRaw: record.content || null,
    externalTransactionId: record.externalTransactionId || null, externalSource: record.externalTransactionId ? 'MONEY_FORWARD_ME' : null,
    externalFactHash: factHash, calculationTarget: record.isTransfer ? false : record.calculationTarget,
    suggestedTransactionType: record.isTransfer ? 'TRANSFER' : null, institutionRaw: record.institution,
    categoryMajorRaw: record.majorCategory || null, categoryMinorRaw: record.minorCategory || null, memoRaw: record.memo || null,
    evidence: [{ sourceRecordId: evidence.id, role: 'PRIMARY' }],
  }), accountId }]
}

function isBank(value: unknown): value is BankTransactionCandidate { return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'bank-transaction' }
function isWallet(value: unknown): value is WalletEventCandidate { return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'wallet-event' }
function isStatement(value: unknown): value is CardStatementCandidate { return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'card-statement' }
function isMoneyForward(value: unknown): value is MoneyForwardHouseholdTransactionCandidate { return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'money-forward-household-transaction' }

export async function mapParsedImportToStartImport(input: ImportMapperInput, ids: IdFactory, hash: HashFn): Promise<ImportMappingResult> {
  const runId = ids.next('run')
  const documentId = ids.next('document')
  const issues: ImportMapperIssue[] = []
  if (input.detectedAdapterId !== input.parsed.adapterId) issues.push({ code: 'ADAPTER_MISMATCH', message: `Detected adapter ${input.detectedAdapterId} does not match parsed adapter ${input.parsed.adapterId}.`, severity: 'error' })
  const institutionAccountMappings = input.institutionAccountMappings ?? {}
  if (input.detectedAdapterId === 'money-forward-me-household-ledger-v1' && input.detectedAdapterId === input.parsed.adapterId) {
    const institutions = new Set(input.parsed.records.filter(isMoneyForward).map((record) => record.institution))
    for (const institution of institutions) {
      if (!mappedAccountId(institutionAccountMappings, institution)) issues.push({ code: 'ACCOUNT_MAPPING_MISSING', message: `Money Forward institution ${institution} has no explicit destination account.`, severity: 'error' })
    }
    for (const institution of Object.keys(institutionAccountMappings)) {
      if (!institutions.has(institution)) issues.push({ code: 'ACCOUNT_MAPPING_UNKNOWN', message: `Money Forward account mapping contains unknown institution ${institution}.`, severity: 'error' })
    }
  } else if (Object.keys(institutionAccountMappings).length > 0) {
    issues.push({ code: 'ACCOUNT_MAPPING_UNKNOWN', message: 'Institution account mappings are only valid for Money Forward ME household-ledger imports.', severity: 'error' })
  }
  const context: MappingContext = { ids, hash, accountId: input.file.accountId ?? null, institutionAccountMappings, records: [], issues, lineageRecords: new Map() }
  const candidates: StartImportCandidate[] = []
  const cardStatements: StartImportCardStatement[] = []
  const accountMappingInvalid = issues.some((issue) => issue.code === 'ACCOUNT_MAPPING_MISSING' || issue.code === 'ACCOUNT_MAPPING_UNKNOWN')
  if (input.detectedAdapterId === input.parsed.adapterId && !accountMappingInvalid) {
    for (const record of input.parsed.records) {
      if (isBank(record)) candidates.push(...await mapBank(record, context))
      else if (isWallet(record)) candidates.push(...await mapPayPay(record, context))
      else if (isMoneyForward(record)) candidates.push(...await mapMoneyForward(record, context))
      else if (isStatement(record)) {
        const sourcePaymentDueOn = record.paymentDueOn ?? null
        const paymentDueOn = sourcePaymentDueOn == null ? null : isoDate(sourcePaymentDueOn)
        if (sourcePaymentDueOn != null && (paymentDueOn == null || paymentDueOn !== sourcePaymentDueOn)) {
          issueInvalid(context, 'INVALID_DATE', 'Card statement has no valid ISO source payment due date.')
        }
        const statementCandidates: { candidate: StartImportCandidate; billedAmountJpy: number }[] = []
        for (const transaction of record.transactions) {
          const mapped = await mapCardTransaction(transaction, context)
          candidates.push(...mapped)
          if (mapped[0] && transaction.billingAmount) statementCandidates.push({ candidate: mapped[0], billedAmountJpy: transaction.billingAmount })
        }
        const dates = statementCandidates.map(({ candidate: item }) => item.occurredOn).sort()
        const statementAmount = record.statementTotal != null && Number.isSafeInteger(record.statementTotal) && record.statementTotal > 0
          ? record.statementTotal : null
        if (input.file.accountId && dates[0] && dates.at(-1) && statementAmount != null && (sourcePaymentDueOn == null || paymentDueOn != null)) {
          cardStatements.push({
            id: ids.next('statement'), cardAccountId: input.file.accountId, issuer: record.issuer,
            periodStart: dates[0], periodEnd: dates.at(-1)!, paymentDueOn,
            statementAmountJpy: statementAmount,
            lines: statementCandidates.map(({ candidate: item, billedAmountJpy }, index) => ({ candidateId: item.id, statementLineNumber: index + 1, billedAmountJpy })),
          })
        }
      }
      else issues.push({ code: 'UNSUPPORTED_RECORD', message: 'Parsed import contains an unsupported record shape.', severity: 'error' })
    }
  }
  return {
    request: {
      runId, documentId, householdId: input.file.householdId,
      sourceType: input.file.sourceType, originalFilename: input.file.originalFilename, mediaType: input.file.mediaType,
      byteSize: input.file.byteSize, sha256: input.file.sha256, sourceModifiedAt: input.file.sourceModifiedAt ?? null,
      adapterId: input.detectedAdapterId, adapterVersion: input.file.adapterVersion ?? null,
      audienceVisibility: 'SHARED', audienceMemberId: null,
      records: context.records, candidates, cardStatements,
    },
    issues,
  }
}
