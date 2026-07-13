import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportPendingImport = vi.fn()
const pickAndStagePendingImport = vi.fn()
const applyPendingImport = vi.fn()
const discardPendingImport = vi.fn()

vi.mock('../../platform', () => ({
  platformClient: {
    runtime: 'tauri',
    exportPendingImport: (...args: unknown[]) => exportPendingImport(...args),
    pickAndStagePendingImport: (...args: unknown[]) => pickAndStagePendingImport(...args),
    applyPendingImport: (...args: unknown[]) => applyPendingImport(...args),
    discardPendingImport: (...args: unknown[]) => discardPendingImport(...args),
  },
}))

import { PendingImportHandoffPanel } from './PendingImportHandoffPanel'
import type { AccountDto, HouseholdMemberDto, PendingImportStageDto, PendingReviewRunDto } from '../../platform'

const candidateRun: PendingReviewRunDto = {
  runId: 'run-1', documentId: 'doc-1', status: 'REVIEW_REQUIRED', adapterId: 'paypay-history-v1', adapterVersion: '1',
  startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'paypay.csv', mediaType: 'text/csv',
  byteSize: 512, sourceModifiedAt: null, recordCount: 14, candidateCount: 12, completionState: 'CANDIDATE_REVIEW',
}

const receiptRun: PendingReviewRunDto = { ...candidateRun, runId: 'receipt', originalFilename: 'receipt.jpg', adapterId: 'receipt-image-ocr-v1' }
const futureReceiptRun: PendingReviewRunDto = { ...candidateRun, runId: 'future-receipt', originalFilename: 'receipt.heic', adapterId: 'receipt-camera-v9' }
const investmentRun: PendingReviewRunDto = { ...candidateRun, runId: 'investment', originalFilename: 'asset.csv', adapterId: 'securities-asset-snapshot-v1' }
const sbiInvestmentRun: PendingReviewRunDto = { ...candidateRun, runId: 'sbi-investment', originalFilename: 'sbi-trades.csv', adapterId: 'sbi-securities-trade-history-v1' }
const sourceOnlyRun: PendingReviewRunDto = { ...candidateRun, runId: 'source-only', originalFilename: 'source.pdf', completionState: 'SOURCE_READY' }

const accounts: readonly AccountDto[] = [
  { id: 'wallet', name: 'PayPay', accountKind: 'ASSET', accountSubtype: 'WALLET', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
  { id: 'bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
]

const members: readonly HouseholdMemberDto[] = [
  { id: 'member-1', householdId: 'family', displayName: '花子', relationshipLabel: null, status: 'ACTIVE', sortOrder: 0, createdAt: '', updatedAt: '' },
  { id: 'archived', householdId: 'family', displayName: '退会済み', relationshipLabel: null, status: 'ARCHIVED', sortOrder: 1, createdAt: '', updatedAt: '' },
]

const staged: PendingImportStageDto = {
  packageId: 'package-1', schemaVersion: 1, originInstallationId: 'other-device', portableRunId: 'portable-run',
  manifestSha256: 'a'.repeat(64), sourceFilename: 'paypay.csv', sourceSha256: 'b'.repeat(64), recordCount: 14, candidateCount: 12, statementCount: 0,
  accountDependencies: [{ portableAccountId: 'portable-wallet', name: '元のPayPay', accountKind: 'ASSET', accountSubtype: 'WALLET', currency: 'JPY', institutionName: 'PayPay', maskedIdentifier: null }],
  memberDependencies: [{ portableMemberId: 'portable-member', displayName: '元の花子', role: 'OWNER' }],
  alreadyApplied: false, existingLocalRunId: null,
}

describe('PendingImportHandoffPanel', () => {
  beforeEach(() => {
    exportPendingImport.mockReset().mockResolvedValue({ packageId: 'package-1', schemaVersion: 1, householdId: 'family', portableRunId: 'portable-run', manifestSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), recordCount: 14, candidateCount: 12, statementCount: 0, byteSize: 1024 })
    pickAndStagePendingImport.mockReset().mockResolvedValue(staged)
    applyPendingImport.mockReset().mockResolvedValue({ packageId: 'package-1', localRunId: 'local-run', localDocumentId: 'local-doc', recordCount: 14, candidateCount: 12, statementCount: 0, reusedExisting: false })
    discardPendingImport.mockReset().mockResolvedValue(true)
  })

  it('states the local-only boundary and exports only eligible candidate-review runs', async () => {
    render(<PendingImportHandoffPanel householdId="family" accounts={accounts} members={members} pendingRuns={[candidateRun, receiptRun, futureReceiptRun, investmentRun, sbiInvestmentRun, sourceOnlyRun]} onApplied={vi.fn()} />)
    expect(screen.getByText(/ネットワーク送受信やクラウド同期は行いません/)).toBeInTheDocument()
    expect(screen.getByText(/改めて確認と承認が必要/)).toBeInTheDocument()
    expect(await screen.findByText('paypay.csv')).toBeInTheDocument()
    expect(screen.queryByText('receipt.jpg')).not.toBeInTheDocument()
    expect(screen.queryByText('receipt.heic')).not.toBeInTheDocument()
    expect(screen.queryByText('asset.csv')).not.toBeInTheDocument()
    expect(screen.queryByText('sbi-trades.csv')).not.toBeInTheDocument()
    expect(screen.queryByText('source.pdf')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('保存用パスフレーズ'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.change(screen.getByLabelText('保存用パスフレーズを確認'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'paypay.csvを受け渡しファイルに保存' }))

    await waitFor(() => expect(exportPendingImport).toHaveBeenCalledWith({ householdId: 'family', runId: 'run-1' }, 'long-enough-passphrase'))
    expect(await screen.findByText(/12候補をローカルの受け渡しファイルに保存/)).toBeInTheDocument()
  })

  it('requires explicit compatible account and active-member mappings before adding to review', async () => {
    const onApplied = vi.fn()
    render(<PendingImportHandoffPanel householdId="family" accounts={accounts} members={members} pendingRuns={[candidateRun]} onApplied={onApplied} />)
    fireEvent.change(screen.getByLabelText('受け取り用パスフレーズ'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))

    expect(await screen.findByText('対応先を確認')).toBeInTheDocument()
    const accountSelect = screen.getByLabelText('元のPayPayの対応先口座')
    const memberSelect = screen.getByLabelText('元の花子の対応先メンバー')
    expect(accountSelect).toHaveValue('')
    expect(memberSelect).toHaveValue('')
    expect(screen.queryByRole('option', { name: '銀行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '退会済み' })).not.toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'Import Inboxの確認待ちに追加' })
    expect(apply).toBeDisabled()

    fireEvent.change(accountSelect, { target: { value: 'wallet' } })
    expect(apply).toBeDisabled()
    fireEvent.change(memberSelect, { target: { value: 'member-1' } })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(applyPendingImport).toHaveBeenCalledWith('family', 'package-1', {
      accounts: [{ portableAccountId: 'portable-wallet', localAccountId: 'wallet' }],
      members: [{ portableMemberId: 'portable-member', localMemberId: 'member-1' }],
    }))
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/台帳へは自動反映していません/)).toBeInTheDocument()
  })

  it('labels an already-applied package and reopens the existing review without inheriting approvals', async () => {
    pickAndStagePendingImport.mockResolvedValue({ ...staged, alreadyApplied: true, existingLocalRunId: 'local-run' })
    applyPendingImport.mockResolvedValue({ packageId: 'package-1', localRunId: 'local-run', localDocumentId: 'local-doc', recordCount: 14, candidateCount: 12, statementCount: 0, reusedExisting: true })
    render(<PendingImportHandoffPanel householdId="family" accounts={accounts} members={members} pendingRuns={[candidateRun]} onApplied={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('受け取り用パスフレーズ'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))
    expect(await screen.findByText(/追加済み.*local-run/)).toBeInTheDocument()
    const reopen = screen.getByRole('button', { name: 'Import Inboxの確認待ちに追加' })
    expect(reopen).toBeEnabled()
    expect(screen.queryByLabelText('元のPayPayの対応先口座')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('元の花子の対応先メンバー')).not.toBeInTheDocument()
    expect(screen.getByText(/この端末に追加したときの対応付けを再利用/)).toBeInTheDocument()
    fireEvent.click(reopen)
    await waitFor(() => expect(applyPendingImport).toHaveBeenCalledWith('family', 'package-1', { accounts: [], members: [] }))
    expect(await screen.findByText(/承認は引き継がず/)).toBeInTheDocument()
  })

  it('discards the prior native stage before replacing it with another selected file', async () => {
    const replacement = { ...staged, packageId: 'package-2', portableRunId: 'portable-run-2', sourceFilename: 'bank.csv' }
    pickAndStagePendingImport.mockResolvedValueOnce(staged).mockResolvedValueOnce(replacement)
    const view = render(<PendingImportHandoffPanel householdId="family" accounts={accounts} members={members} pendingRuns={[candidateRun]} onApplied={vi.fn()} />)
    const passphrase = screen.getByLabelText('受け取り用パスフレーズ')
    fireEvent.change(passphrase, { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))
    expect(await screen.findByText('対応先を確認')).toBeInTheDocument()
    fireEvent.change(passphrase, { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))
    await waitFor(() => expect(discardPendingImport).toHaveBeenCalledWith('package-1'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '対応先を確認' }).parentElement).toHaveTextContent('bank.csv'))
    expect(discardPendingImport.mock.invocationCallOrder[0]).toBeLessThan(pickAndStagePendingImport.mock.invocationCallOrder[1])
    view.rerender(<PendingImportHandoffPanel householdId="other" accounts={accounts} members={members} pendingRuns={[]} onApplied={vi.fn()} />)
    await waitFor(() => expect(discardPendingImport).toHaveBeenCalledWith('package-2'))
  })

  it('discards staged data and ignores a delayed picker result after the household changes', async () => {
    let finishPick: (value: PendingImportStageDto) => void = () => undefined
    pickAndStagePendingImport.mockReturnValue(new Promise((resolve) => { finishPick = resolve }))
    const view = render(<PendingImportHandoffPanel householdId="family" accounts={accounts} members={members} pendingRuns={[candidateRun]} onApplied={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('受け取り用パスフレーズ'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))
    view.rerender(<PendingImportHandoffPanel householdId="other" accounts={accounts} members={members} pendingRuns={[]} onApplied={vi.fn()} />)
    finishPick(staged)
    await waitFor(() => expect(screen.queryByText('対応先を確認')).not.toBeInTheDocument())
    await waitFor(() => expect(discardPendingImport).toHaveBeenCalledWith('package-1'))
    expect(screen.queryByText('対応先を確認')).not.toBeInTheDocument()

    pickAndStagePendingImport.mockResolvedValue(staged)
    fireEvent.change(screen.getByLabelText('受け取り用パスフレーズ'), { target: { value: 'long-enough-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確認待ちファイルを開く' }))
    expect(await screen.findByText('対応先を確認')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '一時データを破棄' }))
    await waitFor(() => expect(discardPendingImport).toHaveBeenCalledWith('package-1'))
    expect(screen.queryByText('対応先を確認')).not.toBeInTheDocument()
  })
})
