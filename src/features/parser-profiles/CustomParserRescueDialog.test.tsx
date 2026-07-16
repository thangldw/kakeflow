import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomParserRescueDialog } from './CustomParserRescueDialog'

const accounts = [
  { id: 'bank', name: '生活口座', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
  { id: 'expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
] as const

describe('CustomParserRescueDialog', () => {
  it('derives choices from the actual header, previews locally, and saves before review', async () => {
    const create = vi.fn(async (input) => ({ ...input, version: 1, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    const onSaved = vi.fn()
    render(<CustomParserRescueDialog householdId="family" filename="local.csv" bytes={new TextEncoder().encode('Date,Description,Amount\n2026/07/12,Local shop,-1200')} accounts={accounts} api={{ create, list: vi.fn().mockResolvedValue([]) }} onCancel={vi.fn()} onSaved={onSaved} />)

    expect(screen.getByRole('dialog')).toHaveAccessibleName(/手動マッピングで取り込む/)
    expect(screen.getAllByRole('option', { name: 'Date' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('option', { name: 'その他' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'Date' } })
    fireEvent.change(screen.getByLabelText('支払先列'), { target: { value: 'Description' } })
    fireEvent.change(screen.getByLabelText('符号付き金額列'), { target: { value: 'Amount' } })
    fireEvent.change(screen.getByLabelText('救済取込先口座'), { target: { value: 'bank' } })

    expect(await screen.findByText('utf-8 ・ 区切り「,」・ 候補 1件 ・ 除外 0行 ・ エラー 0件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存して取り込む' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', dateColumn: 'Date', payeeColumn: 'Description', signedAmountColumn: 'Amount' })))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), 'bank')
  })

  it('clears stale mappings when the selected header row changes', () => {
    render(<CustomParserRescueDialog householdId="family" filename="local.csv" bytes={new TextEncoder().encode('metadata,value\nDate,Payee,Debit,Credit\n2026/07/12,Shop,1200,')} accounts={accounts} api={{ create: vi.fn(), list: vi.fn() }} onCancel={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'metadata' } })
    expect(screen.getByLabelText('日付列')).toHaveValue('metadata')
    fireEvent.change(screen.getByLabelText('救済ヘッダー行'), { target: { value: '2' } })
    expect(screen.getByLabelText('日付列')).toHaveValue('')
    expect(screen.getAllByRole('option', { name: 'Date' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('option', { name: 'metadata' })).not.toBeInTheDocument()
  })

  it('limits header choices to the first twelve physical source rows', () => {
    const bytes = new TextEncoder().encode(`${'\n'.repeat(12)}Date,Payee,Amount\n2026/07/12,Shop,-1200`)
    render(<CustomParserRescueDialog householdId="family" filename="late.csv" bytes={bytes} accounts={accounts} api={{ create: vi.fn(), list: vi.fn() }} onCancel={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('option', { name: /Date/ })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('ヘッダー行を選択してください。')
  })

  it('retries applying an already saved profile without creating a duplicate', async () => {
    const create = vi.fn(async (input) => ({ ...input, version: 1, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    const onSaved = vi.fn().mockImplementationOnce(() => { throw new Error('temporary apply failure') })
    render(<CustomParserRescueDialog householdId="family" filename="local.csv" bytes={new TextEncoder().encode('Date,Payee,Amount\n2026/07/12,Shop,-1200')} accounts={accounts} api={{ create, list: vi.fn().mockResolvedValue([]) }} onCancel={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'Date' } })
    fireEvent.change(screen.getByLabelText('支払先列'), { target: { value: 'Payee' } })
    fireEvent.change(screen.getByLabelText('符号付き金額列'), { target: { value: 'Amount' } })
    fireEvent.change(screen.getByLabelText('救済取込先口座'), { target: { value: 'bank' } })

    fireEvent.click(screen.getByRole('button', { name: '保存して取り込む' }))
    expect(await screen.findByText('プロファイルは保存済みです。適用を再試行してください。')).toBeInTheDocument()
    expect(screen.getByLabelText('救済正の値の方向')).toBeDisabled()
    expect(screen.getByLabelText('符号付き金額列')).toBeDisabled()
    expect(screen.getByLabelText('救済取込先口座')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存済みプロファイルを再適用' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and restores focus when removed', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    const onCancel = vi.fn()
    const rendered = render(<CustomParserRescueDialog householdId="family" filename="local.csv" bytes={new TextEncoder().encode('Date,Payee,Amount')} accounts={accounts} api={{ create: vi.fn(), list: vi.fn() }} returnFocus={trigger} onCancel={onCancel} onSaved={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    rendered.unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
