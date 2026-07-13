import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileInput, Laptop, Link2 } from 'lucide-react'
import { platformClient } from '../../platform'
import type {
  AccountDto,
  HouseholdMemberDto,
  PendingImportAccountDependencyDto,
  PendingImportStageDto,
  PendingReviewRunDto,
} from '../../platform'
import './PendingImportHandoffPanel.css'

interface PendingImportHandoffPanelProps {
  readonly householdId: string | null
  readonly accounts: readonly AccountDto[]
  readonly members: readonly HouseholdMemberDto[]
  readonly pendingRuns: readonly PendingReviewRunDto[]
  readonly onApplied: () => void
}

type BusyAction = `EXPORT:${string}` | 'STAGE' | 'APPLY' | 'DISCARD' | null

const UNSUPPORTED_HANDOFF_ADAPTERS = new Set([
  'securities-asset-snapshot-v1',
  'japanese-brokerage-transactions-v1',
  'sbi-securities-trade-history-v1',
  'money-forward-me-asset-trend-v1',
])

function eligibleForHandoff(run: PendingReviewRunDto): boolean {
  const adapter = run.adapterId ?? ''
  return run.completionState === 'CANDIDATE_REVIEW'
    && !adapter.startsWith('receipt-')
    && !UNSUPPORTED_HANDOFF_ADAPTERS.has(adapter)
}

function compatibleAccounts(accounts: readonly AccountDto[], dependency: PendingImportAccountDependencyDto): readonly AccountDto[] {
  return accounts.filter((account) => account.accountKind === dependency.accountKind
    && (dependency.accountSubtype == null || account.accountSubtype === dependency.accountSubtype)
    && account.currency === dependency.currency)
}

function formatCount(value: number, unit: string): string {
  return `${value.toLocaleString('ja-JP')}${unit}`
}

export function PendingImportHandoffPanel({ householdId, accounts, members, pendingRuns, onApplied }: PendingImportHandoffPanelProps) {
  const [busy, setBusy] = useState<BusyAction>(null)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportConfirmation, setExportConfirmation] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [staged, setStaged] = useState<PendingImportStageDto | null>(null)
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [memberMappings, setMemberMappings] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const requestIdRef = useRef(0)
  const stagedRef = useRef<PendingImportStageDto | null>(null)

  useEffect(() => {
    requestIdRef.current += 1
    setBusy(null)
    setStaged(null)
    setAccountMappings({})
    setMemberMappings({})
    setExportPassphrase('')
    setExportConfirmation('')
    setImportPassphrase('')
    setNotice('')
    return () => {
      requestIdRef.current += 1
      const previous = stagedRef.current
      stagedRef.current = null
      if (previous && platformClient.runtime === 'tauri') void platformClient.discardPendingImport(previous.packageId).catch(() => undefined)
    }
  }, [householdId])

  const activeMembers = useMemo(() => members.filter((member) => member.status === 'ACTIVE'), [members])
  const runs = useMemo(() => pendingRuns.filter(eligibleForHandoff), [pendingRuns])
  const mappingsComplete = useMemo(() => {
    if (!staged) return false
    if (staged.alreadyApplied) return true
    return staged.accountDependencies.every((dependency) => compatibleAccounts(accounts, dependency)
      .some((account) => account.id === accountMappings[dependency.portableAccountId]))
      && staged.memberDependencies.every((dependency) => activeMembers
        .some((member) => member.id === memberMappings[dependency.portableMemberId]))
  }, [accountMappings, accounts, activeMembers, memberMappings, staged])

  const exportRun = async (run: PendingReviewRunDto) => {
    if (!householdId) return
    if (exportPassphrase.length < 12) {
      setNotice('保存用パスフレーズは12文字以上で入力してください。')
      return
    }
    if (exportPassphrase !== exportConfirmation) {
      setNotice('保存用パスフレーズが一致しません。')
      return
    }
    setBusy(`EXPORT:${run.runId}`)
    setNotice('')
    const requestId = requestIdRef.current
    try {
      const summary = await platformClient.exportPendingImport({ householdId, runId: run.runId }, exportPassphrase)
      if (requestId !== requestIdRef.current) return
      if (!summary) {
        setNotice('受け渡しファイルの保存をキャンセルしました。')
        return
      }
      setExportPassphrase('')
      setExportConfirmation('')
      setNotice(`${formatCount(summary.candidateCount, '候補')}をローカルの受け渡しファイルに保存しました。元の確認待ちはこの端末に残っています。`)
    } catch {
      if (requestId === requestIdRef.current) setNotice('受け渡しファイルを保存できませんでした。パスフレーズと保存先を確認してください。')
    } finally {
      if (requestId === requestIdRef.current) setBusy(null)
    }
  }

  const stageFile = async () => {
    if (!householdId) return
    if (importPassphrase.length < 12) {
      setNotice('受け取り用パスフレーズは12文字以上で入力してください。')
      return
    }
    setBusy('STAGE')
    setNotice('')
    const requestId = requestIdRef.current
    try {
      const previous = stagedRef.current
      if (previous) {
        await platformClient.discardPendingImport(previous.packageId)
        if (requestId !== requestIdRef.current) return
        stagedRef.current = null
        setStaged(null)
        setAccountMappings({})
        setMemberMappings({})
      }
      const next = await platformClient.pickAndStagePendingImport(householdId, importPassphrase)
      if (requestId !== requestIdRef.current) {
        if (next) await platformClient.discardPendingImport(next.packageId).catch(() => undefined)
        return
      }
      if (!next) {
        setNotice('受け渡しファイルの選択をキャンセルしました。')
        return
      }
      stagedRef.current = next
      setStaged(next)
      setAccountMappings({})
      setMemberMappings({})
      setImportPassphrase('')
      setNotice(next.alreadyApplied
        ? 'この受け渡しファイルは以前追加されています。既存の確認待ちを開けます。'
        : '受け渡しファイルを検証しました。口座とメンバーを明示的に対応付けてください。')
    } catch {
      if (requestId === requestIdRef.current) setNotice('受け渡しファイルを開けませんでした。ファイルとパスフレーズを確認してください。')
    } finally {
      if (requestId === requestIdRef.current) setBusy(null)
    }
  }

  const applyStaged = async () => {
    if (!householdId || !staged || !mappingsComplete) return
    setBusy('APPLY')
    setNotice('')
    const requestId = requestIdRef.current
    try {
      const mappings = staged.alreadyApplied ? { accounts: [], members: [] } : {
        accounts: staged.accountDependencies.map((dependency) => ({
          portableAccountId: dependency.portableAccountId,
          localAccountId: accountMappings[dependency.portableAccountId],
        })),
        members: staged.memberDependencies.map((dependency) => ({
          portableMemberId: dependency.portableMemberId,
          localMemberId: memberMappings[dependency.portableMemberId],
        })),
      }
      const result = await platformClient.applyPendingImport(householdId, staged.packageId, mappings)
      if (requestId !== requestIdRef.current) return
      stagedRef.current = null
      setStaged(null)
      setAccountMappings({})
      setMemberMappings({})
      onApplied()
      setNotice(result.reusedExisting
        ? '既存の確認待ちをImport Inboxに表示しました。承認は引き継がず、台帳へは自動反映していません。'
        : `${formatCount(result.candidateCount, '候補')}をImport Inboxの確認待ちに追加しました。台帳へは自動反映していません。`)
    } catch {
      if (requestId === requestIdRef.current) setNotice('確認待ちへ追加できませんでした。対応付けを確認して再試行してください。')
    } finally {
      if (requestId === requestIdRef.current) setBusy(null)
    }
  }

  const discardStaged = async () => {
    if (!staged) return
    setBusy('DISCARD')
    setNotice('')
    const requestId = requestIdRef.current
    try {
      await platformClient.discardPendingImport(staged.packageId)
      if (requestId !== requestIdRef.current) return
      stagedRef.current = null
      setStaged(null)
      setAccountMappings({})
      setMemberMappings({})
      setNotice('選択した受け渡しファイルの一時データを破棄しました。')
    } catch {
      if (requestId === requestIdRef.current) setNotice('一時データを破棄できませんでした。')
    } finally {
      if (requestId === requestIdRef.current) setBusy(null)
    }
  }

  if (platformClient.runtime !== 'tauri') return null

  return <section className="panel pending-import-handoff" aria-busy={busy != null}>
    <div className="panel-head">
      <div><h2>確認待ちの受け渡し</h2><p>別のKakeFlow端末へ、未確定の取引候補をローカルファイルで渡します。</p></div>
      <b><Laptop size={13} /> ローカルファイル</b>
    </div>
    <p className="pending-import-scope"><Link2 size={15} /><span>ネットワーク送受信やクラウド同期は行いません。保存・選択・追加だけでは台帳へ反映されず、受け取り側のImport Inboxで改めて確認と承認が必要です。</span></p>
    <div className="pending-import-columns">
      <section aria-labelledby="pending-import-export-title">
        <div className="pending-import-step-head"><span>1</span><div><h3 id="pending-import-export-title">この端末から保存</h3><p>取引候補の確認待ちを1件選んで保存します。</p></div></div>
        <div className="pending-import-form">
          <label>保存用パスフレーズ<input aria-label="保存用パスフレーズ" type="password" autoComplete="new-password" placeholder="12文字以上" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} /></label>
          <label>保存用パスフレーズを確認<input aria-label="保存用パスフレーズを確認" type="password" autoComplete="new-password" value={exportConfirmation} onChange={(event) => setExportConfirmation(event.target.value)} /></label>
        </div>
        <div className="pending-import-run-list">
          {runs.length === 0 ? <p className="empty-state">受け渡せる取引候補の確認待ちはありません。投資・レシートの専用処理は対象外です。</p> : runs.map((run) => <article key={run.runId}>
            <span><strong>{run.originalFilename}</strong><small>{formatCount(run.candidateCount, '候補')} ・ {formatCount(run.recordCount, '行')} ・ {run.adapterId ?? '汎用取込'}</small></span>
            <button className="secondary-btn" aria-label={`${run.originalFilename}を受け渡しファイルに保存`} disabled={busy != null} onClick={() => void exportRun(run)}><Download size={14} /> {busy === `EXPORT:${run.runId}` ? '保存中…' : '保存'}</button>
          </article>)}
        </div>
      </section>
      <section aria-labelledby="pending-import-stage-title">
        <div className="pending-import-step-head"><span>2</span><div><h3 id="pending-import-stage-title">この端末で受け取る</h3><p>ファイルを検証してから、対応先を選びます。</p></div></div>
        <div className="pending-import-stage-action">
          <label>受け取り用パスフレーズ<input aria-label="受け取り用パスフレーズ" type="password" autoComplete="off" placeholder="保存時の12文字以上" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} /></label>
          <button className="secondary-btn" disabled={busy != null || !householdId} onClick={() => void stageFile()}><FileInput size={14} /> {busy === 'STAGE' ? '検証中…' : '確認待ちファイルを開く'}</button>
        </div>
      </section>
    </div>
    {staged && <section className="pending-import-mapping" aria-labelledby="pending-import-mapping-title">
      <div className="pending-import-mapping-summary">
        <div><span>3</span><div><h3 id="pending-import-mapping-title">対応先を確認</h3><p>{staged.sourceFilename} ・ {formatCount(staged.candidateCount, '候補')} ・ {formatCount(staged.recordCount, '行')}</p></div></div>
        {staged.alreadyApplied && <b>追加済み{staged.existingLocalRunId ? ` ・ ${staged.existingLocalRunId}` : ''}</b>}
      </div>
      {staged.alreadyApplied ? <p className="pending-import-mapping-note">この端末に追加したときの対応付けを再利用します。承認状態は引き継ぎません。</p> : (staged.accountDependencies.length > 0 || staged.memberDependencies.length > 0) && <p className="pending-import-mapping-note">候補から推測せず、すべての対応先を選択してください。選択肢がない場合は、設定で口座または家族メンバーを先に追加します。</p>}
      {!staged.alreadyApplied && <div className="pending-import-mapping-grid">
        {staged.accountDependencies.map((dependency) => {
          const options = compatibleAccounts(accounts, dependency)
          return <label key={dependency.portableAccountId}><span><strong>{dependency.name}</strong><small>{dependency.accountKind} / {dependency.accountSubtype ?? 'すべて'} / {dependency.currency}{dependency.institutionName ? ` ・ ${dependency.institutionName}` : ''}{dependency.maskedIdentifier ? ` ・ ${dependency.maskedIdentifier}` : ''}</small></span><select aria-label={`${dependency.name}の対応先口座`} value={accountMappings[dependency.portableAccountId] ?? ''} disabled={options.length === 0} onChange={(event) => setAccountMappings((current) => ({ ...current, [dependency.portableAccountId]: event.target.value }))}><option value="">口座を選択</option>{options.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{options.length === 0 && <small role="status">条件に一致する口座がありません。設定で先に追加してください。</small>}</label>
        })}
        {staged.memberDependencies.map((dependency) => <label key={dependency.portableMemberId}><span><strong>{dependency.displayName}</strong><small>受け渡し元の役割: {dependency.role}</small></span><select aria-label={`${dependency.displayName}の対応先メンバー`} value={memberMappings[dependency.portableMemberId] ?? ''} disabled={activeMembers.length === 0} onChange={(event) => setMemberMappings((current) => ({ ...current, [dependency.portableMemberId]: event.target.value }))}><option value="">メンバーを選択</option>{activeMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select>{activeMembers.length === 0 && <small role="status">有効なメンバーがいません。家族ページで先に追加してください。</small>}</label>)}
      </div>}
      <div className="pending-import-actions"><button className="text-btn" disabled={busy != null} onClick={() => void discardStaged()}>{busy === 'DISCARD' ? '破棄中…' : '一時データを破棄'}</button><button className="primary-btn" disabled={busy != null || !mappingsComplete} onClick={() => void applyStaged()}>{busy === 'APPLY' ? '追加中…' : 'Import Inboxの確認待ちに追加'}</button></div>
    </section>}
    {notice && <p className="pending-import-notice" role="status" aria-live="polite">{notice}</p>}
  </section>
}
