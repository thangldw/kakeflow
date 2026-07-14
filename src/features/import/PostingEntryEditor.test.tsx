import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccountDto, PostingDecisionDto } from '../../platform'
import { PostingEntryEditor } from './PostingEntryEditor'

const accounts: AccountDto[] = [
  { id: 'expense', name: '食費', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
  { id: 'card', name: 'カード', accountKind: 'LIABILITY', accountSubtype: 'CREDIT_CARD', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
]
const decision: PostingDecisionDto = {
  candidateId: 'candidate', transactionId: 'transaction', transactionType: 'CARD_PURCHASE', payee: '店', description: null,
  attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, calculationTarget: true,
  entries: [{ id: 'd', accountId: 'expense', side: 'DEBIT', amountJpy: 1_000 }, { id: 'c', accountId: 'card', side: 'CREDIT', amountJpy: 1_000 }],
}

describe('PostingEntryEditor', () => {
  it('edits every posting field, adds and removes rows, and reports the three totals', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PostingEntryEditor candidateId="candidate" candidateAmountJpy={1_000} decision={decision} accounts={accounts} onChange={onChange} />)
    expect(screen.getByLabelText('candidateの仕訳合計')).toHaveTextContent('候補 ¥1,000借方 ¥1,000貸方 ¥1,000')
    fireEvent.change(screen.getByLabelText('candidateの1行目の借貸'), { target: { value: 'CREDIT' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ side: 'CREDIT' }), decision.entries[1]] }))
    fireEvent.click(screen.getByRole('button', { name: '仕訳行を追加' }))
    const added = onChange.mock.calls.at(-1)?.[0] as PostingDecisionDto
    expect(added.entries).toHaveLength(3)
    rerender(<PostingEntryEditor candidateId="candidate" candidateAmountJpy={1_000} decision={added} accounts={accounts} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'candidateの3行目を削除' }))
    expect((onChange.mock.calls.at(-1)?.[0] as PostingDecisionDto).entries).toHaveLength(2)
  })

  it('shows client validation and prevents removing either of the minimum two rows', () => {
    render(<PostingEntryEditor candidateId="candidate" candidateAmountJpy={1_000} decision={{ ...decision, entries: [decision.entries[0], { ...decision.entries[1], amountJpy: 900 }] }} accounts={accounts} onChange={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('借方合計と貸方合計が一致していません')
    expect(screen.getAllByRole('button', { name: /行目を削除/ })).toSatisfy((buttons: HTMLButtonElement[]) => buttons.every((button) => button.disabled))
  })
})
