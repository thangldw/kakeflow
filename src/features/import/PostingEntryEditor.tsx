import type { AccountDto, PostingDecisionDto } from '../../platform'
import { accountKindLabel, canonicalAccountName } from '../../displayLabels'
import { localize, useI18n } from '../../i18n'
import { validatePostingDecision } from './receiptSplitPosting'

const MAX_ENTRIES = 128

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

const validationMessages: Record<string, string> = {
  INVALID_CANDIDATE_AMOUNT: '候補金額が不正です。',
  INVALID_DECISION_ID: '取引IDが不正です。',
  CANDIDATE_ID_MISMATCH: '候補IDが一致しません。',
  INVALID_TRANSACTION_TYPE: '取引種別を選択してください。',
  INVALID_ENTRY_COUNT: '仕訳は2行以上128行以下にしてください。',
  INVALID_ENTRY_ID: '仕訳行IDが不正です。',
  DUPLICATE_ENTRY_ID: '仕訳行IDが重複しています。',
  INVALID_ACCOUNT_ID: 'すべての仕訳行で口座を選択してください。',
  UNKNOWN_ACCOUNT_ID: '利用できない口座が含まれています。',
  INVALID_ENTRY_AMOUNT: '金額は1円以上の整数で入力してください。',
  UNBALANCED_TOTAL: '借方合計と貸方合計が一致していません。',
  CANDIDATE_TOTAL_MISMATCH: '借方・貸方の各合計を候補金額に一致させてください。',
}

export interface PostingEntryEditorProps {
  readonly candidateId: string
  readonly candidateAmountJpy: number
  readonly decision: PostingDecisionDto
  readonly accounts: readonly AccountDto[]
  readonly onChange: (decision: PostingDecisionDto) => void
}

export function PostingEntryEditor({ candidateId, candidateAmountJpy, decision, accounts, onChange }: PostingEntryEditorProps) {
  const { text } = useI18n()
  const validation = validatePostingDecision(decision, {
    candidateAmountJpy,
    accountIds: new Set(accounts.map((account) => account.id)),
    expectedCandidateId: candidateId,
  })
  const debitTotal = decision.entries.filter((entry) => entry.side === 'DEBIT').reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amountJpy) ? entry.amountJpy : 0), 0)
  const creditTotal = decision.entries.filter((entry) => entry.side === 'CREDIT').reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amountJpy) ? entry.amountJpy : 0), 0)

  const updateEntry = (entryId: string, change: Partial<PostingDecisionDto['entries'][number]>) => {
    onChange({ ...decision, entries: decision.entries.map((entry) => entry.id === entryId ? { ...entry, ...change } : entry) })
  }
  const addEntry = () => {
    if (decision.entries.length >= MAX_ENTRIES) return
    onChange({ ...decision, entries: [...decision.entries, { id: globalThis.crypto.randomUUID(), accountId: '', side: 'DEBIT', amountJpy: 0 }] })
  }
  const removeEntry = (entryId: string) => {
    if (decision.entries.length <= 2) return
    onChange({ ...decision, entries: decision.entries.filter((entry) => entry.id !== entryId) })
  }

  return <section className="posting-entry-editor" aria-label={localize(`${candidateId}の仕訳編集`)}>
    <header><strong>{localize("仕訳明細")}</strong><small>{localize("2〜128行・円単位")}</small></header>
    <div className="posting-entry-list">
      {decision.entries.map((entry, index) => <div className="posting-entry-row" key={entry.id}>
        <span>{index + 1}</span>
        <select aria-label={localize(`${candidateId}の${index + 1}行目の借貸`)} value={entry.side} onChange={(event) => updateEntry(entry.id, { side: event.target.value as 'DEBIT' | 'CREDIT' })}>
          <option value="DEBIT">{localize("借方")}</option><option value="CREDIT">{localize("貸方")}</option>
        </select>
        <select aria-label={localize(`${candidateId}の${index + 1}行目の口座`)} value={entry.accountId} onChange={(event) => updateEntry(entry.id, { accountId: event.target.value })}>
          <option value="">{text('口座を選択')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{canonicalAccountName(account, text)}（{accountKindLabel(account.accountKind, text)}）</option>)}
        </select>
        <input aria-label={localize(`${candidateId}の${index + 1}行目の金額`)} type="number" min="1" step="1" inputMode="numeric" value={entry.amountJpy || ''} onChange={(event) => updateEntry(entry.id, { amountJpy: event.target.value === '' ? 0 : Number(event.target.value) })} />
        <button type="button" className="mini-btn" aria-label={localize(`${candidateId}の${index + 1}行目を削除`)} disabled={decision.entries.length <= 2} onClick={() => removeEntry(entry.id)}>{localize("削除")}</button>
      </div>)}
    </div>
    <div className="posting-entry-footer">
      <button type="button" className="mini-btn" disabled={decision.entries.length >= MAX_ENTRIES} onClick={addEntry}>{localize("仕訳行を追加")}</button>
      <div aria-label={localize(`${candidateId}の仕訳合計`)}><span>{localize("候補")} {yen(candidateAmountJpy)}</span><span>{localize("借方")} {yen(debitTotal)}</span><span>{localize("貸方")} {yen(creditTotal)}</span></div>
    </div>
    {!validation.valid && <p className="posting-entry-error" role="alert">{[...new Set(validation.codes.map((code) => localize(validationMessages[code])))].join(' ')}</p>}
  </section>
}
