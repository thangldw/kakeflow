import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountDto,
  ConnectorBindingDto,
  ConnectorRefreshBatchProgressDto,
  ConnectorRefreshItemDto,
  ConnectorSummaryDto,
  ConfigurationDestinationDto,
  DeleteConnectorBindingInputDto,
  UpsertConnectorBindingInputDto,
} from '../../platform/types'
import type { DelimitedParserProfileDto } from '../parser-profiles/delimitedParserProfilePlatform'
import {
  aggregateConnectorSummaries,
  filterConnectorSummaries,
  primaryConnectorState,
} from './connectorControlModel'
import type { ConnectorControlFilter, ConnectorPrimaryState } from './connectorControlModel'
import {
  ConnectorControlCard,
  ConnectorControlDetails,
  ConnectorControlFrame,
  ConnectorControlList,
  type ConnectorControlCenterCopy,
} from './ConnectorControlPresentation'

export type { ConnectorControlCenterCopy } from './ConnectorControlPresentation'

export interface ConnectorControlCenterProps {
  readonly summaries: readonly ConnectorSummaryDto[]
  readonly loading: boolean
  readonly error: string | null
  readonly onConfigure: (destination: ConfigurationDestinationDto) => void
  readonly bindingManagementUnavailable?: boolean
  readonly bindingManagement?: ConnectorBindingManagement
  readonly refreshManagement?: ConnectorRefreshManagement
  readonly copy?: ConnectorControlCenterCopy
}

export interface ConnectorBindingManagement {
  readonly householdId: string
  readonly bindings: readonly ConnectorBindingDto[]
  readonly accounts: readonly AccountDto[]
  readonly parserProfiles: readonly DelimitedParserProfileDto[]
  readonly onSave: (input: UpsertConnectorBindingInputDto) => Promise<void>
  readonly onRemove: (input: DeleteConnectorBindingInputDto) => Promise<void>
  readonly onReload: () => Promise<void>
}

export interface ConnectorRefreshManagement {
  readonly batch: ConnectorRefreshBatchProgressDto | null
  readonly starting: boolean
  readonly error: string | null
  readonly onRefresh: (summary: ConnectorSummaryDto) => Promise<void>
  readonly onRefreshAll: () => Promise<void>
  readonly onDisconnect: (summary: ConnectorSummaryDto) => Promise<void>
}

const FILTERS: readonly ConnectorControlFilter[] = ['ALL', 'STALE', 'NEEDS_ACTION']

const filterLabel: Readonly<Record<ConnectorControlFilter, string>> = {
  ALL: 'すべて',
  STALE: '古いデータ',
  NEEDS_ACTION: '要対応',
}

const stateLabel: Readonly<Record<ConnectorPrimaryState, string>> = {
  NEEDS_ACTION: '要対応',
  RUNNING: '更新中',
  RETRY_BACKOFF: '再試行待ち',
  STALE: '古いデータ',
  FRESH: '最新',
  MANUAL: '手動',
  NEVER_REFRESHED: '未更新',
  DISCONNECTED: '未接続',
}

const japaneseCopy: ConnectorControlCenterCopy = {
  localeCode: 'ja-JP',
  text: (source) => source,
}

export function ConnectorControlCenter({ summaries, loading, error, onConfigure, bindingManagementUnavailable = false, bindingManagement, refreshManagement, copy = japaneseCopy }: ConnectorControlCenterProps) {
  const { localeCode, text } = copy
  const [filter, setFilter] = useState<ConnectorControlFilter>('ALL')
  const [editingIdentity, setEditingIdentity] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const restoreFocus = useRef<{ readonly trigger: HTMLButtonElement; readonly card: HTMLElement | null } | null>(null)
  const totals = aggregateConnectorSummaries(summaries)
  const visible = filterConnectorSummaries(summaries, filter)
  const refreshAllAvailable = refreshManagement !== undefined && summaries.some(canRefresh)
  const activeRefresh = refreshManagement?.batch?.status === 'ACTIVE'
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(localeCode, { dateStyle: 'short', timeStyle: 'short' }), [localeCode])
  const formatDate = (value: string | null, emptyLabel: string) => value === null ? emptyLabel : dateFormatter.format(new Date(value))
  const formatPendingCount = (count: number) => text('{count}件').replace('{count}', count.toLocaleString(localeCode))
  const formatBindingSummary = (binding: ConnectorSummaryDto['bindingSummary']) => {
    if (binding === null) return text('未設定')
    const template = binding.parserProfileConfigured
      ? text('対象口座{count}件・読み取りプロファイル設定済み・設定版{version}')
      : text('対象口座{count}件・読み取りプロファイルなし・設定版{version}')
    return template
      .replace('{count}', binding.allowedAccountCount.toLocaleString(localeCode))
      .replace('{version}', binding.version.toLocaleString(localeCode))
  }
  const refreshErrorLabel = refreshManagement?.error === 'CONNECTOR_DISCONNECT_UNAVAILABLE'
    ? text('コネクタの接続を解除できませんでした。')
    : text('コネクタの更新を開始できませんでした。')

  useEffect(() => {
    if (pendingAction !== null || restoreFocus.current === null) return
    const { trigger, card } = restoreFocus.current
    restoreFocus.current = null
    const cardConfigure = card?.querySelector<HTMLButtonElement>('[data-connector-configure]')
    const stableHeading = document.getElementById('connector-control-title')
    const destination = trigger.isConnected && !trigger.disabled
      ? trigger
      : cardConfigure?.isConnected
        ? cardConfigure
        : stableHeading
    destination?.focus()
  }, [pendingAction])

  const perform = async (action: string, trigger: HTMLButtonElement, operation: () => Promise<void>) => {
    if (pendingAction !== null) return
    restoreFocus.current = { trigger, card: trigger.closest('article') }
    setPendingAction(action)
    try {
      await operation()
    } finally {
      setPendingAction(null)
    }
  }

  const disconnect = async (summary: ConnectorSummaryDto, trigger: HTMLButtonElement) => {
    const message = text('{label}の接続を解除しますか？取り込み済みの証跡と台帳は保持されます。').replace('{label}', summary.displayLabel)
    if (!globalThis.confirm(message)) return
    await perform(`disconnect:${connectorIdentity(summary)}`, trigger, () => refreshManagement!.onDisconnect(summary))
  }

  return <ConnectorControlFrame labels={{
    title: text('コネクタ管理センター'),
    description: text('接続状態、更新、レビュー待ちを一か所で管理します。認証とスケジュールは各設定画面で管理します。'),
    reviewNote: text('更新はレビュー候補を作成します。台帳へ自動記帳されることはありません。'),
    connected: text('接続済み'),
    stale: text('古いデータ'),
    running: text('更新中'),
    needsAction: text('要対応'),
  }} totals={totals}>
    <div className="connector-control-toolbar">
      <div className="connector-control-filters" role="group" aria-label={text('コネクタを絞り込む')}>
        {FILTERS.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text(filterLabel[value])}</button>)}
      </div>
      {refreshAllAvailable && <button className="secondary-btn" type="button" disabled={refreshManagement.starting || activeRefresh || pendingAction !== null} onClick={(event) => void perform('refresh-all', event.currentTarget, refreshManagement.onRefreshAll)}>{text('すべて更新')}</button>}
    </div>

    {refreshManagement?.error && <p className="connector-control-state" role="alert">{refreshErrorLabel}</p>}
    {refreshManagement?.batch && <ConnectorRefreshProgress batch={refreshManagement.batch} summaries={summaries} copy={copy} />}

    {loading ? <p className="connector-control-state" role="status">{text('コネクタの状態を読み込んでいます…')}</p>
      : error !== null ? <p className="connector-control-state" role="alert">{text('コネクタの状態を読み込めませんでした。')}</p>
        : summaries.length === 0 ? <p className="connector-control-state">{text('表示できるコネクタはありません。')}</p>
          : visible.length === 0 ? <p className="connector-control-state">{text('この条件に一致するコネクタはありません。')}</p>
            : <ConnectorControlList>{visible.map((summary) => {
              const primaryState = primaryConnectorState(summary)
              const identity = connectorIdentity(summary)
              const refreshLabel = summary.health === 'RETRY_BACKOFF' && summary.capabilities.includes('RETRY') ? text('再試行') : text('更新')
              return <ConnectorControlCard
                key={`${summary.connectorKind}:${summary.connectionKey}`}
                label={summary.displayLabel}
                primaryState={primaryState}
                stateLabel={text(stateLabel[primaryState])}
                actions={<>
                    {refreshManagement && canRefresh(summary) && <button className="secondary-btn" type="button" disabled={refreshManagement.starting || activeRefresh || pendingAction !== null} onClick={(event) => void perform(`refresh:${identity}`, event.currentTarget, () => refreshManagement.onRefresh(summary))}>{refreshLabel}</button>}
                    <button className="secondary-btn" data-connector-configure type="button" onClick={() => onConfigure(summary.configurationDestination)}>{text('設定を開く')}</button>
                    {refreshManagement && canDisconnect(summary) && <button className="secondary-btn" type="button" disabled={activeRefresh || pendingAction !== null} onClick={(event) => void disconnect(summary, event.currentTarget)}>{text('接続解除')}</button>}
                    {bindingManagement && summary.capabilities.includes('ACCOUNT_BINDING') && <button className="secondary-btn" type="button" onClick={() => setEditingIdentity(`${summary.connectorKind}:${summary.connectionKey}`)}>{text('レビュー範囲を管理')}</button>}
                </>}
              >
                {bindingManagementUnavailable && summary.capabilities.includes('ACCOUNT_BINDING') && <p className="connector-control-unavailable"><strong>{text('レビュー範囲を管理')}</strong>{' — '}{text('この実行環境では利用できません。デスクトップ版の設定を確認してください。')}</p>}
                {summary.availability === 'RUNTIME_UNSUPPORTED' && <p className="connector-control-unavailable">{text('この実行環境では利用できません。デスクトップ版の設定を確認してください。')}</p>}
                {summary.availability === 'CONFIG_MISSING' && <p className="connector-control-unavailable">{text('このコネクタには追加設定が必要です。')}</p>}
                <ConnectorControlDetails
                  lastSuccessLabel={text('最後に成功した更新')}
                  lastSuccess={formatDate(summary.lastSuccessAt, text('成功した更新はまだありません'))}
                  nextDueLabel={text('次回の予定更新')}
                  nextDue={formatDate(summary.nextDueAt, text('スケジュールなし'))}
                  pendingReviewLabel={text('レビュー待ち')}
                  pendingReview={formatPendingCount(summary.pendingReviewCount)}
                  bindingLabel={text('レビュー範囲')}
                  bindingSummary={formatBindingSummary(summary.bindingSummary)}
                />
                {bindingManagement && editingIdentity === `${summary.connectorKind}:${summary.connectionKey}` && <ConnectorBindingEditor
                  key={`${summary.connectorKind}:${summary.connectionKey}`}
                  summary={summary}
                  management={bindingManagement}
                  copy={copy}
                />}
              </ConnectorControlCard>
            })}</ConnectorControlList>}
  </ConnectorControlFrame>
}

function ConnectorRefreshProgress({ batch, summaries, copy }: { readonly batch: ConnectorRefreshBatchProgressDto; readonly summaries: readonly ConnectorSummaryDto[]; readonly copy: ConnectorControlCenterCopy }) {
  const { localeCode, text } = copy
  const summaryByIdentity = new Map(summaries.map((summary) => [connectorIdentity(summary), summary]))
  const headline = batch.status === 'ACTIVE'
    ? text('更新の進行: {completed} / {total}').replace('{completed}', batch.terminalCount.toLocaleString(localeCode)).replace('{total}', batch.totalCount.toLocaleString(localeCode))
    : batch.status === 'COMPLETE'
      ? text('すべての更新が完了しました。')
      : batch.status === 'PARTIAL'
        ? text('一部の更新に対応が必要です。')
        : text('更新を完了できませんでした。項目ごとの対応を確認してください。')

  return <section className={`connector-refresh-progress connector-refresh-progress--${batch.status.toLowerCase()}`} role="status" aria-live="polite" aria-label={text('コネクタ更新の進行状況')}>
    <strong>{headline}</strong>
    <ol className="connector-refresh-items">
      {batch.items.map((item) => <li key={connectorIdentity(item)}>
        <span>{summaryByIdentity.get(connectorIdentity(item))?.displayLabel ?? connectorKindLabel(item.connectorKind, text)}</span>
        <span>{refreshItemLabel(item, localeCode, text)}</span>
      </li>)}
    </ol>
  </section>
}

function connectorIdentity(value: Pick<ConnectorSummaryDto | ConnectorRefreshItemDto, 'connectorKind' | 'connectionKey'>): string {
  return `${value.connectorKind}:${value.connectionKey}`
}

function canRefresh(summary: ConnectorSummaryDto): boolean {
  return summary.availability === 'AVAILABLE'
    && summary.lifecycle === 'CONNECTED'
    && summary.connectorKind !== 'MANUAL_IMPORT'
    && summary.capabilities.includes('REFRESH_NOW')
}

function canDisconnect(summary: ConnectorSummaryDto): boolean {
  return summary.availability === 'AVAILABLE'
    && summary.lifecycle === 'CONNECTED'
    && summary.connectorKind !== 'MANUAL_IMPORT'
    && summary.capabilities.includes('DISCONNECT')
}

function connectorKindLabel(kind: ConnectorRefreshItemDto['connectorKind'], text: (value: string) => string): string {
  if (kind === 'GOOGLE_DRIVE') return 'Google Drive'
  if (kind === 'GMAIL') return 'Gmail'
  if (kind === 'WATCHED_FOLDER') return text('同期フォルダー')
  return text('手動インポート')
}

function refreshItemLabel(item: ConnectorRefreshItemDto, localeCode: string, text: (value: string) => string): string {
  if (item.status === 'PENDING') return text('待機中')
  if (item.status === 'RUNNING') return text('更新中')
  if (item.status === 'SUCCEEDED') return text('{count}件を検出').replace('{count}', item.changedCount.toLocaleString(localeCode))
  if (item.status === 'NO_CHANGES') return text('変更なし')
  if (item.status === 'SKIPPED_MANUAL') return text('手動で取り込み')
  if (item.status === 'FAILED_RETRYABLE') return text('再試行できます')
  return text('設定を確認してください')
}

function ConnectorBindingEditor({ summary, management, copy }: {
  readonly summary: ConnectorSummaryDto
  readonly management: ConnectorBindingManagement
  readonly copy: ConnectorControlCenterCopy
}) {
  const { text } = copy
  const binding = management.bindings.find((item) => item.connectorKind === summary.connectorKind && item.connectionKey === summary.connectionKey) ?? null
  const [selectedAccountIds, setSelectedAccountIds] = useState<readonly string[]>(binding?.allowedAccountIds ?? [])
  const [selectedParserToken, setSelectedParserToken] = useState(binding?.parserProfileId && binding.parserProfileVersion
    ? `${binding.parserProfileId}@${binding.parserProfileVersion}`
    : '')
  const [expectedVersion] = useState(binding?.version ?? null)
  const [conflicted, setConflicted] = useState(false)
  const [saving, setSaving] = useState(false)
  const operation = useRef<'save' | 'remove' | null>(null)
  const accounts = management.accounts
  const parserProfiles = management.parserProfiles.filter((profile) => profile.householdId === management.householdId && profile.isEnabled)
  const availableAccountIds = new Set(accounts.map(({ id }) => id))
  const validSelectedAccountIds = selectedAccountIds.filter((id) => availableAccountIds.has(id))
  const selectedParser = parserProfiles.find((profile) => `${profile.id}@${profile.version}` === selectedParserToken) ?? null
  const selectionUnavailable = conflicted
    || validSelectedAccountIds.length !== selectedAccountIds.length
    || (selectedParserToken !== '' && selectedParser === null)
  const canSave = !saving && !selectionUnavailable && validSelectedAccountIds.length > 0

  const changeAccount = (accountId: string, checked: boolean) => {
    setConflicted(false)
    setSelectedAccountIds((current) => {
      const available = current.filter((id) => availableAccountIds.has(id))
      return checked ? [...available.filter((id) => id !== accountId), accountId] : available.filter((id) => id !== accountId)
    })
  }
  const save = async () => {
    if (!canSave || operation.current !== null) return
    operation.current = 'save'
    setSaving(true)
    try {
      await management.onSave({
        householdId: management.householdId,
        connectorKind: summary.connectorKind,
        connectionKey: summary.connectionKey,
        allowedAccountIds: validSelectedAccountIds,
        parserProfileId: selectedParser?.id ?? null,
        parserProfileVersion: selectedParser?.version ?? null,
        expectedVersion,
      })
    } catch {
      setSelectedAccountIds([])
      setSelectedParserToken('')
      setConflicted(true)
      await management.onReload()
    } finally {
      operation.current = null
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!binding || expectedVersion === null || operation.current !== null) return
    operation.current = 'remove'
    setSaving(true)
    try {
      await management.onRemove({
        householdId: management.householdId,
        connectorKind: summary.connectorKind,
        connectionKey: summary.connectionKey,
        expectedVersion,
      })
    } catch {
      setSelectedAccountIds([])
      setSelectedParserToken('')
      setConflicted(true)
      await management.onReload()
    } finally {
      operation.current = null
      setSaving(false)
    }
  }

  return <div className="connector-binding-editor">
    <fieldset>
      <legend>{text('レビュー対象口座')}</legend>
      {accounts.map((account) => <label key={account.id}>
        <input type="checkbox" checked={validSelectedAccountIds.includes(account.id)} onChange={(event) => changeAccount(account.id, event.currentTarget.checked)} />
        {account.name}
      </label>)}
    </fieldset>
    <label>
      {text('読み取りプロファイル')}
      <select value={selectedParser?.id ? selectedParserToken : ''} onChange={(event) => { setConflicted(false); setSelectedParserToken(event.currentTarget.value) }}>
        <option value="">{text('プロファイルを使用しない')}</option>
        {parserProfiles.map((profile) => <option key={`${profile.id}@${profile.version}`} value={`${profile.id}@${profile.version}`}>{profile.name}</option>)}
      </select>
    </label>
    {selectionUnavailable && <p role="status">{text('選択内容が利用できなくなりました。新しい対応付けを明示的に選択してください。')}</p>}
    {!selectionUnavailable && validSelectedAccountIds.length === 0 && <p>{text('少なくとも1つのレビュー対象口座を選択してください。')}</p>}
    <div>
      <button type="button" disabled={!canSave} onClick={() => void save()}>{saving ? text('保存中…') : text('保存')}</button>
      {binding && <button type="button" aria-disabled={saving} onClick={() => void remove()}>{text('削除')}</button>}
    </div>
  </div>
}
