import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DelimitedParserProfilesPanel } from './DelimitedParserProfilesPanel'
import { createDelimitedParserProfilePlatform, type DelimitedParserProfileDto } from './delimitedParserProfilePlatform'

const profile: DelimitedParserProfileDto = {
  id: 'profile-1', householdId: 'family', name: '地域銀行', delimiter: 'COMMA', encoding: 'CP932', headerRow: 2,
  dateColumn: '日付', dateFormat: 'YYYY_MM_DD', descriptionColumn: '摘要', payeeColumn: null, amountMode: 'SIGNED', signedAmountColumn: '金額',
  signedPositiveDirection: 'IN',
  debitColumn: null, creditColumn: null, externalIdColumn: null, accountHintColumn: null, isEnabled: true, priority: 20,
  version: 4, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T01:00:00Z',
}

function apiWith(items: readonly DelimitedParserProfileDto[]) {
  return {
    list: vi.fn().mockResolvedValue(items),
    create: vi.fn().mockResolvedValue(profile),
    update: vi.fn().mockResolvedValue({ ...profile, name: '地域銀行 更新', version: 5 }),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof createDelimitedParserProfilePlatform>
}

describe('DelimitedParserProfilesPanel', () => {
  it('creates a signed-amount profile after validating its mapping', async () => {
    const api = apiWith([])
    render(<DelimitedParserProfilesPanel householdId="family" api={api} />)
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('family'))

    fireEvent.change(screen.getByLabelText('プロファイル名'), { target: { value: 'Local card' } })
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'Date' } })
    fireEvent.change(screen.getByLabelText('摘要列'), { target: { value: 'Description' } })
    fireEvent.change(screen.getByLabelText('符号付き金額列'), { target: { value: 'Amount' } })
    fireEvent.click(screen.getByRole('button', { name: 'プロファイルを保存' }))

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', name: 'Local card', dateColumn: 'Date', descriptionColumn: 'Description',
      amountMode: 'SIGNED', signedPositiveDirection: 'IN', signedAmountColumn: 'Amount', debitColumn: null, creditColumn: null,
    })))
    expect(await screen.findByText('プロファイルを保存しました。')).toBeInTheDocument()
  })

  it('uses optimistic versions for update and delete', async () => {
    const api = apiWith([profile])
    render(<DelimitedParserProfilesPanel householdId="family" api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: '地域銀行を編集' }))
    expect(screen.getByText('編集中: v4')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('プロファイル名'), { target: { value: '地域銀行 更新' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile-1', expectedVersion: 4, name: '地域銀行 更新' })))

    fireEvent.click(screen.getByRole('button', { name: '地域銀行を削除' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith({ householdId: 'family', profileId: 'profile-1', expectedVersion: 4 }))
  })

  it('rejects duplicate columns and values outside backend bounds', async () => {
    const api = apiWith([])
    render(<DelimitedParserProfilesPanel householdId="family" api={api} />)
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('family'))
    fireEvent.change(screen.getByLabelText('プロファイル名'), { target: { value: 'Invalid' } })
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'Same' } })
    fireEvent.change(screen.getByLabelText('摘要列'), { target: { value: 'Same' } })
    fireEvent.change(screen.getByLabelText('符号付き金額列'), { target: { value: 'Amount' } })
    expect(screen.getByText('同じ列名を複数の項目に割り当てることはできません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロファイルを保存' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('摘要列'), { target: { value: 'Description' } })
    fireEvent.change(screen.getByLabelText('ヘッダー行'), { target: { value: '1001' } })
    expect(screen.getByText('ヘッダー行は1〜1000の整数で指定してください。')).toBeInTheDocument()
  })
})
