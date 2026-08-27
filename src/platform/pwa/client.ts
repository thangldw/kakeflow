import { createPwaArchive, restorePwaArchive, type RestorePwaArchiveOptions } from './archive'
import type { ConnectorSummaryDto } from '../types'
import type { PlainEventWrite, PlainProjectionWrite } from './database'
import { PwaVaultDatabase } from './database'
import { EvidenceStore, type EvidenceStoreOptions } from './evidenceStore'
import type {
  Account,
  ApproveCandidateInput,
  CreateAccountInput,
  CreateHouseholdInput,
  DashboardSummary,
  Household,
  ManualTransactionInput,
  PostingEntry,
  ReceiptCandidate,
  SourceEvidence,
  SourceRecord,
  StageReceiptInput,
  Transaction,
  TransactionDetail,
  TransactionProvenance,
} from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface ClientOptions {
  readonly vaultId?: string
  readonly evidence?: EvidenceStoreOptions
}

export interface RestoreClientOptions extends ClientOptions, RestorePwaArchiveOptions {}

interface CorePostingValidation {
  readonly valid: boolean
  readonly codes: readonly string[]
  readonly debitTotalJpy: number
  readonly creditTotalJpy: number
  readonly canonicalHash: string | null
}

interface SourceHashProjection {
  readonly sourceId: string
  readonly candidateId: string
}

let corePromise: Promise<typeof import('./core-wasm/kakeflow_core.js')> | undefined

export class PwaLedgerClient {
  private constructor(
    private readonly database: PwaVaultDatabase,
    private readonly evidence: EvidenceStore,
  ) {}

  static async createVault(
    databaseName: string,
    passphrase: string,
    options: ClientOptions = {},
  ) {
    const database = await PwaVaultDatabase.create(databaseName, passphrase, options.vaultId)
    return new PwaLedgerClient(database, new EvidenceStore(database, options.evidence))
  }

  static async unlock(
    databaseName: string,
    passphrase: string,
    options: Pick<ClientOptions, 'evidence'> = {},
  ) {
    const database = await PwaVaultDatabase.open(databaseName, passphrase)
    return new PwaLedgerClient(database, new EvidenceStore(database, options.evidence))
  }

  static async restoreVault(
    databaseName: string,
    archive: Uint8Array,
    passphrase: string,
    options: RestoreClientOptions = {},
  ) {
    const { evidence, ...restoreOptions } = options
    const database = await restorePwaArchive(databaseName, archive, passphrase, restoreOptions)
    return new PwaLedgerClient(database, new EvidenceStore(database, evidence))
  }

  lock() {
    this.database.lock()
  }

  close() {
    this.database.close()
  }

  revision() {
    return this.database.revision()
  }

  async createHousehold(input: CreateHouseholdInput): Promise<Household> {
    validateIdentifier('household ID', input.id)
    validateName('household name', input.name)
    if (await this.hasProjection('HOUSEHOLD', input.id)) throw new Error('Household already exists')
    const household: Household = { id: input.id, name: input.name.trim(), baseCurrency: 'JPY' }
    await this.appendDomainChange(
      [{ id: eventId(), eventType: 'HOUSEHOLD_CREATED', payload: encodeJson(household) }],
      [{ projectionType: 'HOUSEHOLD', id: household.id, payload: encodeJson(household) }],
    )
    return household
  }

  async listHouseholds(): Promise<Household[]> {
    return this.listModels<Household>('HOUSEHOLD')
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    validateIdentifier('account ID', input.id)
    validateName('account name', input.name)
    await this.model<Household>('HOUSEHOLD', input.householdId)
    if (!['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE'].includes(input.kind)) {
      throw new Error('Invalid account kind')
    }
    if (await this.hasProjection('ACCOUNT', input.id)) throw new Error('Account already exists')
    const account: Account = {
      id: input.id,
      householdId: input.householdId,
      name: input.name.trim(),
      kind: input.kind,
      currency: 'JPY',
    }
    await this.appendDomainChange(
      [{ id: eventId(), eventType: 'ACCOUNT_CREATED', payload: encodeJson(account) }],
      [{ projectionType: 'ACCOUNT', id: account.id, payload: encodeJson(account) }],
    )
    return account
  }

  async listAccounts(householdId: string): Promise<Account[]> {
    return (await this.listModels<Account>('ACCOUNT'))
      .filter((account) => account.householdId === householdId)
  }

  async createManualTransaction(input: ManualTransactionInput): Promise<Transaction> {
    validateTransactionInput(input)
    await this.validatePostingAccounts(input.householdId, input.entries)
    if (await this.hasProjection('TRANSACTION', input.id)) throw new Error('Transaction already exists')
    const candidateId = `manual:${input.id}`
    const validation = await validatePostingWithCore({
      candidateId,
      transactionId: input.id,
      transactionType: input.transactionType,
      candidateAmountJpy: input.amountJpy,
      approved: true,
      entries: input.entries,
    })
    const canonicalPostingHash = requireValidPosting(validation)
    const transaction: Transaction = {
      ...input,
      candidateId,
      canonicalPostingHash,
      entries: [...input.entries],
    }
    const provenance: TransactionProvenance = {
      transactionId: transaction.id,
      manual: true,
      sourceId: null,
      candidateId: null,
    }
    await this.appendDomainChange(
      [{
        id: eventId(),
        eventType: 'TRANSACTION_POSTED',
        payload: encodeJson({ transaction, provenance, canonicalPostingHash }),
      }],
      [
        { projectionType: 'TRANSACTION', id: transaction.id, payload: encodeJson(transaction) },
        { projectionType: 'PROVENANCE', id: transaction.id, payload: encodeJson(provenance) },
      ],
    )
    return transaction
  }

  async stageReceipt(input: StageReceiptInput): Promise<ReceiptCandidate> {
    validateReceiptInput(input)
    await this.model<Household>('HOUSEHOLD', input.householdId)
    const sha256 = await hashBytes(input.bytes)
    const duplicate = await this.optionalModel<SourceHashProjection>('SOURCE_HASH', sha256)
    if (duplicate) return this.model<ReceiptCandidate>('CANDIDATE', duplicate.candidateId)

    const sourceId = input.sourceId ?? `source-${sha256}`
    const candidateId = input.candidateId ?? `candidate-${sha256}`
    validateIdentifier('source ID', sourceId)
    validateIdentifier('candidate ID', candidateId)
    const source: SourceRecord = {
      id: sourceId,
      householdId: input.householdId,
      originalFilename: input.originalFilename,
      mediaType: input.mediaType,
      byteSize: input.bytes.byteLength,
      sha256,
      provenance: [...input.provenance],
    }
    const candidate: ReceiptCandidate = {
      id: candidateId,
      householdId: input.householdId,
      sourceId,
      occurredOn: input.occurredOn,
      payee: input.payee.trim(),
      amountJpy: input.amountJpy,
      ocrConfidenceBps: input.ocrConfidenceBps,
      status: 'CANDIDATE',
      explicitlyApproved: false,
      transactionId: null,
    }
    await this.evidence.putEvidence(source.id, input.bytes)
    await this.appendDomainChange(
      [
        { id: eventId(), eventType: 'SOURCE_STORED', payload: encodeJson(source) },
        { id: eventId(), eventType: 'CANDIDATE_STAGED', payload: encodeJson(candidate) },
      ],
      [
        { projectionType: 'SOURCE', id: source.id, payload: encodeJson(source) },
        { projectionType: 'CANDIDATE', id: candidate.id, payload: encodeJson(candidate) },
        {
          projectionType: 'SOURCE_HASH',
          id: sha256,
          payload: encodeJson({ sourceId: source.id, candidateId: candidate.id }),
        },
      ],
    )
    return candidate
  }

  async approveCandidate(input: ApproveCandidateInput): Promise<Transaction> {
    validateIdentifier('transaction ID', input.transactionId)
    const candidate = await this.model<ReceiptCandidate>('CANDIDATE', input.candidateId)
    if (candidate.status !== 'CANDIDATE' || candidate.explicitlyApproved) {
      throw new Error('Candidate is not awaiting approval')
    }
    await this.validatePostingAccounts(candidate.householdId, input.entries)
    const validation = await validatePostingWithCore({
      candidateId: candidate.id,
      transactionId: input.transactionId,
      transactionType: input.transactionType,
      candidateAmountJpy: candidate.amountJpy,
      approved: true,
      entries: input.entries,
    })
    const canonicalPostingHash = requireValidPosting(validation)
    const transaction: Transaction = {
      id: input.transactionId,
      householdId: candidate.householdId,
      candidateId: candidate.id,
      occurredOn: candidate.occurredOn,
      transactionType: input.transactionType,
      payee: candidate.payee,
      amountJpy: candidate.amountJpy,
      entries: [...input.entries],
      canonicalPostingHash,
    }
    const postedCandidate: ReceiptCandidate = {
      ...candidate,
      status: 'POSTED',
      explicitlyApproved: true,
      transactionId: transaction.id,
    }
    const provenance: TransactionProvenance = {
      transactionId: transaction.id,
      manual: false,
      sourceId: candidate.sourceId,
      candidateId: candidate.id,
    }
    await this.appendDomainChange(
      [
        {
          id: eventId(),
          eventType: 'CANDIDATE_APPROVED',
          payload: encodeJson({ candidate: postedCandidate, canonicalPostingHash }),
        },
        {
          id: eventId(),
          eventType: 'TRANSACTION_POSTED',
          payload: encodeJson({ transaction, provenance, canonicalPostingHash }),
        },
      ],
      [
        { projectionType: 'CANDIDATE', id: candidate.id, payload: encodeJson(postedCandidate) },
        { projectionType: 'TRANSACTION', id: transaction.id, payload: encodeJson(transaction) },
        { projectionType: 'PROVENANCE', id: transaction.id, payload: encodeJson(provenance) },
      ],
    )
    return transaction
  }

  async listCandidates(householdId: string): Promise<ReceiptCandidate[]> {
    return (await this.listModels<ReceiptCandidate>('CANDIDATE'))
      .filter((candidate) => candidate.householdId === householdId)
  }

  async listConnectorSummaries(householdId: string): Promise<readonly ConnectorSummaryDto[]> {
    await this.model<Household>('HOUSEHOLD', householdId)
    const pendingReviewCount = (await this.listCandidates(householdId))
      .filter((candidate) => candidate.status === 'CANDIDATE').length
    return [{
      schemaVersion: 1,
      connectorKind: 'MANUAL_IMPORT',
      connectionKey: 'manual-import',
      displayLabel: 'Manual import',
      availability: 'AVAILABLE',
      lifecycle: 'CONNECTED',
      health: 'MANUAL',
      capabilities: ['IMPORT_FILE'],
      lastAttemptAt: null,
      lastSuccessAt: null,
      freshnessDeadlineAt: null,
      nextDueAt: null,
      pendingReviewCount,
      consecutiveFailures: 0,
      lastErrorCode: null,
      bindingSummary: null,
      configurationDestination: 'IMPORT_INBOX',
    }]
  }

  async listTransactions(householdId: string): Promise<Transaction[]> {
    return (await this.listModels<Transaction>('TRANSACTION'))
      .filter((transaction) => transaction.householdId === householdId)
      .sort((left, right) => (
        left.occurredOn.localeCompare(right.occurredOn) || left.id.localeCompare(right.id)
      ))
  }

  async transactionDetail(transactionId: string): Promise<TransactionDetail> {
    const [transaction, provenance] = await Promise.all([
      this.model<Transaction>('TRANSACTION', transactionId),
      this.model<TransactionProvenance>('PROVENANCE', transactionId),
    ])
    return { ...transaction, provenance }
  }

  async sourceEvidenceForCandidate(candidateId: string): Promise<SourceEvidence> {
    const candidate = await this.model<ReceiptCandidate>('CANDIDATE', candidateId)
    return this.sourceEvidenceById(candidate.sourceId)
  }

  async sourceEvidence(transactionId: string): Promise<SourceEvidence> {
    const provenance = await this.model<TransactionProvenance>('PROVENANCE', transactionId)
    if (provenance.manual || !provenance.sourceId) throw new Error('Transaction has manual provenance')
    return this.sourceEvidenceById(provenance.sourceId)
  }

  async dashboard(householdId: string): Promise<DashboardSummary> {
    const transactions = await this.listTransactions(householdId)
    let incomeJpy = 0
    let expenseJpy = 0
    for (const transaction of transactions) {
      if (['INCOME', 'INTEREST'].includes(transaction.transactionType)) {
        incomeJpy = checkedAdd(incomeJpy, transaction.amountJpy)
      } else if (['EXPENSE', 'CARD_PURCHASE', 'FEE'].includes(transaction.transactionType)) {
        expenseJpy = checkedAdd(expenseJpy, transaction.amountJpy)
      } else if (transaction.transactionType === 'REFUND') {
        expenseJpy = checkedAdd(expenseJpy, -transaction.amountJpy)
      }
    }
    return {
      householdId,
      incomeJpy,
      expenseJpy,
      netJpy: incomeJpy - expenseJpy,
      transactionCount: transactions.length,
    }
  }

  async exportVault(): Promise<Uint8Array> {
    const sourceIds = (await this.listModels<SourceRecord>('SOURCE')).map((source) => source.id)
    return createPwaArchive(this.database, this.evidence, sourceIds)
  }

  private async sourceEvidenceById(sourceId: string): Promise<SourceEvidence> {
    const [source, bytes] = await Promise.all([
      this.model<SourceRecord>('SOURCE', sourceId),
      this.evidence.getEvidence(sourceId),
    ])
    return { source, bytes }
  }

  private async validatePostingAccounts(householdId: string, entries: readonly PostingEntry[]) {
    await this.model<Household>('HOUSEHOLD', householdId)
    const accounts = new Map((await this.listAccounts(householdId)).map((account) => [account.id, account]))
    for (const entry of entries) {
      if (!accounts.has(entry.accountId)) throw new Error(`Account outside household: ${entry.accountId}`)
    }
  }

  private async appendDomainChange(
    events: readonly PlainEventWrite[],
    projections: readonly PlainProjectionWrite[],
  ) {
    const expectedRevision = await this.database.revision()
    return this.database.appendPostingAtomically({ expectedRevision, events, projections })
  }

  private async model<T>(projectionType: string, id: string): Promise<T> {
    return decodeJson<T>(await this.database.readProjection(projectionType, id))
  }

  private async optionalModel<T>(projectionType: string, id: string): Promise<T | undefined> {
    if (!(await this.hasProjection(projectionType, id))) return undefined
    return this.model<T>(projectionType, id)
  }

  private async hasProjection(projectionType: string, id: string) {
    return (await this.database.listProjectionIds(projectionType)).includes(id)
  }

  private async listModels<T>(projectionType: string): Promise<T[]> {
    const ids = await this.database.listProjectionIds(projectionType)
    return Promise.all(ids.map((id) => this.model<T>(projectionType, id)))
  }
}

async function validatePostingWithCore(input: {
  readonly candidateId: string
  readonly transactionId: string
  readonly transactionType: string
  readonly candidateAmountJpy: number
  readonly approved: boolean
  readonly entries: readonly PostingEntry[]
}): Promise<CorePostingValidation> {
  corePromise ??= import('./core-wasm/kakeflow_core.js').then(async (core) => {
    await core.default()
    return core
  })
  const core = await corePromise
  return JSON.parse(core.validate_posting_json(JSON.stringify(input))) as CorePostingValidation
}

function requireValidPosting(validation: CorePostingValidation) {
  if (!validation.valid || !validation.canonicalHash) {
    throw new Error(`Posting rejected: ${validation.codes.join(',') || 'INVALID_POSTING'}`)
  }
  return validation.canonicalHash
}

function validateTransactionInput(input: ManualTransactionInput) {
  validateIdentifier('transaction ID', input.id)
  validateIdentifier('household ID', input.householdId)
  validateDate(input.occurredOn)
  validateName('payee', input.payee)
  validatePositiveJpy(input.amountJpy)
}

function validateReceiptInput(input: StageReceiptInput) {
  validateIdentifier('household ID', input.householdId)
  validateName('source filename', input.originalFilename)
  validateName('media type', input.mediaType)
  validateDate(input.occurredOn)
  validateName('payee', input.payee)
  validatePositiveJpy(input.amountJpy)
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > 64 * 1024 * 1024) {
    throw new Error('Invalid receipt evidence size')
  }
  if (!Number.isInteger(input.ocrConfidenceBps) || input.ocrConfidenceBps < 0 || input.ocrConfidenceBps > 10_000) {
    throw new Error('Invalid OCR confidence')
  }
}

function validateIdentifier(name: string, value: string) {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (!value.trim() || value.length > 255 || hasControl) {
    throw new Error(`Invalid ${name}`)
  }
}

function validateName(name: string, value: string) {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127
  })
  if (!value.trim() || value.length > 512 || hasControl) {
    throw new Error(`Invalid ${name}`)
  }
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('Invalid date')
  }
}

function validatePositiveJpy(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid JPY amount')
}

function encodeJson(value: unknown) {
  return encoder.encode(JSON.stringify(value))
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T
}

async function hashBytes(bytes: Uint8Array) {
  const view = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', view))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function checkedAdd(left: number, right: number) {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error('Dashboard amount overflow')
  return result
}

function eventId() {
  return `event-${crypto.randomUUID()}`
}
