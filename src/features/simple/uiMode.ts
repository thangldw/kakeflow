export type UiMode = 'simple' | 'full'

export interface QuickAddUsage {
  readonly categoryCounts: Readonly<Record<string, number>>
  readonly lastPayingAccountId: string | null
}

const UI_MODE_STORAGE_KEY = 'kakeflow.uiMode'
const USAGE_STORAGE_KEY_PREFIX = 'kakeflow.simpleUsage.'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readUiModes(): Record<string, UiMode> {
  try {
    const value = globalThis.localStorage?.getItem(UI_MODE_STORAGE_KEY)
    if (!value) return {}
    const parsed = JSON.parse(value) as unknown
    if (!isPlainObject(parsed)) return {}
    // Object.fromEntries defines own properties, so odd keys such as "__proto__" stay plain data.
    return Object.fromEntries(Object.entries(parsed).filter(([, mode]) => mode === 'simple' || mode === 'full')) as Record<string, UiMode>
  } catch { return {} }
}

export function readUiMode(householdId: string | null): UiMode {
  if (householdId === null) return 'full'
  const modes = readUiModes()
  return Object.hasOwn(modes, householdId) && modes[householdId] === 'simple' ? 'simple' : 'full'
}

export function writeUiMode(householdId: string, mode: UiMode): void {
  try {
    const entries = Object.entries(readUiModes()).filter(([id]) => id !== householdId)
    // 'full' is the default, so it is stored as the absence of an entry.
    if (mode === 'simple') entries.push([householdId, mode])
    if (entries.length === 0) globalThis.localStorage?.removeItem(UI_MODE_STORAGE_KEY)
    else globalThis.localStorage?.setItem(UI_MODE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* storage unavailable: the mode simply is not remembered */ }
}

const EMPTY_USAGE: QuickAddUsage = Object.freeze({ categoryCounts: Object.freeze({}), lastPayingAccountId: null })

export function readQuickAddUsage(householdId: string): QuickAddUsage {
  try {
    const value = globalThis.localStorage?.getItem(`${USAGE_STORAGE_KEY_PREFIX}${householdId}`)
    if (!value) return EMPTY_USAGE
    const parsed = JSON.parse(value) as unknown
    if (!isPlainObject(parsed)) return EMPTY_USAGE
    const counts = parsed.categoryCounts
    const categoryCounts = isPlainObject(counts)
      ? Object.fromEntries(Object.entries(counts).filter(([, count]) => typeof count === 'number' && Number.isInteger(count) && count >= 0))
      : {}
    const lastPayingAccountId = typeof parsed.lastPayingAccountId === 'string' ? parsed.lastPayingAccountId : null
    return { categoryCounts: categoryCounts as Record<string, number>, lastPayingAccountId }
  } catch { return EMPTY_USAGE }
}

export function recordQuickAddUse(householdId: string, categoryId: string, payingAccountId: string): void {
  try {
    const usage = readQuickAddUsage(householdId)
    const previous = Object.hasOwn(usage.categoryCounts, categoryId) ? usage.categoryCounts[categoryId] : 0
    const categoryCounts = Object.fromEntries([
      ...Object.entries(usage.categoryCounts).filter(([id]) => id !== categoryId),
      [categoryId, previous + 1],
    ])
    globalThis.localStorage?.setItem(
      `${USAGE_STORAGE_KEY_PREFIX}${householdId}`,
      JSON.stringify({ categoryCounts, lastPayingAccountId: payingAccountId }),
    )
  } catch { /* storage unavailable: usage is not remembered */ }
}
