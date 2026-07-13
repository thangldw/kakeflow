import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { decodeCsvBytes, normalizeHeader, tokenizeCsv } from '../../ingestion'
import { parseCustomDelimitedBytes } from '../../ingestion/adapters/customDelimited'
import type { AccountDto } from '../../platform'
import {
  delimitedParserProfilePlatform,
  type CreateDelimitedParserProfileInputDto,
  type DelimitedParserAmountMode,
  type DelimitedParserDateFormat,
  type DelimitedParserProfileDto,
} from './delimitedParserProfilePlatform'

type Api = Pick<typeof delimitedParserProfilePlatform, 'create' | 'list'>
type MappingKey = 'dateColumn' | 'descriptionColumn' | 'payeeColumn' | 'signedAmountColumn' | 'debitColumn' | 'creditColumn' | 'externalIdColumn' | 'accountHintColumn'

export function CustomParserRescueDialog({ householdId, filename, bytes, accounts, api = delimitedParserProfilePlatform, returnFocus, onCancel, onSaved }: {
  householdId: string
  filename: string
  bytes: Uint8Array
  accounts: readonly AccountDto[]
  api?: Api
  returnFocus?: HTMLElement | null
  onCancel: () => void
  onSaved: (profile: DelimitedParserProfileDto, accountId: string) => void
}) {
  const decoded = useMemo(() => decodeCsvBytes(bytes), [bytes])
  const rows = useMemo(() => tokenizeCsv(decoded.text).rows, [decoded.text])
  const headerCandidates = useMemo(() => rows.filter((row) => row.sourceRow <= 12), [rows])
  const [headerRow, setHeaderRow] = useState(headerCandidates[0]?.sourceRow ?? 1)
  const [profileId] = useState(() => crypto.randomUUID())
  const [savedProfile, setSavedProfile] = useState<DelimitedParserProfileDto | null>(null)
  const [name, setName] = useState(`${filename.replace(/\.[^.]+$/, '')} 読み取り`)
  const [dateFormat, setDateFormat] = useState<DelimitedParserDateFormat>('AUTO')
  const [amountMode, setAmountMode] = useState<DelimitedParserAmountMode>('SIGNED')
  const [positiveDirection, setPositiveDirection] = useState<'IN' | 'OUT'>('IN')
  const [mapping, setMapping] = useState<Record<MappingKey, string>>({ dateColumn: '', descriptionColumn: '', payeeColumn: '', signedAmountColumn: '', debitColumn: '', creditColumn: '', externalIdColumn: '', accountHintColumn: '' })
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => () => { returnFocus?.focus() }, [returnFocus])
  const header = rows.find((row) => row.sourceRow === headerRow)
  const headers = (header?.fields ?? []).map(normalizeHeader).filter(Boolean)
  const duplicateHeaders = new Set(headers.filter((value, index) => headers.indexOf(value) !== index))

  const setHeader = (value: number) => {
    setHeaderRow(value)
    setMapping({ dateColumn: '', descriptionColumn: '', payeeColumn: '', signedAmountColumn: '', debitColumn: '', creditColumn: '', externalIdColumn: '', accountHintColumn: '' })
  }
  const setColumn = (key: MappingKey, value: string) => setMapping((current) => ({ ...current, [key]: value }))
  const mapped = [mapping.dateColumn, mapping.descriptionColumn, mapping.payeeColumn, amountMode === 'SIGNED' ? mapping.signedAmountColumn : mapping.debitColumn, amountMode === 'DEBIT_CREDIT' ? mapping.creditColumn : '', mapping.externalIdColumn, mapping.accountHintColumn].filter(Boolean)
  const mappingValidation = !name.trim() ? 'プロファイル名を入力してください。'
    : headers.length === 0 ? 'ヘッダー行を選択してください。'
    : duplicateHeaders.size > 0 ? '同じ名前のヘッダーがある行は使用できません。'
    : !mapping.dateColumn ? '日付列を選択してください。'
    : !mapping.descriptionColumn && !mapping.payeeColumn ? '摘要列または支払先列を選択してください。'
    : amountMode === 'SIGNED' && !mapping.signedAmountColumn ? '符号付き金額列を選択してください。'
    : amountMode === 'DEBIT_CREDIT' && (!mapping.debitColumn || !mapping.creditColumn) ? '支出列と収入列を選択してください。'
    : new Set(mapped).size !== mapped.length ? '同じ列を複数の項目に割り当てることはできません。'
    : null
  const validation = mappingValidation ?? (!accountId ? '取込先口座を選択してください。' : null)

  const draft = useMemo(() => ({
    id: 'rescue-preview', householdId, name: name.trim() || 'preview', delimiter: 'AUTO' as const, encoding: 'AUTO' as const,
    headerRow, dateColumn: mapping.dateColumn, dateFormat, descriptionColumn: mapping.descriptionColumn || null,
    payeeColumn: mapping.payeeColumn || null, amountMode,
    signedPositiveDirection: amountMode === 'SIGNED' ? positiveDirection : null,
    signedAmountColumn: amountMode === 'SIGNED' ? mapping.signedAmountColumn || null : null,
    debitColumn: amountMode === 'DEBIT_CREDIT' ? mapping.debitColumn || null : null,
    creditColumn: amountMode === 'DEBIT_CREDIT' ? mapping.creditColumn || null : null,
    externalIdColumn: mapping.externalIdColumn || null, accountHintColumn: mapping.accountHintColumn || null,
    isEnabled: true, priority: 50, version: 1, createdAt: '', updatedAt: '',
  }), [amountMode, dateFormat, headerRow, householdId, mapping, name, positiveDirection])
  const preview = useMemo(() => mappingValidation ? null : parseCustomDelimitedBytes(bytes, draft, { filename }).preview, [bytes, draft, filename, mappingValidation])
  const errorCount = preview?.issues.filter((issue) => issue.severity === 'error').length ?? 0
  const canSave = !validation && preview != null && preview.candidateCount > 0 && errorCount === 0

  const save = async () => {
    if (!canSave) { setNotice(validation ?? 'エラーのない候補が1件以上必要です。'); return }
    setBusy(true); setNotice('')
    const { version: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...profileFields } = draft
    void _version; void _createdAt; void _updatedAt
    const input: CreateDelimitedParserProfileInputDto = { ...profileFields, id: profileId }
    let saved = savedProfile
    if (!saved) {
      try { saved = await api.create(input) }
      catch {
        try { saved = (await api.list(householdId)).find((profile) => profile.id === profileId) ?? null }
        catch { saved = null }
      }
      if (!saved) { setNotice('プロファイルを保存できませんでした。入力内容は保持されています。'); setBusy(false); return }
      setSavedProfile(saved)
    }
    try { onSaved(saved, accountId) }
    catch { setNotice('プロファイルは保存済みです。適用を再試行してください。') }
    finally { setBusy(false) }
  }
  const columnSelect = (label: string, key: MappingKey) => <label>{label}<select aria-label={label} disabled={Boolean(savedProfile)} value={mapping[key]} onChange={(event) => setColumn(key, event.target.value)}><option value="">使用しない</option>{headers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>

  return <div className="rescue-backdrop" role="presentation"><section ref={dialogRef} className="rescue-dialog" role="dialog" aria-modal="true" aria-labelledby="rescue-title" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); return }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]; const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}>
    <div className="panel-head"><div><h2 id="rescue-title">このCSVを読み取る</h2><p>{filename} ・ JPY取引のみ ・ 保存後もレビュー必須</p></div><button className="icon-btn" aria-label="マッピングを閉じる" onClick={onCancel}><X size={18} /></button></div>
    <div className="rescue-grid">
      <label>プロファイル名<input autoFocus aria-label="救済プロファイル名" disabled={Boolean(savedProfile)} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>ヘッダー行<select aria-label="救済ヘッダー行" disabled={Boolean(savedProfile)} value={headerRow} onChange={(event) => setHeader(Number(event.target.value))}>{headerCandidates.map((row) => <option key={row.sourceRow} value={row.sourceRow}>行 {row.sourceRow}: {row.fields.slice(0, 3).join(' / ')}</option>)}</select></label>
      <label>日付形式<select aria-label="救済日付形式" disabled={Boolean(savedProfile)} value={dateFormat} onChange={(event) => setDateFormat(event.target.value as DelimitedParserDateFormat)}><option value="AUTO">自動判定</option><option value="YYYY_MM_DD">YYYY/MM/DD・YYYY-MM-DD</option><option value="YYYYMMDD">YYYYMMDD</option><option value="MM_DD_YYYY">MM/DD/YYYY</option><option value="DD_MM_YYYY">DD/MM/YYYY</option></select></label>
      {columnSelect('日付列', 'dateColumn')}{columnSelect('支払先列', 'payeeColumn')}{columnSelect('摘要列', 'descriptionColumn')}
      <label>金額の形式<select aria-label="救済金額形式" disabled={Boolean(savedProfile)} value={amountMode} onChange={(event) => { setAmountMode(event.target.value as DelimitedParserAmountMode); setMapping((current) => ({ ...current, signedAmountColumn: '', debitColumn: '', creditColumn: '' })) }}><option value="SIGNED">符号付き金額 1列</option><option value="DEBIT_CREDIT">支出・収入 2列</option></select></label>
      {amountMode === 'SIGNED' ? <><label>正の値<select aria-label="救済正の値の方向" disabled={Boolean(savedProfile)} value={positiveDirection} onChange={(event) => setPositiveDirection(event.target.value as 'IN' | 'OUT')}><option value="IN">入金</option><option value="OUT">支出</option></select></label>{columnSelect('符号付き金額列', 'signedAmountColumn')}</> : <>{columnSelect('支出列', 'debitColumn')}{columnSelect('収入列', 'creditColumn')}</>}
      {columnSelect('外部ID列', 'externalIdColumn')}{columnSelect('口座ヒント列', 'accountHintColumn')}
      <label>取込先口座<select aria-label="救済取込先口座" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">口座を選択</option>{accounts.filter((account) => account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    </div>
    <div className="rescue-sample"><strong>ローカルプレビュー</strong>{rows.slice(rows.findIndex((row) => row.sourceRow === headerRow), rows.findIndex((row) => row.sourceRow === headerRow) + 4).map((row) => <code key={row.sourceRow}>行 {row.sourceRow}: {row.fields.map((value) => value.slice(0, 32)).join(' | ')}</code>)}</div>
    {preview && <p role="status">{preview.encoding} ・ 区切り「{preview.delimiter === '\t' ? 'TAB' : preview.delimiter}」・ 候補 {preview.candidateCount}件 ・ 除外 {preview.rejectedRowCount}行 ・ エラー {errorCount}件</p>}
    {(validation || notice || (preview?.issues.length ?? 0) > 0) && <div className="rescue-errors" role="alert">{notice || validation || preview?.issues.slice(0, 3).map((issue) => `${issue.row ? `行 ${issue.row}: ` : ''}${issue.message}`).join(' / ')}</div>}
    <div className="rescue-actions"><button className="secondary-btn" onClick={onCancel}>キャンセル</button><button className="primary-btn" disabled={busy || !canSave} onClick={() => void save()}>{busy ? '保存中…' : savedProfile ? '保存済みプロファイルを再適用' : 'プロファイルを保存してプレビューへ'}</button></div>
  </section></div>
}
