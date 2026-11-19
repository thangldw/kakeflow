import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { localize } from '../../i18n'
import type { PageId } from '../../types'

export interface PaletteTransaction {
  readonly id: string
  readonly occurredOn: string
  readonly payee: string | null
  readonly description: string | null
  readonly amountJpy: number
}

export interface PalettePage {
  readonly id: PageId
  /** Already localized for display. */
  readonly label: string
}

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly pages: readonly PalettePage[]
  readonly onNavigate: (page: PageId) => void
  /** Looks up posted transactions; omitted in runtimes without a ledger. */
  readonly searchTransactions?: (query: string) => Promise<readonly PaletteTransaction[]>
}

type Result =
  | { readonly kind: 'page'; readonly key: string; readonly page: PalettePage }
  | { readonly kind: 'transaction'; readonly key: string; readonly transaction: PaletteTransaction }

const MIN_SEARCH_LENGTH = 2
const SEARCH_DELAY_MS = 250
const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** Cmd/Ctrl+K palette: jump to a page or find a transaction by typing. */
export function CommandPalette({ open, onClose, pages, onNavigate, searchTransactions }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [transactions, setTransactions] = useState<readonly PaletteTransaction[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const trimmed = query.trim()

  useEffect(() => {
    if (open) { setQuery(''); setTransactions([]); setActive(0); inputRef.current?.focus() }
  }, [open])

  useEffect(() => {
    if (!open || !searchTransactions || trimmed.length < MIN_SEARCH_LENGTH) { setTransactions([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      searchTransactions(trimmed).then((rows) => { if (!cancelled) setTransactions(rows) }, () => { if (!cancelled) setTransactions([]) })
    }, SEARCH_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, searchTransactions, trimmed])

  const results = useMemo<readonly Result[]>(() => {
    const needle = trimmed.toLowerCase()
    const matchedPages = pages.filter((page) => needle === '' || page.label.toLowerCase().includes(needle))
    return [
      ...matchedPages.map((page): Result => ({ kind: 'page', key: `page-${page.id}`, page })),
      ...transactions.map((transaction): Result => ({ kind: 'transaction', key: `tx-${transaction.id}`, transaction })),
    ]
  }, [pages, transactions, trimmed])

  useEffect(() => { setActive((index) => Math.min(index, Math.max(0, results.length - 1))) }, [results.length])

  if (!open) return null

  const choose = (result: Result | undefined) => {
    if (!result) return
    onClose()
    onNavigate(result.kind === 'page' ? result.page.id : 'transactions')
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (results.length === 0 ? 0 : (index + 1) % results.length)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(results[active]) }
  }

  return <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label={localize("コマンドパレット")} onKeyDown={onKeyDown}>
      <input
        ref={inputRef} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${listId}-${results[active].key}` : undefined}
        aria-label={localize("ページや取引を検索")} placeholder={localize("ページや取引を検索")}
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }}
      />
      <ul id={listId} role="listbox" aria-label={localize("検索結果")}>
        {results.map((result, index) => <li
          key={result.key} id={`${listId}-${result.key}`} role="option" aria-selected={index === active}
          className={index === active ? 'command-palette-active' : undefined}
          onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); choose(result) }}
        >
          {result.kind === 'page'
            ? <><span>{result.page.label}</span><small>{localize("ページ")}</small></>
            : <><span>{result.transaction.occurredOn} {result.transaction.payee ?? result.transaction.description ?? '—'}</span><strong>{yen(result.transaction.amountJpy)}</strong></>}
        </li>)}
        {results.length === 0 && <li className="command-palette-empty" role="presentation">{localize("一致する結果はありません。")}</li>}
      </ul>
    </div>
  </div>
}
