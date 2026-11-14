import { Archive, BookOpen, ChevronRight, Receipt, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BudgetEditor } from '../features/simple/BudgetEditor'
import { GoalsPanel, type NewGoalInput } from '../features/simple/GoalsPanel'
import { tokyoDate } from '../features/simple/homeMath'
import type { QuickAddKind } from '../features/simple/quickAdd'
import { QuickAddSheet } from '../features/simple/QuickAddSheet'
import { SimpleHome } from '../features/simple/SimpleHome'
import { UiModeSwitch } from '../features/simple/SimpleMorePage'
import { SimpleTabBar } from '../features/simple/SimpleTabBar'
import type { SimpleTab } from '../features/simple/simpleNavigation'
import { localize, useI18n } from '../i18n'
import type { PwaLedgerClient } from '../platform/pwa/client'
import type { Account, Household, MonthlyBudgetRow, Transaction } from '../platform/pwa/types'
import type { AccountDto, SavingsGoalDto } from '../platform/types'
import { addQuickAddEssentials } from './defaultChart'
import { formatJpy } from './formatJpy'
import { LanguageSwitch } from './LanguageSwitch'
import { PostedLedgerList } from './PostedLedgerList'
import { createSimpleAdapter, type SimpleAdapter } from './simpleAdapter'

export type PwaPage = 'import' | 'ledger' | 'backup'

interface SimpleShellProps {
  readonly client: PwaLedgerClient
  readonly household: Household
  /** Opens one of the classic PWA pages (receipt import, the posted ledger with its evidence, backup). */
  readonly onOpenPage: (page: PwaPage) => void
  readonly onSwitchToClassic: () => void
  /** Called when the user moves on (another tab, accounts set up), so a notice shown around the shell can clear. */
  readonly onActivity?: () => void
}

/** How long the "Saved ¥X · category" line stays after a quick add. */
const SAVED_STATUS_MS = 4000

const currentMonth = () => tokyoDate().slice(0, 7)

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

/**
 * Simple mode in the PWA: the five-tab bar (Today, History, Budget, Savings, More), the floating
 * "+ Add spending" button and the quick-add sheet, all served from the vault through the Simple adapter.
 */
export function SimpleShell({ client, household, onOpenPage, onSwitchToClassic, onActivity }: SimpleShellProps) {
  // Subscribes the shell to the language, so every tab re-renders when it changes.
  const { text } = useI18n()
  const adapter = useMemo(() => createSimpleAdapter(client, household.id), [client, household.id])
  const [tab, setTab] = useState<SimpleTab>('today')
  const [month, setMonth] = useState(currentMonth)
  // Bumped after every write, so whatever is on screen reloads.
  const [revision, setRevision] = useState(0)
  const [accounts, setAccounts] = useState<readonly AccountDto[]>([])
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [savedText, setSavedText] = useState('')
  const [setupFailed, setSetupFailed] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A second tap while the accounts are being created must not create them again.
  const settingUp = useRef(false)
  const changed = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true
    adapter.listAccountDtos().then((next) => { if (active) setAccounts(next) }, () => { if (active) setAccounts([]) })
    return () => { active = false }
  }, [adapter, revision])

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const selectTab = (next: SimpleTab) => {
    setTab(next)
    setSetupFailed(false)
    onActivity?.()
    // A new tab starts at its top, like a new page.
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
  }

  const quickAddSaved = ({ amountJpy, categoryName }: { amountJpy: number; categoryName: string }) => {
    setQuickAddOpen(false)
    changed()
    setSavedText(`${localize("保存しました")} ${formatJpy(amountJpy)} · ${categoryName}`)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedText(''), SAVED_STATUS_MS)
  }

  const setupAccounts = async (kind: QuickAddKind) => {
    if (settingUp.current) return
    settingUp.current = true
    setSetupFailed(false)
    try {
      await addQuickAddEssentials(client, household.id, kind, text)
      onActivity?.()
    } catch {
      setSetupFailed(true)
    } finally {
      settingUp.current = false
      changed()
    }
  }

  return <div className="pwa-simple">
    <main className="pwa-simple-main">
      {setupFailed && <p className="pwa-error pwa-simple-page" role="alert">{localize("既定の口座を追加できませんでした")}</p>}
      {tab === 'today' && <SimpleHome
        householdId={household.id} householdName={household.name} month={month} revision={revision} client={adapter}
        onSetLimit={() => selectTab('budget')} onOpenBudgets={() => selectTab('budget')} onOpenSavings={() => selectTab('savings')}
        onGoToCurrentMonth={() => setMonth(currentMonth())}
      />}
      {tab === 'transactions' && <HistoryTab client={client} householdId={household.id} revision={revision} />}
      {tab === 'budget' && <BudgetTab client={client} householdId={household.id} month={month} onChanged={changed} />}
      {tab === 'savings' && <SavingsTab adapter={adapter} client={client} householdId={household.id} revision={revision} onChanged={changed} />}
      {tab === 'more' && <MoreTab onOpenPage={onOpenPage} onSwitchToClassic={onSwitchToClassic} />}
    </main>
    {/* Always present so screen readers announce the text when it appears. */}
    <p className="pwa-simple-saved" role="status">{savedText}</p>
    <button type="button" className="primary-btn simple-add-fab" onClick={() => setQuickAddOpen(true)}>{localize("＋ 支出を記録")}</button>
    <SimpleTabBar active={tab} onSelect={selectTab} />
    <QuickAddSheet
      open={quickAddOpen} householdId={household.id} accounts={accounts} client={adapter}
      onClose={() => setQuickAddOpen(false)} onSaved={quickAddSaved} onSetupAccounts={(kind) => { void setupAccounts(kind) }}
    />
  </div>
}

type Load<T> = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly data: T }

/** Loads `load()` whenever `key` changes; `retry` loads again. */
function useLoad<T>(load: () => Promise<T>, key: string): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    load().then((data) => { if (active) setState({ kind: 'ready', data }) }, () => { if (active) setState({ kind: 'error' }) })
    return () => { active = false }
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` names everything `load` reads
  return [state, () => { setState({ kind: 'loading' }); setAttempt((value) => value + 1) }]
}

function LoadProblem({ state, retry }: { readonly state: Load<unknown>; readonly retry: () => void }) {
  if (state.kind === 'loading') return <div className="pwa-simple-page" aria-busy="true"><div className="skeleton simple-skeleton-card" /></div>
  return <div className="pwa-simple-page"><div className="simple-card simple-home-error" role="alert">
    <p>{localize("読み込めませんでした")}</p>
    <button type="button" className="secondary-btn" onClick={retry}>{localize("再読み込み")}</button>
  </div></div>
}

function HistoryTab({ client, householdId, revision }: { readonly client: PwaLedgerClient; readonly householdId: string; readonly revision: number }) {
  const [state, retry] = useLoad<Transaction[]>(() => client.listTransactions(householdId), `${householdId}|${revision}`)
  return <section className="pwa-simple-page pwa-simple-history" aria-labelledby="pwa-simple-history-title">
    <h2 id="pwa-simple-history-title" className="simple-panel-title">{localize("取引一覧")}</h2>
    {state.kind === 'ready'
      ? <PostedLedgerList transactions={state.data} emptyText={localize("取引はまだ記録されていません")} />
      : <LoadProblem state={state} retry={retry} />}
  </section>
}

interface BudgetData {
  readonly categories: readonly Account[]
  readonly budgets: readonly MonthlyBudgetRow[]
}

function BudgetTab({ client, householdId, month, onChanged }: { readonly client: PwaLedgerClient; readonly householdId: string; readonly month: string; readonly onChanged: () => void }) {
  // Reloaded only for the month and after a new category: a saved amount stays in its row (which keeps its "Saved" note).
  const [categoryRevision, setCategoryRevision] = useState(0)
  const [state, retry] = useLoad<BudgetData>(async () => {
    const [accounts, budgets] = await Promise.all([client.listAccounts(householdId), client.listBudgets(householdId, month)])
    return { categories: accounts.filter((account) => account.kind === 'EXPENSE'), budgets }
  }, `${householdId}|${month}|${categoryRevision}`)
  if (state.kind !== 'ready') return <LoadProblem state={state} retry={retry} />
  return <div className="pwa-simple-page">
    <BudgetEditor
      month={month}
      categories={state.data.categories}
      budgets={state.data.budgets}
      onSave={async (categoryAccountId, budgetJpy) => {
        await client.upsertBudget({ householdId, month, categoryAccountId, budgetJpy })
        onChanged()
      }}
      onAddCategory={async (name) => {
        await client.createAccount({ id: newId('expense'), householdId, name, kind: 'EXPENSE' })
        setCategoryRevision((value) => value + 1)
        onChanged()
      }}
    />
  </div>
}

function SavingsTab({ adapter, client, householdId, revision, onChanged }: { readonly adapter: SimpleAdapter; readonly client: PwaLedgerClient; readonly householdId: string; readonly revision: number; readonly onChanged: () => void }) {
  const [state, retry] = useLoad<readonly SavingsGoalDto[]>(() => adapter.listSavingsGoals(householdId), `${householdId}|${revision}`)
  if (state.kind !== 'ready') return <LoadProblem state={state} retry={retry} />
  return <GoalsPanel
    goals={state.data}
    onCreate={async ({ name, targetJpy, targetDate }: NewGoalInput) => {
      await client.createSavingsGoal({ id: newId('goal'), householdId, name, targetJpy, savedJpy: 0, targetDate })
      onChanged()
    }}
    onUpdateSaved={async (goalId, savedJpy) => {
      const goal = state.data.find((item) => item.id === goalId)
      if (!goal) throw new Error('Savings goal not found')
      await adapter.updateSavingsGoal({ ...goal, savedJpy })
      onChanged()
    }}
  />
}

const MORE_ENTRIES: readonly { readonly page: PwaPage; readonly icon: LucideIcon }[] = [
  { page: 'import', icon: Receipt },
  { page: 'ledger', icon: BookOpen },
  { page: 'backup', icon: Archive },
]

function MoreTab({ onOpenPage, onSwitchToClassic }: { readonly onOpenPage: (page: PwaPage) => void; readonly onSwitchToClassic: () => void }) {
  // Literal calls, so the PWA catalog generator collects these keys (it skips labels passed through a variable).
  const labels: Record<PwaPage, string> = {
    import: localize("レシートを取り込む"),
    ledger: localize("元帳と証跡"),
    backup: localize("バックアップと復元"),
  }
  return <div className="simple-more">
    <ul className="simple-more-list">
      {MORE_ENTRIES.map((entry) => <li key={entry.page}>
        <button type="button" className="simple-more-item" data-page={entry.page} onClick={() => onOpenPage(entry.page)}>
          <entry.icon size={20} aria-hidden="true" />
          <span>{labels[entry.page]}</span>
          <ChevronRight size={18} aria-hidden="true" className="simple-more-chevron" />
        </button>
      </li>)}
    </ul>
    <div className="simple-card"><UiModeSwitch mode="simple" onChange={(mode) => { if (mode === 'full') onSwitchToClassic() }} /></div>
    <div className="simple-card"><LanguageSwitch /></div>
  </div>
}
