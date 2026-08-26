import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountDto, ConnectorBindingDto, ConnectorRefreshBatchProgressDto, ConnectorSummaryDto, ConfigurationDestinationDto } from '../../platform/types'
import type { DelimitedParserProfileDto } from '../parser-profiles/delimitedParserProfilePlatform'
import { I18nProvider } from '../../i18n'
import { ConnectorControlCenter } from './ConnectorControlCenter'

const summary = (overrides: Partial<ConnectorSummaryDto> = {}): ConnectorSummaryDto => ({
  schemaVersion: 1,
  connectorKind: 'GOOGLE_DRIVE',
  connectionKey: 'never-render-this-provider-id',
  displayLabel: 'Household statements',
  availability: 'AVAILABLE',
  lifecycle: 'CONNECTED',
  health: 'FRESH',
  capabilities: ['CONFIGURE', 'REFRESH_NOW', 'SCHEDULE'],
  lastAttemptAt: '2026-08-24T23:50:00Z',
  lastSuccessAt: '2026-08-25T00:00:00Z',
  freshnessDeadlineAt: '2026-08-26T00:00:00Z',
  nextDueAt: '2026-08-25T00:30:00Z',
  pendingReviewCount: 3,
  consecutiveFailures: 0,
  lastErrorCode: null,
  bindingSummary: { allowedAccountCount: 2, parserProfileConfigured: true, version: 7 },
  configurationDestination: 'GOOGLE_DRIVE_SETTINGS',
  ...overrides,
})

const account = (id: string, name: string): AccountDto => ({
  id, name, accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD',
  ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED',
})

const profile = (overrides: Partial<DelimitedParserProfileDto> = {}): DelimitedParserProfileDto => ({
  id: 'profile-bank', householdId: 'family', name: 'Bank CSV', delimiter: 'COMMA', encoding: 'UTF8', headerRow: 1,
  dateColumn: 'Date', dateFormat: 'YYYY_MM_DD', descriptionColumn: 'Description', payeeColumn: null,
  amountMode: 'SIGNED', signedPositiveDirection: 'IN', signedAmountColumn: 'Amount', debitColumn: null, creditColumn: null,
  externalIdColumn: null, accountHintColumn: null, isEnabled: true, priority: 10, version: 2,
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
  ...overrides,
})

const binding = (overrides: Partial<ConnectorBindingDto> = {}): ConnectorBindingDto => ({
  householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'never-render-this-provider-id',
  allowedAccountIds: ['family-bank'], parserProfileId: 'profile-bank', parserProfileVersion: 2,
  version: 7, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
  ...overrides,
})

const refreshBatch = (overrides: Partial<ConnectorRefreshBatchProgressDto> = {}): ConnectorRefreshBatchProgressDto => ({
  schemaVersion: 1,
  batchId: 'batch-1',
  householdId: 'family',
  status: 'ACTIVE',
  totalCount: 2,
  terminalCount: 1,
  succeededCount: 1,
  noChangesCount: 0,
  skippedManualCount: 0,
  failedCount: 0,
  changedCount: 3,
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:01Z',
  completedAt: null,
  items: [
    { connectorKind: 'GOOGLE_DRIVE', connectionKey: 'never-render-this-provider-id', status: 'SUCCEEDED', changedCount: 3, lastErrorCode: null, updatedAt: '2026-08-25T00:00:01Z', startedAt: '2026-08-25T00:00:00Z', completedAt: '2026-08-25T00:00:01Z' },
    { connectorKind: 'GMAIL', connectionKey: 'gmail-primary', status: 'RUNNING', changedCount: 0, lastErrorCode: null, updatedAt: '2026-08-25T00:00:01Z', startedAt: '2026-08-25T00:00:01Z', completedAt: null },
  ],
  ...overrides,
})

describe('ConnectorControlCenter', () => {
  beforeEach(() => localStorage.clear())

  it('shows aggregate status, badge precedence, dates, counts, and review-only refresh semantics', () => {
    render(<ConnectorControlCenter summaries={[
      summary(),
      summary({ connectorKind: 'GMAIL', connectionKey: 'gmail-provider-id', displayLabel: 'Receipt mail', health: 'NEEDS_ACTION', lastSuccessAt: null, nextDueAt: null, pendingReviewCount: 0, configurationDestination: 'GMAIL_SETTINGS' }),
    ]} loading={false} error={null} onConfigure={() => undefined} />)

    expect(screen.getByRole('heading', { name: 'コネクタ管理センター' })).toBeInTheDocument()
    expect(screen.getByText('接続済み', { selector: 'dt' }).closest('div')).toHaveTextContent('接続済み2')
    expect(screen.getByText('要対応', { selector: 'dt' }).closest('div')).toHaveTextContent('要対応1')
    expect(screen.getByText('要対応', { selector: '.connector-control-badge' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Household statements' })
    expect(within(card).getByText('最後に成功した更新').closest('div')).toHaveTextContent(/最後に成功した更新2026\/0?8\/25 9:00/)
    expect(within(card).getByText('次回の予定更新').closest('div')).toHaveTextContent(/次回の予定更新2026\/0?8\/25 9:30/)
    expect(within(card).getByText('レビュー待ち').closest('div')).toHaveTextContent('レビュー待ち3件')
    expect(screen.getByText('更新はレビュー候補を作成します。台帳へ自動記帳されることはありません。')).toBeInTheDocument()
    expect(screen.queryByText('never-render-this-provider-id')).not.toBeInTheDocument()
    expect(screen.queryByText('gmail-provider-id')).not.toBeInTheDocument()
    expect(screen.queryByText(/version|cursor|\/Users\//i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /接続|同期|スケジュール|解除/ })).not.toBeInTheDocument()
  })

  it('filters stale and actionable connectors with pressed-state semantics', () => {
    render(<ConnectorControlCenter summaries={[
      summary({ connectionKey: 'fresh', displayLabel: 'Fresh source' }),
      summary({ connectionKey: 'stale', displayLabel: 'Stale source', health: 'STALE' }),
      summary({ connectionKey: 'backoff', displayLabel: 'Retry source', health: 'RETRY_BACKOFF' }),
    ]} loading={false} error={null} onConfigure={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '古いデータ' }))
    expect(screen.getByRole('button', { name: '古いデータ' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Stale source')).toBeInTheDocument()
    expect(screen.queryByText('Fresh source')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '要対応' }))
    expect(screen.getByText('Retry source')).toBeInTheDocument()
    expect(screen.queryByText('Stale source')).not.toBeInTheDocument()
  })

  it('reports an empty filtered result and the global zero state distinctly', () => {
    const { rerender } = render(<ConnectorControlCenter summaries={[summary()]} loading={false} error={null} onConfigure={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '古いデータ' }))
    expect(screen.getByText('この条件に一致するコネクタはありません。')).toBeInTheDocument()

    rerender(<ConnectorControlCenter summaries={[]} loading={false} error={null} onConfigure={() => undefined} />)
    expect(screen.getByText('表示できるコネクタはありません。')).toBeInTheDocument()
  })

  it('discloses runtime unavailability without exposing internal reasons', () => {
    render(<ConnectorControlCenter summaries={[summary({ availability: 'RUNTIME_UNSUPPORTED', lifecycle: 'DISCONNECTED', health: 'NEVER_REFRESHED', capabilities: [], lastErrorCode: 'PRIVATE_NATIVE_REASON' })]} loading={false} error={null} onConfigure={() => undefined} />)

    expect(screen.getByText('この実行環境では利用できません。デスクトップ版の設定を確認してください。')).toBeInTheDocument()
    expect(screen.queryByText('PRIVATE_NATIVE_REASON')).not.toBeInTheDocument()
  })

  it('delegates configuration by destination and exposes no authorization or scheduling mutations', () => {
    const onConfigure = vi.fn<(destination: ConfigurationDestinationDto) => void>()
    render(<ConnectorControlCenter summaries={[summary()]} loading={false} error={null} onConfigure={onConfigure} />)

    const card = screen.getByRole('article', { name: 'Household statements' })
    fireEvent.click(within(card).getByRole('button', { name: '設定を開く' }))
    expect(onConfigure).toHaveBeenCalledWith('GOOGLE_DRIVE_SETTINGS')
    expect(within(card).queryByRole('button', { name: /認証|更新|同期|スケジュール|解除/ })).not.toBeInTheDocument()
  })

  it('shows polite ACTIVE progress in deterministic order and blocks every refresh or disconnect mutation until terminal', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const onDisconnect = vi.fn().mockResolvedValue(undefined)
    render(<ConnectorControlCenter summaries={[
      summary({ capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'SCHEDULE', 'RETRY'] }),
      summary({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary', displayLabel: 'Receipt mail', health: 'RUNNING', capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'SCHEDULE', 'RETRY'], configurationDestination: 'GMAIL_SETTINGS' }),
    ]} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{
      batch: refreshBatch(), starting: false, error: null, onRefresh, onRefreshAll: vi.fn(), onDisconnect,
    }} />)

    const progress = screen.getByRole('status', { name: 'コネクタ更新の進行状況' })
    expect(progress).toHaveAttribute('aria-live', 'polite')
    expect(progress).toHaveTextContent('1 / 2')
    const items = within(progress).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Household statements'),
      expect.stringContaining('Receipt mail'),
    ])
    expect(within(items[0]).getByText('3件を検出')).toBeInTheDocument()
    const cards = [
      screen.getByRole('article', { name: 'Household statements' }),
      screen.getByRole('article', { name: 'Receipt mail' }),
    ]
    for (const card of cards) {
      const refresh = within(card).getByRole('button', { name: '更新' })
      const disconnect = within(card).getByRole('button', { name: '接続解除' })
      expect(refresh).toBeDisabled()
      expect(disconnect).toBeDisabled()
      fireEvent.click(refresh)
      fireEvent.click(disconnect)
      expect(within(card).getByRole('button', { name: '設定を開く' })).toBeEnabled()
    }
    expect(screen.getByRole('button', { name: 'すべて更新' })).toBeDisabled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('gmail-primary')
  })

  it('renders complete, partial, and failed terminal summaries with distinct retryable and needs-action outcomes', () => {
    const management = {
      starting: false, error: null, onRefresh: vi.fn(), onRefreshAll: vi.fn(), onDisconnect: vi.fn(),
    }
    const terminalItems = [
      { connectorKind: 'GOOGLE_DRIVE' as const, connectionKey: 'never-render-this-provider-id', status: 'FAILED_RETRYABLE' as const, changedCount: 0, lastErrorCode: 'RATE_LIMITED', updatedAt: '2026-08-25T00:00:02Z', startedAt: '2026-08-25T00:00:00Z', completedAt: '2026-08-25T00:00:02Z' },
      { connectorKind: 'GMAIL' as const, connectionKey: 'gmail-primary', status: 'NEEDS_ACTION' as const, changedCount: 0, lastErrorCode: 'AUTH_REQUIRED', updatedAt: '2026-08-25T00:00:03Z', startedAt: '2026-08-25T00:00:02Z', completedAt: '2026-08-25T00:00:03Z' },
    ]
    const summaries = [
      summary({ capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'RETRY'] }),
      summary({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary', displayLabel: 'Receipt mail', health: 'NEEDS_ACTION', capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'RETRY'], configurationDestination: 'GMAIL_SETTINGS' }),
    ]
    const { rerender } = render(<ConnectorControlCenter summaries={summaries} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{ ...management, batch: refreshBatch({ status: 'COMPLETE', terminalCount: 2, succeededCount: 1, items: [refreshBatch().items[0], { ...refreshBatch().items[1], status: 'NO_CHANGES', startedAt: '2026-08-25T00:00:01Z', completedAt: '2026-08-25T00:00:02Z' }], completedAt: '2026-08-25T00:00:02Z' }) }} />)
    expect(screen.getByRole('status', { name: 'コネクタ更新の進行状況' })).toHaveTextContent('すべての更新が完了しました。')

    rerender(<ConnectorControlCenter summaries={summaries} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{ ...management, batch: refreshBatch({ status: 'PARTIAL', terminalCount: 2, succeededCount: 0, failedCount: 2, changedCount: 0, items: terminalItems, completedAt: '2026-08-25T00:00:03Z' }) }} />)
    const partial = screen.getByRole('status', { name: 'コネクタ更新の進行状況' })
    expect(partial).toHaveTextContent('一部の更新に対応が必要です。')
    expect(partial).toHaveTextContent('再試行できます')
    expect(partial).toHaveTextContent('設定を確認してください')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(<ConnectorControlCenter summaries={summaries} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{ ...management, batch: refreshBatch({ status: 'FAILED', terminalCount: 2, succeededCount: 0, failedCount: 2, changedCount: 0, items: terminalItems, completedAt: '2026-08-25T00:00:03Z' }) }} />)
    expect(screen.getByRole('status', { name: 'コネクタ更新の進行状況' })).toHaveTextContent('更新を完了できませんでした。項目ごとの対応を確認してください。')
  })

  it('restores focus after refresh and confirms disconnect before delegating the typed action', async () => {
    let finishRefresh: (() => void) | undefined
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve }))
    const onDisconnect = vi.fn().mockResolvedValue(undefined)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<ConnectorControlCenter summaries={[summary({ capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW'] })]} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{
      batch: null, starting: false, error: null, onRefresh, onRefreshAll: vi.fn(), onDisconnect,
    }} />)

    const refresh = screen.getByRole('button', { name: '更新' })
    fireEvent.click(refresh)
    expect(refresh).toBeDisabled()
    await act(async () => { finishRefresh?.(); await Promise.resolve() })
    expect(refresh).toHaveFocus()

    const disconnect = screen.getByRole('button', { name: '接続解除' })
    fireEvent.click(disconnect)
    expect(confirm).toHaveBeenCalledWith('Household statementsの接続を解除しますか？取り込み済みの証跡と台帳は保持されます。')
    expect(onDisconnect).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await act(async () => { fireEvent.click(disconnect); await Promise.resolve() })
    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ connectorKind: 'GOOGLE_DRIVE', connectionKey: 'never-render-this-provider-id' }))
  })

  it('exposes no refresh, retry, disconnect, or refresh-all action for manual and runtime-unsupported sources', () => {
    render(<ConnectorControlCenter summaries={[
      summary({ connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import', displayLabel: 'Manual import', lifecycle: 'CONNECTED', health: 'MANUAL', capabilities: ['IMPORT_FILE', 'ACCOUNT_BINDING'], lastAttemptAt: null, lastSuccessAt: null, freshnessDeadlineAt: null, nextDueAt: null, configurationDestination: 'IMPORT_INBOX' }),
      summary({ connectionKey: 'native-only', displayLabel: 'Native source', availability: 'RUNTIME_UNSUPPORTED', lifecycle: 'DISCONNECTED', health: 'NEVER_REFRESHED', capabilities: [] }),
    ]} loading={false} error={null} onConfigure={() => undefined} refreshManagement={{
      batch: null, starting: false, error: null, onRefresh: vi.fn(), onRefreshAll: vi.fn(), onDisconnect: vi.fn(),
    }} />)

    expect(screen.queryByRole('button', { name: /^(更新|再試行|接続解除|すべて更新)$/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '設定を開く' })).toHaveLength(2)
  })

  it('edits loaded bindings only through explicit Save and Remove actions with the loaded version', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onRemove = vi.fn().mockResolvedValue(undefined)
    const onReload = vi.fn().mockResolvedValue(undefined)
    render(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'] })]}
      loading={false} error={null} onConfigure={() => undefined}
      bindingManagement={{
        householdId: 'family', bindings: [binding()],
        accounts: [account('family-bank', 'Family bank'), account('family-card', 'Family card')],
        parserProfiles: [profile()], onSave, onRemove, onReload,
      }}
    />)

    const card = screen.getByRole('article', { name: 'Household statements' })
    fireEvent.click(within(card).getByRole('button', { name: 'レビュー範囲を管理' }))
    expect(screen.getByRole('checkbox', { name: 'Family bank' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Family card' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '読み取りプロファイル' })).toHaveValue('profile-bank@2')
    expect(onSave).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Family card' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); await Promise.resolve() })
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({
      householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'never-render-this-provider-id',
      allowedAccountIds: ['family-bank', 'family-card'], parserProfileId: 'profile-bank', parserProfileVersion: 2,
      expectedVersion: 7,
    }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除' })); await Promise.resolve() })
    await vi.waitFor(() => expect(onRemove).toHaveBeenCalledWith({
      householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'never-render-this-provider-id', expectedVersion: 7,
    }))
  })

  it('never auto-selects an account or parser for a new binding', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'], bindingSummary: null })]}
      loading={false} error={null} onConfigure={() => undefined}
      bindingManagement={{
        householdId: 'family', bindings: [], accounts: [account('family-bank', 'Family bank')],
        parserProfiles: [profile()], onSave, onRemove: vi.fn(), onReload: vi.fn(),
      }}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'レビュー範囲を管理' }))
    expect(screen.getByRole('checkbox', { name: 'Family bank' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '読み取りプロファイル' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('reloads after an optimistic conflict and clears archived account and stale parser selections', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('conflict'))
    const onReload = vi.fn().mockResolvedValue(undefined)
    const management = {
      householdId: 'family', bindings: [binding()], accounts: [account('family-bank', 'Family bank')],
      parserProfiles: [profile()], onSave, onRemove: vi.fn(), onReload,
    }
    const { rerender } = render(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'] })]}
      loading={false} error={null} onConfigure={() => undefined} bindingManagement={management}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'レビュー範囲を管理' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); await Promise.resolve() })
    await vi.waitFor(() => expect(onReload).toHaveBeenCalledOnce())

    rerender(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'] })]}
      loading={false} error={null} onConfigure={() => undefined}
      bindingManagement={{ ...management, accounts: [account('replacement-bank', 'Replacement bank')], parserProfiles: [profile({ version: 3 })] }}
    />)

    expect(screen.getByRole('checkbox', { name: 'Replacement bank' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '読み取りプロファイル' })).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('選択内容が利用できなくなりました。新しい対応付けを明示的に選択してください。')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(onSave).toHaveBeenCalledOnce()
  })

  it.each(['保存', '削除'] as const)('keeps the draft version when refreshed props race with %s', async (action) => {
    const onSave = vi.fn().mockRejectedValue(new Error('conflict'))
    const onRemove = vi.fn().mockRejectedValue(new Error('conflict'))
    const onReload = vi.fn().mockResolvedValue(undefined)
    const management = {
      householdId: 'family', bindings: [binding({ version: 7 })], accounts: [account('family-bank', 'Family bank')],
      parserProfiles: [profile()], onSave, onRemove, onReload,
    }
    const { rerender } = render(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'] })]}
      loading={false} error={null} onConfigure={() => undefined} bindingManagement={management}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'レビュー範囲を管理' }))

    rerender(<ConnectorControlCenter
      summaries={[summary({ capabilities: ['CONFIGURE', 'ACCOUNT_BINDING'] })]}
      loading={false} error={null} onConfigure={() => undefined}
      bindingManagement={{ ...management, bindings: [binding({ version: 8 })] }}
    />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })); await Promise.resolve() })

    const mutation = action === '保存' ? onSave : onRemove
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 })))
    expect(mutation).toHaveBeenCalledOnce()
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('renders loading and bounded runtime failure states without provider detail', () => {
    const { rerender } = render(<ConnectorControlCenter summaries={[]} loading error={null} onConfigure={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('コネクタの状態を読み込んでいます…')

    rerender(<ConnectorControlCenter summaries={[]} loading={false} error="native ipc/private/path" onConfigure={() => undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('コネクタの状態を読み込めませんでした。')
    expect(screen.queryByText('native ipc/private/path')).not.toBeInTheDocument()
  })

  it.each([
    ['en', 'Last successful refresh', 'No successful refresh yet', 'Next scheduled refresh', 'Not scheduled', 'Pending review', '3 items'],
    ['vi', 'Lần cập nhật thành công gần nhất', 'Chưa có lần cập nhật thành công', 'Lần cập nhật theo lịch tiếp theo', 'Không có lịch', 'Chờ kiểm tra', '3 mục'],
  ] as const)('renders reviewed %s phrases for counts and null dates', (locale, lastLabel, lastNull, nextLabel, nextNull, pendingLabel, count) => {
    localStorage.setItem('kakeflow.locale', locale)
    render(<I18nProvider><ConnectorControlCenter summaries={[summary({ connectorKind: 'MANUAL_IMPORT', lifecycle: 'CONNECTED', health: 'MANUAL', capabilities: ['IMPORT_FILE', 'ACCOUNT_BINDING'], lastAttemptAt: null, lastSuccessAt: null, freshnessDeadlineAt: null, nextDueAt: null, pendingReviewCount: 3, configurationDestination: 'IMPORT_INBOX' })]} loading={false} error={null} onConfigure={() => undefined} /></I18nProvider>)

    expect(screen.getByText(lastLabel).closest('div')).toHaveTextContent(`${lastLabel}${lastNull}`)
    expect(screen.getByText(nextLabel).closest('div')).toHaveTextContent(`${nextLabel}${nextNull}`)
    expect(screen.getByText(pendingLabel).closest('div')).toHaveTextContent(`${pendingLabel}${count}`)
    expect(document.body.textContent).not.toContain('3items')
    expect(document.body.textContent).not.toContain('3mục')
    expect(screen.queryByText('final success', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Next schedule', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Not executed', { exact: true })).not.toBeInTheDocument()
  })
})
