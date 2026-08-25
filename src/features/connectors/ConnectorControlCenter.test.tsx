import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectorSummaryDto, ConfigurationDestinationDto } from '../../platform/types'
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

describe('ConnectorControlCenter', () => {
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
    expect(within(card).getByText('最終成功').closest('div')).toHaveTextContent(/最終成功2026\/0?8\/25 9:00/)
    expect(within(card).getByText('次回予定').closest('div')).toHaveTextContent(/次回予定2026\/0?8\/25 9:30/)
    expect(within(card).getByText('確認待ち').closest('div')).toHaveTextContent('確認待ち3件')
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

  it('renders loading and bounded runtime failure states without provider detail', () => {
    const { rerender } = render(<ConnectorControlCenter summaries={[]} loading error={null} onConfigure={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('コネクタの状態を読み込んでいます…')

    rerender(<ConnectorControlCenter summaries={[]} loading={false} error="native ipc/private/path" onConfigure={() => undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('コネクタの状態を読み込めませんでした。')
    expect(screen.queryByText('native ipc/private/path')).not.toBeInTheDocument()
  })
})
