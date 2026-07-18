import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  delimitedParserProfilePlatform,
  delimitedParserProfileDraft,
  type CreateDelimitedParserProfileInputDto,
  type DelimitedParserAmountMode,
  type DelimitedParserDateFormat,
  type DelimitedParserDelimiter,
  type DelimitedParserEncoding,
  type DelimitedParserProfileDto,
  type UpdateDelimitedParserProfileInputDto,
} from './delimitedParserProfilePlatform'
import { localize } from '../../i18n'

type ParserProfileApi = typeof delimitedParserProfilePlatform
type Draft = Omit<CreateDelimitedParserProfileInputDto, 'id' | 'householdId'>

const emptyDraft: Draft = {
  name: '', delimiter: 'AUTO', encoding: 'AUTO', headerRow: 1, dateColumn: '', dateFormat: 'AUTO',
  descriptionColumn: null, payeeColumn: null, amountMode: 'SIGNED', signedAmountColumn: null,
  signedPositiveDirection: 'IN',
  debitColumn: null, creditColumn: null, externalIdColumn: null, accountHintColumn: null,
  isEnabled: true, priority: 0,
}

const optional = (value: string): string | null => value.trim() || null

export function DelimitedParserProfilesPanel({ householdId, api = delimitedParserProfilePlatform }: { householdId: string | null; api?: ParserProfileApi }) {
  const [profiles, setProfiles] = useState<readonly DelimitedParserProfileDto[]>([])
  const [editing, setEditing] = useState<DelimitedParserProfileDto | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!householdId) { setProfiles([]); return }
    let active = true
    void api.list(householdId).then((items) => { if (active) { setProfiles(items); setNotice('') } }).catch(() => { if (active) setNotice(localize("CSV/TSVプロファイルを読み込めませんでした。")) })
    return () => { active = false }
  }, [api, householdId])

  const validation = useMemo(() => {
    if (!draft.name.trim()) return localize("プロファイル名を入力してください。")
    if (!draft.dateColumn.trim()) return localize("日付列を入力してください。")
    if (!draft.descriptionColumn?.trim() && !draft.payeeColumn?.trim()) return localize("摘要列または支払先列を1つ以上入力してください。")
    if (draft.amountMode === 'SIGNED' && !draft.signedAmountColumn?.trim()) return localize("符号付き金額列を入力してください。")
    if (draft.amountMode === 'DEBIT_CREDIT' && (!draft.debitColumn?.trim() || !draft.creditColumn?.trim())) return localize("支出列と収入列を入力してください。")
    const configured = [draft.dateColumn, draft.descriptionColumn, draft.payeeColumn, draft.amountMode === 'SIGNED' ? draft.signedAmountColumn : null, draft.amountMode === 'DEBIT_CREDIT' ? draft.debitColumn : null, draft.amountMode === 'DEBIT_CREDIT' ? draft.creditColumn : null, draft.externalIdColumn, draft.accountHintColumn].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim())
    if (new Set(configured).size !== configured.length) return localize("同じ列名を複数の項目に割り当てることはできません。")
    if (!Number.isSafeInteger(draft.headerRow) || draft.headerRow < 1 || draft.headerRow > 1000) return localize("ヘッダー行は1〜1000の整数で指定してください。")
    if (!Number.isSafeInteger(draft.priority) || draft.priority < 0 || draft.priority > 10000) return localize("優先度は0〜10000の整数で指定してください。")
    return null
  }, [draft])

  const selectProfile = (profile: DelimitedParserProfileDto) => {
    const { id, householdId, ...fields } = delimitedParserProfileDraft(profile)
    void id; void householdId
    setEditing(profile); setDraft(fields); setNotice('')
  }
  const reset = () => { setEditing(null); setDraft(emptyDraft); setNotice('') }
  const reload = async () => { if (householdId) setProfiles(await api.list(householdId)) }

  const save = async () => {
    if (!householdId || validation) { setNotice(validation ?? localize("世帯を選択してください。")); return }
    setBusy(true); setNotice('')
    try {
      if (editing) {
        const input: UpdateDelimitedParserProfileInputDto = { ...draft, householdId, profileId: editing.id, expectedVersion: editing.version }
        const saved = await api.update(input)
        setEditing(saved)
        const { id, householdId: savedHouseholdId, ...fields } = delimitedParserProfileDraft(saved)
        void id; void savedHouseholdId
        setDraft(fields)
        setNotice(localize(`プロファイルを更新しました（v${saved.version}）。`))
      } else {
        await api.create({ ...draft, id: crypto.randomUUID(), householdId })
        setDraft(emptyDraft)
        setNotice(localize("プロファイルを保存しました。"))
      }
      await reload()
    } catch { setNotice(localize("保存できませんでした。別画面で更新された可能性があります。再読み込みして確認してください。")) }
    finally { setBusy(false) }
  }

  const remove = async (profile: DelimitedParserProfileDto) => {
    if (!householdId) return
    setBusy(true); setNotice('')
    try {
      await api.delete({ householdId, profileId: profile.id, expectedVersion: profile.version })
      if (editing?.id === profile.id) reset()
      await reload()
      setNotice(localize("プロファイルを削除しました。"))
    } catch { setNotice(localize("削除できませんでした。プロファイルが更新されていないか確認してください。")) }
    finally { setBusy(false) }
  }

  const setText = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: optional(value) }))
  const delimiterLabels: Record<DelimitedParserDelimiter, string> = { AUTO: localize("自動判定"), COMMA: localize("カンマ (,)"), TAB: localize("タブ"), SEMICOLON: localize("セミコロン (;)") }
  const encodingLabels: Record<DelimitedParserEncoding, string> = { AUTO: localize("自動判定"), UTF8: 'UTF-8', CP932: 'Shift_JIS / CP932' }
  const dateLabels: Record<DelimitedParserDateFormat, string> = { AUTO: localize("自動判定"), YYYY_MM_DD: 'YYYY/MM/DD・YYYY-MM-DD', YYYYMMDD: 'YYYYMMDD', MM_DD_YYYY: 'MM/DD/YYYY', DD_MM_YYYY: 'DD/MM/YYYY' }

  return <section className="panel parser-profile-panel">
    <div className="panel-head"><div><h2>{localize("CSV / TSV 読み取りプロファイル")}</h2><p>{localize("金融機関のJPY取引ファイルごとの列構成を保存し、独自形式のプレビュー解析に再利用します。")}</p></div><FileSpreadsheet size={20} /></div>
    <p className="parser-profile-disclosure">{localize("Import Inbox でファイルごとに明示的に適用します。組み込み形式は従来どおり優先され、プロファイルで読み取った候補も確認・承認なしに台帳へ反映されません。")}</p>
    <div className="parser-profile-layout">
      <aside className="parser-profile-list"><button className={!editing ? 'active' : ''} onClick={reset}><Plus size={15} /><span><strong>{localize("新規プロファイル")}</strong><small>{localize("列マッピングを作成")}</small></span></button>{profiles.map((profile) => <div key={profile.id} className={editing?.id === profile.id ? 'active' : ''}><button aria-label={localize(`${profile.name}を編集`)} onClick={() => selectProfile(profile)}><Pencil size={15} /><span><strong>{profile.name}</strong><small>{profile.isEnabled ? localize("有効") : localize("無効")} {localize("・ 優先度")} {profile.priority} ・ v{profile.version}</small></span></button><button aria-label={localize(`${profile.name}を削除`)} disabled={busy} onClick={() => void remove(profile)}><Trash2 size={15} /></button></div>)}</aside>
      <div className="parser-profile-editor">
        <div className="parser-profile-grid">
          <label>{localize("プロファイル名")}<input aria-label={localize("プロファイル名")} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={localize("地域銀行 明細")} /></label>
          <label>{localize("優先度")}<input aria-label={localize("プロファイル優先度")} type="number" min="0" max="10000" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
          <label>{localize("区切り文字")}<select aria-label={localize("区切り文字")} value={draft.delimiter} onChange={(event) => setDraft((current) => ({ ...current, delimiter: event.target.value as DelimitedParserDelimiter }))}>{Object.entries(delimiterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{localize("文字コード")}<select aria-label={localize("文字コード")} value={draft.encoding} onChange={(event) => setDraft((current) => ({ ...current, encoding: event.target.value as DelimitedParserEncoding }))}>{Object.entries(encodingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{localize("ヘッダー行")}<input aria-label={localize("ヘッダー行")} type="number" min="1" max="1000" value={draft.headerRow} onChange={(event) => setDraft((current) => ({ ...current, headerRow: Number(event.target.value) }))} /></label>
          <label>{localize("日付形式")}<select aria-label={localize("日付形式")} value={draft.dateFormat} onChange={(event) => setDraft((current) => ({ ...current, dateFormat: event.target.value as DelimitedParserDateFormat }))}>{Object.entries(dateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{localize("日付列")}<input aria-label={localize("日付列")} value={draft.dateColumn} onChange={(event) => setDraft((current) => ({ ...current, dateColumn: event.target.value }))} placeholder={localize("日付")} /></label>
          <label>{localize("摘要列")}<input aria-label={localize("摘要列")} value={draft.descriptionColumn ?? ''} onChange={(event) => setText('descriptionColumn', event.target.value)} placeholder={localize("摘要")} /></label>
          <label>{localize("支払先列")}<input aria-label={localize("支払先列")} value={draft.payeeColumn ?? ''} onChange={(event) => setText('payeeColumn', event.target.value)} placeholder={localize("利用店名")} /></label>
          <label>{localize("金額の形式")}<select aria-label={localize("金額の形式")} value={draft.amountMode} onChange={(event) => { const mode = event.target.value as DelimitedParserAmountMode; setDraft((current) => ({ ...current, amountMode: mode, signedPositiveDirection: mode === 'SIGNED' ? 'IN' : null, signedAmountColumn: null, debitColumn: null, creditColumn: null })) }}><option value="SIGNED">{localize("符号付き金額 1列")}</option><option value="DEBIT_CREDIT">{localize("支出・収入 2列")}</option></select></label>
          {draft.amountMode === 'SIGNED' ? <><label>{localize("正の値の方向")}<select aria-label={localize("正の値の方向")} value={draft.signedPositiveDirection ?? 'IN'} onChange={(event) => setDraft((current) => ({ ...current, signedPositiveDirection: event.target.value as 'IN' | 'OUT' }))}><option value="IN">{localize("正の値 = 入金")}</option><option value="OUT">{localize("正の値 = 支出")}</option></select></label><label>{localize("符号付き金額列")}<input aria-label={localize("符号付き金額列")} value={draft.signedAmountColumn ?? ''} onChange={(event) => setText('signedAmountColumn', event.target.value)} placeholder={localize("金額")} /></label></> : <><label>{localize("支出列")}<input aria-label={localize("支出列")} value={draft.debitColumn ?? ''} onChange={(event) => setText('debitColumn', event.target.value)} placeholder={localize("支払い金額")} /></label><label>{localize("収入列")}<input aria-label={localize("収入列")} value={draft.creditColumn ?? ''} onChange={(event) => setText('creditColumn', event.target.value)} placeholder={localize("預かり金額")} /></label></>}
          <label>{localize("外部ID列")}<input aria-label={localize("外部ID列")} value={draft.externalIdColumn ?? ''} onChange={(event) => setText('externalIdColumn', event.target.value)} placeholder={localize("取引ID（任意）")} /></label>
          <label>{localize("口座ヒント列")}<input aria-label={localize("口座ヒント列")} value={draft.accountHintColumn ?? ''} onChange={(event) => setText('accountHintColumn', event.target.value)} placeholder={localize("口座名（任意）")} /></label>
          <label className="parser-enabled"><input aria-label={localize("プロファイルを有効にする")} type="checkbox" checked={draft.isEnabled} onChange={(event) => setDraft((current) => ({ ...current, isEnabled: event.target.checked }))} />{localize("プロファイルを有効にする")}</label>
        </div>
        <div className="parser-mapping-preview"><strong>{localize("マッピング確認")}</strong><span>{draft.dateColumn || localize("日付列")} {localize("→ 取引日")}</span><span>{draft.payeeColumn || draft.descriptionColumn || localize("摘要 / 支払先列")} {localize("→ 支払先・摘要")}</span><span>{draft.amountMode === 'SIGNED' ? draft.signedAmountColumn || localize("金額列") : localize(`${draft.debitColumn || localize("支出列")} / ${draft.creditColumn || localize("収入列")}`)} {localize("→ 金額・方向")}</span><small>{localize("Import Inbox の実ファイルプレビューで一致したヘッダー、候補件数、除外行と問題を確認できます。")}</small></div>
        {validation && <p className="parser-validation">{validation}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="parser-profile-actions">{editing && <span>{localize("編集中: v")}{editing.version}</span>}<button className="secondary-btn" onClick={reset}>{localize("入力をリセット")}</button><button className="primary-btn" disabled={busy || Boolean(validation) || !householdId} onClick={() => void save()}>{busy ? localize("保存中…") : editing ? localize("変更を保存") : localize("プロファイルを保存")}</button></div>
      </div>
    </div>
  </section>
}
