import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ManualConnectorControlCenter,
  type ManualConnectorControlCopy,
} from '../features/connectors/ManualConnectorControlCenter'
import type { ExtractedDocumentDto } from '../platform'
import type { ConnectorSummaryDto } from '../platform/types'
import { parseReceiptText, type ReceiptTextFields } from '../features/import/receiptText'
import type { PwaLedgerClient } from '../platform/pwa/client'
import type {
  Account,
  DashboardSummary,
  Household,
  ReceiptCandidate,
  ReceiptFieldProvenance,
  SourceEvidence,
  Transaction,
  TransactionDetail,
} from '../platform/pwa/types'
import { canActivatePwaUpdate, usePwaServiceWorker } from './serviceWorker'
import { isPwaClientOperationSuperseded, usePwaClient } from './usePwaClient'
import './pwa.css'

export type PwaOcrDocument = (
  fileBytes: Uint8Array,
  mediaType: string,
) => Promise<ExtractedDocumentDto>

interface PwaRootProps {
  readonly databaseName?: string
  readonly ocrDocument?: PwaOcrDocument
}

type Screen = 'overview' | 'sources' | 'import' | 'review' | 'ledger' | 'evidence' | 'backup'

interface ReceiptDraft {
  readonly filename: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly extracted: ExtractedDocumentDto
  readonly fields: ReceiptTextFields
  readonly candidate: ReceiptCandidate | null
}

const navigation: readonly { id: Screen; label: string; step: string }[] = [
  { id: 'overview', label: 'Overview', step: '01' },
  { id: 'sources', label: 'Sources', step: '02' },
  { id: 'import', label: 'Import', step: '03' },
  { id: 'review', label: 'Review', step: '04' },
  { id: 'ledger', label: 'Ledger', step: '05' },
  { id: 'evidence', label: 'Evidence', step: '06' },
  { id: 'backup', label: 'Backup', step: '07' },
]

const pwaDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' })

const pwaConnectorCopy: ManualConnectorControlCopy = {
  frame: {
    title: 'Connector control center',
    description: 'Review the local source and pending items in one place.',
    reviewNote: 'Imports create review candidates. Nothing is posted automatically.',
    connected: 'Connected',
    stale: 'Stale',
    running: 'Running',
    needsAction: 'Needs action',
  },
  manualState: 'Manual',
  configure: 'Open settings',
  lastSuccessLabel: 'Last successful refresh',
  noLastSuccess: 'No successful refresh yet',
  nextDueLabel: 'Next scheduled refresh',
  noNextDue: 'Not scheduled',
  pendingReviewLabel: 'Pending review',
  pendingReview: (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`,
  formatDate: (value) => pwaDateFormatter.format(new Date(value)),
}

const defaultOcrDocument: PwaOcrDocument = async (bytes, mediaType) => {
  const { paddleOcrDocument } = await import('../features/import/paddleOcr')
  return paddleOcrDocument(bytes, mediaType)
}

function formatJpy(value: number) {
  return `¥${new Intl.NumberFormat('ja-JP').format(value)}`
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function randomId(prefix: string) {
  const token = globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${token}`
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read receipt')))
    reader.readAsArrayBuffer(file)
  })
}

function receiptProvenance(
  extracted: ExtractedDocumentDto,
  fields: ReceiptTextFields,
): ReceiptFieldProvenance[] {
  const matches = [
    { field: 'payee', match: fields.merchant },
    { field: 'occurredOn', match: fields.occurredOn?.replaceAll('-', '/') ?? null },
    { field: 'amountJpy', match: fields.amountJpy === null ? null : String(fields.amountJpy) },
  ]
  return matches.flatMap(({ field, match }) => {
    const normalizedMatch = match?.replaceAll(',', '')
    const region = extracted.regions?.find((item) => (
      normalizedMatch && item.text.replaceAll(',', '').includes(normalizedMatch)
    ))
    if (!region) return []
    const box = region.boundingBox
    return [{
      field,
      page: region.pageNumber,
      region: box
        ? [box.left, box.top, box.width, box.height] as const
        : [0, 0, 0, 0] as const,
    }]
  })
}

export default function PwaRoot({
  databaseName = 'kakeflow-pwa-v1',
  ocrDocument = defaultOcrDocument,
}: PwaRootProps) {
  const session = usePwaClient(databaseName)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [screen, setScreen] = useState<Screen>('overview')
  const [household, setHousehold] = useState<Household | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [connectorSummaries, setConnectorSummaries] = useState<readonly ConnectorSummaryDto[]>([])
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [approved, setApproved] = useState(false)
  const [posted, setPosted] = useState<Transaction | null>(null)
  const [detail, setDetail] = useState<TransactionDetail | null>(null)
  const [evidence, setEvidence] = useState<SourceEvidence | null>(null)
  const [debitAccountId, setDebitAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vaultLoadGeneration = useRef(0)
  const serviceWorker = usePwaServiceWorker()

  const loadVault = useCallback(async (client: PwaLedgerClient): Promise<boolean> => {
    const generation = ++vaultLoadGeneration.current
    try {
      const households = await client.listHouseholds()
      if (generation !== vaultLoadGeneration.current) return false
      const active = households[0] ?? null
      if (!active) {
        setHousehold(null)
        setAccounts([])
        setSummary(null)
        setTransactions([])
        setConnectorSummaries([])
        return true
      }
      const [nextAccounts, nextSummary, nextTransactions, nextConnectorSummaries] = await Promise.all([
        client.listAccounts(active.id),
        client.dashboard(active.id),
        client.listTransactions(active.id),
        client.listConnectorSummaries(active.id),
      ])
      if (generation !== vaultLoadGeneration.current) return false
      setHousehold(active)
      setAccounts(nextAccounts)
      setSummary(nextSummary)
      setTransactions(nextTransactions)
      setConnectorSummaries(nextConnectorSummaries)
      setDebitAccountId(nextAccounts.find((account) => account.kind === 'EXPENSE')?.id ?? '')
      setCreditAccountId(nextAccounts.find((account) => account.kind === 'ASSET')?.id ?? '')
      return true
    } catch (cause) {
      if (generation !== vaultLoadGeneration.current) return false
      throw cause
    }
  }, [])

  const submitVault = async (create: boolean) => {
    setError(null)
    if (passphrase.length < 12) {
      setError('Use a passphrase of at least 12 characters')
      return
    }
    if (create && passphrase !== confirmation) {
      setError('Passphrases do not match')
      return
    }
    try {
      const client = create
        ? await session.createVault(passphrase)
        : await session.unlockVault(passphrase)
      setPassphrase('')
      setConfirmation('')
      setScreen('overview')
      await loadVault(client)
    } catch (cause) {
      if (!isPwaClientOperationSuperseded(cause)) setError(messageOf(cause))
    }
  }

  const setupHousehold = async (form: HTMLFormElement) => {
    if (!session.client) return
    const data = new FormData(form)
    setBusy(true)
    setError(null)
    try {
      const nextHousehold = await session.client.createHousehold({
        id: 'household',
        name: String(data.get('householdName') ?? ''),
      })
      await session.client.createAccount({
        id: 'asset',
        householdId: nextHousehold.id,
        name: String(data.get('assetName') ?? ''),
        kind: 'ASSET',
      })
      await session.client.createAccount({
        id: 'expense',
        householdId: nextHousehold.id,
        name: String(data.get('expenseName') ?? ''),
        kind: 'EXPENSE',
      })
      await loadVault(session.client)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const importReceipt = async (file: File) => {
    if (!session.client || !household) return
    setBusy(true)
    setError(null)
    setApproved(false)
    setPosted(null)
    try {
      const bytes = await readFileBytes(file)
      const extracted = await ocrDocument(bytes, file.type)
      const fields = parseReceiptText(extracted.text)
      const isComplete = Boolean(fields.merchant && fields.occurredOn && fields.amountJpy)
      const candidate = isComplete
        ? await session.client.stageReceipt({
            householdId: household.id,
            originalFilename: file.name,
            mediaType: file.type,
            bytes,
            occurredOn: fields.occurredOn!,
            payee: fields.merchant!,
            amountJpy: fields.amountJpy!,
            ocrConfidenceBps: Math.min(extracted.confidenceBps, fields.confidenceBps),
            provenance: receiptProvenance(extracted, fields),
          })
        : null
      setDraft({ filename: file.name, mediaType: file.type, bytes, extracted, fields, candidate })
      if (candidate) {
        try {
          setConnectorSummaries(await session.client.listConnectorSummaries(household.id))
        } catch {
          setError('Receipt staged, but source status could not be refreshed.')
        }
      }
      setScreen('review')
    } catch (cause) {
      setError(`Local OCR failed: ${messageOf(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const approveCandidate = async () => {
    if (!session.client || !draft?.candidate || !approved) return
    setBusy(true)
    setError(null)
    try {
      const transaction = await session.client.approveCandidate({
        candidateId: draft.candidate.id,
        transactionId: randomId('transaction'),
        transactionType: 'EXPENSE',
        entries: [
          { id: randomId('debit'), accountId: debitAccountId, side: 'DEBIT', amountJpy: draft.candidate.amountJpy },
          { id: randomId('credit'), accountId: creditAccountId, side: 'CREDIT', amountJpy: draft.candidate.amountJpy },
        ],
      })
      try {
        if (!await loadVault(session.client)) return
      } catch {
        setError('Transaction posted, but the refreshed vault status could not be loaded.')
      }
      setPosted(transaction)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const showProvenance = async (transactionId: string) => {
    if (!session.client) return
    setBusy(true)
    setError(null)
    try {
      const [nextDetail, nextEvidence] = await Promise.all([
        session.client.transactionDetail(transactionId),
        session.client.sourceEvidence(transactionId),
      ])
      setDetail(nextDetail)
      setEvidence(nextEvidence)
      setScreen('evidence')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const restoreArchive = async (archive: Uint8Array, archivePassphrase: string) => {
    setBusy(true)
    setError(null)
    try {
      const client = await session.restoreVault(archive, archivePassphrase)
      setDraft(null)
      setPosted(null)
      setDetail(null)
      setEvidence(null)
      setApproved(false)
      setScreen('overview')
      await loadVault(client)
    } catch (cause) {
      if (isPwaClientOperationSuperseded(cause)) return
      setError(messageOf(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const lockVault = () => {
    vaultLoadGeneration.current += 1
    session.lockVault()
    setBusy(false)
    setError(null)
    setPassphrase('')
    setDraft(null)
    setPosted(null)
    setDetail(null)
    setEvidence(null)
    setHousehold(null)
    setAccounts([])
    setTransactions([])
    setSummary(null)
    setConnectorSummaries([])
  }

  const status = session.mode === 'unlocked' ? 'UNLOCKED' : 'LOCKED'
  const effectiveError = error ?? session.error
  const canActivateUpdate = canActivatePwaUpdate({
    vaultUnlocked: session.mode === 'unlocked',
    activeOperation: busy || Boolean(draft?.candidate && !posted),
  })

  return <div className="pwa-shell">
    <header className="pwa-header">
      <a className="pwa-brand" href="/kakeflow/" aria-label="KakeFlow home">
        <span className="pwa-mark" aria-hidden="true">K</span>
        <span>KakeFlow <small>Local Ledger</small></span>
      </a>
      <div className="pwa-state" aria-label="Runtime state">
        <span>LOCAL</span><span>{status}</span><span>OFFLINE READY</span>
      </div>
      {session.mode === 'unlocked' && <button className="pwa-quiet" type="button" onClick={lockVault}>Lock vault</button>}
    </header>
    {serviceWorker.updateAvailable && <aside className="pwa-update" role="status">
      <span><strong>Update ready</strong> The new app shell will activate only at a safe boundary.</span>
      <button className="pwa-primary" type="button" disabled={!canActivateUpdate || serviceWorker.activating} onClick={serviceWorker.activateUpdate}>{serviceWorker.activating ? 'Activating…' : 'Apply update'}</button>
      <button className="pwa-quiet" type="button" onClick={serviceWorker.dismissUpdate}>Later</button>
      {!canActivateUpdate && <small>Finish or leave the active receipt review, or lock the vault.</small>}
    </aside>}

    {session.mode !== 'unlocked' && <main className="pwa-auth">
      <section className="pwa-auth-card">
        <p className="pwa-eyebrow">ACCOUNT-FREE · ON-DEVICE</p>
        <h1>{session.mode === 'new' ? 'Own your financial record' : 'Unlock local vault'}</h1>
        <p>Your passphrase derives the encryption key in this browser. It is never stored or sent.</p>
        <label>Vault passphrase<input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
        {session.mode === 'new' && <label>Confirm passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        <button className="pwa-primary" type="button" disabled={session.busy} onClick={() => void submitVault(session.mode === 'new')}>
          {session.mode === 'new' ? 'Create encrypted vault' : 'Unlock vault'}
        </button>
      </section>
    </main>}

    {session.mode === 'unlocked' && !household && <main className="pwa-auth">
      <form className="pwa-auth-card" onSubmit={(event) => { event.preventDefault(); void setupHousehold(event.currentTarget) }}>
        <p className="pwa-eyebrow">ONE-TIME LOCAL SETUP</p>
        <h1>Set up your household</h1>
        <p>Create the minimum balanced-ledger accounts. No provider connection is required.</p>
        <label>Household name<input name="householdName" required /></label>
        <label>Money account<input name="assetName" required /></label>
        <label>Expense account<input name="expenseName" required /></label>
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        <button className="pwa-primary" type="submit" disabled={busy}>Save local setup</button>
      </form>
    </main>}

    {session.mode === 'unlocked' && household && <div className="pwa-workspace">
      <nav className="pwa-navigation" aria-label="PWA workflow">
        {navigation.map((item) => <button key={item.id} type="button" aria-current={screen === item.id ? 'page' : undefined} onClick={() => setScreen(item.id)}>
          <span aria-hidden="true">{item.step}</span>{item.label}
        </button>)}
      </nav>
      <main className="pwa-content">
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        {screen === 'overview' && <Overview household={household} summary={summary} transactions={transactions} onImport={() => setScreen('import')} />}
        {screen === 'sources' && connectorSummaries[0] && <div className="pwa-sources"><ManualConnectorControlCenter
          summary={connectorSummaries[0]}
          copy={pwaConnectorCopy}
          onConfigure={() => setScreen('import')}
        /></div>}
        {screen === 'import' && <ImportScreen busy={busy} onFile={importReceipt} />}
        {screen === 'review' && <ReviewScreen
          draft={draft}
          accounts={accounts}
          debitAccountId={debitAccountId}
          creditAccountId={creditAccountId}
          explicitlyApproved={approved}
          posted={posted}
          busy={busy}
          onDebit={setDebitAccountId}
          onCredit={setCreditAccountId}
          onApproval={setApproved}
          onPost={approveCandidate}
        />}
        {screen === 'ledger' && <LedgerScreen transactions={transactions} onProvenance={showProvenance} />}
        {screen === 'evidence' && <EvidenceScreen detail={detail} evidence={evidence} />}
        {screen === 'backup' && session.client && <BackupScreen
          client={session.client}
          busy={busy || session.busy}
          onRestore={restoreArchive}
        />}
      </main>
    </div>}
  </div>
}

function Overview({ household, summary, transactions, onImport }: {
  readonly household: Household
  readonly summary: DashboardSummary | null
  readonly transactions: readonly Transaction[]
  readonly onImport: () => void
}) {
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">{household.name} · JPY</p><h1>Household overview</h1></div><button className="pwa-primary" type="button" onClick={onImport}>Import receipt</button></div>
    <div className="pwa-metrics">
      <article><span>Posted expenses</span><strong>{formatJpy(summary?.expenseJpy ?? 0)}</strong></article>
      <article><span>Net</span><strong>{formatJpy(summary?.netJpy ?? 0)}</strong></article>
      <article><span>Ledger entries</span><strong>{summary?.transactionCount ?? 0}</strong></article>
    </div>
    <section className="pwa-panel"><h2>Recent postings</h2>{transactions.length === 0 ? <p>No postings yet. Import a receipt to start.</p> : transactions.slice(-4).reverse().map((transaction) => <div className="pwa-row" key={transaction.id}><span>{transaction.occurredOn} · {transaction.payee}</span><strong>{formatJpy(transaction.amountJpy)}</strong></div>)}</section>
  </section>
}

function ImportScreen({ busy, onFile }: {
  readonly busy: boolean
  readonly onFile: (file: File) => Promise<void>
}) {
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 03 · LOCAL OCR</p><h1>Import a receipt</h1></div></div>
    <label className="pwa-dropzone">
      <strong>{busy ? 'Reading locally…' : 'Choose a receipt image'}</strong>
      <span>PP-OCRv5 runs on this device. The original is encrypted before persistence.</span>
      <input aria-label="Receipt image" type="file" accept="image/*" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void onFile(file)
        event.target.value = ''
      }} />
    </label>
  </section>
}

function ReviewScreen({
  draft,
  accounts,
  debitAccountId,
  creditAccountId,
  explicitlyApproved,
  posted,
  busy,
  onDebit,
  onCredit,
  onApproval,
  onPost,
}: {
  readonly draft: ReceiptDraft | null
  readonly accounts: readonly Account[]
  readonly debitAccountId: string
  readonly creditAccountId: string
  readonly explicitlyApproved: boolean
  readonly posted: Transaction | null
  readonly busy: boolean
  readonly onDebit: (value: string) => void
  readonly onCredit: (value: string) => void
  readonly onApproval: (value: boolean) => void
  readonly onPost: () => Promise<void>
}) {
  if (!draft) return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 04</p><h1>Review candidate</h1></div></div><p>Import a receipt before approval.</p></section>
  const candidate = draft.candidate
  if (!candidate) return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">CANDIDATE · INCOMPLETE</p><h1>Candidate needs more information</h1></div></div>
    <div className="pwa-compare"><article className="pwa-panel"><h2>Local OCR result</h2>{draft.extracted.text.split(/\r?\n/u).map((line, index) => <span className="pwa-ocr-line" key={`${index}-${line}`}>{line}</span>)}</article><article className="pwa-panel"><h2>Missing required fields</h2><ul>{draft.fields.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul><p>This candidate remains in the current review and cannot be posted.</p></article></div>
  </section>
  const canPost = Boolean(debitAccountId && creditAccountId && debitAccountId !== creditAccountId && explicitlyApproved && !posted)
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">CANDIDATE · SOURCE ENCRYPTED</p><h1>Compare source and candidate</h1></div><span className="pwa-chip">CANDIDATE</span></div>
    <div className="pwa-compare">
      <article className="pwa-panel"><h2>Source · {draft.filename}</h2><ReceiptPreview draft={draft} /><details className="pwa-ocr-details"><summary>Show local OCR text</summary>{draft.extracted.text.split(/\r?\n/u).map((line, index) => <span className="pwa-ocr-line" key={`${index}-${line}`}>{line}</span>)}</details></article>
      <article className="pwa-panel"><h2>OCR candidate</h2><dl className="pwa-facts"><div><dt>Date</dt><dd>{candidate.occurredOn}</dd></div><div><dt>Payee</dt><dd>{candidate.payee}</dd></div><div><dt>Total</dt><dd>{formatJpy(candidate.amountJpy)}</dd></div><div><dt>Confidence</dt><dd>{(candidate.ocrConfidenceBps / 100).toFixed(1)}%</dd></div></dl></article>
    </div>
    <article className="pwa-panel pwa-posting"><div className="pwa-panel-head"><div><p className="pwa-eyebrow">BALANCED POSTING</p><h2>Approval decision</h2></div><strong>difference ¥0</strong></div>
      <div className="pwa-account-grid"><label>Debit account<select value={debitAccountId} onChange={(event) => onDebit(event.target.value)}><option value="">Select</option>{accounts.filter((account) => account.kind === 'EXPENSE').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Credit account<select value={creditAccountId} onChange={(event) => onCredit(event.target.value)}><option value="">Select</option>{accounts.filter((account) => account.kind === 'ASSET' || account.kind === 'LIABILITY').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
      <div className="pwa-balance"><span>Debit {formatJpy(candidate.amountJpy)}</span><span>Credit {formatJpy(candidate.amountJpy)}</span></div>
      {!posted && <><label className="pwa-approval"><input type="checkbox" checked={explicitlyApproved} onChange={(event) => onApproval(event.target.checked)} />I compared the receipt and approve this posting</label><button className="pwa-primary" type="button" disabled={!canPost || busy} onClick={() => void onPost()}>Approve and post</button></>}
      {posted && <div className="pwa-success" role="status"><span>APPROVED</span><span>POSTED</span><p>Canonical posting hash</p><code>{posted.canonicalPostingHash}</code></div>}
    </article>
  </section>
}

function ReceiptPreview({ draft }: { readonly draft: ReceiptDraft }) {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    const blob = new Blob([Uint8Array.from(draft.bytes).buffer], { type: draft.mediaType })
    if (typeof URL.createObjectURL === 'function') {
      const objectUrl = URL.createObjectURL(blob)
      setSource(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => setSource(String(reader.result)))
    reader.readAsDataURL(blob)
    return () => reader.abort()
  }, [draft.bytes, draft.mediaType])
  return source
    ? <img className="pwa-receipt-preview" src={source} alt={`Original receipt ${draft.filename}`} />
    : <div className="pwa-receipt-preview" aria-label="Loading original receipt" />
}

function LedgerScreen({ transactions, onProvenance }: {
  readonly transactions: readonly Transaction[]
  readonly onProvenance: (id: string) => Promise<void>
}) {
  return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 05 · APPEND-ONLY</p><h1>Posted ledger</h1></div></div><div className="pwa-panel">{transactions.length === 0 ? <p>No posted transactions.</p> : transactions.slice().reverse().map((transaction) => <article className="pwa-ledger-row" key={transaction.id}><div><time>{transaction.occurredOn}</time><h2>{transaction.payee}</h2><small>{transaction.transactionType} · {transaction.canonicalPostingHash.slice(0, 12)}…</small></div><strong>{formatJpy(transaction.amountJpy)}</strong><button className="pwa-quiet" type="button" onClick={() => void onProvenance(transaction.id)}>View provenance</button></article>)}</div></section>
}

function EvidenceScreen({ detail, evidence }: {
  readonly detail: TransactionDetail | null
  readonly evidence: SourceEvidence | null
}) {
  if (!detail || !evidence) return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 06</p><h1>Evidence</h1></div></div><p>Open a ledger posting to inspect its source chain.</p></section>
  return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">SOURCE → CANDIDATE → POSTING</p><h1>Transaction provenance</h1></div><span className="pwa-chip">VERIFIED LOCAL</span></div><div className="pwa-provenance"><article className="pwa-panel"><span>01 · encrypted source</span><h2>{evidence.source.originalFilename}</h2><p>{evidence.source.mediaType} · {evidence.source.byteSize} bytes</p><code>SHA-256 {evidence.source.sha256}</code></article><article className="pwa-panel"><span>02 · approved candidate</span><h2>{detail.payee}</h2><p>{detail.occurredOn} · {formatJpy(detail.amountJpy)}</p><code>{detail.candidateId}</code></article><article className="pwa-panel"><span>03 · balanced posting</span><h2>{detail.entries.length} ledger entries</h2>{detail.entries.map((entry) => <p key={entry.id}>{entry.side} · {formatJpy(entry.amountJpy)}</p>)}<code>{detail.canonicalPostingHash}</code></article></div></section>
}

export function BackupScreen({ client, busy, onRestore }: {
  readonly client: PwaLedgerClient
  readonly busy: boolean
  readonly onRestore: (archive: Uint8Array, passphrase: string) => Promise<void>
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [archiveFile, setArchiveFile] = useState<File | null>(null)
  const [archivePassphrase, setArchivePassphrase] = useState('')
  const [working, setWorking] = useState(false)

  const downloadArchive = async () => {
    setWorking(true)
    setStatus('Preparing encrypted archive…')
    try {
      const archive = await client.exportVault()
      const blob = new Blob([Uint8Array.from(archive).buffer], {
        type: 'application/vnd.kakeflow.encrypted+zip',
      })
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'kakeflow-encrypted-vault.kakeflow.zip'
        link.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      setStatus('Encrypted archive downloaded')
    } catch (cause) {
      setStatus(`Export failed: ${messageOf(cause)}`)
    } finally {
      setWorking(false)
    }
  }

  const restore = async () => {
    if (!archiveFile || !archivePassphrase) return
    setWorking(true)
    setStatus('Validating the complete archive before activation…')
    try {
      await onRestore(await readFileBytes(archiveFile), archivePassphrase)
    } catch {
      setStatus('Restore rejected; the active vault was not changed')
    } finally {
      setWorking(false)
    }
  }

  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 07 · ENCRYPTED</p><h1>Backup and recovery</h1></div></div>
    <div className="pwa-compare">
      <article className="pwa-panel">
        <h2>Export encrypted archive</h2>
        <p>Download authenticated encrypted records and source evidence. The archive passphrase is your current vault passphrase.</p>
        <button className="pwa-primary" type="button" disabled={busy || working} onClick={() => void downloadArchive()}>Download encrypted archive</button>
      </article>
      <article className="pwa-panel">
        <h2>Validate and restore</h2>
        <p>Restore writes a new vault and switches the active pointer only after every manifest hash and encrypted envelope passes.</p>
        <label>Encrypted archive file<input aria-label="Encrypted archive file" type="file" accept=".zip,.kakeflow.zip,application/zip,application/vnd.kakeflow.encrypted+zip" disabled={busy || working} onChange={(event) => setArchiveFile(event.target.files?.[0] ?? null)} /></label>
        <label>Archive passphrase<input aria-label="Archive passphrase" type="password" autoComplete="current-password" value={archivePassphrase} disabled={busy || working} onChange={(event) => setArchivePassphrase(event.target.value)} /></label>
        <button className="pwa-primary" type="button" disabled={busy || working || !archiveFile || !archivePassphrase} onClick={() => void restore()}>Validate and restore</button>
      </article>
    </div>
    {status && <p role="status">{status}</p>}
  </section>
}
